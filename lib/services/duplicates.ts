import { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, editableFamilyIds, viewableFamilyIds, type Scope } from "../scope";
import { fuzzyField } from "../dates";
import { findDuplicatePairs, scoreDuplicate, type Confidence, type DupPerson } from "../duplicates";
import { evidenceSentence } from "../import-linking";
import { firstGivenKey, nameKey } from "../name-keys";
import { MANUAL_ORIGIN_LABEL, toPersonBrief, type PersonBrief } from "./dto";
import { loadImportDirectory } from "./origin";
import { loadGraph, type LoadedGraph } from "./graph-data";
import { forbiddenError, notFoundError, validationError } from "./errors";
import { audit, auditActor } from "../audit";

/**
 * Mögliche Dubletten (Recherche-Seite, MCP find_possible_duplicates):
 * sichtbare Personen, bewertet nach lib/duplicates.ts — Namen samt
 * Geburtsname und Namensvarianten, Daten, Orte, Verwandte, Herkunft aus
 * verschiedenen Stammbäumen. Paare, die jemand als „kein Duplikat“ markiert
 * hat (DuplicateDismissal), erscheinen nicht mehr.
 */

export type DuplicateCandidate = {
  a: PersonBrief;
  b: PersonBrief;
  /** 0..1, höher = wahrscheinlicher dieselbe Person. */
  score: number;
  confidence: Confidence;
  reasons: string[];
  /** Widersprüche (verschiedene Sterbedaten, verschiedene Eltern …). */
  conflicts: string[];
  /** Aus verschiedenen Quell-Bäumen importiert. */
  crossTree: boolean;
  /** Darf der Benutzer beide bearbeiten (und damit zusammenführen)? */
  canMerge: boolean;
};

export type DuplicateList = {
  total: number;
  counts: Record<Confidence, number>;
  /** Als „kein Duplikat“ markierte Paare unter den sichtbaren Personen. */
  dismissed: number;
  items: DuplicateCandidate[];
};

const relKey = (p: { givenName: string; familyName: string | null } | undefined) =>
  p ? `${nameKey(p.givenName)} ${nameKey(p.familyName)}`.trim() : "";

/** Spalten einer Person, die der Vergleich braucht (dazu die Datumsfelder für fuzzyField). */
type DupSource = Pick<DupPerson, "id" | "givenName" | "familyName" | "birthName" | "gender" | "birthPlace">;

/**
 * Eine Person in der Form für lib/duplicates.ts — eine Stelle für die
 * Gesamtliste (loadDuplicatePeople) und die Kandidaten einer einzelnen Person
 * (listDuplicatesOfPerson), damit beide dasselbe vergleichen.
 */
function toDupPerson(
  p: DupSource,
  rel: { parents: string[]; partners: string[]; children: string[] },
  relName: (id: string) => string,
  variants: DupPerson["variants"],
  trees: string[],
): DupPerson {
  return {
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    birthName: p.birthName,
    gender: p.gender,
    birth: fuzzyField(p, "birthDate"),
    death: fuzzyField(p, "deathDate"),
    birthPlace: p.birthPlace,
    variants,
    parents: rel.parents,
    partners: rel.partners,
    children: rel.children,
    parentNames: rel.parents.map(relName).filter(Boolean),
    partnerNames: rel.partners.map(relName).filter(Boolean),
    trees,
  };
}

/** Vergleichsdaten aller sichtbaren Personen (ein Ladevorgang, wenige Abfragen). */
export async function loadDuplicatePeople(scope: Scope, graph?: LoadedGraph): Promise<{ graph: LoadedGraph; people: DupPerson[] }> {
  const g = graph ?? (await loadGraph(scope));
  const visible = [...g.persons.values()].filter((p) => p.visible);
  const ids = visible.map((p) => p.id);
  const [names, links] = await Promise.all([
    prisma.personName.findMany({ where: { personId: { in: ids } }, select: { personId: true, givenName: true, familyName: true } }),
    prisma.importLink.findMany({ where: { personId: { in: ids }, sourceTreeId: { not: null } }, select: { personId: true, sourceTreeId: true } }),
  ]);
  const namesOf = new Map<string, { givenName: string | null; familyName: string | null }[]>();
  for (const n of names) namesOf.set(n.personId, [...(namesOf.get(n.personId) ?? []), n]);
  const treesOf = new Map<string, Set<string>>();
  for (const l of links) treesOf.set(l.personId!, new Set([...(treesOf.get(l.personId!) ?? []), l.sourceTreeId!]));

  const people: DupPerson[] = visible.map((p) =>
    toDupPerson(
      p,
      {
        parents: (g.index.parentsOf.get(p.id) ?? []).map((e) => e.from),
        partners: (g.index.partnersOf.get(p.id) ?? []).map((e) => (e.from === p.id ? e.to : e.from)),
        children: (g.index.childrenOf.get(p.id) ?? []).map((e) => e.to),
      },
      (id) => relKey(g.persons.get(id)),
      namesOf.get(p.id) ?? [],
      [...(treesOf.get(p.id) ?? [])],
    ),
  );
  return { graph: g, people };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Mögliche Dubletten, nach Klasse („sicher“ zuerst) und Punkten sortiert,
 * seitenweise. `confidence` filtert auf eine Klasse.
 */
export async function listDuplicateCandidates(
  scope: Scope,
  options: { offset?: number; limit?: number; confidence?: Confidence; minScore?: number; maxYearDiff?: number } = {},
): Promise<DuplicateList> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 25)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const maxYearDiff = Math.max(0, Math.min(10, options.maxYearDiff ?? 2));
  const { graph, people } = await loadDuplicatePeople(scope);
  const ids = people.map((p) => p.id);
  const dismissedRows = await prisma.duplicateDismissal.findMany({
    where: { personAId: { in: ids }, personBId: { in: ids } },
    select: { personAId: true, personBId: true },
  });
  const dismissed = new Set(dismissedRows.map((d) => pairKey(d.personAId, d.personBId)));
  const pairs = findDuplicatePairs(people, {
    maxYearDiff,
    minScore: options.minScore ?? 0.5,
    include: (a, b) => !dismissed.has(pairKey(a.id, b.id)),
  });
  const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const p of pairs) counts[p.confidence]++;
  const filtered = options.confidence ? pairs.filter((p) => p.confidence === options.confidence) : pairs;
  const items = filtered.slice(offset, offset + limit).map((p) => {
    const a = graph.persons.get(p.a)!;
    const b = graph.persons.get(p.b)!;
    return {
      a: toPersonBrief(a),
      b: toPersonBrief(b),
      score: p.score,
      confidence: p.confidence,
      reasons: p.reasons,
      conflicts: p.conflicts,
      crossTree: p.crossTree,
      canMerge: canEditPerson(scope, a.familyIds) && canEditPerson(scope, b.familyIds),
    };
  });
  return { total: filtered.length, counts, dismissed: dismissedRows.length, items };
}

export type PersonDuplicateCandidate = {
  person: PersonBrief;
  /** Herkunft des Kandidaten: Importe („A · Anzeigename“; Dateiname nur für Administratoren) oder „von Hand erfasst“. */
  origin: string[];
  score: number;
  confidence: Confidence;
  reasons: string[];
  conflicts: string[];
  /** Die Gründe als ein Satz (evidenceSentence), für den Dialog „Zusammenführen …“. */
  sentence: string;
};

export type PersonDuplicates = {
  /** Alle Kandidaten, die der Benutzer mit dieser Person zusammenführen dürfte. */
  total: number;
  /** Die ersten `limit`: „sicher“ zuerst, dann nach Punkten. */
  items: PersonDuplicateCandidate[];
};

const NO_DUPLICATES: PersonDuplicates = { total: 0, items: [] };

/** Namen und Geschlecht — genug, um die meisten Personen ohne weiteres Laden auszuschließen. */
const SLIM_SELECT = { id: true, givenName: true, familyName: true, birthName: true, gender: true, birthPlace: true } as const;

const DUP_SELECT = {
  ...SLIM_SELECT,
  birthDate: true,
  deathDate: true,
  birthDatePrecision: true,
  birthDateQualifier: true,
  deathDatePrecision: true,
  deathDateQualifier: true,
  birthDateTo: true,
  birthDateToPrecision: true,
  deathDateTo: true,
  deathDateToPrecision: true,
  families: { select: { familyId: true } },
  names: { select: { givenName: true, familyName: true } },
} as const;

/**
 * Mögliche Dubletten EINER Person (Hinweis auf der Personenseite) — dieselbe
 * Bewertung, Schwelle und „kein Duplikat“-Ausnahme wie die Gesamtliste
 * (findDuplicatePairs mit scoreDuplicate, Standardwerte), davon nur die
 * Klassen „sicher“ und „wahrscheinlich“, und ohne den ganzen
 * Graphen zu laden: erst von allen bearbeitbaren Personen nur Namen und
 * Geschlecht (der Blockschlüssel — erster Vorname in Vergleichsform — lässt
 * sich in SQL nicht bilden), dann vollständig nur die wenigen mit gleichem
 * erstem Vornamen und passendem Nachnamen samt ihren Beziehungen.
 *
 * Rechte: Kandidaten gibt es nur, wenn der Benutzer die Person selbst UND den
 * Kandidaten bearbeiten darf (wie `canMerge` in der Liste). Alle anderen
 * erfahren nichts — auch keine Anzahl.
 */
export async function listDuplicatesOfPerson(
  scope: Scope,
  personId: string,
  options: {
    limit?: number;
    /**
     * Auch die Klasse „unklar“ — nur für den Dialog „Zusammenführen …“, den
     * jemand ausdrücklich öffnet. Der Hinweis auf der Seite bleibt ohne.
     */
    includeUnclear?: boolean;
  } = {},
): Promise<PersonDuplicates> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 3)));
  const self = await prisma.person.findUnique({
    where: { id: personId },
    select: { ...SLIM_SELECT, families: { select: { familyId: true } }, names: { select: { givenName: true, familyName: true } } },
  });
  if (!self || !canEditPerson(scope, self.families.map((f) => f.familyId))) return NO_DUPLICATES;
  const keys = new Set([self.givenName, ...self.names.map((n) => n.givenName)].map(firstGivenKey).filter(Boolean));
  if (keys.size === 0) return NO_DUPLICATES;

  // 1. Schmal: von allen bearbeitbaren Personen nur Namen und Geschlecht.
  //    Übrig bleibt, wer denselben ersten Vornamen hat (Hauptname oder
  //    Variante) und für scoreDuplicate allein nach Namen und Geschlecht in
  //    Frage kommt — Daten und Verwandte können danach nur noch ausschließen.
  //    Der SQL-Filter grenzt nur vor; entschieden wird unten mit canEditPerson.
  const editable = scope.isAdmin ? {} : { families: { some: { familyId: { in: editableFamilyIds(scope) } } } };
  const [slim, slimNames] = await Promise.all([
    prisma.person.findMany({ where: { id: { not: personId }, ...editable }, select: SLIM_SELECT }),
    prisma.personName.findMany({
      where: { personId: { not: personId }, ...(scope.isAdmin ? {} : { person: editable }) },
      select: { personId: true, givenName: true, familyName: true },
    }),
  ]);
  const variantsOf = new Map<string, DupPerson["variants"]>();
  for (const n of slimNames) variantsOf.set(n.personId, [...(variantsOf.get(n.personId) ?? []), n]);
  const namesOnly = (p: DupSource, variants: DupPerson["variants"]) =>
    toDupPerson(p, { parents: [], partners: [], children: [] }, () => "", variants, []);
  const selfNames = namesOnly(self, self.names);
  const candidateIds = new Set<string>();
  for (const p of slim) {
    const variants = variantsOf.get(p.id) ?? [];
    if (!keys.has(firstGivenKey(p.givenName)) && !variants.some((v) => keys.has(firstGivenKey(v.givenName)))) continue;
    if (scoreDuplicate(selfNames, namesOnly(p, variants))) candidateIds.add(p.id);
  }
  if (candidateIds.size === 0) return NO_DUPLICATES;

  // 2. Vollständig nur diese Personen und ihre Beziehungen; dazu, welche
  //    Kandidaten eingetragene Vorfahren bzw. Nachkommen sind.
  const ids = [personId, ...candidateIds];
  const [rows, rels, links, dismissedRows, lineal] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: ids } }, select: DUP_SELECT }),
    prisma.relationship.findMany({
      where: { OR: [{ fromPersonId: { in: ids } }, { toPersonId: { in: ids } }] },
      select: { type: true, fromPersonId: true, toPersonId: true },
    }),
    prisma.importLink.findMany({
      where: { personId: { in: ids } },
      select: { personId: true, sourceTreeId: true },
    }),
    prisma.duplicateDismissal.findMany({
      where: { OR: [{ personAId: personId }, { personBId: personId }] },
      select: { personAId: true, personBId: true },
    }),
    linealRelatives(scope, personId, [...candidateIds]),
  ]);
  const rowOf = new Map(rows.filter((r) => canEditPerson(scope, r.families.map((f) => f.familyId))).map((r) => [r.id, r]));
  if (!rowOf.has(personId)) return NO_DUPLICATES;

  const relOf = new Map<string, { parents: string[]; partners: string[]; children: string[] }>();
  const rel = (id: string) => {
    let x = relOf.get(id);
    if (!x) relOf.set(id, (x = { parents: [], partners: [], children: [] }));
    return x;
  };
  for (const r of rels) {
    if (r.type === "PARENT_OF") {
      rel(r.toPersonId).parents.push(r.fromPersonId);
      rel(r.fromPersonId).children.push(r.toPersonId);
    } else {
      rel(r.fromPersonId).partners.push(r.toPersonId);
      rel(r.toPersonId).partners.push(r.fromPersonId);
    }
  }
  // Namen der Eltern und Partner — nur als Vergleichsform, sie verlassen den Dienst nicht.
  const nameRows = new Map<string, { givenName: string; familyName: string | null }>(rows.map((r) => [r.id, r]));
  const missing = new Set<string>();
  for (const id of rowOf.keys()) for (const x of [...rel(id).parents, ...rel(id).partners]) if (!nameRows.has(x)) missing.add(x);
  if (missing.size) {
    const more = await prisma.person.findMany({ where: { id: { in: [...missing] } }, select: { id: true, givenName: true, familyName: true } });
    for (const r of more) nameRows.set(r.id, r);
  }
  const treesOf = new Map<string, Set<string>>();
  const originOf = new Map<string, Set<string>>();
  const importDir = await loadImportDirectory(links.map((l) => l.sourceTreeId));
  for (const l of links) {
    if (l.sourceTreeId) treesOf.set(l.personId!, new Set([...(treesOf.get(l.personId!) ?? []), l.sourceTreeId]));
    originOf.set(l.personId!, new Set([...(originOf.get(l.personId!) ?? []), importDir.label(scope, l.sourceTreeId)]));
  }

  const people = [...rowOf.values()].map((r) => toDupPerson(r, rel(r.id), (id) => relKey(nameRows.get(id)), r.names, [...(treesOf.get(r.id) ?? [])]));
  const dismissed = new Set(dismissedRows.map((d) => pairKey(d.personAId, d.personBId)));
  // Der Hinweis nennt nur „sicher“ und „wahrscheinlich“: Die Klasse „unklar“
  // bleibt der Dublettenliste vorbehalten, damit er nicht wegen schwacher
  // Treffer auf vielen Seiten steht. Strenger als die Liste, nie lockerer.
  const pairs = findDuplicatePairs(people, {
    include: (a, b) => (a.id === personId || b.id === personId) && !dismissed.has(pairKey(a.id, b.id)),
    // Alle Paare enthalten diese Person (include) — Abstammung aus der Abfrage oben.
    lineage: (a, b) => lineal.has(a === personId ? b : a),
  }).filter((p) => options.includeUnclear || p.confidence !== "low");
  return {
    total: pairs.length,
    items: pairs.slice(0, limit).map((p) => {
      const otherId = p.a === personId ? p.b : p.a;
      return {
        person: toPersonBrief(rowOf.get(otherId)!),
        origin: [...(originOf.get(otherId) ?? [MANUAL_ORIGIN_LABEL])],
        score: p.score,
        confidence: p.confidence,
        reasons: p.reasons,
        conflicts: p.conflicts,
        sentence: evidenceSentence(p.reasons),
      };
    }),
  };
}

/**
 * Welche der `candidateIds` sind eingetragene Vorfahren oder Nachkommen von
 * `personId` (alle Eltern-Kind-Kanten, beliebig viele Generationen)? Eine
 * rekursive Abfrage statt des ganzen Graphen — der Hinweis lädt bewusst nur
 * wenige Personen. Die Kette läuft wie in der Gesamtliste (lineageOf über die
 * sichtbaren Personen) nur über Personen, die der Benutzer sehen darf: Liste
 * und Hinweis liefern so dieselben Paare, und das Fehlen eines Kandidaten
 * verrät keine verborgene Abstammung. `UNION` (statt `UNION ALL`) beendet die
 * Rekursion auch bei fehlerhaften Kreisen.
 */
async function linealRelatives(scope: Scope, personId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  // Sichtbar: Administrator, sonst mindestens eine eigene Familie (wie personVisibilityFilter).
  const visible = (column: Prisma.Sql) =>
    scope.isAdmin
      ? Prisma.sql`TRUE`
      : Prisma.sql`EXISTS (SELECT 1 FROM "PersonFamily" pf WHERE pf."personId" = ${column} AND pf."familyId" = ANY(${viewableFamilyIds(scope)}::text[]))`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE
      up(id) AS (
        SELECT r."fromPersonId" FROM "Relationship" r
        WHERE r."toPersonId" = ${personId} AND r."type" = 'PARENT_OF' AND ${visible(Prisma.sql`r."fromPersonId"`)}
        UNION
        SELECT r."fromPersonId" FROM "Relationship" r JOIN up ON r."toPersonId" = up.id
        WHERE r."type" = 'PARENT_OF' AND ${visible(Prisma.sql`r."fromPersonId"`)}
      ),
      down(id) AS (
        SELECT r."toPersonId" FROM "Relationship" r
        WHERE r."fromPersonId" = ${personId} AND r."type" = 'PARENT_OF' AND ${visible(Prisma.sql`r."toPersonId"`)}
        UNION
        SELECT r."toPersonId" FROM "Relationship" r JOIN down ON r."fromPersonId" = down.id
        WHERE r."type" = 'PARENT_OF' AND ${visible(Prisma.sql`r."toPersonId"`)}
      )
    SELECT id FROM up WHERE id = ANY(${candidateIds}::text[])
    UNION
    SELECT id FROM down WHERE id = ANY(${candidateIds}::text[])`;
  return new Set(rows.map((r) => r.id));
}

async function assertBothEditable(scope: Scope, aId: string, bId: string) {
  if (aId === bId) throw validationError([{ path: "b", message: "Zwei verschiedene Personen angeben" }]);
  const rows = await prisma.person.findMany({ where: { id: { in: [aId, bId] } }, select: { id: true, families: { select: { familyId: true } } } });
  if (rows.length !== 2) throw notFoundError("Person");
  for (const r of rows) if (!canViewPerson(scope, r.families.map((f) => f.familyId))) throw notFoundError("Person");
  for (const r of rows) if (!canEditPerson(scope, r.families.map((f) => f.familyId))) throw forbiddenError("diese Personen zu bearbeiten");
}

/** Paar dauerhaft als „kein Duplikat“ markieren (Bearbeitungsrecht an beiden). */
export async function dismissDuplicate(scope: Scope, aId: string, bId: string): Promise<{ ok: true }> {
  await assertBothEditable(scope, aId, bId);
  const [personAId, personBId] = aId < bId ? [aId, bId] : [bId, aId];
  await prisma.duplicateDismissal.upsert({
    where: { personAId_personBId: { personAId, personBId } },
    create: { personAId, personBId, userId: scope.userId },
    update: {},
  });
  await audit({ ...auditActor(scope), action: "UPDATE", entityType: "Person", entityId: personAId, diff: { notDuplicateOf: personBId }, personIds: [personBId] });
  return { ok: true };
}

/** Markierung „kein Duplikat“ wieder aufheben. */
export async function undismissDuplicate(scope: Scope, aId: string, bId: string): Promise<{ ok: true }> {
  await assertBothEditable(scope, aId, bId);
  const [personAId, personBId] = aId < bId ? [aId, bId] : [bId, aId];
  await prisma.duplicateDismissal.deleteMany({ where: { personAId, personBId } });
  await audit({ ...auditActor(scope), action: "UPDATE", entityType: "Person", entityId: personAId, diff: { notDuplicateOfRemoved: personBId }, personIds: [personBId] });
  return { ok: true };
}
