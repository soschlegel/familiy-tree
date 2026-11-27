import { describe, expect, it } from "vitest";

import type { FuzzyDate } from "@/lib/dates";
import {
  addDays,
  anniversarySentence,
  calendarDayIn,
  computeToday,
  formatLongDay,
  isLiving,
  observedDay,
  parseIsoDay,
  preciseDay,
  roundLabel,
  sentenceText,
  type CalendarDay,
  type TodayEvent,
  type TodayInput,
  type TodayPartnership,
  type TodayPerson,
} from "@/lib/today";

/** Startseite „Heute in der Familie“ — reine Regeln aus lib/today.ts, alle Namen erfunden. */

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const exact = (y: number, m: number, d: number): FuzzyDate => ({ date: utc(y, m, d), precision: "DAY", qualifier: "EXACT" });
const day = (y: number, m: number, d: number): CalendarDay => ({ year: y, month: m, day: d });

function person(id: string, name: string, birth: FuzzyDate | null, extra: Partial<TodayPerson> = {}): TodayPerson {
  return { id, name, visible: true, birth, death: null, deathWithoutDate: false, ...extra };
}

function run(d: CalendarDay, persons: TodayPerson[], partnerships: TodayPartnership[] = [], events: TodayEvent[] = []) {
  const input: TodayInput = { day: d, realToday: d, persons, partnerships, events };
  return computeToday(input);
}

const texts = (items: ReturnType<typeof run>["today"], isRealToday = true) =>
  items.map((a) => sentenceText(anniversarySentence(a, isRealToday)));

describe("Kalendertage", () => {
  it("„heute“ nach Europe/Berlin, nicht nach UTC", () => {
    // 23:30 UTC am 31.12. ist in Berlin schon Neujahr (Winterzeit, +1 h).
    expect(calendarDayIn(new Date("2026-12-31T23:30:00Z"))).toEqual(day(2027, 1, 1));
    // 22:30 UTC im Sommer ist in Berlin 00:30 des Folgetags (+2 h).
    expect(calendarDayIn(new Date("2026-07-14T22:30:00Z"))).toEqual(day(2026, 7, 15));
    expect(calendarDayIn(new Date("2026-07-14T21:30:00Z"))).toEqual(day(2026, 7, 14));
  });

  it("Adresse ?datum= wird streng gelesen", () => {
    expect(parseIsoDay("2026-03-14")).toEqual(day(2026, 3, 14));
    expect(parseIsoDay("2024-02-29")).toEqual(day(2024, 2, 29));
    for (const bad of ["2026-02-29", "2026-13-01", "2026-3-14", "14.03.2026", "", null, undefined, "0999-01-01"]) {
      expect(parseIsoDay(bad), String(bad)).toBeNull();
    }
  });

  it("Datum ausgeschrieben und Tage über den Jahreswechsel", () => {
    expect(formatLongDay(day(2026, 11, 27))).toBe("Freitag, 27. November 2026");
    expect(addDays(day(2026, 12, 20), 15)).toEqual(day(2027, 1, 4));
  });

  it("29. Februar: in Nicht-Schaltjahren am 28. Februar", () => {
    expect(observedDay(2, 29, 2027)).toEqual(day(2027, 2, 28));
    expect(observedDay(2, 29, 2028)).toEqual(day(2028, 2, 29));
    expect(observedDay(2, 29, 2100)).toEqual(day(2100, 2, 28));
  });

  it("nur tagesgenaue, sichere Daten", () => {
    expect(preciseDay(exact(1900, 5, 3))).toEqual(day(1900, 5, 3));
    expect(preciseDay({ ...exact(1900, 5, 3), qualifier: "ABOUT" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 5, 3), qualifier: "ESTIMATED" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 5, 3), qualifier: "CALCULATED" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 5, 3), qualifier: "BEFORE" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 5, 1), precision: "MONTH" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 1, 1), precision: "YEAR" })).toBeNull();
    expect(preciseDay({ ...exact(1900, 5, 3), qualifier: "BETWEEN", to: { date: utc(1900, 5, 9), precision: "DAY" } })).toBeNull();
    expect(preciseDay(null)).toBeNull();
  });
});

describe("Lebend oder verstorben", () => {
  const today = day(2026, 11, 27);
  it("Sterbedatum oder Sterbeangabe ohne Datum: verstorben", () => {
    expect(isLiving({ birth: exact(1950, 1, 1), death: exact(2020, 1, 1), deathWithoutDate: false }, today)).toBe(false);
    expect(isLiving({ birth: exact(1950, 1, 1), death: null, deathWithoutDate: true }, today)).toBe(false);
    // Auch ein ungenaues Sterbedatum heißt verstorben.
    expect(isLiving({ birth: exact(1950, 1, 1), death: { ...exact(2020, 1, 1), precision: "YEAR" }, deathWithoutDate: false }, today)).toBe(false);
  });
  it("über 100 Jahre ohne Sterbeangabe: vermutlich verstorben", () => {
    expect(isLiving({ birth: exact(1926, 1, 1), death: null, deathWithoutDate: false }, today)).toBe(true);
    expect(isLiving({ birth: exact(1925, 12, 31), death: null, deathWithoutDate: false }, today)).toBe(false);
    expect(isLiving({ birth: null, death: null, deathWithoutDate: false }, today)).toBe(true);
  });
});

describe("Heute", () => {
  const today = day(2026, 11, 27);

  it("Geburt, Tod, Hochzeit und Ereignis des Tages als Sätze", () => {
    const anna = person("a", "Anna Beispiel", exact(1906, 11, 27), { death: exact(1980, 3, 2) });
    const karl = person("k", "Karl Muster", exact(1925, 4, 1), { death: exact(1976, 11, 27) });
    const erna = person("e", "Erna Muster", exact(1928, 6, 9), { death: exact(1999, 1, 5) });
    const lena = person("l", "Lena Probe", exact(1992, 11, 27));
    const hans = person("h", "Hans Probe", exact(1990, 2, 2));
    const r = run(
      today,
      [anna, karl, erna, lena, hans],
      [{ id: "r1", subtype: "MARRIED", partners: ["k", "e"], start: exact(1951, 11, 27) }],
      [{ id: "ev1", personId: "h", type: "BAPTISM", title: "Taufe", isAlternative: false, date: exact(1990, 11, 27) }],
    );
    const t = texts(r.today);
    expect(t).toContain("Heute vor 120 Jahren wurde Anna Beispiel geboren");
    expect(t).toContain("Lena Probe wird heute 34");
    expect(t).toContain("Heute vor 50 Jahren starb Karl Muster");
    expect(t).toContain("Heute vor 75 Jahren heirateten Erna Muster und Karl Muster");
    expect(t).toContain("Heute vor 36 Jahren wurde Hans Probe getauft");
    // Runde zuerst (120 ist kein Vielfaches von 25, 75 und 50 schon).
    expect(r.today.slice(0, 2).every((a) => a.round)).toBe(true);
    expect(r.today.find((a) => a.kind === "marriage")?.persons.map((p) => p.id)).toEqual(["e", "k"]);
    expect(r.next).toBeNull();
  });

  it("ungenaue Daten und Zweitangaben fallen heraus", () => {
    const r = run(
      today,
      [
        person("a", "Anna Beispiel", { ...exact(1900, 11, 27), qualifier: "ABOUT" }),
        person("b", "Bruno Beispiel", { ...exact(1900, 11, 1), precision: "MONTH" }),
        person("c", "Clara Beispiel", exact(1900, 1, 1)),
      ],
      [{ id: "r1", subtype: "MARRIED", partners: ["a", "b"], start: { ...exact(1925, 11, 27), qualifier: "ESTIMATED" } }],
      [
        { id: "e1", personId: "c", type: "BAPTISM", title: "Taufe", isAlternative: true, date: exact(1900, 11, 27) },
        { id: "e2", personId: "c", type: "OCCUPATION", title: "Beruf", isAlternative: false, date: exact(1920, 11, 27) },
      ],
    );
    expect(r.today).toEqual([]);
  });

  it("nicht sichtbare Personen und Hochzeiten mit nicht sichtbarem Partner erscheinen nirgends", () => {
    const hidden = person("x", "Xaver Geheim", exact(1950, 11, 27), { visible: false });
    const seen = person("s", "Sina Sichtbar", exact(1952, 5, 5));
    const r = run(
      today,
      [hidden, seen],
      [{ id: "r1", subtype: "MARRIED", partners: ["s", "x"], start: exact(1976, 11, 27) }],
      [{ id: "e1", personId: "x", type: "BAPTISM", title: "Taufe", isAlternative: false, date: exact(1950, 12, 1) }],
    );
    const json = JSON.stringify(r);
    expect(json).not.toContain("Xaver");
    expect(json).not.toContain('"x"');
    expect(r.today).toEqual([]);
    // Ein Partner, den es gar nicht gibt (nicht geladen), ebenso.
    const r2 = run(today, [seen], [{ id: "r2", subtype: "MARRIED", partners: ["s", "fehlt"], start: exact(1976, 11, 27) }]);
    expect(r2.today).toEqual([]);
  });

  it("geschiedene Ehen zählen nicht, Partnerschaften schon", () => {
    const a = person("a", "Anna Beispiel", exact(1950, 1, 1));
    const b = person("b", "Bernd Beispiel", exact(1950, 2, 2));
    const divorced = run(today, [a, b], [{ id: "r", subtype: "DIVORCED", partners: ["a", "b"], start: exact(1980, 11, 27) }]);
    expect(divorced.today).toEqual([]);
    const partners = run(today, [a, b], [{ id: "r", subtype: "UNMARRIED", partners: ["a", "b"], start: exact(1980, 11, 27) }]);
    expect(texts(partners.today)).toEqual(["Heute vor 46 Jahren begann die Partnerschaft von Anna Beispiel und Bernd Beispiel"]);
  });

  it("Goldene Hochzeit nur, wenn beide Partner leben", () => {
    const a = person("a", "Anna Beispiel", exact(1950, 1, 1));
    const b = person("b", "Bernd Beispiel", exact(1950, 2, 2));
    const living = run(today, [a, b], [{ id: "r", subtype: "MARRIED", partners: ["a", "b"], start: exact(1976, 11, 27) }]);
    expect(roundLabel(living.today[0])).toBe("Goldene Hochzeit");
    const widowed = run(today, [a, { ...b, death: exact(2020, 1, 1) }], [{ id: "r", subtype: "MARRIED", partners: ["a", "b"], start: exact(1976, 11, 27) }]);
    expect(widowed.today[0].jubilee).toBeNull();
    expect(roundLabel(widowed.today[0])).toBe("50. Jahrestag");
  });

  it("29. Februar im Nicht-Schaltjahr am 28. Februar, im Schaltjahr am 29.", () => {
    const leap = person("p", "Paula Schalt", exact(1996, 2, 29));
    expect(texts(run(day(2027, 2, 28), [leap]).today)).toEqual(["Paula Schalt wird heute 31"]);
    expect(run(day(2027, 3, 1), [leap]).today).toEqual([]);
    expect(run(day(2028, 2, 28), [leap]).today).toEqual([]);
    expect(texts(run(day(2028, 2, 29), [leap]).today)).toEqual(["Paula Schalt wird heute 32"]);
  });

  it("Verstorbene und vermutlich Verstorbene: „vor N Jahren geboren“ statt Geburtstag", () => {
    const old = person("o", "Otto Alt", exact(1920, 11, 27));
    const r = run(today, [old]);
    expect(r.today[0].birthday).toBe(false);
    expect(texts(r.today)).toEqual(["Heute vor 106 Jahren wurde Otto Alt geboren"]);
  });

  it("nichts vor dem ersten Jahrestag (kein „vor 0 Jahren“)", () => {
    expect(run(today, [person("n", "Nele Neu", exact(2026, 11, 27))]).today).toEqual([]);
  });

  it("leerer Tag: der nächste Jahrestag, auch über den Jahreswechsel", () => {
    const r = run(day(2026, 12, 20), [person("j", "Jan Januar", exact(1950, 1, 3), { death: exact(2000, 6, 6) })]);
    expect(r.today).toEqual([]);
    expect(r.next?.on).toEqual(day(2027, 1, 3));
    expect(r.next?.years).toBe(77);
    expect(sentenceText(anniversarySentence(r.next!, true))).toBe("Am 3. Januar vor 77 Jahren wurde Jan Januar geboren");
  });
});

describe("Demnächst", () => {
  it("Geburtstage Lebender in den nächsten 30 Tagen, über den Jahreswechsel, runde hervorgehoben", () => {
    const d = day(2026, 12, 20);
    const r = run(d, [
      person("a", "Anna Winter", exact(1987, 1, 2)), // 40 am 2.1.2027 → rund
      person("b", "Bert Winter", exact(1990, 12, 21)), // morgen 36
      person("c", "Carl Winter", exact(1990, 1, 25)), // 36 Tage → zu weit
      person("d", "Dora Winter", exact(1950, 12, 24), { death: exact(2010, 1, 1) }), // verstorben → kein Geburtstag
    ]);
    expect(r.birthdays.map((a) => a.persons[0].name)).toEqual(["Bert Winter", "Anna Winter"]);
    expect(r.birthdays.map((a) => a.years)).toEqual([36, 40]);
    expect(r.birthdays.map((a) => a.round)).toEqual([false, true]);
    expect(texts(r.birthdays)).toEqual(["Morgen wird Bert Winter 36", "Am 2. Januar wird Anna Winter 40"]);
    expect(roundLabel(r.birthdays[1])).toBe("runder Geburtstag");
  });

  it("nur runde Jahrestage von Geburt Verstorbener, Tod und Hochzeit — keine Ereignisse", () => {
    const d = day(2026, 5, 1);
    const r = run(
      d,
      [
        person("a", "Anna Mai", exact(1926, 5, 10), { death: exact(1976, 5, 20) }), // 100. Geburtstag, 50. Todestag
        person("b", "Bruno Mai", exact(1930, 5, 11), { death: exact(1990, 5, 12) }), // 96 / 36 → nicht rund
        person("c", "Cora Mai", exact(1931, 1, 1), { death: exact(2000, 1, 1) }),
      ],
      [{ id: "r", subtype: "MARRIED", partners: ["a", "c"], start: exact(1951, 5, 15) }], // 75
      [{ id: "e", personId: "b", type: "EMIGRATION", title: "Auswanderung", isAlternative: false, date: exact(1951, 5, 3) }],
    );
    expect(texts(r.upcoming, false)).toEqual([
      "Am 10. Mai vor 100 Jahren wurde Anna Mai geboren",
      "Am 15. Mai vor 75 Jahren heirateten Anna Mai und Cora Mai",
      "Am 20. Mai vor 50 Jahren starb Anna Mai",
    ]);
    expect(r.upcoming.every((a) => a.round)).toBe(true);
    expect(r.birthdays).toEqual([]);
  });

  it("ein anderer Tag als heute: ohne „Heute“, sonst „Am …“ statt „Morgen“", () => {
    const d = day(2026, 3, 14);
    const r = computeToday({
      day: d,
      realToday: day(2026, 11, 27),
      persons: [
        person("a", "Anna Beispiel", exact(1990, 3, 14)),
        person("b", "Bert Beispiel", exact(1990, 3, 15)),
        person("c", "Carl Beispiel", exact(1900, 1, 1), { death: exact(1951, 3, 14) }),
      ],
      partnerships: [],
      events: [],
    });
    expect(r.isRealToday).toBe(false);
    expect(texts(r.today, r.isRealToday)).toEqual(["Vor 75 Jahren starb Carl Beispiel", "Anna Beispiel wird 36"]);
    expect(texts(r.birthdays, r.isRealToday)).toEqual(["Am 15. März wird Bert Beispiel 36"]);
  });
});
