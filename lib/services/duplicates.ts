import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, type Scope } from "../scope";
import { fuzzyField } from "../dates";
import { findDuplicatePairs, type Confidence, type DupPerson } from "../duplicates";
import { nameKey } from "../name-keys";
import { toPersonBrief, type PersonBrief } from "./dto";
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

  const people: DupPerson[] = visible.map((p) => {
    const parents = (g.index.parentsOf.get(p.id) ?? []).map((e) => e.from);
    const partners = (g.index.partnersOf.get(p.id) ?? []).map((e) => (e.from === p.id ? e.to : e.from));
    const children = (g.index.childrenOf.get(p.id) ?? []).map((e) => e.to);
    return {
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      gender: p.gender,
      birth: fuzzyField(p, "birthDate"),
      death: fuzzyField(p, "deathDate"),
      birthPlace: p.birthPlace,
      variants: namesOf.get(p.id) ?? [],
      parents,
      partners,
      children,
      parentNames: parents.map((id) => relKey(g.persons.get(id))).filter(Boolean),
      partnerNames: partners.map((id) => relKey(g.persons.get(id))).filter(Boolean),
      trees: [...(treesOf.get(p.id) ?? [])],
    };
  });
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
  await audit({ ...auditActor(scope), action: "UPDATE", entityType: "Person", entityId: personAId, diff: { notDuplicateOf: personBId } });
  return { ok: true };
}

/** Markierung „kein Duplikat“ wieder aufheben. */
export async function undismissDuplicate(scope: Scope, aId: string, bId: string): Promise<{ ok: true }> {
  await assertBothEditable(scope, aId, bId);
  const [personAId, personBId] = aId < bId ? [aId, bId] : [bId, aId];
  await prisma.duplicateDismissal.deleteMany({ where: { personAId, personBId } });
  await audit({ ...auditActor(scope), action: "UPDATE", entityType: "Person", entityId: personAId, diff: { notDuplicateOfRemoved: personBId } });
  return { ok: true };
}
