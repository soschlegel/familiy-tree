"use client";

import type { ChangeEntryDto } from "@/lib/services/changes";
import { formatChangeTime } from "@/lib/change-time";

/**
 * Kanal einer Änderung: App oder KI über MCP (mit Schlüsselname). Ein
 * inzwischen gelöschter Schlüssel erscheint als „Schlüssel „…“ (gelöscht)“
 * bzw. ohne bekannten Namen als „Schlüssel (gelöscht)“.
 */
export function ChannelBadge({
  channel,
  tokenName,
  tokenDeleted = false,
}: {
  channel: "APP" | "MCP";
  tokenName: string | null;
  tokenDeleted?: boolean;
}) {
  if (channel === "MCP") {
    const key = tokenName ? ` · Schlüssel „${tokenName}“` : tokenDeleted ? " · Schlüssel" : "";
    return (
      <span className="badge-accent max-w-full whitespace-normal break-words" title="Änderung über den KI-Zugang (MCP)">
        KI über MCP{key}
        {tokenDeleted ? " (gelöscht)" : ""}
      </span>
    );
  }
  return <span className="badge">App</span>;
}

function Value({ value }: { value: string | null }) {
  return value === null ? <span className="muted italic">leer</span> : <span>{value}</span>;
}

/**
 * Einträge des Änderungsverlaufs: Zeitpunkt, Benutzer, Kanal, Paket,
 * Beschreibung und je Feld vorher → nachher. Lange Werte brechen um (kein
 * waagerechtes Überlaufen auf dem Telefon).
 */
export function ChangeEntryList({
  entries,
  showChangeSet = true,
}: {
  entries: ChangeEntryDto[];
  /** In der Paket-Übersicht steht der Titel schon darüber. */
  showChangeSet?: boolean;
}) {
  return (
    <ol className="space-y-3" data-testid="change-entries">
      {entries.map((e) => (
        <li
          key={e.id}
          data-testid="change-entry"
          className="min-w-0 rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted">
            <time dateTime={e.at}>{formatChangeTime(e.at)}</time>
            <span aria-hidden>·</span>
            <span>{e.user ?? "unbekannter Benutzer"}</span>
            <ChannelBadge channel={e.channel} tokenName={e.tokenName} tokenDeleted={e.tokenDeleted} />
            {showChangeSet && e.changeSet && (
              <span className="min-w-0 break-words">
                <span className="sr-only">Paket: </span>
                <span aria-hidden>Paket </span>„{e.changeSet.title}“
              </span>
            )}
          </p>
          <p className="mt-1 break-words font-medium">{e.what}</p>
          {e.note && <p className="mt-0.5 break-words text-xs muted">{e.note}</p>}
          {e.fields.length > 0 && (
            <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(7rem,max-content)_1fr]">
              {e.fields.map((f) => (
                <div key={f.field} className="contents">
                  <dt className="text-xs font-medium muted sm:pt-px">{f.label}</dt>
                  <dd className="min-w-0 break-words">
                    {f.onlyNew ? (
                      <>
                        <span className="sr-only">neuer Wert: </span>
                        <Value value={f.to} />
                        <span className="ml-1 text-xs muted">(vorheriger Wert nicht erfasst)</span>
                      </>
                    ) : f.from === null && e.action === "CREATE" ? (
                      <Value value={f.to} />
                    ) : f.to === null && e.action === "DELETE" ? (
                      <Value value={f.from} />
                    ) : (
                      <>
                        <span className="sr-only">vorher: </span>
                        <del className="text-stone-500 decoration-stone-400 dark:text-stone-400">
                          <Value value={f.from} />
                        </del>
                        <span aria-hidden className="mx-1.5 muted">
                          →
                        </span>
                        <span className="sr-only">, nachher: </span>
                        <ins className="no-underline">
                          <Value value={f.to} />
                        </ins>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}
