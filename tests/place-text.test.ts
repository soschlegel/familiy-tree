import { describe, expect, it } from "vitest";

import { textCoveredByLabel } from "@/components/PlaceText";

describe("Ortsanzeige: braucht es den eingegebenen Text neben dem Ortsnamen?", () => {
  it("nein, wenn der Ortsname alles enthält", () => {
    expect(textCoveredByLabel("Karlsruhe", "Karlsruhe, Baden-Württemberg, Deutschland")).toBe(true);
    expect(textCoveredByLabel("Danzig", "Gdańsk (Danzig), Polen")).toBe(true);
    expect(textCoveredByLabel(" karlsruhe , Deutschland ", "Karlsruhe, Baden-Württemberg, Deutschland")).toBe(true);
  });

  it("ja, wenn der Text mehr sagt (Anschrift, alte Landschaft)", () => {
    expect(textCoveredByLabel("Hannover, Lister Meile 12", "Hannover, Niedersachsen, Deutschland")).toBe(false);
    expect(textCoveredByLabel("Breslau, Schlesien, Preußen", "Wrocław (Breslau), Polen")).toBe(false);
  });
});
