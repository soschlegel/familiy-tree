/**
 * „Wurzeln“ (lib/roots.ts, lib/places/area.ts): Verteilung der Anteile auf
 * die Vorfahren, Zusammenfassen zu Stücken, Prozent-Rundung und die
 * Zuordnung Ort → Land/Region. Rein, ohne Datenbank; erfundene Personen.
 */
import { describe, expect, it } from "vitest";

import { countryName, placeArea, regionIndex } from "@/lib/places/area";
import type { Gazetteer, GeoEntry } from "@/lib/places/gazetteer";
import {
  ancestorShares,
  clampRootsGeneration,
  generationName,
  roundPercentages,
  rootsSlices,
  ROOTS_LABELS,
  type RootsCategory,
  type RootsContribution,
} from "@/lib/roots";

/** Stammbaum aus „Kind: Vater, Mutter“-Paaren. */
function graph(edges: Record<string, string[]>, opts: { hidden?: string[] } = {}) {
  const hidden = new Set(opts.hidden ?? []);
  return {
    parentsOf: (id: string) => edges[id] ?? [],
    visible: (id: string) => !hidden.has(id),
  };
}

/** Anteil je Person bzw. „restricted“/„unknown“, aufsummiert. */
function byPerson(contributions: RootsContribution[]) {
  const out: Record<string, number> = {};
  for (const c of contributions) {
    const k = c.kind === "person" ? c.personId : c.kind;
    out[k] = (out[k] ?? 0) + c.share;
  }
  return out;
}

const total = (c: RootsContribution[]) => c.reduce((s, x) => s + x.share, 0);

/** Volle Ahnentafel bis Tiefe `depth`: Kennungen „a“, „a.v“, „a.m“, „a.v.v“ … */
function fullTree(depth: number): Record<string, string[]> {
  const edges: Record<string, string[]> = {};
  const walk = (id: string, d: number) => {
    if (d === depth) return;
    edges[id] = [`${id}.v`, `${id}.m`];
    walk(`${id}.v`, d + 1);
    walk(`${id}.m`, d + 1);
  };
  walk("a", 0);
  return edges;
}

describe("ancestorShares", () => {
  it("volle Belegung: jeder Platz in Generation N zählt 1/2^N", () => {
    const r = ancestorShares({ rootId: "a", generations: 3, ...graph(fullTree(5)) });
    expect(r.slots).toBe(8);
    expect(r.filledSlots).toBe(8);
    expect(r.parentCount).toBe(2);
    expect(r.contributions).toHaveLength(8);
    for (const c of r.contributions) {
      expect(c).toMatchObject({ kind: "person", generation: 3, share: 1 / 8 });
    }
    expect(total(r.contributions)).toBeCloseTo(1);
  });

  it("endende Linie: der letzte bekannte Vorfahr steht für die Plätze dahinter", () => {
    const edges = { a: ["v", "m"], v: ["vv", "vm"], m: [] as string[] };
    const r = ancestorShares({ rootId: "a", generations: 4, ...graph(edges) });
    expect(byPerson(r.contributions)).toEqual({ vv: 0.25, vm: 0.25, m: 0.5 });
    expect(r.filledSlots).toBe(0);
    expect(r.slots).toBe(16);
  });

  it("Vorfahr mit nur einem Elternteil: die andere Hälfte bleibt bei ihm", () => {
    const r = ancestorShares({ rootId: "a", generations: 2, ...graph({ a: ["v", "m"], v: ["vv"] }) });
    expect(byPerson(r.contributions)).toEqual({ vv: 0.25, v: 0.25, m: 0.5 });
    expect(r.filledSlots).toBe(1);
  });

  it("fehlender Elternteil der Ausgangsperson: dessen Hälfte ist unbekannt", () => {
    const r = ancestorShares({ rootId: "a", generations: 2, ...graph({ a: ["m"], m: ["mv", "mm"] }) });
    expect(byPerson(r.contributions)).toEqual({ unknown: 0.5, mv: 0.25, mm: 0.25 });
    expect(r.parentCount).toBe(1);
  });

  it("ohne Eltern: alles unbekannt, keine Eltern gezählt", () => {
    const r = ancestorShares({ rootId: "a", generations: 4, ...graph({}) });
    expect(byPerson(r.contributions)).toEqual({ unknown: 1 });
    expect(r.parentCount).toBe(0);
  });

  it("Ahnenschwund: derselbe Vorfahr über zwei Linien zählt doppelt", () => {
    // Die Eltern sind Cousins: beide stammen von g1/g2 ab.
    const edges = { a: ["v", "m"], v: ["x", "y"], m: ["z", "w"], x: ["g1", "g2"], z: ["g1", "g2"] };
    const r = ancestorShares({ rootId: "a", generations: 3, ...graph(edges) });
    const s = byPerson(r.contributions);
    expect(s.g1).toBeCloseTo(0.25);
    expect(s.g2).toBeCloseTo(0.25);
    expect(s.y).toBeCloseTo(0.25);
    expect(s.w).toBeCloseTo(0.25);
    expect(r.filledSlots).toBe(4);
    expect(total(r.contributions)).toBeCloseTo(1);
  });

  it("Zyklus in fehlerhaften Daten: endet, der Kreis gilt als fehlender Elternteil", () => {
    const edges = { a: ["v", "m"], v: ["a", "vm"], m: ["m"], vm: ["v"] };
    const r = ancestorShares({ rootId: "a", generations: 8, ...graph(edges) });
    // v: Elternteil a liegt auf dem Weg → nur vm; vm: v liegt auf dem Weg → Linie endet.
    // m: sich selbst als Elternteil zählt nicht → Linie endet bei m.
    expect(byPerson(r.contributions)).toEqual({ v: 0.25, vm: 0.25, m: 0.5 });
    expect(total(r.contributions)).toBeCloseTo(1);
  });

  it("nicht sichtbarer Vorfahr: Anteil „nicht freigegeben“, dahinter wird nicht gefragt", () => {
    const asked: string[] = [];
    const edges = { a: ["v", "m"], v: ["vv", "vm"], m: ["mv", "mm"] };
    const r = ancestorShares({
      rootId: "a",
      generations: 2,
      parentsOf: (id) => {
        asked.push(id);
        return (edges as Record<string, string[]>)[id] ?? [];
      },
      visible: (id) => id !== "m",
    });
    expect(byPerson(r.contributions)).toEqual({ vv: 0.25, vm: 0.25, restricted: 0.5 });
    expect(asked).not.toContain("m");
    expect(r.filledSlots).toBe(2);
  });

  it("mehr als zwei leibliche Eltern: zu gleichen Teilen", () => {
    const r = ancestorShares({ rootId: "a", generations: 2, ...graph({ a: ["p1", "p2", "p3"] }) });
    const s = byPerson(r.contributions);
    expect(s.p1).toBeCloseTo(1 / 3);
    expect(s.unknown).toBeUndefined();
    expect(total(r.contributions)).toBeCloseTo(1);
  });

  it("doppelte Kante zählt einmal", () => {
    const r = ancestorShares({ rootId: "a", generations: 1, ...graph({ a: ["v", "v", "m"] }) });
    expect(byPerson(r.contributions)).toEqual({ v: 0.5, m: 0.5 });
  });
});

describe("rootsSlices", () => {
  const person = (personId: string, share: number): RootsContribution => ({ kind: "person", personId, generation: 2, share });

  it("Gebiete absteigend, dann Graustufen in fester Reihenfolge, Summe 100", () => {
    const cats: Record<string, RootsCategory> = {
      p1: { kind: "area", key: "DE", label: "Deutschland" },
      p2: { kind: "area", key: "PL", label: "Polen" },
      p3: { kind: "area", key: "DE", label: "Deutschland" },
      p4: { kind: "unassigned" },
      p5: { kind: "unknown" },
    };
    const slices = rootsSlices(
      [person("p1", 0.25), person("p2", 0.125), person("p3", 0.25), person("p4", 0.125), person("p5", 0.125), { kind: "restricted", generation: 1, share: 0.125 }],
      (id) => cats[id],
    );
    expect(slices.map((s) => [s.label, s.percent])).toEqual([
      ["Deutschland", 50],
      ["Polen", 13],
      [ROOTS_LABELS.unassigned, 13],
      [ROOTS_LABELS.unknown, 12],
      [ROOTS_LABELS.restricted, 12],
    ]);
    expect(slices.reduce((s, x) => s + x.percent, 0)).toBe(100);
    expect(slices[0].color).toBe("var(--chart-1)");
    expect(slices[1].color).toBe("var(--chart-2)");
    expect(slices.find((s) => s.kind === "restricted")?.color).toBe("var(--chart-restricted)");
  });

  it("sehr kleine Gebiete werden „Sonstige“ — ein einzelnes aber nicht", () => {
    const share = (n: number) => n / 256;
    const cat = (k: string): RootsCategory => ({ kind: "area", key: k, label: k });
    const big = [person("A", share(240))];
    const one = rootsSlices([...big, person("B", share(4)), { kind: "unknown", generation: 1, share: share(12) }], (id) => cat(id));
    expect(one.map((s) => s.label)).toEqual(["A", "B", ROOTS_LABELS.unknown]);

    const two = rootsSlices([...big, person("B", share(4)), person("C", share(3)), { kind: "unknown", generation: 1, share: share(9) }], (id) => cat(id));
    expect(two.map((s) => s.label)).toEqual(["A", ROOTS_LABELS.other, ROOTS_LABELS.unknown]);
    expect(two[1].members).toEqual(["B", "C"]);
    expect(two.reduce((s, x) => s + x.percent, 0)).toBe(100);
  });

  it("höchstens acht farbige Gebiete", () => {
    const contributions = Array.from({ length: 10 }, (_, i) => person(`L${i}`, 0.1));
    const slices = rootsSlices(contributions, (id) => ({ kind: "area", key: id, label: id }));
    expect(slices.filter((s) => s.kind === "area")).toHaveLength(8);
    expect(slices.find((s) => s.kind === "other")?.members).toHaveLength(2);
    expect(slices.reduce((s, x) => s + x.percent, 0)).toBe(100);
  });

  it("neun Gebiete: das kleinste behaltene geht mit ins „Sonstige“", () => {
    const contributions = Array.from({ length: 9 }, (_, i) => person(`L${i}`, (20 - i) / 164));
    const slices = rootsSlices(contributions, (id) => ({ kind: "area", key: id, label: id }));
    expect(slices.filter((s) => s.kind === "area")).toHaveLength(7);
    expect(slices.find((s) => s.kind === "other")?.members).toEqual(["L7", "L8"]);
  });
});

describe("roundPercentages", () => {
  it("Summe genau 100, größte Reste zuerst", () => {
    expect(roundPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundPercentages([0.0625, 0.0625, 0.0625, 0.0625, 0.75])).toEqual([7, 6, 6, 6, 75]);
    expect(roundPercentages([0.999, 0.001])).toEqual([100, 0]);
    expect(roundPercentages([0, 0])).toEqual([0, 0]);
  });
});

describe("Generationen", () => {
  it("Grenzen und Namen", () => {
    expect(clampRootsGeneration(1)).toBe(2);
    expect(clampRootsGeneration(99)).toBe(8);
    expect(clampRootsGeneration("x")).toBe(4);
    expect(generationName(2)).toBe("Großeltern");
    expect(generationName(4)).toBe("Ururgroßeltern");
    expect(generationName(5)).toBe("3× Urgroßeltern");
  });
});

describe("Ort → Land/Region (lib/places/area.ts)", () => {
  const entry = (e: Partial<GeoEntry> & Pick<GeoEntry, "id" | "name" | "cc" | "kind">): GeoEntry => ({
    lat: 0,
    lon: 0,
    a1: "",
    pop: 0,
    de: "",
    alt: "",
    ...e,
  });
  const entries = [
    entry({ id: "r1", name: "Musterland-Nord", cc: "DE", a1: "06", kind: "A" }),
    entry({ id: "r2", name: "Województwo przykładowe", de: "Beispielwoiwodschaft", cc: "PL", a1: "72", kind: "A" }),
    entry({ id: "p1", name: "Musterstadt", cc: "DE", a1: "06", kind: "P" }),
    entry({ id: "p2", name: "Przykładowo", cc: "PL", a1: "72", kind: "P" }),
    entry({ id: "p3", name: "Ohneregion", cc: "DE", a1: "", kind: "P" }),
    entry({ id: "h1", name: "Alte Landschaft", cc: "DE", a1: "", kind: "H" }),
  ];
  const gaz: Gazetteer = {
    entries,
    byName: new Map(),
    regions: new Map([
      ["DE.06", 0],
      ["PL.72", 1],
    ]),
    countries: new Map(),
    sorted: null,
  };
  const regions = regionIndex(gaz, ["p1", "p2", "p3", "h1", "r1", "fehlt"]);
  const row = (countryCode: string | null, gazetteerId: string | null, unresolvable = false) => ({ countryCode, gazetteerId, unresolvable });

  it("Ländernamen deutsch", () => {
    expect(countryName("DE")).toBe("Deutschland");
    expect(countryName("pl")).toBe("Polen");
    expect(countryName("US")).toBe("Vereinigte Staaten");
  });

  it("nach Land", () => {
    expect(placeArea(row("PL", "p2"), "country")).toEqual({ kind: "area", key: "PL", label: "Polen", countryCode: "PL" });
    expect(placeArea(row("DE", null), "country")).toMatchObject({ key: "DE", label: "Deutschland" });
  });

  it("nach Region: aus dem Ortsverzeichnis, deutscher Name bevorzugt", () => {
    expect(placeArea(row("DE", "p1"), "region", regions)).toMatchObject({ key: "DE.06", label: "Musterland-Nord, Deutschland" });
    expect(placeArea(row("PL", "p2"), "region", regions)).toMatchObject({ key: "PL.72", label: "Beispielwoiwodschaft, Polen" });
    expect(placeArea(row("DE", "r1"), "region", regions)).toMatchObject({ key: "DE.06" });
  });

  it("ohne verlässliche Region: Land „ohne Region“", () => {
    for (const r of [row("DE", "p3"), row("DE", "h1"), row("DE", null), row("DE", "fehlt"), row("DE", "p2")]) {
      expect(placeArea(r, "region", regions)).toMatchObject({ key: "DE.?", label: "Deutschland (ohne Region)" });
    }
  });

  it("nicht zugeordnet: keine Zeile, nicht zuordenbar, ohne Land", () => {
    expect(placeArea(null, "country")).toEqual({ kind: "unassigned" });
    expect(placeArea(row("DE", "p1", true), "country")).toEqual({ kind: "unassigned" });
    expect(placeArea(row(null, null), "region", regions)).toEqual({ kind: "unassigned" });
  });
});
