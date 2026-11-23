"use client";

import { createContext } from "react";

import { limitChips, MANUAL_KEY, ORIGIN_CHIP_LIMIT, originText, type OriginEntry, type TreeOrigin } from "@/lib/origin";
import { plural } from "@/lib/plural";
import { HelpLink } from "./HelpLink";

/**
 * Herkunft sichtbar machen: Chips mit dem Buchstaben eines Imports (Farbe aus
 * lib/origin.ts) bzw. gestricheltem „H“ für „von Hand erfasst“. Die Farbe
 * steht nie allein — jeder Chip trägt Buchstaben und Titel, und zu jeder
 * Gruppe gibt es einen Text für Screenreader.
 */

/** Herkunft im Stammbaum: als Kontext, damit React Flow beim Hervorheben keine Knoten neu anlegt. */
export type TreeOriginState = {
  origin: TreeOrigin | null;
  /** In der Legende angeklickter Import — alle anderen Karten treten zurück. */
  highlight: string | null;
};

export const TreeOriginContext = createContext<TreeOriginState>({ origin: null, highlight: null });

export function OriginChip({ entry, size = "sm" }: { entry: OriginEntry; size?: "sm" | "md" }) {
  const box = size === "md" ? "h-5 min-w-5 px-1 text-[11px]" : "h-4 min-w-4 px-[3px] text-[10px]";
  return (
    <span
      data-testid="origin-chip"
      data-origin={entry.key}
      title={originText(entry)}
      style={entry.color ? { backgroundColor: entry.color, color: entry.fg ?? undefined } : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ${box} ${
        entry.manual
          ? "border border-dashed border-stone-500 bg-surface text-stone-700 dark:border-stone-400 dark:text-stone-200"
          : entry.color
            ? "ring-1 ring-black/20 dark:ring-white/40"
            : "bg-stone-300 text-stone-900 ring-1 ring-black/20"
      }`}
    >
      {entry.letter}
    </span>
  );
}

/** Text für Screenreader: „Herkunft: Import A: Name, Import B: Name“. */
export function originListText(entries: OriginEntry[]): string {
  return entries.length ? `Herkunft: ${entries.map(originText).join(", ")}` : "";
}

/**
 * Chips zu einer Liste von Kennungen. Höchstens `limit` Chips, dann „+n“.
 * Unbekannte Kennungen werden übergangen; ohne Treffer erscheint nichts.
 */
export function OriginChips({
  keys,
  entries,
  limit = ORIGIN_CHIP_LIMIT,
  size = "sm",
  className = "",
  decorative = false,
}: {
  keys: string[] | undefined;
  entries: Record<string, OriginEntry> | undefined;
  limit?: number;
  size?: "sm" | "md";
  className?: string;
  /** Der umgebende Text nennt die Herkunft schon (Baumkarte) — Chips dann vor Screenreadern verbergen. */
  decorative?: boolean;
}) {
  const list = (keys ?? []).map((k) => entries?.[k]).filter((e): e is OriginEntry => Boolean(e));
  if (list.length === 0) return null;
  const { shown, more } = limitChips(list, limit);
  const rest = list.slice(shown.length);
  return (
    <span
      data-testid="origin-chips"
      data-origins={list.map((e) => e.key).join(" ")}
      aria-hidden={decorative || undefined}
      className={`inline-flex items-center gap-0.5 align-middle ${className}`}
    >
      {!decorative && <span className="sr-only">{originListText(list)}</span>}
      <span aria-hidden className="inline-flex items-center gap-0.5">
        {shown.map((e) => (
          <OriginChip key={e.key} entry={e} size={size} />
        ))}
        {more > 0 && (
          <span
            data-testid="origin-more"
            title={rest.map(originText).join(", ")}
            className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface px-1 font-semibold leading-none text-stone-700 ring-1 ring-stone-400 dark:text-stone-200 dark:ring-stone-500 ${
              size === "md" ? "h-5 text-[11px]" : "h-4 text-[10px]"
            }`}
          >
            +{more}
          </span>
        )}
      </span>
    </span>
  );
}

/** Kennungen → Einträge, wie sie die Baumkarte braucht. */
export function entryMap(entries: OriginEntry[] | undefined): Record<string, OriginEntry> {
  return Object.fromEntries((entries ?? []).map((e) => [e.key, e]));
}

/**
 * Legende der Herkunft im Stammbaum. Jeder Eintrag ist ein Knopf: Anklicken
 * hebt die Personen dieses Imports hervor (alle anderen treten zurück), ein
 * zweiter Klick hebt das wieder auf.
 */
export function OriginLegend({
  origin,
  highlight,
  onHighlight,
}: {
  origin: TreeOrigin;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
}) {
  const active = origin.entries.find((e) => e.key === highlight) ?? null;
  return (
    <div data-testid="tree-origin-legend" className="space-y-1">
      <p className="font-medium" id="tree-origin-legend-h">
        Herkunft
      </p>
      {origin.entries.length === 0 ? (
        <p className="max-w-[16rem] muted">Zu den gezeigten Personen darfst du keine Herkunft sehen.</p>
      ) : (
        <ul className="space-y-0.5" aria-labelledby="tree-origin-legend-h">
          {origin.entries.map((e) => (
            <li key={e.key}>
              <button
                type="button"
                data-testid="origin-legend-item"
                data-origin={e.key}
                aria-pressed={highlight === e.key}
                title={highlight === e.key ? "Hervorhebung aufheben" : `Personen aus „${e.name}“ hervorheben`}
                onClick={() => onHighlight(highlight === e.key ? null : e.key)}
                className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition max-md:min-h-11 ${
                  highlight === e.key
                    ? "bg-accent-50 ring-1 ring-accent-600 dark:bg-accent-900/40 dark:ring-accent-300"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <span aria-hidden className="inline-flex w-7 justify-center">
                  <OriginChip entry={e} />
                </span>
                <span className="min-w-0 max-w-[13rem]">
                  <span className="sr-only">{e.manual ? "" : `Import ${e.letter}: `}</span>
                  <span className="break-words font-medium">{e.name}</span>{" "}
                  <span className="muted tabular-nums">({plural(e.persons, "Person", "Personen")})</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {origin.connecting > 0 && (
        <p className="flex items-center gap-2" data-testid="origin-legend-connecting">
          <span aria-hidden className="inline-flex w-7 justify-center">
            <span className="inline-block h-3.5 w-5 rounded-md border border-stone-300 outline outline-1 outline-offset-2 outline-stone-500 dark:border-stone-600 dark:outline-stone-400" />
          </span>
          <span className="max-w-[13rem]">
            doppelter Rand: Verbindungsperson — in mehreren Importen ({origin.connecting})
          </span>
        </p>
      )}
      <p className="max-w-[16rem] text-[11px] muted" role="status" data-testid="origin-legend-status">
        {active
          ? `Hervorgehoben: ${originText(active)}. Noch einmal anklicken hebt es auf.`
          : origin.entries.some((e) => e.key === MANUAL_KEY)
            ? "H = von Hand erfasst. Eintrag anklicken, um seine Personen hervorzuheben."
            : "Eintrag anklicken, um seine Personen hervorzuheben."}
      </p>
      <HelpLink to="herkunft" />
    </div>
  );
}
