"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  arcLabelPlan,
  fitName,
  fitYears,
  isLowerHalf,
  labelArcPath,
  lineColorVar,
  lineTint,
  polar,
  radialRotation,
  ringGeometry,
  RINGS_MAX_GENERATION,
  RINGS_MIN_GENERATION,
  RINGS_VIEWBOX,
  ringsSummary,
  sectorPath,
  slotAngles,
  slotLine,
  truncate,
  type RingLabelPlan,
  type RingsColoring,
  type RingsDirection,
} from "@/lib/ancestor-rings";
import { chartColor } from "@/lib/chart-slices";
import { descendantsCapNotice, descendantsSummary } from "@/lib/descendant-rings";
import { FOCUS_COOKIE, type TreeView } from "@/lib/focus-tree";
import { LINE_CODE, LINE_KEYS, LINE_LABEL } from "@/lib/reference";
import type { AncestorRingsDto, RingPersonDto } from "@/lib/services/ancestor-rings";
import type { DescendantRingsDto } from "@/lib/services/descendant-rings";
import { HelpLink } from "./HelpLink";
import { treeUrl } from "./tree-url";
import { FULLSCREEN_BUTTON_CLASS, FullscreenIcon, TreeViewSwitch } from "./TreeViewSwitch";
import { useDismiss } from "./useDismiss";
import { useTreeFullscreen } from "./useTreeFullscreen";

/**
 * Ansicht „Ringe“ der Stammbaum-Seite: die Vorfahren (Ahnenfächer) bzw. mit
 * dem Umschalter „Nachfahren“ die Nachkommen einer Person als Vollkreis —
 * Mitte die Ausgangsperson, außen herum Ring für Ring die Generationen.
 * Eigenes Inline-SVG statt React-Flow-Fläche; die Werkzeugleiste (Suche,
 * Ansicht, Richtung, Generationen, Färbung) und der Vollbild-Knopf verhalten
 * sich wie in den übrigen Ansichten (FamilyTree). Beide Richtungen werden
 * zu denselben Flächen (Ring, Winkel, Art) umgerechnet und gleich
 * gezeichnet. Plätze, Geometrie und Beschriftungsregeln:
 * lib/ancestor-rings.ts bzw. lib/descendant-rings.ts; Daten und Rechte:
 * lib/services/ancestor-rings.ts bzw. lib/services/descendant-rings.ts.
 */

type Hit = { id: string; givenName: string; familyName: string | null; birthDate: string | null; deathDate: string | null };

const GENERATIONS = Array.from(
  { length: RINGS_MAX_GENERATION - RINGS_MIN_GENERATION + 1 },
  (_, i) => RINGS_MIN_GENERATION + i,
);

const COLORINGS: { value: RingsColoring; label: string; title: Record<RingsDirection, string> }[] = [
  {
    value: "linie",
    label: "nach Linie",
    title: { vorfahren: "Je Großelternteil ein Farbton, nach außen heller", nachfahren: "Je Kind ein Farbton, nach außen heller" },
  },
  {
    value: "wurzeln",
    label: "nach Wurzeln",
    title: {
      vorfahren: "Nach dem Land des Geburtsorts (fehlt er, des Taufortes)",
      nachfahren: "Nach dem Land des Geburtsorts (fehlt er, des Taufortes)",
    },
  },
];

const DIRECTIONS: { value: RingsDirection; label: string; title: string }[] = [
  { value: "vorfahren", label: "Vorfahren", title: "Eltern, Großeltern … von innen nach außen" },
  { value: "nachfahren", label: "Nachfahren", title: "Kinder, Enkel … von innen nach außen" },
];

type RingsData = AncestorRingsDto | DescendantRingsDto;

/** Eine Fläche, wie sie gezeichnet wird — gleich für beide Richtungen. */
type Segment = {
  key: string;
  generation: number;
  start: number;
  end: number;
  kind: "person" | "restricted";
  personId: string | null;
  term: string;
  /** Färbung „nach Wurzeln“: Schlüssel des Legendeneintrags. */
  area: string | null;
  /** Nachfahren: Fläche des Elternteils und ob adoptiert. */
  parentKey: string | null;
  adopted: boolean;
  /** Farbe für „nach Linie“ (ungemischt; die Stärke kommt aus lineTint). */
  lineColor: string;
};

/** Schlüssel eines Platzes; die Mitte heißt „root“. */
const slotKey = (generation: number, index: number) => `${generation}:${index}`;

const personName = (p: Pick<RingPersonDto, "givenName" | "familyName">) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

/** Mischung einer Farbe mit der Kartenfläche (Anteil in Prozent, im dunklen Schema gedämpft). */
const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} calc(${percent}% * var(--rings-strength)), rgb(var(--surface)))`;

const PARENT_COLORS = [
  `color-mix(in srgb, ${lineColorVar("FF")}, ${lineColorVar("FM")})`,
  `color-mix(in srgb, ${lineColorVar("MF")}, ${lineColorVar("MM")})`,
];

const ROOT_KEY = "root";

function useMediaQuery(query: string, initial: boolean) {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function AncestorRings({
  data,
  initialColoring,
}: {
  data: RingsData;
  /** Färbung beim Laden (`?farbe=wurzeln`). */
  initialColoring: RingsColoring;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [coloring, setColoring] = useState<RingsColoring>(initialColoring);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusVisible, setFocusVisible] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const fullscreen = useTreeFullscreen(overlayRef);
  const rootId = data.root.id;
  const n = data.generations;
  const direction: RingsDirection = data.direction;
  const desc = data.direction === "nachfahren" ? data : null;

  // Neue Ausgangsperson oder Tiefe: Auswahl aufheben (abgeleiteter Zustand).
  const [seen, setSeen] = useState(data);
  if (seen !== data) {
    setSeen(data);
    setSelected(null);
    setHover(null);
  }

  const tUrl = useCallback(
    (o: Partial<Parameters<typeof treeUrl>[0]> = {}) =>
      treeUrl({ view: "rings", focus: rootId, direction, generations: n, coloring, vollbild: fullscreen.on, ...o }),
    [rootId, direction, n, coloring, fullscreen.on],
  );

  const navigate = useCallback(
    (url: string, replace = false) => {
      startTransition(() => {
        if (replace) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      });
    },
    [router],
  );

  // Ausgangsperson merken (gleicher Speicher wie die Fokus-Ansicht) und die
  // Adresse vervollständigen, wenn der Server die Person selbst gewählt hat.
  useEffect(() => {
    try {
      document.cookie = `${FOCUS_COOKIE}=${encodeURIComponent(rootId)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // ohne Cookie beginnt die Ansicht beim nächsten Mal bei der Startperson
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") !== rootId) window.history.replaceState(null, "", tUrl());
    // Nur bei neuer Ausgangsperson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  function switchColoring(next: RingsColoring) {
    if (next === coloring) return;
    setColoring(next);
    // Die Daten sind dieselben — nur die Adresse nachführen (Neuladen, Teilen).
    window.history.replaceState(null, "", tUrl({ coloring: next }));
  }

  function switchDirection(next: RingsDirection) {
    if (next === direction) return;
    // Neue Daten; die Tiefe beginnt beim Standard der Richtung.
    navigate(treeUrl({ view: "rings", focus: rootId, direction: next, coloring, vollbild: fullscreen.on }));
  }

  function switchView(next: TreeView) {
    if (next === "rings") return;
    navigate(treeUrl({ view: next, focus: rootId, vollbild: fullscreen.on }));
  }

  // ---- Größe: der Kreis passt sich der Fläche an -------------------------
  const areaRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(560);
  useLayoutEffect(() => {
    const area = areaRef.current;
    const chart = chartRef.current;
    if (!area || !chart) return;
    const measure = () => {
      // Unter dem Kreis steht die Zusammenfassung (ca. 3 rem).
      const s = Math.floor(Math.min(chart.clientWidth - 12, area.clientHeight - 56));
      setSize(Math.max(240, Math.min(s, 1400)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(chart);
    return () => ro.disconnect();
  }, [fullscreen.on]);

  // Gezeigte Ringe: bei den Nachfahren nur so viele, wie es Generationen
  // gibt (mindestens drei) — sonst blieben außen leere Ringe stehen.
  const ringCount = desc ? Math.max(RINGS_MIN_GENERATION, Math.min(desc.shownGenerations, desc.deepest)) : n;
  const geometry = useMemo(() => ringGeometry(ringCount), [ringCount]);

  // Beide Richtungen als dieselben Flächen.
  const segments = useMemo<Segment[]>(() => {
    if (data.direction === "nachfahren") {
      return data.segments.map((s) => ({
        key: s.key,
        generation: s.generation,
        start: s.start,
        end: s.end,
        kind: s.kind,
        personId: s.kind === "person" ? s.personId : null,
        term: s.term,
        area: s.kind === "person" ? s.area : null,
        parentKey: s.parentKey,
        adopted: s.kind === "person" && s.adopted,
        lineColor: chartColor(s.line),
      }));
    }
    return data.slots.map((s) => {
      const { start, end } = slotAngles(s.generation, s.index);
      const line = slotLine(s.generation, s.index);
      return {
        key: slotKey(s.generation, s.index),
        generation: s.generation,
        start,
        end,
        kind: s.kind,
        personId: s.kind === "person" ? s.personId : null,
        term: s.term,
        area: s.kind === "person" ? s.area : null,
        parentKey: null,
        adopted: false,
        lineColor: line ? lineColorVar(line) : (PARENT_COLORS[s.index] ?? PARENT_COLORS[0]),
      };
    });
  }, [data]);

  const segmentByKey = useMemo(() => new Map(segments.map((s) => [s.key, s])), [segments]);

  const areaByKey = useMemo(() => new Map(data.areas.map((a) => [a.key, a])), [data.areas]);

  const fillOf = useCallback(
    (s: Segment): string => {
      if (s.kind === "restricted") return `url(#${uid}-hatch)`;
      if (coloring === "wurzeln") {
        const area = s.area ?? "unknown";
        const color = areaByKey.get(area)?.color ?? "var(--chart-unknown)";
        return tint(color, area.startsWith("area:") ? 55 : 70);
      }
      return tint(s.lineColor, lineTint(s.generation));
    },
    [coloring, areaByKey, uid],
  );

  // ---- Auswahl und Anzeige ------------------------------------------------
  const shownKey = hover ?? focusKey ?? selected;
  const panelRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery("(min-width: 768px)", true);
  const [focusPanel, setFocusPanel] = useState(false);
  useEffect(() => {
    if (!focusPanel) return;
    setFocusPanel(false);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [focusPanel]);

  function select(key: string, viaKeyboard: boolean) {
    setSelected(key);
    // Mit der Tastatur gleich zu den Wegen „Zur Person“ / „In die Mitte“.
    if (viaKeyboard) setFocusPanel(true);
  }

  const slotHandlers = (key: string) => ({
    onClick: () => select(key, false),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(key, true);
      }
    },
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
    onFocus: (e: React.FocusEvent<SVGGElement>) => {
      setFocusKey(key);
      let visible = true;
      try {
        visible = e.currentTarget.matches(":focus-visible");
      } catch {
        // ältere Browser: Fokus immer zeigen
      }
      setFocusVisible(visible);
    },
    onBlur: () => setFocusKey((f) => (f === key ? null : f)),
  });

  // Zurück zum Platz, wenn im Feld Escape gedrückt wird.
  function onPanelKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !selected) return;
    e.preventDefault();
    const target = overlayRef.current?.querySelector<SVGGElement>(`[data-slot="${selected}"]`);
    target?.focus();
  }

  const centerTo = (id: string) => navigate(tUrl({ focus: id }));

  // ---- Zeichnen -----------------------------------------------------------
  const C = geometry.center;
  const pxPerUnit = size / RINGS_VIEWBOX;
  const slots: ReactNode[] = [];
  const gaps: ReactNode[] = [];
  const labels: ReactNode[] = [];
  // Vorfahren: leere Plätze gestrichelt (die Nachfahren haben keine festen Plätze).
  if (!desc) {
    for (const ring of geometry.rings) {
      for (let i = 0; i < 2 ** ring.generation; i++) {
        const key = slotKey(ring.generation, i);
        if (segmentByKey.has(key)) continue;
        const { start, end } = slotAngles(ring.generation, i);
        gaps.push(
          <path
            key={key}
            d={sectorPath(C, ring.inner, ring.outer, start, end)}
            className="rings-gap"
            style={{ fill: "color-mix(in srgb, var(--rings-gap) 10%, transparent)", stroke: "var(--rings-gap)" }}
            strokeWidth={1}
            strokeDasharray="3 5"
          />,
        );
      }
    }
  }
  for (const s of segments) {
    const ring = geometry.rings[s.generation - 1];
    if (!ring) continue;
    const key = s.key;
    const { start, end } = s;
    const mid = (start + end) / 2;
    const plan = arcLabelPlan(ring, (end - start) / 360, pxPerUnit);
    const d = sectorPath(C, ring.inner, ring.outer, start, end);
    const person = s.personId ? data.persons[s.personId] : null;
    const name = person ? personName(person) : "Nicht freigegeben";
    const life = person?.lifeSpan ?? "";
    const label = [name, life, s.term].filter(Boolean).join(", ");
    // Mittelpunkt der Fläche (viewBox) — für Tests, die genau dort klicken.
    const anchor = polar(C, (ring.inner + ring.outer) / 2, mid);
    const lines = person
      ? [fitName(person.givenName, person.familyName, plan.maxChars), plan.lines > 1 ? fitYears(life, Math.floor(plan.maxChars * 1.12)) : ""]
      : [truncate("Nicht freigegeben", plan.maxChars), ""];
    slots.push(
      <g
        key={key}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={selected === key}
        data-slot={key}
        data-testid="rings-slot"
        data-kind={s.kind}
        data-generation={s.generation}
        data-x={anchor.x}
        data-y={anchor.y}
        className="cursor-pointer outline-none"
        {...slotHandlers(key)}
      >
        {/* Sehr schmale Bögen: dünnerer Rand, damit von der Fläche etwas bleibt. */}
        <path d={d} style={{ fill: fillOf(s), stroke: "rgb(var(--surface))" }} strokeWidth={end - start < 2 ? 0.75 : 1.5} />
      </g>,
    );
    // Beschriftung in eigener, verborgener Ebene: Der zugängliche Name der
    // Fläche nennt alles ausführlich; die (oft gekürzte) Schrift gehört
    // nicht hinein. Vollkreis (ein einziges Kind): Beschriftung oben mittig.
    if (plan.mode !== "none" && lines[0]) {
      labels.push(
        <SlotLabel key={key} uid={uid} slotId={key} plan={plan} center={C} inner={ring.inner} outer={ring.outer} {...(end - start >= 359.99 ? { start: 90, end: 450, mid: 270 } : { start, end, mid })} lines={lines} restricted={s.kind === "restricted"} />,
      );
    }
  }

  // Rahmen für Auswahl, Tastaturfokus und Zeiger — oben drauf, damit sie
  // nicht von den Nachbarflächen verdeckt werden.
  const outline = (key: string | null, kind: "selected" | "focus" | "hover") => {
    if (!key) return null;
    let d: string;
    if (key === ROOT_KEY) {
      const r = geometry.centerRadius;
      d = `M${C - r} ${C}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    } else {
      const s = segmentByKey.get(key);
      const ring = s ? geometry.rings[s.generation - 1] : undefined;
      if (!s || !ring) return null;
      d = sectorPath(C, ring.inner, ring.outer, s.start, s.end);
    }
    const style =
      kind === "selected"
        ? { stroke: "rgb(var(--accent-700))", strokeWidth: 5 }
        : kind === "focus"
          ? { stroke: "rgb(var(--accent-500))", strokeWidth: 4, strokeDasharray: "8 5" }
          : { stroke: "var(--rings-ink)", strokeWidth: 2 };
    return <path key={kind} d={d} fill="none" pointerEvents="none" data-testid={`rings-outline-${kind}`} {...style} />;
  };

  const rootPerson = data.root;
  const rootName = personName(rootPerson);
  // Mitte: Vorname, Nachname, Lebensjahre — mindestens 12 px groß, höchstens
  // so groß, dass drei Zeilen in den Kreis passen.
  const centerFont = Math.min(Math.max(12 / (size / RINGS_VIEWBOX), 22), geometry.centerRadius * 0.42);
  const centerChars = Math.floor((geometry.centerRadius * 1.6) / (centerFont * 0.58));
  const centerRows = [
    { text: truncate(rootPerson.givenName, centerChars), size: centerFont, weight: 600 },
    ...(rootPerson.familyName ? [{ text: truncate(rootPerson.familyName, centerChars), size: centerFont, weight: 600 }] : []),
    ...(rootPerson.lifeSpan
      ? [{ text: fitYears(rootPerson.lifeSpan, Math.floor(centerChars * 1.2)), size: centerFont * 0.82, weight: 400 }]
      : []),
  ].filter((r) => r.text);
  // Grundlinien so, dass der Block mittig steht (Zeilenhöhe 1,15).
  const centerTop = C - (centerRows.length * centerFont * 1.15) / 2 + centerFont * 0.85;

  const summary =
    data.direction === "nachfahren"
      ? descendantsSummary(data.count, data.deepest, data.restricted)
      : ringsSummary(n, data.known, data.restricted);
  const what = desc ? "Nachfahren" : "Vorfahren";

  const panel = (
    <InfoPanel
      shownKey={shownKey}
      selected={selected}
      data={data}
      segmentByKey={segmentByKey}
      segments={segments}
      areaLabel={(key) => areaByKey.get(key)?.label ?? null}
      coloring={coloring}
      rootName={rootName}
      onCenter={centerTo}
    />
  );

  return (
    <div
      ref={overlayRef}
      data-testid="tree-shell"
      data-fullscreen={fullscreen.on ? "true" : undefined}
      className={
        fullscreen.on
          ? "fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-paper pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]"
          : "flex flex-1 flex-col gap-2"
      }
    >
      <div className={`flex flex-wrap items-start gap-2 ${fullscreen.on ? "hidden" : ""}`} role="toolbar" aria-label="Baumansicht">
        <RingsSearch onPick={centerTo} />
        <TreeViewSwitch active="rings" onSwitch={switchView} className="max-sm:order-1" />
        <div
          role="group"
          aria-label="Richtung"
          className="flex overflow-hidden rounded-lg border border-stone-300 bg-surface text-sm max-sm:order-2 dark:border-stone-700"
        >
          {DIRECTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.title}
              aria-pressed={direction === c.value}
              data-testid={`rings-direction-${c.value}`}
              onClick={() => switchDirection(c.value)}
              className={`px-2.5 py-1.5 transition max-md:min-h-11 sm:px-3 ${
                direction === c.value
                  ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                  : "hover:bg-stone-100 dark:hover:bg-stone-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-surface py-1 pl-3 pr-1 text-sm max-md:py-0 max-sm:order-1 dark:border-stone-700">
          <label htmlFor="rings-generations" className="muted">
            <span className="max-sm:sr-only">Generationen</span>
            <span aria-hidden className="sm:hidden">Gen.</span>
          </label>
          <select
            id="rings-generations"
            data-testid="rings-generations"
            value={n}
            onChange={(e) => navigate(tUrl({ generations: Number(e.target.value) }), true)}
            className="rounded-md bg-transparent py-0.5 pl-1 pr-1 font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 max-md:min-h-11 max-md:min-w-11 max-md:text-base"
          >
            {GENERATIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div
          role="group"
          aria-label="Färbung"
          className="flex overflow-hidden rounded-lg border border-stone-300 bg-surface text-sm max-sm:order-2 dark:border-stone-700"
        >
          {COLORINGS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.title[direction]}
              aria-pressed={coloring === c.value}
              data-testid={`rings-coloring-${c.value}`}
              onClick={() => switchColoring(c.value)}
              className={`px-2.5 py-1.5 transition max-md:min-h-11 sm:px-3 ${
                coloring === c.value
                  ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                  : "hover:bg-stone-100 dark:hover:bg-stone-800"
              }`}
            >
              {/* Telefon: kurz „Linie“/„Wurzeln“, damit Richtung, Färbung und „?“ in eine Zeile passen. */}
              <span className="max-sm:sr-only">nach </span>
              {c.label.replace(/^nach /, "")}
            </button>
          ))}
        </div>
        <HelpLink to="ringe" compact label="Wie funktioniert die Ansicht „Ringe“?" className="self-center max-sm:order-2" />
      </div>

      <div
        data-testid="ancestor-rings"
        data-view="rings"
        data-focus-id={rootId}
        data-direction={direction}
        data-coloring={coloring}
        aria-busy={pending}
        className={`relative w-full flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_top,rgb(var(--surface)),rgb(var(--paper))_70%)] ${
          fullscreen.on ? "min-h-0" : "min-h-[320px] rounded-2xl border border-stone-200 shadow-card md:min-h-[420px] dark:border-stone-800"
        }`}
      >
        {/* Auf dem Telefon rollt die Fläche senkrecht (Kreis, darunter Angaben
            und Legende); der Vollbild-Knopf bleibt dabei oben rechts stehen. */}
        <div ref={areaRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col md:h-full md:flex-row">
          <div ref={chartRef} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1.5 pb-2 pt-2 md:order-2">
            <svg
              viewBox={`0 0 ${RINGS_VIEWBOX} ${RINGS_VIEWBOX}`}
              width={size}
              height={size}
              role="group"
              aria-label={`${what} von ${rootName} in Ringen, ${geometry.rings.length} Generationen`}
              data-testid="rings-chart"
              className="block max-w-full touch-manipulation select-none"
            >
              <defs>
                <pattern id={`${uid}-hatch`} patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
                  <rect width="14" height="14" style={{ fill: "var(--rings-restricted)" }} />
                  <line x1="0" y1="0" x2="0" y2="14" style={{ stroke: "var(--rings-hatch)" }} strokeWidth="5" />
                </pattern>
              </defs>
              <g aria-hidden>{gaps}</g>
              <g
                role="button"
                tabIndex={0}
                aria-label={`Ausgangsperson: ${[rootName, rootPerson.lifeSpan].filter(Boolean).join(", ")}`}
                aria-pressed={selected === ROOT_KEY}
                data-slot={ROOT_KEY}
                data-testid="rings-root"
                className="cursor-pointer outline-none"
                {...slotHandlers(ROOT_KEY)}
              >
                <circle cx={C} cy={C} r={geometry.centerRadius} style={{ fill: "rgb(var(--surface))", stroke: "rgb(var(--accent-500))" }} strokeWidth={3} />
              </g>
              {slots}
              <g aria-hidden pointerEvents="none" data-testid="rings-labels">
                {centerRows.map((row, k) => (
                  <text
                    key={k}
                    x={C}
                    y={centerTop + k * centerFont * 1.15}
                    textAnchor="middle"
                    fontSize={row.size}
                    fontWeight={row.weight}
                    style={{ fill: "var(--rings-ink)" }}
                  >
                    {row.text}
                  </text>
                ))}
                {labels}
              </g>
              {outline(hover, "hover")}
              {focusVisible && outline(focusKey, "focus")}
              {outline(selected, "selected")}
            </svg>
            <p className="px-2 text-center text-sm muted" data-testid="rings-summary">
              {summary}
            </p>
            {desc?.capped && (
              <p role="note" className="max-w-md px-2 text-center text-xs text-amber-800 dark:text-amber-300" data-testid="rings-capped">
                {descendantsCapNotice(desc.shownGenerations, desc.generations)}
              </p>
            )}
            <p className="px-2 text-center text-xs muted md:hidden">Tippe auf eine Fläche: Name, Lebensdaten und Verwandtschaft erscheinen unten.</p>
          </div>

          <aside className="flex shrink-0 flex-col gap-3 p-3 md:order-1 md:w-72 md:overflow-y-auto md:border-r md:border-stone-200 md:dark:border-stone-800">
            {/* Breite Bildschirme: Angaben links neben dem Kreis. */}
            <div
              ref={wide ? panelRef : undefined}
              onKeyDown={onPanelKeyDown}
              data-testid="rings-info"
              className="rounded-lg bg-white/95 p-3 text-sm shadow-sm ring-1 ring-stone-200 backdrop-blur max-md:hidden dark:bg-stone-900/95 dark:ring-stone-800"
            >
              {panel}
            </div>
            <Legend data={data} coloring={coloring} uid={uid} />
          </aside>
        </div>
        </div>

        {/* Telefon: Angaben als Karte unten über dem Kreis, sobald etwas
            angetippt bzw. fokussiert ist — unter dem Kreis wären sie oft
            außer Sicht. */}
        {shownKey && (
          <div
            ref={wide ? undefined : panelRef}
            onKeyDown={onPanelKeyDown}
            data-testid="rings-info-mobile"
            className="absolute inset-x-2 bottom-2 z-10 flex items-start gap-2 rounded-lg bg-white/95 p-3 text-sm shadow-lift ring-1 ring-stone-200 backdrop-blur md:hidden dark:bg-stone-900/95 dark:ring-stone-800"
          >
            <div className="min-w-0 flex-1">{panel}</div>
            <button
              type="button"
              aria-label="Angaben schließen"
              data-testid="rings-info-close"
              onClick={() => {
                setSelected(null);
                setHover(null);
              }}
              className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        )}

        <button
          type="button"
          data-testid="tree-fullscreen"
          aria-pressed={fullscreen.on}
          onClick={fullscreen.toggle}
          title={fullscreen.on ? "Zurück zur normalen Ansicht (Escape)" : "Ringe bildschirmfüllend zeigen"}
          className={FULLSCREEN_BUTTON_CLASS}
        >
          <FullscreenIcon exit={fullscreen.on} />
          {fullscreen.on ? "Vollbild beenden" : "Vollbild"}
        </button>

        {pending && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/95 dark:ring-stone-800"
          >
            Lädt …
          </div>
        )}
      </div>
    </div>
  );
}

/** Beschriftung eines Platzes: im Bogen oder entlang des Radius, nie auf dem Kopf. */
function SlotLabel({
  uid,
  slotId,
  plan,
  center,
  inner,
  outer,
  start,
  end,
  mid,
  lines,
  restricted,
}: {
  uid: string;
  slotId: string;
  plan: RingLabelPlan;
  center: number;
  inner: number;
  outer: number;
  start: number;
  end: number;
  mid: number;
  lines: string[];
  restricted: boolean;
}) {
  const fs = plan.fontSize;
  const two = plan.lines > 1 && Boolean(lines[1]);
  const rMid = (inner + outer) / 2;
  const textStyle = { fill: "var(--rings-ink)" };
  // Versatz „nach oben“ (zur Oberkante der Schrift) je Zeile: Grundlinie so,
  // dass die Zeile(n) mittig im Ring stehen.
  const rows = two
    ? [
        { text: lines[0], up: 0.22 * fs, size: fs, weight: restricted ? 400 : 600 },
        { text: lines[1], up: -0.88 * fs, size: fs * 0.88, weight: 400 },
      ]
    : [{ text: lines[0], up: -0.35 * fs, size: fs, weight: restricted ? 400 : 600 }];

  if (plan.mode === "arc") {
    const lower = isLowerHalf(mid);
    return (
      <g>
        {rows.map((row, k) => {
          // Oben zeigt die Schrift nach außen, unten (umgekehrter Pfad) nach innen.
          const r = lower ? rMid - row.up : rMid + row.up;
          const pad = ((fs * 0.5) / r) * (180 / Math.PI);
          const id = `${uid}-t-${slotId.replace(":", "-")}-${k}`;
          return (
            <g key={k}>
              <defs>
                <path id={id} d={labelArcPath(center, r, start + pad, end - pad)} />
              </defs>
              <text fontSize={row.size} fontWeight={row.weight} style={textStyle}>
                <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
                  {row.text}
                </textPath>
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  const p = polar(center, rMid, mid);
  const rot = radialRotation(mid);
  return (
    <g transform={`rotate(${rot} ${p.x} ${p.y})`}>
      {rows.map((row, k) => (
        <text key={k} x={p.x} y={p.y - row.up} fontSize={row.size} fontWeight={row.weight} textAnchor="middle" style={textStyle}>
          {row.text}
        </text>
      ))}
    </g>
  );
}

function InfoPanel({
  shownKey,
  selected,
  data,
  segmentByKey,
  segments,
  areaLabel,
  coloring,
  rootName,
  onCenter,
}: {
  shownKey: string | null;
  selected: string | null;
  data: RingsData;
  segmentByKey: Map<string, Segment>;
  segments: Segment[];
  areaLabel: (key: string) => string | null;
  coloring: RingsColoring;
  rootName: string;
  onCenter: (id: string) => void;
}) {
  if (!shownKey) {
    return (
      <p className="muted" data-testid="rings-hint">
        Fahre über eine Fläche oder tippe sie an: Name, Lebensdaten und Verwandtschaft erscheinen hier.
      </p>
    );
  }
  const isSelected = shownKey === selected;
  const slot = shownKey === ROOT_KEY ? null : segmentByKey.get(shownKey);
  if (shownKey !== ROOT_KEY && !slot) return null;

  if (slot?.kind === "restricted") {
    return (
      <div aria-live="polite">
        <p className="font-semibold">Nicht freigegeben</p>
        <p className="muted">{slot.term} von {rootName}</p>
        <p className="mt-1 text-xs muted">Diese Person gehört zu einer Familie, für die du keine Freigabe hast.</p>
      </div>
    );
  }

  const person = slot?.personId ? data.persons[slot.personId] : data.root;
  const dates = [person.born && `* ${person.born}`, person.died && `† ${person.died}`].filter(Boolean).join("  ");
  const area = slot?.area && coloring === "wurzeln" ? areaLabel(slot.area) : null;
  // Nachfahren: über wen (bei Enkeln und weiter), Adoption, Partner, mehrfach im Kreis.
  const desc = data.direction === "nachfahren" ? data : null;
  const parentSeg = slot?.parentKey ? segmentByKey.get(slot.parentKey) : null;
  const parent = desc && slot ? (parentSeg?.personId ? data.persons[parentSeg.personId] : slot.generation === 1 ? data.root : null) : null;
  const via =
    parent && slot && (slot.adopted || slot.generation > 1)
      ? `${slot.adopted ? "Adoptivkind" : "Kind"} von ${personName(parent)}`
      : null;
  const partners = desc ? (desc.partners[person.id] ?? []) : [];
  const times = desc && slot ? segments.filter((s) => s.personId === person.id).length : 0;
  return (
    <div aria-live="polite" data-testid="rings-info-person">
      <p className="font-semibold">{personName(person)}</p>
      {dates && <p className="text-xs">{dates}</p>}
      <p className="muted">{slot ? `${slot.term} von ${rootName}` : "Ausgangsperson in der Mitte"}</p>
      {via && (
        <p className="text-xs muted" data-testid="rings-info-via">
          {via}
        </p>
      )}
      {partners.length > 0 && (
        <p className="text-xs muted" data-testid="rings-info-partners">
          Partner: {partners.join(", ")}
        </p>
      )}
      {times > 1 && <p className="text-xs muted">Erscheint {times}-mal im Kreis — Nachkomme über mehrere Linien.</p>}
      {area && <p className="text-xs muted">Geburtsort: {area}</p>}
      {isSelected && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/people/${person.id}`} className="btn-secondary font-normal max-md:min-h-11" data-testid="rings-open">
            Zur Person
          </Link>
          {slot && (
            <button type="button" className="btn-primary max-md:min-h-11" data-testid="rings-center" onClick={() => onCenter(person.id)}>
              In die Mitte
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ data, coloring, uid }: { data: RingsData; coloring: RingsColoring; uid: string }) {
  const swatch = (style: React.CSSProperties) => (
    <svg width="16" height="16" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="3" style={style} strokeWidth={1} />
    </svg>
  );
  if (data.direction === "nachfahren") return <DescendantLegend data={data} coloring={coloring} uid={uid} swatch={swatch} />;
  const gp = (index: number) => data.slots.find((s) => s.generation === 2 && s.index === index);
  return (
    <div className="rounded-lg bg-white/95 p-3 text-xs text-stone-600 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/95 dark:text-stone-300 dark:ring-stone-800" data-testid="rings-legend">
      <p className="mb-1.5 font-medium text-stone-800 dark:text-stone-100">{coloring === "linie" ? "Farben nach Linie" : "Farben nach Wurzeln (Land des Geburtsorts)"}</p>
      <ul className="space-y-1">
        {coloring === "linie"
          ? LINE_KEYS.map((k, i) => {
              const s = gp(i);
              const who = !s ? "nicht erfasst" : s.kind === "restricted" ? "nicht freigegeben" : personName(data.persons[s.personId]);
              return (
                <li key={k} className="flex items-center gap-2">
                  {swatch({ fill: tint(lineColorVar(k), 50) })}
                  <span className="w-6 shrink-0 font-semibold">{LINE_CODE[k]}</span>
                  <span className="min-w-0">
                    {LINE_LABEL[k]}: <span className="text-stone-800 dark:text-stone-100">{who}</span>
                  </span>
                </li>
              );
            })
          : data.areas
              .filter((a) => a.key !== "restricted")
              .map((a) => (
                <li key={a.key} className="flex items-center gap-2" title={a.members?.join(", ")}>
                  {swatch({ fill: tint(a.color, a.key.startsWith("area:") ? 55 : 70) })}
                  <span className="min-w-0 flex-1">{a.label}</span>
                  <span className="tabular-nums">{a.count}</span>
                </li>
              ))}
        <li className="flex items-center gap-2">
          {swatch({ fill: `url(#${uid}-hatch)` })}
          <span className="min-w-0 flex-1">nicht freigegeben</span>
          {coloring === "wurzeln" && data.restricted > 0 && <span className="tabular-nums">{data.restricted}</span>}
        </li>
        <li className="flex items-center gap-2">
          {swatch({ fill: "color-mix(in srgb, var(--rings-gap) 10%, transparent)", stroke: "var(--rings-gap)", strokeDasharray: "3 3" })}
          <span>nicht erfasst</span>
        </li>
      </ul>
      {coloring === "linie" && <p className="mt-1.5 muted">Nach außen heller. Vater und Mutter in den Mischfarben ihrer Seite.</p>}
    </div>
  );
}

/** Legende der Nachfahren: je Kind der Mitte ein Farbton bzw. nach Land. */
function DescendantLegend({
  data,
  coloring,
  uid,
  swatch,
}: {
  data: DescendantRingsDto;
  coloring: RingsColoring;
  uid: string;
  swatch: (style: React.CSSProperties) => ReactNode;
}) {
  const anyRestricted = data.restricted > 0;
  // „nach Linie“ nennt gesperrte Kinder der Mitte schon als eigene Linie;
  // ein eigener Eintrag nur für gesperrte Flächen weiter außen.
  const deeperRestricted = data.segments.some((s) => s.kind === "restricted" && s.generation > 1);
  return (
    <div className="rounded-lg bg-white/95 p-3 text-xs text-stone-600 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/95 dark:text-stone-300 dark:ring-stone-800" data-testid="rings-legend">
      <p className="mb-1.5 font-medium text-stone-800 dark:text-stone-100">
        {coloring === "linie" ? "Farben nach Linie (je Kind)" : "Farben nach Wurzeln (Land des Geburtsorts)"}
      </p>
      <ul className="space-y-1">
        {coloring === "linie"
          ? data.lines.map((l) => (
              <li key={l.line} className="flex items-center gap-2">
                {swatch({ fill: l.personId ? tint(l.color, 50) : `url(#${uid}-hatch)` })}
                <span className="min-w-0 flex-1 text-stone-800 dark:text-stone-100">
                  {l.personId ? personName(data.persons[l.personId]) : "nicht freigegeben"}
                </span>
                <span className="tabular-nums" title="Flächen dieser Linie: das Kind und seine Nachkommen">
                  {l.count}
                </span>
              </li>
            ))
          : data.areas
              .filter((a) => a.key !== "restricted")
              .map((a) => (
                <li key={a.key} className="flex items-center gap-2" title={a.members?.join(", ")}>
                  {swatch({ fill: tint(a.color, a.key.startsWith("area:") ? 55 : 70) })}
                  <span className="min-w-0 flex-1">{a.label}</span>
                  <span className="tabular-nums">{a.count}</span>
                </li>
              ))}
        {(coloring === "wurzeln" || deeperRestricted) && (
          <li className="flex items-center gap-2">
            {swatch({ fill: `url(#${uid}-hatch)` })}
            <span className="min-w-0 flex-1">nicht freigegeben</span>
            {coloring === "wurzeln" && anyRestricted && <span className="tabular-nums">{data.restricted}</span>}
          </li>
        )}
      </ul>
      {coloring === "linie" && data.lines.length > 0 && (
        <p className="mt-1.5 muted">
          Nach außen heller.
          {data.lines.length > 8 ? " Bei mehr als acht Kindern wiederholen sich die Farben — jede Fläche nennt ihren Namen." : ""}
        </p>
      )}
    </div>
  );
}

/** Suchfeld: ein Treffer wird Ausgangsperson der Ringe (wie die Suche der Fokus-Ansicht). */
function RingsSearch({ onPick }: { onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<{ q: string; hits: Hit[] } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    if (!needle) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?q=${encodeURIComponent(needle)}&limit=8`, { signal: controller.signal });
        if (!res.ok) return;
        setResult({ q: needle, hits: (await res.json()) as Hit[] });
      } catch {
        // abgebrochen oder offline — die Liste bleibt leer
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle]);

  const hits = result?.q === needle ? result.hits.slice(0, 8) : [];
  const loading = Boolean(needle) && result?.q !== needle;
  useEffect(() => setCursor(0), [needle]);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [boxRef], inputRef);

  function pick(i: number) {
    const hit = hits[i];
    if (!hit) return;
    setOpen(false);
    setQuery("");
    onPick(hit.id);
  }

  return (
    <div className="relative w-full sm:w-64" ref={boxRef}>
      <label htmlFor="tree-search" className="sr-only">
        Person suchen und in die Mitte der Ringe stellen
      </label>
      <input
        id="tree-search"
        type="search"
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(cursor);
          } else if (e.key === "Escape") {
            if (!open) setQuery("");
          }
        }}
        placeholder="Person suchen…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="tree-search-results"
        aria-activedescendant={hits.length > 0 ? `tree-hit-${cursor}` : undefined}
        className="field w-full"
      />
      {needle && open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-stone-300 bg-surface shadow-lift dark:border-stone-700">
          <p className="border-b border-stone-200 px-3 py-1.5 text-xs muted dark:border-stone-800" aria-live="polite">
            {loading ? "Suche …" : hits.length === 0 ? "Kein Treffer" : "Auswählen stellt in die Mitte"}
          </p>
          {hits.length > 0 && (
            <ul id="tree-search-results" role="listbox" aria-label="Suchtreffer">
              {hits.map((h, i) => (
                <li
                  key={h.id}
                  id={`tree-hit-${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm max-md:py-3 ${i === cursor ? "bg-stone-100 dark:bg-stone-800" : ""}`}
                >
                  <span className="truncate font-medium">{personName(h)}</span>
                  <span className="ml-auto shrink-0 text-xs muted">
                    {[h.birthDate?.slice(0, 4), h.deathDate?.slice(0, 4)].filter(Boolean).join(" – ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
