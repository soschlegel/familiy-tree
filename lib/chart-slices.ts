/**
 * Stücke eines Rings nach Gebieten (Land bzw. Region) — gemeinsam für den
 * Abschnitt „Wurzeln“ (lib/roots.ts) und die Seite „Statistik“
 * (lib/statistics.ts). Reine Funktionen ohne Datenbank.
 *
 * Regeln:
 * - Gebiete absteigend nach Wert (gleich: nach Name), dann „Sonstige“, „Ort
 *   nicht zugeordnet“, „Unbekannt“, „Nicht freigegeben“.
 * - Gebiete unter CHART_MIN_SLICE (Anteil am Ganzen) bzw. jenseits von
 *   CHART_MAX_AREA_SLICES werden „Sonstige“ — aber nie ein einzelnes Gebiet
 *   allein (dann lieber beim Namen).
 * - Ganze Prozent nach dem Verfahren der größten Reste, Summe genau 100.
 * - Farben: acht gut unterscheidbare (`--chart-1..8`), Grautöne für die
 *   übrigen Stücke (app/globals.css, hell und dunkel).
 */

/** Kleinere Gebietsstücke als dieser Anteil wandern nach „Sonstige“. */
export const CHART_MIN_SLICE = 0.02;
/** Höchstens so viele farbige Gebietsstücke; der Rest wird „Sonstige“. */
export const CHART_MAX_AREA_SLICES = 8;

export type GraySliceKind = "unassigned" | "unknown" | "restricted";
export type AreaSliceKind = "area" | "other" | GraySliceKind;

export const SLICE_LABELS = {
  other: "Sonstige",
  unassigned: "Ort nicht zugeordnet",
  unknown: "Unbekannt",
  restricted: "Nicht freigegeben",
} as const;

/** Farben aus app/globals.css (je eine Fassung für hell und dunkel). */
export const SLICE_COLORS = {
  area: Array.from({ length: CHART_MAX_AREA_SLICES }, (_, i) => `var(--chart-${i + 1})`),
  other: "var(--chart-other)",
  unassigned: "var(--chart-unassigned)",
  unknown: "var(--chart-unknown)",
  restricted: "var(--chart-restricted)",
} as const;

/** Farbe Nummer `i` (ab 0) der acht Diagrammfarben, danach wieder von vorn. */
export const chartColor = (i: number) => SLICE_COLORS.area[i % SLICE_COLORS.area.length];

/**
 * Ganze Prozent nach dem Verfahren der größten Reste: jede Zahl ist ab- oder
 * aufgerundet, die Summe ist genau 100 (bei Summe 0: alles 0).
 */
export function roundPercentages(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

export type AreaSlice = {
  key: string;
  kind: AreaSliceKind;
  label: string;
  /** Summe der Werte dieses Stücks (Anteil bei „Wurzeln“, Personen bei „Statistik“). */
  value: number;
  /** Anteil 0…1 am Ganzen. */
  share: number;
  /** Ganze Prozent; alle Stücke ergeben zusammen 100. */
  percent: number;
  /** CSS-Farbe (Variable aus app/globals.css). */
  color: string;
  /** Bei „Sonstige“: die zusammengefassten Gebiete. */
  members?: string[];
};

/**
 * Fasst Gebietswerte und graue Restwerte zu Ringstücken zusammen (Regeln
 * oben). `total` ist das Ganze, auf das sich die Anteile beziehen (Standard:
 * Summe aller Werte; „Wurzeln“ rechnet mit 1).
 */
export function groupAreaSlices(
  areas: ReadonlyMap<string, { label: string; value: number }>,
  gray: Partial<Record<GraySliceKind, number>>,
  opts: { total?: number } = {},
): AreaSlice[] {
  const grayValues = (["unassigned", "unknown", "restricted"] as const).map((k) => Math.max(0, gray[k] ?? 0));
  const sum =
    [...areas.values()].reduce((s, a) => s + Math.max(0, a.value), 0) + grayValues.reduce((s, v) => s + v, 0);
  const total = opts.total ?? sum;
  const shareOf = (v: number) => (total > 0 ? v / total : 0);

  const sorted = [...areas.entries()]
    .filter(([, a]) => a.value > 0)
    .map(([key, a]) => ({ key, ...a }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "de"));
  let keep = sorted.filter((a, i) => shareOf(a.value) >= CHART_MIN_SLICE - 1e-12 && i < CHART_MAX_AREA_SLICES);
  // Absteigend sortiert: die behaltenen sind ein Anfangsstück.
  let rest = sorted.slice(keep.length);
  // Ein „Sonstige“ aus nur einem Gebiet verrät nichts Neues — dann lieber beim Namen.
  if (rest.length === 1 && keep.length < CHART_MAX_AREA_SLICES) {
    keep = [...keep, rest[0]];
    rest = [];
  } else if (rest.length === 1) {
    // Kein Platz mehr für eine weitere Farbe: das kleinste behaltene Gebiet kommt mit dazu.
    rest = [keep[keep.length - 1], rest[0]];
    keep = keep.slice(0, -1);
  }

  const slices: Omit<AreaSlice, "percent">[] = keep.map((a, i) => ({
    key: `area:${a.key}`,
    kind: "area",
    label: a.label,
    value: a.value,
    share: shareOf(a.value),
    color: chartColor(i),
  }));
  if (rest.length) {
    const value = rest.reduce((s, a) => s + a.value, 0);
    slices.push({
      key: "other",
      kind: "other",
      label: SLICE_LABELS.other,
      value,
      share: shareOf(value),
      color: SLICE_COLORS.other,
      members: rest.map((a) => a.label),
    });
  }
  (["unassigned", "unknown", "restricted"] as const).forEach((kind, i) => {
    const value = grayValues[i];
    if (value > 1e-12) {
      slices.push({ key: kind, kind, label: SLICE_LABELS[kind], value, share: shareOf(value), color: SLICE_COLORS[kind] });
    }
  });
  const percents = roundPercentages(slices.map((s) => s.value));
  return slices.map((s, i) => ({ ...s, percent: percents[i] }));
}
