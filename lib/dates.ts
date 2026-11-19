/**
 * Ungenaue Daten — Eingabe, Anzeige und Vergleich. Reine Funktionen ohne
 * Datenbank und ohne Abhängigkeiten, damit Formulare (Browser), Dienste,
 * MCP-Server und Tests dieselben Regeln verwenden.
 *
 * Modell: Ein Datum besteht aus
 * - `date`: Ankerpunkt (UTC-Mitternacht) — bei Genauigkeit MONTH der
 *   Monatserste, bei YEAR der 1. Januar. Er ist sortierbar und steht in der
 *   bisherigen DateTime-Spalte.
 * - `precision`: DAY | MONTH | YEAR — wie viel davon bekannt ist.
 * - `qualifier`: EXACT | ABOUT (um, ca.) | BEFORE (vor) | AFTER (nach).
 *
 * Vergleiche (Plausibilität, Alter) arbeiten mit dem Zeitraum, den eine
 * Angabe abdeckt (`dateBounds`): „1850“ ist das ganze Jahr, „um 1850“ ein
 * paar Jahre mehr, „vor 1900“ alles bis Ende 1899. Gemeldet wird ein
 * Widerspruch nur, wenn er für jede mögliche Lesart besteht.
 */

export type DatePrecision = "DAY" | "MONTH" | "YEAR";
export type DateQualifier = "EXACT" | "ABOUT" | "BEFORE" | "AFTER";

export const DATE_PRECISIONS: readonly DatePrecision[] = ["DAY", "MONTH", "YEAR"];
export const DATE_QUALIFIERS: readonly DateQualifier[] = ["EXACT", "ABOUT", "BEFORE", "AFTER"];

export type FuzzyDate = {
  date: Date;
  precision: DatePrecision;
  qualifier: DateQualifier;
};

/** Spielraum für „um“: so viele Jahre in beide Richtungen. */
export const ABOUT_TOLERANCE_YEARS = 2;

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

/** Monatsnamen und gängige Abkürzungen (ohne Punkt, kleingeschrieben). */
const MONTH_LOOKUP: Record<string, number> = {
  januar: 1, jan: 1, jänner: 1, jaenner: 1,
  februar: 2, feb: 2, febr: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3, marz: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12,
};

const QUALIFIER_PREFIXES: [RegExp, DateQualifier][] = [
  // „um“, „ca.“, „circa“, „etwa“, „~“; GEDCOM-Kürzel ABT/EST für KI-Eingaben.
  [/^(?:um|ca\.?|circa|zirka|etwa|ungefähr|ungef\.|~|abt\.?|about|est\.?)\s*/i, "ABOUT"],
  [/^(?:vor|bef\.?|before|<)\s*/i, "BEFORE"],
  [/^(?:nach|aft\.?|after|>)\s*/i, "AFTER"],
];

const QUALIFIER_PREFIX: Record<DateQualifier, string> = {
  EXACT: "",
  ABOUT: "um ",
  BEFORE: "vor ",
  AFTER: "nach ",
};

export const QUALIFIER_LABEL: Record<DateQualifier, string> = {
  EXACT: "genau",
  ABOUT: "um (ungefähr)",
  BEFORE: "vor",
  AFTER: "nach",
};

export const PRECISION_LABEL: Record<DatePrecision, string> = {
  DAY: "Tag",
  MONTH: "Monat",
  YEAR: "Jahr",
};

export const DATE_INPUT_EXAMPLES = "z.B. 1850, 03.1850, 12.03.1850, um 1850, vor 1900, nach 1723";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type ParseResult =
  | { ok: true; value: FuzzyDate | null }
  | { ok: false; error: string };

function build(
  y: number,
  m: number | null,
  d: number | null,
  qualifier: DateQualifier,
  raw: string,
): ParseResult {
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
  return {
    ok: true,
    value: { date: utc(y, m ?? 1, d ?? 1), precision, qualifier },
  };
}

/**
 * Liest eine Datumsangabe in deutscher oder ISO-Schreibweise.
 *
 * Erkannt werden: `1850`, `03.1850`, `3/1850`, `12.03.1850`, `März 1850`,
 * `12. März 1850`, ISO `1850-03`, `1850-03-12` sowie volle ISO-Zeitstempel
 * (Altbestand der API). Davor optional `um`/`ca.`/`circa`/`~`, `vor`, `nach`
 * (auch GEDCOM `ABT`, `BEF`, `AFT`). Leere Eingabe ergibt `null`.
 */
export function parseFuzzyDate(input: string | null | undefined): ParseResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, value: null };

  let rest = raw.replace(/\s+/g, " ");
  let qualifier: DateQualifier = "EXACT";
  for (const [re, q] of QUALIFIER_PREFIXES) {
    const m = rest.match(re);
    if (m && m[0].length < rest.length) {
      qualifier = q;
      rest = rest.slice(m[0].length).trim();
      break;
    }
  }

  let m: RegExpMatchArray | null;

  // Voller ISO-Zeitstempel (z.B. aus einem älteren Export): Tag in UTC.
  if ((m = rest.match(/^(\d{4})-(\d{2})-(\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/))) {
    const parsed = new Date(rest);
    if (Number.isNaN(parsed.getTime())) return unrecognized(raw);
    return build(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(), qualifier, raw);
  }
  if ((m = rest.match(/^(\d{4})$/))) return build(+m[1], null, null, qualifier, raw);
  if ((m = rest.match(/^(\d{4})-(\d{1,2})$/))) return build(+m[1], +m[2], null, qualifier, raw);
  if ((m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return build(+m[1], +m[2], +m[3], qualifier, raw);
  if ((m = rest.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/))) return build(+m[3], +m[2], +m[1], qualifier, raw);
  if ((m = rest.match(/^(\d{1,2})[./](\d{4})$/))) return build(+m[2], +m[1], null, qualifier, raw);
  if ((m = rest.match(/^(?:(\d{1,2})\.?\s+)?([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})$/))) {
    const month = MONTH_LOOKUP[m[2].toLowerCase()];
    if (!month) return unrecognized(raw);
    return build(+m[3], month, m[1] ? +m[1] : null, qualifier, raw);
  }
  return unrecognized(raw);
}

function unrecognized(raw: string): ParseResult {
  return {
    ok: false,
    error: `„${raw}“ ist kein erkennbares Datum (${DATE_INPUT_EXAMPLES}).`,
  };
}

// ---------------------------------------------------------------------------
// Normalisieren
// ---------------------------------------------------------------------------

const isPrecision = (v: unknown): v is DatePrecision =>
  typeof v === "string" && (DATE_PRECISIONS as readonly string[]).includes(v);
const isQualifier = (v: unknown): v is DateQualifier =>
  typeof v === "string" && (DATE_QUALIFIERS as readonly string[]).includes(v);

/**
 * Baut aus gespeicherten Feldern ein FuzzyDate. Fehlende oder unbekannte
 * Genauigkeit gilt als Tag, fehlender Zusatz als genau — so verhalten sich
 * alle Daten, die vor der Erweiterung erfasst wurden. Der Anker wird auf die
 * Genauigkeit gekürzt (UTC).
 */
export function toFuzzyDate(
  date: Date | string | null | undefined,
  precision?: string | null,
  qualifier?: string | null,
): FuzzyDate | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const p = isPrecision(precision) ? precision : "DAY";
  const q = isQualifier(qualifier) ? qualifier : "EXACT";
  const y = d.getUTCFullYear();
  const anchor =
    p === "YEAR" ? utc(y, 1, 1) : p === "MONTH" ? utc(y, d.getUTCMonth() + 1, 1) : utc(y, d.getUTCMonth() + 1, d.getUTCDate());
  return { date: anchor, precision: p, qualifier: q };
}

/** Akzeptiert ein FuzzyDate oder ein einfaches Date (= genau auf den Tag). */
export function asFuzzyDate(value: unknown): FuzzyDate | null {
  if (value instanceof Date) return toFuzzyDate(value);
  if (value && typeof value === "object" && "date" in value) {
    const v = value as { date: unknown; precision?: unknown; qualifier?: unknown };
    if (v.date instanceof Date || typeof v.date === "string") {
      return toFuzzyDate(v.date, v.precision as string, v.qualifier as string);
    }
  }
  return null;
}

/** Datumsfeld mit Genauigkeit eines Objekts lesen, z.B. fuzzyField(p, "birthDate"). */
export function fuzzyField(
  obj: object,
  key: "birthDate" | "deathDate" | "startDate" | "endDate" | "date",
): FuzzyDate | null {
  const o = obj as Record<string, unknown>;
  return toFuzzyDate(
    o[key] as Date | string | null | undefined,
    o[`${key}Precision`] as string | null | undefined,
    o[`${key}Qualifier`] as string | null | undefined,
  );
}

/** Spalten für Prisma: { birthDate, birthDatePrecision, birthDateQualifier }. */
export function fuzzyColumns<K extends string>(
  key: K,
  value: FuzzyDate | null,
): Record<K, Date | null> & Record<`${K}Precision`, DatePrecision> & Record<`${K}Qualifier`, DateQualifier> {
  return {
    [key]: value ? value.date : null,
    [`${key}Precision`]: value ? value.precision : "DAY",
    [`${key}Qualifier`]: value ? value.qualifier : "EXACT",
  } as never;
}

export const isPreciseDate = (f: FuzzyDate) => f.precision === "DAY" && f.qualifier === "EXACT";

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

/** Kern ohne Zusatz: 12.03.1850 · März 1850 · 1850 */
function formatCore(f: FuzzyDate): string {
  const y = f.date.getUTCFullYear();
  const m = f.date.getUTCMonth() + 1;
  if (f.precision === "YEAR") return String(y);
  if (f.precision === "MONTH") return `${MONTH_NAMES[m - 1]} ${y}`;
  return `${pad(f.date.getUTCDate())}.${pad(m)}.${y}`;
}

/** Anzeige: „12.03.1850“, „März 1850“, „um 1850“, „vor 1900“, „nach 1723“. */
export function formatFuzzyDate(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  return QUALIFIER_PREFIX[f.qualifier] + formatCore(f);
}

/** Kurzform mit Jahr für Lebensspannen: „1850“, „um 1850“, „vor 1900“. */
export function formatFuzzyYear(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  // „vor 12.03.1850“ lässt sich nicht ehrlich auf ein Jahr kürzen.
  if ((f.qualifier === "BEFORE" || f.qualifier === "AFTER") && f.precision !== "YEAR") {
    return formatFuzzyDate(f);
  }
  return QUALIFIER_PREFIX[f.qualifier] + f.date.getUTCFullYear();
}

/**
 * Eingabeform für Formularfelder: „12.03.1850“, „03.1850“, „1850“, mit
 * Zusatz „um 1850“. parseFuzzyDate(toDateInput(x)) ergibt wieder x.
 */
export function toDateInput(f: FuzzyDate | null | undefined): string {
  if (!f) return "";
  const y = f.date.getUTCFullYear();
  const m = f.date.getUTCMonth() + 1;
  const core =
    f.precision === "YEAR"
      ? String(y)
      : f.precision === "MONTH"
        ? `${pad(m)}.${y}`
        : `${pad(f.date.getUTCDate())}.${pad(m)}.${y}`;
  return QUALIFIER_PREFIX[f.qualifier] + core;
}

/** ISO in der tatsächlichen Genauigkeit: „1850“, „1850-03“, „1850-03-12“. */
export function toIsoPartial(f: FuzzyDate | null | undefined): string | null {
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
 * Zeitraum, den eine Angabe abdeckt. `tolerant` (Standard) erweitert „um“
 * um ABOUT_TOLERANCE_YEARS in beide Richtungen; ohne bleibt es beim
 * Zeitraum der Genauigkeit (für „liegt in der Zukunft“).
 */
export function dateBounds(f: FuzzyDate, options: { tolerant?: boolean } = {}): DateBounds {
  const tolerant = options.tolerant ?? true;
  const y = f.date.getUTCFullYear();
  const m = f.date.getUTCMonth();
  const start = f.date.getTime();
  const end =
    f.precision === "YEAR"
      ? Date.UTC(y + 1, 0, 1)
      : f.precision === "MONTH"
        ? Date.UTC(y, m + 1, 1)
        : start + DAY_MS;

  switch (f.qualifier) {
    case "ABOUT":
      return tolerant
        ? { start: start - ABOUT_TOLERANCE_YEARS * YEAR_MS, end: end + ABOUT_TOLERANCE_YEARS * YEAR_MS }
        : { start, end };
    case "BEFORE":
      return { start: -Infinity, end: start };
    case "AFTER":
      return { start: end, end: Infinity };
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
