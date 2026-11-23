/**
 * Herkunft: Buchstaben und Farben der Importe (lib/origin.ts) — reine Regeln.
 */
import { describe, expect, it } from "vitest";

import {
  contrast,
  importLetter,
  limitChips,
  MANUAL_KEY,
  MANUAL_ORIGIN,
  ORIGIN_CHIP_LIMIT,
  ORIGIN_COLORS,
  originColor,
  originText,
} from "@/lib/origin";

describe("Buchstaben der Importe", () => {
  it("A, B, C … in der Reihenfolge des ersten Imports — ohne H (steht für „von Hand“)", () => {
    expect(Array.from({ length: 9 }, (_, i) => importLetter(i))).toEqual(["A", "B", "C", "D", "E", "F", "G", "I", "J"]);
    expect(importLetter(24)).toBe("Z");
  });

  it("nach Z zweistellig, eindeutig und nie mit H", () => {
    expect(importLetter(25)).toBe("AA");
    expect(importLetter(26)).toBe("AB");
    const letters = Array.from({ length: 700 }, (_, i) => importLetter(i));
    expect(new Set(letters).size).toBe(letters.length);
    expect(letters.some((l) => l.includes(MANUAL_KEY))).toBe(false);
  });

  it("derselbe Platz ergibt immer denselben Buchstaben und dieselbe Farbe", () => {
    for (const i of [0, 3, 7, 12, 40]) {
      expect(importLetter(i)).toBe(importLetter(i));
      expect(originColor(i)).toBe(originColor(i));
    }
  });
});

describe("Farben (Okabe-Ito)", () => {
  it("sieben Farben ohne Schwarz, danach wiederholen sie sich — der Buchstabe bleibt eindeutig", () => {
    expect(ORIGIN_COLORS.map((c) => c.bg)).toEqual(["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]);
    expect(originColor(0).bg).toBe("#E69F00");
    expect(originColor(7)).toBe(originColor(0));
    expect(importLetter(7)).not.toBe(importLetter(0));
  });

  it("Schrift auf jedem Chip mit Kontrast ≥ 4,5:1", () => {
    for (const c of ORIGIN_COLORS) expect(contrast(c.bg, c.fg), c.name).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Chips", () => {
  it("höchstens drei, dann „+n“", () => {
    expect(ORIGIN_CHIP_LIMIT).toBe(3);
    expect(limitChips(["A", "B", "C"])).toEqual({ shown: ["A", "B", "C"], more: 0 });
    expect(limitChips(["A", "B", "C", "D", "E"])).toEqual({ shown: ["A", "B", "C"], more: 2 });
    expect(limitChips([])).toEqual({ shown: [], more: 0 });
  });

  it("nie nur Farbe: jeder Chip hat einen Text", () => {
    expect(originText({ letter: "B", name: "Stammbaum Muster", manual: false })).toBe("Import B: Stammbaum Muster");
    expect(originText(MANUAL_ORIGIN)).toBe("von Hand erfasst");
    expect(MANUAL_ORIGIN.letter).toBe("H");
    expect(MANUAL_ORIGIN.color).toBeNull();
  });
});
