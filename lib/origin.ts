/**
 * Herkunft sichtbar machen: Buchstabe und Farbe je Import — reine Regeln ohne
 * Datenbank, für Server und Browser (Dienst: lib/services/origin.ts).
 *
 * Leitlinie des Eigentümers: Die App ist die Wahrheit, Importe sind Quellen.
 * Herkunft ist Zusatzinformation — sie sagt, woher ein Eintrag kam, nicht,
 * wem er „gehört“.
 *
 * - Ein „Import“ ist ein Quell-Baum (`ImportLink.sourceTreeId`); mehrere
 *   Läufe derselben Kennung sind Stände desselben Imports.
 * - Buchstaben in der Reihenfolge des ersten Imports: A, B, C … — ohne „H“,
 *   das für „von Hand erfasst“ steht. Nach Z geht es zweistellig weiter.
 * - Farben aus der Okabe-Ito-Palette (für die häufigen Farbsehschwächen
 *   unterscheidbar), ohne Schwarz. Nach sieben Importen wiederholen sich die
 *   Farben; eindeutig bleibt der Buchstabe. Farbe steht nie allein.
 */

/** Okabe-Ito ohne Schwarz; `fg` ist die Schriftfarbe mit Kontrast ≥ 4,5:1. */
export const ORIGIN_COLORS = [
  { name: "Orange", bg: "#E69F00", fg: "#000000" },
  { name: "Himmelblau", bg: "#56B4E9", fg: "#000000" },
  { name: "Blaugrün", bg: "#009E73", fg: "#000000" },
  { name: "Gelb", bg: "#F0E442", fg: "#000000" },
  { name: "Blau", bg: "#0072B2", fg: "#FFFFFF" },
  { name: "Zinnober", bg: "#D55E00", fg: "#000000" },
  { name: "Rotviolett", bg: "#CC79A7", fg: "#000000" },
] as const;

/** Kennung und Buchstabe für „von Hand erfasst“. */
export const MANUAL_KEY = "H";
export const MANUAL_ORIGIN_NAME = "von Hand erfasst";

/** Importe ohne bekannte Kennung des Quell-Baums (alte Läufe ohne `sourceTreeId`). */
export const UNKNOWN_KEY = "?";

const LETTERS = "ABCDEFGIJKLMNOPQRSTUVWXYZ"; // ohne H

/** Buchstabe des n-ten Imports (0 = A). Nach Z: AA, AB … — nie mit „H“. */
export function importLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = "";
  do {
    out = LETTERS[n % LETTERS.length] + out;
    n = Math.floor(n / LETTERS.length) - 1;
  } while (n >= 0);
  return out;
}

export function originColor(index: number): (typeof ORIGIN_COLORS)[number] {
  return ORIGIN_COLORS[((Math.floor(index) % ORIGIN_COLORS.length) + ORIGIN_COLORS.length) % ORIGIN_COLORS.length];
}

/**
 * Ein Eintrag der Legende bzw. ein Chip: Import (Buchstabe, Farbe, Name) oder
 * „von Hand erfasst“ (`manual`, ohne Farbe, gestrichelt). `key` ist der
 * Buchstabe — die Kennung des Quell-Baums verlässt den Server nicht.
 */
export type OriginEntry = {
  key: string;
  letter: string;
  /** Anzeigename; Dateinamen enthält er nur für Administratoren. */
  name: string;
  color: string | null;
  fg: string | null;
  colorName: string | null;
  manual: boolean;
};

export const MANUAL_ORIGIN: OriginEntry = {
  key: MANUAL_KEY,
  letter: MANUAL_KEY,
  name: MANUAL_ORIGIN_NAME,
  color: null,
  fg: null,
  colorName: null,
  manual: true,
};

/** Höchstens so viele Chips je Karte, dann „+n“. */
export const ORIGIN_CHIP_LIMIT = 3;

export function limitChips<T>(keys: T[], limit = ORIGIN_CHIP_LIMIT): { shown: T[]; more: number } {
  return keys.length <= limit ? { shown: keys, more: 0 } : { shown: keys.slice(0, limit), more: keys.length - limit };
}

/** Text zu einem Chip (Titel, Screenreader): „Import A: Name“ bzw. „von Hand erfasst“. */
export function originText(e: Pick<OriginEntry, "letter" | "name" | "manual">): string {
  return e.manual ? e.name : `Import ${e.letter}: ${e.name}`;
}

/** Schalter in der Adresse der Baumseite: `?herkunft=1`. */
export const ORIGIN_PARAM = "herkunft";

/** Herkunft der Personen einer Baumansicht (nur bei eingeschaltetem Schalter geladen). */
export type TreeOrigin = {
  /** Legende: nur Importe, die im geladenen Ausschnitt vorkommen, mit Zahl der Personen. */
  entries: (OriginEntry & { persons: number })[];
  /** Person → Kennungen ihrer Importe (bzw. ["H"]); nur Personen, die der Benutzer bearbeiten darf. */
  byPerson: Record<string, string[]>;
  /** Personen in mehreren Importen (Verbindungspersonen). */
  connecting: number;
};

/**
 * Chips an den Einträgen der Personenseite (Ereignisse, weitere Namen,
 * Beziehungen, Belege): Kennungen je Eintrag. Einträge ohne Herkunftsvermerk
 * fehlen — sie sind in der App entstanden.
 */
export type OriginChipMap = {
  entries: Record<string, OriginEntry>;
  events: Record<string, string[]>;
  names: Record<string, string[]>;
  relationships: Record<string, string[]>;
  citations: Record<string, string[]>;
};

/** Relative Leuchtdichte nach WCAG (für den Kontrast-Test der Palette). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
