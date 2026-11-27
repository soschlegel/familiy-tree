/**
 * Zeitgeschichte im Lebenslauf: Welche Ereignisse fielen in die Lebenszeit
 * einer Person? Reine Funktionen — der Dienst (lib/services/history.ts)
 * reicht Geburt, Tod und „verstorben“ aus denselben Daten herein, aus denen
 * der Lebenslauf entsteht (lib/biography-input.ts, isDeceased).
 *
 * Bewusst vorsichtig — die Zeile ist Hintergrund, keine Aussage über die
 * Person, und darf auch zeitlich nichts behaupten, was nicht sicher ist:
 * - Ohne brauchbares Geburtsjahr keine Zeile. Brauchbar heißt: die Angabe
 *   ist nach beiden Seiten begrenzt (nicht „vor 1850“, „nach 1850“, „bis
 *   1850“, kein offener Zeitraum) und umfasst höchstens MAX_SPREAD Jahre.
 *   Es zählt das späteste mögliche Geburtsjahr.
 * - Mit Sterbedatum: dasselbe für den Tod, es zählt das früheste mögliche
 *   Sterbejahr; ist es nicht brauchbar, keine Zeile.
 * - Verstorben ohne Sterbedatum (Sterbeort, Todesursache, Beerdigung …):
 *   keine Zeile — das Ende der Lebenszeit ist unbekannt.
 * - Lebend (kein Hinweis auf den Tod): bis zum laufenden Jahr, aber nur,
 *   solange die Person laut Geburtsjahr nicht über PRESUMED_LIFESPAN Jahre
 *   alt wäre (wie „lebend“ überall in der App); sonst keine Zeile.
 *
 * Regionaler Bezug (Entscheidungen des Eigentümers, lib/history/areas.ts):
 * - Es zählt der Ort zur Zeit des Ereignisses — die Stationen der Person
 *   (Geburt, datierte Ereignisse und Partnerschaften mit Ort, Tod) mit
 *   zugeordnetem Gebiet, siehe `areasAtTime`.
 * - Unpassende Ereignisse werden nach hinten gestellt, nicht ausgeblendet:
 *   Die „wichtigsten“ (`top`) kommen nur aus passenden bzw. „überall“
 *   geltenden Ereignissen (Ort vor Land vor überall, darin nach Rang), der
 *   Rest steht unter „weitere Ereignisse“, unpassende getrennt (`other`).
 *   Bei Treffer „Ort“ nennt `near` die Region (dezenter Bezug).
 * - Ohne einen zugeordneten Ort bleibt die bisherige Reihenfolge (nur Rang).
 */
import { PRESUMED_LIFESPAN } from "../consistency";
import { dateBounds, type FuzzyDate } from "../dates";
import { countryName } from "../places/area";
import { areasAtTime, bestMatch, type AreaMatch, type AreaOfPlace, type TimedArea } from "./areas";
import { byAreaThenRank, byTime, eventsInSpan, lastYear, splitByRank, type HistoryEvent } from "./events";

/** Höchste Unschärfe einer Jahresangabe, die noch als „brauchbar“ gilt. */
export const MAX_SPREAD = 10;
/** So viele Ereignisse nennt die Zeile zunächst; der Rest ist aufklappbar. */
export const LIFETIME_LIMIT = 4;

function yearRange(f: FuzzyDate): { first: number; last: number } | null {
  const b = dateBounds(f, { tolerant: false });
  if (!Number.isFinite(b.start) || !Number.isFinite(b.end)) return null;
  const first = new Date(b.start).getUTCFullYear();
  const last = new Date(b.end - 1).getUTCFullYear();
  if (last - first > MAX_SPREAD) return null;
  return { first, last };
}

export type LifetimeInput = {
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
  /** Gibt es Hinweise auf den Tod (auch ohne Datum)? */
  deceased: boolean;
};

/** Lebenszeit in ganzen Jahren — oder null, wenn sie sich nicht sicher genug angeben lässt. */
export function lifetimeYears(p: LifetimeInput, currentYear: number): { from: number; to: number } | null {
  if (!p.birth) return null;
  const birth = yearRange(p.birth);
  if (!birth) return null;
  const from = birth.last;
  let to: number;
  if (p.death) {
    const death = yearRange(p.death);
    if (!death) return null;
    to = death.first;
  } else if (p.deceased) {
    return null;
  } else {
    if (currentYear - from > PRESUMED_LIFESPAN) return null;
    to = currentYear;
  }
  if (to < from) return null;
  return { from, to };
}

export type LifetimeHistory = {
  from: number;
  to: number;
  /** Lebt die Person (Spanne bis heute)? Nur für die Beschriftung. */
  living: boolean;
  top: HistoryEvent[];
  rest: HistoryEvent[];
  /** Ereignisse, deren Geltungsbereich zu keinem Ort der Person zur Zeit des Ereignisses passt. */
  other: HistoryEvent[];
  /** Nach regionalem Bezug geordnet (die Person hat mindestens einen zugeordneten Ort)? */
  regional: boolean;
};

/** Station eines Lebens für den regionalen Bezug: Datum, Rolle (wie beim Lebensweg) und Gebiet des Orts. */
export type AreaStationInput = {
  date: FuzzyDate | null;
  /** start = Geburt, end = Tod bzw. danach (Beerdigung), middle = alles dazwischen. */
  role: "start" | "middle" | "end";
  /** Gebiet des zugeordneten Orts; null = Ort ohne Zuordnung (zählt nicht). */
  area: AreaOfPlace | null;
};

const ROLE_ORDER = { start: 0, middle: 1, end: 2 } as const;

/** Jahr einer Angabe wie auf der Karte: „zwischen“ mit der Mitte, sonst das Jahr des Beginns. */
function stationYear(f: FuzzyDate): number {
  const y = f.date.getUTCFullYear();
  if (f.qualifier === "BETWEEN" && f.to) return Math.floor((y + f.to.date.getUTCFullYear()) / 2);
  return y;
}

/**
 * Stationen mit zugeordnetem Gebiet, chronologisch: eine Geburt ohne Datum
 * steht vorn, Tod bzw. Beerdigung ohne Datum hinten; andere Stationen ohne
 * Datum zählen nicht (ihre Zeit ist unbekannt).
 */
export function timedAreas(stations: readonly AreaStationInput[]): TimedArea[] {
  const out: (TimedArea & { role: number; i: number })[] = [];
  stations.forEach((s, i) => {
    if (!s.area) return;
    let year: number;
    if (s.date) year = stationYear(s.date);
    else if (s.role === "start") year = -Infinity;
    else if (s.role === "end") year = Infinity;
    else return;
    out.push({ year, area: s.area, role: ROLE_ORDER[s.role], i });
  });
  return out
    .sort((a, b) => (a.year === b.year ? 0 : a.year < b.year ? -1 : 1) || a.role - b.role || a.i - b.i)
    .map(({ year, area }) => ({ year, area }));
}

/**
 * Kurzer Bezug für die Anzeige — nur bei Treffer „Ort“: die Region
 * („Sachsen“). Beim Treffer „Land“ stünde fast überall „Deutschland“; das
 * sagt nichts und bleibt weg.
 */
function nearLabel(match: AreaMatch, at: AreaOfPlace | null): string | undefined {
  if (!at || match !== "place") return undefined;
  return at.regionName || countryName(at.country);
}

/**
 * Ereignisse der Lebenszeit: die wichtigsten zuerst (nach der Zeit sortiert),
 * der Rest getrennt. Mit `stations` (Orte der Person, siehe `timedAreas`)
 * nach regionalem Bezug geordnet — siehe Kopfkommentar.
 */
export function lifetimeHistory(
  events: readonly HistoryEvent[],
  p: LifetimeInput,
  currentYear: number,
  limit = LIFETIME_LIMIT,
  stations: readonly TimedArea[] = [],
): LifetimeHistory | null {
  const span = lifetimeYears(p, currentYear);
  if (!span) return null;
  const inside = eventsInSpan(events, span.from, span.to);
  if (inside.length === 0) return null;
  const living = !p.death && !p.deceased;
  if (stations.length === 0) {
    const { top, rest } = splitByRank(inside, limit);
    return { ...span, living, top, rest, other: [], regional: false };
  }
  const matches = new Map<HistoryEvent, AreaMatch>();
  const fitting: HistoryEvent[] = [];
  const other: HistoryEvent[] = [];
  for (const e of inside) {
    const { match, at } = bestMatch(e.areas, areasAtTime(stations, e.from, lastYear(e)));
    const near = nearLabel(match, at);
    const shown = near ? { ...e, near } : e;
    matches.set(shown, match);
    if (match === "foreign") other.push(shown);
    else fitting.push(shown);
  }
  const ranked = fitting.sort(byAreaThenRank((e) => matches.get(e)!));
  const n = Math.max(0, limit);
  return {
    ...span,
    living,
    top: ranked.slice(0, n).sort(byTime),
    rest: ranked.slice(n).sort(byTime),
    other: other.sort(byTime),
    regional: true,
  };
}
