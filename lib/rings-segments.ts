/**
 * Flächen der Ansicht „Ringe“, wie sie gezeichnet werden — gleich für beide
 * Richtungen und für Bildschirm (components/AncestorRings.tsx) wie Druck
 * (components/RingsPrintSheet.tsx). Reine Umrechnung der Dienst-Antwort,
 * ohne Datenbank und ohne Rechteprüfung: Was hier ankommt, hat der Dienst
 * schon nach den Rechten des Benutzers gefiltert.
 */

import { lineColorVar, slotAngles, slotLine } from "./ancestor-rings";
import { chartColor } from "./chart-slices";
import type { AncestorRingsDto, RingPersonDto } from "./services/ancestor-rings";
import type { DescendantRingsDto } from "./services/descendant-rings";

export type RingsData = AncestorRingsDto | DescendantRingsDto;

/** Eine Fläche, wie sie gezeichnet wird — gleich für beide Richtungen. */
export type RingSegment = {
  key: string;
  generation: number;
  start: number;
  end: number;
  kind: "person" | "restricted";
  personId: string | null;
  term: string;
  /** Färbung „nach Wurzeln“: Schlüssel des Legendeneintrags. */
  area: string | null;
  /** Nachfahren: Fläche des Elternteils und ob adoptiert. */
  parentKey: string | null;
  adopted: boolean;
  /** Farbe für „nach Linie“ (CSS-Variable, ungemischt; die Stärke kommt aus lineTint). */
  lineColor: string;
  /** Nummer der Linie (Vorfahren: Großeltern-Linie 0–3, Eltern 0/1; Nachfahren: Kind der Mitte). */
  lineIndex: number;
};

/** Schlüssel eines Platzes; die Mitte heißt „root“. */
export const slotKey = (generation: number, index: number) => `${generation}:${index}`;

export const personName = (p: Pick<RingPersonDto, "givenName" | "familyName">) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

/** Vater und Mutter in den Mischfarben ihrer Seite (Großeltern-Linien). */
export const PARENT_COLORS = [
  `color-mix(in srgb, ${lineColorVar("FF")}, ${lineColorVar("FM")})`,
  `color-mix(in srgb, ${lineColorVar("MF")}, ${lineColorVar("MM")})`,
];

const LINE_INDEX = { FF: 0, FM: 1, MF: 2, MM: 3 } as const;

/** Beide Richtungen als dieselben Flächen. */
export function ringSegments(data: RingsData): RingSegment[] {
  if (data.direction === "nachfahren") {
    return data.segments.map((s) => ({
      key: s.key,
      generation: s.generation,
      start: s.start,
      end: s.end,
      kind: s.kind,
      personId: s.kind === "person" ? s.personId : null,
      term: s.term,
      area: s.kind === "person" ? s.area : null,
      parentKey: s.parentKey,
      adopted: s.kind === "person" && s.adopted,
      lineColor: chartColor(s.line),
      lineIndex: s.line,
    }));
  }
  return data.slots.map((s) => {
    const { start, end } = slotAngles(s.generation, s.index);
    const line = slotLine(s.generation, s.index);
    return {
      key: slotKey(s.generation, s.index),
      generation: s.generation,
      start,
      end,
      kind: s.kind,
      personId: s.kind === "person" ? s.personId : null,
      term: s.term,
      area: s.kind === "person" ? s.area : null,
      parentKey: null,
      adopted: false,
      lineColor: line ? lineColorVar(line) : (PARENT_COLORS[s.index] ?? PARENT_COLORS[0]),
      // Eltern: Vater wie VV, Mutter wie MV (Muster im Druck).
      lineIndex: line ? LINE_INDEX[line] : s.index * 2,
    };
  });
}

/**
 * Gezeigte Ringe: bei den Nachfahren nur so viele, wie es Generationen
 * gibt (mindestens drei) — sonst blieben außen leere Ringe stehen.
 */
export function shownRingCount(data: RingsData, minGeneration: number): number {
  return data.direction === "nachfahren"
    ? Math.max(minGeneration, Math.min(data.shownGenerations, data.deepest))
    : data.generations;
}
