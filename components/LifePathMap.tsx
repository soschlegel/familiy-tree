"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { loadCountries, type Country } from "@/lib/map/countries";
import { pointNumbers, type LifePath, type LineEnd, type PathStation } from "@/lib/map/life-path";
import { fitViewBox, project, VIEWS, zoomAt, type ViewBox } from "@/lib/map/projection";

/**
 * „Lebensweg“ auf der Karte (/map?mode=lebensweg): nummerierte Punkte,
 * verbunden durch eine Linie mit Pfeilen in Wegrichtung, daneben bzw.
 * darunter die Liste der Stationen. Liste und Karte hängen zusammen: Station
 * wählen hebt ihren Punkt hervor, Punkt antippen wählt seine Station in der
 * Liste. Dieselbe Kartentechnik wie MapExplorer (eigene SVG-Karte, Grenzen
 * aus public/geo/countries.json, Projektion lib/map/projection.ts); der Weg
 * selbst kommt fertig vom Server (lib/map/life-path.ts).
 *
 * Nichts hängt nur an der Farbe: Nummern an Punkten und in der Liste,
 * gestrichelte Teilstücke stehen zusätzlich in der Legende.
 */

const POINT_R = 12; // Punkt-Radius in Bildschirmpunkten
const HIT_R = 22; // Tippfläche (44 px Durchmesser)

const LINE_END_TEXT: Record<"father" | "mother", Record<LineEnd, string>> = {
  father: {
    none: "Weiter hinauf ist kein leiblicher Vater erfasst.",
    restricted: "Weiter hinauf nicht freigegeben.",
    ambiguous: "Weiter hinauf ist nicht eindeutig, wer der Vater ist (Geschlecht fehlt oder mehrere Väter erfasst).",
    limit: "Weiter hinauf nicht gezeigt (höchstens 12 Generationen).",
  },
  mother: {
    none: "Weiter hinauf ist keine leibliche Mutter erfasst.",
    restricted: "Weiter hinauf nicht freigegeben.",
    ambiguous: "Weiter hinauf ist nicht eindeutig, wer die Mutter ist (Geschlecht fehlt oder mehrere Mütter erfasst).",
    limit: "Weiter hinauf nicht gezeigt (höchstens 12 Generationen).",
  },
};

export function LifePathMap({
  path,
  kind,
  lineEnd,
}: {
  path: LifePath;
  kind: "person" | "father" | "mother";
  lineEnd: LineEnd | null;
}) {
  const ids = useId();
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 960, h: 600 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const itemRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    let alive = true;
    loadCountries().then((c) => alive && setCountries(c));
    return () => {
      alive = false;
    };
  }, []);

  const projected = useMemo(() => path.points.map((p) => project(p.lon, p.lat)), [path.points]);
  // Ausschnitt „Weg“: alle Punkte mit Rand; ein einzelner Punkt mit etwas Umgebung.
  const pathBox = useMemo<ViewBox | null>(() => {
    if (projected.length === 0) return null;
    const xs = projected.map((p) => p[0]);
    const ys = projected.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = Math.max(x1 - x0, 8);
    const h = Math.max(y1 - y0, 8);
    return { x: (x0 + x1) / 2 - w * 0.7, y: (y0 + y1) / 2 - h * 0.7, w: w * 1.4, h: h * 1.4 };
  }, [projected]);
  const homeBox = pathBox ?? VIEWS.europe;
  // Beschriftungen stehen rechts neben den Punkten: beim Einpassen rechts so
  // viel Platz lassen, dass die längste (geschätzt) nicht abgeschnitten wird.
  const labelPx = useMemo(() => {
    if (!pathBox) return 0;
    const longest = Math.max(
      0,
      ...path.stations.filter((s) => s.point !== null).map((s) => (kind === "person" ? s.yearText.length * 2 + 4 : s.title.length + s.yearText.length + 2)),
    );
    return longest * 6.5 + 40;
  }, [pathBox, path.stations, kind]);
  const fitHome = useCallback(
    (w: number, h: number): ViewBox => {
      const lw = Math.min(labelPx, w * 0.45);
      if (lw <= 0 || w - lw <= 0) return fitViewBox(homeBox, w, h);
      const b = fitViewBox(homeBox, w - lw, h);
      return { ...b, w: (b.w * w) / (w - lw) };
    },
    [homeBox, labelPx],
  );
  const [box, setBox] = useState<ViewBox>(() => fitHome(960, 600));
  const [fitted, setFitted] = useState(true);

  // Größe der Fläche verfolgen; solange nicht verschoben, bleibt der Weg eingepasst.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w <= 0 || h <= 0) return;
      setSize((old) => {
        if (old.w === w && old.h === h) return old;
        setBox((b) => (fitted ? fitHome(w, h) : fitViewBox(b, w, h)));
        return { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitted, fitHome]);

  const unit = box.w / size.w;

  // --- Verschieben und Zoomen (wie MapExplorer) -----------------------------------
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
    if (dragged.current > 3 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    const r = svgRef.current!.getBoundingClientRect();
    const k = box.w / r.width;
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      dragged.current += Math.abs(dx) + Math.abs(dy);
      if (dragged.current > 3) {
        setBox((b) => ({ ...b, x: b.x - dx * k, y: b.y - dy * k }));
        setFitted(false);
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      dragged.current += 10;
      if (before > 0 && after > 0) {
        const c = toMap((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        setBox((bx) => zoomAt(bx, after / before, c.x, c.y));
        setFitted(false);
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };
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
      setFitted(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const zoomBy = (f: number) => {
    setBox((b) => zoomAt(b, f, b.x + b.w / 2, b.y + b.h / 2));
    setFitted(false);
  };
  const fitPath = () => {
    setFitted(true);
    setBox(fitHome(size.w, size.h));
  };
  const onMapKey = (e: React.KeyboardEvent) => {
    const step = 0.12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setBox((b) => ({ ...b, x: b.x + dx * b.w, y: b.y + dy * b.h }));
      setFitted(false);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.4);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomBy(1 / 1.4);
    }
  };

  // --- Auswahl ---------------------------------------------------------------------
  // Kehrt der Weg an einen früheren Ort zurück (nicht direkt aufeinander
  // folgend, also eigene Punkte), liegen Punkte übereinander: Gezeichnet wird
  // je Ort EINE Marke mit allen Nummern („1–2, 5–6“), sonst verdeckte der
  // spätere Punkt den früheren.
  const spots = useMemo(() => {
    const out: { points: number[] }[] = [];
    path.points.forEach((p, i) => {
      const same = out.find((s) => {
        const q = path.points[s.points[0]];
        return Math.abs(q.lat - p.lat) < 1e-4 && Math.abs(q.lon - p.lon) < 1e-4;
      });
      if (same) same.points.push(i);
      else out.push({ points: [i] });
    });
    return out;
  }, [path.points]);
  const spotOf = useMemo(() => {
    const m: number[] = [];
    spots.forEach((s, i) => s.points.forEach((p) => (m[p] = i)));
    return m;
  }, [spots]);
  const selectedPoint = selected !== null ? path.stations[selected]?.point : null;
  const chooseSpot = (points: number[]) => {
    if (dragged.current > 6) return;
    const stations = points.flatMap((p) => path.points[p].stations);
    // Erneutes Antippen eines zusammengefassten Punkts geht seine Stationen durch.
    const at = selected !== null ? stations.indexOf(selected) : -1;
    const next = stations[(at + 1) % stations.length];
    setSelected(next);
    // Ohne Animation: respektiert „weniger Bewegung“ von selbst.
    requestAnimationFrame(() => itemRefs.current.get(next)?.scrollIntoView({ block: "nearest" }));
  };

  const line = path.stations.filter((s) => s.n !== null);
  const undated = path.stations.filter((s) => s.n === null);
  const indexOf = (s: PathStation) => path.stations.indexOf(s);
  const labelOf = (point: number) => {
    const st = path.points[point].stations.map((i) => path.stations[i]);
    if (kind === "person") {
      const years = [...new Set(st.map((s) => s.yearText).filter(Boolean))];
      return years.length <= 1 ? (years[0] ?? "") : `${years[0]} – ${years[years.length - 1]}`;
    }
    return st.map((s) => [s.title, s.yearText].filter(Boolean).join(", ")).join(" · ");
  };
  const spotNumbers = (points: number[]) => points.map((p) => pointNumbers(path, p)).join(", ");
  const spotLabel = (points: number[]) => points.map(labelOf).filter(Boolean).join(kind === "person" ? ", " : " · ");
  const anySkipped = path.segments.some((s) => s.skipped);
  const merged = path.points.some((p) => p.stations.length > 1);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="lifepath">
      <div className="min-w-0 space-y-2">
        <div
          ref={wrapRef}
          className="relative h-[55vh] max-h-[640px] min-h-[300px] w-full overflow-hidden rounded-xl border border-stone-300 dark:border-stone-700"
          style={{ background: "var(--map-sea)" }}
        >
          <svg
            ref={svgRef}
            viewBox={[box.x, box.y, box.w, box.h].map((v) => v.toFixed(2)).join(" ")}
            suppressHydrationWarning
            width="100%"
            height="100%"
            className="block cursor-grab touch-none select-none focus-visible:outline-none active:cursor-grabbing"
            role="img"
            aria-label={`Karte (heutige Grenzen): Weg mit ${path.points.length} ${path.points.length === 1 ? "Punkt" : "Punkten"}. Mit Pfeiltasten verschieben, Plus und Minus zoomen. Die Stationen stehen auch in der Liste.`}
            tabIndex={0}
            onKeyDown={onMapKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            data-testid="lifepath-svg"
          >
            <g>
              {(countries ?? []).map((c) => (
                <path key={c.id + c.d.length} d={c.d} fill="var(--map-land)" stroke="var(--map-border)" strokeWidth={0.8 * unit} strokeLinejoin="round">
                  <title>{c.name}</title>
                </path>
              ))}
            </g>
            {mounted && (
              <>
                <g data-testid="lifepath-segments">
                  {path.segments.map((s) => {
                    const [ax, ay] = projected[s.from];
                    const [bx, by] = projected[s.to];
                    const len = Math.hypot(bx - ax, by - ay);
                    // Hin und zurück zwischen denselben Orten: beide Teilstücke
                    // etwas nach rechts (in Wegrichtung) versetzen, damit sich
                    // Linien und Pfeile nicht decken.
                    const pair = (x: { from: number; to: number }) =>
                      [spotOf[x.from], spotOf[x.to]].sort((p, q) => p - q).join("-");
                    const shared = path.segments.some((o) => o !== s && pair(o) === pair(s));
                    const off = shared && len > 0 ? (4 * unit) / len : 0;
                    const [dx, dy] = [-(by - ay) * off, (bx - ax) * off];
                    const [x0, y0, x1, y1] = [ax + dx, ay + dy, bx + dx, by + dy];
                    const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
                    const a = 7 * unit;
                    const showArrow = len > (POINT_R * 2 + 16) * unit;
                    return (
                      <g key={`${s.from}-${s.to}`} data-testid="lifepath-segment" data-skipped={s.skipped ? "true" : "false"}>
                        <line
                          x1={x0}
                          y1={y0}
                          x2={x1}
                          y2={y1}
                          stroke="var(--path-casing)"
                          strokeWidth={5.5 * unit}
                          strokeLinecap="round"
                          strokeDasharray={s.skipped ? `${7 * unit} ${6 * unit}` : undefined}
                        />
                        <line
                          x1={x0}
                          y1={y0}
                          x2={x1}
                          y2={y1}
                          stroke="var(--path-stroke)"
                          strokeWidth={3 * unit}
                          strokeLinecap="round"
                          strokeDasharray={s.skipped ? `${7 * unit} ${6 * unit}` : undefined}
                        />
                        {showArrow && (
                          <polygon
                            points={`${a},0 ${-a * 0.8},${a * 0.75} ${-a * 0.8},${-a * 0.75}`}
                            transform={`translate(${(x0 + x1) / 2} ${(y0 + y1) / 2}) rotate(${angle})`}
                            fill="var(--path-stroke)"
                            stroke="var(--path-casing)"
                            strokeWidth={1.2 * unit}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
                <g>
                  {spots.map((spot) => {
                    const [x, y] = projected[spot.points[0]];
                    const text = spotNumbers(spot.points);
                    const wPx = Math.max(POINT_R * 2, text.length * 6.5 + 12);
                    const active = selectedPoint !== null && selectedPoint !== undefined && spot.points.includes(selectedPoint);
                    const label = spotLabel(spot.points);
                    return (
                      <g
                        key={spot.points[0]}
                        className="cursor-pointer"
                        onClick={() => chooseSpot(spot.points)}
                        data-testid="lifepath-point"
                        data-numbers={text}
                        data-active={active ? "true" : undefined}
                      >
                        <title>{`${text}: ${path.points[spot.points[0]].label}${label ? ` (${label})` : ""}`}</title>
                        <circle cx={x} cy={y} r={HIT_R * unit} fill="transparent" />
                        <rect
                          x={x - (wPx / 2) * unit}
                          y={y - POINT_R * unit}
                          width={wPx * unit}
                          height={POINT_R * 2 * unit}
                          rx={POINT_R * unit}
                          fill="var(--path-stroke)"
                          stroke={active ? "var(--map-ring)" : "var(--path-casing)"}
                          strokeWidth={(active ? 3 : 1.5) * unit}
                        />
                        <text
                          x={x}
                          y={y}
                          dy="0.35em"
                          textAnchor="middle"
                          fontSize={11 * unit}
                          fontWeight={700}
                          fill="var(--path-fg)"
                          pointerEvents="none"
                        >
                          {text}
                        </text>
                        {label && (
                          <text
                            x={x + (wPx / 2 + 5) * unit}
                            y={y}
                            dy="0.35em"
                            fontSize={12 * unit}
                            fontWeight={active ? 700 : 500}
                            fill="var(--path-label)"
                            stroke="var(--path-casing)"
                            strokeWidth={3 * unit}
                            paintOrder="stroke"
                            data-testid="lifepath-label"
                          >
                            {label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </>
            )}
          </svg>

          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button type="button" className="btn-secondary h-11 w-11 px-0 text-lg" onClick={() => zoomBy(1.5)} aria-label="Hineinzoomen">
              +
            </button>
            <button type="button" className="btn-secondary h-11 w-11 px-0 text-lg" onClick={() => zoomBy(1 / 1.5)} aria-label="Herauszoomen">
              −
            </button>
          </div>
          <div className="absolute left-2 top-2">
            <button
              type="button"
              className="btn-secondary min-h-11"
              aria-pressed={fitted}
              style={fitted ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
              onClick={fitPath}
              data-testid="lifepath-fit"
            >
              Ganzer Weg
            </button>
          </div>
          {path.points.length === 0 && (
            <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg bg-surface/90 p-3 text-center text-sm" data-testid="lifepath-empty">
              Keine Station hat einen Ort auf der Karte.
            </p>
          )}
          <p className="pointer-events-none absolute bottom-1 left-2 rounded bg-surface/80 px-1.5 text-[11px] muted">heutige Grenzen</p>
        </div>
        {!countries && <p className="text-xs muted">Karte wird geladen …</p>}
        <p className="text-xs muted" data-testid="lifepath-legend">
          Die Nummern zeigen die Reihenfolge, die Pfeile die Richtung des Wegs.
          {merged && " Aufeinanderfolgende Stationen am selben Ort sind ein Punkt."}
          {spots.length < path.points.length && " Kehrt der Weg an einen Ort zurück, stehen dort alle Nummern."}
          {anySkipped && " Gestrichelt: dazwischen liegen Stationen ohne Ort auf der Karte."}
        </p>
      </div>

      <section className="card min-w-0 space-y-2 p-3" aria-labelledby={`${ids}-list`} data-testid="lifepath-list">
        <h2 id={`${ids}-list`} className="font-serif text-lg font-semibold">
          {kind === "person" ? "Stationen" : "Generationen"}
        </h2>
        {kind !== "person" && lineEnd && (
          <p className="rounded-lg border border-dashed border-stone-300 px-2 py-1.5 text-sm muted dark:border-stone-700" data-testid="lifepath-line-end" data-end={lineEnd}>
            {LINE_END_TEXT[kind][lineEnd]}
          </p>
        )}
        {line.length === 0 ? (
          <p className="text-sm muted">Keine Station mit Ort erfasst.</p>
        ) : (
          <ol className="space-y-1">
            {line.map((s) => {
              const i = indexOf(s);
              return (
                <li
                  key={s.key}
                  ref={(el) => {
                    if (el) itemRefs.current.set(i, el);
                    else itemRefs.current.delete(i);
                  }}
                  data-testid="lifepath-station"
                  data-active={selected === i ? "true" : undefined}
                  className={`flex items-start rounded-lg ${selected === i ? "bg-accent-50 ring-2 ring-accent-600 dark:bg-accent-900/40 dark:ring-accent-300" : ""}`}
                >
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-stone-900/5 dark:hover:bg-white/10"
                    aria-pressed={selected === i}
                    onClick={() => setSelected(selected === i ? null : i)}
                  >
                    <StationNumber n={s.n!} onMap={s.point !== null} />
                    <StationText s={s} kind={kind} precision={s.point !== null ? path.points[s.point].precision : undefined} />
                  </button>
                  {s.personId && (
                    <Link href={`/people/${s.personId}`} className="btn-link inline-flex min-h-11 shrink-0 items-center px-2 text-sm" aria-label={`Personenseite von ${s.title}`} data-testid="lifepath-person-link">
                      Personenseite
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {undated.length > 0 && (
          <div data-testid="lifepath-undated">
            <h3 className="eyebrow mt-3">ohne Datum</h3>
            <p className="text-xs muted">Nicht Teil des Wegs — die App weiß nicht, wann sie waren.</p>
            <ul className="mt-1 space-y-1">
              {undated.map((s) => (
                <li key={s.key} className="flex items-start gap-2 px-1.5 py-1 text-sm" data-testid="lifepath-station-undated">
                  <span aria-hidden className="mt-0.5 inline-block w-7 shrink-0 text-center muted">
                    –
                  </span>
                  <StationText s={s} kind={kind} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function StationNumber({ n, onMap }: { n: number; onMap: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        onMap ? "" : "border border-dashed border-stone-400 muted dark:border-stone-600"
      }`}
      style={onMap ? { background: "var(--path-stroke)", color: "var(--path-fg)" } : undefined}
    >
      {n}
      <span className="sr-only">{onMap ? ". " : ", nicht auf der Karte. "}</span>
    </span>
  );
}

function StationText({
  s,
  kind,
  precision,
}: {
  s: PathStation;
  kind: "person" | "father" | "mother";
  precision?: "PLACE" | "REGION" | "COUNTRY";
}) {
  // Ungenaue Daten tragen keinen eigenen Hinweis: Die Unsicherheit steht
  // schon in der Angabe selbst („um 1858“, „vor 1900“); reine Jahres- oder
  // Monatsangaben bleiben ohne Zusatz.
  return (
    <span className="min-w-0">
      <span className="block">
        {s.dateText && kind === "person" && (
          <span className="font-semibold tabular-nums">
            {s.dateText} ·{" "}
          </span>
        )}
        <span className="font-medium">{s.title}</span>
        {s.detail && <span className="muted"> · {s.detail}</span>}
      </span>
      {kind !== "person" && (
        <span className="block text-xs muted">
          {s.dateText || "Geburtsjahr unbekannt"}
        </span>
      )}
      <span className="block text-xs">
        {s.placeText ? <span>{s.placeText}</span> : <span className="muted">kein Ort erfasst</span>}
        {s.placeStatus === "unassigned" && (
          <span className="muted" data-testid="lifepath-unassigned">
            {" "}
            · Ort nicht zugeordnet
          </span>
        )}
        {s.placeStatus === "unresolvable" && <span className="muted"> · Ort nicht zuordenbar</span>}
        {precision && precision !== "PLACE" && (
          <span className="muted"> · nur {precision === "REGION" ? "die Region" : "das Land"} bekannt</span>
        )}
      </span>
    </span>
  );
}
