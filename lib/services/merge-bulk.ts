import { z } from "zod";

import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, type Scope } from "../scope";
import { lineageOf, scoreDuplicate } from "../duplicates";
import { formatFuzzyYear, fuzzyField } from "../dates";
import { forbiddenError, parseOrThrow, ServiceError } from "./errors";
import { nameChangeSet } from "../change-sets";
import { loadDuplicatePeople } from "./duplicates";
import { loadMergeSnapshot, mergePersons, planMerge, summarizePlan, type MergeBlocker, type MergeSummary } from "./merge";

/**
 * Mehrere „sichere“ Dubletten in einem Rutsch zusammenführen (Recherche →
 * Mögliche Dubletten). Bewusst eng gefasst:
 * - nur Paare der Klasse „sicher“ (lib/duplicates.ts) — beim Ausführen erneut
 *   geprüft, nicht der Liste des Browsers geglaubt;
 * - jede Person in höchstens einem Paar;
 * - Vorgaben der Regeln, keine Feldwahl; die bleibende Person ist die mit
 *   mehr Angaben (bei Gleichstand die ältere);
 * - Eltern vor Kindern (nach Geburtsdatum): Ein Kind, das nur wegen doppelt
 *   erfasster Eltern blockiert war, geht, wenn die Eltern im selben Lauf
 *   zusammengeführt wurden;
 * - jedes Paar in einer eigenen Transaktion (mergePersons): Ein blockiertes
 *   Paar hält die anderen nicht auf, und nach jedem Paar ist der Baum
 *   stimmig.
 */

export const MAX_BULK_PAIRS = 200;

const bulkInput = z.object({
  pairs: z.array(z.object({ a: z.string().min(1).max(100), b: z.string().min(1).max(100) })).min(1).max(MAX_BULK_PAIRS),
});

export type BulkPairPlan = {
  keepId: string;
  mergeId: string;
  keepName: string;
  mergeName: string;
  status: "ready" | "blocked" | "skipped" | "afterParents";
  reason?: string;
  blockers?: MergeBlocker[];
  sentences?: string[];
};

export type BulkPreview = {
  pairs: BulkPairPlan[];
  totals: { persons: number; events: number; names: number; citations: number; media: number; relationships: number; collapsedRelationships: number; alternates: number; newNames: number; newFamilyMemberships: number };
};

export type BulkResult = {
  merged: { keepId: string; mergeId: string; keepName: string }[];
  failed: { keepId: string; mergeId: string; name: string; reason: string }[];
  skipped: { a: string; b: string; reason: string }[];
};

/** Name mit Lebensjahren — Dubletten heißen gleich, die Daten unterscheiden sie. */
const nameOf = (p: { givenName: string; familyName: string | null }) => {
  const name = [p.givenName, p.familyName].filter(Boolean).join(" ");
  const b = formatFuzzyYear(fuzzyField(p, "birthDate"));
  const d = formatFuzzyYear(fuzzyField(p, "deathDate"));
  return b || d ? `${name} (${[b && `*${b}`, d && `†${d}`].filter(Boolean).join(" ")})` : name;
};

/** Paare prüfen, ordnen und je die bleibende Person wählen. */
async function preparePairs(scope: Scope, raw: unknown) {
  if (!scope.isAdmin && scope.families.size === 0) throw forbiddenError("Personen zusammenzuführen");
  const { pairs } = parseOrThrow(bulkInput.safeParse(raw));
  const { graph, people } = await loadDuplicatePeople(scope);
  const byId = new Map(people.map((p) => [p.id, p]));
  // Dieselbe Abstammungsregel wie die Dublettenliste (Kette über sichtbare Personen).
  const lineage = lineageOf(people);
  const used = new Set<string>();
  const skipped: BulkResult["skipped"] = [];
  const ok: { keepId: string; mergeId: string; birth: number }[] = [];
  const counts = new Map(
    (
      await prisma.person.findMany({
        where: { id: { in: pairs.flatMap((p) => [p.a, p.b]) } },
        select: { id: true, createdAt: true, _count: { select: { events: true, citations: true, names: true, media: true, relationsFrom: true, relationsTo: true } } },
      })
    ).map((p) => [p.id, { n: Object.values(p._count).reduce((s, x) => s + x, 0), created: p.createdAt.getTime() }]),
  );
  for (const { a, b } of pairs) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    const ga = graph.persons.get(a);
    const gb = graph.persons.get(b);
    if (!pa || !pb || !ga || !gb || !canViewPerson(scope, ga.familyIds) || !canViewPerson(scope, gb.familyIds)) {
      skipped.push({ a, b, reason: "Person nicht gefunden" });
      continue;
    }
    if (!canEditPerson(scope, ga.familyIds) || !canEditPerson(scope, gb.familyIds)) {
      skipped.push({ a, b, reason: "Keine Bearbeitungsrechte an beiden Personen" });
      continue;
    }
    if (used.has(a) || used.has(b)) {
      skipped.push({ a, b, reason: "Person steht schon in einem anderen ausgewählten Paar" });
      continue;
    }
    const s = scoreDuplicate(pa, pb, { lineage });
    if (!s || s.confidence !== "high") {
      skipped.push({ a, b, reason: "Nicht (mehr) in der Klasse „sicher“ — bitte einzeln prüfen" });
      continue;
    }
    used.add(a);
    used.add(b);
    const ca = counts.get(a) ?? { n: 0, created: 0 };
    const cb = counts.get(b) ?? { n: 0, created: 0 };
    const keepA = ca.n > cb.n || (ca.n === cb.n && ca.created <= cb.created);
    ok.push({ keepId: keepA ? a : b, mergeId: keepA ? b : a, birth: pa.birth?.date.getTime() ?? Number.MAX_SAFE_INTEGER });
  }
  ok.sort((x, y) => x.birth - y.birth || x.keepId.localeCompare(y.keepId));
  return { ok, skipped, graph };
}

/** Gemeinsame Vorschau: was jedes Paar bewirkt und was blockiert — schreibt nichts. */
export async function previewBulkMerge(scope: Scope, raw: unknown): Promise<BulkPreview & { skipped: BulkResult["skipped"] }> {
  const { ok, skipped, graph } = await preparePairs(scope, raw);
  const inRun = new Set(ok.flatMap((p) => [`${p.keepId}|${p.mergeId}`, `${p.mergeId}|${p.keepId}`]));
  const edges = (await prisma.relationship.findMany({ where: { type: "PARENT_OF" }, select: { fromPersonId: true, toPersonId: true } })).map((r) => ({ from: r.fromPersonId, to: r.toPersonId }));
  const totals: BulkPreview["totals"] = { persons: 0, events: 0, names: 0, citations: 0, media: 0, relationships: 0, collapsedRelationships: 0, alternates: 0, newNames: 0, newFamilyMemberships: 0 };
  const out: BulkPairPlan[] = [];
  for (const p of ok) {
    const keepName = nameOf(graph.persons.get(p.keepId)!);
    const mergeName = nameOf(graph.persons.get(p.mergeId)!);
    const snap = await loadMergeSnapshot(prisma, p.keepId, p.mergeId, edges);
    if (!snap) {
      out.push({ keepId: p.keepId, mergeId: p.mergeId, keepName, mergeName, status: "skipped", reason: "Person nicht gefunden" });
      continue;
    }
    const plan = planMerge(scope, snap, {});
    const summary: MergeSummary = summarizePlan(scope, plan);
    // Blockiert nur wegen Eltern, die im selben Lauf zusammengeführt werden?
    const onlyParents =
      plan.blockers.length > 0 &&
      plan.blockers.every((b) => b.code === "BIO_PARENTS" && (b.suggestPairs ?? []).some(([x, y]) => inRun.has(`${x}|${y}`)));
    const status: BulkPairPlan["status"] = plan.blockers.length === 0 ? "ready" : onlyParents ? "afterParents" : "blocked";
    out.push({
      keepId: p.keepId,
      mergeId: p.mergeId,
      keepName,
      mergeName,
      status,
      ...(plan.blockers.length ? { blockers: plan.blockers } : {}),
      ...(status === "afterParents" ? { reason: "Wird möglich, sobald die Eltern in diesem Lauf zusammengeführt sind" } : {}),
      sentences: summary.sentences,
    });
    if (status === "blocked") continue;
    totals.persons++;
    totals.events += summary.moves.events;
    totals.names += summary.moves.names;
    totals.citations += summary.moves.citations;
    totals.media += summary.moves.media;
    totals.relationships += summary.moves.relationships;
    totals.collapsedRelationships += summary.collapses.relationships;
    totals.alternates += summary.alternates.length;
    totals.newNames += summary.newNames.length;
    totals.newFamilyMemberships += summary.moves.families > 0 ? 1 : 0;
  }
  return { pairs: out, totals, skipped };
}

/** Ausführen: Paar für Paar (Eltern zuerst), jedes in eigener Transaktion. */
export async function bulkMerge(scope: Scope, raw: unknown): Promise<BulkResult> {
  const { ok, skipped, graph } = await preparePairs(scope, raw);
  // Ein Paket für alle Paare (die einzelnen Zusammenführungen benennen es nicht um).
  nameChangeSet(scope, `Sammel-Zusammenführen (${ok.length} ${ok.length === 1 ? "Paar" : "Paare"})`, "MERGE");
  const merged: BulkResult["merged"] = [];
  const failed: BulkResult["failed"] = [];
  for (const p of ok) {
    try {
      await mergePersons(scope, { keepId: p.keepId, mergeId: p.mergeId });
      merged.push({ keepId: p.keepId, mergeId: p.mergeId, keepName: nameOf(graph.persons.get(p.keepId)!) });
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      failed.push({ keepId: p.keepId, mergeId: p.mergeId, name: nameOf(graph.persons.get(p.keepId)!), reason: err.message });
    }
  }
  return { merged, failed, skipped };
}
