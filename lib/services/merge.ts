import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, visibleFamilyIds, type Scope } from "../scope";
import { fuzzyColumns, fuzzyField, formatDateWithPhrase, formatFuzzyYear, type FuzzyDate } from "../dates";
import { scoreDuplicate, type DupPerson } from "../duplicates";
import { EVENT_TYPE_LABEL, PERSON_NAME_TYPE_LABEL } from "../events";
import { importFingerprint, type ImportEntity } from "../import-fingerprint";
import {
  citationKey,
  compareFields,
  eventKey,
  mergeNotes,
  MERGE_FIELDS,
  personNameKey,
  resolvePersonMerge,
  resolveRelationshipMerge,
  type AlternateFact,
  type FieldChoice,
  type FieldComparison,
  type MergeChoices,
  type MergeField,
  type NameDraft,
  type PersonValues,
  type RelationshipValues,
} from "../merge-rules";
import { personDateIssues, MAX_BIOLOGICAL_PARENTS, PARENT_SUBTYPES, PARTNER_SUBTYPES } from "../validation";
import { conflictError, forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { newId } from "./imports";
import { importLabel } from "./dto";
import { auditActor, auditData, fieldChanges } from "../audit";
import { nameChangeSet } from "../change-sets";

/**
 * Dubletten zusammenführen: Die Person `mergeId` geht in `keepId` auf.
 *
 * - `previewPersonMerge` sagt genau, was geschähe (Felder beider Seiten,
 *   Vorgaben, was umzieht, was zusammenfällt, was Zweitangabe wird, was
 *   blockiert) und schreibt nichts.
 * - `mergePersons` führt es in EINER Transaktion aus; doppeltes Absenden
 *   liefert das gespeicherte Ergebnis (Audit), statt zu scheitern.
 *
 * Rechte: Bearbeitungsrecht an BEIDEN Personen. Eine unsichtbare Person
 * ergibt „nicht gefunden“ (wie überall). Admins dürfen alles.
 *
 * Regeln der Hauptangaben: lib/merge-rules.ts. Untereinträge (Ereignisse,
 * Namensvarianten, Belege, Bilder, Familien, Fremdkennungen, Rohdaten,
 * Herkunft) ziehen um; gleiche fallen zusammen (Belege, Herkunft und
 * Fremdkennungen beider bleiben am verbleibenden Eintrag). Beziehungen werden
 * umgehängt; gleiche Beziehungen (dieselben zwei Personen, gleicher Typ)
 * fallen zusammen (resolveRelationshipMerge). Was die Regeln der App
 * verletzen würde (Beziehung zwischen den beiden, mehr als zwei leibliche
 * Eltern, Zyklus, Partner und zugleich Elternteil, Tod vor Geburt), blockiert
 * schon die Vorschau — mit Erklärung.
 *
 * Herkunft (ImportLink): Die Links der aufgehenden Person und ihrer
 * Untereinträge ziehen mit um (mergedFromId/mergedAt), damit ein erneuter
 * Import ihres Quell-Baums die bleibende Person aktualisiert statt die
 * aufgegangene neu anzulegen. Weil der Fingerabdruck auch die Träger-IDs
 * enthält (personId, fromPersonId …), wird er beim Umhängen auf die neuen IDs
 * umgerechnet — aber nur, wenn der Eintrag seit dem Import unverändert war;
 * sonst bleibt er „in der App geändert“. Für die Hauptangaben ergibt sich
 * „in der App geändert“ von selbst: Wer verloren hat, dessen Link-Hash passt
 * nicht mehr zum neuen Stand.
 */

type Db = Prisma.TransactionClient;

export const mergeInputSchema = z.object({
  keepId: z.string().min(1).max(100),
  mergeId: z.string().min(1).max(100),
  choices: z.record(z.enum(MERGE_FIELDS), z.enum(["keep", "other", "both"])).default({}),
  /** Art einer zusammenfallenden Beziehung, je ID der bleibenden Beziehung. */
  relationshipSubtypes: z.record(z.enum([...PARENT_SUBTYPES, ...PARTNER_SUBTYPES] as [string, ...string[]])).default({}),
  /** Kennung des Stands aus der Vorschau; abweichend → Konflikt statt Überraschung. */
  expectedToken: z.string().max(100).optional().nullable(),
});
export type MergeInput = z.input<typeof mergeInputSchema>;

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

const linkSelect = { select: { id: true, importHash: true, sourceTreeId: true, externalKey: true, mergedFromId: true } } as const;
const eventInclude = {
  importLinks: linkSelect,
  externalIds: { select: { id: true, system: true, value: true, batchId: true } },
  citations: { include: { importLinks: linkSelect } },
} as const;

async function loadPersonBundle(db: Db | typeof prisma, id: string) {
  return db.person.findUnique({
    where: { id },
    include: {
      families: { select: { familyId: true, family: { select: { name: true } } } },
      names: { include: { importLinks: linkSelect } },
      events: { include: eventInclude },
      citations: { where: { eventId: null }, include: { importLinks: linkSelect } },
      media: true,
      externalIds: { select: { id: true, system: true, value: true, batchId: true } },
      rawRecords: { select: { id: true, recordType: true, batchId: true, supersededAt: true } },
      importLinks: {
        select: { id: true, importHash: true, sourceTreeId: true, externalKey: true, mergedFromId: true, lastBatch: { select: { fileName: true, createdAt: true } } },
      },
      dismissedAsA: { select: { personBId: true } },
      dismissedAsB: { select: { personAId: true } },
    },
  });
}
type PersonBundle = NonNullable<Awaited<ReturnType<typeof loadPersonBundle>>>;

const personSel = {
  select: {
    id: true,
    givenName: true,
    familyName: true,
    birthName: true,
    gender: true,
    birthDate: true,
    birthDatePrecision: true,
    birthDateQualifier: true,
    birthDateTo: true,
    birthDateToPrecision: true,
    deathDate: true,
    deathDatePrecision: true,
    deathDateQualifier: true,
    deathDateTo: true,
    deathDateToPrecision: true,
    birthPlace: true,
    families: { select: { familyId: true } },
  },
} as const;

async function loadRelationships(db: Db | typeof prisma, ids: string[]) {
  return db.relationship.findMany({
    where: { OR: [{ fromPersonId: { in: ids } }, { toPersonId: { in: ids } }] },
    include: {
      events: { include: eventInclude },
      citations: { where: { eventId: null }, include: { importLinks: linkSelect } },
      media: true,
      externalIds: { select: { id: true, system: true, value: true, batchId: true } },
      rawRecords: { select: { id: true } },
      importLinks: linkSelect,
      fromPerson: personSel,
      toPerson: personSel,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
type RelBundle = Awaited<ReturnType<typeof loadRelationships>>[number];

export type MergeSnapshot = {
  keep: PersonBundle;
  other: PersonBundle;
  relationships: RelBundle[];
  /** Alle Eltern-Kind-Kanten (für Zyklen); vom Massen-Zusammenführen geteilt. */
  parentEdges: { from: string; to: string }[];
};

export async function loadMergeSnapshot(
  db: Db | typeof prisma,
  keepId: string,
  mergeId: string,
  parentEdges?: { from: string; to: string }[],
): Promise<MergeSnapshot | null> {
  const [keep, other] = await Promise.all([loadPersonBundle(db, keepId), loadPersonBundle(db, mergeId)]);
  if (!keep || !other) return null;
  const relationships = await loadRelationships(db, [keepId, mergeId]);
  const edges =
    parentEdges ??
    (await db.relationship.findMany({ where: { type: "PARENT_OF" }, select: { fromPersonId: true, toPersonId: true } })).map((r) => ({
      from: r.fromPersonId,
      to: r.toPersonId,
    }));
  return { keep, other, relationships, parentEdges: edges };
}

// ---------------------------------------------------------------------------
// Plan (rein: aus Snapshot und Wahl)
// ---------------------------------------------------------------------------

export type MergeBlocker = {
  code: "RELATED" | "BIO_PARENTS" | "CYCLE" | "PARTNER_AND_PARENT" | "DATES" | "SAME";
  message: string;
  /** Personen, die zuerst zusammengeführt werden könnten (IDs, nur sichtbare), bestes Paar zuerst. */
  suggestPairs?: [string, string][];
  /** Dieselben Paare mit Beschriftung („Anna X (*1820) ↔ Anna Y (*1821) vergleichen“). */
  suggestions?: { a: string; b: string; label: string }[];
};

type RelMove = { rel: RelBundle; from: string; to: string };
type RelCollapse = {
  survivor: RelBundle;
  removed: RelBundle;
  patch: Record<string, unknown>;
  alternates: AlternateFact[];
  dropped: string[];
  label: string;
};

export type MergePlan = {
  snapshot: MergeSnapshot;
  fields: FieldComparison[];
  resolved: ReturnType<typeof resolvePersonMerge>;
  moves: RelMove[];
  collapses: RelCollapse[];
  blockers: MergeBlocker[];
  /** Stand der beiden Personen samt Untereinträgen (für expectedToken). */
  token: string;
};

const personName = (p: { givenName: string; familyName: string | null }) => [p.givenName, p.familyName].filter(Boolean).join(" ");

/**
 * Unterscheidungsmerkmal eines Eintrags in Sätzen: Dubletten heißen fast
 * immer gleich — deshalb „der bleibende“/„der andere Eintrag“ mit
 * Lebensdaten, den Namen nur, wenn er sich unterscheidet. „ (*02.04.1801, †1870)“
 */
export function entryTag(p: PersonValues & { familyName?: unknown }, other: PersonValues): string {
  const differs = personName(p as never) !== personName(other as never);
  const birth = formatDateWithPhrase(fuzzyField(p, "birthDate"), (p.birthDatePhrase as string | null) ?? null);
  const death = formatDateWithPhrase(fuzzyField(p, "deathDate"), (p.deathDatePhrase as string | null) ?? null);
  const bits = [differs ? `„${personName(p as never)}“` : null, birth ? `*${birth}` : null, death ? `†${death}` : null].filter(Boolean);
  return bits.length ? ` (${bits.join(", ")})` : "";
}
/** Rollen-Bezeichnungen beider Einträge (Nominativ, Dativ). */
function roleLabels(keep: PersonValues, other: PersonValues) {
  const k = entryTag(keep, other);
  const o = entryTag(other, keep);
  return {
    keep: `der bleibende Eintrag${k}`,
    other: `der andere Eintrag${o}`,
    keepDat: `dem bleibenden Eintrag${k}`,
    otherDat: `dem anderen Eintrag${o}`,
    keepTag: k,
    otherTag: o,
  };
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Name für Meldungen — nicht sichtbare Personen bleiben ungenannt. */
function nameFor(scope: Scope, p: { givenName: string; familyName: string | null; families: { familyId: string }[] }) {
  return canViewPerson(scope, p.families.map((f) => f.familyId)) ? `„${personName(p)}“` : "eine nicht freigegebene Person";
}

function stateToken(s: MergeSnapshot): string {
  const h = createHash("sha256");
  for (const p of [s.keep, s.other]) {
    h.update(`${p.id}|${p.updatedAt.toISOString()}|`);
    h.update(p.names.map((n) => n.id).join(",") + "|" + p.events.map((e) => `${e.id}@${e.updatedAt.toISOString()}`).join(","));
    h.update(p.citations.map((c) => c.id).join(",") + "|" + p.media.map((m) => m.mediaId).join(",") + "|" + p.families.map((f) => f.familyId).join(","));
  }
  h.update(s.relationships.map((r) => `${r.id}:${r.subtype}:${r.fromPersonId}:${r.toPersonId}`).join(","));
  return h.digest("hex").slice(0, 32);
}

function ancestors(edges: { from: string; to: string }[], start: string[]): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  return walk(parents, start);
}
function descendants(edges: { from: string; to: string }[], start: string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  return walk(children, start);
}
function walk(next: Map<string, string[]>, start: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of next.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen;
}

export function planMerge(
  scope: Scope,
  snapshot: MergeSnapshot,
  input: { choices?: MergeChoices; relationshipSubtypes?: Record<string, string> },
): MergePlan {
  const { keep, other, relationships } = snapshot;
  const K = keep.id;
  const X = other.id;
  const blockers: MergeBlocker[] = [];
  if (K === X) blockers.push({ code: "SAME", message: "Eine Person lässt sich nicht mit sich selbst zusammenführen." });

  const existingNames = [...keep.names, ...other.names].map((n) => ({ type: n.type, givenName: n.givenName, familyName: n.familyName }));
  const role = roleLabels(keep as unknown as PersonValues, other as unknown as PersonValues);
  const resolved = resolvePersonMerge(keep as unknown as PersonValues, other as unknown as PersonValues, input.choices ?? {}, existingNames, {
    keep: role.keepDat,
    other: role.otherDat,
  });
  const fields = compareFields(keep as unknown as PersonValues, other as unknown as PersonValues).map((f) => ({ ...f, choice: resolved.choices[f.field] }));

  const dateIssues = personDateIssues({
    birthDate: fuzzyColumnsToDate(resolved.columns, "birthDate"),
    deathDate: fuzzyColumnsToDate(resolved.columns, "deathDate"),
  });
  for (const i of dateIssues) {
    blockers.push({ code: "DATES", message: `Die gewählten Daten passen nicht zusammen: ${i.message}. Bitte bei Geburts- oder Sterbedatum die andere Angabe wählen.` });
  }

  // Beziehungen zwischen den beiden
  for (const r of relationships) {
    const ends = [r.fromPersonId, r.toPersonId];
    if (ends.includes(K) && ends.includes(X)) {
      blockers.push({
        code: "RELATED",
        message:
          r.type === "PARTNER_OF"
            ? "Die beiden Einträge sind als Partner eingetragen — eine Person kann nicht ihr eigener Partner sein. Bitte zuerst diese Partnerschaft prüfen und löschen, falls sie ein Erfassungsfehler ist."
            : "Die beiden Einträge sind als Elternteil und Kind eingetragen. Bitte zuerst diese Beziehung prüfen und löschen, falls sie ein Erfassungsfehler ist.",
      });
    }
  }

  // Umhängen und Zusammenfallen
  const keyOf = (type: string, a: string, b: string) => (type === "PARTNER_OF" ? `${type}|${[a, b].sort().join("|")}` : `${type}|${a}|${b}`);
  const keepRels = new Map<string, RelBundle>();
  for (const r of relationships) {
    const ends = [r.fromPersonId, r.toPersonId];
    if (ends.includes(K) && !ends.includes(X)) keepRels.set(keyOf(r.type, r.fromPersonId, r.toPersonId), r);
  }
  const moves: RelMove[] = [];
  const collapses: RelCollapse[] = [];
  for (const r of relationships) {
    const ends = [r.fromPersonId, r.toPersonId];
    if (!ends.includes(X) || ends.includes(K)) continue;
    let from = r.fromPersonId === X ? K : r.fromPersonId;
    let to = r.toPersonId === X ? K : r.toPersonId;
    if (r.type === "PARTNER_OF" && from > to) [from, to] = [to, from];
    const survivor = keepRels.get(keyOf(r.type, from, to));
    if (!survivor) {
      moves.push({ rel: r, from, to });
      continue;
    }
    const res = resolveRelationshipMerge(
      survivor as unknown as RelationshipValues,
      r as unknown as RelationshipValues,
      input.relationshipSubtypes?.[survivor.id] ?? null,
    );
    const otherEnd = survivor.fromPersonId === K ? survivor.toPerson : survivor.fromPerson;
    const label =
      r.type === "PARTNER_OF"
        ? `Partnerschaft mit ${nameFor(scope, otherEnd)}`
        : survivor.fromPersonId === K
          ? `Eltern-Kind-Beziehung zum Kind ${nameFor(scope, otherEnd)}`
          : `Eltern-Kind-Beziehung zum Elternteil ${nameFor(scope, otherEnd)}`;
    collapses.push({ survivor, removed: r, ...res, label });
  }

  // Leibliche Eltern nach dem Zusammenführen — je Seite getrennt, damit ein
  // Elternteil, den beide schon gemeinsam haben, nicht als „verschieden“ gilt.
  const subtypeOf = (r: RelBundle) => {
    const c = collapses.find((x) => x.survivor.id === r.id || x.removed.id === r.id);
    return c ? ((c.patch.subtype as string | undefined) ?? c.survivor.subtype) : r.subtype;
  };
  const bioOf = (child: string) =>
    new Map(
      relationships
        .filter((r) => r.type === "PARENT_OF" && r.toPersonId === child && r.fromPersonId !== K && r.fromPersonId !== X && subtypeOf(r) === "BIOLOGICAL")
        .map((r) => [r.fromPersonId, r.fromPerson] as const),
    );
  const bioK = bioOf(K);
  const bioX = bioOf(X);
  const allBio = new Set([...bioK.keys(), ...bioX.keys()]);
  if (allBio.size > MAX_BIOLOGICAL_PARENTS) {
    type ParentP = RelBundle["fromPerson"];
    const visible = (pp: ParentP) => canViewPerson(scope, pp.families.map((f) => f.familyId));
    const roleOf = (pp: ParentP) => (pp.gender === "MALE" ? "Vater" : pp.gender === "FEMALE" ? "Mutter" : "Elternteil");
    const life = (pp: ParentP) => {
      const b = formatFuzzyYear(fuzzyField(pp, "birthDate"));
      const d = formatFuzzyYear(fuzzyField(pp, "deathDate"));
      return [b && `*${b}`, d && `†${d}`].filter(Boolean).join(" ");
    };
    const label = (pp: ParentP) => (visible(pp) ? `${personName(pp)}${life(pp) ? ` (${life(pp)})` : ""}` : "eine nicht freigegebene Person");
    const dup = (pp: ParentP): DupPerson => ({
      id: pp.id,
      givenName: pp.givenName,
      familyName: pp.familyName,
      birthName: pp.birthName,
      gender: pp.gender,
      birth: fuzzyField(pp, "birthDate"),
      death: fuzzyField(pp, "deathDate"),
      birthPlace: pp.birthPlace,
      variants: [],
      parents: [],
      partners: [],
      children: [],
      parentNames: [],
      partnerNames: [],
      trees: [],
    });
    const common = [...bioK.keys()].filter((id) => bioX.has(id)).map((id) => bioK.get(id)!);
    const keepOnly = [...bioK.values()].filter((pp) => !bioX.has(pp.id));
    const otherOnly = [...bioX.values()].filter((pp) => !bioK.has(pp.id));
    // Nur plausible Paare: gleiches (oder unbekanntes) Geschlecht und eine
    // Bewertung der Dublettenerkennung; bestes zuerst, jede Person einmal.
    const cands: { a: ParentP; b: ParentP; score: number }[] = [];
    for (const a of keepOnly) {
      for (const b of otherOnly) {
        if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) continue;
        const sc = scoreDuplicate(dup(a), dup(b));
        if (sc && sc.conflicts.length === 0) cands.push({ a, b, score: sc.score });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    const used = new Set<string>();
    const pairs = cands.filter((c) => {
      if (used.has(c.a.id) || used.has(c.b.id)) return false;
      used.add(c.a.id);
      used.add(c.b.id);
      return true;
    });
    const parts: string[] = [];
    if (common.length) {
      parts.push(`Beide Einträge haben ${common.map((pp) => `${label(pp)} als ${roleOf(pp)}`).join(" und ")}.`);
    }
    for (const c of pairs) {
      parts.push(
        `Als ${roleOf(c.a)} ist bei jedem Eintrag eine eigene Person eingetragen: ${label(c.a)} und ${label(c.b)} — vermutlich dieselbe Person, doppelt erfasst.`,
      );
    }
    if (pairs.length) {
      parts.push(
        pairs.length === 1
          ? "Führe zuerst diese beiden zusammen; danach geht auch dieses Paar."
          : "Führe zuerst diese Paare zusammen; danach geht auch dieses Paar.",
      );
    }
    const rest = [...keepOnly, ...otherOnly].filter((pp) => !used.has(pp.id));
    if (!pairs.length || allBio.size - pairs.length > MAX_BIOLOGICAL_PARENTS) {
      parts.push(
        `Zusammen wären es ${allBio.size} leibliche Elternteile (erlaubt sind ${MAX_BIOLOGICAL_PARENTS})` +
          (rest.length ? `; ${rest.map(label).join(", ")} ${rest.length === 1 ? "sieht" : "sehen"} nicht nach einem der anderen Elternteile aus` : "") +
          ". Dann ist meist die Art der Abstammung falsch erfasst (Adoption, Stief- oder Pflegeelternteil) — bitte sie bei einem der Einträge prüfen, statt Eltern zusammenzuführen.",
      );
    }
    const shown = pairs.filter((c) => visible(c.a) && visible(c.b));
    blockers.push({
      code: "BIO_PARENTS",
      message: parts.join(" "),
      suggestPairs: shown.map((c) => [c.a.id, c.b.id]),
      suggestions: shown.map((c) => ({ a: c.a.id, b: c.b.id, label: `${label(c.a)} ↔ ${label(c.b)} vergleichen` })),
    });
  }

  // Partner und zugleich Elternteil/Kind derselben Person
  const pairTypes = new Map<string, Set<string>>();
  for (const r of relationships) {
    const ends = [r.fromPersonId, r.toPersonId];
    if (ends.includes(K) && ends.includes(X)) continue;
    const otherId = ends.find((e) => e !== K && e !== X);
    if (!otherId) continue;
    const set = pairTypes.get(otherId) ?? new Set<string>();
    set.add(r.type);
    pairTypes.set(otherId, set);
  }
  for (const [otherId, types] of pairTypes) {
    if (types.size < 2) continue;
    const r = relationships.find((x) => x.fromPersonId === otherId || x.toPersonId === otherId)!;
    const p = r.fromPersonId === otherId ? r.fromPerson : r.toPerson;
    blockers.push({
      code: "PARTNER_AND_PARENT",
      message: `${nameFor(scope, p)} wäre danach zugleich Partner und Elternteil bzw. Kind der zusammengeführten Person. Bitte zuerst die falsche der beiden Beziehungen prüfen.`,
    });
  }

  // Zyklen: Vorfahre der einen und Nachfahre der anderen
  const edges = snapshot.parentEdges;
  const ancK = ancestors(edges, [K]);
  const ancX = ancestors(edges, [X]);
  if (!blockers.some((b) => b.code === "RELATED")) {
    if (ancK.has(X) || ancX.has(K)) {
      const [anc, desc] = ancK.has(X) ? [role.other, role.keepDat.replace(/^dem /, "des ").replace("bleibenden Eintrag", "bleibenden Eintrags")] : [role.keep, role.otherDat.replace(/^dem /, "des ").replace("anderen Eintrag", "anderen Eintrags")];
      blockers.push({ code: "CYCLE", message: `${cap(anc)} ist (über mehrere Generationen) Vorfahre ${desc} — zusammengeführt wäre die Person ihr eigener Vorfahre.` });
    } else {
      const desc = descendants(edges, [K, X]);
      const loop = [...ancK, ...ancX].find((id) => desc.has(id));
      if (loop) {
        blockers.push({
          code: "CYCLE",
          message: "Zusammengeführt wäre eine Person zugleich Vorfahre und Nachfahre der zusammengeführten Person (Zyklus im Stammbaum). Bitte die Eltern-Kind-Beziehungen beider Einträge prüfen.",
        });
      }
    }
  }

  return { snapshot, fields, resolved, moves, collapses, blockers, token: stateToken(snapshot) };
}

function fuzzyColumnsToDate(cols: Record<string, unknown>, key: "birthDate" | "deathDate"): FuzzyDate | null {
  const d = cols[key];
  if (!(d instanceof Date)) return null;
  return {
    date: d,
    precision: (cols[`${key}Precision`] as FuzzyDate["precision"]) ?? "DAY",
    qualifier: (cols[`${key}Qualifier`] as FuzzyDate["qualifier"]) ?? "EXACT",
    ...(cols[`${key}To`] instanceof Date ? { to: { date: cols[`${key}To`] as Date, precision: (cols[`${key}ToPrecision`] as FuzzyDate["precision"]) ?? "DAY" } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Zusammenfassung (ganze Sätze)
// ---------------------------------------------------------------------------

export type MergeSummary = {
  moves: { events: number; names: number; citations: number; media: number; relationships: number; externalIds: number; rawRecords: number; importLinks: number; families: number };
  collapses: { events: number; names: number; citations: number; media: number; relationships: number };
  alternates: { type: string; text: string }[];
  newNames: { type: string; text: string }[];
  dropped: string[];
  sentences: string[];
};

function altText(a: AlternateFact): string {
  return [formatDateWithPhrase(a.date, a.datePhrase), a.place, a.cause ? `Ursache: ${a.cause}` : null].filter(Boolean).join(", ") || "ohne Datum";
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizePlan(scope: Scope, plan: MergePlan): MergeSummary {
  const { keep, other } = plan.snapshot;
  const keepEventKeys = new Set(keep.events.map((e) => eventKey(e)));
  const keepNameKeys = new Set(keep.names.map((n) => personNameKey(n)));
  const keepCitationKeys = new Set(keep.citations.map((c) => citationKey(c)));
  const keepMedia = new Set(keep.media.map((m) => m.mediaId));
  const events = { move: 0, collapse: 0 };
  for (const e of other.events) events[keepEventKeys.has(eventKey(e)) ? "collapse" : "move"]++;
  const names = { move: 0, collapse: 0 };
  for (const n of other.names) names[keepNameKeys.has(personNameKey(n)) ? "collapse" : "move"]++;
  const citations = { move: 0, collapse: 0 };
  for (const c of other.citations) citations[keepCitationKeys.has(citationKey(c)) ? "collapse" : "move"]++;
  const eventCitations = other.events.reduce((n, e) => n + e.citations.length, 0);
  const media = { move: 0, collapse: 0 };
  for (const m of other.media) media[keepMedia.has(m.mediaId) ? "collapse" : "move"]++;
  const keepFamilies = new Set(keep.families.map((f) => f.familyId));
  const newFamilies = other.families.filter((f) => !keepFamilies.has(f.familyId));
  const visibleNew = newFamilies.filter((f) => scope.isAdmin || scope.families.has(f.familyId));

  const alternates = [
    ...plan.resolved.alternates.map((a) => ({ type: a.type, text: `${EVENT_TYPE_LABEL[a.type]}: ${altText(a)}` })),
    ...plan.collapses.flatMap((c) => c.alternates.map((a) => ({ type: a.type, text: `${EVENT_TYPE_LABEL[a.type]} (${c.label}): ${altText(a)}` }))),
  ];
  const newNames = plan.resolved.names.map((n: NameDraft) => ({
    type: n.type,
    text: `${PERSON_NAME_TYPE_LABEL[n.type]}: ${[n.prefix, n.givenName, n.nickname ? `„${n.nickname}“` : null, n.familyName, n.suffix].filter(Boolean).join(" ")}`,
  }));
  const dropped = [...plan.resolved.dropped, ...plan.collapses.flatMap((c) => c.dropped.map((d) => `${c.label}: ${d}`))];
  const role = roleLabels(keep as unknown as PersonValues, other as unknown as PersonValues);

  const s: string[] = [];
  s.push(`${cap(role.other)} geht im bleibenden Eintrag${role.keepTag} auf; danach gibt es nur noch diesen. Der andere Eintrag wird gelöscht, nachdem alles umgezogen ist.`);
  const moved = [
    events.move && plural(events.move, "Lebensereignis", "Lebensereignisse"),
    names.move && plural(names.move, "Namensvariante", "Namensvarianten"),
    citations.move + eventCitations && plural(citations.move + eventCitations, "Beleg", "Belege"),
    media.move && plural(media.move, "Bild", "Bilder"),
    plan.moves.length && plural(plan.moves.length, "Beziehung", "Beziehungen"),
  ].filter(Boolean) as string[];
  const taken = plan.fields.filter((f) => f.choice === "other" && f.other && f.other !== f.keep);
  if (taken.length) s.push(`Übernommen vom anderen Eintrag: ${taken.map((f) => `${f.label} (${f.other.length > 60 ? `${f.other.slice(0, 60)}…` : f.other})`).join(", ")}.`);
  if (plan.fields.some((f) => f.field === "notes" && f.choice === "both" && f.differs)) s.push("Die Notizen beider Einträge werden aneinandergehängt.");
  if (moved.length) s.push(`Vom anderen Eintrag ziehen um: ${moved.join(", ")}.`);
  const same = [
    events.collapse && plural(events.collapse, "gleiches Ereignis", "gleiche Ereignisse"),
    names.collapse && plural(names.collapse, "gleiche Namensvariante", "gleiche Namensvarianten"),
    citations.collapse && plural(citations.collapse, "gleicher Beleg", "gleiche Belege"),
    media.collapse && plural(media.collapse, "Bild, das beide haben", "Bilder, die beide haben"),
  ].filter(Boolean) as string[];
  if (same.length) s.push(`Doppelt Vorhandenes wird eins: ${same.join(", ")}.`);
  for (const c of plan.collapses) {
    s.push(`Die ${c.label} gibt es bei beiden — sie wird eine Beziehung; Ereignisse, Belege, Bilder und Herkunft beider bleiben daran.`);
  }
  for (const a of alternates) s.push(`Abweichende Angabe bleibt als Zweitangabe erhalten — ${a.text}.`);
  for (const n of newNames) s.push(`Der nicht gewählte Name bleibt als Namensvariante erhalten — ${n.text}.`);
  for (const d of dropped) s.push(d);
  if (visibleNew.length) {
    s.push(
      `Die Person gehört danach zusätzlich zu ${visibleNew.length === 1 ? "der Familie" : "den Familien"} ${visibleNew.map((f) => `„${f.family.name}“`).join(", ")} — wer diese Familien sehen darf, sieht die Person dann auch.`,
    );
  }
  const trees = new Set([...keep.importLinks, ...other.importLinks].map((l) => l.sourceTreeId ?? "?"));
  if (other.importLinks.length) {
    s.push(
      trees.size > 1
        ? `Beide Einträge stammen aus verschiedenen Importen. Die Herkunft bleibt vermerkt: Ein späterer Import jeder dieser Dateien erkennt die Person wieder und ergänzt sie, statt den anderen Eintrag neu anzulegen.`
        : `Die Herkunft bleibt vermerkt: Ein späterer Import erkennt die Person unter beiden Einträgen der Datei wieder.`,
    );
  }
  for (const b of plan.blockers) s.push(`Blockiert: ${b.message}`);

  return {
    moves: {
      events: events.move,
      names: names.move,
      citations: citations.move + eventCitations,
      media: media.move,
      relationships: plan.moves.length,
      externalIds: other.externalIds.length,
      rawRecords: other.rawRecords.length,
      importLinks: other.importLinks.length,
      families: newFamilies.length,
    },
    collapses: { events: events.collapse, names: names.collapse, citations: citations.collapse, media: media.collapse, relationships: plan.collapses.length },
    alternates,
    newNames,
    dropped,
    sentences: s,
  };
}

// ---------------------------------------------------------------------------
// Rechte
// ---------------------------------------------------------------------------

async function assertMergeRights(db: Db | typeof prisma, scope: Scope, keepId: string, mergeId: string) {
  const rows = await db.person.findMany({ where: { id: { in: [keepId, mergeId] } }, select: { id: true, families: { select: { familyId: true } } } });
  const fam = new Map(rows.map((r) => [r.id, r.families.map((f) => f.familyId)]));
  for (const id of [keepId, mergeId]) {
    const f = fam.get(id);
    if (!f || !canViewPerson(scope, f)) throw notFoundError("Person");
  }
  for (const id of [keepId, mergeId]) {
    if (!canEditPerson(scope, fam.get(id)!)) throw forbiddenError("diese Personen zusammenzuführen");
  }
}

// ---------------------------------------------------------------------------
// Vorschau
// ---------------------------------------------------------------------------

export type MergePersonSide = {
  id: string;
  name: string;
  values: Record<MergeField, string>;
  familyNames: string[];
  counts: { events: number; names: number; citations: number; media: number; relationships: number };
  /** Was hilft, zwei gleichnamige Einträge auseinanderzuhalten. */
  born: string | null;
  died: string | null;
  parents: string[];
  partners: string[];
  children: number;
  /** Importe (Datei und Datum; Dateinamen nur für Administratoren). */
  imports: string[];
  /** Herkunft: Stammbaum (Datei des letzten Imports) je Link. */
  provenance: { sourceTreeId: string | null; fileName: string | null; externalKey: string | null; merged: boolean }[];
};

export type MergePreview = {
  keep: MergePersonSide;
  other: MergePersonSide;
  fields: FieldComparison[];
  /** Zusammenfallende Beziehungen mit wählbarer Art. */
  relationshipChoices: { survivorId: string; label: string; keep: string; other: string; chosen: string; options: string[] }[];
  summary: MergeSummary;
  blockers: MergeBlocker[];
  canMerge: boolean;
  token: string;
};

function side(scope: Scope, p: PersonBundle, rels: RelBundle[]): MergePersonSide {
  const fact = (date: string, place: string | null) => [date, place].filter(Boolean).join(", ") || null;
  const mine = rels.filter((r) => r.fromPersonId === p.id || r.toPersonId === p.id);
  const parents = mine.filter((r) => r.type === "PARENT_OF" && r.toPersonId === p.id).map((r) => nameFor(scope, r.fromPerson).replace(/^„|“$/g, ""));
  const partners = mine
    .filter((r) => r.type === "PARTNER_OF")
    .map((r) => nameFor(scope, r.fromPersonId === p.id ? r.toPerson : r.fromPerson).replace(/^„|“$/g, ""));
  const children = mine.filter((r) => r.type === "PARENT_OF" && r.fromPersonId === p.id).length;
  const dateText = (k: "birthDate" | "deathDate") => formatDateWithPhrase(fuzzyField(p, k), p[`${k}Phrase`]);
  const imports = [...new Set(p.importLinks.map((l) => importLabel(scope, l.lastBatch)))];
  const values = Object.fromEntries(MERGE_FIELDS.map((f) => [f, ""])) as Record<MergeField, string>;
  const cmp = compareFields(p as unknown as PersonValues, p as unknown as PersonValues);
  for (const c of cmp) values[c.field] = c.keep;
  return {
    id: p.id,
    name: personName(p),
    values,
    familyNames: p.families.filter((f) => visibleFamilyIds(scope, [f.familyId]).length).map((f) => f.family.name),
    born: fact(dateText("birthDate"), p.birthPlace),
    died: fact(dateText("deathDate"), p.deathPlace),
    parents,
    partners,
    children,
    imports,
    counts: {
      events: p.events.length,
      names: p.names.length,
      citations: p.citations.length + p.events.reduce((n, e) => n + e.citations.length, 0),
      media: p.media.length,
      relationships: rels.filter((r) => r.fromPersonId === p.id || r.toPersonId === p.id).length,
    },
    provenance: scope.isAdmin
      ? p.importLinks.map((l) => ({ sourceTreeId: l.sourceTreeId, fileName: l.lastBatch?.fileName ?? null, externalKey: l.externalKey, merged: Boolean(l.mergedFromId) }))
      : p.importLinks.map((l) => ({ sourceTreeId: null, fileName: null, externalKey: null, merged: Boolean(l.mergedFromId) })),
  };
}

const SUBTYPE_LABEL: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "Adoption",
  STEP: "Stief",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
  PARTNER_UNKNOWN: "Ehestand unbekannt",
};

function toPreview(scope: Scope, plan: MergePlan): MergePreview {
  const { keep, other, relationships } = plan.snapshot;
  return {
    keep: side(scope, keep, relationships),
    other: side(scope, other, relationships),
    fields: plan.fields,
    relationshipChoices: plan.collapses
      .filter((c) => c.survivor.subtype !== c.removed.subtype)
      .map((c) => ({
        survivorId: c.survivor.id,
        label: c.label,
        keep: c.survivor.subtype,
        other: c.removed.subtype,
        chosen: (c.patch.subtype as string | undefined) ?? c.survivor.subtype,
        options: [c.survivor.subtype, c.removed.subtype].map((v) => v),
      })),
    summary: summarizePlan(scope, plan),
    blockers: plan.blockers,
    canMerge: plan.blockers.length === 0,
    token: plan.token,
  };
}

export { SUBTYPE_LABEL as MERGE_SUBTYPE_LABEL };

/** Was beim Zusammenführen geschähe — schreibt nichts. */
export async function previewPersonMerge(
  scope: Scope,
  keepId: string,
  mergeId: string,
  input: { choices?: MergeChoices; relationshipSubtypes?: Record<string, string> } = {},
): Promise<MergePreview> {
  await assertMergeRights(prisma, scope, keepId, mergeId);
  const parsed = parseOrThrow(mergeInputSchema.safeParse({ keepId, mergeId, ...input }));
  const snap = await loadMergeSnapshot(prisma, keepId, mergeId);
  if (!snap) throw notFoundError("Person");
  return toPreview(scope, planMerge(scope, snap, parsed));
}

// ---------------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------------

export type MergeResult = {
  keepId: string;
  mergedId: string;
  alreadyMerged: boolean;
  summary: MergeSummary;
  auditId: string | null;
};

/** Wie ein Datensatz eines Typs in der Tabelle ImportLink heißt. */
const LINK_COL: Record<ImportEntity, "personId" | "relationshipId" | "eventId" | "personNameId" | "citationId" | "sourceId" | "mediaId"> = {
  PERSON: "personId",
  RELATIONSHIP: "relationshipId",
  EVENT: "eventId",
  PERSON_NAME: "personNameId",
  CITATION: "citationId",
  SOURCE: "sourceId",
  MEDIA: "mediaId",
};

type Link = { id: string; importHash: string };

/**
 * Datensatz umhängen (neue Träger-IDs) und den Fingerabdruck seiner Links
 * auf die neuen IDs umrechnen, wenn er seit dem Import unverändert war.
 */
async function rebaseLinks(db: Db, entity: ImportEntity, before: Record<string, unknown>, after: Record<string, unknown>, links: Link[]) {
  if (!links.length) return;
  const old = importFingerprint(entity, before);
  const next = importFingerprint(entity, after);
  if (old === next) return;
  const ids = links.filter((l) => l.importHash === old).map((l) => l.id);
  if (ids.length) await db.importLink.updateMany({ where: { id: { in: ids } }, data: { importHash: next } });
}

/** Links eines wegfallenden Datensatzes an den bleibenden hängen (mit Herkunftsvermerk). */
async function moveLinks(
  db: Db,
  entity: ImportEntity,
  removed: Record<string, unknown> & { id: string },
  survivorId: string,
  idPatch: Record<string, unknown>,
  links: Link[],
  now: Date,
) {
  if (!links.length) return;
  const old = importFingerprint(entity, removed);
  const next = importFingerprint(entity, { ...removed, ...idPatch });
  const col = LINK_COL[entity];
  const unchanged = links.filter((l) => l.importHash === old).map((l) => l.id);
  const edited = links.filter((l) => l.importHash !== old).map((l) => l.id);
  if (unchanged.length) {
    await db.importLink.updateMany({ where: { id: { in: unchanged } }, data: { [col]: survivorId, mergedFromId: removed.id, mergedAt: now, importHash: next } });
  }
  if (edited.length) {
    await db.importLink.updateMany({ where: { id: { in: edited } }, data: { [col]: survivorId, mergedFromId: removed.id, mergedAt: now } });
  }
  await markMerged(db, entity, survivorId, now);
}

/** Eigene Links des bleibenden Datensatzes: „war an einem Zusammenführen beteiligt“. */
async function markMerged(db: Db, entity: ImportEntity, id: string, now: Date) {
  await db.importLink.updateMany({ where: { [LINK_COL[entity]]: id, mergedAt: null }, data: { mergedAt: now } });
}

/** Fremdkennungen umhängen; gleiche (System, Wert, Lauf) am Ziel fallen weg. */
async function moveExternalIds(
  db: Db,
  rows: { id: string; system: string; value: string; batchId: string | null }[],
  target: { personId?: string; relationshipId?: string; eventId?: string },
  existing: { system: string; value: string; batchId: string | null }[],
) {
  if (!rows.length) return;
  const have = new Set(existing.map((x) => `${x.system}|${x.value}|${x.batchId ?? ""}`));
  const dup = rows.filter((x) => have.has(`${x.system}|${x.value}|${x.batchId ?? ""}`)).map((x) => x.id);
  const move = rows.filter((x) => !dup.includes(x.id)).map((x) => x.id);
  if (dup.length) await db.externalId.deleteMany({ where: { id: { in: dup } } });
  if (move.length) await db.externalId.updateMany({ where: { id: { in: move } }, data: target });
}

type EventBundle = PersonBundle["events"][number];
type CitationBundle = PersonBundle["citations"][number];

/** Belege an einen neuen Träger hängen; gleiche fallen mit den vorhandenen zusammen. */
async function moveCitations(
  db: Db,
  rows: CitationBundle[],
  target: { personId: string | null; relationshipId: string | null; eventId: string | null },
  existing: CitationBundle[],
  now: Date,
) {
  const byKey = new Map(existing.map((c) => [citationKey({ ...c, eventId: target.eventId }), c]));
  for (const c of rows) {
    const after = { ...c, ...target };
    const same = byKey.get(citationKey(after));
    if (same) {
      await moveLinks(db, "CITATION", c, same.id, target, c.importLinks, now);
      await db.citation.delete({ where: { id: c.id } });
    } else {
      await db.citation.update({ where: { id: c.id }, data: target });
      await rebaseLinks(db, "CITATION", c, after, c.importLinks);
      byKey.set(citationKey(after), { ...c, ...target } as CitationBundle);
    }
  }
}

/** Ereignisse an einen neuen Träger hängen; gleiche fallen zusammen (Belege, Herkunft, Kennungen ziehen mit). */
async function moveEvents(
  db: Db,
  rows: EventBundle[],
  owner: { personId: string | null; relationshipId: string | null },
  existing: EventBundle[],
  now: Date,
) {
  const byKey = new Map(existing.map((e) => [eventKey(e), e]));
  for (const e of rows) {
    const same = byKey.get(eventKey(e));
    if (same) {
      const notes = mergeNotes(same.notes, e.notes);
      if ((notes ?? null) !== (same.notes ?? null)) await db.event.update({ where: { id: same.id }, data: { notes } });
      await moveCitations(db, e.citations, { ...owner, eventId: same.id }, same.citations, now);
      await moveExternalIds(db, e.externalIds, { eventId: same.id }, same.externalIds);
      await moveLinks(db, "EVENT", e, same.id, owner, e.importLinks, now);
      await db.event.delete({ where: { id: e.id } });
    } else {
      await db.event.update({ where: { id: e.id }, data: owner });
      await rebaseLinks(db, "EVENT", e, { ...e, ...owner }, e.importLinks);
      await moveCitations(db, e.citations, { ...owner, eventId: e.id }, [], now);
      byKey.set(eventKey(e), e);
    }
  }
}

function alternateRow(a: AlternateFact, owner: { personId: string | null; relationshipId: string | null }, note: string) {
  return {
    ...owner,
    type: a.type,
    isAlternative: true,
    ...fuzzyColumns("date", a.date),
    datePhrase: a.datePhrase,
    place: a.place,
    cause: a.cause,
    notes: note,
  };
}

async function createAlternates(db: Db, alts: AlternateFact[], owner: { personId: string | null; relationshipId: string | null }, existing: { [k: string]: unknown }[], labels: Record<"keep" | "other", string>) {
  const have = new Set(existing.map((e) => eventKey(e)));
  let n = 0;
  for (const a of alts) {
    const row = alternateRow(a, owner, `Abweichende Angabe von ${labels[a.from]} (beim Zusammenführen erhalten)`);
    const key = eventKey(row);
    if (have.has(key)) continue;
    have.add(key);
    await db.event.create({ data: row as Prisma.EventUncheckedCreateInput });
    n++;
  }
  return n;
}

async function executePlan(db: Db, scope: Scope, plan: MergePlan, input: z.infer<typeof mergeInputSchema>, now: Date): Promise<MergeResult> {
  const { keep, other } = plan.snapshot;
  const K = keep.id;
  const X = other.id;
  const summary = summarizePlan(scope, plan);
  const role = roleLabels(keep as unknown as PersonValues, other as unknown as PersonValues);
  const labels = { keep: role.keepDat, other: role.otherDat };

  // 1. Hauptangaben
  await db.person.update({ where: { id: K }, data: plan.resolved.columns as Prisma.PersonUpdateInput });

  // 2. Familien (Vereinigung)
  await db.personFamily.createMany({ data: other.families.map((f) => ({ personId: K, familyId: f.familyId })), skipDuplicates: true });

  // 3. Namensvarianten
  const nameByKey = new Map(keep.names.map((n) => [personNameKey(n), n]));
  for (const n of other.names) {
    const same = nameByKey.get(personNameKey(n));
    if (same) {
      const notes = mergeNotes(same.notes, n.notes);
      if ((notes ?? null) !== (same.notes ?? null)) await db.personName.update({ where: { id: same.id }, data: { notes } });
      await moveLinks(db, "PERSON_NAME", n, same.id, { personId: K }, n.importLinks, now);
      await db.personName.delete({ where: { id: n.id } });
    } else {
      await db.personName.update({ where: { id: n.id }, data: { personId: K } });
      await rebaseLinks(db, "PERSON_NAME", n, { ...n, personId: K }, n.importLinks);
      nameByKey.set(personNameKey(n), n);
    }
  }
  const maxOrder = Math.max(0, ...keep.names.map((n) => n.sortOrder), ...other.names.map((n) => n.sortOrder));
  let order = maxOrder;
  for (const d of plan.resolved.names) {
    const row = { personId: K, type: d.type, givenName: d.givenName, familyName: d.familyName, prefix: d.prefix, suffix: d.suffix, nickname: d.nickname, label: null };
    if (nameByKey.has(personNameKey(row))) continue;
    await db.personName.create({
      data: { ...row, sortOrder: ++order, notes: `Name von ${labels[d.from]} (beim Zusammenführen erhalten)` },
    });
    nameByKey.set(personNameKey(row), row as never);
  }

  // 4. Ereignisse, Belege, Zweitangaben
  await moveEvents(db, other.events, { personId: K, relationshipId: null }, keep.events, now);
  const keepEventsNow = await db.event.findMany({ where: { personId: K } });
  await createAlternates(db, plan.resolved.alternates, { personId: K, relationshipId: null }, keepEventsNow, labels);
  await moveCitations(db, other.citations, { personId: K, relationshipId: null, eventId: null }, keep.citations, now);

  // 5. Bilder: kein doppelter Verweis auf dasselbe Bild, ein Hauptbild
  const keepMedia = new Set(keep.media.map((m) => m.mediaId));
  const keepHasPrimary = keep.media.some((m) => m.isPrimary);
  let sort = Math.max(0, ...keep.media.map((m) => m.sortOrder));
  for (const m of other.media) {
    if (keepMedia.has(m.mediaId)) {
      if (m.isPrimary && !keepHasPrimary) await db.personMedia.update({ where: { personId_mediaId: { personId: K, mediaId: m.mediaId } }, data: { isPrimary: true } });
      continue;
    }
    await db.personMedia.create({ data: { personId: K, mediaId: m.mediaId, isPrimary: m.isPrimary && !keepHasPrimary, sortOrder: ++sort } });
  }
  await db.personMedia.deleteMany({ where: { personId: X } });

  // 6. Fremdkennungen, Rohdaten, Herkunft
  await moveExternalIds(db, other.externalIds, { personId: K }, keep.externalIds);
  await db.importRawRecord.updateMany({ where: { personId: X }, data: { personId: K } });
  if (other.importLinks.length) {
    await db.importLink.updateMany({ where: { personId: X }, data: { personId: K, mergedFromId: X, mergedAt: now } });
  }
  await markMerged(db, "PERSON", K, now);

  // 7. Beziehungen
  for (const m of plan.moves) {
    const before = m.rel as unknown as Record<string, unknown>;
    await db.relationship.update({ where: { id: m.rel.id }, data: { fromPersonId: m.from, toPersonId: m.to } });
    await rebaseLinks(db, "RELATIONSHIP", before, { ...before, fromPersonId: m.from, toPersonId: m.to }, m.rel.importLinks);
  }
  for (const c of plan.collapses) {
    const S = c.survivor;
    const R = c.removed;
    const relLabels = { keep: "der bleibenden Beziehung", other: "der zusammengeführten Beziehung" };
    if (Object.keys(c.patch).length) await db.relationship.update({ where: { id: S.id }, data: c.patch as Prisma.RelationshipUpdateInput });
    await moveEvents(db, R.events, { personId: null, relationshipId: S.id }, S.events, now);
    const relEvents = await db.event.findMany({ where: { relationshipId: S.id } });
    await createAlternates(db, c.alternates, { personId: null, relationshipId: S.id }, relEvents, relLabels);
    await moveCitations(db, R.citations, { personId: null, relationshipId: S.id, eventId: null }, S.citations, now);
    const sMedia = new Set(S.media.map((m) => m.mediaId));
    const sPrimary = S.media.some((m) => m.isPrimary);
    for (const m of R.media) {
      if (sMedia.has(m.mediaId)) continue;
      await db.relationshipMedia.create({ data: { relationshipId: S.id, mediaId: m.mediaId, isPrimary: m.isPrimary && !sPrimary, sortOrder: m.sortOrder } });
    }
    await moveExternalIds(db, R.externalIds, { relationshipId: S.id }, S.externalIds);
    await db.importRawRecord.updateMany({ where: { relationshipId: R.id }, data: { relationshipId: S.id } });
    await moveLinks(db, "RELATIONSHIP", R, S.id, { fromPersonId: S.fromPersonId, toPersonId: S.toPersonId }, R.importLinks, now);
    await db.relationship.delete({ where: { id: R.id } });
  }

  // 8. „Kein Duplikat“-Markierungen mitnehmen
  const dismissed = [...other.dismissedAsA.map((d) => d.personBId), ...other.dismissedAsB.map((d) => d.personAId)].filter((id) => id !== K);
  if (dismissed.length) {
    await db.duplicateDismissal.createMany({
      data: dismissed.map((id) => (K < id ? { personAId: K, personBId: id, userId: scope.userId } : { personAId: id, personBId: K, userId: scope.userId })),
      skipDuplicates: true,
    });
  }

  // 8b. „Das bin ich“ (User.personId) wandert mit — sonst stünde der Benutzer
  // nach dem Löschen ohne eigene Person da (ON DELETE SET NULL).
  await db.user.updateMany({ where: { personId: X }, data: { personId: K } });

  // 9. Aufgehende Person löschen — es darf nichts mehr an ihr hängen.
  const leftovers = await Promise.all([
    db.event.count({ where: { personId: X } }),
    db.personName.count({ where: { personId: X } }),
    db.citation.count({ where: { personId: X } }),
    db.relationship.count({ where: { OR: [{ fromPersonId: X }, { toPersonId: X }] } }),
    db.importLink.count({ where: { personId: X } }),
    db.externalId.count({ where: { personId: X } }),
    db.importRawRecord.count({ where: { personId: X } }),
  ]);
  if (leftovers.some((n) => n > 0)) throw new Error(`Zusammenführen unvollständig (Reste an ${X}: ${leftovers.join(",")})`);
  await db.person.delete({ where: { id: X } });

  // 10. Audit (in derselben Transaktion) — genug, um von Hand zurückzubauen
  const auditId = newId();
  const keepBefore = Object.fromEntries(Object.keys(plan.resolved.columns).map((c) => [c, (keep as unknown as Record<string, unknown>)[c] ?? null]));
  const otherRow = Object.fromEntries(
    Object.entries(other).filter(([, v]) => v === null || typeof v !== "object" || v instanceof Date),
  );
  const result: MergeResult = { keepId: K, mergedId: X, alreadyMerged: false, summary, auditId };
  // Betroffen: beide Personen und die Verwandten, deren Beziehung umgehängt
  // oder zusammengelegt wurde; Familien auch die der aufgegangenen Person.
  const relatives = plan.snapshot.relationships
    .filter((r) => r.fromPersonId === X || r.toPersonId === X)
    .map((r) => (r.fromPersonId === X ? r.toPersonId : r.fromPersonId));
  await db.auditLog.create({
    data: await auditData(
      {
      id: auditId,
      ...auditActor(scope),
      action: "MERGE",
      entityType: "Person",
      entityId: K,
      personIds: [K, X, ...relatives],
      familyIds: other.families.map((f) => f.familyId),
      diff: JSON.parse(
        JSON.stringify({
          keepId: K,
          mergeId: X,
          choices: plan.resolved.choices,
          relationshipSubtypes: input.relationshipSubtypes,
          keepBefore,
          // Für den Verlauf: Hauptangaben der bleibenden Person vorher → nachher.
          changes: fieldChanges(keep, plan.resolved.columns as Record<string, unknown>),
          merged: {
            person: otherRow,
            familyIds: other.families.map((f) => f.familyId),
            names: other.names.map((n) => n.id),
            events: other.events.map((e) => e.id),
            citations: [...other.citations.map((c) => c.id), ...other.events.flatMap((e) => e.citations.map((c) => c.id))],
            media: other.media.map((m) => m.mediaId),
            relationships: plan.snapshot.relationships.filter((r) => r.fromPersonId === X || r.toPersonId === X).map((r) => ({ id: r.id, type: r.type, subtype: r.subtype, from: r.fromPersonId, to: r.toPersonId })),
            rawRecordIds: other.rawRecords.map((r) => r.id),
            importLinkIds: other.importLinks.map((l) => l.id),
            externalIds: other.externalIds.map((x) => ({ system: x.system, value: x.value })),
          },
          collapsedRelationships: plan.collapses.map((c) => ({ survivorId: c.survivor.id, removedId: c.removed.id, patch: c.patch })),
          result: { moves: summary.moves, collapses: summary.collapses, alternates: summary.alternates, newNames: summary.newNames, dropped: summary.dropped },
        }),
      ) as Prisma.InputJsonValue,
      },
      db,
    ),
  });
  return result;
}

/** Gespeichertes Ergebnis eines schon ausgeführten Zusammenführens (doppeltes Absenden). */
async function earlierMerge(db: Db | typeof prisma, keepId: string, mergeId: string): Promise<MergeResult | null> {
  const row = await db.auditLog.findFirst({
    where: { action: "MERGE", entityType: "Person", entityId: keepId, diff: { path: ["mergeId"], equals: mergeId } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  const d = row.diff as { result?: Partial<MergeSummary> } | null;
  return {
    keepId,
    mergedId: mergeId,
    alreadyMerged: true,
    auditId: row.id,
    summary: {
      moves: d?.result?.moves ?? ({} as MergeSummary["moves"]),
      collapses: d?.result?.collapses ?? ({} as MergeSummary["collapses"]),
      alternates: d?.result?.alternates ?? [],
      newNames: d?.result?.newNames ?? [],
      dropped: d?.result?.dropped ?? [],
      sentences: ["Diese beiden Personen wurden bereits zusammengeführt."],
    },
  };
}

/** Sperre je Person (sortiert) — zwei Zusammenführungen derselben Person warten aufeinander. */
export async function lockPersons(db: Db, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`person-merge:${id}`}))`;
  }
}

/**
 * Führt `mergeId` in `keepId` zusammen (eine Transaktion). Doppeltes Absenden:
 * Gibt es `mergeId` nicht mehr, aber ein Zusammenführen genau dieses Paars im
 * Audit, kommt dessen Ergebnis zurück (`alreadyMerged`).
 */
export async function mergePersons(scope: Scope, inputRaw: unknown, options: { tx?: Db; now?: Date; parentEdges?: { from: string; to: string }[] } = {}): Promise<MergeResult> {
  const input = parseOrThrow(mergeInputSchema.safeParse(inputRaw));
  if (input.keepId === input.mergeId) throw validationError([{ path: "mergeId", message: "Eine Person lässt sich nicht mit sich selbst zusammenführen" }]);
  nameChangeSet(scope, "Personen zusammengeführt", "MERGE");
  const run = async (db: Db): Promise<MergeResult> => {
    await lockPersons(db, [input.keepId, input.mergeId]);
    const stillThere = await db.person.count({ where: { id: input.mergeId } });
    if (!stillThere) {
      const earlier = await earlierMerge(db, input.keepId, input.mergeId);
      if (earlier) {
        await assertMergeRights(db, scope, input.keepId, input.keepId);
        return earlier;
      }
    }
    await assertMergeRights(db, scope, input.keepId, input.mergeId);
    const snap = await loadMergeSnapshot(db, input.keepId, input.mergeId, options.parentEdges);
    if (!snap) throw notFoundError("Person");
    const plan = planMerge(scope, snap, input);
    if (input.expectedToken && input.expectedToken !== plan.token) {
      throw conflictError("Die beiden Personen wurden seit der Vorschau geändert — bitte die Vorschau neu laden und erneut prüfen.");
    }
    if (plan.blockers.length) {
      throw conflictError(plan.blockers.map((b) => b.message).join(" "), { blockers: plan.blockers });
    }
    return executePlan(db, scope, plan, input, options.now ?? new Date());
  };
  if (options.tx) return run(options.tx);
  return prisma.$transaction(run, { timeout: 120_000, maxWait: 15_000 });
}

export type { FieldChoice, MergeChoices, MergeField };
