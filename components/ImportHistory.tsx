"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

type Entry = {
  id: string;
  createdAt: string;
  status: string;
  format: string;
  fileName: string;
  fileSizeBytes: number;
  hasFile: boolean;
  userName: string | null;
  sourceSystemName: string | null;
  summary: { created: number; updated: number; unchanged: number; skippedEdited: number; invalid: number } | null;
  rawRecords: number;
  supersededRawRecords: number;
};

const STATUS: Record<string, string> = { PENDING: "Vorschau, nicht ausgeführt", COMPLETED: "ausgeführt", FAILED: "fehlgeschlagen" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Importverlauf: ausgeführte Läufe mit Ergebnis, Originaldatei und dem
 * Entfernen überholter Rohdaten. Nie ausgeführte Vorschauen stehen
 * zugeklappt darunter und lassen sich verwerfen (samt aufbewahrter Datei);
 * nach 7 Tagen verschwinden sie von selbst. Nur Admins.
 */
export function ImportHistory() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Entry[]>("/api/import/batches?limit=50");
    if (res.ok) setEntries(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("import-finished", on);
    return () => window.removeEventListener("import-finished", on);
  }, [load]);

  async function prune(e: Entry) {
    const what = plural(e.supersededRawRecords, "überholten Rohdatensatz", "überholte Rohdatensätze");
    if (!confirm(`${what} dieses Laufs endgültig entfernen? Die Originaldatei bleibt.`)) return;
    const res = await apiFetch<{ count: number }>("/api/import/batches/prune", jsonBody("POST", { batchId: e.id }));
    if (!res.ok) return setError(res.message);
    setMessage(`${plural(res.data.count, "überholter Rohdatensatz", "überholte Rohdatensätze")} entfernt.`);
    void load();
  }

  async function discard(e: Entry) {
    if (!confirm(`Vorschau „${e.fileName}“ verwerfen? Die aufbewahrte Kopie der Datei wird gelöscht.`)) return;
    const res = await apiFetch(`/api/import/gedcom/${e.id}`, { method: "DELETE" });
    if (!res.ok) return setError(res.message);
    setMessage("Vorschau verworfen.");
    void load();
  }

  const done = entries?.filter((e) => e.status !== "PENDING" && !(e.format === "GEDCOM" && e.status === "FAILED")) ?? [];
  const previews = entries?.filter((e) => e.format === "GEDCOM" && e.status !== "COMPLETED") ?? [];

  return (
    <section id="importe" className="card p-5" aria-labelledby="import-history-title">
      <h2 id="import-history-title" className="section-title">
        Importe
      </h2>
      <p className="mt-1 text-sm muted">
        Jeder ausgeführte Import mit Originaldatei. Rohdaten (nicht gedeutete Angaben) werden bei einem erneuten Import
        durch den neuen Stand ersetzt; die überholten bleiben, bis du sie entfernst.
      </p>
      {error && (
        <p role="alert" className="alert-error mt-3 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="alert-success mt-3 text-sm">
          {message}
        </p>
      )}
      {entries === null ? (
        <p className="mt-3 text-sm muted">Lädt …</p>
      ) : done.length === 0 ? (
        <p className="mt-3 text-sm muted">Noch keine ausgeführten Importe.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {done.map((e) => (
            <li key={e.id} data-testid="import-entry" data-batch-id={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="break-all font-medium">{e.fileName}</p>
                <p className="muted">
                  {when(e.createdAt)} · {e.format}
                  {e.sourceSystemName ? ` (${e.sourceSystemName})` : ""} · {e.userName ?? "unbekannt"} · {STATUS[e.status] ?? e.status}
                </p>
                {e.summary && (
                  <p>
                    {e.summary.created} neu, {e.summary.updated} aktualisiert, {e.summary.unchanged} unverändert
                    {e.summary.skippedEdited ? `, ${e.summary.skippedEdited} App-Version behalten` : ""}
                    {e.summary.invalid ? `, ${e.summary.invalid} ausgelassen` : ""}
                  </p>
                )}
                <p className="muted">
                  {plural(e.rawRecords, "Rohdatensatz", "Rohdatensätze")}
                  {e.supersededRawRecords ? `, davon ${e.supersededRawRecords} überholt` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {e.hasFile && (
                  <a className="btn-secondary btn-sm" href={`/api/import/batches/${e.id}/file`}>
                    Originaldatei
                  </a>
                )}
                {e.supersededRawRecords > 0 && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void prune(e)}>
                    Überholte Rohdaten entfernen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {previews.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">
            {plural(previews.length, "nicht ausgeführte Vorschau", "nicht ausgeführte Vorschauen")} (werden nach 7 Tagen verworfen)
          </summary>
          <ul className="mt-1 divide-y divide-stone-100 dark:divide-stone-800">
            {previews.map((e) => (
              <li key={e.id} data-testid="import-preview-entry" data-batch-id={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 break-all">
                  {e.fileName} <span className="muted">· {when(e.createdAt)} · {STATUS[e.status] ?? e.status}</span>
                </span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => void discard(e)}>
                  Verwerfen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
