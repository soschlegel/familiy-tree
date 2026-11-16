import { describe, expect, it } from "vitest";

import {
  findConsistencyIssues,
  type ConsistencyEdge,
  type ConsistencyPerson,
} from "@/lib/consistency";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = d("2025-06-01");

function person(id: string, birth: string | null, death: string | null = null, gender: ConsistencyPerson["gender"] = "MALE"): ConsistencyPerson {
  return { id, givenName: id, familyName: "Test", gender, birthDate: birth ? d(birth) : null, deathDate: death ? d(death) : null };
}

let n = 0;
const parent = (from: string, to: string, subtype = "BIOLOGICAL"): ConsistencyEdge => ({
  id: `r${++n}`, type: "PARENT_OF", subtype, from, to, startDate: null, endDate: null,
});
const marriage = (from: string, to: string, start: string | null, end: string | null = null, subtype = "MARRIED"): ConsistencyEdge => ({
  id: `r${++n}`, type: "PARTNER_OF", subtype, from, to, startDate: start ? d(start) : null, endDate: end ? d(end) : null,
});

const kinds = (issues: ReturnType<typeof findConsistencyIssues>) => issues.map((i) => i.kind).sort();

describe("findConsistencyIssues", () => {
  it("meldet nichts bei plausiblen Daten", () => {
    const persons = [person("V", "1900-01-01", "1970-01-01"), person("M", "1902-01-01", "1980-01-01", "FEMALE"), person("K", "1930-05-05")];
    const edges = [parent("V", "K"), parent("M", "K"), marriage("V", "M", "1928-06-01")];
    expect(findConsistencyIssues(persons, edges, NOW)).toEqual([]);
  });

  it("Elternalter, Geburt nach dem Tod, Tod vor Geburt", () => {
    const persons = [
      person("Jung", "1990-01-01"),
      person("Alt", "1900-01-01", "1990-01-01"),
      person("Mutter", "1950-01-01", "1979-12-31", "FEMALE"),
      person("Kind", "1980-03-01"),
      person("Kind2", "2001-01-01"),
      person("Kaputt", "1950-01-01", "1940-01-01"),
    ];
    const issues = findConsistencyIssues(
      persons,
      [parent("Jung", "Kind2"), parent("Alt", "Kind"), parent("Mutter", "Kind"), parent("Alt", "Kind2", "ADOPTIVE")],
      NOW,
    );
    expect(kinds(issues)).toEqual(["bornAfterParentDeath", "deathBeforeBirth", "parentTooOld", "parentTooYoung"]);
    // Fehler stehen vor Warnungen.
    expect(issues[0].severity).toBe("error");
    expect(issues.find((i) => i.kind === "parentTooYoung")!.message).toContain("erst 11 Jahre");
  });

  it("Vater darf kurz vor der Geburt sterben, Mutter nicht", () => {
    const persons = [person("V", "1900-01-01", "1930-01-01"), person("K", "1930-08-01")];
    expect(findConsistencyIssues(persons, [parent("V", "K")], NOW)).toEqual([]);
  });

  it("Lebensdauer über 110 Jahre, auch ohne Sterbedatum", () => {
    const issues = findConsistencyIssues([person("A", "1800-01-01", "1915-01-01"), person("B", "1900-01-01")], [], NOW);
    expect(issues.map((i) => [i.personIds[0], i.severity])).toEqual([
      ["A", "error"],
      ["B", "warning"],
    ]);
  });

  it("Partnerschaft: zu jung, nach dem Tod, überschneidende Ehen", () => {
    const persons = [
      person("P", "1900-01-01", "1980-01-01"),
      person("E1", "1902-01-01", "1970-01-01", "FEMALE"),
      person("E2", "1925-01-01", "2010-01-01", "FEMALE"),
      person("E3", "1960-01-01", null, "FEMALE"),
      person("Kind", "1990-01-01", null, "FEMALE"),
    ];
    const issues = findConsistencyIssues(
      persons,
      [
        marriage("P", "E1", "1925-01-01"),
        marriage("P", "E2", "1950-01-01"), // E1 lebt noch, keine Scheidung
        marriage("P", "E3", "1985-01-01"), // nach dem Tod von P
        marriage("Kind", "E3", "2000-01-01", null, "UNMARRIED"), // Kind ist erst 10
      ],
      NOW,
    );
    expect(kinds(issues)).toEqual(["overlappingMarriages", "partnershipAfterDeath", "partnershipTooYoung"]);
  });

  it("Scheidung beendet die Ehe; Scheidung ohne Datum bleibt ungeprüft", () => {
    const persons = [person("P", "1900-01-01"), person("A", "1900-01-01", null, "FEMALE"), person("B", "1900-01-01", null, "FEMALE")];
    const now = d("1990-01-01");
    expect(findConsistencyIssues(persons, [marriage("P", "A", "1925-01-01", "1930-01-01", "DIVORCED"), marriage("P", "B", "1931-01-01")], now)).toEqual([]);
    expect(findConsistencyIssues(persons, [marriage("P", "A", "1925-01-01", null, "DIVORCED"), marriage("P", "B", "1931-01-01")], now)).toEqual([]);
  });
});

describe("findConsistencyIssues mit ungenauen Daten", () => {
  type P = ConsistencyPerson;
  type Spec = [number, "YEAR" | "DAY", "EXACT" | "ABOUT" | "BEFORE" | "AFTER"];
  const year = (y: number) => new Date(Date.UTC(y, 0, 1));
  const fuzzy = (id: string, birth: Spec | null, death: Spec | null = null, gender: P["gender"] = "MALE"): P => ({
    id,
    givenName: id,
    familyName: "Test",
    gender,
    birthDate: birth ? year(birth[0]) : null,
    birthDatePrecision: birth?.[1],
    birthDateQualifier: birth?.[2],
    deathDate: death ? year(death[0]) : null,
    deathDatePrecision: death?.[1],
    deathDateQualifier: death?.[2],
  });

  it("nur das Jahr: kein Widerspruch durch den 1. Januar als Anker", () => {
    // Mutter „1900“ gestorben (vielleicht im Dezember), Kind „1900“ geboren:
    // als Tagesdaten lägen beide auf dem 01.01. — trotzdem kein Fehler.
    const persons = [fuzzy("M", [1930, "YEAR", "EXACT"], [1970, "YEAR", "EXACT"], "FEMALE"), fuzzy("K", [1970, "YEAR", "EXACT"])];
    expect(findConsistencyIssues(persons, [parent("M", "K")], NOW)).toEqual([]);
    // Geburt ein Jahr nach dem Tod der Mutter: sicher ein Fehler.
    const later = [fuzzy("M", [1930, "YEAR", "EXACT"], [1969, "YEAR", "EXACT"], "FEMALE"), fuzzy("K", [1970, "YEAR", "EXACT"])];
    expect(kinds(findConsistencyIssues(later, [parent("M", "K")], NOW))).toEqual(["bornAfterParentDeath"]);
  });

  it("Tod im Geburtsjahr ist kein Tod vor der Geburt", () => {
    const p: P = { ...person("A", "1850-06-15"), deathDate: year(1850), deathDatePrecision: "YEAR" };
    expect(findConsistencyIssues([p], [], NOW)).toEqual([]);
    const q: P = { ...p, deathDate: year(1849) };
    expect(kinds(findConsistencyIssues([q], [], NOW))).toEqual(["deathBeforeBirth"]);
  });

  it("„um“ verhindert Meldungen am Rand, eindeutige Fälle bleiben", () => {
    // Elternteil „um 1950“, Kind 1961: als Jahr wären es 11 Jahre, mit
    // Spielraum ist ein Alter bis 13 möglich -> keine Meldung.
    const edge = [fuzzy("E", [1950, "YEAR", "ABOUT"]), fuzzy("K", [1961, "YEAR", "EXACT"])];
    expect(findConsistencyIssues(edge, [parent("E", "K")], NOW)).toEqual([]);
    // Kind „um 1950“ vor dem Elternteil (1960) geboren -> Fehler.
    const clear = [fuzzy("E", [1960, "YEAR", "EXACT"]), fuzzy("K", [1950, "YEAR", "ABOUT"])];
    const issues = findConsistencyIssues(clear, [parent("E", "K")], NOW);
    expect(kinds(issues)).toEqual(["parentTooYoung"]);
    expect(issues[0].severity).toBe("error");
  });

  it("„vor“/„nach“: offene Seiten melden nur Sicheres", () => {
    // Geboren „vor 1800“, ohne Sterbedatum: sicher über 110.
    const old = [fuzzy("A", [1800, "YEAR", "BEFORE"])];
    expect(kinds(findConsistencyIssues(old, [], NOW))).toEqual(["lifespanOver110"]);
    expect(findConsistencyIssues(old, [], NOW)[0].message).toContain("mindestens");
    // Geboren „nach 1900“: Alter nach unten offen -> keine Meldung.
    expect(findConsistencyIssues([fuzzy("B", [1900, "YEAR", "AFTER"])], [], NOW)).toEqual([]);
  });

  it("Heirat im Todesjahr (nur Jahr) ist keine Heirat nach dem Tod", () => {
    const persons = [person("P", "1900-01-01"), person("Q", "1902-01-01", "1980-01-01", "FEMALE")];
    persons[0] = { ...persons[0], deathDate: year(1930), deathDatePrecision: "YEAR" };
    const m: ConsistencyEdge = { ...marriage("P", "Q", null), startDate: year(1930), startDatePrecision: "YEAR" };
    expect(findConsistencyIssues(persons, [m], NOW)).toEqual([]);
    const after: ConsistencyEdge = { ...m, startDate: year(1931) };
    expect(kinds(findConsistencyIssues(persons, [after], NOW))).toEqual(["partnershipAfterDeath"]);
  });
});
