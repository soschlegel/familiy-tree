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

import {
  CHART_MAX_AREA_SLICES,
  CHART_MIN_SLICE,
  groupAreaSlices,
  roundPercentages,
  SLICE_COLORS,
  SLICE_LABELS,
  type AreaSliceKind,
} from "./chart-slices";

export const ROOTS_MIN_GENERATION = 2;
export const ROOTS_MAX_GENERATION = 8;
export const ROOTS_DEFAULT_GENERATION = 4;

/** Kleinere Ortsstücke als dieser Anteil wandern nach „Sonstige“ (lib/chart-slices.ts). */
export const ROOTS_MIN_SLICE = CHART_MIN_SLICE;
/** Höchstens so viele farbige Ortsstücke; der Rest wird „Sonstige“. */
export const ROOTS_MAX_PLACE_SLICES = CHART_MAX_AREA_SLICES;

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

export type RootsSliceKind = AreaSliceKind;

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

export const ROOTS_LABELS = SLICE_LABELS;

/** Farben: acht gut unterscheidbare für Gebiete, Grautöne für die übrigen. */
export const ROOTS_COLORS = SLICE_COLORS;

/** Ganze Prozent, Summe genau 100 (lib/chart-slices.ts). */
export { roundPercentages };

/**
 * Stücke des Rings: Gebiete absteigend nach Anteil (gleich: nach Name),
 * dann „Sonstige“, „Ort nicht zugeordnet“, „Unbekannt“, „Nicht freigegeben“.
 * Gebiete unter ROOTS_MIN_SLICE bzw. jenseits von ROOTS_MAX_PLACE_SLICES
 * werden „Sonstige“ — aber nie ein einzelnes Gebiet allein. Das Zusammenfassen
 * selbst teilt sich der Abschnitt mit der Seite „Statistik“
 * (groupAreaSlices in lib/chart-slices.ts); das Ganze ist hier 1.
 */
export function rootsSlices(
  contributions: readonly RootsContribution[],
  categoryOf: (personId: string) => RootsCategory,
): RootsSlice[] {
  const areas = new Map<string, { label: string; value: number }>();
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
    if (a) a.value += c.share;
    else areas.set(cat.key, { label: cat.label, value: c.share });
  }
  // Ohne den Zählwert — die Antwort bleibt wie zuvor (nur Anteile).
  return groupAreaSlices(areas, gray, { total: 1 }).map(({ value: _value, ...slice }) => slice);
}
