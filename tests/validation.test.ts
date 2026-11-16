import { describe, expect, it } from "vitest";

import {
  defaultSubtype,
  personCreateInput,
  personDateIssues,
  personInput,
  personPatch,
  relationshipInput,
  relationshipIssues,
  relationshipPatch,
  citationInput,
  sourceInput,
  subtypeMatchesType,
} from "@/lib/validation";

const d = (s: string) => new Date(s);
const NOW = d("2026-01-01T00:00:00Z");

describe("personDateIssues", () => {
  it("akzeptiert plausible Daten", () => {
    expect(personDateIssues({ birthDate: d("1950-03-01"), deathDate: d("2020-01-01") }, NOW)).toEqual([]);
    expect(personDateIssues({}, NOW)).toEqual([]);
  });

  it("Sterbedatum vor Geburt", () => {
    const issues = personDateIssues({ birthDate: d("1950-03-01"), deathDate: d("1949-01-01") }, NOW);
    expect(issues.map((i) => i.path)).toEqual(["deathDate"]);
  });

  it("Jahr vor 1000 und Geburt in der Zukunft", () => {
    expect(personDateIssues({ birthDate: d("0999-01-01") }, NOW)).toHaveLength(1);
    expect(personDateIssues({ birthDate: d("2030-01-01") }, NOW)).toHaveLength(1);
    expect(personDateIssues({ deathDate: d("2030-01-01") }, NOW)).toHaveLength(1);
  });
});

describe("Beziehungsregeln", () => {
  it("Art muss zum Typ passen", () => {
    expect(subtypeMatchesType("PARENT_OF", "ADOPTIVE")).toBe(true);
    expect(subtypeMatchesType("PARENT_OF", "MARRIED")).toBe(false);
    expect(subtypeMatchesType("PARTNER_OF", "DIVORCED")).toBe(true);
    expect(subtypeMatchesType("PARTNER_OF", "BIOLOGICAL")).toBe(false);
  });

  it("Standardart je Typ", () => {
    expect(defaultSubtype("PARENT_OF")).toBe("BIOLOGICAL");
    expect(defaultSubtype("PARTNER_OF")).toBe("MARRIED");
  });

  it("Ende vor Beginn", () => {
    const issues = relationshipIssues(
      { type: "PARTNER_OF", subtype: "DIVORCED", startDate: d("1990-01-01"), endDate: d("1980-01-01") },
      NOW,
    );
    expect(issues.map((i) => i.path)).toEqual(["endDate"]);
  });

  it("Datum weit in der Zukunft oder vor 1000", () => {
    expect(relationshipIssues({ type: "PARTNER_OF", subtype: "MARRIED", startDate: d("2040-01-01") }, NOW)).toHaveLength(1);
    expect(relationshipIssues({ type: "PARTNER_OF", subtype: "MARRIED", startDate: d("0900-01-01") }, NOW)).toHaveLength(1);
  });
});

describe("Zod-Schemata", () => {
  it("personInput lehnt Sterbedatum vor Geburt ab", () => {
    const r = personInput.safeParse({ givenName: "Anna", birthDate: "1950-01-01", deathDate: "1940-01-01" });
    expect(r.success).toBe(false);
  });

  it("personInput normalisiert leere Texte zu null", () => {
    const r = personInput.parse({ givenName: " Anna ", familyName: "", birthDate: "" });
    expect(r).toMatchObject({ givenName: "Anna", familyName: null, birthDate: null, gender: "UNKNOWN" });
  });

  it("personPatch lässt fehlende Felder unverändert (undefined)", () => {
    const r = personPatch.parse({ notes: "x" });
    expect(r.birthDate).toBeUndefined();
    expect(r.givenName).toBeUndefined();
    expect(r.gender).toBeUndefined();
  });

  it("personCreateInput akzeptiert familyIds", () => {
    expect(personCreateInput.parse({ givenName: "A", familyIds: ["f1"] }).familyIds).toEqual(["f1"]);
    expect(personCreateInput.safeParse({ givenName: "A", familyIds: [1] }).success).toBe(false);
  });

  it("relationshipInput setzt die Standardart je Typ", () => {
    expect(relationshipInput.parse({ type: "PARTNER_OF", fromPersonId: "a", toPersonId: "b" }).subtype).toBe("MARRIED");
    expect(relationshipInput.parse({ type: "PARENT_OF", fromPersonId: "a", toPersonId: "b" }).subtype).toBe("BIOLOGICAL");
  });

  it("relationshipInput lehnt falsche Kombinationen und Selbstbezug ab", () => {
    expect(relationshipInput.safeParse({ type: "PARENT_OF", subtype: "MARRIED", fromPersonId: "a", toPersonId: "b" }).success).toBe(false);
    expect(relationshipInput.safeParse({ type: "PARTNER_OF", subtype: "STEP", fromPersonId: "a", toPersonId: "b" }).success).toBe(false);
    expect(relationshipInput.safeParse({ type: "PARTNER_OF", fromPersonId: "a", toPersonId: "a" }).success).toBe(false);
  });

  it("relationshipInput akzeptiert alle Kombinationen der Oberfläche", () => {
    for (const subtype of ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"]) {
      expect(relationshipInput.safeParse({ type: "PARENT_OF", subtype, fromPersonId: "a", toPersonId: "b", startDate: null, endDate: null }).success).toBe(true);
    }
    for (const subtype of ["MARRIED", "UNMARRIED", "DIVORCED"]) {
      expect(relationshipInput.safeParse({ type: "PARTNER_OF", subtype, fromPersonId: "a", toPersonId: "b", startDate: "1980-05-01", endDate: null }).success).toBe(true);
    }
  });

  it("relationshipPatch: fehlende Datumsfelder bleiben undefined, null löscht", () => {
    expect(relationshipPatch.parse({ subtype: "DIVORCED" }).startDate).toBeUndefined();
    expect(relationshipPatch.parse({ startDate: null }).startDate).toBeNull();
  });
});

describe("Ungenaue Daten in der Validierung", () => {
  const f = (input: string) => personInput.parse({ givenName: "A", birthDate: input }).birthDate;

  it("Eingabeformen werden zu Anker, Genauigkeit und Zusatz", () => {
    expect(f("um 1850")).toMatchObject({ precision: "YEAR", qualifier: "ABOUT" });
    expect(f("03.1850")).toMatchObject({ precision: "MONTH", qualifier: "EXACT" });
    expect(f("1950-01-01")).toMatchObject({ precision: "DAY", qualifier: "EXACT" });
    expect(f("")).toBeNull();
  });

  it("unlesbare Eingabe: deutsche Meldung am Feld", () => {
    const r = personInput.safeParse({ givenName: "A", birthDate: "irgendwann" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["birthDate"]);
      expect(r.error.issues[0].message).toContain("kein erkennbares Datum");
    }
  });

  it("Plausibilität nach Zeitraum: nur sichere Widersprüche", () => {
    // Geboren „um 1850“, gestorben 1849: möglich.
    expect(personInput.safeParse({ givenName: "A", birthDate: "um 1850", deathDate: "1849" }).success).toBe(true);
    // Geboren 12.03.1850, gestorben „1850“ (nur Jahr): möglich.
    expect(personInput.safeParse({ givenName: "A", birthDate: "12.03.1850", deathDate: "1850" }).success).toBe(true);
    // Gestorben vor 1840, geboren 1850: unmöglich.
    expect(personInput.safeParse({ givenName: "A", birthDate: "1850", deathDate: "vor 1840" }).success).toBe(false);
    // Geburt im laufenden Jahr ist erlaubt, „nach“ dem laufenden Jahr nicht.
    const now = new Date(Date.UTC(2026, 10, 16));
    const y2026 = new Date(Date.UTC(2026, 0, 1));
    expect(personDateIssues({ birthDate: { date: y2026, precision: "YEAR", qualifier: "EXACT" } }, now)).toEqual([]);
    expect(
      personDateIssues({ birthDate: { date: y2026, precision: "YEAR", qualifier: "AFTER" } }, now).map((i) => i.path),
    ).toEqual(["birthDate"]);
  });

  it("Beziehungen: Ende vor Beginn nur, wenn sicher", () => {
    const base = { type: "PARTNER_OF", subtype: "DIVORCED", fromPersonId: "a", toPersonId: "b" };
    expect(relationshipInput.safeParse({ ...base, startDate: "1950", endDate: "03.1950" }).success).toBe(true);
    expect(relationshipInput.safeParse({ ...base, startDate: "1950", endDate: "vor 1950" }).success).toBe(false);
  });
});

describe("Quellen und Belege (Schemata)", () => {
  it("Quelle: Titel Pflicht, URL nur http(s), Datum ungenau erlaubt", () => {
    expect(sourceInput.safeParse({ title: "" }).success).toBe(false);
    expect(sourceInput.safeParse({ title: "KB", url: "ftp://x" }).success).toBe(false);
    const r = sourceInput.parse({ title: " KB Celle ", kind: "CHURCH_BOOK", date: "um 1880", url: "" });
    expect(r).toMatchObject({ title: "KB Celle", kind: "CHURCH_BOOK", url: null, date: { precision: "YEAR", qualifier: "ABOUT" } });
  });

  it("Beleg: genau ein Bezug", () => {
    expect(citationInput.safeParse({ sourceId: "s", fact: "BIRTH" }).success).toBe(false);
    expect(citationInput.safeParse({ sourceId: "s", personId: "p", relationshipId: "r", fact: "BIRTH" }).success).toBe(false);
    expect(citationInput.parse({ sourceId: "s", personId: "p" })).toMatchObject({ fact: "OTHER", confidence: null });
  });
});
