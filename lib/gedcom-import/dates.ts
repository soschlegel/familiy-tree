/**
 * GEDCOM-Datum → Datumsform des Massenimports (BulkDate, siehe
 * lib/services/import-apply.ts). Rein, ohne Datenbank.
 *
 * - Alle App-Zusätze werden genutzt: um, vor, nach, geschätzt, errechnet,
 *   zwischen … und …, von … bis …, ab, bis.
 * - Was die strukturierte Form nicht vollständig sagt (anderer Kalender,
 *   Doppeljahr, INT-Erläuterung, reine Phrase, ungültige Angabe, v. Chr.),
 *   behält den Originaltext als Wortlaut (`phrase`).
 * - Was die App ablehnen würde (Jahr vor 1000, Zukunft, Ende vor Anfang),
 *   wird nicht strukturiert übernommen, sondern nur als Wortlaut — sonst fiele
 *   die ganze Person bzw. Beziehung als ungültig heraus.
 */
import { MAX_DATE_PHRASE_LENGTH, toFuzzyDate, type DatePrecision, type DateQualifier, type FuzzyDate } from "../dates";
import { eventDateIssues, personDateIssues, type RuleIssue } from "../validation";
import type { GedcomDate, GedcomDatePoint } from "../gedcom/types";

export type BulkDateValue = {
  date?: string | null;
  precision?: DatePrecision;
  qualifier?: DateQualifier;
  to?: string | null;
  toPrecision?: DatePrecision;
  phrase?: string | null;
};

export type DateConversion = {
  value: BulkDateValue | null;
  /** Die App-Form sagt weniger als das Original (Original steht in `phrase`). */
  lossy: boolean;
  /** Datum war nicht plausibel und steht nur als Wortlaut da. */
  rejected?: string;
};

type Simple = { year: number; month?: number; day?: number };

function simple(p: GedcomDatePoint | undefined): { s: Simple | null; lossy: boolean } {
  if (!p || p.bc || p.year === undefined) return { s: null, lossy: true };
  if (p.calendar !== "GREGORIAN") {
    if (!p.gregorian) return { s: null, lossy: true };
    return { s: { ...p.gregorian }, lossy: true };
  }
  const s: Simple = { year: p.dualYear ?? p.year };
  if (p.month !== undefined) s.month = p.month;
  if (p.day !== undefined && p.month !== undefined) s.day = p.day;
  return { s, lossy: p.dualYear !== undefined };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
function iso(s: Simple): { date: string; precision: DatePrecision } {
  if (s.day !== undefined && s.month !== undefined) return { date: `${pad(s.year, 4)}-${pad(s.month, 2)}-${pad(s.day, 2)}`, precision: "DAY" };
  if (s.month !== undefined) return { date: `${pad(s.year, 4)}-${pad(s.month, 2)}`, precision: "MONTH" };
  return { date: pad(s.year, 4), precision: "YEAR" };
}

function phraseOf(d: GedcomDate): string | null {
  const t = (d.original || d.phrase || "").trim();
  if (!t) return null;
  return t.length > MAX_DATE_PHRASE_LENGTH ? t.slice(0, MAX_DATE_PHRASE_LENGTH) : t;
}

/** Struktur ohne Plausibilitätsprüfung. */
export function convertGedcomDate(d: GedcomDate | undefined | null): DateConversion {
  if (!d) return { value: null, lossy: false };
  const onlyPhrase = (): DateConversion => {
    const phrase = phraseOf(d);
    return { value: phrase ? { phrase } : null, lossy: true };
  };
  if (d.kind === "PHRASE" || d.kind === "INVALID") return onlyPhrase();
  const a = simple(d.start);
  if (!a.s) return onlyPhrase();
  const start = iso(a.s);
  let lossy = a.lossy;
  let value: BulkDateValue;
  const one = (qualifier: DateQualifier): BulkDateValue => ({ date: start.date, precision: start.precision, qualifier });
  switch (d.kind) {
    case "EXACT":
      value = one("EXACT");
      break;
    case "INTERPRETED":
      value = one("EXACT");
      lossy = true;
      break;
    case "ABOUT":
      value = one("ABOUT");
      break;
    case "CALCULATED":
      value = one("CALCULATED");
      break;
    case "ESTIMATED":
      value = one("ESTIMATED");
      break;
    case "BEFORE":
      value = one("BEFORE");
      break;
    case "AFTER":
      value = one("AFTER");
      break;
    case "FROM":
      value = one("PERIOD");
      break;
    case "TO":
      value = one("UNTIL");
      break;
    case "BETWEEN":
    case "FROM_TO": {
      const b = simple(d.end);
      if (!b.s) {
        value = one(d.kind === "BETWEEN" ? "AFTER" : "PERIOD");
        lossy = true;
        break;
      }
      const end = iso(b.s);
      lossy = lossy || b.lossy;
      value = { ...one(d.kind === "BETWEEN" ? "BETWEEN" : "PERIOD"), to: end.date, toPrecision: end.precision };
      break;
    }
    default:
      return onlyPhrase();
  }
  if (lossy) value.phrase = phraseOf(d);
  return { value, lossy };
}

/** BulkDate → FuzzyDate (wie der Massenimport es auflöst). */
export function bulkToFuzzy(v: BulkDateValue | null | undefined): FuzzyDate | null {
  if (!v?.date) return null;
  const anchor = (s: string) => {
    const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    return m ? `${m[1]}-${(m[2] ?? "1").padStart(2, "0")}-${(m[3] ?? "1").padStart(2, "0")}T00:00:00.000Z` : s;
  };
  return toFuzzyDate(anchor(v.date), v.precision, v.qualifier, v.to ? anchor(v.to) : null, v.toPrecision);
}

function downgrade(d: GedcomDate, c: DateConversion, issue: RuleIssue): DateConversion {
  const phrase = phraseOf(d);
  return { value: phrase ? { phrase } : null, lossy: true, rejected: issue.message };
}

/** Ereignis-/Beziehungsdatum: Struktur nur, wenn die App es annimmt. */
export function convertEventDate(d: GedcomDate | undefined | null, now = new Date()): DateConversion {
  const c = convertGedcomDate(d);
  if (!d || !c.value?.date) return c;
  const f = bulkToFuzzy(c.value);
  if (!f) return downgrade(d, c, { path: "date", message: "Datum ist ungültig" });
  const issue = eventDateIssues({ date: f }, now)[0];
  return issue ? downgrade(d, c, issue) : c;
}

/** Geburt und Tod gemeinsam (Tod vor Geburt → Tod nur als Wortlaut). */
export function convertLifeDates(
  birth: GedcomDate | undefined,
  death: GedcomDate | undefined,
  now = new Date(),
): { birth: DateConversion; death: DateConversion } {
  let b = convertGedcomDate(birth);
  let d = convertGedcomDate(death);
  const check = () =>
    personDateIssues({ birthDate: bulkToFuzzy(b.value), deathDate: bulkToFuzzy(d.value) }, now);
  for (let i = 0; i < 3; i++) {
    const issues = check();
    if (issues.length === 0) break;
    const birthIssue = issues.find((x) => x.path === "birthDate");
    if (birthIssue && birth) {
      b = downgrade(birth, b, birthIssue);
      continue;
    }
    const deathIssue = issues.find((x) => x.path === "deathDate");
    if (deathIssue && death) d = downgrade(death, d, deathIssue);
    else break;
  }
  return { birth: b, death: d };
}
