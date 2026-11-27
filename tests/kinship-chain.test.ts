import { describe, expect, it } from "vitest";

import { buildGraphIndex, type GraphEdge } from "@/lib/graph";
import { findBloodRelation, type Sex } from "@/lib/kinship";
import { bloodConnections, lineUp } from "@/lib/kinship-chain";
import { relationsFromReference } from "@/lib/reference";
import type { GraphPerson, LoadedGraph } from "@/lib/services/graph-data";
import { kinshipViewInGraph, parsePersonParam, type KinshipFound } from "@/lib/services/kinship-view";
import { mockData, mockEdges } from "./helpers";

/**
 * „Wie sind wir verwandt?“: Verbindungen als Personenketten (lib/kinship-chain.ts)
 * und die Sicht der Seite — streng wie der Baum nur über sichtbare Personen
 * (lib/services/kinship-view.ts).
 */

let n = 0;
const parent = (from: string, to: string, subtype = "BIOLOGICAL"): GraphEdge => ({ id: `e${++n}`, type: "PARENT_OF", subtype, from, to });
const partner = (from: string, to: string, subtype = "MARRIED"): GraphEdge => ({ id: `e${++n}`, type: "PARTNER_OF", subtype, from, to });

function person(id: string, gender: Sex, visible = true): GraphPerson {
  return {
    id,
    givenName: `Vorname-${id}`,
    familyName: "Beispiel",
    birthName: null,
    gender,
    birthDate: new Date("1900-05-01"),
    birthPlace: "Musterstadt",
    deathDate: null,
    deathPlace: null,
    birthDatePrecision: "YEAR",
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
    visible,
  };
}

function graphOf(persons: [string, Sex, boolean?][], edges: GraphEdge[]): LoadedGraph {
  return {
    persons: new Map(persons.map(([id, g, v]) => [id, person(id, g, v ?? true)])),
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

/**
 * Großeltern GV+GM mit den Kindern V (Vater von A) und T (Tante, Mutter von B);
 * GV hat eine Schwester GT (Großtante von A). M ist die Mutter von A.
 */
function cousins(visible: Partial<Record<string, boolean>> = {}) {
  const p: [string, Sex, boolean?][] = (
    [
      ["UV", "MALE"],
      ["UM", "FEMALE"],
      ["GV", "MALE"],
      ["GM", "FEMALE"],
      ["GT", "FEMALE"],
      ["V", "MALE"],
      ["M", "FEMALE"],
      ["T", "FEMALE"],
      ["TM", "MALE"],
      ["A", "MALE"],
      ["B", "FEMALE"],
      ["X", "MALE"],
    ] as [string, Sex][]
  ).map(([id, g]) => [id, g, visible[id] ?? true]);
  const e = [
    parent("UV", "GV"),
    parent("UM", "GV"),
    parent("UV", "GT"),
    parent("UM", "GT"),
    partner("UV", "UM"),
    partner("GV", "GM"),
    parent("GV", "V"),
    parent("GM", "V"),
    parent("GV", "T"),
    parent("GM", "T"),
    partner("V", "M"),
    parent("V", "A"),
    parent("M", "A"),
    partner("T", "TM"),
    parent("T", "B"),
    parent("TM", "B"),
  ];
  return graphOf(p, e);
}

const found = (g: LoadedGraph, a: string, b: string) => {
  const r = kinshipViewInGraph(g, a, b);
  expect(r?.status).toBe("found");
  return r as KinshipFound;
};

describe("bloodConnections", () => {
  it("Cousins: ein Großelternpaar, beide Linien von oben nach unten", () => {
    const g = cousins();
    const c = bloodConnections(g.index, "A", "B");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ up: 2, down: 2, half: false, adoptive: false });
    expect([...c[0].ancestorIds].sort()).toEqual(["GM", "GV"]);
    expect(c[0].lineA.map((s) => s.personId)).toEqual(["V", "A"]);
    expect(c[0].lineB.map((s) => s.personId)).toEqual(["T", "B"]);
    expect(c[0].lineA[0].parentId).toBe(c[0].ancestorIds[0]);
    // Die nächste Verbindung entspricht findBloodRelation.
    const rel = findBloodRelation(g.index, "A", "B")!;
    expect([c[0].up, c[0].down]).toEqual([rel.up, rel.down]);
  });

  it("Vorfahr und Nachfahr: eine Linie ist leer", () => {
    const g = cousins();
    const c = bloodConnections(g.index, "A", "GV");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ up: 2, down: 0, ancestorIds: ["GV"] });
    expect(c[0].lineB).toEqual([]);
    expect(c[0].lineA.map((s) => s.personId)).toEqual(["V", "A"]);
  });

  it("doppelte Cousins: zwei Verbindungen über zwei Großelternpaare", () => {
    // Zwei Brüder heiraten zwei Schwestern.
    const g = graphOf(
      [
        ["G1", "MALE"], ["G2", "FEMALE"], ["H1", "MALE"], ["H2", "FEMALE"],
        ["B1", "MALE"], ["B2", "MALE"], ["S1", "FEMALE"], ["S2", "FEMALE"],
        ["A", "MALE"], ["B", "FEMALE"],
      ],
      [
        partner("G1", "G2"), partner("H1", "H2"),
        parent("G1", "B1"), parent("G2", "B1"), parent("G1", "B2"), parent("G2", "B2"),
        parent("H1", "S1"), parent("H2", "S1"), parent("H1", "S2"), parent("H2", "S2"),
        parent("B1", "A"), parent("S1", "A"), parent("B2", "B"), parent("S2", "B"),
      ],
    );
    const c = bloodConnections(g.index, "A", "B");
    expect(c).toHaveLength(2);
    expect(c.map((x) => [...x.ancestorIds].sort().join("+")).sort()).toEqual(["G1+G2", "H1+H2"]);
    const r = found(g, "A", "B");
    expect(r.connections).toHaveLength(2);
    expect(r.connections.map((x) => x.bForA)).toEqual(["Cousine 1. Grades väterlicherseits", "Cousine 1. Grades mütterlicherseits"]);
    expect(r.bForA).toBe("Cousine 1. Grades");
  });

  it("Ahnenschwund: die Eltern gemeinsamer Vorfahren sind keine eigene Verbindung", () => {
    // Geschwister A und B, deren Eltern Cousins sind.
    const g = graphOf(
      [["O1", "MALE"], ["O2", "FEMALE"], ["K1", "MALE"], ["K2", "FEMALE"], ["V", "MALE"], ["M", "FEMALE"], ["A", "MALE"], ["B", "MALE"]],
      [
        partner("O1", "O2"),
        parent("O1", "K1"), parent("O2", "K1"), parent("O1", "K2"), parent("O2", "K2"),
        parent("K1", "V"), parent("K2", "M"),
        parent("V", "A"), parent("M", "A"), parent("V", "B"), parent("M", "B"),
      ],
    );
    const c = bloodConnections(g.index, "A", "B");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ up: 1, down: 1 });
    expect([...c[0].ancestorIds].sort()).toEqual(["M", "V"]);
  });

  it("Halbgeschwister und Adoption", () => {
    const g = graphOf(
      [["V", "MALE"], ["M1", "FEMALE"], ["M2", "FEMALE"], ["A", "MALE"], ["B", "FEMALE"], ["C", "MALE"]],
      [parent("V", "A"), parent("M1", "A"), parent("V", "B"), parent("M2", "B"), parent("V", "C", "ADOPTIVE"), parent("M1", "C", "ADOPTIVE")],
    );
    expect(bloodConnections(g.index, "A", "B")[0]).toMatchObject({ half: true, ancestorIds: ["V"] });
    const r = found(g, "A", "B");
    expect(r.bForA).toBe("Halbschwester");
    expect(r.aForB).toBe("Halbbruder");
    const adopt = bloodConnections(g.index, "A", "C")[0];
    expect(adopt.adoptive).toBe(true);
    expect(found(g, "C", "V").connections[0].lineA[0]).toMatchObject({ subtype: "ADOPTIVE", parentLabel: "Adoptivvater", childLabel: "Adoptivsohn" });
  });

  it("keine gemeinsamen Vorfahren, dieselbe Person, Grenze", () => {
    const g = cousins();
    expect(bloodConnections(g.index, "A", "TM")).toEqual([]);
    expect(bloodConnections(g.index, "A", "A")).toEqual([]);
    expect(bloodConnections(g.index, "A", "B", 0)).toEqual([]);
  });

  it("lineUp: leiblich vor adoptiv", () => {
    const g = graphOf(
      [["P", "MALE"], ["Q", "MALE"], ["A", "MALE"]],
      [parent("Q", "A", "ADOPTIVE"), parent("P", "A")],
    );
    expect(lineUp(g.index, "A", new Set(["P", "Q"]))!.top).toBe("P");
    expect(lineUp(g.index, "A", new Set(["Z"]))).toBeNull();
  });
});

describe("kinshipViewInGraph", () => {
  it("beide Blickrichtungen, Grad und Beschriftungen", () => {
    const g = cousins();
    const r = found(g, "GT", "A");
    expect(r.kind).toBe("blood");
    expect(r.aForB).toBe("Großtante väterlicherseits"); // GT für A
    expect(r.bForA).toBe("Großneffe"); // A für GT
    const main = r.connections[0];
    expect(main).toMatchObject({ up: 1, down: 3, pairSubtype: "MARRIED" });
    expect(main.lineB.map((s) => s.childLabel)).toEqual(["Sohn", "Sohn", "Sohn"]);
    expect(main.lineB.map((s) => s.parentLabel)).toEqual(["Vater", "Vater", "Vater"]);
    expect(r.path[0].card).toEqual({ id: "GT", name: "Vorname-GT Beispiel", lifespan: "* 1900" });
  });

  it("angeheiratet: Ehe-Schritte im Weg", () => {
    const g = cousins();
    const r = found(g, "V", "TM"); // Mann der Schwester
    expect(r.kind).toBe("inLaw");
    expect(r.connections).toEqual([]);
    expect(r.bForA).toBe("Schwager");
    expect(r.aForB).toBe("Schwager");
    expect(r.path.map((s) => s.link?.label ?? null)).toEqual([null, "Vater", "Tochter", "Ehemann"]);
  });

  it("Ehe unter Verwandten: kürzerer Weg als eigene Angabe", () => {
    const g = cousins();
    g.relationships.push({ ...g.relationships[0], id: "ehe", type: "PARTNER_OF", subtype: "MARRIED", from: "A", to: "B" });
    g.index = buildGraphIndex(g.relationships);
    const r = found(g, "A", "B");
    expect(r.bForA).toBe("Cousine 1. Grades väterlicherseits");
    expect(r.pathTerm).toBe("Ehefrau");
  });

  it("keine Verbindung, dieselbe Person, unsichtbare Auswahl", () => {
    const g = cousins({ GM: false });
    expect(kinshipViewInGraph(g, "A", "X")).toMatchObject({ status: "none" });
    expect(kinshipViewInGraph(g, "A", "A")).toMatchObject({ status: "same" });
    expect(kinshipViewInGraph(g, "A", "GM")).toBeNull();
    expect(kinshipViewInGraph(g, "GM", "A")).toBeNull();
    expect(kinshipViewInGraph(g, "A", "unbekannt")).toBeNull();
  });

  it("streng wie der Baum: Verbindung nur über nicht sichtbare Personen gilt als keine", () => {
    // Der Vater V ist verborgen: A erreicht die Großeltern nur über ihn.
    const g = cousins({ V: false });
    const r = kinshipViewInGraph(g, "A", "B");
    expect(r).toMatchObject({ status: "none" });
    const json = JSON.stringify(r);
    for (const hidden of ["Vorname-V\"", "\"V\"", "GV", "GM", "Vorname-T\""]) expect(json).not.toContain(hidden);
  });

  it("sichtbarer Umweg bleibt: nur über sichtbare Personen gerechnet, ohne Platzhalter", () => {
    // Großvater verborgen, Großmutter sichtbar: Cousine über die Großmutter allein.
    const g = cousins({ GV: false });
    const r = found(g, "A", "B");
    const main = r.connections[0];
    expect(main.ancestors.map((c) => c.id)).toEqual(["GM"]);
    expect(main.lineA.map((s) => s.card.id)).toEqual(["V", "A"]);
    expect(main.lineB.map((s) => s.card.id)).toEqual(["T", "B"]);
    expect(JSON.stringify(r)).not.toContain("GV");
  });

  it("Seite und Bezugsperson (Baumkarte, Personenseite) sagen für jedes Paar dasselbe", () => {
    for (const hidden of [{}, { GV: false }, { V: false }, { GV: false, TM: false }, { T: false, UM: false }]) {
      const g = cousins(hidden);
      const visibleIds = [...g.persons.values()].filter((p) => p.visible).map((p) => p.id);
      const index = buildGraphIndex(g.relationships.filter((e) => g.persons.get(e.from)!.visible && g.persons.get(e.to)!.visible));
      const sexOf = (id: string) => g.persons.get(id)!.gender;
      for (const ref of visibleIds) {
        const terms = relationsFromReference(index, sexOf, ref);
        for (const other of visibleIds) {
          if (other === ref) continue;
          // Was `other` für `ref` ist: Personenseite/Baumkarte bzw. aForB der Seite (a = other, b = ref).
          const r = kinshipViewInGraph(g, other, ref)!;
          const page = r.status === "found" ? r.aForB : null;
          expect(page, `${JSON.stringify(hidden)} ${ref} → ${other}`).toBe(terms.relatives.get(other)?.term ?? null);
        }
      }
    }
  });
});

describe("parsePersonParam", () => {
  it("nimmt nur gültige Kennungen", () => {
    expect(parsePersonParam("mock-p-001")).toBe("mock-p-001");
    expect(parsePersonParam(["x1", "x2"])).toBe("x1");
    expect(parsePersonParam("a b")).toBeNull();
    expect(parsePersonParam("")).toBeNull();
    expect(parsePersonParam(undefined)).toBeNull();
    expect(parsePersonParam("x".repeat(65))).toBeNull();
  });
});

/** Kleiner Pseudozufall wie in tests/reference.test.ts. */
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

describe("Mock-Daten", () => {
  it("nächste Verbindung wie findBloodRelation, Halb wie dort, Weg immer vorhanden", () => {
    const d = mockData();
    const g = graphOf(d.persons.map((p) => [p.id, p.gender as Sex]), mockEdges());
    const ids = d.persons.map((p) => p.id);
    let blood = 0;
    for (let i = 0; i < ids.length; i += 3) {
      for (let j = 1; j < ids.length; j += 4) {
        if (ids[i] === ids[j]) continue;
        const r = kinshipViewInGraph(g, ids[i], ids[j])!;
        const rel = findBloodRelation(g.index, ids[i], ids[j]);
        if (r.status !== "found") {
          expect(rel).toBeNull();
          continue;
        }
        expect(r.path.length).toBeGreaterThan(1);
        expect(r.connections.length > 0).toBe(rel !== null);
        if (rel) {
          blood++;
          const c = r.connections[0];
          expect([c.up, c.down]).toEqual([rel.up, rel.down]);
          expect(c.lineA).toHaveLength(c.up);
          expect(c.lineB).toHaveLength(c.down);
          // Bei einem einzigen Vorfahren(-paar) dieselbe Bezeichnung wie get_kinship.
          if (r.connections.length === 1 && rel.commonAncestorIds.length === c.ancestors.length) {
            expect(c.bForA).toBe(r.bForA);
            expect(c.aForB).toBe(r.aForB);
          }
        }
      }
    }
    expect(blood).toBeGreaterThan(100);
  });
});

describe("Leistung und Übereinstimmung", () => {
  it("12 000 Personen: Ergebnis deutlich unter einer Sekunde, nächste Verbindung wie findBloodRelation", () => {
    const rnd = prng(7);
    const persons: [string, Sex][] = [];
    const edges: GraphEdge[] = [];
    const gens: string[][] = [];
    for (let gi = 0; gi < 20; gi++) {
      const row: string[] = [];
      for (let i = 0; i < 600; i++) {
        const id = `g${gi}-${i}`;
        persons.push([id, rnd() < 0.5 ? "MALE" : "FEMALE"]);
        row.push(id);
        if (gi > 0) {
          const prev = gens[gi - 1];
          const a = prev[Math.floor(rnd() * prev.length)];
          let b = prev[Math.floor(rnd() * prev.length)];
          if (b === a) b = prev[(prev.indexOf(a) + 1) % prev.length];
          edges.push(parent(a, id), parent(b, id, rnd() < 0.05 ? "ADOPTIVE" : "BIOLOGICAL"));
          if (rnd() < 0.6) edges.push(partner(a, b));
        }
      }
      gens.push(row);
    }
    const g = graphOf(persons, edges);
    const pairs: [string, string][] = [
      ["g19-1", "g19-2"],
      ["g19-3", "g12-40"],
      ["g18-5", "g19-500"],
    ];
    for (const [a, b] of pairs) {
      const start = performance.now();
      const r = kinshipViewInGraph(g, a, b);
      const ms = performance.now() - start;
      console.log(`[kinship-view] ${persons.length} Personen, ${edges.length} Kanten, ${a}–${b}: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(1000);
      const rel = findBloodRelation(g.index, a, b);
      if (r?.status === "found" && rel) {
        expect([r.connections[0].up, r.connections[0].down]).toEqual([rel.up, rel.down]);
        expect(r.connections.length).toBeLessThanOrEqual(4);
      }
    }
  });
});
