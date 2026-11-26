import { describe, expect, it } from "vitest";

import { labelLines } from "@/components/OriginOverview";

describe("labelLines (Beschriftung der Kreise in der Herkunfts-Übersicht)", () => {
  it("kurze Namen bleiben eine Zeile", () => {
    expect(labelLines("Kirchenbuch-Auszug", 20)).toEqual(["Kirchenbuch-Auszug"]);
  });

  it("bricht nach Wörtern um, höchstens zwei Zeilen", () => {
    expect(labelLines("Stammbaum von Tante Erika", 20)).toEqual(["Stammbaum von Tante", "Erika"]);
  });

  it("bricht lange Wörter nach dem Bindestrich um", () => {
    expect(labelLines("Familienforschung Musterhausen-Oberdorf", 20)).toEqual(["Familienforschung", "Musterhausen-Oberdo…"]);
    expect(labelLines("Musterhausen-Oberdorf", 20)).toEqual(["Musterhausen-", "Oberdorf"]);
  });

  it("kürzt, was nicht in zwei Zeilen passt, mit …", () => {
    const lines = labelLines("Ein sehr langer Name für einen Import aus der Ferne", 16);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines.every((l) => l.length <= 16)).toBe(true);
  });
});
