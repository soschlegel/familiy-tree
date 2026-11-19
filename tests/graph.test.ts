import { describe, expect, it } from "vitest";

import {
  ancestorsOf,
  buildGraphIndex,
  descendantsOf,
  shortestPath,
  siblingsOf,
  wouldCreateCycle,
  type GraphEdge,
} from "@/lib/graph";
import { generateMockData } from "@/prisma/mock-data";
import { mockData, mockEdges } from "./helpers";

const parent = (id: string, from: string, to: string, subtype = "BIOLOGICAL"): GraphEdge => ({
  id,
  type: "PARENT_OF",
  subtype,
  from,
  to,
});
const partner = (id: string, a: string, b: string): GraphEdge => ({
  id,
  type: "PARTNER_OF",
  subtype: "MARRIED",
  from: a,
  to: b,
});

// Opa+Oma -> Vater; Vater+Mutter -> Kind1, Kind2; Mutter+Ex -> Halb
const fixture = buildGraphIndex([
  partner("r1", "opa", "oma"),
  parent("r2", "opa", "vater"),
  parent("r3", "oma", "vater"),
  partner("r4", "mutter", "vater"),
  parent("r5", "vater", "kind1"),
  parent("r6", "mutter", "kind1"),
  parent("r7", "vater", "kind2"),
  parent("r8", "mutter", "kind2"),
  parent("r9", "mutter", "halb"),
  parent("r10", "ex", "halb"),
]);

describe("Vorfahren/Nachfahren", () => {
  it("ancestorsOf mit Generationen", () => {
    const a = ancestorsOf(fixture, "kind1", 2);
    expect(a.filter((e) => e.generation === 1).map((e) => e.personId).sort()).toEqual(["mutter", "vater"]);
    expect(a.filter((e) => e.generation === 2).map((e) => e.personId).sort()).toEqual(["oma", "opa"]);
    expect(ancestorsOf(fixture, "kind1", 1)).toHaveLength(2);
  });

  it("descendantsOf", () => {
    const d = descendantsOf(fixture, "opa", 5);
    expect(d.map((e) => e.personId).sort()).toEqual(["kind1", "kind2", "vater"]);
  });

  it("terminiert bei Zyklen in fehlerhaften Daten", () => {
    const cyclic = buildGraphIndex([parent("a", "x", "y"), parent("b", "y", "x")]);
    expect(ancestorsOf(cyclic, "x", 50).map((e) => e.personId)).toEqual(["y"]);
    expect(descendantsOf(cyclic, "x", 50).map((e) => e.personId)).toEqual(["y"]);
  });
});

describe("shortestPath", () => {
  it("findet den Weg über Eltern und Partner", () => {
    const path = shortestPath(fixture, "kind1", "oma")!;
    expect(path.map((s) => s.personId)).toEqual(["kind1", "vater", "oma"]);
    expect(path[1].edge?.relation).toBe("parent");
    expect(path[0].edge).toBeNull();
  });

  it("Halbgeschwister über die gemeinsame Mutter", () => {
    const path = shortestPath(fixture, "kind2", "halb")!;
    expect(path.map((s) => s.personId)).toEqual(["kind2", "mutter", "halb"]);
    expect(path[2].edge?.relation).toBe("child");
  });

  it("null ohne Verbindung, Startpunkt bei gleicher Person", () => {
    expect(shortestPath(fixture, "kind1", "unbekannt")).toBeNull();
    expect(shortestPath(fixture, "kind1", "kind1")).toEqual([{ personId: "kind1", edge: null }]);
  });
});

describe("wouldCreateCycle / siblingsOf", () => {
  it("erkennt Zyklen", () => {
    expect(wouldCreateCycle(fixture, "kind1", "opa")).toBe(true);
    expect(wouldCreateCycle(fixture, "opa", "opa")).toBe(true);
    expect(wouldCreateCycle(fixture, "opa", "halb")).toBe(false);
  });

  it("unterscheidet voll und halb", () => {
    const s = siblingsOf(fixture, "kind1");
    expect(s.find((x) => x.personId === "kind2")?.kind).toBe("full");
    expect(s.find((x) => x.personId === "halb")?.kind).toBe("half");
  });
});

describe("Mock-Daten", () => {
  it("sind deterministisch", () => {
    expect(JSON.stringify(generateMockData())).toBe(JSON.stringify(generateMockData()));
  });

  it("haben die geforderte Größe und Struktur", () => {
    const d = mockData();
    expect(d.persons.length).toBeGreaterThanOrEqual(150);
    expect(d.persons.length).toBeLessThanOrEqual(250);
    expect(new Set(d.persons.map((p) => p.generation)).size).toBeGreaterThanOrEqual(5);
    expect(d.persons.some((p) => p.familyKeys.length > 1)).toBe(true);
    expect(d.landmarks.noFamily.length).toBeGreaterThanOrEqual(1);
    expect(d.landmarks.duplicates.length).toBeGreaterThanOrEqual(2);
  });

  it("halten die Fachregeln ein", () => {
    const d = mockData();
    const index = buildGraphIndex(mockEdges());
    for (const [child, edges] of index.parentsOf) {
      const bio = edges.filter((e) => e.subtype === "BIOLOGICAL").length;
      expect(bio, child).toBeLessThanOrEqual(2);
    }
    for (const r of d.relationships) {
      if (r.type === "PARTNER_OF") expect(r.fromPersonId < r.toPersonId).toBe(true);
      if (r.startDate && r.endDate) expect(r.endDate >= r.startDate).toBe(true);
    }
    for (const p of d.persons) {
      if (p.birthDate && p.deathDate) expect(p.deathDate >= p.birthDate, p.id).toBe(true);
    }
    // Adoptivkind hat drei Elternteile (1 leiblich + 2 Adoptiv).
    expect(index.parentsOf.get(d.landmarks.adoptee)).toHaveLength(3);
  });

  it("verbinden die Familien und enthalten Halbgeschwister", () => {
    const d = mockData();
    const index = buildGraphIndex(mockEdges());
    expect(shortestPath(index, d.landmarks.founders.A, d.landmarks.founders.D)).not.toBeNull();
    const half = siblingsOf(index, d.landmarks.halfSiblings[0]).find(
      (s) => s.personId === d.landmarks.halfSiblings[1],
    );
    expect(half?.kind).toBe("half");
  });
});
