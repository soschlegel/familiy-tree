"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "reactflow";

import {
  formatHistoryYears,
  HISTORY_KIND_LABEL,
  historyLanes,
  lastYear,
  type HistoryEvent,
} from "@/lib/history/events";
import { AI_UNCONFIRMED_LABEL } from "@/lib/history/origin";
import { HistoryAiNote } from "./HistoryAiNote";

/** Mindesthöhe einer Tippfläche (px). */
const TAP = 44;
/** Abstand der Bahnen (px) — Bänder überschneidender Ereignisse stehen nebeneinander. */
const LANE_GAP = 6;

type Axis = { minYear: number; maxYear: number; toY: (year: number) => number };

type Placed = { event: HistoryEvent; lane: number; y0: number; y1: number; single: boolean };
type Group = { key: string; events: HistoryEvent[]; y0: number; y1: number };

/**
 * Zeitgeschichte an der Jahresachse des Zeitstrahls (components/FamilyTree.tsx,
 * TimelineAxis): Zeiträume als schmales Band, Einzeljahre als Punkt — links in
 * der Achsenspalte, damit die Personenkarten frei bleiben. Ereignisse, die
 * sich zeitlich überschneiden, stehen in eigenen Bahnen nebeneinander.
 *
 * Bedienung: Je Gruppe sich überschneidender Ereignisse eine Schaltfläche
 * über die ganze Achsenbreite (mindestens 44 px hoch); Überfahren,
 * Fokussieren oder Antippen zeigt Titel, Jahre, Art und Beschreibung daneben.
 * Escape bzw. ein Klick daneben schließt. Liegen die Schaltflächen bei
 * kleinem Zoom übereinander, werden ihre Gruppen zusammengefasst.
 *
 * Leistung: wie die Achse liest die Komponente nur die Verschiebung aus
 * React Flow; der Baum selbst rendert dadurch nicht neu. Es sind höchstens
 * einige Dutzend Elemente.
 */
export function TimelineHistory({ events, axis }: { events: readonly HistoryEvent[]; axis: Axis }) {
  const [, ty, zoom] = useStore((s) => s.transform);
  const height = useStore((s) => s.height);
  const [active, setActive] = useState<{ key: string; pinned: boolean } | null>(null);

  // Weltkoordinaten: nur einmal je Datensatz bzw. Ereignisliste.
  const placed = useMemo((): Placed[] => {
    const visible = events.filter((e) => e.from <= axis.maxYear && lastYear(e) >= axis.minYear);
    return historyLanes(visible).map(({ event, lane }) => {
      const from = Math.max(event.from, axis.minYear);
      const to = Math.min(lastYear(event), axis.maxYear);
      return { event, lane, y0: axis.toY(from), y1: axis.toY(to + 1), single: event.to === null };
    });
  }, [events, axis]);

  // Gruppen zeitlich überschneidender Ereignisse (Weltkoordinaten).
  const worldGroups = useMemo((): Group[] => {
    const out: Group[] = [];
    let last = -Infinity;
    for (const p of [...placed].sort((a, b) => a.event.from - b.event.from)) {
      const g = out[out.length - 1];
      if (g && p.event.from <= last) {
        g.events.push(p.event);
        g.y1 = Math.max(g.y1, p.y1);
        last = Math.max(last, lastYear(p.event));
      } else {
        out.push({ key: p.event.id, events: [p.event], y0: p.y0, y1: p.y1 });
        last = lastYear(p.event);
      }
    }
    return out;
  }, [placed]);

  // Bildschirm: Schaltflächen mit Mindesthöhe; überlappende zusammenfassen.
  const groups: Group[] = [];
  for (const g of worldGroups) {
    const top = g.y0 * zoom + ty;
    const bottom = g.y1 * zoom + ty;
    const mid = (top + bottom) / 2;
    const h = Math.max(bottom - top, TAP);
    const box = { ...g, events: [...g.events], y0: mid - h / 2, y1: mid + h / 2 };
    const prev = groups[groups.length - 1];
    if (prev && box.y0 < prev.y1) {
      prev.events.push(...box.events);
      prev.y1 = Math.max(prev.y1, box.y1);
    } else {
      groups.push(box);
    }
  }

  const activeGroup = active ? groups.find((g) => g.key === active.key || g.events.some((e) => e.id === active.key)) : undefined;

  // Escape und Klick daneben schließen eine angetippte Anzeige.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-history-ui]")) setActive(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [active]);

  const label = (g: Group) => {
    const from = Math.min(...g.events.map((e) => e.from));
    const to = Math.max(...g.events.map(lastYear));
    const titles = g.events.map((e) => (e.aiUnconfirmed ? `${e.title} (${AI_UNCONFIRMED_LABEL})` : e.title));
    return `Zeitgeschichte ${formatHistoryYears({ from, to: to === from ? null : to })}: ${titles.join(", ")}`;
  };

  return (
    <div data-testid="tree-history" className="pointer-events-none absolute inset-y-0 left-0 z-[7] w-14">
      {/* Bänder und Punkte — reiner Schmuck; dieselbe Information tragen die Schaltflächen. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {placed.map((p) => {
          const top = p.y0 * zoom + ty;
          const bottom = p.y1 * zoom + ty;
          if (bottom < -20 || top > height + 20) return null;
          const left = 3 + p.lane * LANE_GAP;
          const highlighted = activeGroup?.events.some((e) => e.id === p.event.id);
          const color = highlighted ? "bg-amber-600 dark:bg-amber-300" : "bg-amber-600/55 dark:bg-amber-400/55";
          return p.single ? (
            <span
              key={p.event.id}
              data-testid="tree-history-mark"
              className={`absolute h-[7px] w-[7px] -translate-y-1/2 rounded-full ${color}`}
              style={{ left: left - 1, top: (top + bottom) / 2 }}
            />
          ) : (
            <span
              key={p.event.id}
              data-testid="tree-history-band"
              className={`absolute w-[4px] rounded-full ${color}`}
              style={{ left, top, height: Math.max(bottom - top, 4) }}
            />
          );
        })}
      </div>
      {groups.map((g) => {
        if (g.y1 < 0 || g.y0 > height) return null;
        const open = activeGroup === g;
        return (
          <button
            key={g.key}
            type="button"
            data-history-ui
            data-testid="tree-history-button"
            aria-label={label(g)}
            aria-expanded={open}
            aria-describedby={open ? "tree-history-tip" : undefined}
            className="pointer-events-auto absolute left-0 w-14 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600 dark:focus-visible:ring-amber-300"
            style={{ top: g.y0, height: g.y1 - g.y0 }}
            onMouseEnter={() => setActive((a) => (a?.pinned ? a : { key: g.key, pinned: false }))}
            onMouseLeave={() => setActive((a) => (a?.pinned ? a : null))}
            onFocus={() => setActive((a) => (a?.pinned && a.key === g.key ? a : { key: g.key, pinned: false }))}
            onBlur={() => setActive((a) => (a?.pinned ? a : null))}
            onClick={() => setActive((a) => (a?.key === g.key && a.pinned ? null : { key: g.key, pinned: true }))}
          />
        );
      })}
      {activeGroup && (
        <HistoryTip group={activeGroup} height={height} />
      )}
    </div>
  );
}

function HistoryTip({ group, height }: { group: Group; height: number }) {
  const mid = (group.y0 + group.y1) / 2;
  // In der unteren Hälfte nach oben aufklappen, damit die Anzeige im Bild bleibt;
  // oben Abstand zum Knopf „Vollbild“ (rechts oben, auf dem Telefon breit).
  const style = mid > height / 2 ? { bottom: Math.max(8, height - mid - 22) } : { top: Math.max(56, mid - 22) };
  const events = [...group.events].sort((a, b) => a.from - b.from || lastYear(a) - lastYear(b));
  return (
    <div
      id="tree-history-tip"
      role="tooltip"
      data-history-ui
      data-testid="tree-history-tip"
      className="pointer-events-auto absolute left-[3.75rem] w-72 max-w-[calc(100vw-5.5rem)] space-y-2 rounded-lg bg-white/95 p-3 text-xs text-stone-700 shadow-lift ring-1 ring-amber-200 backdrop-blur dark:bg-stone-900/95 dark:text-stone-200 dark:ring-amber-900"
      style={style}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Zeitgeschichte</p>
      {/* Bei kleinem Zoom fließen viele Ereignisse zusammen — die Liste rollt dann und muss per Tastatur erreichbar sein. */}
      <ul
        className="max-h-64 space-y-1.5 overflow-y-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:focus-visible:ring-amber-300"
        tabIndex={0}
        aria-label="Ereignisse"
      >
        {events.map((e) => (
          <li key={e.id}>
            <p className="font-medium text-stone-900 dark:text-stone-100">
              {e.title} <span className="font-normal tabular-nums muted">{formatHistoryYears(e)}</span>
              {e.aiUnconfirmed && <HistoryAiNote testId="tree-history-ai" className="ml-1" />}
            </p>
            <p className="muted">
              {HISTORY_KIND_LABEL[e.kind]}
              {e.region ? ` · gilt für ${e.region}` : ""}
              {e.description ? ` · ${e.description}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
