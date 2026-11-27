/**
 * „Wurzeln“: aus welchen Ländern bzw. Regionen die Vorfahren einer Person
 * stammen — rechnerisch aus dem Stammbaum (keine DNA). Reine Funktionen
 * ohne Datenbank und ohne Rechteprüfung; Laden und Sichtbarkeit macht
 * lib/services/roots.ts. Fachliche Regeln: docs/komponenten/bibliotheken.md
 * („lib/roots.ts“).
 *
 * Rechnung (Entscheidung des Eigentümers):
 * - Betrachtet wird Generation N (Eltern = 1). Jeder Platz dort zählt 1/2^N.
 * - Jeder Vorfahr gibt seinen Anteil zu gleichen Teilen an seine leiblichen
 *   Eltern weiter (zwei Eltern: je die Hälfte; mehr als zwei — in der App
 *   eigentlich ausgeschlossen — zu gleichen Teilen).
 * - Endet eine Linie vor Generation N, steht der letzte bekannte Vorfahr für
 *   alle Plätze dahinter. Kennt ein Vorfahr nur einen Elternteil, geht die
 *   Hälfte an diesen, die andere bleibt beim Vorfahren selbst.
 * - Fehlt schon der Ausgangsperson ein Elternteil, zählt dessen Hälfte als
 *   „unbekannt“ (ohne Eltern: alles unbekannt).
 * - Ahnenschwund: derselbe Vorfahr über mehrere Linien zählt mehrfach.
 * - Zyklen (fehlerhafte Daten): ein Elternteil, der schon auf dem eigenen
 *   Weg zur Ausgangsperson liegt, gilt als nicht vorhanden.
 * - Ein nicht sichtbarer Vorfahr trägt keinen Ort bei: sein ganzer Anteil
 *   ist „nicht freigegeben“, über ihn hinaus wird nicht weitergerechnet.
 */

export const ROOTS_MIN_GENERATION = 2;
export const ROOTS_MAX_GENERATION = 8;
export const ROOTS_DEFAULT_GENERATION = 4;

/** Kleinere Ortsstücke als dieser Anteil wandern nach „Sonstige“. */
export const ROOTS_MIN_SLICE = 0.02;
/** Höchstens so viele farbige Ortsstücke; der Rest wird „Sonstige“. */
export const ROOTS_MAX_PLACE_SLICES = 8;

export function clampRootsGeneration(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return ROOTS_DEFAULT_GENERATION;
  return Math.min(ROOTS_MAX_GENERATION, Math.max(ROOTS_MIN_GENERATION, Math.round(n)));
}

/** „Eltern“, „Großeltern“, „Urgroßeltern“, „Ururgroßeltern“, ab 5: „3× Urgroßeltern“. */
export function generationName(n: number): string {
  if (n <= 1) return "Eltern";
  if (n === 2) return "Großeltern";
  if (n === 3) return "Urgroßeltern";
  if (n === 4) return "Ururgroßeltern";
  return `${n - 2}× Urgroßeltern`;
}

// ---------------------------------------------------------------------------
// Anteile je Vorfahr
// ---------------------------------------------------------------------------

export type RootsGraph = {
  rootId: string;
  generations: number;
  /** Leibliche Eltern einer Person (beliebige Reihenfolge, ohne Doppelte). */
  parentsOf: (id: string) => readonly string[];
  /** Darf der Benutzer diese Person sehen? */
  visible: (id: string) => boolean;
};

export type RootsContribution =
  | { kind: "person"; personId: string; generation: number; share: number }
  | { kind: "restricted"; generation: number; share: number }
  | { kind: "unknown"; generation: number; share: number };

export type RootsShares = {
  contributions: RootsContribution[];
  /** Plätze in Generation N (2^N). */
  slots: number;
  /** Davon mit einem sichtbaren Vorfahren besetzt (Ahnenschwund mehrfach). */
  filledSlots: number;
  /** Zahl der leiblichen Eltern der Ausgangsperson (auch nicht sichtbare). */
  parentCount: number;
};

/**
 * Verteilt den Anteil 1 der Ausgangsperson auf ihre Vorfahren bis zur
 * Generation N. Tiefensuche je Weg (Ahnenschwund zählt mehrfach); der Weg
 * selbst schützt vor Zyklen. Die Ausgangsperson muss sichtbar sein — das
 * prüft der Dienst.
 */
export function ancestorShares(graph: RootsGraph): RootsShares {
  const n = Math.max(1, Math.floor(graph.generations));
  const contributions: RootsContribution[] = [];
  let filled = 0;
  const uniq = (id: string) => [...new Set(graph.parentsOf(id))].filter((p) => p !== id);
  const rootParents = uniq(graph.rootId);

  const visit = (id: string, generation: number, share: number, path: Set<string>) => {
    if (!graph.visible(id)) {
      contributions.push({ kind: "restricted", generation, share });
      return;
    }
    if (generation >= n) {
      contributions.push({ kind: "person", personId: id, generation, share });
      filled += share;
      return;
    }
    const parents = uniq(id).filter((p) => !path.has(p));
    if (parents.length === 0) {
      contributions.push({ kind: "person", personId: id, generation, share });
      return;
    }
    // Ein bekannter Elternteil: die Hälfte des fehlenden bleibt beim Vorfahren.
    const parts = Math.max(2, parents.length);
    if (parents.length === 1) {
      contributions.push({ kind: "person", personId: id, generation, share: share / 2 });
    }
    path.add(id);
    for (const p of parents) visit(p, generation + 1, share / parts, path);
    path.delete(id);
  };

  const parts = Math.max(2, rootParents.length);
  if (rootParents.length < 2) {
    contributions.push({ kind: "unknown", generation: 1, share: (2 - rootParents.length) / 2 });
  }
  const path = new Set([graph.rootId]);
  for (const p of rootParents) visit(p, 1, 1 / parts, path);

  const slots = 2 ** n;
  return { contributions, slots, filledSlots: Math.round(filled * slots), parentCount: rootParents.length };
}

// ---------------------------------------------------------------------------
// Zusammenfassen zu Stücken
// ---------------------------------------------------------------------------

export type RootsSliceKind = "area" | "other" | "unassigned" | "unknown" | "restricted";

/** Wohin der Anteil eines sichtbaren Vorfahren gehört. */
export type RootsCategory =
  | { kind: "area"; key: string; label: string }
  | { kind: "unassigned" }
  | { kind: "unknown" };

export type RootsSlice = {
  key: string;
  kind: RootsSliceKind;
  label: string;
  /** Anteil 0…1. */
  share: number;
  /** Ganze Prozent; alle Stücke ergeben zusammen 100. */
  percent: number;
  /** CSS-Farbe (Variable aus app/globals.css). */
  color: string;
  /** Bei „Sonstige“: die zusammengefassten Gebiete. */
  members?: string[];
};

export const ROOTS_LABELS = {
  other: "Sonstige",
  unassigned: "Ort nicht zugeordnet",
  unknown: "Unbekannt",
  restricted: "Nicht freigegeben",
} as const;

/** Farben: acht gut unterscheidbare für Gebiete, Grautöne für die übrigen. */
export const ROOTS_COLORS = {
  area: Array.from({ length: ROOTS_MAX_PLACE_SLICES }, (_, i) => `var(--chart-${i + 1})`),
  other: "var(--chart-other)",
  unassigned: "var(--chart-unassigned)",
  unknown: "var(--chart-unknown)",
  restricted: "var(--chart-restricted)",
} as const;

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

/**
 * Stücke des Rings: Gebiete absteigend nach Anteil (gleich: nach Name),
 * dann „Sonstige“, „Ort nicht zugeordnet“, „Unbekannt“, „Nicht freigegeben“.
 * Gebiete unter ROOTS_MIN_SLICE bzw. jenseits von ROOTS_MAX_PLACE_SLICES
 * werden „Sonstige“ — aber nie ein einzelnes Gebiet allein.
 */
export function rootsSlices(
  contributions: readonly RootsContribution[],
  categoryOf: (personId: string) => RootsCategory,
): RootsSlice[] {
  const areas = new Map<string, { label: string; share: number }>();
  const gray = { unassigned: 0, unknown: 0, restricted: 0 };
  for (const c of contributions) {
    if (c.share <= 0) continue;
    if (c.kind !== "person") {
      gray[c.kind] += c.share;
      continue;
    }
    const cat = categoryOf(c.personId);
    if (cat.kind !== "area") {
      gray[cat.kind] += c.share;
      continue;
    }
    const a = areas.get(cat.key);
    if (a) a.share += c.share;
    else areas.set(cat.key, { label: cat.label, share: c.share });
  }

  const sorted = [...areas.entries()]
    .map(([key, a]) => ({ key, ...a }))
    .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label, "de"));
  let keep = sorted.filter((a, i) => a.share >= ROOTS_MIN_SLICE - 1e-12 && i < ROOTS_MAX_PLACE_SLICES);
  // Absteigend sortiert: die behaltenen sind ein Anfangsstück.
  let rest = sorted.slice(keep.length);
  // Ein „Sonstige“ aus nur einem Gebiet verrät nichts Neues — dann lieber beim Namen.
  if (rest.length === 1 && keep.length < ROOTS_MAX_PLACE_SLICES) {
    keep = [...keep, rest[0]];
    rest = [];
  } else if (rest.length === 1) {
    // Kein Platz mehr für eine weitere Farbe: das kleinste behaltene Gebiet kommt mit dazu.
    rest = [keep[keep.length - 1], rest[0]];
    keep = keep.slice(0, -1);
  }

  const slices: Omit<RootsSlice, "percent">[] = keep.map((a, i) => ({
    key: `area:${a.key}`,
    kind: "area",
    label: a.label,
    share: a.share,
    color: ROOTS_COLORS.area[i % ROOTS_COLORS.area.length],
  }));
  if (rest.length) {
    slices.push({
      key: "other",
      kind: "other",
      label: ROOTS_LABELS.other,
      share: rest.reduce((s, a) => s + a.share, 0),
      color: ROOTS_COLORS.other,
      members: rest.map((a) => a.label),
    });
  }
  for (const kind of ["unassigned", "unknown", "restricted"] as const) {
    if (gray[kind] > 1e-12) {
      slices.push({ key: kind, kind, label: ROOTS_LABELS[kind], share: gray[kind], color: ROOTS_COLORS[kind] });
    }
  }
  const percents = roundPercentages(slices.map((s) => s.share));
  return slices.map((s, i) => ({ ...s, percent: percents[i] }));
}
