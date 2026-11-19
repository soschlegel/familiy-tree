/**
 * Unit-Tests ohne Datenbank für die Genealogie-Erweiterung: Datumsbereiche
 * und Wortlaut, Ereignisregeln, Plausibilität mit Ereignissen, Ehestand
 * unbekannt, Fingerabdruck, Massenimport-Datum und Austauschformat.
 */
import { describe, expect, it } from "vitest";

import {
  certainlyBefore,
  dateBounds,
  formatDateWithPhrase,
  formatFuzzyDate,
  formatFuzzyYear,
  fuzzyColumns,
  fuzzyField,
  parseDateOrPhrase,
  parseFuzzyDate,
  phraseAfterUpdate,
  sameFuzzyDate,
  toDateInput,
  toFuzzyDate,
  yearsBetween,
  type FuzzyDate,
} from "@/lib/dates";
import { eventIssues, eventTitle, eventTypeAllowed, eventTypesFor } from "@/lib/events";
import { findConsistencyIssues, type ConsistencyEdge, type ConsistencyPerson } from "@/lib/consistency";
import { importFingerprint } from "@/lib/import-fingerprint";
import { exchangeDateColumns, exchangeSchema, exportDateFields } from "@/lib/exchange";
import { relationshipInput, subtypeMatchesType, personPatch, eventInput, citationInput } from "@/lib/validation";
import { stepTerm } from "@/lib/kinship";
import { resolveBulkDate } from "@/lib/services/import-apply";
import { dateFields, lifespan } from "@/mcp/format";

const ok = (input: string): FuzzyDate => {
  const r = parseFuzzyDate(input);
  if (!r.ok || !r.value) throw new Error(`nicht erkannt: ${input} (${r.ok ? "leer" : r.error})`);
  return r.value;
};
const y = (f: FuzzyDate | null | undefined) => f?.date.getUTCFullYear();

describe("Datumsbereiche und weitere Zusätze", () => {
  it("deutsche Eingabe: zwischen, Bindestrich, von–bis, ab/seit, bis", () => {
    const between = ok("zwischen 1850 und 1855");
    expect(between).toMatchObject({ qualifier: "BETWEEN", precision: "YEAR" });
    expect(y(between)).toBe(1850);
    expect(between.to).toMatchObject({ precision: "YEAR" });
    expect(between.to!.date.getUTCFullYear()).toBe(1855);
    for (const s of ["1850–1855", "1850-1855", "1850 - 1855", "zw. 1850 und 1855", "BET 1850 AND 1855"]) {
      expect(ok(s), s).toEqual(between);
    }
    const period = ok("von 1901 bis 1910");
    expect(period).toMatchObject({ qualifier: "PERIOD" });
    expect(ok("FROM 1901 TO 1910")).toEqual(period);
    expect(ok("ab 1901")).toMatchObject({ qualifier: "PERIOD" });
    expect(ok("ab 1901").to).toBeUndefined();
    expect(ok("seit März 1901")).toMatchObject({ qualifier: "PERIOD", precision: "MONTH" });
    expect(ok("bis 1910")).toMatchObject({ qualifier: "UNTIL" });
    expect(ok("TO 1910")).toMatchObject({ qualifier: "UNTIL" });
    const mixed = ok("zwischen 12.03.1850 und Mai 1851");
    expect(mixed).toMatchObject({ precision: "DAY", to: { precision: "MONTH" } });
  });

  it("geschätzt, errechnet, GEDCOM EST/CAL, englische Monate", () => {
    expect(ok("geschätzt 1850")).toMatchObject({ qualifier: "ESTIMATED" });
    expect(ok("EST 1850")).toMatchObject({ qualifier: "ESTIMATED" });
    expect(ok("errechnet 1850")).toMatchObject({ qualifier: "CALCULATED" });
    expect(ok("CAL 1850")).toMatchObject({ qualifier: "CALCULATED" });
    expect(ok("12 MAR 1850")).toMatchObject({ precision: "DAY" });
    expect(ok("DEC 1850").date.getUTCMonth()).toBe(11);
  });

  it("Fehler: Ende vor Anfang, unvollständige Bereiche", () => {
    expect(parseFuzzyDate("zwischen 1855 und 1850").ok).toBe(false);
    expect(parseFuzzyDate("von 1910 bis 1901").ok).toBe(false);
    expect(parseFuzzyDate("zwischen irgendwann und 1850").ok).toBe(false);
    expect(parseFuzzyDate("bis").ok).toBe(false);
    // ISO-Monat bleibt ein Monat, kein Bereich.
    expect(ok("1850-03")).toMatchObject({ precision: "MONTH", qualifier: "EXACT" });
  });

  it("Anzeige und Rundlauf über die Eingabeform", () => {
    expect(formatFuzzyDate(ok("1850–1855"))).toBe("zwischen 1850 und 1855");
    expect(formatFuzzyDate(ok("von 03.1901 bis 1910"))).toBe("von März 1901 bis 1910");
    expect(formatFuzzyDate(ok("ab 1901"))).toBe("ab 1901");
    expect(formatFuzzyDate(ok("bis 1910"))).toBe("bis 1910");
    expect(formatFuzzyDate(ok("EST 1850"))).toBe("geschätzt 1850");
    expect(formatFuzzyYear(ok("zwischen 1850 und 1855"))).toBe("zw. 1850 u. 1855");
    expect(formatFuzzyYear(ok("von 1901 bis 1910"))).toBe("1901–1910");
    expect(formatFuzzyYear(ok("zwischen 03.1850 und 05.1850"))).toBe("1850");
    for (const s of [
      "zwischen 1850 und 1855",
      "von 12.03.1901 bis 06.1910",
      "ab 1901",
      "bis 01.1910",
      "geschätzt 1850",
      "errechnet 03.1850",
    ]) {
      const f = ok(s);
      expect(ok(toDateInput(f)), s).toEqual(f);
      expect(ok(formatFuzzyDate(f)), s).toEqual(f);
    }
  });

  it("Speicherung: Spalten und zurück, Ende nur bei Bereichen", () => {
    const f = ok("zwischen 1850 und 1855");
    const cols = fuzzyColumns("birthDate", f);
    expect(cols.birthDateQualifier).toBe("BETWEEN");
    expect(cols.birthDateTo?.toISOString()).toBe("1855-01-01T00:00:00.000Z");
    expect(cols.birthDateToPrecision).toBe("YEAR");
    expect(fuzzyField(cols, "birthDate")).toEqual(f);
    expect(fuzzyColumns("birthDate", ok("1850")).birthDateTo).toBeNull();
    // Ein gespeichertes Ende bei einem Nicht-Bereich wird ignoriert.
    expect(toFuzzyDate("1850-01-01", "YEAR", "ABOUT", "1855-01-01", "YEAR")!.to).toBeUndefined();
  });

  it("Vergleiche: Bereich zählt mit ganzem Zeitraum, offenes Ende ist offen", () => {
    const b = dateBounds(ok("zwischen 1850 und 1855"));
    expect(new Date(b.start).toISOString()).toBe("1850-01-01T00:00:00.000Z");
    expect(new Date(b.end).toISOString()).toBe("1856-01-01T00:00:00.000Z");
    expect(dateBounds(ok("ab 1901")).end).toBe(Infinity);
    expect(dateBounds(ok("bis 1910")).start).toBe(-Infinity);
    expect(certainlyBefore(ok("zwischen 1850 und 1855"), ok("1856"))).toBe(true);
    expect(certainlyBefore(ok("zwischen 1850 und 1855"), ok("1854"))).toBe(false);
    expect(dateBounds(ok("geschätzt 1850")).start).toBeLessThan(Date.UTC(1849, 0, 1));
    // Ohne gespeichertes Ende (Altaufrufer) bleibt ein Bereich nach hinten offen — nie ein Fehlalarm.
    expect(dateBounds(toFuzzyDate("1850-01-01", "YEAR", "BETWEEN")!).end).toBe(Infinity);
    expect(yearsBetween(ok("1800"), ok("zwischen 1850 und 1855")).max).toBeGreaterThan(55);
  });

  it("Wortlaut: unlesbar bleibt erhalten, Anzeige, Änderungsregel", () => {
    expect(parseDateOrPhrase("Weihnachten 1850")).toEqual({ value: null, phrase: "Weihnachten 1850" });
    expect(parseDateOrPhrase("um 1850").phrase).toBeNull();
    expect(formatDateWithPhrase(null, "Weihnachten 1850")).toBe("Weihnachten 1850");
    expect(formatDateWithPhrase(ok("1850"), "Weihnachten 1850")).toBe("1850 („Weihnachten 1850“)");
    expect(formatDateWithPhrase(ok("1850"), "1850")).toBe("1850");
    const a = ok("1850");
    expect(sameFuzzyDate(a, ok("1850"))).toBe(true);
    expect(sameFuzzyDate(ok("zwischen 1850 und 1855"), ok("zwischen 1850 und 1856"))).toBe(false);
    // Datum unverändert mitgeschickt: Wortlaut bleibt; geändert: Wortlaut weg; neuer Wortlaut gewinnt.
    expect(phraseAfterUpdate(a, ok("1850"), "alt", undefined)).toBeUndefined();
    expect(phraseAfterUpdate(a, ok("1851"), "alt", undefined)).toBeNull();
    expect(phraseAfterUpdate(a, ok("1851"), "alt", "neu")).toBe("neu");
    expect(phraseAfterUpdate(a, undefined, "alt", undefined)).toBeUndefined();
  });

  it("Eingabeschemata: Bereich, Wortlaut, neue Personenfelder", () => {
    const p = personPatch.parse({ birthDate: "zwischen 1850 und 1855", birthDatePhrase: " Taufbuch: ‚um Pfingsten‘ ", nickname: "Hein" });
    expect(p.birthDate).toMatchObject({ qualifier: "BETWEEN" });
    expect(p.birthDatePhrase).toBe("Taufbuch: ‚um Pfingsten‘");
    expect(personPatch.safeParse({ birthDate: "zwischen 1855 und 1850" }).success).toBe(false);
  });
});

describe("Ereignisregeln (lib/events.ts)", () => {
  it("Art passt zum Träger", () => {
    expect(eventTypeAllowed("BAPTISM", { kind: "person" })).toBe(true);
    expect(eventTypeAllowed("ENGAGEMENT", { kind: "person" })).toBe(false);
    expect(eventTypeAllowed("ENGAGEMENT", { kind: "relationship", type: "PARTNER_OF" })).toBe(true);
    expect(eventTypeAllowed("ENGAGEMENT", { kind: "relationship", type: "PARENT_OF" })).toBe(false);
    expect(eventTypeAllowed("CUSTOM", { kind: "relationship", type: "PARENT_OF" })).toBe(true);
    expect(eventTypeAllowed("RESIDENCE", { kind: "relationship", type: "PARTNER_OF" })).toBe(true);
    expect(eventTypesFor({ kind: "person" })).toContain("OCCUPATION");
  });

  it("Geburt/Tod/Heirat/Scheidung nur als Alternative, CUSTOM braucht Bezeichnung", () => {
    expect(eventIssues({ type: "BIRTH", isAlternative: false, owner: { kind: "person" } })).toHaveLength(1);
    expect(eventIssues({ type: "BIRTH", isAlternative: true, owner: { kind: "person" } })).toEqual([]);
    expect(eventIssues({ type: "MARRIAGE", isAlternative: false, owner: { kind: "relationship", type: "PARTNER_OF" } })[0].path).toBe("isAlternative");
    expect(eventIssues({ type: "CUSTOM", isAlternative: false, label: " ", owner: { kind: "person" } })[0].path).toBe("label");
    expect(eventTitle({ type: "CUSTOM", label: "Kapitänspatent" })).toBe("Kapitänspatent");
    expect(eventTitle({ type: "BURIAL", label: "Seebestattung" })).toBe("Beerdigung");
  });

  it("Eingabe: genau ein Träger, Datum geprüft", () => {
    expect(eventInput.safeParse({ type: "BAPTISM" }).success).toBe(false);
    expect(eventInput.safeParse({ type: "BAPTISM", personId: "p", relationshipId: "r" }).success).toBe(false);
    expect(eventInput.safeParse({ type: "BAPTISM", personId: "p", date: "um 0900" }).success).toBe(false);
    const ok = eventInput.parse({ type: "RESIDENCE", personId: "p", date: "von 1901 bis 1910", place: "Celle" });
    expect(ok.date).toMatchObject({ qualifier: "PERIOD" });
    expect(citationInput.safeParse({ sourceId: "s", eventId: "e" }).success).toBe(true);
    expect(citationInput.safeParse({ sourceId: "s", eventId: "e", personId: "p" }).success).toBe(false);
  });
});

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const person = (id: string, birth: string | null, death: string | null, events: ConsistencyPerson["events"] = []): ConsistencyPerson => ({
  id,
  givenName: id,
  familyName: "Test",
  gender: "MALE",
  birthDate: birth ? d(birth) : null,
  deathDate: death ? d(death) : null,
  events,
});
const ev = (id: string, type: string, date: string, extra: Partial<NonNullable<ConsistencyPerson["events"]>[number]> = {}) => ({
  id,
  type: type as never,
  isAlternative: false,
  date: d(date),
  ...extra,
});

describe("Plausibilität mit Ereignissen und Ehestand", () => {
  it("Beerdigung vor Tod, Ereignis vor Geburt bzw. nach Tod; Alternativen zählen nicht", () => {
    const p = person("P", "1900-01-01", "1970-06-01", [
      ev("e1", "BURIAL", "1970-05-01"),
      ev("e2", "BAPTISM", "1899-12-01"),
      ev("e3", "OCCUPATION", "1980-01-01"),
      ev("e4", "PROBATE", "1971-01-01"),
      ev("e5", "BIRTH", "1890-01-01", { isAlternative: true }),
      ev("e6", "BURIAL", "1970-06-04"),
    ]);
    const issues = findConsistencyIssues([p], [], d("2025-01-01"));
    expect(issues.map((i) => i.kind).sort()).toEqual(["burialBeforeDeath", "eventAfterDeath", "eventBeforeBirth"]);
    expect(issues.find((i) => i.kind === "eventBeforeBirth")!.eventIds).toEqual(["e2"]);
    expect(issues.find((i) => i.kind === "eventAfterDeath")!.message).toContain("Beruf");
  });

  it("Bereich ohne sicheren Widerspruch wird nicht gemeldet", () => {
    const p = person("P", "1900-06-01", null, [ev("e1", "BAPTISM", "1899-01-01", { datePrecision: "YEAR", dateQualifier: "BETWEEN", dateTo: d("1901-01-01"), dateToPrecision: "YEAR" })]);
    expect(findConsistencyIssues([p], [], d("1950-01-01"))).toEqual([]);
  });

  it("Ehestand unbekannt: erlaubt bei PARTNER_OF, keine Überschneidung von Ehen, neutrale Bezeichnung", () => {
    expect(subtypeMatchesType("PARTNER_OF", "PARTNER_UNKNOWN")).toBe(true);
    expect(subtypeMatchesType("PARENT_OF", "PARTNER_UNKNOWN")).toBe(false);
    expect(relationshipInput.safeParse({ type: "PARTNER_OF", subtype: "PARTNER_UNKNOWN", fromPersonId: "a", toPersonId: "b" }).success).toBe(true);
    // Standard bleibt verheiratet.
    expect(relationshipInput.parse({ type: "PARTNER_OF", fromPersonId: "a", toPersonId: "b" }).subtype).toBe("MARRIED");

    const persons = [person("A", "1900-01-01", null), person("B", "1901-01-01", null), person("C", "1902-01-01", null)];
    const rel = (id: string, to: string, subtype: string, start: string): ConsistencyEdge => ({
      id, type: "PARTNER_OF", subtype, from: "A", to, startDate: d(start), endDate: null,
    });
    const married = findConsistencyIssues(persons, [rel("r1", "B", "MARRIED", "1925-01-01"), rel("r2", "C", "MARRIED", "1930-01-01")], d("2025-01-01"));
    expect(married.map((i) => i.kind)).toContain("overlappingMarriages");
    const unknown = findConsistencyIssues(persons, [rel("r1", "B", "MARRIED", "1925-01-01"), rel("r2", "C", "PARTNER_UNKNOWN", "1930-01-01")], d("2025-01-01"));
    expect(unknown.map((i) => i.kind)).not.toContain("overlappingMarriages");

    expect(stepTerm({ relation: "partner", subtype: "PARTNER_UNKNOWN", sex: "FEMALE" } as never)).toBe("Partnerin");
    expect(stepTerm({ relation: "partner", subtype: "MARRIED", sex: "FEMALE" } as never)).toBe("Ehefrau");
  });
});

describe("Import-Hilfen", () => {
  it("Fingerabdruck: stabil, unabhängig von Zusatzfeldern, empfindlich für Importfelder", () => {
    const row = { givenName: "Anna", familyName: "Becker", birthDate: d("1850-01-01"), birthDatePrecision: "YEAR", gender: "FEMALE" };
    const a = importFingerprint("PERSON", row);
    expect(importFingerprint("PERSON", { ...row, id: "x", updatedAt: new Date() })).toBe(a);
    expect(importFingerprint("PERSON", { ...row, familyName: undefined })).toBe(importFingerprint("PERSON", { ...row, familyName: null }));
    expect(importFingerprint("PERSON", { ...row, familyName: "Müller" })).not.toBe(a);
    expect(importFingerprint("EVENT", row)).not.toBe(a);
  });

  it("Datum im Massenimport", () => {
    expect(resolveBulkDate({ date: "1850" }).value).toMatchObject({ precision: "YEAR", qualifier: "EXACT" });
    expect(resolveBulkDate({ date: "1850-03" }).value).toMatchObject({ precision: "MONTH" });
    const r = resolveBulkDate({ date: "1850", qualifier: "BETWEEN", to: "1855" });
    expect(formatFuzzyDate(r.value)).toBe("zwischen 1850 und 1855");
    expect(resolveBulkDate({ phrase: "Weihnachten" })).toEqual({ value: null, phrase: "Weihnachten" });
    expect(resolveBulkDate({ date: "1850", to: "1855" }).error).toBeTruthy();
    expect(resolveBulkDate({ date: "18x0" }).error).toBeTruthy();
  });

  it("MCP-Format zeigt Bereiche und Wortlaut", () => {
    const f = dateFields("birthDate", "1850-01-01T00:00:00.000Z", "YEAR", "BETWEEN", { to: "1855-01-01T00:00:00.000Z", toPrecision: "YEAR" });
    expect(f).toMatchObject({ birthDate: "1850", birthDateTo: "1855", birthDateText: "zwischen 1850 und 1855" });
    expect(dateFields("birthDate", null, null, null, { phrase: "Weihnachten" })).toEqual({ birthDate: null, birthDateText: "Weihnachten" });
    expect(
      lifespan({ birthDate: "1850-01-01T00:00:00.000Z", birthDatePrecision: "YEAR", birthDateQualifier: "BETWEEN", birthDateTo: "1855-01-01T00:00:00.000Z", birthDateToPrecision: "YEAR", deathDate: null }),
    ).toBe("1850..1855 –");
  });
});

describe("Austauschformat Version 3", () => {
  it("liest Dateien der Version 1 und 2 unverändert", () => {
    const v1 = exchangeSchema.parse({
      version: 1,
      persons: [{ id: "p1", givenName: "Anna", birthDate: "1850-03-12T00:00:00.000Z" }],
      relationships: [{ id: "r1", type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: "p1", toPersonId: "p2" }],
    });
    expect(v1.events).toEqual([]);
    expect(v1.personNames).toEqual([]);
    expect(exchangeDateColumns("birthDate", v1.persons[0])).toMatchObject({
      birthDatePrecision: "DAY",
      birthDateQualifier: "EXACT",
      birthDateTo: null,
      birthDatePhrase: null,
    });
  });

  it("Rundlauf: Spalten → Datei → Spalten, inklusive Bereich, Wortlaut, Ereignis und Ehestand unbekannt", () => {
    const row = { ...fuzzyColumns("date", ok("zwischen 1850 und 1855")), datePhrase: "laut Kirchenbuch" };
    const file = exchangeSchema.parse({
      version: 3,
      persons: [{ id: "p1", givenName: "Anna", nickname: "Änne", deathCause: "Typhus" }],
      relationships: [{ id: "r1", type: "PARTNER_OF", subtype: "PARTNER_UNKNOWN", fromPersonId: "p1", toPersonId: "p2", startPlace: "Celle" }],
      events: [{ id: "e1", personId: "p1", type: "CUSTOM", label: "Goldene Hochzeit", ...JSON.parse(JSON.stringify(exportDateFields("date", row))) }],
      personNames: [{ id: "n1", personId: "p1", type: "MARRIED", familyName: "Schulz" }],
      citations: [{ id: "c1", sourceId: "s1", personId: "p1", eventId: "e1", fact: "EVENT" }],
    });
    const back = exchangeDateColumns("date", file.events[0]);
    expect(fuzzyField(back, "date")).toEqual(fuzzyField(row, "date"));
    expect(back.datePhrase).toBe("laut Kirchenbuch");
    expect(file.relationships[0].subtype).toBe("PARTNER_UNKNOWN");
    expect(file.persons[0].nickname).toBe("Änne");
  });
});
