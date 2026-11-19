import { describe, expect, it } from "vitest";

import { appendResearchNote, dateFields, displayName, lifespan, ref } from "@/mcp/format";

describe("MCP-Formatierung", () => {
  it("einheitliche Personenreferenz", () => {
    expect(
      ref({
        id: "p1",
        givenName: "Anna",
        familyName: "Müller",
        birthName: "Becker",
        birthDate: "1890-03-12T00:00:00.000Z",
        deathDate: null,
        restricted: false,
      }),
    ).toEqual({ id: "p1", name: "Anna Müller (geb. Becker)", lifespan: "1890-03-12 –" });

    expect(
      ref({ id: "p2", givenName: "Nicht freigegeben", familyName: null, birthDate: null, deathDate: null, restricted: true }),
    ).toEqual({ id: "p2", name: "Nicht freigegeben", restricted: true });
  });

  it("Lebensspanne mit unbekannten Daten", () => {
    expect(lifespan({ birthDate: null, deathDate: null })).toBe("?");
    expect(lifespan({ birthDate: null, deathDate: "1950-01-02T00:00:00.000Z" })).toBe("? – 1950-01-02");
    expect(displayName({ givenName: "Karl", familyName: null, birthName: null })).toBe("Karl");
  });

  it("Recherchenotiz wird angehängt, nicht ersetzt", () => {
    const now = new Date("2026-11-16T10:00:00Z");
    expect(appendResearchNote(null, "Taufe gefunden", { now })).toBe("[2026-11-16, KI-Recherche] Taufe gefunden");
    expect(appendResearchNote("Alte Notiz\n", " Taufe gefunden ", { source: "KB Celle 1891", now })).toBe(
      "Alte Notiz\n\n[2026-11-16, KI-Recherche] Taufe gefunden (Quelle: KB Celle 1891)",
    );
  });

  it("ungenaue Daten: ISO in Genauigkeit mit Zusatz, Felder mit Text", () => {
    expect(
      lifespan({
        birthDate: "1850-01-01T00:00:00.000Z",
        birthDatePrecision: "YEAR",
        birthDateQualifier: "ABOUT",
        deathDate: "1900-01-01T00:00:00.000Z",
        deathDatePrecision: "YEAR",
        deathDateQualifier: "BEFORE",
      }),
    ).toBe("um 1850 – vor 1900");
    expect(lifespan({ birthDate: "1850-03-01T00:00:00.000Z", birthDatePrecision: "MONTH", deathDate: null })).toBe("1850-03 –");
    expect(dateFields("birthDate", "1850-03-01T00:00:00.000Z", "MONTH", "EXACT")).toEqual({
      birthDate: "1850-03",
      birthDatePrecision: "MONTH",
      birthDateQualifier: "EXACT",
      birthDateText: "März 1850",
    });
    expect(dateFields("deathDate", null)).toEqual({ deathDate: null });
  });
});
