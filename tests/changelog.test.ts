import { describe, expect, it } from "vitest";

import { defaultChangeSetTitle, fieldChanges } from "@/lib/audit";
import { nameChangeSet } from "@/lib/change-sets";
import { fuzzyColumns } from "@/lib/dates";

describe("Changelog: fieldChanges", () => {
  it("liefert nur wirklich geänderte Felder mit vorher und nachher", () => {
    const before = { givenName: "Anna", familyName: "Muster", notes: null };
    expect(fieldChanges(before, { givenName: "Anna", familyName: "Beispiel", notes: undefined })).toEqual({
      familyName: { from: "Muster", to: "Beispiel" },
    });
  });

  it("fasst die Spalten eines ungenauen Datums in Anzeigeform zusammen", () => {
    const before = {
      ...fuzzyColumns("birthDate", { date: new Date(Date.UTC(1850, 0, 1)), precision: "YEAR", qualifier: "ABOUT" }),
    };
    const patch = fuzzyColumns("birthDate", { date: new Date(Date.UTC(1850, 2, 12)), precision: "DAY", qualifier: "EXACT" });
    expect(fieldChanges(before, patch)).toEqual({ birthDate: { from: "um 1850", to: "12.03.1850" } });
  });

  it("erkennt ein gelöschtes Datum und ignoriert ein unverändertes", () => {
    const cols = fuzzyColumns("deathDate", { date: new Date(Date.UTC(1900, 0, 1)), precision: "YEAR", qualifier: "EXACT" });
    expect(fieldChanges(cols, { ...cols })).toEqual({});
    expect(fieldChanges(cols, fuzzyColumns("deathDate", null))).toEqual({ deathDate: { from: "1900", to: null } });
  });

  it("vergleicht Datumswerte und Listen inhaltlich", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(fieldChanges({ expiresAt: d, families: ["a", "b"] }, { expiresAt: new Date(d), families: ["a", "b"] })).toEqual({});
    expect(fieldChanges({ families: ["a"] }, { families: ["a", "b"] })).toEqual({ families: { from: ["a"], to: ["a", "b"] } });
  });
});

describe("Changelog: Paket-Titel", () => {
  it("Standardtitel aus dem ersten Eintrag", () => {
    expect(defaultChangeSetTitle({ action: "UPDATE", entityType: "Person" })).toBe("Person geändert");
    expect(defaultChangeSetTitle({ action: "CREATE", entityType: "Citation" })).toBe("Beleg angelegt");
    expect(defaultChangeSetTitle({ action: "MERGE", entityType: "Person" })).toBe("Personen zusammengeführt");
  });

  it("nameChangeSet: der erste Titel gewinnt, feste Titel bleiben", () => {
    const scope = { changeSet: { kind: "APP" as const } };
    nameChangeSet(scope, "Sammel-Zusammenführen (3 Paare)", "MERGE");
    nameChangeSet(scope, "Personen zusammengeführt", "MERGE");
    expect(scope.changeSet).toMatchObject({ title: "Sammel-Zusammenführen (3 Paare)", kind: "MERGE" });

    const mcp = { changeSet: { kind: "MCP" as const, title: "Kirchenbuch ausgewertet", fixed: true } };
    nameChangeSet(mcp, "Personen zusammengeführt");
    expect(mcp.changeSet.title).toBe("Kirchenbuch ausgewertet");

    const none: { changeSet?: undefined } = {};
    expect(() => nameChangeSet(none, "x")).not.toThrow();
  });
});
