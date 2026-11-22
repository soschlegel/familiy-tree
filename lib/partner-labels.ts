/**
 * Deutsche Wortwahl rund um Partnerschaften — gemeinsam für Personenseite,
 * Beziehungseditor, Baum, Quellen und Recherche. Reine Funktionen.
 *
 * Grundsatz: „Hochzeit“ und „Ehe“ nur, wenn die Partnerschaft als Ehe erfasst
 * ist (MARRIED, DIVORCED). Unverheiratete und solche mit unbekanntem
 * Ehestand (PARTNER_UNKNOWN, oft aus Importen ohne Heiratsangabe) heißen
 * neutral „Partnerschaft“.
 */
import { formatFuzzyYear, toFuzzyDate, type DatePrecision, type DateQualifier } from "./dates";

export const PARTNER_SUBTYPE_LABEL: Record<string, string> = {
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
  PARTNER_UNKNOWN: "Ehestand unbekannt",
};

/** Als Ehe erfasst (verheiratet oder geschieden)? */
export const isMarriage = (subtype: string) => subtype === "MARRIED" || subtype === "DIVORCED";

/** „Ehe“ bzw. „Partnerschaft“. */
export const partnershipNoun = (subtype: string) => (isMarriage(subtype) ? "Ehe" : "Partnerschaft");

/** Symbol am Ehe-/Partnerschaftsmarker im Baum. */
export const PARTNER_SYMBOL: Record<string, string> = {
  MARRIED: "♥",
  UNMARRIED: "♥",
  DIVORCED: "⚯",
  PARTNER_UNKNOWN: "?",
};

export type PartnerLineStyle = { stroke: string; dash?: string; lineCap?: "round" };

/**
 * Linie im Baum: Ehe und Partnerschaft durchgezogen (rosé), geschieden
 * gestrichelt (grau), Ehestand unbekannt gepunktet (gedämpftes Rosé).
 */
export function partnerLineStyle(subtype: string | undefined): PartnerLineStyle {
  switch (subtype) {
    case "DIVORCED":
      return { stroke: "#a8a29e", dash: "5 4" };
    case "PARTNER_UNKNOWN":
      return { stroke: "#c9a3aa", dash: "1 4", lineCap: "round" };
    default:
      return { stroke: "#fb7185" };
  }
}

/** Was der Marker beschreibt: „Hochzeit“, „Ehe geschieden“, „Partnerschaft“, „Partnerschaft, Ehestand unbekannt“. */
export function partnerMarkerLabel(subtype: string): string {
  switch (subtype) {
    case "DIVORCED":
      return "Ehe geschieden";
    case "MARRIED":
      return "Hochzeit";
    case "PARTNER_UNKNOWN":
      return "Partnerschaft, Ehestand unbekannt";
    default:
      return "Partnerschaft";
  }
}

/**
 * Kurze Jahresangabe für enge Marker: „1850“, „um 1850“, „1850–55“ (Bereich
 * im selben Jahrhundert), „ab 1850“.
 */
export function shortYear(
  date: string | null | undefined,
  precision?: DatePrecision | string | null,
  qualifier?: DateQualifier | string | null,
  to?: string | null,
  toPrecision?: DatePrecision | string | null,
): string {
  const f = toFuzzyDate(date ?? null, precision, qualifier, to ?? null, toPrecision);
  if (!f) return "";
  if ((f.qualifier === "BETWEEN" || f.qualifier === "PERIOD") && f.to) {
    const a = f.date.getUTCFullYear();
    const b = f.to.date.getUTCFullYear();
    if (a === b) return String(a);
    return Math.floor(a / 100) === Math.floor(b / 100) ? `${a}–${String(b % 100).padStart(2, "0")}` : `${a}–${b}`;
  }
  if (f.precision !== "YEAR" && (f.qualifier === "BEFORE" || f.qualifier === "AFTER" || f.qualifier === "UNTIL")) {
    return formatFuzzyYear({ ...f, precision: "YEAR" });
  }
  return formatFuzzyYear(f);
}

/** „seit 1886“ — aber Bereiche und Wortlaute ohne „seit“ („zwischen 1850 und 1855“). */
export function since(text: string): string {
  return /^(zwischen|von|ab|bis|seit)\s/i.test(text) || /[„“]/.test(text) ? text : `seit ${text}`;
}

/**
 * Kurzbeschreibung einer Partnerschaft für die Partnerkarte der
 * Personenseite: „verheiratet seit 1886“, „geschieden · 1886 – 1901“,
 * „Partnerschaft seit 1950“, „Partnerschaft · Ehestand unbekannt“. Daten
 * bereits fertig formatiert (mit Bereich und Wortlaut).
 */
export function partnerCardDescription(subtype: string, start: string | null, end: string | null): string {
  switch (subtype) {
    case "MARRIED":
      return start ? `verheiratet ${since(start)}` : "verheiratet";
    case "DIVORCED":
      return start && end ? `geschieden · ${start} – ${end}` : end ? `geschieden ${end}` : "geschieden";
    case "PARTNER_UNKNOWN":
      return `${start ? `Partnerschaft ${since(start)}` : "Partnerschaft"} · Ehestand unbekannt`;
    default:
      return start ? `Partnerschaft ${since(start)}` : "Partnerschaft";
  }
}

/** Orte einer Partnerschaft: „Hochzeit in Hildesheim · Scheidung in Celle“ bzw. neutral „Ort: …“. */
export function partnerPlaces(subtype: string, startPlace: string | null, endPlace: string | null): string {
  const parts: string[] = [];
  if (startPlace) parts.push(isMarriage(subtype) ? `Hochzeit in ${startPlace}` : `Beginn in ${startPlace}`);
  if (endPlace) parts.push(subtype === "DIVORCED" ? `Scheidung in ${endPlace}` : `Ende in ${endPlace}`);
  return parts.join(" · ");
}
