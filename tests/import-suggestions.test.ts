/**
 * Vorschläge beim GEDCOM-Import: derselbe Abgleich wie „Importe verbinden“
 * (lib/import-linking.ts), mit `focus` auf die neuen Personen einer Datei.
 * Gegen erfundene Wahrheit (tests/fixtures/linking-generator.ts, mit Fallen):
 * vorhandene Daten = alle Importe bis auf den letzten, Datei = der letzte.
 * „sicher“ muss fehlerfrei sein; „focus“ darf an den Paaren mit der Datei
 * nichts ändern, nur die Paare innerhalb des Bestands weglassen.
 */
import { describe, expect, it } from "vitest";

import { linkImports, type LinkPerson } from "@/lib/import-linking";
import { pairDifferences, suggestionClass } from "@/lib/services/import-suggestions";
import { toFuzzyDate } from "@/lib/dates";
import { generate } from "./fixtures/linking-generator";

function scenario(families: number, imports: number, seed: number, coverage: number, fileLimit?: number) {
  const g = generate({ families, generations: 6, imports, seed, coverage });
  const existing = g.imports.slice(0, -1).flat();
  const last = g.imports[g.imports.length - 1];
  const keep = new Set((fileLimit ? last.slice(0, fileLimit) : last).map((p) => p.id));
  const file: LinkPerson[] = last
    .filter((p) => keep.has(p.id))
    .map((p) => ({
      ...p,
      group: "@datei",
      parents: p.parents.filter((x) => keep.has(x)),
      partners: p.partners.filter((x) => keep.has(x)),
      children: p.children.filter((x) => keep.has(x)),
    }));
  return { g, existing, file, focus: new Set(file.map((p) => p.id)) };
}

describe("Vorschläge beim Import — Genauigkeit", () => {
  const cases = [
    [12, 3, 1, 0.6],
    [12, 3, 7, 0.6],
    [12, 3, 42, 0.6],
    [60, 2, 3, 0.8],
    [60, 5, 3, 0.45],
    [40, 3, 11, 0.6],
    [50, 4, 23, 0.5],
  ] as const;
  it("„sicher“ und „sehr wahrscheinlich“ ohne Fehler, „wahrscheinlich“ ≥ 99 %", () => {
    const total = { high: [0, 0], veryLikely: [0, 0], medium: [0, 0], low: [0, 0] } as Record<string, [number, number]>;
    for (const [families, imports, seed, coverage] of cases) {
      const { g, existing, file, focus } = scenario(families, imports, seed, coverage);
      const r = linkImports([...existing, ...file], { focus });
      for (const p of r.pairs) {
        // Nur Paare Datei × Bestand.
        expect(focus.has(p.a) !== focus.has(p.b)).toBe(true);
        const cls = suggestionClass(p);
        total[cls][0]++;
        if (g.truthOf.get(p.a) === g.truthOf.get(p.b)) total[cls][1]++;
      }
    }
    console.log(
      "[Importvorschlag] " +
        Object.entries(total)
          .map(([k, [n, ok]]) => `${k}: ${n} Paare, ${ok} richtig (${n ? ((ok / n) * 100).toFixed(1) : "-"} %)`)
          .join("; "),
    );
    expect(total.high[1]).toBe(total.high[0]);
    expect(total.veryLikely[1]).toBe(total.veryLikely[0]);
    expect(total.medium[1] / total.medium[0]).toBeGreaterThan(0.99);
  }, 120_000);

  it("focus ändert an den Paaren mit der Datei nichts — außer der Eindeutigkeit gegenüber Bestand-Paaren", () => {
    const { existing, file, focus } = scenario(12, 3, 42, 0.6);
    const withFocus = linkImports([...existing, ...file], { focus });
    const without = linkImports([...existing, ...file]);
    const key = (p: { a: string; b: string }) => `${p.a}|${p.b}`;
    const fileSure = new Set(without.pairs.filter((p) => p.confidence === "high" && (focus.has(p.a) || focus.has(p.b))).map(key));
    const focusSure = new Set(withFocus.pairs.filter((p) => p.confidence === "high").map(key));
    // Jedes „sicher“ mit Fokus ist auch ohne Fokus „sicher“ (nie lockerer).
    for (const k of focusSure) expect(fileSure.has(k)).toBe(true);
  });

  it("Laufzeit: 2 000 neue gegen gut 12 000 vorhandene Personen", () => {
    const { existing, file, focus } = scenario(110, 6, 5, 0.3, 2000);
    const t0 = performance.now();
    const r = linkImports([...existing, ...file], { focus });
    const ms = Math.round(performance.now() - t0);
    console.log(`[Importvorschlag] ${existing.length} vorhandene, ${file.length} neue: ${ms} ms, ${r.pairs.length} Paare`);
    expect(existing.length).toBeGreaterThan(12000);
    expect(ms).toBeLessThan(15000);
  }, 60_000);
});

describe("Vorschläge beim Import — Abweichungen", () => {
  const base = (x: Partial<LinkPerson>): LinkPerson => ({
    id: "x",
    group: "g",
    givenName: "Ortwin",
    familyName: "Quellmar",
    birthName: null,
    gender: "MALE",
    birth: null,
    death: null,
    birthPlace: null,
    variants: [],
    parents: [],
    partners: [],
    children: [],
    parentNames: [],
    partnerNames: [],
    trees: [],
    ...x,
  });
  it("nennt abweichende und einseitige Angaben", () => {
    const d = pairDifferences(
      base({ birth: toFuzzyDate("1850-03-12"), birthPlace: "Nirgendhausen", death: toFuzzyDate("1910-01-01") }),
      base({ birth: toFuzzyDate("1850-01-01", "YEAR", "ABOUT"), death: toFuzzyDate("1911-01-01") }),
    );
    expect(d.join(" | ")).toMatch(/Geburt: Datei 12\.03\.1850, vorhanden um 1850/);
    expect(d.join(" | ")).toMatch(/Tod: Datei/);
    expect(d.join(" | ")).toMatch(/Geburtsort nur in der Datei: Nirgendhausen/);
    expect(pairDifferences(base({}), base({}))).toEqual([]);
  });
});
