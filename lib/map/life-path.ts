/**
 * „Lebensweg“ auf der Karte (docs/fachlich/karte-und-orte.md): reine Logik,
 * aus der die Seite /map?mode=lebensweg einen Weg mit nummerierten Punkten
 * zeichnet — für die Stationen eines Lebens (Geburt, Taufe, Wohnorte …) oder
 * für die Geburtsorte einer Vater- bzw. Mutterlinie.
 *
 * Regeln:
 *
 * - Reihenfolge: Stationen mit Rolle „start“ (Geburt) stehen vorn, mit Rolle
 *   „end“ (Tod, danach Beerdigung/Einäscherung/Testamentseröffnung) hinten —
 *   auch ohne Datum. Dazwischen die übrigen Stationen nach dem Anker ihres
 *   Datums (wie lib/dates.ts sortiert: „um 1850“, „vor 1850“ und „1850“ am
 *   1.1.1850, Bereiche mit ihrem Beginn); bei gleichem Anker die genauere
 *   Angabe zuerst, dann die gegebene Reihenfolge. Mittlere Stationen ohne
 *   Datum gehören nicht zur Linie, sie stehen in der Liste „ohne Datum“.
 *   Bei Linien („fixed“) bleibt die gegebene Reihenfolge (Generationen).
 * - Nummern: jede Station der Linie bekommt eine Nummer 1…n, auch ohne Ort
 *   auf der Karte; Liste und Karte teilen sich die Nummern.
 * - Karte: nur Stationen mit Ortszuordnung samt Koordinaten. Aufeinander
 *   folgende Stationen auf der Karte am selben Ort (gleiche Koordinaten)
 *   werden ein Punkt. Liegt zwischen zwei Punkten eine Station ohne Ort auf
 *   der Karte, ist das Teilstück „übersprungen“ (gestrichelt gezeichnet).
 */
import type { FuzzyDate } from "../dates";
import { formatFuzzyDate, formatFuzzyYear } from "../dates";
import { placeKey } from "../places/normalize";

export type PathPlace = {
  label: string;
  lat: number;
  lon: number;
  precision: "PLACE" | "REGION" | "COUNTRY";
};

/** Ortszuordnung eines Texts: Koordinaten, „nicht zuordenbar“ oder keine. */
export type PlaceLookup = (key: string) => PathPlace | "unresolvable" | null;

export type StationInput = {
  /** Stabile Kennung (für Schlüssel in der Oberfläche). */
  key: string;
  role: "start" | "middle" | "end";
  /** Reihenfolge innerhalb von „end“: 0 Tod, 1 danach (Beerdigung …). */
  endRank?: number;
  date: FuzzyDate | null;
  /** Ortstext wie eingegeben; null: kein Ort. */
  place: string | null;
  /** Überschrift der Station: „Geburt“, „Heirat mit …“, bei Linien der Name. */
  title: string;
  /** Zusatz: Beruf, Wohnadresse, „Taufort“ … */
  detail?: string | null;
  /** Bei Linien: verlinkte Person. */
  personId?: string;
  /** Datumstext statt des formatierten Datums (z.B. „getauft um 1850“). */
  dateLabel?: string;
};

export type PlaceStatus = "map" | "unassigned" | "unresolvable" | "none";

export type PathStation = {
  key: string;
  /** Nummer auf der Linie; null bei Stationen „ohne Datum“. */
  n: number | null;
  title: string;
  detail: string | null;
  personId: string | null;
  /** Ausführlich: „12.03.1850“, „um 1850“, „zwischen 1850 und 1855“; leer ohne Datum. */
  dateText: string;
  /** Kurz für die Karte: „1850“, „um 1850“, „zw. 1850 u. 1855“. */
  yearText: string;
  placeText: string | null;
  placeStatus: PlaceStatus;
  /** Index des Punkts auf der Karte; null ohne Ort auf der Karte. */
  point: number | null;
};

export type PathPoint = PathPlace & {
  /** Indizes der Stationen (in `stations`), die dieser Punkt zusammenfasst. */
  stations: number[];
};

export type PathSegment = {
  from: number;
  to: number;
  /** Dazwischen liegt mindestens eine Station ohne Ort auf der Karte. */
  skipped: boolean;
};

export type LifePath = {
  /** Erst die Linie (nummeriert), danach die Stationen ohne Datum. */
  stations: PathStation[];
  points: PathPoint[];
  segments: PathSegment[];
};

const PRECISION_RANK = { DAY: 0, MONTH: 1, YEAR: 2 } as const;

/** Stationen ordnen: Linie (Geburt, datierte, Tod/Beerdigung) und „ohne Datum“. */
export function orderStations(
  inputs: StationInput[],
  opts: { fixed?: boolean } = {},
): { line: StationInput[]; undated: StationInput[] } {
  if (opts.fixed) return { line: [...inputs], undated: [] };
  const indexed = inputs.map((s, i) => ({ s, i }));
  const byDate = (a: { s: StationInput; i: number }, b: { s: StationInput; i: number }) => {
    const da = a.s.date;
    const db = b.s.date;
    if (da && db) {
      const diff = da.date.getTime() - db.date.getTime();
      if (diff !== 0) return diff;
      const pa = PRECISION_RANK[da.precision] + (da.qualifier === "EXACT" ? 0 : 3);
      const pb = PRECISION_RANK[db.precision] + (db.qualifier === "EXACT" ? 0 : 3);
      if (pa !== pb) return pa - pb;
    } else if (da || db) {
      // Ohne Datum hinter die datierten derselben Gruppe (nur bei start/end).
      return da ? -1 : 1;
    }
    return a.i - b.i;
  };
  const start = indexed.filter((x) => x.s.role === "start").sort(byDate);
  const middle = indexed.filter((x) => x.s.role === "middle");
  const dated = middle.filter((x) => x.s.date).sort(byDate);
  const undated = middle.filter((x) => !x.s.date);
  const end = indexed
    .filter((x) => x.s.role === "end")
    .sort((a, b) => (a.s.endRank ?? 0) - (b.s.endRank ?? 0) || byDate(a, b));
  return {
    line: [...start, ...dated, ...end].map((x) => x.s),
    undated: undated.map((x) => x.s),
  };
}

const sameSpot = (a: PathPlace, b: PathPlace) =>
  Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

/** Weg bauen: Nummern, Ortszuordnung, Punkte (zusammengefasst) und Teilstücke. */
export function buildLifePath(
  inputs: StationInput[],
  lookup: PlaceLookup,
  opts: { fixed?: boolean } = {},
): LifePath {
  const { line, undated } = orderStations(inputs, opts);
  const stations: PathStation[] = [];
  const points: PathPoint[] = [];
  const segments: PathSegment[] = [];
  let skippedSinceLast = false;

  const resolve = (text: string | null): { status: PlaceStatus; place: PathPlace | null } => {
    if (!text?.trim()) return { status: "none", place: null };
    const hit = lookup(placeKey(text));
    if (hit === "unresolvable") return { status: "unresolvable", place: null };
    if (!hit) return { status: "unassigned", place: null };
    return { status: "map", place: hit };
  };
  const base = (s: StationInput, n: number | null, status: PlaceStatus): PathStation => ({
    key: s.key,
    n,
    title: s.title,
    detail: s.detail?.trim() || null,
    personId: s.personId ?? null,
    dateText: s.dateLabel ?? (s.date ? formatFuzzyDate(s.date) : ""),
    yearText: s.date ? formatFuzzyYear(s.date) : "",
    placeText: s.place?.trim() || null,
    placeStatus: status,
    point: null,
  });

  line.forEach((s, i) => {
    const { status, place } = resolve(s.place);
    const station = base(s, i + 1, status);
    const idx = stations.push(station) - 1;
    if (!place) {
      skippedSinceLast = true;
      return;
    }
    const last = points[points.length - 1];
    if (last && sameSpot(last, place)) {
      // Gleicher Ort wie der vorige Punkt (auch wenn dazwischen Stationen
      // ohne Ort auf der Karte liegen): derselbe Punkt.
      last.stations.push(idx);
      station.point = points.length - 1;
      skippedSinceLast = false;
      return;
    }
    points.push({ ...place, stations: [idx] });
    station.point = points.length - 1;
    if (points.length > 1) segments.push({ from: points.length - 2, to: points.length - 1, skipped: skippedSinceLast });
    skippedSinceLast = false;
  });

  for (const s of undated) stations.push(base(s, null, resolve(s.place).status));
  return { stations, points, segments };
}

/** Nummern eines Punkts kurz: „3“, „1–3“, „2, 4“. */
export function pointNumbers(path: LifePath, point: number): string {
  const ns = path.points[point].stations.map((i) => path.stations[i].n).filter((n): n is number => n !== null);
  if (ns.length === 0) return "";
  if (ns.length === 1) return String(ns[0]);
  const contiguous = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
  return contiguous ? `${ns[0]}–${ns[ns.length - 1]}` : ns.join(", ");
}

// ---------------------------------------------------------------------------
// Linie hinauf
// ---------------------------------------------------------------------------

export type LineKind = "father" | "mother";

/** Elternteil einer Person, wie der Dienst ihn kennt. */
export type LineParent = { id: string; visible: boolean; gender: string };

export type LineEnd = "none" | "restricted" | "ambiguous" | "limit";

/** Höchstzahl der Generationen über der Person. */
export const LINE_MAX_GENERATIONS = 12;

/**
 * Nächster Vorfahr der Linie: unter den leiblichen Eltern der sichtbare mit
 * dem Geschlecht der Linie (Vater MALE, Mutter FEMALE).
 *
 * - genau einer → weiter mit ihm (auch wenn ein weiterer Elternteil nicht
 *   sichtbar ist);
 * - mehrere → „ambiguous“ (Datenfehler, die Linie endet);
 * - keiner, aber ein nicht sichtbarer Elternteil → „restricted“ (er könnte
 *   der gesuchte sein; sein Geschlecht wird nicht gelesen);
 * - keiner, aber ein sichtbarer mit anderem/unbekanntem Geschlecht außer dem
 *   anderen Elternteil → „ambiguous“ (Geschlecht nicht eindeutig);
 * - sonst → „none“ (kein Vater bzw. keine Mutter erfasst).
 */
export function nextInLine(parents: LineParent[], kind: LineKind): { next: string } | { end: Exclude<LineEnd, "limit"> } {
  const want = kind === "father" ? "MALE" : "FEMALE";
  const other = kind === "father" ? "FEMALE" : "MALE";
  const visible = parents.filter((p) => p.visible);
  const match = visible.filter((p) => p.gender === want);
  if (match.length === 1) return { next: match[0].id };
  if (match.length > 1) return { end: "ambiguous" };
  if (parents.some((p) => !p.visible)) return { end: "restricted" };
  if (visible.some((p) => p.gender !== other)) return { end: "ambiguous" };
  return { end: "none" };
}

export type LineWalk = { ids: string[]; end: LineEnd };

/**
 * Vater- und Mutterlinie zugleich hinauf ablaufen: von der Person
 * (Generation 0) über `nextInLine`, bis die Linie endet oder `max`
 * Generationen erreicht sind. Je Generation EIN Aufruf von `loadParents`
 * für die (höchstens zwei) aktuellen Personen beider Linien. Zyklen in
 * fehlerhaften Daten beenden die Linie („ambiguous“). Endet eine Linie bei
 * der Grenze, wird noch eine Generation gefragt, damit „keine Eltern
 * erfasst“ und „Grenze erreicht“ zu unterscheiden sind.
 */
export async function walkLines(
  rootId: string,
  loadParents: (ids: string[]) => Promise<Map<string, LineParent[]>>,
  kinds: LineKind[],
  max: number = LINE_MAX_GENERATIONS,
): Promise<Record<LineKind, LineWalk | null>> {
  const state = new Map<LineKind, { ids: string[]; end: LineEnd | null }>(kinds.map((k) => [k, { ids: [rootId], end: null }]));
  for (let g = 1; g <= max + 1; g++) {
    const open = [...state.values()].filter((s) => s.end === null);
    if (open.length === 0) break;
    const current = [...new Set(open.map((s) => s.ids[s.ids.length - 1]))];
    const parents = await loadParents(current);
    for (const [kind, s] of state) {
      if (s.end !== null) continue;
      const step = nextInLine(parents.get(s.ids[s.ids.length - 1]) ?? [], kind);
      if ("end" in step) s.end = step.end;
      else if (g > max) s.end = "limit";
      else if (s.ids.includes(step.next)) s.end = "ambiguous";
      else s.ids.push(step.next);
    }
  }
  const out: Record<LineKind, LineWalk | null> = { father: null, mother: null };
  for (const [kind, s] of state) out[kind] = { ids: s.ids, end: s.end ?? "limit" };
  return out;
}
