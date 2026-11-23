"use client";

import { useCallback, useEffect, useState } from "react";

import { plural } from "@/lib/plural";
import type { ImportSourceDto } from "@/lib/services/origin";
import { apiFetch, jsonBody } from "./api-client";
import { OriginChip } from "./OriginChips";

const NAME_MAX = 60;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" }) : "—");

/**
 * Importe benennen (Importverwaltung, nur Admins): je Import — also je
 * Quell-Baum, mehrere Läufe derselben Datei zählen als einer — Buchstabe,
 * Farbe und Anzeigename. Der Name erscheint überall, wo der Import genannt
 * wird (Stammbaum, Personenseite, Dubletten, Vergleich), auch für Bearbeiter;
 * den Dateinamen sehen weiterhin nur Administratoren.
 */
export function ImportSources() {
  const [sources, setSources] = useState<ImportSourceDto[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<ImportSourceDto[]>("/api/import/sources");
    if (res.ok) setSources(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("import-finished", on);
    return () => window.removeEventListener("import-finished", on);
  }, [load]);

  async function save(s: ImportSourceDto) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await apiFetch<ImportSourceDto>("/api/import/sources", jsonBody("PATCH", { sourceTreeId: s.sourceTreeId, displayName: value }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setEditing(null);
    setMessage(res.data.displayName ? `Import ${res.data.letter} heißt jetzt „${res.data.displayName}“.` : `Import ${res.data.letter} trägt wieder den Standardnamen.`);
    void load();
  }

  if (sources !== null && sources.length === 0 && !error) return null;

  return (
    <div className="mt-4 border-t border-stone-200 pt-4 dark:border-stone-800" data-testid="import-sources">
      <h3 className="eyebrow">Namen der Importe</h3>
      <p className="mt-1 max-w-2xl text-sm muted">
        Jeder Import hat einen Buchstaben und eine Farbe (nach der Reihenfolge des ersten Imports). Gib ihm einen sprechenden
        Namen — er erscheint überall statt des Dateinamens, auch für Bearbeiter. Den Dateinamen sehen nur Administratoren.
      </p>
      {error && (
        <p role="alert" className="alert-error mt-2 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="alert-success mt-2 text-sm">
          {message}
        </p>
      )}
      {sources === null ? (
        <p className="mt-2 text-sm muted">Lädt …</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {sources.map((s) => (
            <li key={s.sourceTreeId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="import-source" data-origin={s.letter}>
              <OriginChip entry={s} size="md" />
              {editing === s.sourceTreeId ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(s);
                  }}
                >
                  <label className="sr-only" htmlFor={`import-name-${s.letter}`}>
                    Anzeigename für Import {s.letter}
                  </label>
                  <input
                    id={`import-name-${s.letter}`}
                    className="field min-w-0 flex-1"
                    value={value}
                    maxLength={NAME_MAX}
                    autoFocus
                    placeholder={s.defaultName}
                    onChange={(e) => setValue(e.target.value)}
                    data-testid="import-source-name"
                  />
                  <button type="submit" className="btn-primary btn-sm" disabled={busy} data-testid="import-source-save">
                    Speichern
                  </button>
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(null)}>
                    Abbrechen
                  </button>
                  <span className="w-full text-xs muted">Leer lassen, um wieder „{s.defaultName}“ zu verwenden.</span>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium" data-testid="import-source-label">
                      {s.displayName ?? s.defaultName}
                      {!s.displayName && <span className="ml-2 font-normal muted">(noch kein eigener Name)</span>}
                    </p>
                    <p className="break-all text-xs muted">
                      {s.fileName ? `Datei ${s.fileName} · ` : ""}
                      {plural(s.persons, "Person", "Personen")} · {plural(s.batches, "Lauf", "Läufe")} · zuerst {day(s.firstImportAt)}
                      {s.lastImportAt && s.lastImportAt !== s.firstImportAt ? `, zuletzt ${day(s.lastImportAt)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    aria-label={`Import ${s.letter} umbenennen`}
                    data-testid="import-source-rename"
                    onClick={() => {
                      setEditing(s.sourceTreeId);
                      setValue(s.displayName ?? "");
                      setMessage(null);
                      setError(null);
                    }}
                  >
                    Umbenennen
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
