"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { LINE_CODE, LINE_KEYS, LINE_LABEL, type LineKey } from "@/lib/reference";
import { linesFromBits, type MapPayload, type MapPerson } from "@/lib/map/build";
import { fitViewBox, project, VIEWS, zoomAt, type ViewBox, type ViewName } from "@/lib/map/projection";
import {
  aliveByYear,
  clampYear,
  eventsInYear,
  formatAge,
  groupLivedByPlace,
  livedInYear,
  parseYearInput,
  placeLabelOf,
  snapshot,
  sortLived,
  type LivedEntry,
  type LivedSort,
  type PlaceGroup,
  type YearEvents,
} from "@/lib/map/year";
import { loadCountries, type Country } from "@/lib/map/countries";
import { HelpLink } from "./HelpLink";
import { LineCode } from "./ReferenceLines";
import { HistoryToggle, useHistoryToggle } from "./HistoryToggle";
import { HistoryAiNote } from "./HistoryAiNote";
import { AI_UNCONFIRMED_LABEL } from "@/lib/history/origin";
import {
  eventsInYear as historyInYear,
  formatHistoryYears,
  HISTORY_KIND_LABEL,
  historyLanes,
  lastYear,
  type HistoryEvent,
} from "@/lib/history/events";

/**
 * Karte „Wurzeln nach Jahr“ (docs/fachlich/karte-und-orte.md): eigene SVG-Karte
 * ohne fremde Server — Ländergrenzen aus public/geo/countries.json (Natural
 * Earth, bereits projiziert), Kreise je Ort für das gewählte Jahr. Die Daten
 * aller Jahre kommen einmal vom Server; Jahreswechsel und Abspielen rechnen
 * nur im Browser (lib/map/year.ts).
 *
 * Bedienung: Ziehen (auch mit einem Finger) verschiebt, Mausrad bzw. zwei
 * Finger zoomen, dazu Knöpfe und Tastatur (Pfeile, +/−) auf der Karte. Für
 * Screenreader und Tastatur steht dieselbe Information in der Ortsliste
 * darunter.
 *
 * Zeitreise: Zeitstrahl-Regler über die ganze Spanne (normales Schiebefeld,
 * dazu Bild-auf/-ab ±10), Schritt-Knöpfe ±1/±10, Jahreseingabe, „Abspielen“
 * (Pause/Weiter; bei „Bewegung reduzieren“ nur Schritte). Daneben die Liste
 * „Wer lebte …?“ (Alter, Ort, nach Ort gruppiert oder sortiert; ein gewählter
 * Ort filtert sie) und die Zeile „In diesem Jahr“ (Geburten, Hochzeiten,
 * Todesfälle) — alles aus denselben, einmal geladenen Daten.
 */

/** Bewegung reduzieren (Betriebssystem bzw. Browser). */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** So viele Zeilen zeigt „Wer lebte …?“ zunächst. */
const LIST_LIMIT = 100;

const lineColor = (k: LineKey | "none") => (k === "none" ? "var(--map-neutral)" : `var(--line-${k.toLowerCase()})`);
const CATEGORIES: (LineKey | "none")[] = [...LINE_KEYS, "none"];

/** Kreisradius in Bildschirmpunkten: Fläche wächst mit der Anzahl. */
const radiusPx = (n: number) => Math.min(70, 3 + 3.6 * Math.sqrt(n));

const SPEEDS = [
  { label: "langsam", ms: 400 },
  { label: "normal", ms: 160 },
  { label: "schnell", ms: 60 },
];

type Selection = { kind: "place"; place: number } | { kind: "noPlace" } | { kind: "unmapped" } | null;

export function MapExplorer({
  payload,
  initialYear,
  grandparents,
  showLines,
  history = [],
  initialHistory = true,
}: {
  payload: MapPayload;
  initialYear: number;
  grandparents: Record<LineKey, { id: string; name: string } | null> | null;
  showLines: boolean;
  /** Zeitgeschichte (lib/services/history.ts) — Zeile zum Jahr und Marken am Zeitstrahl. */
  history?: HistoryEvent[];
  /** Schalter „Zeitgeschichte“ beim Laden (Cookie, Standard an). */
  initialHistory?: boolean;
}) {
  const { yearMin, yearMax } = payload;
  const [year, setYearState] = useState(() => clampYear(initialYear, yearMin, yearMax));
  const [playing, setPlaying] = useState(false);
  // Angehalten mitten im Abspielen: der Knopf heißt dann „Weiter“.
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const reducedMotion = usePrefersReducedMotion();
  const [yearDraft, setYearDraft] = useState(String(year));
  const [sort, setSort] = useState<LivedSort>("place");
  const [showAllLived, setShowAllLived] = useState(false);
  /** Jahr von Hand wählen: hält das Abspielen an. */
  const setYear = useCallback(
    (next: number | ((y: number) => number)) => {
      setPlaying(false);
      setPaused(false);
      setYearState((y) => clampYear(typeof next === "function" ? next(y) : next, yearMin, yearMax));
    },
    [yearMin, yearMax],
  );
  useEffect(() => setYearDraft(String(year)), [year]);
  // Bei „Bewegung reduzieren“ nicht automatisch weiterlaufen.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);
  const [selection, setSelection] = useState<Selection>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [size, setSize] = useState({ w: 960, h: 600 });
  // Ausschnitt „Orte“: alle Orte der Auswahl (über alle Jahre), mit Rand.
  const dataBox = useMemo<ViewBox | null>(() => {
    if (payload.places.length === 0) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of payload.places) {
      const [x, y] = project(p.lon, p.lat);
      xs.push(x);
      ys.push(y);
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = Math.max(x1 - x0, 25);
    const h = Math.max(y1 - y0, 25);
    return { x: (x0 + x1) / 2 - w * 0.65, y: (y0 + y1) / 2 - h * 0.65, w: w * 1.3, h: h * 1.3 };
  }, [payload.places]);
  const boxOfView = useCallback((v: ViewName | "data") => (v === "data" ? (dataBox ?? VIEWS.europe) : VIEWS[v]), [dataBox]);
  const [box, setBox] = useState<ViewBox>(() => fitViewBox(dataBox ?? VIEWS.europe, 960, 600));
  const [viewName, setViewName] = useState<ViewName | "data" | null>(dataBox ? "data" : "europe");
  const [showAllRows, setShowAllRows] = useState(false);
  // Kreise erst im Browser zeichnen: Gleitkommazahlen der Projektion können
  // sich zwischen Server und Browser in der letzten Stelle unterscheiden.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();

  useEffect(() => {
    let alive = true;
    loadCountries().then((c) => alive && setCountries(c));
    return () => {
      alive = false;
    };
  }, []);

  // Größe der Fläche verfolgen; der Ausschnitt behält seine Mitte.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w <= 0 || h <= 0) return;
      setSize((old) => {
        if (old.w === w && old.h === h) return old;
        setBox((b) => (viewName ? fitViewBox(boxOfView(viewName), w, h) : fitViewBox(b, w, h)));
        return { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewName, boxOfView]);

  // Abspielen: ein Jahr je Takt, am Ende anhalten.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setYearState((y) => {
        if (y >= yearMax) {
          setPlaying(false);
          setPaused(false);
          return y;
        }
        return y + 1;
      });
    }, SPEEDS[speed].ms);
    return () => clearInterval(t);
  }, [playing, speed, yearMax]);

  // Jahr in der Adresse merken (teilbar), ohne neu zu laden.
  useEffect(() => {
    if (playing) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("jahr") === String(year)) return;
    url.searchParams.set("jahr", String(year));
    window.history.replaceState(window.history.state, "", url);
  }, [year, playing]);

  const snap = useMemo(() => snapshot(payload, year), [payload, year]);
  const placed = snap.alive - snap.noPlace - snap.unmapped;

  // Zeitstrahl über dem Regler: Lebende je Jahr (einmal je Datensatz).
  const timeline = useMemo(() => aliveByYear(payload, yearMin, yearMax), [payload, yearMin, yearMax]);
  // Liste und „In diesem Jahr“ dürfen beim Abspielen kurz nachlaufen.
  const listYear = useDeferredValue(year);
  const lived = useMemo(() => livedInYear(payload, listYear), [payload, listYear]);
  const yearEvents = useMemo(() => eventsInYear(payload, listYear), [payload, listYear]);
  // Zeitgeschichte: Zeile zum Jahr und feine Marken am Zeitstrahl (Schalter im Cookie).
  const [historyOn, setHistoryOn] = useHistoryToggle(initialHistory);
  const historyYear = useMemo(() => historyInYear(history, listYear), [history, listYear]);

  const togglePlay = () => {
    if (reducedMotion) return;
    if (playing) {
      setPlaying(false);
      setPaused(true);
      return;
    }
    if (year >= yearMax) setYearState(yearMin);
    setPaused(false);
    setPlaying(true);
  };
  const commitYearDraft = () => {
    const y = parseYearInput(yearDraft);
    if (y === null) setYearDraft(String(year));
    else {
      const next = clampYear(y, yearMin, yearMax);
      setYear(next);
      setYearDraft(String(next));
    }
  };
  const onSliderKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setYear((y) => y + (e.key === "PageUp" ? 10 : -10));
    }
  };

  const unitsPerPx = box.w / size.w;

  // --- Verschieben und Zoomen ------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(0);
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: box.x + ((clientX - r.left) / r.width) * box.w, y: box.y + ((clientY - r.top) / r.height) * box.h };
    },
    [box],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) dragged.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    // Erst bei echter Bewegung festhalten — sonst kommt der Klick nicht beim Kreis an.
    if (dragged.current > 3 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    const r = svgRef.current!.getBoundingClientRect();
    const k = box.w / r.width;
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      dragged.current += Math.abs(dx) + Math.abs(dy);
      setBox((b) => ({ ...b, x: b.x - dx * k, y: b.y - dy * k }));
      setViewName(null);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      dragged.current += 10;
      if (before > 0 && after > 0) {
        const c = toMap((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        setBox((bx) => zoomAt(bx, after / before, c.x, c.y));
        setViewName(null);
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };

  // Mausrad: nicht passiv, damit die Seite dabei nicht scrollt.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setBox((b) => {
        const cx = b.x + ((e.clientX - r.left) / r.width) * b.w;
        const cy = b.y + ((e.clientY - r.top) / r.height) * b.h;
        return zoomAt(b, Math.pow(1.0018, -e.deltaY), cx, cy);
      });
      setViewName(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    setBox((b) => zoomAt(b, f, b.x + b.w / 2, b.y + b.h / 2));
    setViewName(null);
  };
  const showView = (v: ViewName | "data") => {
    setViewName(v);
    setBox(fitViewBox(boxOfView(v), size.w, size.h));
  };
  const onMapKey = (e: React.KeyboardEvent) => {
    const step = 0.12;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setBox((b) => ({ ...b, x: b.x + dx * b.w, y: b.y + dy * b.h }));
      setViewName(null);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.4);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomBy(1 / 1.4);
    }
  };

  // --- Auswahl -------------------------------------------------------------------
  const select = (s: Selection) => {
    setSelection(s);
    setShowAllLived(false);
    // Fokus auf die Personenliste (Tastatur, Screenreader).
    requestAnimationFrame(() => panelHeadingRef.current?.focus());
  };

  // „Wer lebte …?“: alle Lebenden des Jahres, ein gewählter Ort filtert.
  const panelRows = useMemo(() => {
    if (!selection) return lived;
    return lived.filter((r) =>
      selection.kind === "place" ? r.at === selection.place : selection.kind === "noPlace" ? r.at === null : r.at === -1,
    );
  }, [selection, lived]);
  const effectiveSort: LivedSort = selection && sort === "place" ? "name" : sort;
  const panelGroups = useMemo(
    () =>
      effectiveSort === "place"
        ? groupLivedByPlace(payload, panelRows)
        : [{ key: "all", label: "", place: null, rows: sortLived(payload, panelRows, effectiveSort) }],
    [effectiveSort, payload, panelRows],
  );
  // Höchstens LIST_LIMIT Zeilen, bis „Alle zeigen“ gewählt ist.
  const shownGroups = useMemo(() => {
    let left = showAllLived ? Infinity : LIST_LIMIT;
    const out: ((typeof panelGroups)[number] & { total: number })[] = [];
    for (const g of panelGroups) {
      if (left <= 0) break;
      out.push({ ...g, total: g.rows.length, rows: g.rows.slice(0, left) });
      left -= g.rows.length;
    }
    return out;
  }, [panelGroups, showAllLived]);

  const panelTitle =
    selection?.kind === "place"
      ? payload.places[selection.place]?.label
      : selection?.kind === "noPlace"
        ? "Ohne bekannten Ort"
        : selection?.kind === "unmapped"
          ? "Ort nicht auf der Karte"
          : null;

  // --- Zeichnen ------------------------------------------------------------------
  const projected = useMemo(() => payload.places.map((p) => project(p.lon, p.lat)), [payload.places]);
  const drawGroups = useMemo(() => [...snap.groups].sort((a, b) => b.persons.length - a.persons.length), [snap]);

  const groupText = (g: PlaceGroup) => {
    const n = g.persons.length;
    const lines = LINE_KEYS.filter((k) => g.perLine[k] > 0).map((k) => `${LINE_CODE[k]} ${g.perLine[k]}`);
    return `${payload.places[g.place].label}: ${n} ${n === 1 ? "Person" : "Personen"}${lines.length ? ` (${lines.join(", ")})` : ""}`;
  };

  const rows = showAllRows ? snap.groups : snap.groups.slice(0, 30);
  const empty = payload.persons.length === 0;

  return (
    <div className="space-y-3" data-testid="map-explorer">
      {/* Jahr */}
      <div className="card space-y-2 p-3" role="group" aria-label="Zeitreise: Jahr wählen" data-testid="map-timeline">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm muted">Jahr</span>
            <output
              htmlFor={`${ids}-year`}
              className="min-w-[4ch] font-serif text-2xl font-semibold tabular-nums"
              data-testid="map-year"
            >
              {year}
            </output>
          </div>
          {reducedMotion ? (
            <p className="max-w-xs text-xs muted" data-testid="map-play-reduced">
              Abspielen ist aus, weil dein Gerät „Bewegung reduzieren“ eingestellt hat — die Schritt-Knöpfe gehen weiter.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary min-w-11"
                onClick={togglePlay}
                aria-pressed={playing}
                disabled={empty}
                data-testid="map-play"
              >
                <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
                {playing ? "Pause" : paused ? "Weiter" : "Abspielen"}
              </button>
              <label className="flex items-center gap-2 text-sm">
                <span className="muted">Tempo</span>
                <select className="field py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {SPEEDS.map((s, i) => (
                    <option key={s.label} value={i}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {history.length > 0 && <HistoryToggle on={historyOn} onChange={setHistoryOn} testId="map-history-toggle" className="text-sm" />}
          <form
            className="flex items-center gap-2 text-sm sm:ml-auto"
            // Außerhalb der Spanne nicht blockieren, sondern begrenzen (commitYearDraft).
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              commitYearDraft();
            }}
          >
            <label htmlFor={`${ids}-year-input`} className="muted">
              Gehe zu
            </label>
            <input
              id={`${ids}-year-input`}
              type="number"
              inputMode="numeric"
              min={yearMin}
              max={yearMax}
              step={1}
              value={yearDraft}
              onChange={(e) => setYearDraft(e.target.value)}
              onBlur={commitYearDraft}
              className="field w-24 tabular-nums"
              aria-describedby={`${ids}-year-range`}
              disabled={empty}
              data-testid="map-year-input"
            />
            <span id={`${ids}-year-range`} className="sr-only">
              Jahr zwischen {yearMin} und {yearMax}, mit Eingabetaste übernehmen
            </span>
          </form>
        </div>

        {/* Zeitstrahl: Lebende je Jahr, darunter der Regler über die ganze Spanne */}
        <div className="flex items-center gap-2">
          <span aria-hidden className="hidden text-xs tabular-nums muted sm:inline">
            {yearMin}
          </span>
          <div className="min-w-0 flex-1">
            <Timeline counts={timeline} index={year - yearMin} />
            {historyOn && history.length > 0 && <HistoryMarks events={history} yearMin={yearMin} yearMax={yearMax} />}
            <input
              id={`${ids}-year`}
              type="range"
              min={yearMin}
              max={yearMax}
              step={1}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              onKeyDown={onSliderKey}
              aria-label="Jahr"
              aria-valuetext={`${year}: ${snap.alive} ${snap.alive === 1 ? "Person lebte" : "Personen lebten"}`}
              aria-keyshortcuts="PageUp PageDown Home End"
              className="block h-11 w-full min-w-0 cursor-pointer accent-accent-700 text-base dark:accent-accent-300"
              data-testid="map-year-slider"
              disabled={empty}
            />
            <div aria-hidden className="flex justify-between text-xs tabular-nums muted sm:hidden">
              <span>{yearMin}</span>
              <span>{yearMax}</span>
            </div>
          </div>
          <span aria-hidden className="hidden text-xs tabular-nums muted sm:inline">
            {yearMax}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1" role="group" aria-label="Jahr schrittweise">
          {(
            [
              [-10, "−10", " Jahre zurück"],
              [-1, "−1", " Jahr zurück"],
              [1, "+1", " Jahr weiter"],
              [10, "+10", " Jahre weiter"],
            ] as const
          ).map(([d, text, rest]) => (
            <button
              key={d}
              type="button"
              className="btn-secondary min-h-11 min-w-11 tabular-nums"
              onClick={() => setYear((y) => y + d)}
              disabled={empty || (d < 0 ? year <= yearMin : year >= yearMax)}
              data-testid={`map-step-${d > 0 ? "plus" : "minus"}${Math.abs(d)}`}
            >
              {text}
              <span className="sr-only">{rest}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zahlen für das Jahr */}
      <p className="text-sm" aria-live={playing ? "off" : "polite"} data-testid="map-counts">
        <span className="font-medium">{snap.alive}</span> {snap.alive === 1 ? "Person lebte" : "Personen lebten"} {year}
        {snap.alive > 0 && (
          <>
            {" — "}
            <span data-testid="map-count-placed">{placed}</span> an {snap.groups.length}{" "}
            {snap.groups.length === 1 ? "Ort" : "Orten"} der Karte,{" "}
            <button type="button" className="btn-link" onClick={() => select({ kind: "noPlace" })} data-testid="map-count-noplace">
              {snap.noPlace} ohne bekannten Ort
            </button>
            {snap.unmapped > 0 && (
              <>
                ,{" "}
                <button type="button" className="btn-link" onClick={() => select({ kind: "unmapped" })} data-testid="map-count-unmapped">
                  {snap.unmapped} mit Ort, der nicht auf der Karte ist
                </button>
              </>
            )}
          </>
        )}
        {payload.undated > 0 && <span className="muted"> · {payload.undated} ohne Lebensdaten (nicht auf der Karte)</span>}
      </p>

      {historyOn && history.length > 0 && <HistoryYearLine year={listYear} events={historyYear} />}

      <YearEventsLine year={listYear} events={yearEvents} persons={payload.persons} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Karte */}
        <div className="relative min-w-0">
          <div
            ref={wrapRef}
            className="relative h-[60vh] max-h-[640px] min-h-[300px] w-full overflow-hidden rounded-xl border border-stone-300 dark:border-stone-700"
            style={{ background: "var(--map-sea)" }}
          >
            <svg
              ref={svgRef}
              viewBox={[box.x, box.y, box.w, box.h].map((v) => v.toFixed(2)).join(" ")}
              // Projektion: letzte Gleitkommastelle kann zwischen Server und Browser abweichen.
              suppressHydrationWarning
              width="100%"
              height="100%"
              className="block cursor-grab touch-none select-none focus-visible:outline-none active:cursor-grabbing"
              role="img"
              aria-label={`Karte (heutige Grenzen): ${placed} Personen an ${snap.groups.length} Orten im Jahr ${year}. Mit Pfeiltasten verschieben, Plus und Minus zoomen. Die Orte stehen auch in der Liste unter der Karte.`}
              tabIndex={0}
              onKeyDown={onMapKey}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              data-testid="map-svg"
            >
              <defs>
                <LinePatterns unit={unitsPerPx} />
              </defs>
              <g data-testid="map-countries">
                {(countries ?? []).map((c) => (
                  <path
                    key={c.id + c.d.length}
                    d={c.d}
                    fill="var(--map-land)"
                    stroke="var(--map-border)"
                    strokeWidth={0.8 * unitsPerPx}
                    strokeLinejoin="round"
                  >
                    <title>{c.name}</title>
                  </path>
                ))}
              </g>
              <g>
                {mounted && drawGroups.map((g) => {
                  const [x, y] = projected[g.place];
                  const n = g.persons.length;
                  const rPx = radiusPx(n);
                  const r = rPx * unitsPerPx;
                  const selected = selection?.kind === "place" && selection.place === g.place;
                  return (
                    <g
                      key={g.place}
                      className="cursor-pointer"
                      data-testid="map-circle"
                      data-place={payload.places[g.place].label}
                      data-count={n}
                      onClick={() => {
                        if (dragged.current > 6) return;
                        select({ kind: "place", place: g.place });
                      }}
                    >
                      <title>{groupText(g)}</title>
                      <Pie cx={x} cy={y} r={r} weights={g.weights} showLines={showLines} />
                      <circle
                        cx={x}
                        cy={y}
                        r={r}
                        fill="none"
                        stroke={selected ? "var(--map-ring)" : "rgb(255 255 255 / 0.85)"}
                        strokeWidth={(selected ? 2.5 : 1.2) * unitsPerPx}
                      />
                      {rPx >= 11 && (
                        <text
                          x={x}
                          y={y}
                          dy="0.35em"
                          textAnchor="middle"
                          fontSize={11 * unitsPerPx}
                          fontWeight={700}
                          fill="#fff"
                          stroke="rgb(0 0 0 / 0.55)"
                          strokeWidth={2.5 * unitsPerPx}
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {n}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Kartenbedienung */}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button type="button" className="btn-secondary h-11 w-11 px-0 text-lg" onClick={() => zoomBy(1.5)} aria-label="Hineinzoomen">
                +
              </button>
              <button type="button" className="btn-secondary h-11 w-11 px-0 text-lg" onClick={() => zoomBy(1 / 1.5)} aria-label="Herauszoomen">
                −
              </button>
            </div>
            <div className="absolute left-2 top-2 flex gap-1" role="group" aria-label="Ausschnitt">
              {([...(dataBox ? (["data"] as const) : []), "europe", "world"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-secondary"
                  aria-pressed={viewName === v}
                  style={viewName === v ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
                  onClick={() => showView(v)}
                  data-testid={`map-view-${v}`}
                >
                  {v === "data" ? "Orte" : v === "europe" ? "Europa" : "Welt"}
                </button>
              ))}
            </div>
            <p className="pointer-events-none absolute bottom-1 left-2 rounded bg-surface/80 px-1.5 text-[11px] muted" data-testid="map-borders-note">
              heutige Grenzen
            </p>
          </div>
          {!countries && <p className="mt-1 text-xs muted">Karte wird geladen …</p>}
        </div>

        {/* Personen am gewählten Ort */}
        <aside className="card min-w-0 space-y-2 p-3" aria-labelledby={`${ids}-panel`} data-testid="map-panel">
          <h2 id={`${ids}-panel`} ref={panelHeadingRef} tabIndex={-1} className="font-serif text-lg font-semibold focus:outline-none">
            {panelTitle ?? `Wer lebte ${listYear}?`}
          </h2>
          <p className="text-sm" data-testid="map-panel-count">
            <span className="font-medium">{panelRows.length}</span>{" "}
            {selection
              ? `${panelRows.length === 1 ? "Person" : "Personen"} im Jahr ${listYear}`
              : `${panelRows.length === 1 ? "Person lebte" : "Personen lebten"} ${listYear}`}
            {selection?.kind === "place" && payload.places[selection.place]?.precision !== "PLACE" && (
              <span className="muted"> · nur {payload.places[selection.place].precision === "REGION" ? "die Region" : "das Land"} bekannt</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="muted">Ordnen</span>
              <select
                className="field py-1"
                value={effectiveSort}
                onChange={(e) => setSort(e.target.value as LivedSort)}
                data-testid="map-lived-sort"
              >
                {!selection && <option value="place">nach Ort</option>}
                <option value="name">nach Name</option>
                <option value="age">nach Alter</option>
              </select>
            </label>
            {selection ? (
              <button type="button" className="btn-link" onClick={() => setSelection(null)} data-testid="map-panel-all">
                Alle Orte zeigen
              </button>
            ) : (
              <span className="text-xs muted">Kreis antippen filtert nach Ort.</span>
            )}
          </div>
          {panelRows.length === 0 ? (
            <p className="text-sm muted">Niemand aus dieser Auswahl lebte {listYear}.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm" data-testid="map-panel-list">
              {shownGroups.map((g) => (
                <li key={g.key}>
                  {g.label && (
                    <p className="sticky top-0 mt-1 flex items-baseline justify-between gap-2 bg-surface py-0.5 text-xs font-semibold" data-testid="map-lived-group">
                      {g.place !== null && g.place >= 0 ? (
                        <button type="button" className="btn-link min-w-0 text-left" onClick={() => select({ kind: "place", place: g.place! })}>
                          {g.label}
                        </button>
                      ) : (
                        <span className="min-w-0 muted">{g.label}</span>
                      )}
                      <span className="shrink-0 tabular-nums muted">
                        {g.total}
                        <span className="sr-only"> {g.total === 1 ? "Person" : "Personen"}</span>
                      </span>
                    </p>
                  )}
                  <ul className="space-y-1">
                    {g.rows.map((r) => (
                      <LivedRow
                        key={r.i}
                        row={r}
                        person={payload.persons[r.i]}
                        place={effectiveSort === "place" || selection ? null : placeLabelOf(payload, r.at)}
                        showLines={showLines}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {!showAllLived && panelRows.length > LIST_LIMIT && (
            <button type="button" className="btn-link" onClick={() => setShowAllLived(true)} data-testid="map-lived-more">
              Alle {panelRows.length} zeigen
            </button>
          )}
          <p className="text-xs muted">
            Alter = Jahr minus Geburtsjahr (ersatzweise Taufe), „etwa“ bei ungenauen Daten. Wer im Jahr lebte und wo, zählt
            wie die Karte.{" "}
            <HelpLink to="zeitreise" compact label="Wie funktioniert die Zeitreise?" className="ml-1 align-middle" />
          </p>
        </aside>
      </div>

      {/* Legende */}
      <div className="card space-y-2 p-3 text-sm" data-testid="map-legend">
        <p className="font-medium">Legende</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {showLines &&
            LINE_KEYS.map((k) => (
              <li key={k} className="flex items-center gap-1.5" data-line={k}>
                <Swatch category={k} />
                <LineCode line={k} />
                <span>
                  {LINE_LABEL[k]}
                  {grandparents?.[k] ? <span className="muted">: {grandparents[k]!.name}</span> : <span className="muted">: nicht erfasst</span>}
                </span>
              </li>
            ))}
          <li className="flex items-center gap-1.5">
            <Swatch category="none" />
            <span>{showLines ? "keine Ahnenlinie" : "Personen"}</span>
          </li>
        </ul>
        <p className="text-xs muted">
          Kreisfläche ~ Anzahl der Personen (sehr große Kreise begrenzt), Zahl im Kreis ab einigen Personen. Muster und
          Kurzzeichen unterscheiden die Linien zusätzlich zur Farbe; gemischte Orte als Tortenstücke. Jede lebende Person
          steht am zuletzt bekannten Ort — Regeln unter „Wie wird gezählt?“.
        </p>
      </div>

      {/* Ortsliste: dieselbe Information ohne Karte */}
      <section aria-labelledby={`${ids}-list`} className="card p-3" data-testid="map-place-list">
        <h2 id={`${ids}-list`} className="font-serif text-lg font-semibold">
          Orte im Jahr {year}
        </h2>
        {snap.groups.length === 0 ? (
          <p className="text-sm muted">Keine Person mit bekanntem Ort in diesem Jahr.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs muted">
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Ort
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    Personen
                  </th>
                  {showLines && (
                    <th scope="col" className="py-1 font-medium">
                      Linien
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.place} className="border-t border-stone-200 dark:border-stone-800" data-testid="map-place-row">
                    <td className="py-1 pr-2">
                      <button type="button" className="btn-link text-left text-sm" onClick={() => select({ kind: "place", place: g.place })}>
                        {payload.places[g.place].label}
                      </button>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{g.persons.length}</td>
                    {showLines && (
                      <td className="py-1">
                        <span className="flex flex-wrap gap-1">
                          {LINE_KEYS.filter((k) => g.perLine[k] > 0).map((k) => (
                            <span key={k} className="inline-flex items-center gap-0.5">
                              <LineCode line={k} />
                              <span className="tabular-nums">{g.perLine[k]}</span>
                            </span>
                          ))}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {snap.groups.length > rows.length && (
              <button type="button" className="btn-link mt-2" onClick={() => setShowAllRows(true)}>
                Alle {snap.groups.length} Orte zeigen
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Zeitstrahl über dem Regler: je Jahr ein Balken mit der Zahl der Lebenden,
 * das gewählte Jahr hervorgehoben (zusätzlich zur Farbe volle Höhe der Marke).
 * Nur Schmuck — dieselbe Zahl sagt der Regler (aria-valuetext).
 */
function Timeline({ counts, index }: { counts: number[]; index: number }) {
  const max = Math.max(1, ...counts);
  const H = 24;
  const d = counts
    .map((c, i) => (c > 0 ? `M${i} ${H}V${(H - (c / max) * H).toFixed(2)}H${i + 1}V${H}Z` : ""))
    .join("");
  return (
    // Der Daumen des Reglers läuft um seine halbe Breite eingerückt — daher der Rand.
    <div aria-hidden className="px-2" data-testid="map-timeline-bars">
      <svg viewBox={`0 0 ${Math.max(1, counts.length)} ${H}`} preserveAspectRatio="none" className="block h-6 w-full">
        <path d={d} className="fill-accent-600/30 dark:fill-accent-300/35" />
        {index >= 0 && index < counts.length && (
          <rect x={index} y={0} width={1} height={H} className="fill-accent-700 dark:fill-accent-300" />
        )}
      </svg>
    </div>
  );
}

/**
 * Zeitgeschichte am Zeitstrahl: feine Marken unter den Balken — Zeiträume als
 * Band, Einzeljahre als schmaler Strich; überschneidende Ereignisse in
 * eigenen Bahnen. Nur Schmuck — die Zeile „Zeitgeschichte <Jahr>“ nennt die
 * Ereignisse des gewählten Jahres.
 */
function HistoryMarks({ events, yearMin, yearMax }: { events: HistoryEvent[]; yearMin: number; yearMax: number }) {
  const n = Math.max(1, yearMax - yearMin + 1);
  const lanes = historyLanes(events.filter((e) => e.from <= yearMax && lastYear(e) >= yearMin));
  if (lanes.length === 0) return null;
  const laneCount = Math.max(...lanes.map((l) => l.lane)) + 1;
  const LANE = 2;
  const H = laneCount * LANE + (laneCount - 1);
  return (
    <div aria-hidden className="px-2" data-testid="map-history-marks">
      <svg viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: `${laneCount * 3 + 1}px` }}>
        {lanes.map(({ event: e, lane }) => {
          const from = Math.max(e.from, yearMin) - yearMin;
          const to = Math.min(lastYear(e), yearMax) - yearMin + 1;
          return (
            <rect
              key={e.id}
              x={from}
              y={lane * (LANE + 1)}
              width={to - from}
              height={LANE}
              className="fill-amber-600/70 dark:fill-amber-400/70"
            >
              <title>{`${e.title} (${formatHistoryYears(e)})${e.aiUnconfirmed ? ` – ${AI_UNCONFIRMED_LABEL}` : ""}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/** Zeile „Zeitgeschichte <Jahr>: …“ — Ereignisse, die das gewählte Jahr berühren. Hintergrund, keine Aussage über Personen. */
function HistoryYearLine({ year, events }: { year: number; events: HistoryEvent[] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm" data-testid="map-history">
      <span className="font-medium text-amber-800 dark:text-amber-300">Zeitgeschichte {year}:</span>
      {events.length === 0 ? (
        <span className="muted" data-testid="map-history-none">
          kein Ereignis aus der Liste
        </span>
      ) : (
        events.map((e, i) => (
          <span key={e.id} data-testid="map-history-item" title={[HISTORY_KIND_LABEL[e.kind], e.region ? `gilt für ${e.region}` : null, e.description].filter(Boolean).join(" · ")}>
            {e.title} <span className="whitespace-nowrap tabular-nums muted">({formatHistoryYears(e)})</span>
            {e.aiUnconfirmed && <HistoryAiNote testId="map-history-ai" className="ml-1" />}
            {i < events.length - 1 && <span aria-hidden className="muted"> ·</span>}
          </span>
        ))
      )}
      <HelpLink to="zeitgeschichteKarte" compact label="Was zeigt die Zeitgeschichte?" className="ml-1 self-center" />
    </p>
  );
}

/** Eine Zeile der Liste „Wer lebte …?“: Name (Link), Alter, Ort, Linien. */
function LivedRow({
  row,
  person: p,
  place,
  showLines,
}: {
  row: LivedEntry;
  person: MapPerson;
  place: string | null;
  showLines: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-2" data-testid="map-lived-row">
      <span className="min-w-0">
        <Link href={`/people/${p.id}`} className="font-medium text-accent-700 hover:underline dark:text-accent-300">
          {p.n}
        </Link>
        <span className="block text-xs muted">
          <span data-testid="map-lived-age">{formatAge(row.age)}</span>
          {place ? <> · {place}</> : p.life ? <> · {p.life}</> : null}
        </span>
      </span>
      {showLines && p.ln ? (
        <span className="flex shrink-0 gap-0.5" aria-label={linesFromBits(p.ln).map((k) => LINE_LABEL[k]).join(", ")}>
          {linesFromBits(p.ln).map((k) => (
            <LineCode key={k} line={k} />
          ))}
        </span>
      ) : null}
    </li>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Zeile „In diesem Jahr“: Geburten, Hochzeiten, Todesfälle — Zahl, Namen aufklappbar. */
function YearEventsLine({ year, events, persons }: { year: number; events: YearEvents; persons: MapPerson[] }) {
  const byName = (a: number, b: number) => persons[a].n.localeCompare(persons[b].n, "de");
  const births = [...events.births].sort(byName);
  const deaths = [...events.deaths].sort(byName);
  const marriages = [...events.marriages].sort((a, b) => byName(a[0], b[0]));
  const total = births.length + deaths.length + marriages.length;
  const link = (i: number) => (
    <Link href={`/people/${persons[i].id}`} className="text-accent-700 hover:underline dark:text-accent-300">
      {persons[i].n}
    </Link>
  );
  const column = (title: string, items: React.ReactNode[], testId: string) => (
    <div data-testid={testId}>
      <p className="font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="muted">keine</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((it, k) => (
            <li key={k}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <details className="card p-3 text-sm" data-testid="map-year-events">
      <summary className="cursor-pointer">
        <span className="font-medium">In diesem Jahr ({year}):</span>{" "}
        <span data-testid="map-year-events-summary">
          {plural(births.length, "Geburt", "Geburten")} · {plural(marriages.length, "Hochzeit", "Hochzeiten")} ·{" "}
          {plural(deaths.length, "Todesfall", "Todesfälle")}
        </span>
        {total > 0 && <span className="muted"> — Namen zeigen</span>}
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {column(
          "Geburten",
          births.map((i) => (
            <>
              {link(i)}
              {persons[i].bt ? <span className="muted"> (Taufe)</span> : persons[i].ba ? <span className="muted"> (ungenau)</span> : null}
            </>
          )),
          "map-year-births",
        )}
        {column(
          "Hochzeiten",
          marriages.map(([a, b]) => (
            <>
              {link(a)}
              {b >= 0 ? <> und {link(b)}</> : null}
            </>
          )),
          "map-year-marriages",
        )}
        {column("Todesfälle", deaths.map((i) => link(i)), "map-year-deaths")}
      </div>
      <p className="mt-2 text-xs muted">
        Geburt ersatzweise Taufe, Tod ersatzweise Beerdigung; Hochzeiten nur, wenn du beide Partner sehen darfst.
      </p>
    </details>
  );
}

/** Muster je Linie — damit die Linie nicht nur an der Farbe hängt. */
function LinePatterns({ unit }: { unit: number }) {
  const s = 6 * unit;
  const w = 1.6 * unit;
  return (
    <>
      <pattern id="map-pat-FF" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill={lineColor("FF")} />
      </pattern>
      <pattern id="map-pat-FM" width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={s} height={s} fill={lineColor("FM")} />
        <rect width={w} height={s} fill="rgb(255 255 255 / 0.45)" />
      </pattern>
      <pattern id="map-pat-MF" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill={lineColor("MF")} />
        <circle cx={s / 2} cy={s / 2} r={w * 0.8} fill="rgb(255 255 255 / 0.5)" />
      </pattern>
      <pattern id="map-pat-MM" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill={lineColor("MM")} />
        <rect width={s} height={w} fill="rgb(0 0 0 / 0.22)" />
      </pattern>
      <pattern id="map-pat-none" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill={lineColor("none")} />
      </pattern>
    </>
  );
}

function fillOf(cat: LineKey | "none", showLines: boolean) {
  return `url(#map-pat-${showLines ? cat : "none"})`;
}

function Pie({
  cx,
  cy,
  r,
  weights,
  showLines,
}: {
  cx: number;
  cy: number;
  r: number;
  weights: PlaceGroup["weights"];
  showLines: boolean;
}) {
  const parts = showLines ? CATEGORIES.filter((c) => weights[c] > 0) : (["none"] as const);
  const total = parts.reduce((s, c) => s + (showLines ? weights[c] : 0), 0);
  if (parts.length <= 1 || total <= 0) {
    return <circle cx={cx} cy={cy} r={r} fill={fillOf(parts[0] ?? "none", showLines)} />;
  }
  let angle = -Math.PI / 2;
  return (
    <>
      {parts.map((c) => {
        const a = (weights[c] / total) * Math.PI * 2;
        const x0 = cx + r * Math.cos(angle);
        const y0 = cy + r * Math.sin(angle);
        angle += a;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const large = a > Math.PI ? 1 : 0;
        return <path key={c} d={`M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}Z`} fill={fillOf(c, true)} />;
      })}
    </>
  );
}

function Swatch({ category }: { category: LineKey | "none" }) {
  const style: CSSProperties = { background: lineColor(category) };
  if (category === "FM") style.backgroundImage = "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.45) 0 2px, transparent 2px 6px)";
  if (category === "MF") style.backgroundImage = "radial-gradient(circle, rgb(255 255 255 / 0.5) 1.3px, transparent 1.5px)";
  if (category === "MF") style.backgroundSize = "6px 6px";
  if (category === "MM") style.backgroundImage = "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.22) 0 2px, transparent 2px 6px)";
  return <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-white/80" style={style} />;
}
