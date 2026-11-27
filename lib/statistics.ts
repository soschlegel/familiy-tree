/**
 * Seite „Statistik“: Auswertungen über den sichtbaren Teil des Stammbaums.
 * Reine Funktionen ohne Datenbank — Laden, Rechte und Familienfilter macht
 * lib/services/statistics.ts. Fachliche Regeln:
 * docs/komponenten/bibliotheken.md („lib/statistics.ts“).
 *
 * Grundsätze:
 * - Gezählt werden nur Personen mit `visible` (der Dienst reicht ohnehin nur
 *   sichtbare herein; die Funktion filtert trotzdem selbst). Beziehungen
 *   zählen nur, wenn beide Seiten gezählt werden — Kinder also nur sichtbare.
 * - Das Ergebnis enthält nur Summen, Namen (Nachnamen, Vornamen) und Gebiete
 *   — keine Kennungen, keine einzelnen Personen.
 * - Ungenaue Daten (lib/dates.ts): ein Jahr gilt, wenn die Angabe höchstens
 *   MAX_DATE_SPAN_YEARS Jahre offen lässt (Mitte des möglichen Zeitraums);
 *   „vor …“, „nach …“, „ab …“, „bis …“ und weite Bereiche fallen heraus.
 *   Ein Lebensalter gilt, wenn es auf höchstens MAX_DATE_SPAN_YEARS Jahre
 *   genau feststeht (Mitte der möglichen Spanne); bei tagesgenauen Daten
 *   exakt.
 * - Durchschnitte erst ab MIN_BASIS Personen; darunter nur die Anzahl.
 */
import type { Gender } from "@prisma/client";

import { groupAreaSlices, roundPercentages, type AreaSlice } from "./chart-slices";
import { MAX_LIFESPAN, PRESUMED_LIFESPAN } from "./consistency";
import { dateBounds, YEAR_MS, yearsBetween, type FuzzyDate } from "./dates";
import type { AreaLevel, PlaceArea } from "./places/area";

/** Unter so vielen Personen wird kein Durchschnitt gezeigt. */
export const MIN_BASIS = 5;
/** So weit darf eine ungenaue Angabe offen sein, um noch zu zählen. */
export const MAX_DATE_SPAN_YEARS = 10;
/** Höchstens so viele Namen je Liste. */
export const TOP_NAMES = 15;
/** Mehr Jahrzehnte als diese: Geburten je Jahrhundert statt je Jahrzehnt. */
export const MAX_DECADE_BARS = 30;
/** Ab so vielen Kindern eine gemeinsame Klasse „10 und mehr“. */
export const MAX_CHILDREN_CLASS = 10;

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

export type StatPerson = {
  id: string;
  visible: boolean;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
  /** Sterbeangabe ohne Datum (Ort, Wortlaut) — die Person ist verstorben. */
  deathWithoutDate: boolean;
  /** Geburtsort, sonst Ort der Taufe (der Dienst wählt), getrimmt. */
  place: string | null;
};

export type StatRelationship = {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  from: string;
  to: string;
  /** Beginn (Heirat) bei Partnerschaften. */
  start: FuzzyDate | null;
};

export type StatisticsInput = {
  persons: readonly StatPerson[];
  relationships: readonly StatRelationship[];
  now: Date;
  level: AreaLevel;
  /** Gebiet eines Ortstexts (undefined: keine Zuordnung). */
  areaOf: (placeText: string) => PlaceArea | undefined;
};

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

export type Bar = { key: string; label: string; count: number; detail?: string };

export type AverageRow = {
  key: string;
  label: string;
  /** Personen in dieser Zeile. */
  count: number;
  /** null: zu wenige (unter MIN_BASIS) für einen Durchschnitt. */
  average: number | null;
};

export type StatisticsResult = {
  totals: {
    persons: number;
    living: number;
    /** Mit Sterbeangabe oder vermutlich (über PRESUMED_LIFESPAN Jahre). */
    deceased: number;
    /** Davon ohne Sterbeangabe, aber laut Geburt über 100 Jahre alt. */
    presumedDeceased: number;
    partnerships: number;
    parentChild: number;
    earliestBirthYear: number | null;
    latestBirthYear: number | null;
    /** Personen mit verwertbarem Geburtsjahr. */
    withBirthYear: number;
  };
  birthPlaces: { level: AreaLevel; slices: AreaSlice[]; withPlace: number; assigned: number };
  gender: { slices: AreaSlice[]; known: number };
  surnames: { bars: Bar[]; withName: number; distinct: number };
  givenNames: { bars: Bar[]; withName: number; distinct: number };
  births: { unit: "decade" | "century"; bars: Bar[]; basis: number };
  lifespan: { byCentury: AverageRow[]; classes: Bar[]; basis: number; average: number | null };
  children: { byCentury: AverageRow[]; distribution: Bar[]; parents: number; average: number | null };
  marriageAge: { byGender: AverageRow[]; classes: Bar[]; basis: number };
  birthMonths: { bars: Bar[]; basis: number };
};

// ---------------------------------------------------------------------------
// Datumsregeln
// ---------------------------------------------------------------------------

/**
 * Jahr einer ungenauen Angabe: Mitte des möglichen Zeitraums, wenn dieser
 * höchstens MAX_DATE_SPAN_YEARS Jahre weit ist (ein Jahr, „um 1850“,
 * „zwischen 1850 und 1855“); sonst null („vor 1900“, „ab 1901“).
 */
export function usableYear(f: FuzzyDate | null | undefined): number | null {
  if (!f) return null;
  const { start, end } = dateBounds(f);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if ((end - start) / YEAR_MS > MAX_DATE_SPAN_YEARS + 0.01) return null;
  return new Date((start + end) / 2).getUTCFullYear();
}

/**
 * Alter in ganzen Jahren zwischen zwei Angaben: tagesgenau die vollendeten
 * Jahre nach dem Kalender, sonst die vollendeten Jahre zur Mitte der
 * möglichen Spanne, wenn diese höchstens MAX_DATE_SPAN_YEARS Jahre weit ist
 * (kleiner Zuschlag gegen Rundungsfehler bei Schaltjahren). null bei offenen Angaben, zu weiter Spanne, negativem Alter oder
 * über MAX_LIFESPAN Jahren (Widerspruch in den Daten, siehe lib/consistency.ts).
 */
export function usableAge(from: FuzzyDate | null | undefined, to: FuzzyDate | null | undefined): number | null {
  if (!from || !to) return null;
  const r = yearsBetween(from, to);
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) return null;
  if (r.max - r.min > MAX_DATE_SPAN_YEARS + 0.01) return null;
  const age = r.exact ? completedYears(from.date, to.date) : Math.floor((r.min + r.max) / 2 + 0.01);
  if (age < 0 || age > MAX_LIFESPAN) return null;
  return age;
}

/** Vollendete Lebensjahre nach dem Kalender (Geburtstag zählt mit). */
function completedYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const before =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (before) years -= 1;
  return years;
}

/** Ohne Sterbeangabe, aber sicher älter als PRESUMED_LIFESPAN (wie getStatistics). */
function presumedDead(birth: FuzzyDate | null, now: Date): boolean {
  if (!birth) return false;
  const latest = dateBounds(birth).end;
  if (!Number.isFinite(latest)) return false;
  return now.getUTCFullYear() - new Date(latest - 1).getUTCFullYear() > PRESUMED_LIFESPAN;
}

/** „1800–1899“ für ein Jahr; Schlüssel = erstes Jahr. */
export function centuryOf(year: number): { key: string; label: string; start: number } {
  const start = Math.floor(year / 100) * 100;
  return { key: String(start), label: `${start}–${start + 99}`, start };
}

// ---------------------------------------------------------------------------
// Namensregeln
// ---------------------------------------------------------------------------

/** Platzhalter, die kein Name sind (klein geschrieben, ohne Punkte). */
const NAME_PLACEHOLDERS = new Set(["nn", "unbekannt", "unknown", "nicht bekannt", "o", "x"]);

/** Name säubern; null für Platzhalter („NN“, „?“, „unbekannt“) und Leeres. */
export function cleanName(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(t)) return null;
  const probe = t.toLocaleLowerCase("de").replace(/[.\s]/g, "");
  if (NAME_PLACEHOLDERS.has(probe) || NAME_PLACEHOLDERS.has(t.toLocaleLowerCase("de"))) return null;
  return t;
}

/** Nachname für die Zählung: Geburtsname vor Ehename (wie der GEDCOM-Export). */
export function surnameForCount(p: Pick<StatPerson, "birthName" | "familyName">): string | null {
  return cleanName(p.birthName) ?? cleanName(p.familyName);
}

/** Erster Vorname: erstes Wort des Vornamensfelds, ohne angehängte Satzzeichen. */
export function firstGivenName(givenName: string | null | undefined): string | null {
  const first = (givenName ?? "").trim().split(/\s+/)[0] ?? "";
  return cleanName(first.replace(/[,;:]+$/, ""));
}

/** Zählt Namen ohne Rücksicht auf Groß-/Kleinschreibung; angezeigt wird die häufigste Schreibweise. */
function topNames(names: readonly string[]): { bars: Bar[]; distinct: number } {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const name of names) {
    const key = name.toLocaleLowerCase("de");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { count: 0, spellings: new Map() }));
    g.count++;
    g.spellings.set(name, (g.spellings.get(name) ?? 0) + 1);
  }
  const rows = [...groups.entries()].map(([key, g]) => {
    const label = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))[0][0];
    return { key, label, count: g.count };
  });
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"));
  return { bars: rows.slice(0, TOP_NAMES), distinct: rows.length };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const GENDER_LABEL: Record<Gender, string> = {
  MALE: "Männlich",
  FEMALE: "Weiblich",
  OTHER: "Divers",
  UNKNOWN: "Unbekannt",
};
const GENDER_COLOR: Record<Gender, string> = {
  MALE: "var(--chart-1)",
  FEMALE: "var(--chart-3)",
  OTHER: "var(--chart-6)",
  UNKNOWN: "var(--chart-unknown)",
};

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function average(values: readonly number[]): number | null {
  if (values.length < MIN_BASIS) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function averageRows(groups: Map<string, { label: string; start: number; values: number[] }>): AverageRow[] {
  return [...groups.entries()]
    .sort((a, b) => a[1].start - b[1].start)
    .map(([key, g]) => ({ key, label: g.label, count: g.values.length, average: average(g.values) }));
}

function pushTo<K>(map: Map<K, { label: string; start: number; values: number[] }>, key: K, label: string, start: number, v: number) {
  let g = map.get(key);
  if (!g) map.set(key, (g = { label, start, values: [] }));
  g.values.push(v);
}

/** Lebensalter-Klassen: 0–9, 10–19, … 90–99, 100 und älter. */
function ageClasses(ages: readonly number[]): Bar[] {
  const bars: Bar[] = Array.from({ length: 11 }, (_, i) => ({
    key: String(i * 10),
    label: i === 10 ? "100 und älter" : `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  for (const a of ages) bars[Math.min(10, Math.floor(a / 10))].count++;
  return bars;
}

const MARRIAGE_CLASSES = [
  { key: "u20", label: "unter 20", min: -Infinity },
  { key: "20", label: "20–24", min: 20 },
  { key: "25", label: "25–29", min: 25 },
  { key: "30", label: "30–34", min: 30 },
  { key: "35", label: "35–39", min: 35 },
  { key: "40", label: "40 und älter", min: 40 },
] as const;

const COUNTED_CHILD_SUBTYPES = new Set(["BIOLOGICAL", "ADOPTIVE"]);
const MARRIAGE_SUBTYPES = new Set(["MARRIED", "DIVORCED"]);

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

/** Alle Auswertungen in einem Durchgang über Personen und Beziehungen. */
export function computeStatistics(input: StatisticsInput): StatisticsResult {
  const persons = input.persons.filter((p) => p.visible);
  const byId = new Map(persons.map((p) => [p.id, p]));
  const rels = input.relationships.filter((r) => byId.has(r.from) && byId.has(r.to) && r.from !== r.to);

  const yearOf = new Map<string, number>();
  let deceased = 0;
  let presumed = 0;
  const genderCount: Record<Gender, number> = { MALE: 0, FEMALE: 0, OTHER: 0, UNKNOWN: 0 };
  const surnames: string[] = [];
  const givenNames: string[] = [];
  const areas = new Map<string, { label: string; value: number }>();
  let unassigned = 0;
  let unknownPlace = 0;
  const ages: number[] = [];
  const ageByCentury = new Map<string, { label: string; start: number; values: number[] }>();
  const monthCount = Array.from({ length: 12 }, () => 0);

  for (const p of persons) {
    const year = usableYear(p.birth);
    if (year !== null) yearOf.set(p.id, year);

    if (p.death || p.deathWithoutDate) deceased++;
    else if (presumedDead(p.birth, input.now)) {
      deceased++;
      presumed++;
    }

    genderCount[p.gender]++;

    const surname = surnameForCount(p);
    if (surname) surnames.push(surname);
    const given = firstGivenName(p.givenName);
    if (given) givenNames.push(given);

    if (!p.place) unknownPlace++;
    else {
      const area = input.areaOf(p.place);
      if (!area || area.kind !== "area") unassigned++;
      else {
        const a = areas.get(area.key);
        if (a) a.value++;
        else areas.set(area.key, { label: area.label, value: 1 });
      }
    }

    const age = usableAge(p.birth, p.death);
    if (age !== null) {
      ages.push(age);
      if (year !== null) {
        const c = centuryOf(year);
        pushTo(ageByCentury, c.key, c.label, c.start, age);
      }
    }

    // Geburtsmonat nur bei genau bekanntem Monat (Tag oder Monat, ohne Zusatz).
    if (p.birth && p.birth.qualifier === "EXACT" && p.birth.precision !== "YEAR") {
      monthCount[p.birth.date.getUTCMonth()]++;
    }
  }

  // Beziehungen: nur zwischen gezählten Personen; Doppelte zählen einmal.
  const childrenOf = new Map<string, Set<string>>();
  let parentChild = 0;
  let partnerships = 0;
  const firstMarriage = new Map<string, FuzzyDate>();
  for (const r of rels) {
    if (r.type === "PARENT_OF") {
      parentChild++;
      if (!COUNTED_CHILD_SUBTYPES.has(r.subtype)) continue;
      let set = childrenOf.get(r.from);
      if (!set) childrenOf.set(r.from, (set = new Set()));
      set.add(r.to);
    } else {
      partnerships++;
      if (!MARRIAGE_SUBTYPES.has(r.subtype) || !r.start) continue;
      const startYear = dateBounds(r.start).start;
      for (const id of [r.from, r.to]) {
        const prev = firstMarriage.get(id);
        if (!prev || startYear < dateBounds(prev).start) firstMarriage.set(id, r.start);
      }
    }
  }

  // Kinderzahl je Person mit mindestens einem gezählten Kind.
  const childCounts: number[] = [];
  const childrenByCentury = new Map<string, { label: string; start: number; values: number[] }>();
  const distribution: Bar[] = Array.from({ length: MAX_CHILDREN_CLASS }, (_, i) => ({
    key: String(i + 1),
    label: i + 1 === MAX_CHILDREN_CLASS ? `${MAX_CHILDREN_CLASS} und mehr` : String(i + 1),
    count: 0,
  }));
  for (const [parentId, kids] of childrenOf) {
    const n = kids.size;
    childCounts.push(n);
    distribution[Math.min(MAX_CHILDREN_CLASS, n) - 1].count++;
    const year = yearOf.get(parentId);
    if (year !== undefined) {
      const c = centuryOf(year);
      pushTo(childrenByCentury, c.key, c.label, c.start, n);
    }
  }

  // Heiratsalter: erste Ehe mit Datum, je Person mit verwertbarem Alter.
  const marriageAges: number[] = [];
  const marriageByGender = new Map<string, { label: string; start: number; values: number[] }>();
  for (const [id, start] of firstMarriage) {
    const p = byId.get(id)!;
    const age = usableAge(p.birth, start);
    if (age === null) continue;
    marriageAges.push(age);
    if (p.gender === "MALE" || p.gender === "FEMALE") {
      pushTo(marriageByGender, p.gender, p.gender === "MALE" ? "Männer" : "Frauen", p.gender === "MALE" ? 0 : 1, age);
    }
  }
  const marriageClasses: Bar[] = MARRIAGE_CLASSES.map((c) => ({ key: c.key, label: c.label, count: 0 }));
  for (const a of marriageAges) {
    let idx = 0;
    MARRIAGE_CLASSES.forEach((c, i) => {
      if (a >= c.min) idx = i;
    });
    marriageClasses[idx].count++;
  }

  // Geburten je Jahrzehnt bzw. Jahrhundert, lückenlos vom ersten bis zum letzten.
  const years = [...yearOf.values()];
  const earliest = years.length ? Math.min(...years) : null;
  const latest = years.length ? Math.max(...years) : null;
  let unit: "decade" | "century" = "decade";
  const births: Bar[] = [];
  if (earliest !== null && latest !== null) {
    const decades = Math.floor(latest / 10) - Math.floor(earliest / 10) + 1;
    unit = decades > MAX_DECADE_BARS ? "century" : "decade";
    const step = unit === "decade" ? 10 : 100;
    const first = Math.floor(earliest / step) * step;
    const last = Math.floor(latest / step) * step;
    for (let s = first; s <= last; s += step) births.push({ key: String(s), label: `${s}–${s + step - 1}`, count: 0 });
    for (const y of years) births[(Math.floor(y / step) * step - first) / step].count++;
  }

  const knownGender = persons.length - genderCount.UNKNOWN;
  const genderSlices = groupGender(genderCount);

  const placeSlices = groupAreaSlices(areas, { unassigned, unknown: unknownPlace });
  const sur = topNames(surnames);
  const giv = topNames(givenNames);

  return {
    totals: {
      persons: persons.length,
      living: persons.length - deceased,
      deceased,
      presumedDeceased: presumed,
      partnerships,
      parentChild,
      earliestBirthYear: earliest,
      latestBirthYear: latest,
      withBirthYear: years.length,
    },
    birthPlaces: {
      level: input.level,
      slices: placeSlices,
      withPlace: persons.length - unknownPlace,
      assigned: persons.length - unknownPlace - unassigned,
    },
    gender: { slices: genderSlices, known: knownGender },
    surnames: { bars: sur.bars, withName: surnames.length, distinct: sur.distinct },
    givenNames: { bars: giv.bars, withName: givenNames.length, distinct: giv.distinct },
    births: { unit, bars: births, basis: years.length },
    lifespan: {
      byCentury: averageRows(ageByCentury),
      classes: ageClasses(ages),
      basis: ages.length,
      average: average(ages),
    },
    children: {
      byCentury: averageRows(childrenByCentury),
      distribution,
      parents: childCounts.length,
      average: average(childCounts),
    },
    marriageAge: {
      byGender: averageRows(marriageByGender),
      classes: marriageClasses,
      basis: marriageAges.length,
    },
    birthMonths: {
      bars: MONTHS.map((label, i) => ({ key: String(i + 1), label, count: monthCount[i] })),
      basis: monthCount.reduce((a, b) => a + b, 0),
    },
  };
}

/** Ring „Geschlecht“: feste Reihenfolge und Farben, „Unbekannt“ grau. */
function groupGender(count: Record<Gender, number>): AreaSlice[] {
  const order: Gender[] = ["FEMALE", "MALE", "OTHER", "UNKNOWN"];
  const present = order.filter((g) => count[g] > 0);
  const total = present.reduce((s, g) => s + count[g], 0);
  const slices = present.map((g) => ({
    key: g,
    kind: g === "UNKNOWN" ? ("unknown" as const) : ("area" as const),
    label: GENDER_LABEL[g],
    value: count[g],
    share: total > 0 ? count[g] / total : 0,
    color: GENDER_COLOR[g],
  }));
  const percents = roundPercentages(slices.map((s) => s.value));
  return slices.map((s, i) => ({ ...s, percent: percents[i] }));
}
