/**
 * Ein Jahr der Karte: wer lebt, wo — im Browser bei jedem Jahreswechsel
 * gerechnet (ohne Neuladen), ein Durchgang über alle Personen mit binärer
 * Suche in ihren Stationen.
 */
import { LINE_KEYS, type LineKey } from "../reference";
import { LINE_BIT, type MapPayload, type MapPerson } from "./build";

/** Ort einer Person im Jahr: Index in payload.places, -1 Ort ohne Koordinaten, null ohne bekannten Ort; undefined = lebt nicht. */
export function placeInYear(p: MapPerson, year: number): number | null | undefined {
  if (year < p.y0 || year > p.y1) return undefined;
  const st = p.st;
  let lo = 0;
  let hi = st.length / 2 - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (st[mid * 2] <= year) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : st[found * 2 + 1];
}

export type PlaceGroup = {
  place: number;
  /** Indizes in payload.persons */
  persons: number[];
  /** Anteile je Linie für das Tortendiagramm (eine Person in zwei Linien zählt je halb); "none" = keine Linie. */
  weights: Record<LineKey | "none", number>;
  /** Personen je Linie (eine Person in zwei Linien zählt in beiden). */
  perLine: Record<LineKey, number>;
};

export type YearSnapshot = {
  year: number;
  groups: PlaceGroup[];
  alive: number;
  /** Lebend, aber noch ohne Ortsangabe. */
  noPlace: number;
  /** Lebend, Ortstext ohne Koordinaten. */
  unmapped: number;
};

export function snapshot(payload: Pick<MapPayload, "persons">, year: number): YearSnapshot {
  const byPlace = new Map<number, PlaceGroup>();
  let alive = 0;
  let noPlace = 0;
  let unmapped = 0;
  payload.persons.forEach((p, i) => {
    const at = placeInYear(p, year);
    if (at === undefined) return;
    alive++;
    if (at === null) {
      noPlace++;
      return;
    }
    if (at < 0) {
      unmapped++;
      return;
    }
    let g = byPlace.get(at);
    if (!g) {
      g = { place: at, persons: [], weights: { FF: 0, FM: 0, MF: 0, MM: 0, none: 0 }, perLine: { FF: 0, FM: 0, MF: 0, MM: 0 } };
      byPlace.set(at, g);
    }
    g.persons.push(i);
    const lines = LINE_KEYS.filter((k) => (p.ln ?? 0) & LINE_BIT[k]);
    if (lines.length === 0) g.weights.none += 1;
    for (const k of lines) {
      g.weights[k] += 1 / lines.length;
      g.perLine[k] += 1;
    }
  });
  const groups = [...byPlace.values()].sort((a, b) => b.persons.length - a.persons.length || a.place - b.place);
  return { year, groups, alive, noPlace, unmapped };
}
