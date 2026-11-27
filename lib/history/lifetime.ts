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
 */
import { PRESUMED_LIFESPAN } from "../consistency";
import { dateBounds, type FuzzyDate } from "../dates";
import { eventsInSpan, splitByRank, type HistoryEvent } from "./events";

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
};

/** Ereignisse der Lebenszeit: die wichtigsten zuerst (nach der Zeit sortiert), der Rest getrennt. */
export function lifetimeHistory(
  events: readonly HistoryEvent[],
  p: LifetimeInput,
  currentYear: number,
  limit = LIFETIME_LIMIT,
): LifetimeHistory | null {
  const span = lifetimeYears(p, currentYear);
  if (!span) return null;
  const inside = eventsInSpan(events, span.from, span.to);
  if (inside.length === 0) return null;
  const { top, rest } = splitByRank(inside, limit);
  return { ...span, living: !p.death && !p.deceased, top, rest };
}
