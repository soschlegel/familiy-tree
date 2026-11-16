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
