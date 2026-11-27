/**
 * „Ahnentafel zum Drucken“ (lib/rings-print.ts): Blattmaße je Format und
 * Ausrichtung, @page-Regel, Adresse hin und zurück, Titelvorgabe,
 * Dateiname, Umbruch, Aufteilung des Blatts, Beschriftung nach Blattmaß,
 * feste Druckfarben (gleich dem hellen Schema in app/globals.css) und
 * Kontrast. Rein, ohne Datenbank.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ringGeometry } from "@/lib/ancestor-rings";
import {
  cleanPrintTitle,
  contrast,
  defaultPrintTitle,
  luminance,
  mixHex,
  pageRule,
  PAPER_FORMAT_KEYS,
  parseRingsPrintParams,
  printColor,
  printFileName,
  printLabelFontPx,
  printLabelPlan,
  printPattern,
  printPxPerUnit,
  printTint,
  PRINT_COLORS,
  PRINT_INK,
  ringsPrintUrl,
  sheetLayout,
  sheetSize,
  wrapText,
} from "@/lib/rings-print";

describe("Blattmaße", () => {
  it("DIN-A-Formate hoch und quer in Millimetern", () => {
    expect(sheetSize("a4", "hoch")).toEqual({ width: 210, height: 297 });
    expect(sheetSize("a4", "quer")).toEqual({ width: 297, height: 210 });
    expect(sheetSize("a3", "hoch")).toEqual({ width: 297, height: 420 });
    expect(sheetSize("a2", "quer")).toEqual({ width: 594, height: 420 });
    expect(sheetSize("a1", "hoch")).toEqual({ width: 594, height: 841 });
    expect(sheetSize("a0", "hoch")).toEqual({ width: 841, height: 1189 });
    // Jedes nächstkleinere Format ist die halbe lange Seite.
    for (let i = 1; i < PAPER_FORMAT_KEYS.length; i++) {
      const big = sheetSize(PAPER_FORMAT_KEYS[i], "hoch");
      const small = sheetSize(PAPER_FORMAT_KEYS[i - 1], "hoch");
      expect(Math.abs(big.height / 2 - small.width)).toBeLessThanOrEqual(1);
    }
  });

  it("@page: Blattmaß, kein Rand", () => {
    expect(pageRule("a3", "quer")).toBe("@page { size: 420mm 297mm; margin: 0; }");
    expect(pageRule("a4", "hoch")).toBe("@page { size: 210mm 297mm; margin: 0; }");
  });
});

describe("Adresse", () => {
  it("Vorgaben bleiben weg, alles andere hin und zurück", () => {
    expect(ringsPrintUrl({ focus: "p1" })).toBe("/tree/print?focus=p1");
    expect(ringsPrintUrl({ focus: "p1", direction: "vorfahren", generations: 5, coloring: "linie", format: "a4", orientation: "hoch", date: true, outerNames: true })).toBe(
      "/tree/print?focus=p1",
    );
    const url = ringsPrintUrl({
      focus: "p1",
      direction: "nachfahren",
      generations: 6,
      coloring: "wurzeln",
      format: "a1",
      orientation: "quer",
      title: "  Zum Fest  ",
      date: false,
      outerNames: false,
    });
    expect(url).toBe("/tree/print?focus=p1&richtung=nachfahren&generationen=6&farbe=wurzeln&format=a1&ausrichtung=quer&titel=Zum+Fest&datum=0&namen=0");
    const params = Object.fromEntries(new URL(url, "http://x").searchParams);
    expect(parseRingsPrintParams(params)).toEqual({
      focus: "p1",
      direction: "nachfahren",
      generations: 6,
      coloring: "wurzeln",
      format: "a1",
      orientation: "quer",
      title: "Zum Fest",
      date: false,
      outerNames: false,
    });
  });

  it("Unbekanntes fällt auf die Vorgabe zurück", () => {
    const s = parseRingsPrintParams({ focus: "../x", format: "a9", ausrichtung: "schief", generationen: "99", richtung: "seitwärts" });
    expect(s).toMatchObject({ focus: null, format: "a4", orientation: "hoch", generations: 7, direction: "vorfahren", date: true, outerNames: true, title: "" });
    expect(parseRingsPrintParams({ richtung: "nachfahren" }).generations).toBe(4);
    expect(parseRingsPrintParams({ format: "A3" }).format).toBe("a3");
  });

  it("Titel: ohne Steuerzeichen, Leerraum zusammengefasst, höchstens 80 Zeichen", () => {
    expect(cleanPrintTitle(" Familie\n\tBeispiel ")).toBe("Familie Beispiel");
    expect(cleanPrintTitle("x".repeat(200))).toHaveLength(80);
    expect(cleanPrintTitle(42)).toBe("");
  });
});

describe("Texte", () => {
  it("Titelvorgabe nach Richtung", () => {
    expect(defaultPrintTitle("vorfahren", "Anna Beispiel")).toBe("Vorfahren von Anna Beispiel");
    expect(defaultPrintTitle("nachfahren", "Anna Beispiel")).toBe("Nachfahren von Anna Beispiel");
  });

  it("Dateiname: Richtung, Name (Umlaute umschrieben), Format, Ausrichtung", () => {
    expect(printFileName("vorfahren", "Jörg Weiß-Müller", "a3", "hoch")).toBe("vorfahren-joerg-weiss-mueller-a3-hoch.svg");
    expect(printFileName("nachfahren", "Élise  O'Brien", "a0", "quer")).toBe("nachfahren-elise-o-brien-a0-quer.svg");
    expect(printFileName("vorfahren", "???", "a4", "hoch")).toBe("vorfahren-person-a4-hoch.svg");
  });

  it("Umbruch an Leerzeichen, Rest gekürzt", () => {
    expect(wrapText("VV Großvater väterlicherseits: Paul Beispiel", 20)).toEqual(["VV Großvater", "väterlicherseits: P…"]);
    expect(wrapText("VV Großvater väterlicherseits: Paul Beispiel", 20, 3)).toEqual(["VV Großvater", "väterlicherseits:", "Paul Beispiel"]);
    expect(wrapText("kurz", 20)).toEqual(["kurz"]);
    expect(wrapText("Donaudampfschifffahrtsgesellschaft", 10)).toEqual(["Donaudamp…"]);
  });
});

describe("Aufteilung des Blatts", () => {
  const input = {
    title: "Vorfahren von Anna Beispiel",
    subtitle: "Ahnentafel über 5 Generationen · Stand: 1. Januar 2030",
    footer: "14 von 62 Vorfahren bis zur 5. Generation bekannt",
    legendHeading: "Farben nach Linie",
    legendItems: ["VV Großvater väterlicherseits: Paul Beispiel", "VM Großmutter väterlicherseits: Erna Muster", "MV Großvater mütterlicherseits: nicht erfasst", "MM", "nicht freigegeben", "nicht erfasst"],
  };

  for (const format of PAPER_FORMAT_KEYS) {
    for (const orientation of ["hoch", "quer"] as const) {
      it(`${format} ${orientation}: alles innerhalb der Ränder, Kreis überlappt nichts`, () => {
        const l = sheetLayout({ ...input, format, orientation });
        const { width, height } = sheetSize(format, orientation);
        const { cx, cy, diameter: d } = l.chart;
        const r = d / 2;
        expect(cx - r).toBeGreaterThanOrEqual(l.margin - 0.01);
        expect(cx + r).toBeLessThanOrEqual(width - l.margin + 0.01);
        expect(cy - r).toBeGreaterThan(l.subtitle!.y);
        expect(cy + r).toBeLessThan(l.footer.y - l.footer.size);
        // Der Kreis ist groß: mindestens 60 % der kurzen Seite.
        expect(d).toBeGreaterThan(0.6 * Math.min(width, height));
        expect(l.legend.hidden).toBe(0);
        expect(l.legend.items).toHaveLength(input.legendItems.length);
        for (const it of l.legend.items) {
          expect(it.x).toBeGreaterThanOrEqual(l.margin - 0.01);
          const bottom = it.y + it.lines.length * l.legend.lineHeight;
          expect(bottom).toBeLessThan(l.footer.y - l.footer.size);
          // Legende neben bzw. unter dem Kreis, nie darin.
          const inside = Math.hypot(Math.max(it.x, Math.min(cx, it.x + 30)) - cx, it.y - cy) < r && orientation === "hoch";
          if (orientation === "hoch") expect(it.y).toBeGreaterThan(cy + r);
          else expect(it.x + l.legend.textOffset).toBeLessThan(cx - r);
          expect(inside).toBe(false);
        }
      });
    }
  }

  it("ohne Untertitel wird der Kreis nicht kleiner, und Größen wachsen mit dem Papier", () => {
    const a4 = sheetLayout({ ...input, format: "a4", orientation: "quer" });
    const a4ohne = sheetLayout({ ...input, subtitle: null, format: "a4", orientation: "quer" });
    expect(a4ohne.subtitle).toBeNull();
    expect(a4ohne.chart.diameter).toBeGreaterThanOrEqual(a4.chart.diameter);
    const a1 = sheetLayout({ ...input, format: "a1", orientation: "quer" });
    expect(a1.title.size).toBeGreaterThan(a4.title.size * 2);
    expect(a1.legend.size).toBeGreaterThan(a4.legend.size * 2);
  });

  it("sehr langer Titel wird schmaler statt überzulaufen", () => {
    const l = sheetLayout({ ...input, title: "X".repeat(80), format: "a4", orientation: "hoch" });
    expect(l.title.size * 0.56 * 80).toBeLessThanOrEqual(210 - 2 * l.margin + 0.01);
  });

  it("zu viele Legendeneinträge: der Rest wird gezählt", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Eintrag ${i}`);
    const l = sheetLayout({ ...input, legendItems: many, format: "a4", orientation: "quer" });
    expect(l.legend.hidden).toBeGreaterThan(0);
    expect(l.legend.items.length + l.legend.hidden).toBe(200);
  });
});

describe("Beschriftung nach Blattmaß", () => {
  it("Schrift wächst mit dem Papier, aber langsamer als das Blatt", () => {
    const a4 = printLabelFontPx(1, 1, true)!;
    const a0 = printLabelFontPx(1, 841 / 210, true)!;
    expect(a0).toBeGreaterThan(a4);
    expect(a0 / a4).toBeLessThan(841 / 210);
    expect(printLabelFontPx(5, 1, true)!).toBeLessThan(printLabelFontPx(4, 1, true)!);
    expect(printLabelFontPx(5, 1, false)).toBeNull();
    expect(printLabelFontPx(4, 1, false)).not.toBeNull();
  });

  it("auf großem Papier passen in mehr Ringen ganze Namen als auf A4", () => {
    const g = ringGeometry(7);
    const fullNames = (format: "a4" | "a1") => {
      const l = sheetLayout({ format, orientation: "hoch", title: "T", subtitle: null, footer: "F", legendHeading: "L", legendItems: ["a", "b"] });
      const ppu = printPxPerUnit(l.chart.diameter);
      return g.rings.filter((ring) => {
        const plan = printLabelPlan(ring, 1 / 2 ** ring.generation, ppu, l.scale, true, 14);
        return plan.mode !== "none" && plan.maxChars >= 14;
      }).length;
    };
    expect(fullNames("a1")).toBeGreaterThan(fullNames("a4"));
    expect(fullNames("a1")).toBeGreaterThanOrEqual(4);
  });

  it("ohne „Namen in den äußeren Ringen“ bleiben sie unbeschriftet", () => {
    const g = ringGeometry(7);
    const plan = printLabelPlan(g.rings[5], 1 / 64, printPxPerUnit(500), 2.83, false, 10);
    expect(plan.mode).toBe("none");
    expect(printLabelPlan(g.rings[5], 1 / 64, printPxPerUnit(500), 2.83, true, 10).mode).not.toBe("none");
  });
});

describe("Druckfarben", () => {
  it("entsprechen den Werten des hellen Schemas in app/globals.css", () => {
    const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
    // Nur die Blöcke außerhalb von @media (prefers-color-scheme: dark).
    const light = css.replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/g, "");
    for (const [name, value] of Object.entries(PRINT_COLORS)) {
      const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(light);
      expect(m?.[1]?.toLowerCase(), name).toBe(value);
    }
  });

  it("löst Variablen und Mischungen der Bildschirmansicht in feste Farben auf", () => {
    expect(printColor("var(--line-ff)")).toBe("#0072b2");
    expect(printColor("var(--chart-3)")).toBe("#c43c1e");
    expect(printColor("color-mix(in srgb, var(--line-ff), var(--line-fm))")).toBe(mixHex("#0072b2", "#00866a", 50));
    expect(printColor("var(--gibt-es-nicht)")).toBe(PRINT_COLORS["--chart-unknown"]);
    expect(printColor("#ABCDEF")).toBe("#abcdef");
    expect(mixHex("#000000", "#ffffff", 50)).toBe("#808080");
    expect(printTint("var(--line-mm)", 0)).toBe("#ffffff");
  });

  it("Schrift auf jeder Fläche gut lesbar (Kontrast ≥ 4,5)", () => {
    const steps = [50, 48, 40, 33, 27, 22, 18, 55, 70];
    for (const name of Object.keys(PRINT_COLORS)) {
      if (name === "--rings-ink") continue;
      for (const p of steps) expect(contrast(PRINT_INK, printTint(`var(${name})`, p)), `${name} ${p}%`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("Graustufen: Linien unterscheiden sich durch Muster, wo die Helligkeit zu ähnlich ist", () => {
    const lines = ["--line-ff", "--line-fm", "--line-mf", "--line-mm"].map((n, i) => ({ l: luminance(printTint(`var(${n})`, 50)), pattern: printPattern(i) }));
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const similar = Math.abs(lines[a].l - lines[b].l) < 0.15;
        if (similar) expect(lines[a].pattern).not.toBe(lines[b].pattern);
      }
    }
    expect(new Set([0, 1, 2, 3].map(printPattern)).size).toBe(4);
    expect(printPattern(4)).toBe(0);
  });
});
