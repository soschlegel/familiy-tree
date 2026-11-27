/**
 * Ansicht „Ringe“ der Stammbaum-Seite: die Vorfahren einer Person als
 * Vollkreis von innen nach außen (Ahnenfächer). Reine Funktionen ohne
 * Datenbank und ohne Rechteprüfung — Laden und Sichtbarkeit macht
 * lib/services/ancestor-rings.ts, gezeichnet wird in
 * components/AncestorRings.tsx. Fachliche Regeln:
 * docs/komponenten/bibliotheken.md („lib/ancestor-rings.ts“).
 *
 * Plätze (Entscheidung des Eigentümers):
 * - Generation g (Eltern = 1) hat 2^g Plätze, nummeriert 0 … 2^g − 1. Die
 *   Eltern des Platzes (g, i) stehen auf (g+1, 2i) und (g+1, 2i+1): Der Bogen
 *   eines Kindes wird in zwei gleiche Hälften geteilt.
 * - Seitenregel, überall gleich: im Uhrzeigersinn zuerst der Vater
 *   (Platz 2i), dann die Mutter (2i+1). Der Kreis beginnt links (9 Uhr);
 *   damit liegt die Vaterseite oben, die Mutterseite unten.
 * - Bei unbekanntem oder gleichem Geschlecht entscheidet eine stabile
 *   Reihenfolge (die der Eingabe). Ein einzelner Elternteil steht auf dem
 *   Mutterplatz, wenn er weiblich ist, sonst auf dem Vaterplatz.
 * - Ein fehlender Elternteil lässt seinen Platz leer; Plätze verschieben
 *   sich nie. Mehr als zwei leibliche Eltern (in der App ausgeschlossen):
 *   nur die ersten zwei nach der Seitenregel.
 * - Ahnenschwund: derselbe Vorfahr steht auf jedem seiner Plätze.
 * - Zyklen (fehlerhafte Daten): ein Elternteil, der schon auf dem eigenen
 *   Weg zur Ausgangsperson liegt, gilt als fehlend — sein Platz bleibt leer.
 * - Ein nicht sichtbarer Vorfahr belegt seinen Platz als „nicht
 *   freigegeben“ (ohne Kennung); über ihn hinaus gibt es keine Plätze.
 */

import { DESCENDANT_RINGS_DEFAULT_GENERATION } from "./descendant-rings";
import { bloodRelationTerm, type Sex, type Side } from "./kinship";
import type { LineKey } from "./reference";

export const RINGS_MIN_GENERATION = 3;
export const RINGS_MAX_GENERATION = 7;
export const RINGS_DEFAULT_GENERATION = 5;

/** Adressparameter der Ansicht (`/tree?view=rings&generationen=6&farbe=wurzeln`). */
export const RINGS_GENERATION_PARAM = "generationen";
export const RINGS_COLORING_PARAM = "farbe";

export type RingsColoring = "linie" | "wurzeln";
export const RINGS_DEFAULT_COLORING: RingsColoring = "linie";

/**
 * Richtung der Ringe (`?richtung=nachfahren`): Vorfahren (Standard) oder
 * Nachfahren (lib/descendant-rings.ts).
 */
export const RINGS_DIRECTION_PARAM = "richtung";
export type RingsDirection = "vorfahren" | "nachfahren";
export const RINGS_DEFAULT_DIRECTION: RingsDirection = "vorfahren";

/** Richtung aus der Adresse: „nachfahren“, sonst „vorfahren“. */
export function parseRingsDirection(value: unknown): RingsDirection {
  return value === "nachfahren" ? "nachfahren" : "vorfahren";
}

/** Standardtiefe je Richtung: Vorfahren 5, Nachfahren 4. */
export function ringsDefaultGeneration(direction: RingsDirection): number {
  return direction === "nachfahren" ? DESCENDANT_RINGS_DEFAULT_GENERATION : RINGS_DEFAULT_GENERATION;
}

/** Tiefe aus der Adresse: ganze Zahl 3…7, sonst der Standard (5 bzw. `fallback`). */
export function parseRingsGeneration(value: unknown, fallback: number = RINGS_DEFAULT_GENERATION): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(RINGS_MAX_GENERATION, Math.max(RINGS_MIN_GENERATION, Math.round(n)));
}

/** Färbung aus der Adresse: „wurzeln“, sonst „linie“. */
export function parseRingsColoring(value: unknown): RingsColoring {
  return value === "wurzeln" ? "wurzeln" : "linie";
}

/** Zahl aller Plätze von Generation 1 bis n: 2 + 4 + … + 2^n. */
export const ringSlotCount = (generations: number) => 2 ** (generations + 1) - 2;

// ---------------------------------------------------------------------------
// Platzvergabe
// ---------------------------------------------------------------------------

export type RingParent = { id: string; gender: Sex };

export type RingsGraph = {
  rootId: string;
  generations: number;
  /** Leibliche Eltern einer sichtbaren Person, in stabiler Reihenfolge. */
  parentsOf: (id: string) => readonly RingParent[];
  /** Darf der Benutzer diese Person sehen? */
  visible: (id: string) => boolean;
};

export type RingSlot =
  | { generation: number; index: number; kind: "person"; personId: string }
  | { generation: number; index: number; kind: "restricted" };

const SEX_RANK: Record<Sex, number> = { MALE: 0, OTHER: 1, UNKNOWN: 1, FEMALE: 2 };

/**
 * Vater- und Mutterplatz für die Eltern einer Person (Seitenregel oben).
 * Doppelte Einträge zählen einmal.
 */
export function orderParents(parents: readonly RingParent[]): [RingParent | null, RingParent | null] {
  const seen = new Set<string>();
  const unique = parents.filter((p) => !seen.has(p.id) && Boolean(seen.add(p.id)));
  // Array.prototype.sort ist stabil: bei gleichem Rang bleibt die Eingabereihenfolge.
  const sorted = [...unique].sort((a, b) => SEX_RANK[a.gender] - SEX_RANK[b.gender]);
  if (sorted.length === 0) return [null, null];
  if (sorted.length === 1) return sorted[0].gender === "FEMALE" ? [null, sorted[0]] : [sorted[0], null];
  return [sorted[0], sorted[1]];
}

/**
 * Belegte Plätze bis zur Generation `generations`, nach Generation und Platz
 * sortiert (innen nach außen, im Uhrzeigersinn). Leere Plätze fehlen.
 */
export function assignRingSlots(graph: RingsGraph): RingSlot[] {
  const n = Math.max(1, Math.floor(graph.generations));
  const out: RingSlot[] = [];
  const visit = (id: string, generation: number, index: number, path: Set<string>) => {
    if (generation >= n) return;
    const [father, mother] = orderParents(graph.parentsOf(id));
    path.add(id);
    ([father, mother] as const).forEach((p, side) => {
      // Zyklus: wer schon auf dem eigenen Weg liegt, gilt als fehlend.
      if (!p || path.has(p.id)) return;
      const slot = { generation: generation + 1, index: index * 2 + side };
      if (!graph.visible(p.id)) {
        out.push({ ...slot, kind: "restricted" });
        return;
      }
      out.push({ ...slot, kind: "person", personId: p.id });
      visit(p.id, slot.generation, slot.index, path);
    });
    path.delete(id);
  };
  visit(graph.rootId, 0, 0, new Set());
  return out.sort((a, b) => a.generation - b.generation || a.index - b.index);
}

/** Platz des Kindes, zu dem der Platz (g, i) gehört (g ≥ 2). */
export const childSlot = (generation: number, index: number) => ({ generation: generation - 1, index: index >> 1 });

/** Väterliche bzw. mütterliche Hälfte: über welchen Elternplatz der Platz läuft. */
export function slotSide(generation: number, index: number): Exclude<Side, null> {
  return index >> (generation - 1) === 0 ? "paternal" : "maternal";
}

/** Großeltern-Linie eines Platzes ab Generation 2 (VV, VM, MV, MM); Eltern: null. */
export function slotLine(generation: number, index: number): LineKey | null {
  if (generation < 2) return null;
  return (["FF", "FM", "MF", "MM"] as const)[index >> (generation - 2)];
}

/**
 * Verwandtschaftsstufe eines Platzes aus Sicht der Ausgangsperson:
 * „Mutter“, „Urgroßvater väterlicherseits“, „Ururgroßelternteil“ …
 * (bloodRelationTerm aus lib/kinship.ts). Die Seite nur, wenn der
 * Elternplatz der Ausgangsperson nachweislich Vater bzw. Mutter ist —
 * sonst (unbekanntes Geschlecht, nicht freigegeben) bliebe sie geraten.
 */
export function ringRelationTerm(generation: number, sex: Sex, side: Side = null): string {
  return bloodRelationTerm({ up: generation, down: 0, sex, side: generation >= 2 ? side : null });
}

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

/** Kantenlänge der Zeichenfläche (viewBox), Mittelpunkt in der Mitte. */
export const RINGS_VIEWBOX = 1000;
const CENTER = RINGS_VIEWBOX / 2;
/** Rand um den äußersten Ring (Fokusrahmen, Strich). */
const OUTER_RADIUS = CENTER - 8;

export type Ring = { generation: number; inner: number; outer: number };
export type RingGeometry = { center: number; centerRadius: number; rings: Ring[] };

/**
 * Relative Ringbreiten: innen gleich breit für Name und Jahre, die mittleren
 * etwas breiter (dort wird es eng im Bogen), die äußersten schmaler — aber
 * nie so schmal, dass sie nicht mehr zu treffen sind.
 */
function ringWeight(generation: number): number {
  if (generation <= 2) return 1;
  if (generation === 3) return 1.05;
  if (generation === 4) return 1.1;
  if (generation === 5) return 1;
  return 0.78;
}
const CENTER_WEIGHT = 1.1;

export function ringGeometry(generations: number): RingGeometry {
  const n = Math.max(1, Math.floor(generations));
  const weights = Array.from({ length: n }, (_, i) => ringWeight(i + 1));
  const unit = OUTER_RADIUS / (CENTER_WEIGHT + weights.reduce((a, b) => a + b, 0));
  let r = CENTER_WEIGHT * unit;
  const rings = weights.map((w, i) => {
    const ring = { generation: i + 1, inner: r, outer: r + w * unit };
    r = ring.outer;
    return ring;
  });
  return { center: CENTER, centerRadius: CENTER_WEIGHT * unit, rings };
}

/**
 * Winkel eines Platzes in Grad, SVG-Koordinaten (0° = rechts, im
 * Uhrzeigersinn, weil y nach unten wächst). Beginn links bei 180°.
 */
export function slotAngles(generation: number, index: number): { start: number; end: number; mid: number } {
  const span = 360 / 2 ** generation;
  const start = 180 + index * span;
  return { start, end: start + span, mid: start + span / 2 };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (v: number) => Math.round(v * 100) / 100;

export function polar(center: number, r: number, deg: number): { x: number; y: number } {
  return { x: round(center + r * Math.cos(rad(deg))), y: round(center + r * Math.sin(rad(deg))) };
}

/** Ringstück zwischen zwei Radien und zwei Winkeln als SVG-Pfad. */
export function sectorPath(center: number, inner: number, outer: number, start: number, end: number): string {
  // Vollkreis (bei den Nachfahren: ein einziges Kind): Ein Bogen mit gleichem
  // Anfangs- und Endpunkt würde nicht gezeichnet — dann zwei Halbkreise je
  // Rand; der innere läuft gegenläufig, damit die Mitte frei bleibt.
  if (end - start >= 360 - 1e-6) {
    const a = polar(center, outer, start);
    const b = polar(center, outer, start + 180);
    const outerRing = `M${a.x} ${a.y}A${outer} ${outer} 0 1 1 ${b.x} ${b.y}A${outer} ${outer} 0 1 1 ${a.x} ${a.y}Z`;
    if (inner <= 0) return outerRing;
    const c = polar(center, inner, start);
    const d = polar(center, inner, start + 180);
    return `${outerRing}M${c.x} ${c.y}A${inner} ${inner} 0 1 0 ${d.x} ${d.y}A${inner} ${inner} 0 1 0 ${c.x} ${c.y}Z`;
  }
  const large = end - start > 180 ? 1 : 0;
  const a = polar(center, outer, start);
  const b = polar(center, outer, end);
  const c = polar(center, inner, end);
  const d = polar(center, inner, start);
  if (inner <= 0) return `M${center} ${center}L${a.x} ${a.y}A${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}Z`;
  return `M${a.x} ${a.y}A${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y}Z`;
}

/**
 * Liegt die Mitte eines Bogens in der unteren Hälfte? Dort liefe Text im
 * Uhrzeigersinn auf dem Kopf — der Textpfad wird dann umgekehrt.
 */
export const isLowerHalf = (midDeg: number) => Math.sin(rad(midDeg)) > 1e-9;

/**
 * Textpfad für Beschriftung im Bogen, immer lesbar (nie auf dem Kopf):
 * oben im Uhrzeigersinn, unten gegen den Uhrzeigersinn.
 */
export function labelArcPath(center: number, r: number, start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0;
  if (isLowerHalf((start + end) / 2)) {
    const a = polar(center, r, end);
    const b = polar(center, r, start);
    return `M${a.x} ${a.y}A${r} ${r} 0 ${large} 0 ${b.x} ${b.y}`;
  }
  const a = polar(center, r, start);
  const b = polar(center, r, end);
  return `M${a.x} ${a.y}A${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * Beschriftung entlang des Radius (für schmale, tiefe Plätze): Drehwinkel
 * so, dass der Text rechts nach außen und links nach innen läuft — also nie
 * auf dem Kopf steht.
 */
export function radialRotation(midDeg: number): number {
  const norm = ((midDeg % 360) + 360) % 360;
  return norm > 90 && norm < 270 ? norm - 180 : norm;
}

// ---------------------------------------------------------------------------
// Beschriftung
// ---------------------------------------------------------------------------

/** Ungefähre Zeichenbreite als Anteil der Schriftgröße (Systemschrift, gemischt). */
const CHAR_WIDTH = 0.58;
const LINE_HEIGHT = 1.2;
const MAX_CHARS = 30;
/** Weniger Zeichen lohnen keine Beschriftung. */
const MIN_CHARS = 4;

export type RingLabelMode = "arc" | "radial" | "none";
export type RingLabelPlan = {
  generation: number;
  mode: RingLabelMode;
  /** Schriftgröße in viewBox-Einheiten. */
  fontSize: number;
  /** Zeichen je Zeile. */
  maxChars: number;
  /** 1: nur der Name, 2: Name und Lebensjahre. */
  lines: number;
};

/**
 * Wie jeder Ring beschriftet wird — abhängig davon, wie groß der Kreis
 * gerade gezeichnet ist (`pxPerUnit` = Bildpunkte je viewBox-Einheit), damit
 * die Schrift auf dem Bildschirm lesbar groß bleibt: Innen im Bogen, wo es
 * eng wird entlang des Radius, sonst gar nicht.
 */
export function ringLabelPlan(geometry: RingGeometry, pxPerUnit: number): RingLabelPlan[] {
  return geometry.rings.map((ring) => arcLabelPlan(ring, 1 / 2 ** ring.generation, pxPerUnit));
}

/**
 * Beschriftung einer einzelnen Fläche im Ring `ring`, die den Anteil
 * `fraction` (0…1) des Vollkreises einnimmt — dieselben Regeln wie
 * `ringLabelPlan` (die Vorfahren haben je Ring gleich breite Plätze, die
 * Nachfahren verschieden breite Bögen, lib/descendant-rings.ts).
 */
export function arcLabelPlan(ring: Ring, fraction: number, pxPerUnit: number, fontPx?: number): RingLabelPlan {
  const scale = pxPerUnit > 0 ? pxPerUnit : 1;
  // Schriftgröße in Bildpunkten: am Bildschirm innen 13, außen 12; die
  // Druckansicht gibt eigene Größen nach dem Blattmaß vor (lib/rings-print.ts).
  const fontSize = (fontPx ?? (ring.generation <= 2 ? 13 : 12)) / scale;
  const width = ring.outer - ring.inner;
  const mid = (ring.inner + ring.outer) / 2;
  // Bogen an der inneren Textzeile (kürzer als in der Mitte), etwas Rand.
  const arcLen = 2 * Math.PI * (mid - fontSize * 0.6) * fraction * 0.86;
  const charW = fontSize * CHAR_WIDTH;
  const lineH = fontSize * LINE_HEIGHT;
  const arc = {
    chars: Math.min(MAX_CHARS, Math.floor(arcLen / charW)),
    lines: Math.min(2, Math.floor((width * 0.86) / lineH)),
  };
  const radial = {
    chars: Math.min(MAX_CHARS, Math.floor((width * 0.86) / charW)),
    lines: Math.min(2, Math.floor((arcLen * 0.9) / lineH)),
  };
  const ok = (o: { chars: number; lines: number }) => o.lines >= 1 && o.chars >= MIN_CHARS;
  let mode: RingLabelMode = "none";
  let pick = { chars: 0, lines: 0 };
  if (ok(arc) && (!ok(radial) || arc.chars * arc.lines >= radial.chars * radial.lines)) {
    mode = "arc";
    pick = arc;
  } else if (ok(radial)) {
    mode = "radial";
    pick = radial;
  }
  return { generation: ring.generation, mode, fontSize, maxChars: pick.chars, lines: pick.lines };
}

/** Text auf höchstens `max` Zeichen kürzen (mit „…“). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "";
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Name für einen Platz mit `max` Zeichen: voll, sonst „Vorname N.“, sonst
 * der Vorname, sonst der gekürzte Vorname. Leer, wenn gar nichts passt.
 */
export function fitName(givenName: string, familyName: string | null, max: number): string {
  const given = givenName.trim();
  const family = (familyName ?? "").trim();
  const full = [given, family].filter(Boolean).join(" ");
  if (full.length <= max) return full;
  if (given && family) {
    const initial = `${given} ${family[0]}.`;
    if (initial.length <= max) return initial;
  }
  const first = given || family;
  if (first.length <= max) return first;
  return max >= MIN_CHARS ? truncate(first, max) : "";
}

/** Lebensjahre mit `max` Zeichen: „1850 – 1912“, sonst ohne Leerzeichen, sonst leer. */
export function fitYears(span: string, max: number): string {
  if (!span) return "";
  if (span.length <= max) return span;
  const tight = span.replace(/ – /g, "–");
  return tight.length <= max ? tight : "";
}

export type CenterLabelRow = { text: string; size: number; weight: number; y: number };

/**
 * Beschriftung der Mitte: Vorname, Nachname, Lebensjahre — mindestens
 * `minPx` Bildpunkte groß (bei `pxPerUnit` Bildpunkten je viewBox-Einheit),
 * sonst 22 Einheiten, höchstens so groß, dass drei Zeilen in den Kreis
 * passen. Grundlinien so, dass der Block mittig steht (Zeilenhöhe 1,15).
 */
export function centerLabelRows(
  person: { givenName: string; familyName: string | null; lifeSpan: string },
  centerRadius: number,
  center: number,
  pxPerUnit: number,
  minPx = 12,
): CenterLabelRow[] {
  const scale = pxPerUnit > 0 ? pxPerUnit : 1;
  const font = Math.min(Math.max(minPx / scale, 22), centerRadius * 0.42);
  const chars = Math.floor((centerRadius * 1.6) / (font * CHAR_WIDTH));
  const rows = [
    { text: truncate(person.givenName, chars), size: font, weight: 600 },
    ...(person.familyName ? [{ text: truncate(person.familyName, chars), size: font, weight: 600 }] : []),
    ...(person.lifeSpan ? [{ text: fitYears(person.lifeSpan, Math.floor(chars * 1.2)), size: font * 0.82, weight: 400 }] : []),
  ].filter((r) => r.text);
  const top = center - (rows.length * font * 1.15) / 2 + font * 0.85;
  return rows.map((r, k) => ({ ...r, y: top + k * font * 1.15 }));
}

/**
 * Zusammenfassung unter dem Kreis: „23 von 62 Vorfahren bis zur
 * 5. Generation bekannt“ (+ „, davon 2 nicht freigegeben“).
 */
export function ringsSummary(generations: number, known: number, restricted: number): string {
  const total = ringSlotCount(generations);
  const base = `${known} von ${total} Vorfahren bis zur ${generations}. Generation bekannt`;
  return restricted > 0 ? `${base}, davon ${restricted} nicht freigegeben` : base;
}

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

/**
 * Deckkraft der Linienfarbe je Generation (Rest: Flächenfarbe der Seite) —
 * nach außen heller bzw. im dunklen Schema blasser. Höchstens etwa die
 * Hälfte, damit dunkle Schrift (hell) bzw. helle Schrift (dunkel) auf jeder
 * Fläche gut lesbar bleibt; app/globals.css dämpft im dunklen Schema noch
 * etwas (`--rings-strength`).
 */
export function lineTint(generation: number): number {
  const steps = [50, 48, 40, 33, 27, 22, 18];
  return steps[Math.min(steps.length, Math.max(1, generation)) - 1];
}

/** CSS-Variable der Linienfarbe (app/globals.css). */
export const lineColorVar = (line: LineKey) => `var(--line-${line.toLowerCase()})`;
