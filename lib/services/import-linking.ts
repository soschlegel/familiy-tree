import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { formatFuzzyYear } from "../dates";
import { linkImports, type LinkPair, type LinkPerson, type LinkResult } from "../import-linking";
import { getObjectBuffer, putObject } from "../storage";
import { conflictError, forbiddenError, notFoundError, parseOrThrow, ServiceError } from "./errors";
import { loadDuplicatePeople } from "./duplicates";
import { loadImportDirectory } from "./origin";
import { loadMergeSnapshot, mergePersons, planMerge, summarizePlan } from "./merge";
import { audit, auditActor } from "../audit";
import { nameChangeSet } from "../change-sets";

/**
 * Importe verbinden (Recherche → „Importe verbinden“, nur Administratoren):
 * Personen, die in mehreren Importen vorkommen, werden gefunden
 * (lib/import-linking.ts) und nach Bestätigung zusammengeführt — so wird aus
 * mehreren Importen ein gemeinsamer Stammbaum.
 *
 * Ein **Lauf** liegt als JSON unter MEDIA_DIR/connect/<id>.json: Auswahl,
 * Ergebnis des Abgleichs, Entscheidungen, Vorschau, Fortschritt des
 * Zusammenführens. Die Arbeit läuft im Hintergrund des Node-Prozesses; die
 * Seite fragt den Stand ab. Startet der Server mitten in einem Lauf neu, steht
 * der Lauf mit seinem Fortschritt in der Datei — „Fortsetzen“ macht beim
 * nächsten Cluster weiter (jedes Cluster ist eine Transaktion; ein schon
 * zusammengeführtes Cluster erkennt mergePersons am Audit und überspringt es).
 */

const DIR = "connect";
const runKey = (id: string) => `${DIR}/${id}.json`;
const INDEX = `${DIR}/index.json`;

export type ConnectPerson = { id: string; name: string; life: string; group: string; groupLabel: string };

export type ConnectPair = Omit<LinkPair, "a" | "b"> & {
  key: string;
  a: ConnectPerson;
  b: ConnectPerson;
  decision: "accept" | "reject" | null;
};

export type ConnectPreview = {
  clusters: number;
  persons: number;
  totals: { relationships: number; collapsedRelationships: number; events: number; citations: number; alternates: number; newNames: number };
  /** Personen, die danach zu mehr Familien gehören (Sichtbarkeit!). */
  widerVisibility: number;
  blocked: { key: string; names: string; reason: string }[];
  componentsAfter: number;
};

export type ConnectRun = {
  id: string;
  createdAt: string;
  createdBy: string;
  selection: { groups: string[] | null; withinGroup: boolean };
  status: "analyzing" | "ready" | "previewing" | "previewed" | "applying" | "done" | "error";
  /** Gesetzt, wenn der Hintergrundprozess nicht mehr läuft (Neustart). */
  interrupted?: boolean;
  error?: string;
  progress?: { phase: string; done: number; total: number };
  groups: { id: string; label: string; persons: number }[];
  components?: LinkResult["components"];
  bridges?: { groups: [string, string]; labels: [string, string]; count: number }[];
  pairs?: ConnectPair[];
  durationMs?: number;
  preview?: ConnectPreview;
  apply?: {
    clusters: { keep: string; merge: string[] }[];
    done: number;
    merged: number;
    failed: { names: string; reason: string }[];
    startedAt: string;
    finishedAt?: string;
  };
  /** Neuer Abgleich nach dem Zusammenführen (weitere Zuordnungen durch die Verbindungen). */
  followUpId?: string;
};

// --- Jobs im Prozess ---------------------------------------------------------
const g = globalThis as unknown as { __connectJobs?: Set<string> };
const running = (g.__connectJobs ??= new Set());

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Importe zu verbinden");
}

async function save(run: ConnectRun) {
  await putObject(runKey(run.id), Buffer.from(JSON.stringify(run), "utf8"));
}
async function load(id: string): Promise<ConnectRun> {
  if (!/^[a-z0-9]{8,40}$/.test(id)) throw notFoundError("Lauf");
  const buf = await getObjectBuffer(runKey(id));
  if (!buf) throw notFoundError("Lauf");
  const run = JSON.parse(buf.toString("utf8")) as ConnectRun;
  if (["analyzing", "previewing", "applying"].includes(run.status) && !running.has(run.id)) run.interrupted = true;
  return run;
}
async function index(): Promise<string[]> {
  const buf = await getObjectBuffer(INDEX);
  return buf ? (JSON.parse(buf.toString("utf8")) as string[]) : [];
}
async function addToIndex(id: string) {
  const list = [id, ...(await index()).filter((x) => x !== id)].slice(0, 20);
  await putObject(INDEX, Buffer.from(JSON.stringify(list), "utf8"));
}

/** Importe (Quell-Gruppen) zur Auswahl: Datei, letzter Import, Personen. */
export async function listConnectGroups(scope: Scope): Promise<ConnectRun["groups"]> {
  assertAdmin(scope);
  const batches = await prisma.importBatch.findMany({
    where: { status: "COMPLETED", sourceTreeId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { sourceTreeId: true },
  });
  const counts = await prisma.importLink.groupBy({ by: ["sourceTreeId"], where: { entityType: "PERSON", sourceTreeId: { not: null } }, _count: true });
  const countOf = new Map(counts.map((c) => [c.sourceTreeId, c._count]));
  const out = new Map<string, ConnectRun["groups"][number]>();
  // Bezeichnung wie überall: Buchstabe und Anzeigename (ohne eigenen Namen Datei und Datum).
  const importDir = await loadImportDirectory();
  for (const b of batches) {
    if (out.has(b.sourceTreeId!)) continue;
    out.set(b.sourceTreeId!, {
      id: b.sourceTreeId!,
      label: `Import ${importDir.label(scope, b.sourceTreeId)}`,
      persons: countOf.get(b.sourceTreeId) ?? 0,
    });
  }
  const manual = await prisma.person.count({ where: { importLinks: { none: {} } } });
  // Importe, deren Personen inzwischen alle gelöscht sind, bieten nichts zum Abgleichen.
  return [...[...out.values()].filter((x) => x.persons > 0), ...(manual ? [{ id: "manual", label: "Von Hand erfasst", persons: manual }] : [])];
}

export async function listConnectRuns(scope: Scope): Promise<ConnectRun[]> {
  assertAdmin(scope);
  const out: ConnectRun[] = [];
  for (const id of await index()) {
    try {
      const r = await load(id);
      out.push({ ...r, pairs: undefined });
    } catch {
      // verschwundene Datei: übergehen
    }
  }
  return out;
}

const startInput = z.object({
  groups: z.array(z.string().min(1).max(300)).max(50).optional().nullable(),
  withinGroup: z.boolean().default(false),
});

/** Abgleich starten (Hintergrund). */
export async function startConnectRun(scope: Scope, input: unknown): Promise<ConnectRun> {
  assertAdmin(scope);
  const sel = parseOrThrow(startInput.safeParse(input ?? {}));
  const run: ConnectRun = {
    id: `c${Date.now().toString(36)}${randomBytes(5).toString("hex")}`,
    createdAt: new Date().toISOString(),
    createdBy: scope.userId,
    selection: { groups: sel.groups?.length ? sel.groups : null, withinGroup: sel.withinGroup },
    status: "analyzing",
    groups: await listConnectGroups(scope),
    progress: { phase: "Abgleich", done: 0, total: 1 },
  };
  await save(run);
  await addToIndex(run.id);
  background(run.id, () => analyze(scope, run));
  return run;
}

function background(id: string, work: () => Promise<void>) {
  running.add(id);
  void work()
    .catch(async (err: unknown) => {
      console.error("[importe-verbinden]", err);
      try {
        const run = await load(id);
        run.status = "error";
        run.error = err instanceof ServiceError ? err.message : "Interner Fehler. Details stehen im Server-Log.";
        await save(run);
      } catch {
        // nichts mehr zu retten
      }
    })
    .finally(() => running.delete(id));
}

const nameOf = (p: { givenName: string; familyName: string | null }) => [p.givenName, p.familyName].filter(Boolean).join(" ");

async function analyze(scope: Scope, run: ConnectRun) {
  const { graph, people } = await loadDuplicatePeople(scope);
  const labels = new Map(run.groups.map((x) => [x.id, x.label]));
  const groupOf = (p: { trees: string[] }) => (p.trees.length ? [...p.trees].sort().join("+") : "manual");
  const linkPeople: LinkPerson[] = people.map((p) => ({ ...p, group: groupOf(p) }));
  const selected = run.selection.groups;
  const ids = linkPeople.map((p) => p.id);
  const dismissed = new Set(
    (await prisma.duplicateDismissal.findMany({ where: { personAId: { in: ids } }, select: { personAId: true, personBId: true } })).map((d) => `${d.personAId}|${d.personBId}`),
  );
  const res = linkImports(linkPeople, {
    groups: selected ? linkPeople.map((p) => p.group).filter((x) => x.split("+").some((t) => selected.includes(t))) : undefined,
    withinGroup: run.selection.withinGroup,
    dismissed,
  });
  const byId = new Map(linkPeople.map((p) => [p.id, p]));
  const label = (group: string) => group.split("+").map((t) => labels.get(t) ?? (t === "manual" ? "Von Hand erfasst" : t)).join(" + ");
  const person = (id: string): ConnectPerson => {
    const gp = graph.persons.get(id)!;
    const lp = byId.get(id)!;
    const b = formatFuzzyYear(lp.birth);
    const d = formatFuzzyYear(lp.death);
    return { id, name: nameOf(gp), life: [b && `*${b}`, d && `†${d}`].filter(Boolean).join(" "), group: lp.group, groupLabel: label(lp.group) };
  };
  run.pairs = res.pairs.map((p) => ({
    ...p,
    key: `${p.a}|${p.b}`,
    a: person(p.a),
    b: person(p.b),
    decision: p.confidence === "high" ? "accept" : null,
  }));
  run.components = res.components;
  run.bridges = res.bridgesByGroups.map((x) => ({ ...x, labels: [label(x.groups[0]), label(x.groups[1])] as [string, string] }));
  run.durationMs = res.durationMs;
  run.status = "ready";
  run.progress = undefined;
  await save(run);
}

export async function getConnectRun(
  scope: Scope,
  id: string,
  q: { confidence?: string; offset?: number; limit?: number; bridgesOnly?: boolean; veryLikely?: boolean } = {},
): Promise<ConnectRun & { total: number; counts: Record<string, number>; accepted: number }> {
  assertAdmin(scope);
  const run = await load(id);
  const all = run.pairs ?? [];
  const counts = { high: 0, medium: 0, low: 0, veryLikely: 0, bridges: 0 } as Record<string, number>;
  for (const p of all) {
    counts[p.confidence]++;
    if (p.veryLikely) counts.veryLikely++;
    if (p.bridge) counts.bridges++;
  }
  const list = all.filter(
    (p) => (!q.confidence || p.confidence === q.confidence) && (!q.bridgesOnly || p.bridge) && (!q.veryLikely || p.veryLikely),
  );
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.max(1, Math.min(200, q.limit ?? 50));
  return { ...run, pairs: list.slice(offset, offset + limit), total: list.length, counts, accepted: all.filter((p) => p.decision === "accept").length };
}

const decideInput = z.object({
  accept: z.array(z.string()).max(20000).default([]),
  reject: z.array(z.string()).max(20000).default([]),
  /** „Kein Duplikat“: dauerhaft (DuplicateDismissal). */
  dismiss: z.array(z.string()).max(20000).default([]),
});

/** Entscheidungen zu Paaren; eine neue Vorschau wird danach nötig. */
export async function decideConnectPairs(scope: Scope, id: string, input: unknown): Promise<{ accepted: number }> {
  assertAdmin(scope);
  const d = parseOrThrow(decideInput.safeParse(input));
  const run = await load(id);
  if (run.status === "applying" || run.status === "done") throw conflictError("Dieser Lauf wird schon ausgeführt bzw. ist abgeschlossen");
  const by = new Map((run.pairs ?? []).map((p) => [p.key, p]));
  for (const k of d.accept) if (by.has(k)) by.get(k)!.decision = "accept";
  for (const k of [...d.reject, ...d.dismiss]) if (by.has(k)) by.get(k)!.decision = "reject";
  if (d.dismiss.length) {
    const rows = d.dismiss
      .map((k) => k.split("|"))
      .filter((x) => x.length === 2)
      .map(([a, b]) => (a < b ? { personAId: a, personBId: b, userId: scope.userId } : { personAId: b, personBId: a, userId: scope.userId }));
    await prisma.duplicateDismissal.createMany({ data: rows, skipDuplicates: true });
    for (const r of rows) {
      await audit({ ...auditActor(scope), action: "UPDATE", entityType: "Person", entityId: r.personAId, diff: { notDuplicateOf: r.personBId }, personIds: [r.personBId] });
    }
  }
  if (run.status === "previewed") run.status = "ready";
  run.preview = undefined;
  await save(run);
  return { accepted: (run.pairs ?? []).filter((p) => p.decision === "accept").length };
}

/** Angenommene Paare → Cluster; bleibend ist der vollständigste Eintrag; Vorfahren zuerst. */
async function clustersOf(run: ConnectRun): Promise<{ keep: string; merge: string[] }[]> {
  const acc = (run.pairs ?? []).filter((p) => p.decision === "accept");
  const uf = new Map<string, string>();
  const find = (x: string): string => {
    let r = uf.get(x) ?? x;
    while ((uf.get(r) ?? r) !== r) r = uf.get(r)!;
    return r;
  };
  for (const p of acc) {
    const ra = find(p.a.id);
    const rb = find(p.b.id);
    if (ra !== rb) uf.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of new Set(acc.flatMap((p) => [p.a.id, p.b.id]))) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  const ids = [...groups.values()].flat();
  const rows = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, createdAt: true, birthDate: true, _count: { select: { events: true, citations: true, names: true, relationsFrom: true, relationsTo: true, media: true } } },
  });
  const info = new Map(rows.map((r) => [r.id, r]));
  const weight = (id: string) => Object.values(info.get(id)?._count ?? {}).reduce((s, x) => s + x, 0);
  return [...groups.values()]
    .filter((list) => list.every((id) => info.has(id)))
    .map((list) => {
      const sorted = [...list].sort((x, y) => weight(y) - weight(x) || info.get(x)!.createdAt.getTime() - info.get(y)!.createdAt.getTime() || x.localeCompare(y));
      return { keep: sorted[0], merge: sorted.slice(1), birth: Math.min(...list.map((id) => info.get(id)!.birthDate?.getTime() ?? Number.MAX_SAFE_INTEGER)) };
    })
    .sort((x, y) => x.birth - y.birth || x.keep.localeCompare(y.keep))
    .map(({ keep, merge }) => ({ keep, merge }));
}

/** Gemeinsame Vorschau der angenommenen Paare (Hintergrund). */
export async function startConnectPreview(scope: Scope, id: string): Promise<ConnectRun> {
  assertAdmin(scope);
  const run = await load(id);
  if (!["ready", "previewed"].includes(run.status) && !(run.status === "previewing" && run.interrupted)) {
    throw conflictError("Die Vorschau ist in diesem Zustand nicht möglich");
  }
  if (running.has(id)) return run;
  run.status = "previewing";
  run.interrupted = false;
  run.progress = { phase: "Vorschau", done: 0, total: 1 };
  await save(run);
  background(id, () => preview(scope, run));
  return run;
}

async function preview(scope: Scope, run: ConnectRun) {
  const clusters = await clustersOf(run);
  const edges = (await prisma.relationship.findMany({ where: { type: "PARENT_OF" }, select: { fromPersonId: true, toPersonId: true } })).map((r) => ({ from: r.fromPersonId, to: r.toPersonId }));
  const inRun = new Set(clusters.flatMap((c) => c.merge.map((m) => [`${c.keep}|${m}`, `${m}|${c.keep}`]).flat()));
  const totals: ConnectPreview["totals"] = { relationships: 0, collapsedRelationships: 0, events: 0, citations: 0, alternates: 0, newNames: 0 };
  const blocked: ConnectPreview["blocked"] = [];
  let widerVisibility = 0;
  let persons = 0;
  run.progress = { phase: "Vorschau", done: 0, total: clusters.length };
  for (const [i, c] of clusters.entries()) {
    let wider = false;
    for (const m of c.merge) {
      const snap = await loadMergeSnapshot(prisma, c.keep, m, edges);
      if (!snap) continue;
      const plan = planMerge(scope, snap, {});
      const realBlockers = plan.blockers.filter(
        (b) => !(b.code === "BIO_PARENTS" && (b.suggestPairs ?? []).some(([x, y]) => inRun.has(`${x}|${y}`))),
      );
      if (realBlockers.length) {
        blocked.push({ key: `${c.keep}|${m}`, names: `${nameOf(snap.keep)} / ${nameOf(snap.other)}`, reason: realBlockers.map((b) => b.message).join(" ") });
        continue;
      }
      const s = summarizePlan(scope, plan);
      persons++;
      totals.relationships += s.moves.relationships;
      totals.collapsedRelationships += s.collapses.relationships;
      totals.events += s.moves.events;
      totals.citations += s.moves.citations;
      totals.alternates += s.alternates.length;
      totals.newNames += s.newNames.length;
      if (s.moves.families > 0) wider = true;
    }
    if (wider) widerVisibility++;
    if (i % 20 === 0) {
      run.progress = { phase: "Vorschau", done: i, total: clusters.length };
      await save(run);
    }
  }
  // Teile danach (über die angenommenen Paare)
  const { people } = await loadDuplicatePeople(scope);
  const lp: LinkPerson[] = people.map((p) => ({ ...p, group: "x" }));
  const extra = clusters.flatMap((c) => c.merge.map((m) => [c.keep, m] as [string, string]));
  const uf = new Map<string, string>();
  const find = (x: string): string => {
    let r = uf.get(x) ?? x;
    while ((uf.get(r) ?? r) !== r) r = uf.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf.set(ra, rb);
  };
  for (const p of lp) for (const o of [...p.parents, ...p.partners, ...p.children]) union(p.id, o);
  for (const [a, b] of extra) union(a, b);
  const componentsAfter = new Set(lp.map((p) => find(p.id))).size;
  run.preview = { clusters: clusters.length, persons, totals, widerVisibility, blocked, componentsAfter };
  run.status = "previewed";
  run.progress = undefined;
  await save(run);
}

/** Zusammenführen starten bzw. nach Unterbrechung fortsetzen (Hintergrund). */
export async function startConnectApply(scope: Scope, id: string): Promise<ConnectRun> {
  assertAdmin(scope);
  const run = await load(id);
  if (running.has(id)) return run;
  if (run.status === "done") return run;
  if (run.status !== "previewed" && !(run.status === "applying" && run.interrupted)) {
    throw conflictError("Bitte zuerst die gemeinsame Vorschau ansehen");
  }
  if (!run.apply) {
    const blockedKeys = new Set(run.preview?.blocked.map((b) => b.key));
    const clusters = (await clustersOf(run))
      .map((c) => ({ keep: c.keep, merge: c.merge.filter((m) => !blockedKeys.has(`${c.keep}|${m}`)) }))
      .filter((c) => c.merge.length);
    run.apply = { clusters, done: 0, merged: 0, failed: [], startedAt: new Date().toISOString() };
  }
  run.status = "applying";
  run.interrupted = false;
  await save(run);
  // Alle Zusammenführungen dieses Laufs bilden ein Paket.
  nameChangeSet(scope, `Importe verbinden (${run.apply.clusters.length} Gruppen)`, "CONNECT");
  background(id, () => apply(scope, run));
  return run;
}

async function apply(scope: Scope, run: ConnectRun) {
  const a = run.apply!;
  const total = a.clusters.length;
  for (let i = a.done; i < total; i++) {
    const c = a.clusters[i];
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const m of c.merge) await mergePersons(scope, { keepId: c.keep, mergeId: m }, { tx });
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
      a.merged += c.merge.length;
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      a.failed.push({ names: c.keep, reason: err.message });
    }
    a.done = i + 1;
    run.progress = { phase: "Zusammenführen", done: a.done, total };
    if (i % 5 === 0 || i === total - 1) await save(run);
  }
  a.finishedAt = new Date().toISOString();
  run.status = "done";
  run.progress = undefined;
  // Durch die Verbindungen haben Verwandte jetzt echte gemeinsame Eltern,
  // Partner, Kinder — gleich neu abgleichen (zeigt „weitere Zuordnungen“).
  const next = await startConnectRun(scope, run.selection);
  run.followUpId = next.id;
  await save(run);
  await audit({
    ...auditActor(scope),
    action: "CONNECT",
    entityType: "Person",
    entityId: run.id,
    diff: { clusters: a.clusters, merged: a.merged, failed: a.failed } as unknown as Prisma.InputJsonValue,
    personIds: a.clusters.map((c) => c.keep),
  });
}

/** Auf das Ende der Hintergrundarbeit warten (Tests). */
export async function waitForConnectRun(scope: Scope, id: string, timeoutMs = 120_000): Promise<ConnectRun> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await load(id);
    if (!running.has(id) || Date.now() > until) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
}
