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

// --- Zeitreise: Regler, Alter, „Wer lebte …?“, „In diesem Jahr“ ---------------

/** Jahr auf die Spanne des Reglers begrenzen (ganze Jahre). */
export function clampYear(year: number, min: number, max: number): number {
  if (!Number.isFinite(year)) return min;
  return Math.min(max, Math.max(min, Math.round(year)));
}

/** Zahl der lebenden Personen je Jahr von min bis max (Zeitstrahl über dem Regler), ein Durchgang. */
export function aliveByYear(payload: Pick<MapPayload, "persons">, min: number, max: number): number[] {
  const span = Math.max(0, max - min + 1);
  const delta = new Int32Array(span + 1);
  for (const p of payload.persons) {
    const from = Math.max(p.y0, min);
    const to = Math.min(p.y1, max);
    if (to < from) continue;
    delta[from - min]++;
    delta[to - min + 1]--;
  }
  const out: number[] = [];
  for (let i = 0, run = 0; i < span; i++) out.push((run += delta[i]));
  return out;
}

/** Jahr aus einer Eingabe („1850“, „ 1850 “); null, wenn es keine Jahreszahl ist. */
export function parseYearInput(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d{1,6}$/.test(t)) return null;
  return Number(t);
}

/** Geburtsjahr für Alter und „Geburten“ (ersatzweise Taufjahr); null ohne beides. */
export const birthYearOf = (p: MapPerson): number | null => (p.nb ? null : (p.b ?? p.y0));

export type Age = { years: number; approx: boolean };

/** Alter, das die Person im Jahr erreicht (Jahr − Geburtsjahr); null ohne Geburtsjahr. */
export function ageInYear(p: MapPerson, year: number): Age | null {
  const b = birthYearOf(p);
  if (b === null || year < b) return null;
  return { years: year - b, approx: p.ba === 1 };
}

/** „34 Jahre“, „etwa 34 Jahre“, „1 Jahr“, „unter 1 Jahr“; ohne Alter „Alter unbekannt“. */
export function formatAge(a: Age | null): string {
  if (!a) return "Alter unbekannt";
  if (a.years === 0) return a.approx ? "etwa 0 Jahre" : "unter 1 Jahr";
  const n = `${a.years} ${a.years === 1 ? "Jahr" : "Jahre"}`;
  return a.approx ? `etwa ${n}` : n;
}

/** Eine Person, die im Jahr lebte: Index in payload.persons, Ort wie placeInYear, Alter. */
export type LivedEntry = { i: number; at: number | null; age: Age | null };

/** Alle Personen der Auswahl, die im Jahr lebten — genau die, die die Karte zählt. */
export function livedInYear(payload: Pick<MapPayload, "persons">, year: number): LivedEntry[] {
  const out: LivedEntry[] = [];
  payload.persons.forEach((p, i) => {
    const at = placeInYear(p, year);
    if (at === undefined) return;
    out.push({ i, at, age: ageInYear(p, year) });
  });
  return out;
}

export type LivedSort = "name" | "age" | "place";

/** Bezeichnung des Orts einer Zeile: Ort der Karte, „ohne bekannten Ort“ oder „Ort nicht auf der Karte“. */
export function placeLabelOf(payload: Pick<MapPayload, "places">, at: number | null): string {
  if (at === null) return "ohne bekannten Ort";
  if (at < 0) return "Ort nicht auf der Karte";
  return payload.places[at]?.label ?? "";
}

const byName = (payload: Pick<MapPayload, "persons">) => (a: LivedEntry, b: LivedEntry) =>
  payload.persons[a.i].n.localeCompare(payload.persons[b.i].n, "de") || a.i - b.i;

/** Sortiert nach Name oder Alter (älteste zuerst, ohne Alter am Ende). */
export function sortLived(payload: Pick<MapPayload, "persons">, rows: LivedEntry[], by: Exclude<LivedSort, "place">): LivedEntry[] {
  const name = byName(payload);
  if (by === "name") return [...rows].sort(name);
  return [...rows].sort((a, b) => {
    if (!a.age || !b.age) return (a.age ? -1 : 0) - (b.age ? -1 : 0) || name(a, b);
    return b.age.years - a.age.years || name(a, b);
  });
}

export type LivedGroup = { key: string; label: string; place: number | null; rows: LivedEntry[] };

/**
 * Nach Ort gruppiert: Orte der Karte nach Zahl (absteigend), dann „Ort nicht
 * auf der Karte“ und „ohne bekannten Ort“; je Gruppe nach Name.
 */
export function groupLivedByPlace(payload: Pick<MapPayload, "persons" | "places">, rows: LivedEntry[]): LivedGroup[] {
  const groups = new Map<number | null, LivedEntry[]>();
  for (const r of rows) {
    const k = r.at === null ? null : r.at < 0 ? -1 : r.at;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const name = byName(payload);
  const rank = (k: number | null) => (k === null ? 2 : k < 0 ? 1 : 0);
  return [...groups.entries()]
    .sort(([ka, a], [kb, b]) => rank(ka) - rank(kb) || b.length - a.length || placeLabelOf(payload, ka).localeCompare(placeLabelOf(payload, kb), "de"))
    .map(([k, list]) => ({
      key: String(k),
      label: placeLabelOf(payload, k),
      place: k,
      rows: list.sort(name),
    }));
}

export type YearEvents = {
  /** Geburt (ersatzweise Taufe) in diesem Jahr. */
  births: number[];
  /** Tod (ersatzweise Beerdigung) in diesem Jahr; ein geschätztes Lebensende zählt nicht. */
  deaths: number[];
  /** Hochzeiten: [Index, Index des Partners oder -1]. */
  marriages: [number, number][];
};

/** Geburten, Hochzeiten und Todesfälle eines Jahres (nur Personen der Auswahl). */
export function eventsInYear(payload: Pick<MapPayload, "persons" | "mar">, year: number): YearEvents {
  const births: number[] = [];
  const deaths: number[] = [];
  payload.persons.forEach((p, i) => {
    if (birthYearOf(p) === year) births.push(i);
    if (!p.est && p.y1 === year) deaths.push(i);
  });
  const marriages: [number, number][] = [];
  const mar = payload.mar ?? [];
  for (let k = 0; k < mar.length; k += 3) if (mar[k] === year) marriages.push([mar[k + 1], mar[k + 2]]);
  return { births, deaths, marriages };
}
