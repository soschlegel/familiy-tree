/**
 * Startseite „Heute in der Familie“: Jahrestage eines Tages und der folgenden
 * Wochen. Reine Funktionen ohne Datenbank — Laden und Rechte macht
 * lib/services/today.ts. Fachliche Regeln: docs/komponenten/bibliotheken.md
 * („lib/today.ts“).
 *
 * Grundsätze:
 * - Es zählen nur tagesgenaue, sichere Daten (Genauigkeit Tag, Zusatz
 *   „genau“ — isPreciseDate aus lib/dates.ts); „um“, „vor“, „nach“,
 *   Zeiträume, geschätzte und errechnete Angaben fallen heraus, ebenso
 *   Zweitangaben (isAlternative).
 * - Der Tag ist ein Kalendertag (Jahr, Monat, Tag) — welcher Tag „heute“
 *   ist, bestimmt calendarDayIn nach Europe/Berlin, nicht nach UTC.
 * - Ein 29. Februar wird in Nicht-Schaltjahren am 28. Februar begangen.
 * - Lebend ist, wer weder Sterbedatum noch Sterbeangabe (Ort, Wortlaut) hat
 *   und laut Geburtsdatum nicht über PRESUMED_LIFESPAN Jahre alt wäre — wie
 *   auf der Seite „Statistik“ (lib/statistics.ts).
 * - Nur Personen mit `visible` zählen (der Dienst reicht ohnehin nur
 *   sichtbare herein); eine Partnerschaft nur, wenn beide Partner sichtbar
 *   sind.
 */
import { PRESUMED_LIFESPAN } from "./consistency";
import { dateBounds, isPreciseDate, MONTH_NAMES, type FuzzyDate } from "./dates";

/** Zeitzone, nach der „heute“ gilt. */
export const TODAY_TIME_ZONE = "Europe/Berlin";
/** „Demnächst“: so viele Tage nach dem gewählten Tag. */
export const UPCOMING_DAYS = 30;
/** So viele Einträge je Abschnitt, der Rest hinter „weitere anzeigen“. */
export const SECTION_LIMIT = 10;
/** Runde Jahrestage: Vielfache davon (25, 50, 75, 100 …). */
export const ROUND_ANNIVERSARY = 25;
/** Runde Geburtstage Lebender: Vielfache davon (10, 20, 30 …). */
export const ROUND_BIRTHDAY = 10;
/** So weit sucht „der nächste Jahrestag“ voraus (ein volles Jahr). */
export const NEXT_SEARCH_DAYS = 366;

/**
 * Lebensereignisse, deren Jahrestag die Startseite nennt — Ereignisse an
 * einem Tag. Dauerzustände (Beruf, Wohnort, Religion …) und Folgen des Todes
 * (Beerdigung — der Todestag steht schon da) zählen nicht.
 */
export const ANNIVERSARY_EVENT_TYPES = [
  "BAPTISM",
  "CHRISTENING",
  "ADULT_CHRISTENING",
  "CONFIRMATION",
  "FIRST_COMMUNION",
  "BAR_MITZVAH",
  "BAS_MITZVAH",
  "BLESSING",
  "ORDINATION",
  "GRADUATION",
  "RETIREMENT",
  "EMIGRATION",
  "IMMIGRATION",
  "NATURALIZATION",
  "ADOPTION",
  "CUSTOM",
] as const;

/** Partnerschaften, deren Beginn als Jahrestag zählt (geschiedene Ehen nicht). */
export const ANNIVERSARY_PARTNER_SUBTYPES = ["MARRIED", "UNMARRIED", "PARTNER_UNKNOWN"] as const;

// ---------------------------------------------------------------------------
// Kalendertage
// ---------------------------------------------------------------------------

/** Kalendertag; month 1–12. */
export type CalendarDay = { year: number; month: number; day: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (d: CalendarDay) => Math.round(Date.UTC(d.year, d.month - 1, d.day) / DAY_MS);

function fromDayNumber(n: number): CalendarDay {
  const date = new Date(n * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export const addDays = (d: CalendarDay, days: number): CalendarDay => fromDayNumber(dayNumber(d) + days);

export const daysBetween = (from: CalendarDay, to: CalendarDay): number => dayNumber(to) - dayNumber(from);

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Kalendertag eines Zeitpunkts in einer Zeitzone (Standard Europe/Berlin). */
export function calendarDayIn(now: Date, timeZone: string = TODAY_TIME_ZONE): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** „2026-03-14“. */
export function formatIsoDay(d: CalendarDay): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** „2026-03-14“ lesen; null bei allem anderen (auch 2026-02-30 und Jahren vor 1000). */
export function parseIsoDay(text: string | null | undefined): CalendarDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text?.trim() ?? "");
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (d.year < 1000 || d.month < 1 || d.month > 12 || d.day < 1) return null;
  const back = fromDayNumber(dayNumber(d));
  return back.month === d.month && back.day === d.day ? d : null;
}

/** Tag, an dem ein Jahrestag (Monat/Tag) im Jahr `year` begangen wird: 29.2. → 28.2. außer im Schaltjahr. */
export function observedDay(month: number, day: number, year: number): CalendarDay {
  if (month === 2 && day === 29 && !isLeapYear(year)) return { year, month: 2, day: 28 };
  return { year, month, day };
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** „14. März“. */
export const formatDayMonth = (d: CalendarDay) => `${d.day}. ${MONTH_NAMES[d.month - 1]}`;

/** „Samstag, 14. März 2026“. */
export function formatLongDay(d: CalendarDay): string {
  const weekday = WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  return `${weekday}, ${formatDayMonth(d)} ${d.year}`;
}

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

export type TodayPerson = {
  id: string;
  /** Anzeigename („Anna Beispiel“). */
  name: string;
  visible: boolean;
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
  /** Sterbeangabe ohne Datum (Ort, Wortlaut) — die Person ist verstorben. */
  deathWithoutDate: boolean;
};

export type TodayPartnership = {
  id: string;
  subtype: string;
  partners: [string, string];
  start: FuzzyDate | null;
};

export type TodayEvent = {
  id: string;
  personId: string;
  type: string;
  /** Bezeichnung der Art („Taufe“, bei CUSTOM die eigene). */
  title: string;
  isAlternative: boolean;
  date: FuzzyDate | null;
};

export type TodayInput = {
  /** Der Tag, für den ausgewertet wird („heute“ oder per Adresse gewählt). */
  day: CalendarDay;
  /** Der wirkliche heutige Tag — für „heute“/„morgen“ in den Sätzen. */
  realToday?: CalendarDay;
  persons: readonly TodayPerson[];
  partnerships: readonly TodayPartnership[];
  events: readonly TodayEvent[];
};

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

export type AnniversaryKind = "birth" | "death" | "marriage" | "partnership" | "event";

export type AnniversaryPerson = { id: string; name: string; living: boolean };

export type Anniversary = {
  /** Eindeutig je Eintrag (für React-Schlüssel). */
  key: string;
  kind: AnniversaryKind;
  /** Eine Person; bei Hochzeit und Partnerschaft beide Partner. */
  persons: AnniversaryPerson[];
  /** Nur bei „event“: Art und Bezeichnung. */
  eventType?: string;
  eventTitle?: string;
  /** Jahre seit dem Ereignis (bei Lebenden: das Alter, das sie erreichen). */
  years: number;
  /** Runder Jahrestag bzw. runder Geburtstag. */
  round: boolean;
  /** Geburtstag einer lebenden Person. */
  birthday: boolean;
  /** Name des Hochzeitsjubiläums, wenn beide Partner leben („Goldene Hochzeit“). */
  jubilee: string | null;
  /** Tag, an dem der Jahrestag begangen wird. */
  on: CalendarDay;
  /** Tage ab dem gewählten Tag (0 = an diesem Tag). */
  daysAway: number;
};

export type TodayResult = {
  day: CalendarDay;
  /** Ist der gewählte Tag der wirkliche heutige Tag? */
  isRealToday: boolean;
  /** Alle Jahrestage des gewählten Tages, sortiert. */
  today: Anniversary[];
  /** Geburtstage Lebender in den nächsten UPCOMING_DAYS Tagen. */
  birthdays: Anniversary[];
  /** Runde Jahrestage (Geburt Verstorbener, Tod, Hochzeit) in den nächsten UPCOMING_DAYS Tagen. */
  upcoming: Anniversary[];
  /** Nur wenn `today` leer ist: der nächste Jahrestag überhaupt (bis ein Jahr voraus). */
  next: Anniversary | null;
};

/** Namen der Hochzeitsjubiläen (nur für lebende Paare genannt). */
const JUBILEES: Record<number, string> = {
  25: "Silberne Hochzeit",
  50: "Goldene Hochzeit",
  60: "Diamantene Hochzeit",
  65: "Eiserne Hochzeit",
  70: "Gnadenhochzeit",
  75: "Kronjuwelenhochzeit",
};

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

/** Tagesgenaues, sicheres Datum als Kalendertag; sonst null. */
export function preciseDay(f: FuzzyDate | null | undefined): CalendarDay | null {
  if (!f || !isPreciseDate(f) || f.to) return null;
  return { year: f.date.getUTCFullYear(), month: f.date.getUTCMonth() + 1, day: f.date.getUTCDate() };
}

/**
 * Lebt die Person am Tag `day`? Nein bei Sterbedatum oder Sterbeangabe und
 * wenn sie laut Geburtsdatum über PRESUMED_LIFESPAN Jahre alt wäre (bei
 * ungenauem Geburtsdatum zählt der späteste mögliche Zeitpunkt).
 */
export function isLiving(p: Pick<TodayPerson, "birth" | "death" | "deathWithoutDate">, day: CalendarDay): boolean {
  if (p.death || p.deathWithoutDate) return false;
  if (!p.birth) return true;
  const latest = dateBounds(p.birth).end;
  if (!Number.isFinite(latest)) return true;
  return day.year - new Date(latest - 1).getUTCFullYear() <= PRESUMED_LIFESPAN;
}

/** Nächstes Begehen (am Tag `from` oder danach) eines Ereignisses vom Tag `origin`. */
function nextOccurrence(origin: CalendarDay, from: CalendarDay): { on: CalendarDay; years: number; daysAway: number } {
  let on = observedDay(origin.month, origin.day, from.year);
  if (daysBetween(from, on) < 0) on = observedDay(origin.month, origin.day, from.year + 1);
  return { on, years: on.year - origin.year, daysAway: daysBetween(from, on) };
}

const KIND_ORDER: Record<AnniversaryKind, number> = { birth: 0, marriage: 1, partnership: 2, death: 3, event: 4 };

const firstName = (a: Anniversary) => a.persons[0]?.name ?? "";

/** Reihenfolge „heute“: runde zuerst, dann jüngere Jahrestage, dann Art und Name. */
function compareToday(a: Anniversary, b: Anniversary): number {
  return (
    Number(b.round) - Number(a.round) ||
    a.years - b.years ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    firstName(a).localeCompare(firstName(b), "de") ||
    a.key.localeCompare(b.key)
  );
}

/** Reihenfolge „demnächst“: nach Datum, am selben Tag wie „heute“. */
function compareUpcoming(a: Anniversary, b: Anniversary): number {
  return a.daysAway - b.daysAway || compareToday(a, b);
}

/** Alle Jahrestage, je mit ihrem nächsten Begehen ab dem gewählten Tag. */
function collect(input: TodayInput): Anniversary[] {
  const { day } = input;
  const out: Anniversary[] = [];
  const persons = new Map<string, TodayPerson>();
  for (const p of input.persons) if (p.visible) persons.set(p.id, p);
  const living = new Map<string, boolean>();
  const livingOf = (p: TodayPerson) => {
    let v = living.get(p.id);
    if (v === undefined) living.set(p.id, (v = isLiving(p, day)));
    return v;
  };
  const who = (p: TodayPerson): AnniversaryPerson => ({ id: p.id, name: p.name, living: livingOf(p) });

  const push = (origin: CalendarDay, a: Omit<Anniversary, "on" | "years" | "daysAway" | "round" | "jubilee">) => {
    const occ = nextOccurrence(origin, day);
    // Erst ab dem ersten Jahrestag (kein „vor 0 Jahren“, nichts aus der Zukunft).
    if (occ.years < 1) return;
    let jubilee: string | null = null;
    if (a.kind === "marriage" && a.persons.every((p) => p.living)) jubilee = JUBILEES[occ.years] ?? null;
    const round = a.birthday ? occ.years % ROUND_BIRTHDAY === 0 : occ.years % ROUND_ANNIVERSARY === 0 || jubilee !== null;
    out.push({ ...a, ...occ, round, jubilee });
  };

  for (const p of persons.values()) {
    const birth = preciseDay(p.birth);
    if (birth) {
      const alive = livingOf(p);
      push(birth, { key: `birth:${p.id}`, kind: "birth", persons: [who(p)], birthday: alive });
    }
    const death = preciseDay(p.death);
    if (death) push(death, { key: `death:${p.id}`, kind: "death", persons: [who(p)], birthday: false });
  }

  for (const r of input.partnerships) {
    if (!(ANNIVERSARY_PARTNER_SUBTYPES as readonly string[]).includes(r.subtype)) continue;
    const start = preciseDay(r.start);
    if (!start) continue;
    const a = persons.get(r.partners[0]);
    const b = persons.get(r.partners[1]);
    // Nur wenn beide Partner sichtbar sind — sonst nichts, auch keine Zahl.
    if (!a || !b) continue;
    const pair = [who(a), who(b)].sort((x, y) => x.name.localeCompare(y.name, "de"));
    push(start, {
      key: `rel:${r.id}`,
      kind: r.subtype === "MARRIED" ? "marriage" : "partnership",
      persons: pair,
      birthday: false,
    });
  }

  for (const e of input.events) {
    if (e.isAlternative || !(ANNIVERSARY_EVENT_TYPES as readonly string[]).includes(e.type)) continue;
    const date = preciseDay(e.date);
    const p = persons.get(e.personId);
    if (!date || !p) continue;
    push(date, {
      key: `event:${e.id}`,
      kind: "event",
      persons: [who(p)],
      eventType: e.type,
      eventTitle: e.title,
      birthday: false,
    });
  }
  return out;
}

/** Jahrestage des Tages, Geburtstage und runde Jahrestage der nächsten Wochen. */
export function computeToday(input: TodayInput): TodayResult {
  const all = collect(input);
  const today = all.filter((a) => a.daysAway === 0).sort(compareToday);
  const soon = all.filter((a) => a.daysAway >= 1 && a.daysAway <= UPCOMING_DAYS);
  const birthdays = soon.filter((a) => a.birthday).sort(compareUpcoming);
  // Geburten Lebender stehen schon bei den Geburtstagen; Ereignisse nur „heute“.
  const upcoming = soon.filter((a) => a.round && !a.birthday && a.kind !== "event").sort(compareUpcoming);
  const next =
    today.length === 0
      ? (all.filter((a) => a.daysAway >= 1 && a.daysAway <= NEXT_SEARCH_DAYS).sort(compareUpcoming)[0] ?? null)
      : null;
  const realToday = input.realToday ?? input.day;
  return { day: input.day, isRealToday: daysBetween(realToday, input.day) === 0, today, birthdays, upcoming, next };
}

// ---------------------------------------------------------------------------
// Sätze
// ---------------------------------------------------------------------------

/** Satzteil: Text oder Person (die Oberfläche macht daraus einen Link). */
export type SentencePart = string | AnniversaryPerson;

const yearsText = (n: number) => `${n} ${n === 1 ? "Jahr" : "Jahren"}`;

/**
 * Wann: „Heute“, „Morgen“ (nur wenn der gewählte Tag der wirkliche heutige
 * ist), sonst „Am 14. März“. null für den gewählten Tag selbst, wenn er
 * nicht heute ist — die Überschrift nennt ihn schon.
 */
export function whenText(a: Pick<Anniversary, "daysAway" | "on">, isRealToday: boolean): string | null {
  if (isRealToday && a.daysAway === 0) return "Heute";
  if (isRealToday && a.daysAway === 1) return "Morgen";
  if (a.daysAway === 0) return null;
  return `Am ${formatDayMonth(a.on)}`;
}

/** Verb je Ereignisart, sonst „{Titel} von {Person}“. */
const EVENT_VERBS: Record<string, string> = {
  BAPTISM: "getauft",
  CHRISTENING: "getauft",
  ADULT_CHRISTENING: "getauft",
  ADOPTION: "adoptiert",
  NATURALIZATION: "eingebürgert",
};

/**
 * Satz in Anwendersprache, z.B. „Heute vor 120 Jahren wurde Anna Beispiel
 * geboren“, „Anna Beispiel wird heute 34“, „Am 3. Mai wird Anna Beispiel
 * 40“, „Am 3. Mai vor 75 Jahren heirateten Karl Muster und Erna Muster“.
 */
export function anniversarySentence(a: Anniversary, isRealToday: boolean): SentencePart[] {
  const when = whenText(a, isRealToday);
  const [p, q] = a.persons;
  const ago = when ? `${when} vor ${yearsText(a.years)}` : `Vor ${yearsText(a.years)}`;
  switch (a.kind) {
    case "birth":
      if (!a.birthday) return [`${ago} wurde `, p, " geboren"];
      if (when === "Heute") return [p, ` wird heute ${a.years}`];
      return when ? [`${when} wird `, p, ` ${a.years}`] : [p, ` wird ${a.years}`];
    case "death":
      return [`${ago} starb `, p];
    case "marriage":
      return [`${ago} heirateten `, p, " und ", q];
    case "partnership":
      return [`${ago} begann die Partnerschaft von `, p, " und ", q];
    case "event": {
      const verb = a.eventType ? EVENT_VERBS[a.eventType] : undefined;
      if (verb) return [`${ago} wurde `, p, ` ${verb}`];
      if (a.eventType === "EMIGRATION") return [`${ago} wanderte `, p, " aus"];
      if (a.eventType === "IMMIGRATION") return [`${ago} wanderte `, p, " ein"];
      return [`${ago}: ${a.eventTitle ?? "Ereignis"} von `, p];
    }
  }
}

/** Satz als reiner Text (Tests, Beschriftungen). */
export const sentenceText = (parts: SentencePart[]) => parts.map((s) => (typeof s === "string" ? s : s.name)).join("");

/** Hinweis neben runden Einträgen: „Goldene Hochzeit“, „runder Geburtstag“, „100. Jahrestag“. */
export function roundLabel(a: Anniversary): string | null {
  if (a.jubilee) return a.jubilee;
  if (!a.round) return null;
  if (a.birthday) return "runder Geburtstag";
  return `${a.years}. Jahrestag`;
}
