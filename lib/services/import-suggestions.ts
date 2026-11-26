import { prisma } from "../prisma";
import { canEditPerson, type Scope } from "../scope";
import { formatFuzzyDate, formatFuzzyYear, sameFuzzyDate, type FuzzyDate } from "../dates";
import { relativeNameKey, type Confidence, type DupPerson } from "../duplicates";
import { evidenceSentence, linkImports, type LinkPair, type LinkPerson } from "../import-linking";
import { nameKey, placeCompareKey } from "../name-keys";
import { bulkToFuzzy } from "../gedcom-import/dates";
import type { MappedImport } from "../gedcom-import/mapping";
import { loadDuplicatePeople } from "./duplicates";
import { MANUAL_ORIGIN_LABEL } from "./dto";
import { loadImportDirectory } from "./origin";

/**
 * Vorschläge beim GEDCOM-Import: Neue Personen der Datei werden gegen alle
 * vorhandenen Personen abgeglichen — von Hand erfasste und solche aus allen
 * anderen Importen. Abgleich ist derselbe wie bei „Importe verbinden“
 * (`linkImports` aus lib/import-linking.ts, mit `focus` auf die neuen
 * Personen der Datei): gleiche Bewertung, gleiche Klassen, gleiche Regeln
 * (Eindeutigkeit, Ausbreitung über Verwandte, Brücken, Vorfahren/Nachkommen,
 * „kein Duplikat“). Es wird nichts entschieden — Standard bleibt „neu
 * anlegen“; verknüpft wird nur, was der Administrator einzeln auswählt
 * (lib/services/gedcom-import.ts, `applyGedcomImport`).
 *
 * Personen der Datei, die der Import schon wiedererkennt (erneuter Import
 * derselben Quelle), sind keine Kandidaten und bekommen keine Vorschläge —
 * das Wiedererkennen hat Vorrang. Vorgeschlagen werden nur Personen, die der
 * Importierende sieht und bearbeiten darf; Unsichtbare gehen weder als
 * Vorschlag noch als Zahl in das Ergebnis ein.
 */

/** Teilklasse wie bei „Importe verbinden“: „sehr wahrscheinlich“ gehört zu „wahrscheinlich“. */
export type SuggestionClass = "high" | "veryLikely" | "medium" | "low";

export const SUGGESTION_CLASS_RANK: Record<SuggestionClass, number> = { high: 0, veryLikely: 1, medium: 2, low: 3 };

export type ImportSuggestion = {
  /** Vorhandene Person. */
  personId: string;
  /** Name und Lebensjahre der vorhandenen Person. */
  label: string;
  /** Herkunft der vorhandenen Person („von Hand erfasst“ bzw. „Import A · Name“). */
  origin: string;
  confidence: Confidence;
  /** Einstufung samt Teilklasse „sehr wahrscheinlich“. */
  cls: SuggestionClass;
  score: number;
  /** Worin sie übereinstimmen (Satz aus `evidenceSentence`). */
  sentence: string;
  /** Widersprüche aus der Bewertung. */
  conflicts: string[];
  /** Worin sie abweichen (Datei ↔ vorhanden). */
  differences: string[];
  /** Über einen schon zugeordneten Verwandten gefunden. */
  viaRelative: boolean;
  /** Einzige Verbindung zweier sonst getrennter Familien. */
  onlyBridge: boolean;
};

export type ImportLinkSummary = {
  /** Personen der Datei je bester Klasse ihres Vorschlags. */
  persons: Record<SuggestionClass, number>;
  /** Verglichen: neue Personen der Datei, vorhandene Personen. */
  compared: { file: number; existing: number };
  durationMs: number;
  /** Abgleich ausgelassen (zu viele Personen) — mit Grund, nie still. */
  skipped?: string;
};

/** Obergrenze für Datei + Bestand; darüber wird der Abgleich ausgelassen und das angezeigt. */
export const MAX_LINK_PERSONS = 100_000;
/** Höchstens so viele Vorschläge je Person der Datei. */
export const MAX_SUGGESTIONS_PER_PERSON = 3;

export const fileLinkId = (ref: string) => `@datei:${ref}`;
const FILE_GROUP = "@datei";

export function suggestionClass(p: Pick<LinkPair, "confidence" | "veryLikely">): SuggestionClass {
  return p.confidence === "high" ? "high" : p.confidence === "medium" ? (p.veryLikely ? "veryLikely" : "medium") : "low";
}

const life = (birth: FuzzyDate | null, death: FuzzyDate | null) => {
  const b = formatFuzzyYear(birth);
  const d = formatFuzzyYear(death);
  return [b && `*${b}`, d && `†${d}`].filter(Boolean).join(" ");
};

/** Worin Datei-Person und vorhandene Person abweichen (kurz, für die Vorschau). */
export function pairDifferences(file: DupPerson, app: DupPerson): string[] {
  const out: string[] = [];
  const both = (label: string, a: string, b: string) => out.push(`${label}: Datei ${a}, vorhanden ${b}`);
  if (nameKey(file.familyName) && nameKey(app.familyName) && nameKey(file.familyName) !== nameKey(app.familyName)) {
    both("Nachname", file.familyName ?? "", app.familyName ?? "");
  }
  if (nameKey(file.givenName) !== nameKey(app.givenName)) both("Vorname", file.givenName, app.givenName);
  for (const [label, f, a] of [
    ["Geburt", file.birth, app.birth],
    ["Tod", file.death, app.death],
  ] as const) {
    if (f && a && !sameFuzzyDate(f, a)) both(label, formatFuzzyDate(f), formatFuzzyDate(a));
    else if (f && !a) out.push(`${label} nur in der Datei: ${formatFuzzyDate(f)}`);
    else if (!f && a) out.push(`${label} nur bei der vorhandenen Person: ${formatFuzzyDate(a)}`);
  }
  if (file.birthPlace && app.birthPlace && placeCompareKey(file.birthPlace) !== placeCompareKey(app.birthPlace)) {
    both("Geburtsort", file.birthPlace, app.birthPlace);
  } else if (file.birthPlace && !app.birthPlace) out.push(`Geburtsort nur in der Datei: ${file.birthPlace}`);
  else if (!file.birthPlace && app.birthPlace) out.push(`Geburtsort nur bei der vorhandenen Person: ${app.birthPlace}`);
  return out;
}

export type ImportSuggestionsResult = {
  byRef: Map<string, ImportSuggestion[]>;
  summary: ImportLinkSummary;
};

/**
 * Abgleich der neuen Personen einer Datei gegen den sichtbaren Bestand.
 * `newRefs`: Personen der Datei, die neu angelegt würden; `matched`: schon
 * wiedererkannte Personen der Datei (ref → vorhandene ID) — sie stehen als
 * Verwandte im Abgleich, sind aber selbst nie Kandidaten.
 */
export async function suggestImportLinks(
  scope: Scope,
  input: {
    mapped: MappedImport;
    newRefs: Iterable<string>;
    matched: Map<string, string>;
    sourceTreeId: string;
    /** Vorschläge je Person (Standard MAX_SUGGESTIONS_PER_PERSON; die Nachprüfung beim Ausführen will alle). */
    limit?: number;
  },
): Promise<ImportSuggestionsResult> {
  const started = performance.now();
  const newRefs = new Set(input.newRefs);
  const empty: Record<SuggestionClass, number> = { high: 0, veryLikely: 0, medium: 0, low: 0 };
  const result: ImportSuggestionsResult = {
    byRef: new Map(),
    summary: { persons: { ...empty }, compared: { file: newRefs.size, existing: 0 }, durationMs: 0 },
  };
  if (!newRefs.size) return result;

  const { graph, people } = await loadDuplicatePeople(scope);
  result.summary.compared.existing = people.length;
  if (people.length + newRefs.size > MAX_LINK_PERSONS) {
    result.summary.skipped = `Abgleich mit vorhandenen Personen ausgelassen: ${newRefs.size} neue und ${people.length} vorhandene Personen sind zusammen mehr als ${MAX_LINK_PERSONS}. Die Personen werden neu angelegt; „Importe verbinden“ findet sie danach.`;
    result.summary.durationMs = Math.round(performance.now() - started);
    return result;
  }

  // Bestand: Gruppe je Herkunft wie bei „Importe verbinden“; schon
  // wiedererkannte Personen dieser Datei gehören zur Datei.
  const matchedIds = new Set(input.matched.values());
  const groupOf = (p: { id: string; trees: string[] }) =>
    matchedIds.has(p.id) ? FILE_GROUP : p.trees.length ? [...p.trees].sort().join("+") : "manual";
  const appPeople: LinkPerson[] = people.map((p) => ({ ...p, group: groupOf(p), parents: [...p.parents], partners: [...p.partners], children: [...p.children] }));
  const appById = new Map(appPeople.map((p) => [p.id, p]));

  // Datei: neue Personen mit ihren Verwandten (neue → Datei-ID, wiedererkannte → vorhandene ID).
  const m = input.mapped;
  const personBy = new Map(m.persons.map((p) => [p.ref, p]));
  const idOf = (ref: string): string | null => (newRefs.has(ref) ? fileLinkId(ref) : (input.matched.get(ref) ?? null));
  const nameOfId = (id: string): string => {
    if (id.startsWith(`${FILE_GROUP}:`)) return relativeNameKey(personBy.get(id.slice(FILE_GROUP.length + 1))?.givenName, personBy.get(id.slice(FILE_GROUP.length + 1))?.familyName);
    const gp = graph.persons.get(id);
    return gp ? relativeNameKey(gp.givenName, gp.familyName) : "";
  };
  const variantsOf = new Map<string, DupPerson["variants"]>();
  for (const n of m.names) {
    if (!n.personRef || !newRefs.has(n.personRef)) continue;
    variantsOf.set(n.personRef, [...(variantsOf.get(n.personRef) ?? []), { givenName: n.givenName, familyName: n.familyName }]);
  }
  const filePeople = new Map<string, LinkPerson>();
  for (const ref of newRefs) {
    const p = personBy.get(ref);
    if (!p) continue;
    filePeople.set(ref, {
      id: fileLinkId(ref),
      group: FILE_GROUP,
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      gender: p.gender,
      birth: bulkToFuzzy(p.birth),
      death: bulkToFuzzy(p.death),
      birthPlace: p.birthPlace,
      variants: variantsOf.get(ref) ?? [],
      parents: [],
      partners: [],
      children: [],
      parentNames: [],
      partnerNames: [],
      trees: [input.sourceTreeId],
    });
  }
  const nodeOf = (id: string): LinkPerson | undefined =>
    id.startsWith(`${FILE_GROUP}:`) ? filePeople.get(id.slice(FILE_GROUP.length + 1)) : appById.get(id);
  const addUnique = (list: string[], x: string) => {
    if (!list.includes(x)) list.push(x);
  };
  for (const r of m.relationships) {
    const a = idOf(r.fromRef);
    const b = idOf(r.toRef);
    if (!a || !b || a === b) continue;
    const na = nodeOf(a);
    const nb = nodeOf(b);
    // Kanten zwischen zwei vorhandenen Personen kennt der Bestand schon.
    if (!na || !nb || (!a.startsWith(`${FILE_GROUP}:`) && !b.startsWith(`${FILE_GROUP}:`))) continue;
    if (r.type === "PARENT_OF") {
      addUnique(na.children, b);
      addUnique(nb.parents, a);
    } else {
      addUnique(na.partners, b);
      addUnique(nb.partners, a);
    }
  }
  for (const fp of filePeople.values()) {
    fp.parentNames = fp.parents.map(nameOfId).filter(Boolean);
    fp.partnerNames = fp.partners.map(nameOfId).filter(Boolean);
  }
  // Vorhandene Personen mit neuen Verwandten aus der Datei: auch deren Namen zählen.
  for (const ap of appPeople) {
    if (ap.parents.some((x) => x.startsWith(`${FILE_GROUP}:`))) ap.parentNames = ap.parents.map(nameOfId).filter(Boolean);
    if (ap.partners.some((x) => x.startsWith(`${FILE_GROUP}:`))) ap.partnerNames = ap.partners.map(nameOfId).filter(Boolean);
  }

  const ids = appPeople.map((p) => p.id);
  const dismissedRows = await prisma.duplicateDismissal.findMany({
    where: { personAId: { in: ids }, personBId: { in: ids } },
    select: { personAId: true, personBId: true },
  });
  const dismissed = new Set(dismissedRows.map((d) => `${d.personAId}|${d.personBId}`));
  const all = [...appPeople, ...filePeople.values()];
  const focus = new Set([...filePeople.values()].map((p) => p.id));
  const res = linkImports(all, { focus, dismissed });

  // Nur vorhandene Personen, die der Importierende sehen UND bearbeiten darf.
  const editable = (id: string) => {
    const gp = graph.persons.get(id);
    return Boolean(gp?.visible && canEditPerson(scope, gp.familyIds));
  };
  const importDir = await loadImportDirectory();
  const originOf = (p: LinkPerson) =>
    p.trees.length ? p.trees.map((t) => `Import ${importDir.label(scope, t)}`).join(" + ") : MANUAL_ORIGIN_LABEL;
  for (const pair of res.pairs) {
    const fileSide = focus.has(pair.a) ? pair.a : focus.has(pair.b) ? pair.b : null;
    if (!fileSide) continue;
    const appSide = fileSide === pair.a ? pair.b : pair.a;
    if (focus.has(appSide) || !appById.has(appSide) || matchedIds.has(appSide) || !editable(appSide)) continue;
    const ref = fileSide.slice(FILE_GROUP.length + 1);
    const fp = filePeople.get(ref)!;
    const ap = appById.get(appSide)!;
    const gp = graph.persons.get(appSide)!;
    const list = result.byRef.get(ref) ?? [];
    list.push({
      personId: appSide,
      label: [[gp.givenName, gp.familyName].filter(Boolean).join(" "), life(ap.birth, ap.death)].filter(Boolean).join(" "),
      origin: originOf(ap),
      confidence: pair.confidence,
      cls: suggestionClass(pair),
      score: pair.score,
      sentence: evidenceSentence(pair.reasons),
      conflicts: pair.conflicts,
      differences: pairDifferences(fp, ap),
      viaRelative: pair.viaRelative,
      onlyBridge: Boolean(pair.bridge?.only),
    });
    result.byRef.set(ref, list);
  }
  for (const [ref, list] of result.byRef) {
    list.sort((x, y) => SUGGESTION_CLASS_RANK[x.cls] - SUGGESTION_CLASS_RANK[y.cls] || y.score - x.score || x.personId.localeCompare(y.personId));
    const top = list.slice(0, input.limit ?? MAX_SUGGESTIONS_PER_PERSON);
    result.byRef.set(ref, top);
    result.summary.persons[top[0].cls]++;
  }
  result.summary.durationMs = Math.round(performance.now() - started);
  return result;
}
