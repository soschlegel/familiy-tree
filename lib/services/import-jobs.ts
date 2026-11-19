import type { Scope } from "../scope";
import { prisma } from "../prisma";
import { forbiddenError } from "./errors";
import { applyGedcomImport, type GedcomApplyResult } from "./gedcom-import";

/**
 * Ein großer Import (Tausende Personen) dauert länger, als ein Reverse-Proxy
 * auf eine Antwort wartet (oft 60 s). Deshalb läuft das Ausführen im
 * Hintergrund des (langlebigen) Node-Prozesses; die Oberfläche fragt den
 * Stand ab. Doppelte Starts landen beim selben Lauf; startet der Server
 * mitten im Import neu, rollt die Transaktion zurück und der Lauf bleibt
 * offen (erneut ausführbar).
 */

export type ImportJobState =
  | { state: "idle" }
  | { state: "running"; startedAt: string }
  | { state: "done"; result: GedcomApplyResult }
  | { state: "error"; message: string; issues?: unknown };

const g = globalThis as unknown as { __gedcomJobs?: Map<string, ImportJobState> };
const jobs = (g.__gedcomJobs ??= new Map());

export function startImportJob(scope: Scope, batchId: string, decisions: unknown): ImportJobState {
  if (!scope.isAdmin) throw forbiddenError("Daten zu importieren");
  const current = jobs.get(batchId);
  if (current?.state === "running") return current;
  const running: ImportJobState = { state: "running", startedAt: new Date().toISOString() };
  jobs.set(batchId, running);
  void applyGedcomImport(scope, batchId, decisions)
    .then((result) => jobs.set(batchId, { state: "done", result }))
    .catch((err: unknown) => {
      const e = err as { message?: string; issues?: unknown; code?: string };
      if (!e.code) console.error("[gedcom-import]", err);
      jobs.set(batchId, {
        state: "error",
        message: e.code ? (e.message ?? "Fehler") : "Interner Fehler beim Import. Details stehen im Server-Log.",
        issues: e.issues,
      });
    });
  return running;
}

export async function importJobState(scope: Scope, batchId: string): Promise<ImportJobState> {
  if (!scope.isAdmin) throw forbiddenError("Importläufe zu sehen");
  const j = jobs.get(batchId);
  if (j) return j;
  const b = await prisma.importBatch.findUnique({ where: { id: batchId }, select: { status: true, counts: true } });
  if (b?.status === "COMPLETED" && b.counts) return { state: "done", result: { ...(b.counts as unknown as GedcomApplyResult), alreadyApplied: true } };
  return { state: "idle" };
}

/** Auf das Ende eines Laufs warten (Tests, Skripte). */
export async function waitForImportJob(scope: Scope, batchId: string, timeoutMs = 10 * 60_000): Promise<ImportJobState> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const s = await importJobState(scope, batchId);
    if (s.state !== "running" || Date.now() > until) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
}
