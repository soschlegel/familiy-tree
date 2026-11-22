import { describe, expect, it } from "vitest";

import { buildGraphIndex, type GraphEdge } from "@/lib/graph";
import { findBloodRelation, type Sex } from "@/lib/kinship";
import { bloodRelationsFrom, edgeLine, relationsFromReference, type RelativeInfo } from "@/lib/reference";
import { kinshipInGraph } from "@/lib/services/kinship";
import type { GraphPerson, LoadedGraph } from "@/lib/services/graph-data";
import { mockData, mockEdges } from "./helpers";

/**
 * Bezugsperson: Verwandtschaft aller Personen in einem Durchgang
 * (lib/reference.ts) muss genau dasselbe liefern wie die bewährte
 * Einzelabfrage kinshipInGraph — für jedes Paar.
 */

function graphPerson(id: string, gender: Sex): GraphPerson {
  return {
    id,
    givenName: id,
    familyName: null,
    birthName: null,
    gender,
    birthDate: null,
    birthPlace: null,
    deathDate: null,
    deathPlace: null,
    birthDatePrecision: "DAY",
    birthDateQualifier: "EXACT",
    deathDatePrecision: "DAY",
    deathDateQualifier: "EXACT",
    birthDateTo: null,
    birthDateToPrecision: "DAY",
    deathDateTo: null,
    deathDateToPrecision: "DAY",
    hasNotes: false,
    familyIds: [],
    primaryMediaId: null,
    visible: true,
  };
}

function loaded(persons: { id: string; gender: Sex }[], edges: GraphEdge[]): LoadedGraph {
  return {
    persons: new Map(persons.map((p) => [p.id, graphPerson(p.id, p.gender)])),
    relationships: edges.map((e) => ({
      ...e,
      startDate: null,
      startDatePrecision: "DAY",
      startDateQualifier: "EXACT",
      endDate: null,
      endDatePrecision: "DAY",
      endDateQualifier: "EXACT",
      startDateTo: null,
      startDateToPrecision: "DAY",
      endDateTo: null,
      endDateToPrecision: "DAY",
      startPlace: null,
      endPlace: null,
      primaryMediaId: null,
    })) as LoadedGraph["relationships"],
    index: buildGraphIndex(edges),
  };
}

function compareAll(graph: LoadedGraph, refs: string[]) {
  const sexOf = (id: string) => graph.persons.get(id)!.gender as Sex;
  let compared = 0;
  for (const ref of refs) {
    const batch = relationsFromReference(graph.index, sexOf, ref);
    const blood = bloodRelationsFrom(graph.index, ref);
    for (const id of graph.persons.keys()) {
      if (id === ref) continue;
      const single = kinshipInGraph(graph, ref, id);
      const expected = single?.summary ?? null;
      const got = batch.relatives.get(id)?.term ?? null;
      if (got !== expected) {
        throw new Error(`${ref} → ${id}: erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(got)}`);
      }
      // Auch die Bausteine der Blutsverwandtschaft.
      const rel = findBloodRelation(graph.index, ref, id);
      const b = blood.get(id) ?? null;
      expect(b === null).toBe(rel === null);
      if (rel && b) {
        expect([b.up, b.down, b.half, b.adoptive, b.lineParentId, b.commonAncestorIds]).toEqual([
          rel.up,
          rel.down,
          rel.half,
          rel.adoptive,
          rel.lineParentId,
          rel.commonAncestorIds,
        ]);
      }
      compared++;
    }
  }
  return compared;
}

/** Kleiner Pseudozufall, damit die erzeugten Graphen reproduzierbar sind. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Erzeugter Stammbaum mit Generationen, Ahnenschwund (Heirat unter
 * Verwandten), Halbgeschwistern, Adoption, Stief- und Pflegekindern und
 * unbekanntem Geschlecht.
 */
function syntheticGraph(seed: number, generations: number, perGeneration: number) {
  const rnd = prng(seed);
  const persons: { id: string; gender: Sex }[] = [];
  const edges: GraphEdge[] = [];
  let e = 0;
  const gens: string[][] = [];
  for (let g = 0; g < generations; g++) {
    const row: string[] = [];
    for (let i = 0; i < perGeneration; i++) {
      const id = `g${g}-${i}`;
      const r = rnd();
      persons.push({ id, gender: r < 0.47 ? "MALE" : r < 0.94 ? "FEMALE" : "UNKNOWN" });
      row.push(id);
      if (g > 0) {
        const prev = gens[g - 1];
        const a = prev[Math.floor(rnd() * prev.length)];
        let b = prev[Math.floor(rnd() * prev.length)];
        if (b === a) b = prev[(prev.indexOf(a) + 1) % prev.length];
        const roll = rnd();
        if (roll > 0.05) edges.push({ id: `e${++e}`, type: "PARENT_OF", subtype: "BIOLOGICAL", from: a, to: id });
        if (roll > 0.15) {
          const sub = rnd() < 0.08 ? "ADOPTIVE" : rnd() < 0.05 ? "STEP" : rnd() < 0.03 ? "FOSTER" : "BIOLOGICAL";
          edges.push({ id: `e${++e}`, type: "PARENT_OF", subtype: sub, from: b, to: id });
          if (rnd() < 0.7) edges.push({ id: `e${++e}`, type: "PARTNER_OF", subtype: rnd() < 0.8 ? "MARRIED" : "DIVORCED", from: a, to: b });
        }
        // Gelegentlich ein dritter Elternteil (Adoption zusätzlich zur Abstammung).
        if (rnd() < 0.03) {
          const c = prev[Math.floor(rnd() * prev.length)];
          if (c !== a && c !== b) edges.push({ id: `e${++e}`, type: "PARENT_OF", subtype: "ADOPTIVE", from: c, to: id });
        }
      }
    }
    gens.push(row);
  }
  return { persons, edges };
}

describe("Verwandtschaft zur Bezugsperson für alle Personen", () => {
  it("Mock-Daten: für 40 Bezugspersonen gleich der Einzelabfrage", () => {
    const d = mockData();
    const graph = loaded(
      d.persons.map((p) => ({ id: p.id, gender: p.gender as Sex })),
      mockEdges(),
    );
    const refs = d.persons.filter((_, i) => i % 5 === 0).map((p) => p.id);
    const n = compareAll(graph, refs);
    expect(n).toBe(refs.length * (d.persons.length - 1));
  });

  it("erzeugte Bäume mit Ahnenschwund, Adoption und Halbgeschwistern", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { persons, edges } = syntheticGraph(seed, 7, 14);
      const graph = loaded(persons, edges);
      const refs = persons.filter((_, i) => i % 9 === 0).map((p) => p.id);
      compareAll(graph, refs);
    }
  });

  it("benennt Angeheiratete und lässt Unbenennbares weg", () => {
    let n = 0;
    const P = (from: string, to: string, subtype = "BIOLOGICAL"): GraphEdge => ({ id: `x${++n}`, type: "PARENT_OF", subtype, from, to });
    const M = (from: string, to: string): GraphEdge => ({ id: `x${++n}`, type: "PARTNER_OF", subtype: "MARRIED", from, to });
    const persons: { id: string; gender: Sex }[] = [
      { id: "ich", gender: "FEMALE" },
      { id: "vater", gender: "MALE" },
      { id: "mutter", gender: "FEMALE" },
      { id: "bruder", gender: "MALE" },
      { id: "schwaegerin", gender: "FEMALE" },
      { id: "ehemann", gender: "MALE" },
      { id: "schwiegervater", gender: "MALE" },
      { id: "fremd", gender: "MALE" },
      { id: "fremd2", gender: "FEMALE" },
    ];
    const edges = [
      P("vater", "ich"),
      P("mutter", "ich"),
      P("vater", "bruder"),
      P("mutter", "bruder"),
      M("bruder", "schwaegerin"),
      M("ich", "ehemann"),
      P("schwiegervater", "ehemann"),
      M("schwiegervater", "fremd2"),
      M("fremd", "fremd2"),
    ];
    const r = relationsFromReference(buildGraphIndex(edges), (id) => persons.find((p) => p.id === id)!.gender, "ich");
    expect(r.relatives.get("bruder")?.term).toBe("Bruder");
    expect(r.relatives.get("schwaegerin")?.term).toBe("Schwägerin");
    expect(r.relatives.get("ehemann")?.term).toBe("Ehemann");
    expect(r.relatives.get("schwiegervater")?.term).toBe("Schwiegervater");
    // Vier Schritte ohne gängigen Begriff: keine Bezeichnung.
    expect(r.relatives.get("fremd")?.term ?? null).toBeNull();
    expect(r.relatives.has("ich")).toBe(false);
  });
});

describe("Ahnenlinien", () => {
  let n = 0;
  const P = (from: string, to: string, subtype = "BIOLOGICAL"): GraphEdge => ({ id: `l${++n}`, type: "PARENT_OF", subtype, from, to });
  const sex: Record<string, Sex> = {
    ich: "MALE",
    v: "MALE",
    m: "FEMALE",
    vv: "MALE",
    vm: "FEMALE",
    mv: "MALE",
    mm: "FEMALE",
    vvv: "MALE",
    vmm: "FEMALE",
    mvv: "MALE",
    mmm: "FEMALE",
    onkel: "MALE",
    kind: "FEMALE",
  };
  const edges = [
    P("v", "ich"),
    P("m", "ich"),
    P("vv", "v"),
    P("vm", "v"),
    P("mv", "m"),
    P("mm", "m"),
    P("vvv", "vv"),
    P("vmm", "vm"),
    P("mvv", "mv"),
    P("mmm", "mm"),
    P("vv", "onkel"),
    P("ich", "kind"),
  ];
  const sexOf = (id: string) => sex[id] ?? "UNKNOWN";

  it("ordnet jeden Vorfahren einem der vier Großeltern zu", () => {
    const r = relationsFromReference(buildGraphIndex(edges), sexOf, "ich");
    expect(r.grandparents).toEqual({ FF: "vv", FM: "vm", MF: "mv", MM: "mm" });
    const lines = (id: string) => r.relatives.get(id)?.lines ?? [];
    expect(lines("vvv")).toEqual(["FF"]);
    expect(lines("vmm")).toEqual(["FM"]);
    expect(lines("mvv")).toEqual(["MF"]);
    expect(lines("mmm")).toEqual(["MM"]);
    expect(lines("v")).toEqual(["FF", "FM"]);
    expect(lines("m")).toEqual(["MF", "MM"]);
    // Außerhalb der Ahnenlinien: neutral.
    expect(lines("onkel")).toEqual([]);
    expect(lines("kind")).toEqual([]);
    expect(r.relatives.get("onkel")?.term).toBe("Onkel väterlicherseits");
    expect(r.relatives.get("vvv")?.term).toBe("Urgroßvater väterlicherseits");
  });

  it("Ahnenschwund: ein Vorfahr in zwei Linien", () => {
    // Die Großeltern väterlicher- und mütterlicherseits haben einen gemeinsamen Vater.
    const r = relationsFromReference(buildGraphIndex([...edges, P("vvv", "mm")]), sexOf, "ich");
    expect(r.relatives.get("vvv")?.lines).toEqual(["FF", "MM"]);
  });

  it("leiblicher Elternteil vor Adoptivelternteil, unbekanntes Geschlecht füllt den freien Platz", () => {
    const g = buildGraphIndex([P("adoptivvater", "ich", "ADOPTIVE"), P("v", "ich"), P("x", "v"), P("y", "v"), P("stief", "ich", "STEP")]);
    const s = (id: string): Sex => ({ adoptivvater: "MALE", v: "MALE", x: "MALE" })[id] as Sex ?? "UNKNOWN";
    const r = relationsFromReference(g, s, "ich");
    expect(r.fatherId).toBe("v");
    expect(r.motherId).toBeNull();
    // v hat x (männlich) und y (unbekannt): y wird Großmutter-Linie.
    expect(r.grandparents.FF).toBe("x");
    expect(r.grandparents.FM).toBe("y");
    // Stiefelternteil begründet keine Linie.
    expect(r.relatives.get("stief")?.lines ?? []).toEqual([]);
  });
});

describe("Farbe der Verbindungen (edgeLine)", () => {
  // Bezugsperson R, Vater V (Linien VV+VM), dessen Eltern GV (VV) und GM (VM),
  // Urgroßvater UV (VV), Großonkel O (Bruder von GV, keine Linie).
  const relatives: Record<string, RelativeInfo> = {
    V: { term: "Vater", lines: ["FF", "FM"] },
    GV: { term: "Großvater väterlicherseits", lines: ["FF"] },
    GM: { term: "Großmutter väterlicherseits", lines: ["FM"] },
    UV: { term: "Urgroßvater väterlicherseits", lines: ["FF"] },
    O: { term: "Großonkel väterlicherseits", lines: [] },
  };

  it("färbt die Ahnenkette einer Linie", () => {
    expect(edgeLine(relatives, ["UV"], ["GV"])).toBe("FF");
    expect(edgeLine(relatives, ["GV"], ["V"])).toBe("FF");
    expect(edgeLine(relatives, ["GM"], ["V"])).toBe("FM");
  });

  it("bleibt neutral bei mehreren gemeinsamen Linien, Seitenverwandten und Unbekannten", () => {
    // Treffpunkt beider Großeltern → Vater: zwei gemeinsame Linien.
    expect(edgeLine(relatives, ["GV", "GM"], ["V"])).toBeNull();
    // Vater → Bezugsperson: R hat keine Linie.
    expect(edgeLine(relatives, ["V"], ["R"])).toBeNull();
    // Urgroßvater → Großonkel: Großonkel ist kein Vorfahr.
    expect(edgeLine(relatives, ["UV"], ["O"])).toBeNull();
    expect(edgeLine(relatives, ["X"], ["Y"])).toBeNull();
  });

  it("Paarkarte als Kindseite: Linie der Eltern des einen Partners", () => {
    // Karte „GV + GM“, Eltern von GV darüber.
    expect(edgeLine(relatives, ["UV"], ["GV", "GM"])).toBe("FF");
  });
});

describe("Leistung", () => {
  it("rund 10 000 Personen in einem Durchgang", () => {
    const { persons, edges } = syntheticGraph(42, 20, 500);
    const index = buildGraphIndex(edges);
    const sex = new Map(persons.map((p) => [p.id, p.gender]));
    // Jüngste Generation, mit zwei Elternteilen.
    const ref = persons.find((p) => p.id.startsWith("g19-") && (index.parentsOf.get(p.id)?.length ?? 0) >= 2)!.id;
    const start = performance.now();
    const r = relationsFromReference(index, (id) => sex.get(id) ?? "UNKNOWN", ref);
    const ms = performance.now() - start;
    console.log(`[reference] ${persons.length} Personen, ${edges.length} Kanten: ${r.relatives.size} benannt/erreicht in ${ms.toFixed(0)} ms`);
    expect(r.relatives.size).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(5000);
  });
});
