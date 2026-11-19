/**
 * Ungenaue Daten — Eingabe, Anzeige und Vergleich. Reine Funktionen ohne
 * Datenbank und ohne Abhängigkeiten, damit Formulare (Browser), Dienste,
 * MCP-Server und Tests dieselben Regeln verwenden.
 *
 * Modell: Ein Datum besteht aus
 * - `date`: Ankerpunkt (UTC-Mitternacht) — bei Genauigkeit MONTH der
 *   Monatserste, bei YEAR der 1. Januar. Er ist sortierbar und steht in der
 *   bisherigen DateTime-Spalte. Bei Bereichen ist er der Anfang.
 * - `precision`: DAY | MONTH | YEAR — wie viel davon bekannt ist.
 * - `qualifier`: EXACT | ABOUT (um, ca.) | BEFORE (vor) | AFTER (nach) |
 *   ESTIMATED (geschätzt) | CALCULATED (errechnet) | BETWEEN (zwischen … und
 *   …) | PERIOD (von … bis …, ohne Ende: ab …) | UNTIL (bis …).
 * - `to`: nur bei BETWEEN und PERIOD — Ende des Bereichs mit eigener
 *   Genauigkeit (Spalten `…To`, `…ToPrecision`).
 *
 * Daneben kann jede Angabe einen Wortlaut haben (`…Phrase`): der Text, wie er
 * in der Quelle steht, wenn er sich nicht verlustfrei strukturiert darstellen
 * lässt („Weihnachten 1850“, julianischer Kalender, GEDCOM-Datumsphrase).
 * Er ersetzt das Datum nicht, sondern ergänzt es (oder steht allein).
 *
 * Vergleiche (Plausibilität, Alter) arbeiten mit dem Zeitraum, den eine
 * Angabe abdeckt (`dateBounds`): „1850“ ist das ganze Jahr, „um 1850“ ein
 * paar Jahre mehr, „vor 1900“ alles bis Ende 1899, „zwischen 1850 und 1855“
 * Anfang 1850 bis Ende 1855. Gemeldet wird ein Widerspruch nur, wenn er für
 * jede mögliche Lesart besteht. Sortierung, Jahresfilter und Jahresstatistik
 * nutzen den Anker, bei Bereichen also den Anfang.
 */

export type DatePrecision = "DAY" | "MONTH" | "YEAR";
export type DateQualifier =
  | "EXACT"
  | "ABOUT"
  | "BEFORE"
  | "AFTER"
  | "ESTIMATED"
  | "CALCULATED"
  | "BETWEEN"
  | "PERIOD"
  | "UNTIL";

export const DATE_PRECISIONS: readonly DatePrecision[] = ["DAY", "MONTH", "YEAR"];
export const DATE_QUALIFIERS: readonly DateQualifier[] = [
  "EXACT",
  "ABOUT",
  "BEFORE",
  "AFTER",
  "ESTIMATED",
  "CALCULATED",
  "BETWEEN",
  "PERIOD",
  "UNTIL",
];

/** Zusätze mit Bereichsende (`to`). BETWEEN braucht es, PERIOD nicht (= ab …). */
export const RANGE_QUALIFIERS: readonly DateQualifier[] = ["BETWEEN", "PERIOD"];
export const isRangeQualifier = (q: DateQualifier) => q === "BETWEEN" || q === "PERIOD";

/** Ende eines Bereichs: Anker (Anfang des Zeitraums) und Genauigkeit. */
export type DateEnd = { date: Date; precision: DatePrecision };

export type FuzzyDate = {
  date: Date;
  precision: DatePrecision;
  qualifier: DateQualifier;
  /** Nur bei BETWEEN/PERIOD: Ende des Bereichs. */
  to?: DateEnd | null;
};

/** Spielraum für „um“, „geschätzt“, „errechnet“: so viele Jahre in beide Richtungen. */
export const ABOUT_TOLERANCE_YEARS = 2;

/** Höchstlänge des Wortlauts (…Phrase). */
export const MAX_DATE_PHRASE_LENGTH = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
export const YEAR_MS = 365.2425 * DAY_MS;

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/**
 * Monatsnamen und gängige Abkürzungen (ohne Punkt, kleingeschrieben) —
 * deutsch, dazu die englischen bzw. GEDCOM-Kürzel (JAN … DEC).
 */
const MONTH_LOOKUP: Record<string, number> = {
  januar: 1, jan: 1, jänner: 1, jaenner: 1, january: 1,
  februar: 2, feb: 2, febr: 2, february: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3, marz: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mai: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12, dec: 12, december: 12,
};

// Nach dem Zusatz darf kein Buchstabe folgen — sonst fräße „ca“ den Anfang
// von „CAL 1850“.
const QUALIFIER_PREFIXES: [RegExp, DateQualifier][] = [
  // „um“, „ca.“, „circa“, „etwa“, „~“; GEDCOM-Kürzel ABT für KI-Eingaben.
  [/^(?:um|ca\.?|circa|zirka|etwa|ungefähr|ungef\.|~|abt\.?|about)(?![A-Za-zÄÖÜäöüß])\s*/i, "ABOUT"],
  [/^(?:geschätzt|geschaetzt|gesch\.|est\.?|estimated)(?![A-Za-zÄÖÜäöüß])\s*/i, "ESTIMATED"],
  [/^(?:errechnet|berechnet|err\.|cal\.?|calculated)(?![A-Za-zÄÖÜäöüß])\s*/i, "CALCULATED"],
  [/^(?:vor|bef\.?|before|<)(?![A-Za-zÄÖÜäöüß])\s*/i, "BEFORE"],
  [/^(?:nach|aft\.?|after|>)(?![A-Za-zÄÖÜäöüß])\s*/i, "AFTER"],
];

const QUALIFIER_PREFIX: Record<DateQualifier, string> = {
  EXACT: "",
  ABOUT: "um ",
  BEFORE: "vor ",
  AFTER: "nach ",
  ESTIMATED: "geschätzt ",
  CALCULATED: "errechnet ",
  BETWEEN: "zwischen ",
  PERIOD: "ab ",
  UNTIL: "bis ",
};

export const QUALIFIER_LABEL: Record<DateQualifier, string> = {
  EXACT: "genau",
  ABOUT: "um (ungefähr)",
  BEFORE: "vor",
  AFTER: "nach",
  ESTIMATED: "geschätzt",
  CALCULATED: "errechnet",
  BETWEEN: "zwischen … und …",
  PERIOD: "von … bis …",
  UNTIL: "bis",
};

export const PRECISION_LABEL: Record<DatePrecision, string> = {
  DAY: "Tag",
  MONTH: "Monat",
  YEAR: "Jahr",
};

export const DATE_INPUT_EXAMPLES =
  "z.B. 1850, 03.1850, 12.03.1850, um 1850, vor 1900, nach 1723, zwischen 1850 und 1855, von 1901 bis 1910";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type ParseResult =
  | { ok: true; value: FuzzyDate | null }
  | { ok: false; error: string };

type CoreResult = { ok: true; value: DateEnd } | { ok: false; error: string };

function build(y: number, m: number | null, d: number | null, raw: string): CoreResult {
  if (!Number.isInteger(y) || y < 1 || y > 9999) {
    return { ok: false, error: `„${raw}“: Jahr ${y} ist nicht gültig.` };
  }
  if (m !== null && (m < 1 || m > 12)) {
    return { ok: false, error: `„${raw}“: Einen Monat ${m} gibt es nicht.` };
  }
  if (m !== null && d !== null && (d < 1 || d > daysInMonth(y, m))) {
    return { ok: false, error: `„${raw}“: Den ${pad(d)}.${pad(m)}.${y} gibt es nicht.` };
  }
  const precision: DatePrecision = d !== null ? "DAY" : m !== null ? "MONTH" : "YEAR";
  return { ok: true, value: { date: utc(y, m ?? 1, d ?? 1), precision } };
}

/** Ein einzelnes Datum ohne Zusatz. */
function parseCore(rest: string, raw: string): CoreResult {
  let m: RegExpMatchArray | null;

  // Voller ISO-Zeitstempel (z.B. aus einem älteren Export): Tag in UTC.
  if ((m = rest.match(/^(\d{4})-(\d{2})-(\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/))) {
    const parsed = new Date(rest);
    if (Number.isNaN(parsed.getTime())) return unrecognized(raw);
    return build(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(), raw);
  }
  if ((m = rest.match(/^(\d{4})$/))) return build(+m[1], null, null, raw);
  if ((m = rest.match(/^(\d{4})-(\d{1,2})$/))) return build(+m[1], +m[2], null, raw);
  if ((m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return build(+m[1], +m[2], +m[3], raw);
  if ((m = rest.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/))) return build(+m[3], +m[2], +m[1], raw);
  if ((m = rest.match(/^(\d{1,2})[./](\d{4})$/))) return build(+m[2], +m[1], null, raw);
  if ((m = rest.match(/^(?:(\d{1,2})\.?\s+)?([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})$/))) {
    const month = MONTH_LOOKUP[m[2].toLowerCase()];
    if (!month) return unrecognized(raw);
    return build(+m[3], month, m[1] ? +m[1] : null, raw);
  }
  return unrecognized(raw);
}

/** Ende (exklusiv) des Zeitraums eines Ankers in seiner Genauigkeit. */
function periodEnd(e: DateEnd): number {
  const y = e.date.getUTCFullYear();
  const m = e.date.getUTCMonth();
  return e.precision === "YEAR"
    ? Date.UTC(y + 1, 0, 1)
    : e.precision === "MONTH"
      ? Date.UTC(y, m + 1, 1)
      : e.date.getTime() + DAY_MS;
}

function rangeValue(
  qualifier: "BETWEEN" | "PERIOD",
  fromText: string,
  toText: string | null,
  raw: string,
): ParseResult {
  const from = parseCore(fromText.trim(), raw);
  if (!from.ok) return from;
  if (toText === null) return { ok: true, value: { ...from.value, qualifier } };
  const to = parseCore(toText.trim(), raw);
  if (!to.ok) return to;
  if (periodEnd(to.value) <= from.value.date.getTime()) {
    return { ok: false, error: `„${raw}“: Das Ende liegt vor dem Anfang.` };
  }
  return { ok: true, value: { ...from.value, qualifier, to: to.value } };
}

// Bereiche: „zwischen 1850 und 1855“ (GEDCOM BET … AND …), „von 1901 bis
// 1910“ (FROM … TO …), „ab 1901“/„seit 1901“ (FROM …), „bis 1910“ (TO …),
// „1850–1855“ bzw. „1850 - 1855“ (= zwischen).
const RANGE_PATTERNS: [RegExp, (m: RegExpMatchArray, raw: string) => ParseResult][] = [
  [/^(?:zwischen|zw\.?|bet\.?|between)\s+(.+?)\s+(?:und|u\.|and)\s+(.+)$/i, (m, raw) => rangeValue("BETWEEN", m[1], m[2], raw)],
  [/^(?:von|vom|from)\s+(.+?)\s+(?:bis|to|until)\s+(.+)$/i, (m, raw) => rangeValue("PERIOD", m[1], m[2], raw)],
  [/^(?:ab|seit|von|vom|from)\s+(.+)$/i, (m, raw) => rangeValue("PERIOD", m[1], null, raw)],
  [
    /^(?:bis|to|until)\s+(.+)$/i,
    (m, raw) => {
      const r = parseCore(m[1].trim(), raw);
      return r.ok ? { ok: true, value: { ...r.value, qualifier: "UNTIL" } } : r;
    },
  ],
  [/^(\d{4})\s*-\s*(\d{4})$/, (m, raw) => rangeValue("BETWEEN", m[1], m[2], raw)],
  [/^(.+?)\s*[–—]\s*(.+)$/, (m, raw) => rangeValue("BETWEEN", m[1], m[2], raw)],
  [/^(.+?)\s+-\s+(.+)$/, (m, raw) => rangeValue("BETWEEN", m[1], m[2], raw)],
];

/**
 * Liest eine Datumsangabe in deutscher oder ISO-Schreibweise.
 *
 * Erkannt werden: `1850`, `03.1850`, `3/1850`, `12.03.1850`, `März 1850`,
 * `12. März 1850`, `12 MAR 1850`, ISO `1850-03`, `1850-03-12` sowie volle
 * ISO-Zeitstempel (Altbestand der API). Davor optional `um`/`ca.`/`circa`/
 * `~`, `vor`, `nach`, `geschätzt`, `errechnet` (auch GEDCOM `ABT`, `BEF`,
 * `AFT`, `EST`, `CAL`). Bereiche: `zwischen 1850 und 1855`, `1850–1855`,
 * `von 1901 bis 1910`, `ab 1901`, `seit 1901`, `bis 1910` (auch `BET … AND
 * …`, `FROM … TO …`). Leere Eingabe ergibt `null`.
 */
export function parseFuzzyDate(input: string | null | undefined): ParseResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, value: null };

  let rest = raw.replace(/\s+/g, " ");

  for (const [re, make] of RANGE_PATTERNS) {
    const m = rest.match(re);
    if (m) return make(m, raw);
  }

  let qualifier: DateQualifier = "EXACT";
  for (const [re, q] of QUALIFIER_PREFIXES) {
    const m = rest.match(re);
    if (m && m[0].length < rest.length) {
      qualifier = q;
      rest = rest.slice(m[0].length).trim();
      break;
    }
  }

  const core = parseCore(rest, raw);
  if (!core.ok) return core;
  return { ok: true, value: { ...core.value, qualifier } };
}

function unrecognized(raw: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `„${raw}“ ist kein erkennbares Datum (${DATE_INPUT_EXAMPLES}).`,
  };
}

/**
 * Wie parseFuzzyDate, aber Unlesbares wird nicht abgelehnt, sondern als
 * Wortlaut zurückgegeben — für Importe und KI-Eingaben, bei denen nichts
 * verloren gehen darf: „Weihnachten 1850“ → { value: null, phrase:
 * „Weihnachten 1850“ }.
 */
export function parseDateOrPhrase(
  input: string | null | undefined,
): { value: FuzzyDate | null; phrase: string | null } {
  const r = parseFuzzyDate(input);
  if (r.ok) return { value: r.value, phrase: null };
  const raw = (input ?? "").trim().slice(0, MAX_DATE_PHRASE_LENGTH);
  return { value: null, phrase: raw || null };
}

// ---------------------------------------------------------------------------
// Normalisieren
// ---------------------------------------------------------------------------

const isPrecision = (v: unknown): v is DatePrecision =>
  typeof v === "string" && (DATE_PRECISIONS as readonly string[]).includes(v);
const isQualifier = (v: unknown): v is DateQualifier =>
  typeof v === "string" && (DATE_QUALIFIERS as readonly string[]).includes(v);

function anchorOf(d: Date, p: DatePrecision): Date {
  const y = d.getUTCFullYear();
  return p === "YEAR" ? utc(y, 1, 1) : p === "MONTH" ? utc(y, d.getUTCMonth() + 1, 1) : utc(y, d.getUTCMonth() + 1, d.getUTCDate());
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Baut aus gespeicherten Feldern ein FuzzyDate. Fehlende oder unbekannte
 * Genauigkeit gilt als Tag, fehlender Zusatz als genau — so verhalten sich
 * alle Daten, die vor der Erweiterung erfasst wurden. Der Anker wird auf die
 * Genauigkeit gekürzt (UTC). Ein Bereichsende (`to`) wird nur bei BETWEEN
 * und PERIOD übernommen.
 */
export function toFuzzyDate(
  date: Date | string | null | undefined,
  precision?: string | null,
  qualifier?: string | null,
  to?: Date | string | null,
  toPrecision?: string | null,
): FuzzyDate | null {
  const d = toDate(date);
  if (!d) return null;
  const p = isPrecision(precision) ? precision : "DAY";
  const q = isQualifier(qualifier) ? qualifier : "EXACT";
  const result: FuzzyDate = { date: anchorOf(d, p), precision: p, qualifier: q };
  const end = isRangeQualifier(q) ? toDate(to) : null;
  if (end) {
    const tp = isPrecision(toPrecision) ? toPrecision : "DAY";
    result.to = { date: anchorOf(end, tp), precision: tp };
  }
  return result;
}

/** Akzeptiert ein FuzzyDate oder ein einfaches Date (= genau auf den Tag). */
export function asFuzzyDate(value: unknown): FuzzyDate | null {
  if (value instanceof Date) return toFuzzyDate(value);
  if (value && typeof value === "object" && "date" in value) {
    const v = value as { date: unknown; precision?: unknown; qualifier?: unknown; to?: unknown };
    if (v.date instanceof Date || typeof v.date === "string") {
      const to = v.to && typeof v.to === "object" ? (v.to as { date?: unknown; precision?: unknown }) : null;
      return toFuzzyDate(
        v.date,
        v.precision as string,
        v.qualifier as string,
        (to?.date as Date | string | undefined) ?? null,
        to?.precision as string | undefined,
      );
    }
  }
  return null;
}

export type FuzzyKey = "birthDate" | "deathDate" | "startDate" | "endDate" | "date";

/** Datumsfeld mit Genauigkeit eines Objekts lesen, z.B. fuzzyField(p, "birthDate"). */
export function fuzzyField(obj: object, key: FuzzyKey): FuzzyDate | null {
  const o = obj as Record<string, unknown>;
  return toFuzzyDate(
    o[key] as Date | string | null | undefined,
    o[`${key}Precision`] as string | null | undefined,
    o[`${key}Qualifier`] as string | null | undefined,
    o[`${key}To`] as Date | string | null | undefined,
    o[`${key}ToPrecision`] as string | null | undefined,
  );
}

/**
 * Spalten für Prisma: { birthDate, birthDatePrecision, birthDateQualifier,
 * birthDateTo, birthDateToPrecision }. Der Wortlaut (…Phrase) gehört nicht
 * dazu — er wird eigens gesetzt (siehe phraseAfterUpdate).
 */
export function fuzzyColumns<K extends string>(
  key: K,
  value: FuzzyDate | null,
): Record<K, Date | null> &
  Record<`${K}Precision`, DatePrecision> &
  Record<`${K}Qualifier`, DateQualifier> &
  Record<`${K}To`, Date | null> &
  Record<`${K}ToPrecision`, DatePrecision> {
  const to = value && isRangeQualifier(value.qualifier) ? (value.to ?? null) : null;
  return {
    [key]: value ? value.date : null,
    [`${key}Precision`]: value ? value.precision : "DAY",
    [`${key}Qualifier`]: value ? value.qualifier : "EXACT",
    [`${key}To`]: to ? to.date : null,
    [`${key}ToPrecision`]: to ? to.precision : "DAY",
  } as never;
}

/** Gleiche Angabe (Anker, Genauigkeit, Zusatz, Bereichsende)? */
export function sameFuzzyDate(a: FuzzyDate | null | undefined, b: FuzzyDate | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const ta = a.to ?? null;
  const tb = b.to ?? null;
  return (
    a.date.getTime() === b.date.getTime() &&
    a.precision === b.precision &&
    a.qualifier === b.qualifier &&
    (ta === null || tb === null
      ? ta === tb
      : ta.date.getTime() === tb.date.getTime() && ta.precision === tb.precision)
  );
}

/**
 * Wortlaut nach einer Änderung des Datums: Wer das Datum ändert, ohne einen
 * neuen Wortlaut mitzugeben, macht den alten ungültig — er wird gelöscht.
 * Bleibt das Datum gleich (Formular schickt es unverändert mit), bleibt er.
 */
export function phraseAfterUpdate(
  before: FuzzyDate | null,
  after: FuzzyDate | null | undefined,
  oldPhrase: string | null,
  newPhrase: string | null | undefined,
): string | null | undefined {
  if (newPhrase !== undefined) return newPhrase;
  if (after === undefined) return undefined;
  return sameFuzzyDate(before, after) ? undefined : oldPhrase === null ? undefined : null;
}

export const isPreciseDate = (f: FuzzyDate) => f.precision === "DAY" && f.qualifier === "EXACT";

/** Ist die Angabe in sich stimmig (BETWEEN mit Ende, Ende nicht vor Anfang)? */
export function fuzzyDateProblem(f: FuzzyDate): string | null {
  if (f.qualifier === "BETWEEN" && !f.to) return "„zwischen“ braucht ein Ende";
  if (f.to && periodEnd(f.to) <= f.date.getTime()) return "Das Ende des Zeitraums liegt vor dem Anfang";
  return null;
}

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

/** Kern ohne Zusatz: 12.03.1850 · März 1850 · 1850 */
function formatCore(f: DateEnd): string {
  const y = f.date.getUTCFullYear();
  const m = f.date.getUTCMonth() + 1;
  if (f.precision === "YEAR") return String(y);
  if (f.precision === "MONTH") return `${MONTH_NAMES[m - 1]} ${y}`;
  return `${pad(f.date.getUTCDate())}.${pad(m)}.${y}`;
}

/** Eingabekern: 12.03.1850 · 03.1850 · 1850 */
function inputCore(f: DateEnd): string {
  const y = f.date.getUTCFullYear();
  const m = f.date.getUTCMonth() + 1;
  return f.precision === "YEAR" ? String(y) : f.precision === "MONTH" ? `${pad(m)}.${y}` : `${pad(f.date.getUTCDate())}.${pad(m)}.${y}`;
}

function withQualifier(f: FuzzyDate, core: (e: DateEnd) => string): string {
  switch (f.qualifier) {
    case "BETWEEN":
      return `zwischen ${core(f)} und ${f.to ? core(f.to) : "?"}`;
    case "PERIOD":
      return f.to ? `von ${core(f)} bis ${core(f.to)}` : `ab ${core(f)}`;
    default:
      return QUALIFIER_PREFIX[f.qualifier] + core(f);
  }
}

/**
 * Anzeige: „12.03.1850“, „März 1850“, „um 1850“, „vor 1900“, „nach 1723“,
 * „geschätzt 1850“, „zwischen 1850 und 1855“, „von 1901 bis 1910“, „ab
 * 1901“, „bis 1910“.
 */
export function formatFuzzyDate(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  return withQualifier(f, formatCore);
}

/**
 * Anzeige samt Wortlaut: Datum, dahinter der Wortlaut in Klammern, wenn er
 * etwas anderes sagt; ohne Datum nur der Wortlaut.
 */
export function formatDateWithPhrase(f: FuzzyDate | null | undefined, phrase: string | null | undefined): string {
  const text = formatFuzzyDate(f);
  const p = phrase?.trim();
  if (!p) return text;
  if (!text) return p;
  return p === text ? text : `${text} („${p}“)`;
}

/** Kurzform mit Jahr für Lebensspannen: „1850“, „um 1850“, „vor 1900“, „zw. 1850 u. 1855“. */
export function formatFuzzyYear(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  // „vor 12.03.1850“ lässt sich nicht ehrlich auf ein Jahr kürzen.
  if ((f.qualifier === "BEFORE" || f.qualifier === "AFTER" || f.qualifier === "UNTIL") && f.precision !== "YEAR") {
    return formatFuzzyDate(f);
  }
  const y = f.date.getUTCFullYear();
  if (f.qualifier === "BETWEEN" || f.qualifier === "PERIOD") {
    if (!f.to) return f.qualifier === "PERIOD" ? `ab ${y}` : `zw. ${y} u. ?`;
    const y2 = f.to.date.getUTCFullYear();
    if (y2 === y) return String(y);
    return f.qualifier === "PERIOD" ? `${y}–${y2}` : `zw. ${y} u. ${y2}`;
  }
  return QUALIFIER_PREFIX[f.qualifier] + y;
}

/**
 * Eingabeform für Formularfelder: „12.03.1850“, „03.1850“, „1850“, mit
 * Zusatz „um 1850“, Bereiche „zwischen 1850 und 1855“, „von 1901 bis 1910“.
 * parseFuzzyDate(toDateInput(x)) ergibt wieder x.
 */
export function toDateInput(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  return withQualifier(f, inputCore);
}

/** ISO in der tatsächlichen Genauigkeit: „1850“, „1850-03“, „1850-03-12“. */
export function toIsoPartial(f: DateEnd | null | undefined): string | null {
  if (!f) return null;
  const y = pad(f.date.getUTCFullYear(), 4);
  if (f.precision === "YEAR") return y;
  const m = pad(f.date.getUTCMonth() + 1);
  if (f.precision === "MONTH") return `${y}-${m}`;
  return `${y}-${m}-${pad(f.date.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Vergleich
// ---------------------------------------------------------------------------

/** Zeitraum [start, end) in Millisekunden; offene Seiten sind ±Infinity. */
export type DateBounds = { start: number; end: number };

/**
 * Zeitraum, den eine Angabe abdeckt. `tolerant` (Standard) erweitert „um“,
 * „geschätzt“ und „errechnet“ um ABOUT_TOLERANCE_YEARS in beide Richtungen;
 * ohne bleibt es beim Zeitraum der Genauigkeit (für „liegt in der Zukunft“).
 * Bereiche reichen vom Anfang des ersten bis zum Ende des zweiten Datums; ein
 * Bereich ohne Ende ist nach hinten offen.
 */
export function dateBounds(f: FuzzyDate, options: { tolerant?: boolean } = {}): DateBounds {
  const tolerant = options.tolerant ?? true;
  const start = f.date.getTime();
  const end = periodEnd(f);

  switch (f.qualifier) {
    case "ABOUT":
    case "ESTIMATED":
    case "CALCULATED":
      return tolerant
        ? { start: start - ABOUT_TOLERANCE_YEARS * YEAR_MS, end: end + ABOUT_TOLERANCE_YEARS * YEAR_MS }
        : { start, end };
    case "BEFORE":
      return { start: -Infinity, end: start };
    case "AFTER":
      return { start: end, end: Infinity };
    case "BETWEEN":
    case "PERIOD":
      return { start, end: f.to ? periodEnd(f.to) : Infinity };
    case "UNTIL":
      return { start: -Infinity, end };
    default:
      return { start, end };
  }
}

/** Liegt `a` sicher vor `b` (für jede mögliche Lesart beider Angaben)? */
export function certainlyBefore(a: FuzzyDate, b: FuzzyDate): boolean {
  return dateBounds(a).end <= dateBounds(b).start;
}

/**
 * Zeitspanne in Jahren von `from` bis `to` als Bereich. Sind beide Angaben
 * tagesgenau, ist min = max (exakt wie bisher). Offene Angaben (vor/nach)
 * ergeben ±Infinity auf der jeweiligen Seite.
 */
export function yearsBetween(
  from: FuzzyDate,
  to: FuzzyDate | Date,
): { min: number; max: number; exact: boolean } {
  const target = to instanceof Date ? { date: to, precision: "DAY" as const, qualifier: "EXACT" as const } : to;
  if (isPreciseDate(from) && isPreciseDate(target)) {
    const y = (target.date.getTime() - from.date.getTime()) / YEAR_MS;
    return { min: y, max: y, exact: true };
  }
  const a = dateBounds(from);
  const b = to instanceof Date ? { start: to.getTime(), end: to.getTime() } : dateBounds(target);
  return {
    min: (b.start - a.end) / YEAR_MS,
    max: (b.end - a.start) / YEAR_MS,
    exact: false,
  };
}

/** Kleinster möglicher Abstand zweier Angaben in Jahren (0 bei Überlappung). */
export function minYearDistance(a: FuzzyDate, b: FuzzyDate): number {
  const x = dateBounds(a);
  const y = dateBounds(b);
  if (x.end <= y.start) return (y.start - x.end) / YEAR_MS;
  if (y.end <= x.start) return (x.start - y.end) / YEAR_MS;
  return 0;
}
