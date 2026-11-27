"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { LINE_CODE, LINE_KEYS, LINE_LABEL, type LineKey } from "@/lib/reference";
import { linesFromBits, type MapPayload } from "@/lib/map/build";
import { fitViewBox, project, VIEWS, zoomAt, type ViewBox, type ViewName } from "@/lib/map/projection";
import { snapshot, type PlaceGroup } from "@/lib/map/year";
import { loadCountries, type Country } from "@/lib/map/countries";
import { LineCode } from "./ReferenceLines";

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
 * darunter; der Jahresregler ist ein normales Schiebefeld.
 */

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
}: {
  payload: MapPayload;
  initialYear: number;
  grandparents: Record<LineKey, { id: string; name: string } | null> | null;
  showLines: boolean;
}) {
  const { yearMin, yearMax } = payload;
  const [year, setYear] = useState(() => Math.min(yearMax, Math.max(yearMin, initialYear)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
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
      setYear((y) => {
        if (y >= yearMax) {
          setPlaying(false);
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
    // Fokus auf die Personenliste (Tastatur, Screenreader).
    requestAnimationFrame(() => panelHeadingRef.current?.focus());
  };
  const selectedGroup: PlaceGroup | null =
    selection?.kind === "place" ? (snap.groups.find((g) => g.place === selection.place) ?? null) : null;

  const panelPersons = useMemo(() => {
    if (!selection) return [];
    let idx: number[] = [];
    if (selection.kind === "place") idx = selectedGroup?.persons ?? [];
    else {
      payload.persons.forEach((p, i) => {
        if (year < p.y0 || year > p.y1) return;
        const st = p.st;
        let at: number | null = null;
        for (let j = 0; j < st.length && st[j] <= year; j += 2) at = st[j + 1];
        if (selection.kind === "noPlace" ? at === null : at === -1) idx.push(i);
      });
    }
    return idx.map((i) => payload.persons[i]).sort((a, b) => a.n.localeCompare(b.n, "de"));
  }, [selection, selectedGroup, payload, year]);

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
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
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
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            if (!playing && year >= yearMax) setYear(yearMin);
            setPlaying((p) => !p);
          }}
          aria-pressed={playing}
          disabled={empty}
          data-testid="map-play"
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
          {playing ? "Anhalten" : "Abspielen"}
        </button>
        <label className="flex min-w-0 flex-1 basis-56 items-center gap-2">
          <span className="sr-only">Jahr wählen</span>
          <span aria-hidden className="text-xs tabular-nums muted">
            {yearMin}
          </span>
          <input
            id={`${ids}-year`}
            type="range"
            min={yearMin}
            max={yearMax}
            step={1}
            value={year}
            onChange={(e) => {
              setPlaying(false);
              setYear(Number(e.target.value));
            }}
            aria-valuetext={`${year}`}
            className="h-11 min-w-0 flex-1 accent-accent-700 text-base dark:accent-accent-300"
            data-testid="map-year-slider"
            disabled={empty}
          />
          <span aria-hidden className="text-xs tabular-nums muted">
            {yearMax}
          </span>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary px-2.5" onClick={() => setYear((y) => Math.max(yearMin, y - 1))} aria-label="Ein Jahr zurück" disabled={empty}>
            ‹
          </button>
          <button type="button" className="btn-secondary px-2.5" onClick={() => setYear((y) => Math.min(yearMax, y + 1))} aria-label="Ein Jahr weiter" disabled={empty}>
            ›
          </button>
        </div>
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
            {panelTitle ?? "Personen"}
          </h2>
          {!selection && <p className="text-sm muted">Kreis auf der Karte oder Ort in der Liste wählen.</p>}
          {selection && (
            <>
              <p className="text-sm muted">
                {panelPersons.length} {panelPersons.length === 1 ? "Person" : "Personen"} im Jahr {year}
                {selection.kind === "place" && payload.places[selection.place]?.precision !== "PLACE" && (
                  <> · nur {payload.places[selection.place].precision === "REGION" ? "die Region" : "das Land"} bekannt</>
                )}
              </p>
              <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm" data-testid="map-panel-list">
                {panelPersons.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <Link href={`/people/${p.id}`} className="font-medium text-accent-700 hover:underline dark:text-accent-300">
                        {p.n}
                      </Link>
                      {p.life && <span className="muted"> · {p.life}</span>}
                    </span>
                    {showLines && p.ln ? (
                      <span className="flex shrink-0 gap-0.5" aria-label={linesFromBits(p.ln).map((k) => LINE_LABEL[k]).join(", ")}>
                        {linesFromBits(p.ln).map((k) => (
                          <LineCode key={k} line={k} />
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
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
