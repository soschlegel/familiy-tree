"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import {
  centerLabelRows,
  fitName,
  fitYears,
  lineColorVar,
  lineTint,
  ringGeometry,
  RINGS_MAX_GENERATION,
  RINGS_MIN_GENERATION,
  RINGS_VIEWBOX,
  ringsSummary,
  sectorPath,
  slotAngles,
  truncate,
  type RingsColoring,
} from "@/lib/ancestor-rings";
import { descendantsSummary } from "@/lib/descendant-rings";
import { LINE_CODE, LINE_KEYS, LINE_LABEL } from "@/lib/reference";
import {
  defaultPrintTitle,
  mmToPx,
  pageRule,
  PAPER_FORMAT_KEYS,
  PAPER_FORMATS,
  printColor,
  printFileName,
  printLabelPlan,
  printPattern,
  printPxPerUnit,
  printSubtitle,
  printTint,
  PRINT_ACCENT,
  PRINT_COLORS,
  PRINT_INK,
  PRINT_MUTED,
  PRINT_PAPER,
  PRINT_TITLE_MAX,
  ringsPrintUrl,
  RINGS_PRINT_OUTER_GENERATION,
  sheetLayout,
  sheetSize,
  type PaperFormat,
  type PaperOrientation,
  type RingsPrintSettings,
} from "@/lib/rings-print";
import { personName, ringSegments, shownRingCount, slotKey, type RingSegment, type RingsData } from "@/lib/rings-segments";
import { HelpLink } from "./HelpLink";
import { RingsSlotLabel } from "./RingsSlotLabel";
import { treeUrl } from "./tree-url";

/**
 * Druckansicht der Ringe („Ahnentafel zum Drucken“, app/tree/print): oben
 * eine Einstellzeile, die nicht mitgedruckt wird, darunter das Blatt als
 * Vorschau im richtigen Seitenverhältnis. Das Blatt ist ein einziges SVG in
 * Millimetern mit festen, hellen Farben (lib/rings-print.ts) — im Druck
 * genau in Blattgröße (`@page`), als Download dieselbe Datei. Daten und
 * Rechte wie in der Bildschirmansicht (lib/services/rings-view.ts); hier
 * wird nur gezeichnet, was der Dienst geliefert hat.
 */

const GENERATIONS = Array.from({ length: RINGS_MAX_GENERATION - RINGS_MIN_GENERATION + 1 }, (_, i) => RINGS_MIN_GENERATION + i);

const SANS = "'Source Sans 3', 'Source Sans Pro', Arial, Helvetica, sans-serif";
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";

type LegendEntry = { label: string; fill: string; pattern: number; kind: "color" | "restricted" | "gap" };

type Props = {
  data: RingsData;
  settings: RingsPrintSettings;
  /** Heutiges Datum, ausgeschrieben („27. November 2026“) — vom Server, damit Vorschau und Druck übereinstimmen. */
  today: string;
};

export function RingsPrintSheet({ data, settings, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);

  const [coloring, setColoring] = useState<RingsColoring>(settings.coloring);
  const [format, setFormat] = useState<PaperFormat>(settings.format);
  const [orientation, setOrientation] = useState<PaperOrientation>(settings.orientation);
  const [title, setTitle] = useState(settings.title);
  const [showDate, setShowDate] = useState(settings.date);
  const [outerNames, setOuterNames] = useState(settings.outerNames);

  const direction = data.direction;
  const n = data.generations;
  const rootId = data.root.id;
  const rootName = personName(data.root);
  const defaultTitle = defaultPrintTitle(direction, rootName);
  const shownTitle = title.trim() || defaultTitle;

  const current = (o: Partial<RingsPrintSettings> = {}): RingsPrintSettings => ({
    focus: rootId,
    direction,
    generations: n,
    coloring,
    format,
    orientation,
    title,
    date: showDate,
    outerNames,
    ...o,
  });

  // Adresse nachführen (Neuladen, Teilen) — ohne neue Daten.
  useEffect(() => {
    window.history.replaceState(null, "", ringsPrintUrl(current()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coloring, format, orientation, title, showDate, outerNames, rootId, n, direction]);

  const reload = (o: Partial<RingsPrintSettings>) =>
    startTransition(() => router.replace(ringsPrintUrl(current(o)), { scroll: false }));

  const { width: W, height: H } = sheetSize(format, orientation);

  // ---- Legende -----------------------------------------------------------
  const segments = useMemo(() => ringSegments(data), [data]);
  const legend = useMemo<{ heading: string; entries: LegendEntry[]; areaIndex: Map<string, number> }>(() => {
    const areaIndex = new Map<string, number>();
    const entries: LegendEntry[] = [];
    const restricted: LegendEntry = { label: "nicht freigegeben", fill: "", pattern: 0, kind: "restricted" };
    if (coloring === "wurzeln") {
      data.areas
        .filter((a) => a.key !== "restricted")
        .forEach((a, i) => {
          areaIndex.set(a.key, i);
          entries.push({ label: `${a.label} (${a.count})`, fill: printTint(a.color, a.key.startsWith("area:") ? 55 : 70), pattern: printPattern(i), kind: "color" });
        });
      if (data.restricted > 0) entries.push({ ...restricted, label: `nicht freigegeben (${data.restricted})` });
      if (data.direction === "vorfahren") entries.push({ label: "nicht erfasst", fill: "", pattern: 0, kind: "gap" });
      return { heading: "Farben nach Wurzeln (Land des Geburtsorts)", entries, areaIndex };
    }
    if (data.direction === "nachfahren") {
      for (const l of data.lines) {
        entries.push(
          l.personId
            ? { label: personName(data.persons[l.personId]), fill: printTint(l.color, 50), pattern: printPattern(l.line), kind: "color" }
            : { ...restricted },
        );
      }
      if (data.segments.some((s) => s.kind === "restricted" && s.generation > 1)) entries.push(restricted);
      return { heading: "Farben nach Linie (je Kind)", entries, areaIndex };
    }
    LINE_KEYS.forEach((k, i) => {
      const s = data.slots.find((x) => x.generation === 2 && x.index === i);
      const who = !s ? "nicht erfasst" : s.kind === "restricted" ? "nicht freigegeben" : personName(data.persons[s.personId]);
      entries.push({ label: `${LINE_CODE[k]} ${LINE_LABEL[k]}: ${who}`, fill: printTint(lineColorVar(k), 50), pattern: printPattern(i), kind: "color" });
    });
    entries.push(restricted, { label: "nicht erfasst", fill: "", pattern: 0, kind: "gap" });
    return { heading: "Farben nach Linie (nach außen heller)", entries, areaIndex };
  }, [data, coloring]);

  const summary =
    data.direction === "nachfahren" ? descendantsSummary(data.count, data.deepest, data.restricted) : ringsSummary(n, data.known, data.restricted);

  const layout = sheetLayout({
    format,
    orientation,
    title: shownTitle,
    subtitle: showDate ? printSubtitle(direction, shownRingCount(data, RINGS_MIN_GENERATION), today) : null,
    footer: showDate ? `${summary} · Stand: ${today}` : summary,
    legendHeading: legend.heading,
    legendItems: legend.entries.map((e) => e.label),
  });

  // ---- Kreis --------------------------------------------------------------
  const geometry = useMemo(() => ringGeometry(shownRingCount(data, RINGS_MIN_GENERATION)), [data]);
  const d = layout.chart.diameter;
  const ppu = printPxPerUnit(d);
  const mmPerUnit = d / RINGS_VIEWBOX;
  const C = geometry.center;
  const k = layout.scale;
  // Muster in Kreis-Einheiten: Abstand etwa 2 mm (größeres Papier etwas weiter).
  const patSpace = (2 * Math.sqrt(k)) / mmPerUnit;
  const patStroke = (0.22 * Math.sqrt(k)) / mmPerUnit;
  const sepStroke = 0.35 / mmPerUnit;

  const fillOf = (s: RingSegment): string => {
    if (s.kind === "restricted") return PRINT_COLORS["--rings-restricted"];
    if (coloring === "wurzeln") {
      const area = s.area ?? "unknown";
      const color = data.areas.find((a) => a.key === area)?.color ?? "var(--chart-unknown)";
      return printTint(color, area.startsWith("area:") ? 55 : 70);
    }
    return printTint(s.lineColor, lineTint(s.generation));
  };
  const patternOf = (s: RingSegment): TextureKind => {
    if (s.kind === "restricted") return "r";
    const index = coloring === "wurzeln" ? (legend.areaIndex.get(s.area ?? "unknown") ?? legend.areaIndex.get("unknown") ?? 0) : s.lineIndex;
    return printPattern(index) as TextureKind;
  };

  const gaps: ReactNode[] = [];
  if (data.direction === "vorfahren") {
    const taken = new Set(segments.map((s) => s.key));
    for (const ring of geometry.rings) {
      for (let i = 0; i < 2 ** ring.generation; i++) {
        const key = slotKey(ring.generation, i);
        if (taken.has(key)) continue;
        const { start, end } = slotAngles(ring.generation, i);
        gaps.push(
          <path
            key={key}
            d={sectorPath(C, ring.inner, ring.outer, start, end)}
            fill="#fafaf9"
            stroke="#d6d3d1"
            strokeWidth={0.25 / mmPerUnit}
            strokeDasharray={`${1 / mmPerUnit} ${1.2 / mmPerUnit}`}
          />,
        );
      }
    }
  }

  const areas: ReactNode[] = [];
  const labels: ReactNode[] = [];
  // Muster als echte Linien, beschnitten auf die Flächen gleichen Musters —
  // SVG-<pattern> würde Chromium im PDF als grobe Rastergrafik ausgeben.
  const textured: Record<TextureKind, string[]> = { 0: [], 1: [], 2: [], 3: [], r: [] };
  for (const s of segments) {
    const ring = geometry.rings[s.generation - 1];
    if (!ring) continue;
    const path = sectorPath(C, ring.inner, ring.outer, s.start, s.end);
    textured[patternOf(s)].push(path);
    areas.push(
      <path
        key={s.key}
        data-slot={s.key}
        data-kind={s.kind}
        d={path}
        fill={fillOf(s)}
        stroke={PRINT_PAPER}
        strokeWidth={s.end - s.start < 2 ? sepStroke / 2 : sepStroke}
      />,
    );
    const person = s.personId ? data.persons[s.personId] : null;
    const plan = printLabelPlan(ring, (s.end - s.start) / 360, ppu, k, outerNames, person ? personName(person).length : 17);
    if (plan.mode === "none") continue;
    const life = person?.lifeSpan ?? "";
    const lines = person
      ? [fitName(person.givenName, person.familyName, plan.maxChars), plan.lines > 1 ? fitYears(life, Math.floor(plan.maxChars * 1.12)) : ""]
      : [truncate("Nicht freigegeben", plan.maxChars), ""];
    if (!lines[0]) continue;
    const mid = (s.start + s.end) / 2;
    labels.push(
      <RingsSlotLabel
        key={s.key}
        uid={uid}
        slotId={s.key}
        plan={plan}
        center={C}
        inner={ring.inner}
        outer={ring.outer}
        {...(s.end - s.start >= 359.99 ? { start: 90, end: 450, mid: 270 } : { start: s.start, end: s.end, mid })}
        lines={lines}
        restricted={s.kind === "restricted"}
        ink={PRINT_INK}
      />,
    );
  }
  const centerRows = centerLabelRows(data.root, geometry.centerRadius, C, ppu, mmToPx(4.2 * Math.sqrt(k)));

  // ---- Legende zeichnen ---------------------------------------------------
  const L = layout.legend;
  const swatch = (e: LegendEntry, x: number, y: number, i: number) => {
    const common = { x, y, width: L.swatch, height: L.swatch, rx: L.swatch * 0.18 };
    if (e.kind === "gap") {
      return <rect {...common} fill="#fafaf9" stroke="#a8a29e" strokeWidth={0.25} strokeDasharray="0.8 0.8" />;
    }
    const kind: TextureKind = e.kind === "restricted" ? "r" : (e.pattern as TextureKind);
    const clip = `${uid}-l${i}`;
    return (
      <g>
        <rect {...common} fill={e.kind === "restricted" ? PRINT_COLORS["--rings-restricted"] : e.fill} />
        {kind !== 0 && (
          <>
            <clipPath id={clip}>
              <rect {...common} />
            </clipPath>
            <g clipPath={`url(#${clip})`}>
              <Texture kind={kind} x={x} y={y} size={L.swatch} space={L.swatch / 3.2} stroke={L.swatch / 18} />
            </g>
          </>
        )}
        <rect {...common} fill="none" stroke="#a8a29e" strokeWidth={0.15} />
      </g>
    );
  };

  // ---- Bild speichern -------------------------------------------------------
  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Nur die Größe der Vorschau weg — die Datei trägt das echte Blattmaß.
    clone.removeAttribute("style");
    clone.removeAttribute("class");
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = printFileName(direction, rootName, format, orientation);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const seg = (active: boolean) =>
    `px-2.5 py-1.5 transition max-md:min-h-11 ${
      active ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950" : "hover:bg-stone-100 dark:hover:bg-stone-800"
    }`;
  const group = "flex overflow-hidden rounded-lg border border-stone-300 bg-surface text-sm dark:border-stone-700";

  return (
    <div data-print-page className="flex min-h-[100dvh] flex-col">
      {/* Papierformat für den Druckdialog; im Druck genau in Blattgröße. */}
      <style>{`${pageRule(format, orientation)}
@media print { [data-print-sheet] { width: ${W}mm !important; height: ${H}mm !important; max-width: none !important; } }`}</style>

      <div
        className="z-20 flex flex-wrap md:sticky md:top-0 items-center gap-2 border-b border-stone-900/10 bg-surface/95 px-3 py-2 backdrop-blur print:hidden dark:border-white/10"
        data-testid="print-controls"
        role="region"
        aria-label="Druckeinstellungen"
      >
        <Link
          href={treeUrl({ view: "rings", focus: rootId, direction, generations: n, coloring })}
          className="btn-secondary font-normal max-md:min-h-11"
          data-testid="print-back"
        >
          ← Zurück
        </Link>
        <h1 className="mr-1 font-serif text-lg font-semibold tracking-tight">Drucken</h1>

        <label className="flex items-center gap-1 text-sm">
          <span className="muted">Papier</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as PaperFormat)}
            data-testid="print-format"
            className="field w-auto py-1"
          >
            {PAPER_FORMAT_KEYS.map((f) => (
              <option key={f} value={f}>
                {PAPER_FORMATS[f].label}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Ausrichtung" className={group}>
          {(["hoch", "quer"] as const).map((o) => (
            <button key={o} type="button" aria-pressed={orientation === o} data-testid={`print-orientation-${o}`} onClick={() => setOrientation(o)} className={seg(orientation === o)}>
              {o === "hoch" ? "Hochformat" : "Querformat"}
            </button>
          ))}
        </div>

        <label className="flex min-w-0 flex-1 basis-56 items-center gap-1 text-sm">
          <span className="muted">Titel</span>
          <input
            type="text"
            value={title}
            maxLength={PRINT_TITLE_MAX}
            placeholder={defaultTitle}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="print-title"
            className="field min-w-0 flex-1 py-1"
          />
        </label>

        <div role="group" aria-label="Färbung" className={group}>
          {(["linie", "wurzeln"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={coloring === c} data-testid={`print-coloring-${c}`} onClick={() => setColoring(c)} className={seg(coloring === c)}>
              {c === "linie" ? "nach Linie" : "nach Wurzeln"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-sm">
          <span className="muted">Generationen</span>
          <select
            value={n}
            onChange={(e) => reload({ generations: Number(e.target.value) })}
            data-testid="print-generations"
            className="field w-auto py-1 tabular-nums"
          >
            {GENERATIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm max-md:min-h-11">
          <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} data-testid="print-date" />
          Untertitel und Datum
        </label>
        <label className="flex items-center gap-1.5 text-sm max-md:min-h-11" title={`Ringe ab der ${RINGS_PRINT_OUTER_GENERATION}. Generation`}>
          <input type="checkbox" checked={outerNames} onChange={(e) => setOuterNames(e.target.checked)} data-testid="print-outer-names" />
          Namen in den äußeren Ringen zeigen, soweit Platz
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadSvg} className="btn-secondary font-normal max-md:min-h-11" data-testid="print-svg">
            Als Bild speichern (SVG)
          </button>
          <button type="button" onClick={() => window.print()} className="btn-primary max-md:min-h-11" data-testid="print-now">
            Jetzt drucken
          </button>
          <HelpLink to="ringeDrucken" compact label="Wie funktioniert das Drucken?" className="self-center" />
        </div>
        <p className="w-full text-xs muted">
          Tipp: Im Druckdialog „Hintergrundgrafiken“ einschalten und als Papierformat {PAPER_FORMATS[format].label}{" "}
          {orientation === "quer" ? "quer" : "hoch"} wählen — oder „Als PDF speichern“.
        </p>
      </div>

      <div
        className="flex flex-1 items-start justify-center bg-stone-200 p-3 sm:p-6 print:block print:bg-transparent print:p-0 dark:bg-stone-800"
        data-testid="print-preview"
        aria-busy={pending}
      >
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${W} ${H}`}
          width={`${W}mm`}
          height={`${H}mm`}
          role="img"
          aria-label={`Druckvorschau: ${shownTitle}, Papier ${PAPER_FORMATS[format].label} ${orientation === "quer" ? "quer" : "hoch"}`}
          data-print-sheet
          data-testid="print-sheet"
          data-format={format}
          data-orientation={orientation}
          data-coloring={coloring}
          fontFamily={SANS}
          className="block h-auto font-sans shadow-lift print:shadow-none"
          style={{ width: `min(100%, calc((100dvh - 11rem) * ${W / H}))`, height: "auto", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        >
          <rect width={W} height={H} fill={PRINT_PAPER} />

          <text
            x={layout.title.x}
            y={layout.title.y}
            fontSize={layout.title.size}
            fontFamily={SERIF}
            fontWeight={600}
            textAnchor="middle"
            fill={PRINT_INK}
            className="font-serif"
            data-testid="print-sheet-title"
          >
            {layout.title.text}
          </text>
          {layout.subtitle && (
            <text x={layout.subtitle.x} y={layout.subtitle.y} fontSize={layout.subtitle.size} textAnchor="middle" fill={PRINT_MUTED} data-testid="print-sheet-subtitle">
              {layout.subtitle.text}
            </text>
          )}

          <g transform={`translate(${layout.chart.cx - d / 2} ${layout.chart.cy - d / 2}) scale(${mmPerUnit})`} data-testid="print-chart">
            <g>{gaps}</g>
            <circle cx={C} cy={C} r={geometry.centerRadius} fill={PRINT_PAPER} stroke={PRINT_ACCENT} strokeWidth={0.6 / mmPerUnit} />
            {areas}
            {(["1", "2", "3", "r"] as const).map((t) => {
              const kind: TextureKind = t === "r" ? "r" : (Number(t) as TextureKind);
              if (textured[kind].length === 0) return null;
              const clip = `${uid}-c${t}`;
              return (
                <g key={t}>
                  <clipPath id={clip}>
                    {textured[kind].map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </clipPath>
                  <g clipPath={`url(#${clip})`}>
                    <Texture kind={kind} x={0} y={0} size={RINGS_VIEWBOX} space={kind === "r" ? patSpace * 1.2 : patSpace} stroke={patStroke} />
                  </g>
                </g>
              );
            })}
            <g data-testid="print-labels">
              {centerRows.map((row, i) => (
                <text key={i} x={C} y={row.y} textAnchor="middle" fontSize={row.size} fontWeight={row.weight} fill={PRINT_INK}>
                  {row.text}
                </text>
              ))}
              {labels}
            </g>
          </g>

          <g data-testid="print-legend">
            <text x={L.heading.x} y={L.heading.y} fontSize={L.heading.size} fontWeight={600} fill={PRINT_INK}>
              {L.heading.text}
            </text>
            {L.items.map((item, i) => {
              const e = legend.entries[i];
              return (
                <g key={i}>
                  {swatch(e, item.x, item.y, i)}
                  {item.lines.map((line, j) => (
                    <text key={j} x={item.x + L.textOffset} y={item.y + L.size * 0.9 + j * L.lineHeight} fontSize={L.size} fill={PRINT_INK}>
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
            {L.hidden > 0 && L.items.length > 0 && (
              <text x={L.items[L.items.length - 1].x} y={L.items[L.items.length - 1].y + L.lineHeight * 2.2} fontSize={L.size} fill={PRINT_MUTED}>
                … und {L.hidden} weitere
              </text>
            )}
          </g>

          <text x={layout.footer.x} y={layout.footer.y} fontSize={layout.footer.size} textAnchor="middle" fill={PRINT_MUTED} data-testid="print-sheet-footer">
            {layout.footer.text}
          </text>
        </svg>
      </div>
    </div>
  );
}


/** 0 ohne Muster, 1 Punkte, 2 waagerechte Striche, 3 Gitter, „r“ Schraffur „nicht freigegeben“. */
type TextureKind = 0 | 1 | 2 | 3 | "r";

/**
 * Muster als Vektorlinien über dem Quadrat (x, y, size) — der Aufrufer
 * beschneidet sie auf die Flächen (ein SVG-<pattern> gäbe Chromium im PDF
 * als grobe Rastergrafik aus). Muster 1–3 dezent, damit die Schrift lesbar
 * bleibt, und ohne Schrägen, damit sie nicht mit der Schraffur „nicht
 * freigegeben“ verwechselt werden; Punkte sind gestrichelte Linien mit
 * runden Enden.
 */
function Texture({ kind, x, y, size, space, stroke }: { kind: TextureKind; x: number; y: number; size: number; space: number; stroke: number }) {
  if (kind === 0) return null;
  if (kind === "r") {
    // 45°-Schrägen, kräftig, in der Schraffurfarbe.
    const offsets = Array.from({ length: Math.ceil((2 * size) / space) + 1 }, (_, i) => -size + i * space);
    return (
      <g stroke={printColor("var(--rings-hatch)")} strokeOpacity={0.75} strokeWidth={space * 0.34} fill="none">
        {offsets.map((t, i) => (
          <line key={i} x1={x + t} y1={y} x2={x + t + size} y2={y + size} />
        ))}
      </g>
    );
  }
  const at = Array.from({ length: Math.ceil(size / space) }, (_, i) => (i + 0.5) * space);
  const dots = kind === 1;
  return (
    <g stroke="#1c1917" strokeOpacity={dots ? 0.34 : 0.28} fill="none" strokeWidth={dots ? stroke * 2.6 : stroke} strokeLinecap={dots ? "round" : undefined}>
      {at.map((v, i) => (
        <line
          key={`h${i}`}
          x1={x}
          y1={y + v}
          x2={x + size}
          y2={y + v}
          strokeDasharray={dots ? `0 ${space}` : undefined}
          strokeDashoffset={dots ? -space / 2 : undefined}
        />
      ))}
      {kind === 3 && at.map((v, i) => <line key={`v${i}`} x1={x + v} y1={y} x2={x + v} y2={y + size} />)}
    </g>
  );
}