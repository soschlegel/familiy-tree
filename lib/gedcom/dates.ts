/**
 * GEDCOM-Datumsgrammatik (5.5.1 und 7.0) — lesen, schreiben, für die App
 * vereinfachen. Eigenständig (ohne lib/dates.ts), damit die Bibliothek ohne
 * App-Code nutzbar bleibt; `toAppDate` liefert Genauigkeit und Zusatz in den
 * String-Werten der App (DAY/MONTH/YEAR, EXACT/ABOUT/BEFORE/AFTER).
 *
 * Unterstützt: exakte und teilweise Daten, ABT/CAL/EST, BEF/AFT, BET…AND,
 * FROM…TO, INT … (Text), (Text), Doppeljahre (1749/50), v. Chr. (B.C./BCE),
 * Kalender-Escapes (@#DJULIAN@ … bzw. 7.0 JULIAN …), Hebräisch und
 * Französisch-Republikanisch. Julianisch wird immer, Französisch-
 * Republikanisch bei vollem Datum (Jahre I–XIV) umgerechnet; Hebräisch und
 * alles andere bleibt unverändert und ist mit `unconverted` markiert.
 * Nachsichtig erkannt (Flag `lenient`): Kleinschreibung, „Abt.“, „ca.“,
 * „circa“, volle englische und deutsche Monatsnamen, „12.03.1850“,
 * „1850-03-12“, „BET ABT 1850 AND 1860“, „X - Y“, „von X bis Y“.
 */

import type { GedcomCalendar, GedcomDate, GedcomDateKind, GedcomDatePoint } from "./types";

const GREG_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const HEBREW_MONTHS = ["TSH", "CSH", "KSL", "TVT", "SHV", "ADR", "ADS", "NSN", "IYR", "SVN", "TMZ", "AAV", "ELL"];
const FRENCH_MONTHS = ["VEND", "BRUM", "FRIM", "NIVO", "PLUV", "VENT", "GERM", "FLOR", "PRAI", "MESS", "THER", "FRUC", "COMP"];

/** Nachsichtig: volle Namen und deutsche Formen → Monatsnummer (gregorianisch). */
const LENIENT_MONTHS: Record<string, number> = {
  JANUARY: 1, JANUAR: 1, JÄNNER: 1, JAENNER: 1, JANV: 1,
  FEBRUARY: 2, FEBRUAR: 2, FEBR: 2,
  MARCH: 3, MÄRZ: 3, MAERZ: 3, MÄR: 3, MRZ: 3, MARZ: 3,
  APRIL: 4,
  MAI: 5,
  JUNE: 6, JUNI: 6,
  JULY: 7, JULI: 7,
  AUGUST: 8,
  SEPTEMBER: 9, SEPT: 9,
  OCTOBER: 10, OKTOBER: 10, OKT: 10,
  NOVEMBER: 11,
  DECEMBER: 12, DEZEMBER: 12, DEZ: 12,
};

const CAL_ESCAPES: Record<string, GedcomCalendar> = {
  "@#DGREGORIAN@": "GREGORIAN",
  "@#DJULIAN@": "JULIAN",
  "@#DHEBREW@": "HEBREW",
  "@#DFRENCH R@": "FRENCH_R",
  "@#DROMAN@": "ROMAN",
  "@#DUNKNOWN@": "UNKNOWN",
};
const CAL_WORDS: Record<string, GedcomCalendar> = {
  GREGORIAN: "GREGORIAN",
  JULIAN: "JULIAN",
  HEBREW: "HEBREW",
  FRENCH_R: "FRENCH_R",
};

const QUALIFIER_WORDS: Record<string, string> = {
  ABT: "ABT", "ABT.": "ABT", ABOUT: "ABT", CA: "ABT", "CA.": "ABT", CIRCA: "ABT", "C.": "ABT", UM: "ABT", ETWA: "ABT", "~": "ABT",
  CAL: "CAL", "CAL.": "CAL", CALCULATED: "CAL", BER: "CAL", "BER.": "CAL", BERECHNET: "CAL",
  EST: "EST", "EST.": "EST", ESTIMATED: "EST", GESCHÄTZT: "EST",
  BEF: "BEF", "BEF.": "BEF", BEFORE: "BEF", VOR: "BEF", "<": "BEF",
  AFT: "AFT", "AFT.": "AFT", AFTER: "AFT", NACH: "AFT", ">": "AFT",
  BET: "BET", "BET.": "BET", BETWEEN: "BET", BTW: "BET", ZWISCHEN: "BET",
  AND: "AND", "&": "AND", UND: "AND",
  FROM: "FROM", VON: "FROM", AB: "FROM",
  TO: "TO", BIS: "TO",
  INT: "INT", "INT.": "INT",
};

// ---------------------------------------------------------------------------
// Kalenderumrechnung (Julianische Tageszahl)
// ---------------------------------------------------------------------------

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function julianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - 32083;
}

function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/**
 * Jahresanfänge (1. Vendémiaire) der Republik, Jahre I–XIV, gregorianisch.
 * Nach den tatsächlich verwendeten Sextiljahren III, VII, XI.
 */
const FRENCH_YEAR_START: [number, number, number][] = [
  [1792, 9, 22], [1793, 9, 22], [1794, 9, 22], [1795, 9, 23], [1796, 9, 22], [1797, 9, 22], [1798, 9, 22],
  [1799, 9, 23], [1800, 9, 23], [1801, 9, 23], [1802, 9, 23], [1803, 9, 24], [1804, 9, 23], [1805, 9, 23],
];

function daysInGregorianMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function daysInJulianMonth(y: number, m: number): number {
  if (m === 2) return y % 4 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function convert(p: GedcomDatePoint): void {
  if (p.calendar === "GREGORIAN" || p.year === undefined) return;
  if (p.bc) {
    p.unconverted = true;
    return;
  }
  if (p.calendar === "JULIAN") {
    if (p.month !== undefined && p.day !== undefined) {
      p.gregorian = jdnToGregorian(julianToJdn(p.dualYear ?? p.year, p.month, p.day));
    } else {
      // Ohne Tag weicht der Monat höchstens um knapp zwei Wochen ab.
      p.gregorian = p.month !== undefined ? { year: p.dualYear ?? p.year, month: p.month } : { year: p.dualYear ?? p.year };
    }
    return;
  }
  if (p.calendar === "FRENCH_R" && p.month !== undefined && p.day !== undefined && p.year >= 1 && p.year <= 14) {
    const [y, m, d] = FRENCH_YEAR_START[p.year - 1];
    p.gregorian = jdnToGregorian(gregorianToJdn(y, m, d) + (p.month - 1) * 30 + p.day - 1);
    return;
  }
  p.unconverted = true;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

type Ctx = { lenient: boolean };

function parsePoint(text: string, ctx: Ctx): GedcomDatePoint | null {
  let rest = text.trim();
  let calendar: GedcomCalendar = "GREGORIAN";
  let explicitCalendar = false;

  const esc = rest.match(/^@#D([A-Z ]+)@\s*/i);
  if (esc) {
    const key = `@#D${esc[1].toUpperCase()}@`;
    const cal = CAL_ESCAPES[key];
    if (!cal) return null;
    calendar = cal;
    explicitCalendar = true;
    rest = rest.slice(esc[0].length);
    if (esc[1] !== esc[1].toUpperCase()) ctx.lenient = true;
  } else {
    const word = rest.match(/^([A-Z_]+)\s+/i);
    if (word && CAL_WORDS[word[1].toUpperCase()]) {
      calendar = CAL_WORDS[word[1].toUpperCase()];
      explicitCalendar = true;
      rest = rest.slice(word[0].length);
    }
  }
  void explicitCalendar;

  let bc = false;
  const bcMatch = rest.match(/\s*(B\.C\.|BC|BCE|B\.C|V\.\s?CHR\.?)$/i);
  if (bcMatch) {
    bc = true;
    if (!/^(B\.C\.|BCE)$/.test(bcMatch[1].trim())) ctx.lenient = true;
    rest = rest.slice(0, rest.length - bcMatch[0].length).trim();
  }

  let m: RegExpMatchArray | null;
  // Nachsichtige Ziffernformen
  if ((m = rest.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{3,4})$/))) {
    ctx.lenient = true;
    return finishPoint({ calendar, day: +m[1], month: +m[2], year: +m[3], bc }, ctx);
  }
  if ((m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    ctx.lenient = true;
    return finishPoint({ calendar, day: +m[3], month: +m[2], year: +m[1], bc }, ctx);
  }
  if ((m = rest.match(/^(\d{4})-(\d{1,2})$/))) {
    ctx.lenient = true;
    return finishPoint({ calendar, month: +m[2], year: +m[1], bc }, ctx);
  }
  if ((m = rest.match(/^(\d{1,2})[./](\d{4})$/))) {
    ctx.lenient = true;
    return finishPoint({ calendar, month: +m[1], year: +m[2], bc }, ctx);
  }

  const tokens = rest.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return null;

  // Jahr (letztes Token), ggf. Doppeljahr
  const yearTok = tokens[tokens.length - 1];
  const ym = yearTok.match(/^(\d{1,4})(?:\/(\d{1,4}))?$/);
  if (!ym) return null;
  const point: GedcomDatePoint = { calendar, year: +ym[1] };
  if (bc) point.bc = true;
  if (ym[2] !== undefined) {
    const tail = ym[2];
    if (tail.length >= 3) point.dualYear = +tail;
    else {
      const base = Math.floor(point.year! / 10 ** tail.length) * 10 ** tail.length;
      let dual = base + +tail;
      if (dual <= point.year!) dual += 10 ** tail.length;
      point.dualYear = dual;
    }
  }

  if (tokens.length >= 2) {
    const monTok = tokens[tokens.length - 2].replace(/\.$/, "");
    const mon = monthNumber(monTok, calendar, ctx);
    if (mon === null) return null;
    point.month = mon;
    if (tokens[tokens.length - 2] !== monTok) ctx.lenient = true;
  }
  if (tokens.length === 3) {
    const dayTok = tokens[0].replace(/\.$/, "");
    if (!/^\d{1,2}$/.test(dayTok)) return null;
    if (dayTok !== tokens[0]) ctx.lenient = true;
    point.day = +dayTok;
  }
  return finishPoint(point, ctx);
}

function monthNumber(tok: string, calendar: GedcomCalendar, ctx: Ctx): number | null {
  const up = tok.toUpperCase();
  if (up !== tok) ctx.lenient = true;
  const table = calendar === "HEBREW" ? HEBREW_MONTHS : calendar === "FRENCH_R" ? FRENCH_MONTHS : GREG_MONTHS;
  const idx = table.indexOf(up);
  if (idx >= 0) return idx + 1;
  if (calendar === "GREGORIAN" || calendar === "JULIAN") {
    const lenient = LENIENT_MONTHS[up];
    if (lenient) {
      ctx.lenient = true;
      return lenient;
    }
  }
  return null;
}

function finishPoint(p: GedcomDatePoint, _ctx: Ctx): GedcomDatePoint | null {
  if (p.bc === false) delete p.bc;
  if (p.year === undefined) return null;
  if (p.month !== undefined) {
    const max = p.calendar === "HEBREW" ? 13 : p.calendar === "FRENCH_R" ? 13 : 12;
    if (p.month < 1 || p.month > max) return null;
  }
  if (p.day !== undefined) {
    if (p.month === undefined || p.day < 1) return null;
    const y = p.dualYear ?? p.year;
    const max =
      p.calendar === "GREGORIAN"
        ? daysInGregorianMonth(y, p.month)
        : p.calendar === "JULIAN"
          ? daysInJulianMonth(y, p.month)
          : p.calendar === "FRENCH_R"
            ? p.month === 13
              ? 6
              : 30
            : 30;
    if (p.day > max) return null;
  }
  convert(p);
  return p;
}

/**
 * Liest einen GEDCOM-Datumswert. Wirft nie: nicht Erkennbares ergibt
 * `kind: "INVALID"` mit dem Originaltext.
 */
export function parseGedcomDate(input: string): GedcomDate {
  const original = input.trim().replace(/\s+/g, " ");
  const ctx: Ctx = { lenient: false };
  if (original !== input.trim()) ctx.lenient = true;
  const result = parseInner(original, ctx);
  if (!result) return { original, kind: "INVALID" };
  if (ctx.lenient) result.lenient = true;
  return { original, ...result };
}

function parseInner(text: string, ctx: Ctx): Omit<GedcomDate, "original"> | null {
  if (!text) return null;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^\((.*)\)$/s))) return { kind: "PHRASE", phrase: m[1] };

  // Schlüsselwörter normalisieren (Großschreibung, Punkte, deutsche Wörter).
  const words = text.split(" ");
  const norm = words.map((w) => {
    const q = QUALIFIER_WORDS[w.toUpperCase()];
    if (q) {
      if (q !== w) ctx.lenient = true;
      return q;
    }
    return w;
  });

  const head = norm[0];
  const restOf = (from: number) => words.slice(from).join(" ");

  if (head === "INT") {
    const body = restOf(1);
    const pm = body.match(/^(.*?)\s*\((.*)\)$/s);
    const point = parsePoint(pm ? pm[1] : body, ctx);
    if (!point) return null;
    if (!pm) ctx.lenient = true;
    return pm ? { kind: "INTERPRETED", start: point, phrase: pm[2] } : { kind: "INTERPRETED", start: point };
  }
  if (head === "ABT" || head === "CAL" || head === "EST" || head === "BEF" || head === "AFT") {
    const point = parsePoint(restOf(1), ctx);
    if (!point) return null;
    const kind: GedcomDateKind =
      head === "ABT" ? "ABOUT" : head === "CAL" ? "CALCULATED" : head === "EST" ? "ESTIMATED" : head === "BEF" ? "BEFORE" : "AFTER";
    return { kind, start: point };
  }
  if (head === "BET") {
    const and = norm.indexOf("AND", 1);
    const dash = and < 0 ? words.indexOf("-", 1) : -1;
    const split = and >= 0 ? and : dash;
    if (split < 0) return null;
    if (dash >= 0) ctx.lenient = true;
    const a = stripQualifier(words.slice(1, split).join(" "), ctx);
    const b = stripQualifier(words.slice(split + 1).join(" "), ctx);
    const pa = parsePoint(a, ctx);
    const pb = parsePoint(b, ctx);
    if (!pa || !pb) return null;
    return { kind: "BETWEEN", start: pa, end: pb };
  }
  if (head === "FROM") {
    const to = norm.indexOf("TO", 1);
    if (to < 0) {
      const p = parsePoint(restOf(1), ctx);
      return p ? { kind: "FROM", start: p } : null;
    }
    const pa = parsePoint(words.slice(1, to).join(" "), ctx);
    const pb = parsePoint(words.slice(to + 1).join(" "), ctx);
    if (!pa || !pb) return null;
    return { kind: "FROM_TO", start: pa, end: pb };
  }
  if (head === "TO") {
    const p = parsePoint(restOf(1), ctx);
    return p ? { kind: "TO", start: p } : null;
  }

  const plain = parsePoint(text, ctx);
  if (plain) return { kind: "EXACT", start: plain };

  // „1850 - 1860“ bzw. „1850 bis 1860“ (nachsichtig)
  const dashIdx = words.indexOf("-");
  const bisIdx = norm.indexOf("TO");
  if (dashIdx > 0 || bisIdx > 0) {
    const idx = dashIdx > 0 ? dashIdx : bisIdx;
    const pa = parsePoint(words.slice(0, idx).join(" "), ctx);
    const pb = parsePoint(words.slice(idx + 1).join(" "), ctx);
    if (pa && pb) {
      ctx.lenient = true;
      return { kind: dashIdx > 0 ? "BETWEEN" : "FROM_TO", start: pa, end: pb };
    }
  }
  const m2 = text.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (m2) {
    ctx.lenient = true;
    return { kind: "BETWEEN", start: parsePoint(m2[1], ctx)!, end: parsePoint(m2[2], ctx)! };
  }
  return null;
}

/** „BET ABT 1850 AND 1860“: ABT im Bereich ist nicht genormt — ignorieren. */
function stripQualifier(text: string, ctx: Ctx): string {
  const m = text.match(/^(\S+)\s+(.*)$/);
  if (m && QUALIFIER_WORDS[m[1].toUpperCase()] && ["ABT", "CAL", "EST"].includes(QUALIFIER_WORDS[m[1].toUpperCase()])) {
    ctx.lenient = true;
    return m[2];
  }
  return text;
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

const CAL_ESCAPE_OUT: Record<GedcomCalendar, string> = {
  GREGORIAN: "",
  JULIAN: "@#DJULIAN@ ",
  HEBREW: "@#DHEBREW@ ",
  FRENCH_R: "@#DFRENCH R@ ",
  ROMAN: "@#DROMAN@ ",
  UNKNOWN: "@#DUNKNOWN@ ",
};

function formatPoint(p: GedcomDatePoint, version: 5 | 7): string {
  let cal = "";
  if (p.calendar !== "GREGORIAN") {
    cal = version === 7 ? `${p.calendar} ` : CAL_ESCAPE_OUT[p.calendar];
  }
  const table = p.calendar === "HEBREW" ? HEBREW_MONTHS : p.calendar === "FRENCH_R" ? FRENCH_MONTHS : GREG_MONTHS;
  const parts: string[] = [];
  if (p.day !== undefined && p.month !== undefined) parts.push(String(p.day));
  if (p.month !== undefined) parts.push(table[p.month - 1]);
  let year = String(p.year ?? "");
  if (p.dualYear !== undefined) {
    // Kurzform wie üblich: 1749/50
    year += "/" + String(p.dualYear).slice(-2).padStart(2, "0");
  }
  parts.push(year);
  if (p.bc) parts.push(version === 7 ? "BCE" : "B.C.");
  return cal + parts.join(" ");
}

/**
 * Schreibt ein Datum in GEDCOM-Syntax (Standard 5.5.1). Ist `original`
 * genormt und beschreibt es dasselbe Datum, wird es unverändert übernommen.
 * Ungültige Daten werden wörtlich geschrieben (nichts geht verloren).
 */
export function formatGedcomDate(date: GedcomDate, version: 5 | 7 = 5): string {
  if (date.kind === "INVALID") return date.original;
  if (date.original && !date.lenient) {
    const re = parseGedcomDate(date.original);
    if (!re.lenient && sameDate(re, date)) return date.original;
  }
  const s = date.start;
  const e = date.end;
  switch (date.kind) {
    case "PHRASE":
      return `(${date.phrase ?? ""})`;
    case "EXACT":
      return formatPoint(s!, version);
    case "ABOUT":
      return `ABT ${formatPoint(s!, version)}`;
    case "CALCULATED":
      return `CAL ${formatPoint(s!, version)}`;
    case "ESTIMATED":
      return `EST ${formatPoint(s!, version)}`;
    case "BEFORE":
      return `BEF ${formatPoint(s!, version)}`;
    case "AFTER":
      return `AFT ${formatPoint(s!, version)}`;
    case "BETWEEN":
      return `BET ${formatPoint(s!, version)} AND ${formatPoint(e!, version)}`;
    case "FROM":
      return `FROM ${formatPoint(s!, version)}`;
    case "TO":
      return `TO ${formatPoint(s!, version)}`;
    case "FROM_TO":
      return `FROM ${formatPoint(s!, version)} TO ${formatPoint(e!, version)}`;
    case "INTERPRETED":
      return date.phrase !== undefined ? `INT ${formatPoint(s!, version)} (${date.phrase})` : `INT ${formatPoint(s!, version)}`;
  }
}

/** Gleiches Datum (ohne Originaltext und Nachsichts-Flag)? */
export function sameDate(a: GedcomDate, b: GedcomDate): boolean {
  const strip = (d: GedcomDate) => JSON.stringify({ k: d.kind, s: d.start, e: d.end, p: d.phrase });
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------------------
// Für die App vereinfachen
// ---------------------------------------------------------------------------

export interface SimpleDate {
  year: number;
  month?: number;
  day?: number;
}

export type AppPrecision = "DAY" | "MONTH" | "YEAR";
export type AppQualifier = "EXACT" | "ABOUT" | "BEFORE" | "AFTER";

/**
 * Vorschlag für die Speicherung in der App (gregorianisch):
 * - `start`/`precision`/`qualifier` passen auf die heutigen Spalten.
 * - Bei Bereichen (BET…AND) und Zeiträumen (FROM…TO) zusätzlich `end`
 *   und `range` — für die Bereichsunterstützung, die G1 ergänzt.
 * - `lossy` sagt, dass die App-Form weniger aussagt als das Original
 *   (CAL/EST → „um“, Bereich → Anfang, Erläuterung bei INT). Das Original
 *   bleibt in `GedcomDate.original` und sollte mitgespeichert werden.
 * `null`, wenn nichts Rechnbares vorliegt (Text, ungültig, v. Chr.,
 * nicht umrechenbarer Kalender).
 */
export interface AppDate {
  start: SimpleDate;
  precision: AppPrecision;
  qualifier: AppQualifier;
  end?: SimpleDate;
  endPrecision?: AppPrecision;
  range?: "BETWEEN" | "PERIOD";
  lossy: boolean;
}

function toSimple(p: GedcomDatePoint | undefined): SimpleDate | null {
  if (!p || p.bc || p.year === undefined) return null;
  if (p.calendar !== "GREGORIAN") {
    if (!p.gregorian) return null;
    return { ...p.gregorian };
  }
  const s: SimpleDate = { year: p.dualYear ?? p.year };
  if (p.month !== undefined) s.month = p.month;
  if (p.day !== undefined) s.day = p.day;
  return s;
}

function precisionOf(s: SimpleDate): AppPrecision {
  return s.day !== undefined ? "DAY" : s.month !== undefined ? "MONTH" : "YEAR";
}

export function toAppDate(date: GedcomDate | undefined | null): AppDate | null {
  if (!date) return null;
  const s = toSimple(date.start);
  if (!s) return null;
  const base = { start: s, precision: precisionOf(s) };
  switch (date.kind) {
    case "EXACT":
      return { ...base, qualifier: "EXACT", lossy: false };
    case "INTERPRETED":
      return { ...base, qualifier: "EXACT", lossy: date.phrase !== undefined };
    case "ABOUT":
      return { ...base, qualifier: "ABOUT", lossy: false };
    case "CALCULATED":
    case "ESTIMATED":
      return { ...base, qualifier: "ABOUT", lossy: true };
    case "BEFORE":
      return { ...base, qualifier: "BEFORE", lossy: false };
    case "AFTER":
      return { ...base, qualifier: "AFTER", lossy: false };
    case "FROM":
      return { ...base, qualifier: "EXACT", range: "PERIOD", lossy: true };
    case "TO":
      return { ...base, qualifier: "EXACT", range: "PERIOD", lossy: true };
    case "BETWEEN":
    case "FROM_TO": {
      const e = toSimple(date.end);
      if (!e) return { ...base, qualifier: date.kind === "BETWEEN" ? "AFTER" : "EXACT", lossy: true };
      return {
        ...base,
        qualifier: date.kind === "BETWEEN" ? "ABOUT" : "EXACT",
        end: e,
        endPrecision: precisionOf(e),
        range: date.kind === "BETWEEN" ? "BETWEEN" : "PERIOD",
        lossy: true,
      };
    }
    default:
      return null;
  }
}

/**
 * Baut ein GEDCOM-Datum aus App-Werten (für den Export). Monatsnamen sind
 * immer die englischen GEDCOM-Kürzel.
 */
export function fromAppDate(input: {
  start: SimpleDate;
  qualifier?: AppQualifier;
  end?: SimpleDate;
  range?: "BETWEEN" | "PERIOD";
}): GedcomDate {
  const pt = (s: SimpleDate): GedcomDatePoint => {
    const p: GedcomDatePoint = { calendar: "GREGORIAN", year: s.year };
    if (s.month !== undefined) p.month = s.month;
    if (s.day !== undefined && s.month !== undefined) p.day = s.day;
    return p;
  };
  let d: Omit<GedcomDate, "original">;
  if (input.end && input.range === "PERIOD") d = { kind: "FROM_TO", start: pt(input.start), end: pt(input.end) };
  else if (input.end) d = { kind: "BETWEEN", start: pt(input.start), end: pt(input.end) };
  else {
    const kind: GedcomDateKind =
      input.qualifier === "ABOUT" ? "ABOUT" : input.qualifier === "BEFORE" ? "BEFORE" : input.qualifier === "AFTER" ? "AFTER" : "EXACT";
    d = { kind, start: pt(input.start) };
  }
  const full = { original: "", ...d } as GedcomDate;
  full.original = formatGedcomDate(full);
  return full;
}
