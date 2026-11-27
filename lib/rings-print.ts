/**
 * „Ahnentafel zum Drucken“: die Ansicht „Ringe“ als Blatt — vom A4-Ausdruck
 * bis zum Poster (Seite app/tree/print, gezeichnet in
 * components/RingsPrintSheet.tsx). Reine Funktionen ohne Datenbank und ohne
 * Rechteprüfung: Adresse, Blattmaße, Aufteilung des Blatts, Schriftgrößen
 * nach Blattmaß, feste Druckfarben, Titelvorgabe und Dateiname.
 * Fachliche Regeln: docs/komponenten/bibliotheken.md („lib/rings-print.ts“).
 *
 * Grundsätze:
 * - Das ganze Blatt ist EIN SVG in Millimetern (viewBox = Blattmaß). Am
 *   Bildschirm wird es als Vorschau verkleinert, im Druck genau in
 *   Blattgröße gesetzt (`@page` mit `size` und Rand 0, Seitenränder liegen
 *   im Blatt selbst). Dasselbe SVG ist der Download „Als Bild speichern“.
 * - Feste, helle Farben (Werte des hellen Schemas aus app/globals.css,
 *   tests/rings-print.test.ts gleicht sie ab), Mischungen schon hier
 *   gerechnet — ohne CSS-Variablen und ohne `color-mix`, damit das Blatt
 *   im dunklen Schema hell bleibt und die SVG-Datei auch außerhalb des
 *   Browsers dieselben Farben zeigt.
 * - Beschriftung mit der Logik der Bildschirmansicht (arcLabelPlan), nur
 *   mit den Maßen des Blatts: Auf großem Papier passen mehr Namen.
 */

import {
  arcLabelPlan,
  parseRingsColoring,
  parseRingsDirection,
  parseRingsGeneration,
  RINGS_COLORING_PARAM,
  RINGS_DEFAULT_COLORING,
  RINGS_DEFAULT_DIRECTION,
  RINGS_DIRECTION_PARAM,
  RINGS_GENERATION_PARAM,
  ringsDefaultGeneration,
  type Ring,
  type RingLabelPlan,
  type RingsColoring,
  type RingsDirection,
} from "./ancestor-rings";
import { RINGS_PRINT_PATH } from "./rings-print-path";

export { RINGS_PRINT_PATH };

// ---------------------------------------------------------------------------
// Papier
// ---------------------------------------------------------------------------

/** Papierformate (DIN A), kurze × lange Seite in Millimetern. */
export const PAPER_FORMATS = {
  a4: { label: "A4", short: 210, long: 297 },
  a3: { label: "A3", short: 297, long: 420 },
  a2: { label: "A2", short: 420, long: 594 },
  a1: { label: "A1", short: 594, long: 841 },
  a0: { label: "A0", short: 841, long: 1189 },
} as const;

export type PaperFormat = keyof typeof PAPER_FORMATS;
export const PAPER_FORMAT_KEYS = Object.keys(PAPER_FORMATS) as PaperFormat[];
export type PaperOrientation = "hoch" | "quer";

export const PRINT_DEFAULT_FORMAT: PaperFormat = "a4";
export const PRINT_DEFAULT_ORIENTATION: PaperOrientation = "hoch";

/** Adressparameter der Druckansicht (dazu die der Ringe: focus, richtung, generationen, farbe). */
export const PRINT_PARAMS = {
  format: "format",
  orientation: "ausrichtung",
  title: "titel",
  /** „0“: ohne Untertitel und Datum. */
  date: "datum",
  /** „0“: äußere Ringe ohne Namen. */
  outerNames: "namen",
} as const;

/** Höchstlänge des frei wählbaren Titels. */
export const PRINT_TITLE_MAX = 80;

export const parsePaperFormat = (v: unknown): PaperFormat =>
  typeof v === "string" && v.toLowerCase() in PAPER_FORMATS ? (v.toLowerCase() as PaperFormat) : PRINT_DEFAULT_FORMAT;

export const parsePaperOrientation = (v: unknown): PaperOrientation => (v === "quer" ? "quer" : v === "hoch" ? "hoch" : PRINT_DEFAULT_ORIENTATION);

/** Blattmaß in Millimetern. */
export function sheetSize(format: PaperFormat, orientation: PaperOrientation): { width: number; height: number } {
  const f = PAPER_FORMATS[format];
  return orientation === "quer" ? { width: f.long, height: f.short } : { width: f.short, height: f.long };
}

/**
 * Regel für den Druckdialog: Papierformat und Ausrichtung, kein Rand des
 * Browsers (die Ränder liegen im Blatt). Als `<style>`-Inhalt auf der
 * Druckseite — Inline-Stile erlaubt die CSP (`style-src 'unsafe-inline'`).
 */
export function pageRule(format: PaperFormat, orientation: PaperOrientation): string {
  const { width, height } = sheetSize(format, orientation);
  return `@page { size: ${width}mm ${height}mm; margin: 0; }`;
}

// ---------------------------------------------------------------------------
// Einstellungen und Adresse
// ---------------------------------------------------------------------------

export type RingsPrintSettings = {
  focus: string | null;
  direction: RingsDirection;
  generations: number;
  coloring: RingsColoring;
  format: PaperFormat;
  orientation: PaperOrientation;
  /** Eigener Titel; leer = Vorgabe (defaultPrintTitle). */
  title: string;
  /** Untertitel und Datum zeigen. */
  date: boolean;
  /** Namen in den äußeren Ringen (ab RINGS_PRINT_OUTER_GENERATION), soweit Platz. */
  outerNames: boolean;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Eigener Titel: Steuerzeichen raus, Leerraum zusammengefasst, höchstens PRINT_TITLE_MAX Zeichen. */
export function cleanPrintTitle(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PRINT_TITLE_MAX);
}

/** Einstellungen aus der Adresse; Unbekanntes fällt auf die Vorgabe zurück. */
export function parseRingsPrintParams(params: Params): RingsPrintSettings {
  const direction = parseRingsDirection(one(params[RINGS_DIRECTION_PARAM]));
  const focus = one(params.focus);
  return {
    focus: focus && /^[\w-]{1,64}$/.test(focus) ? focus : null,
    direction,
    generations: parseRingsGeneration(one(params[RINGS_GENERATION_PARAM]), ringsDefaultGeneration(direction)),
    coloring: parseRingsColoring(one(params[RINGS_COLORING_PARAM])),
    format: parsePaperFormat(one(params[PRINT_PARAMS.format])),
    orientation: parsePaperOrientation(one(params[PRINT_PARAMS.orientation])),
    title: cleanPrintTitle(one(params[PRINT_PARAMS.title])),
    date: one(params[PRINT_PARAMS.date]) !== "0",
    outerNames: one(params[PRINT_PARAMS.outerNames]) !== "0",
  };
}

/**
 * Adresse der Druckansicht (teilbar). Vorgaben bleiben weg — wie bei
 * treeUrl (components/tree-url.ts) mit denselben Parametern der Ringe.
 */
export function ringsPrintUrl(s: Partial<RingsPrintSettings> & { focus?: string | null }): string {
  const q = new URLSearchParams();
  const direction = s.direction ?? RINGS_DEFAULT_DIRECTION;
  if (s.focus) q.set("focus", s.focus);
  if (direction !== RINGS_DEFAULT_DIRECTION) q.set(RINGS_DIRECTION_PARAM, direction);
  if (s.generations !== undefined && s.generations !== ringsDefaultGeneration(direction)) q.set(RINGS_GENERATION_PARAM, String(s.generations));
  if (s.coloring && s.coloring !== RINGS_DEFAULT_COLORING) q.set(RINGS_COLORING_PARAM, s.coloring);
  if (s.format && s.format !== PRINT_DEFAULT_FORMAT) q.set(PRINT_PARAMS.format, s.format);
  if (s.orientation && s.orientation !== PRINT_DEFAULT_ORIENTATION) q.set(PRINT_PARAMS.orientation, s.orientation);
  const title = cleanPrintTitle(s.title);
  if (title) q.set(PRINT_PARAMS.title, title);
  if (s.date === false) q.set(PRINT_PARAMS.date, "0");
  if (s.outerNames === false) q.set(PRINT_PARAMS.outerNames, "0");
  const query = q.toString();
  return query ? `${RINGS_PRINT_PATH}?${query}` : RINGS_PRINT_PATH;
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** Titelvorgabe: „Vorfahren von Anna Beispiel“ bzw. „Nachfahren von …“. */
export function defaultPrintTitle(direction: RingsDirection, name: string): string {
  return `${direction === "nachfahren" ? "Nachfahren" : "Vorfahren"} von ${name.trim() || "Unbekannt"}`;
}

/** Untertitel: „Ahnentafel über 5 Generationen · Stand: 27. November 2026“. */
export function printSubtitle(direction: RingsDirection, generations: number, date: string): string {
  const what = direction === "nachfahren" ? "Nachfahrentafel" : "Ahnentafel";
  return `${what} über ${generations} Generationen · Stand: ${date}`;
}

/** Datum für Untertitel und Fußzeile, deutsch und in deutscher Zeit („27. November 2026“). */
export function formatPrintDate(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" }).format(d);
}

const TRANSLIT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" };

/** Dateiname des Bilds: „vorfahren-anna-beispiel-a3-hoch.svg“ (nur a–z, 0–9 und Bindestrich). */
export function printFileName(direction: RingsDirection, name: string, format: PaperFormat, orientation: PaperOrientation): string {
  const slug = name
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLIT[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return [direction, slug || "person", format, orientation].join("-") + ".svg";
}

/**
 * Text auf höchstens `maxLines` Zeilen zu je `maxChars` Zeichen umbrechen
 * (an Leerzeichen); was nicht passt, endet mit „…“.
 */
export function wrapText(text: string, maxChars: number, maxLines = 2): string[] {
  const max = Math.max(1, Math.floor(maxChars));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines - 1) {
      // letzte Zeile: der Rest, notfalls gekürzt
      const rest = words.slice(i).join(" ");
      lines.push(rest.length <= max ? rest : `${rest.slice(0, Math.max(1, max - 1)).trimEnd()}…`);
      return lines;
    }
  }
  if (cur) lines.push(cur.length <= max ? cur : `${cur.slice(0, Math.max(1, max - 1)).trimEnd()}…`);
  return lines.slice(0, maxLines);
}

// ---------------------------------------------------------------------------
// Aufteilung des Blatts
// ---------------------------------------------------------------------------

const MM_PER_PX = 25.4 / 96;
export const mmToPx = (mm: number) => mm / MM_PER_PX;

/**
 * Ungefähre Zeichenbreite als Anteil der Schriftgröße: Grotesk (Source
 * Sans, eher schmal) bzw. Antiqua (Titel, Fraunces) — eher großzügig, damit
 * auch eine Ersatzschrift (SVG-Datei außerhalb der App) nicht überläuft.
 */
const SANS_CHAR = 0.48;
const SERIF_CHAR = 0.56;

export type SheetText = { text: string; x: number; y: number; size: number };
export type LegendSlot = { x: number; y: number; lines: string[] };

export type SheetLayout = {
  width: number;
  height: number;
  /** Maßstab gegenüber A4 (kurze Seite / 210). */
  scale: number;
  margin: number;
  title: SheetText;
  subtitle: SheetText | null;
  footer: SheetText;
  /** Kreis: Mittelpunkt und Durchmesser in Millimetern. */
  chart: { cx: number; cy: number; diameter: number };
  legend: {
    heading: SheetText;
    /** Kästchen-Kantenlänge, Schriftgröße, Zeilenhöhe. */
    swatch: number;
    size: number;
    lineHeight: number;
    /** Text beginnt so weit rechts vom Kästchen. */
    textOffset: number;
    items: LegendSlot[];
    /** Einträge, die keinen Platz mehr fanden (dann steht „… und n weitere“ am Ende). */
    hidden: number;
  };
};

export type SheetInput = {
  format: PaperFormat;
  orientation: PaperOrientation;
  title: string;
  subtitle: string | null;
  footer: string;
  legendHeading: string;
  legendItems: string[];
};

/**
 * Aufteilung des Blatts in Millimetern: oben Titel (und Untertitel), der
 * Kreis groß und mittig, die Legende hochkant unter dem Kreis (zweispaltig)
 * bzw. quer links neben ihm, unten die Fußzeile. Alle Größen wachsen mit dem
 * Papier (Maßstab = kurze Seite / 210 mm).
 */
export function sheetLayout(input: SheetInput): SheetLayout {
  const { width: W, height: H } = sheetSize(input.format, input.orientation);
  const k = Math.min(W, H) / 210;
  const m = 10 * k + 2;
  const inner = W - 2 * m;
  const gap = 4 * k;

  // Titel: höchstens 8 mm (A4), schmaler, wenn er sonst nicht in eine Zeile passt.
  const titleSize = Math.min(8 * k, inner / Math.max(1, input.title.length * SERIF_CHAR));
  const titleY = m + titleSize * 0.8;
  const subSize = 3.6 * k;
  const subtitle = input.subtitle ? { text: input.subtitle, x: W / 2, y: titleY + subSize * 1.9, size: Math.min(subSize, inner / Math.max(1, input.subtitle.length * SANS_CHAR)) } : null;
  const headerBottom = (subtitle ? subtitle.y + subSize * 0.3 : titleY + titleSize * 0.25) + gap;

  const footSize = 2.7 * k;
  const footer = { text: input.footer, x: W / 2, y: H - m, size: Math.min(footSize, inner / Math.max(1, input.footer.length * SANS_CHAR)) };
  const footerTop = H - m - footSize * 1.1 - gap;

  const size = 3.1 * k;
  const lineHeight = size * 1.3;
  const swatch = size * 1.25;
  const textOffset = swatch + size * 0.6;
  const itemGap = size * 0.55;
  const headingSize = size * 1.05;
  const headingH = headingSize * 1.7;

  const place = (items: string[], cols: number, colW: number, maxH: number) => {
    const chars = (colW - textOffset) / (size * SANS_CHAR);
    const wrapped = items.map((t) => wrapText(t, chars, 3));
    // Spaltenweise füllen; was nicht passt, fällt weg.
    const heights = wrapped.map((l) => l.length * lineHeight + itemGap);
    let shown = items.length;
    const colHeight = (n: number) => {
      const per = Math.ceil(n / cols);
      let worst = 0;
      for (let c = 0; c < cols; c++) worst = Math.max(worst, heights.slice(c * per, (c + 1) * per).reduce((a, b) => a + b, 0));
      return worst;
    };
    while (shown > 0 && headingH + colHeight(shown) > maxH) shown--;
    const per = Math.max(1, Math.ceil(shown / cols));
    return { wrapped: wrapped.slice(0, shown), per, height: headingH + colHeight(shown), hidden: items.length - shown };
  };

  let chart: SheetLayout["chart"];
  let legendX: number;
  let legendY: number;
  let colW: number;
  let laid: ReturnType<typeof place>;
  const cols = input.orientation === "quer" ? 1 : input.legendItems.length <= 3 ? 1 : 2;

  if (input.orientation === "quer") {
    const availH = footerTop - headerBottom;
    const minCol = 48 * k;
    const d = Math.min(availH, inner - 2 * (minCol + gap));
    colW = (W - d) / 2 - m - gap;
    chart = { cx: W / 2, cy: headerBottom + availH / 2, diameter: d };
    laid = place(input.legendItems, 1, colW, availH);
    legendX = m;
    legendY = headerBottom;
  } else {
    // Spalten nur so breit wie der längste Eintrag; der Block steht mittig.
    const longest = Math.max(input.legendHeading.length * 1.05, ...input.legendItems.map((t) => t.length));
    colW = Math.min(inner / cols, textOffset + longest * size * SANS_CHAR + 6 * k);
    const availH = footerTop - headerBottom;
    // Legende zuerst mit höchstens der Hälfte der Höhe, dann der Kreis.
    laid = place(input.legendItems, cols, colW, availH * 0.45);
    const d = Math.min(inner, availH - laid.height - gap);
    const block = d + gap + laid.height;
    const top = headerBottom + Math.max(0, (availH - block) / 2);
    chart = { cx: W / 2, cy: top + d / 2, diameter: d };
    legendY = top + d + gap;
    legendX = (W - cols * colW) / 2;
  }

  const items: LegendSlot[] = [];
  laid.wrapped.forEach((lines, i) => {
    const c = Math.floor(i / laid.per);
    const before = laid.wrapped.slice(c * laid.per, i).reduce((a, l) => a + l.length * lineHeight + itemGap, 0);
    items.push({ x: legendX + c * colW, y: legendY + headingH + before, lines });
  });

  return {
    width: W,
    height: H,
    scale: k,
    margin: m,
    title: { text: input.title, x: W / 2, y: titleY, size: titleSize },
    subtitle,
    footer,
    chart,
    legend: {
      heading: { text: input.legendHeading, x: legendX, y: legendY + headingSize, size: headingSize },
      swatch,
      size,
      lineHeight,
      textOffset,
      items,
      hidden: laid.hidden,
    },
  };
}

// ---------------------------------------------------------------------------
// Beschriftung der Ringe nach Blattmaß
// ---------------------------------------------------------------------------

/** Ab dieser Generation gelten Ringe als „äußere Ringe“ (Schalter „Namen in den äußeren Ringen“). */
export const RINGS_PRINT_OUTER_GENERATION = 5;

/**
 * Schriftgröße der Beschriftung im Ring `generation` in Bildpunkten (für
 * arcLabelPlan), aus dem Maßstab des Blatts: auf A4 innen 3,4 mm, weiter
 * außen 3,1 mm, in den äußeren Ringen 2,5 mm. Größeres Papier: Schrift
 * wächst langsamer als das Blatt (innen mit Maßstab^0,65, außen mit der
 * Wurzel) — so bleibt ein Poster aus der Entfernung lesbar, und außen
 * passen mehr Namen hinein als beim gleichmäßigen Vergrößern.
 * `null`: Ring bleibt unbeschriftet.
 */
export function printLabelFontPx(generation: number, scale: number, outerNames: boolean): number | null {
  const s = Math.max(1, scale);
  if (generation >= RINGS_PRINT_OUTER_GENERATION) return outerNames ? mmToPx(2.5 * Math.sqrt(s)) : null;
  return mmToPx((generation <= 2 ? 3.4 : 3.1) * s ** 0.65);
}

/**
 * Beschriftungsplan einer Fläche im Druck: dieselbe Regel wie am Bildschirm
 * (arcLabelPlan), nur mit den Schriftgrößen des Blatts. In den äußeren
 * Ringen zuerst die Schrift der mittleren Ringe — reicht sie nicht für
 * wenigstens „Vorname N.“ (bzw. den ganzen, kürzeren Namen), die kleinere
 * der äußeren Ringe. Ohne „Namen in den äußeren Ringen“: dort keine Schrift.
 */
export function printLabelPlan(
  ring: Ring,
  fraction: number,
  pxPerUnit: number,
  scale: number,
  outerNames: boolean,
  nameLength: number,
): RingLabelPlan {
  const none: RingLabelPlan = { generation: ring.generation, mode: "none", fontSize: 0, maxChars: 0, lines: 0 };
  const font = printLabelFontPx(ring.generation, scale, outerNames);
  if (font === null) return none;
  if (ring.generation < RINGS_PRINT_OUTER_GENERATION) return arcLabelPlan(ring, fraction, pxPerUnit, font);
  const large = arcLabelPlan(ring, fraction, pxPerUnit, mmToPx(3.1 * Math.max(1, scale) ** 0.65));
  if (large.mode !== "none" && large.maxChars >= Math.min(nameLength, 10)) return large;
  return arcLabelPlan(ring, fraction, pxPerUnit, font);
}

/** Bildpunkte je viewBox-Einheit des Kreises (1000 Einheiten) bei `diameterMm` Durchmesser. */
export const printPxPerUnit = (diameterMm: number) => mmToPx(diameterMm) / 1000;

// ---------------------------------------------------------------------------
// Feste Druckfarben
// ---------------------------------------------------------------------------

/**
 * Werte des hellen Schemas (app/globals.css) — tests/rings-print.test.ts
 * prüft, dass sie mit der Stildatei übereinstimmen.
 */
export const PRINT_COLORS: Record<string, string> = {
  "--line-ff": "#0072b2",
  "--line-fm": "#00866a",
  "--line-mf": "#c43c1e",
  "--line-mm": "#e0b000",
  "--chart-1": "#0072b2",
  "--chart-2": "#00866a",
  "--chart-3": "#c43c1e",
  "--chart-4": "#976f2f",
  "--chart-5": "#a8457f",
  "--chart-6": "#6750a4",
  "--chart-7": "#5b7a1e",
  "--chart-8": "#1f7a8c",
  "--chart-other": "#44403c",
  "--chart-unassigned": "#78716c",
  "--chart-unknown": "#a8a29e",
  "--chart-restricted": "#d6d3d1",
  "--rings-ink": "#1c1917",
  "--rings-restricted": "#e7e5e4",
  "--rings-hatch": "#a8a29e",
  "--rings-gap": "#a8a29e",
};

/** Papier und feste Töne des Blatts. */
export const PRINT_PAPER = "#ffffff";
export const PRINT_INK = "#1c1917";
export const PRINT_MUTED = "#57534e";
/** Ring um die Mitte (Akzentfarbe 500 des hellen Schemas). */
export const PRINT_ACCENT = "#3a7f6d";

const hex = (h: string) => {
  const v = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** `a` zu `percent` % mit `b` gemischt (wie `color-mix(in srgb, a p%, b)`). */
export function mixHex(a: string, b: string, percent: number): string {
  const p = Math.min(100, Math.max(0, percent)) / 100;
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((c, i) => c * p + y[i] * (1 - p)));
}

/**
 * Feste Farbe zu einer Farbangabe der Bildschirmansicht: `var(--chart-3)`,
 * `color-mix(in srgb, var(--line-ff), var(--line-fm))` (Eltern) oder schon
 * `#rrggbb`. Unbekanntes wird ein neutrales Grau.
 */
export function printColor(css: string): string {
  const c = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const v = /^var\((--[\w-]+)\)$/.exec(c);
  if (v) return PRINT_COLORS[v[1]] ?? PRINT_COLORS["--chart-unknown"];
  const mix = /^color-mix\(in srgb,\s*(.+?),\s*(.+)\)$/.exec(c);
  if (mix) return mixHex(printColor(mix[1]), printColor(mix[2]), 50);
  return PRINT_COLORS["--chart-unknown"];
}

/**
 * Fläche: Farbe zu `percent` % auf weißem Papier — höchstens so kräftig,
 * dass die Schrift darauf noch mindestens 4,5 : 1 Kontrast hat (betrifft
 * dunkle Töne wie „Sonstige“).
 */
export function printTint(css: string, percent: number): string {
  const color = printColor(css);
  let p = percent;
  let out = mixHex(color, PRINT_PAPER, p);
  while (p > 0 && contrast(PRINT_INK, out) < 4.5) {
    p -= 2;
    out = mixHex(color, PRINT_PAPER, p);
  }
  return out;
}

/** Relative Helligkeit (WCAG) einer Farbe `#rrggbb`. */
export function luminance(color: string): number {
  const [r, g, b] = hex(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast zweier Farben nach WCAG (1…21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Muster je Linie bzw. Legendeneintrag — damit Flächen auch in Graustufen
 * unterscheidbar bleiben: 0 ohne, 1 Punkte, 2 Schrägstriche, 3 waagerechte
 * Striche; danach wieder von vorn. „Nicht freigegeben“ hat seine eigene,
 * kräftigere Schraffur in Gegenrichtung.
 */
export const PRINT_PATTERN_COUNT = 4;
export const printPattern = (index: number) => ((index % PRINT_PATTERN_COUNT) + PRINT_PATTERN_COUNT) % PRINT_PATTERN_COUNT;
