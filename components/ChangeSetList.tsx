"use client";

import { useId, useState } from "react";

import type { ChangeEntryDto, ChangePage, ChangeSetSummaryDto } from "@/lib/services/changes";
import { apiFetch } from "./api-client";
import { ChangeEntryList, ChannelBadge } from "./ChangeEntryList";

/** Zeile mit vorformatiertem Zeitpunkt (auf dem Server — gleiche Ausgabe beim Hydrieren). */
export type ChangeSetRowData = ChangeSetSummaryDto & { lastText: string };

function ChangeSetRow({ set, filterQuery }: { set: ChangeSetRowData; filterQuery: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChangeEntryDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  async function load(after: string | null) {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(filterQuery);
    if (after) q.set("cursor", after);
    const res = await apiFetch<ChangePage<ChangeEntryDto>>(`/api/changes/${encodeURIComponent(set.key)}?${q}`);
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
    <li className="card min-w-0 p-4" data-testid="change-set">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-medium">{set.title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted">
            <time dateTime={set.last}>{set.lastText}</time>
            <span aria-hidden>·</span>
            <span>{set.user ?? "unbekannter Benutzer"}</span>
            <ChannelBadge channel={set.channel} tokenName={set.tokenName} />
          </p>
          <p className="mt-1 break-words text-sm" data-testid="change-set-summary">
            {set.summary || `${set.entries} ${set.entries === 1 ? "Änderung" : "Änderungen"}`}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          {open ? "Einzelheiten ausblenden" : "Einzelheiten"}
          <span className="sr-only"> zu „{set.title}“</span>
        </button>
      </div>
      <div id={panelId} hidden={!open} className="mt-3 space-y-3">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {entries && <ChangeEntryList entries={entries} showChangeSet={false} />}
        {loading && (
          <p className="text-sm muted" aria-live="polite">
            Lädt …
          </p>
        )}
        {cursor && !loading && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => void load(cursor)}>
            Weitere Einträge laden
          </button>
        )}
      </div>
    </li>
  );
}

/** Pakete der Änderungsübersicht, je Zeile aufklappbar bis zum einzelnen Feld. */
export function ChangeSetList({ sets, filterQuery }: { sets: ChangeSetRowData[]; filterQuery: string }) {
  return (
    <ol className="space-y-3" data-testid="change-sets">
      {sets.map((s) => (
        <ChangeSetRow key={s.key} set={s} filterQuery={filterQuery} />
      ))}
    </ol>
  );
}
