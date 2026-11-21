"use client";

import { useId, useState } from "react";

import type { ChangeEntryDto, ChangePage } from "@/lib/services/changes";
import { apiFetch } from "./api-client";
import { ChangeEntryList } from "./ChangeEntryList";

/**
 * Abschnitt „Änderungen“ auf der Personenseite (nur für Bearbeiter der
 * Person): wer hat wann was geändert, neueste zuerst. Lädt erst beim
 * Aufklappen und dann seitenweise.
 */
export function PersonChanges({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChangeEntryDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  async function load(after: string | null) {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ limit: "20", ...(after ? { cursor: after } : {}) });
    const res = await apiFetch<ChangePage<ChangeEntryDto>>(`/api/persons/${encodeURIComponent(personId)}/changes?${q}`);
    setLoading(false);
    if (!res.ok) return setError(res.message);
    setEntries((prev) => [...(after && prev ? prev : []), ...res.data.items]);
    setCursor(res.data.nextCursor);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && entries === null && !loading) void load(null);
  }

  return (
    <section aria-labelledby="changes-h" className="card p-5" data-testid="person-changes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="changes-h" className="section-title">
            Änderungen
          </h2>
          <p className="text-sm muted">Wer hat wann was geändert — nur für Bearbeiter sichtbar.</p>
        </div>
        <button type="button" className="btn-secondary" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
          {open ? "Änderungen ausblenden" : "Änderungen anzeigen"}
        </button>
      </div>

      <div id={panelId} hidden={!open} className="mt-4 space-y-3">
        <p aria-live="polite" className="sr-only">
          {loading ? "Änderungen werden geladen …" : entries ? `${entries.length} Änderungen geladen` : ""}
        </p>
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {entries && entries.length === 0 && <p className="text-sm muted">Noch keine Änderungen erfasst.</p>}
        {entries && entries.length > 0 && <ChangeEntryList entries={entries} />}
        {loading && <p className="text-sm muted">Lädt …</p>}
        {cursor && !loading && (
          <button type="button" className="btn-secondary" onClick={() => void load(cursor)}>
            Ältere Änderungen laden
          </button>
        )}
      </div>
    </section>
  );
}
