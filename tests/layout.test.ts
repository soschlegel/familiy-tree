import { describe, expect, it } from "vitest";

import { layoutGenerations, layoutTimeline } from "@/lib/layout-generations";
import { NODE_WIDTH, type LayoutNode, type TreeData } from "@/lib/tree-layout";
import { mockTreeData } from "./helpers";

const CONNECTOR = 56;
const width = (n: LayoutNode) => (n.partner ? NODE_WIDTH * 2 + CONNECTOR : NODE_WIDTH);

function person(id: string, birthYear: number | null): TreeData["persons"][number] {
  return {
    id,
    givenName: id,
    familyName: null,
    gender: "UNKNOWN",
    birthDate: birthYear ? `${birthYear}-01-01T00:00:00.000Z` : null,
    deathDate: null,
    primaryMediaId: null,
  };
}

function rel(
  id: string,
  type: "PARENT_OF" | "PARTNER_OF",
  from: string,
  to: string,
  subtype = type === "PARENT_OF" ? "BIOLOGICAL" : "MARRIED",
): TreeData["relationships"][number] {
  return { id, type, subtype, fromPersonId: from, toPersonId: to, startDate: null, endDate: null, primaryMediaId: null };
}

function assertNoOverlap(nodes: LayoutNode[]) {
  const rows = new Map<number, LayoutNode[]>();
  for (const n of nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      expect(sorted[i].x, `${prev.person.id} / ${sorted[i].person.id}`).toBeGreaterThanOrEqual(
        prev.x + width(prev) - 0.001,
      );
    }
  }
}

const placedIds = (nodes: LayoutNode[]) =>
  nodes.flatMap((n) => [n.person.id, ...(n.partner ? [n.partner.id] : [])]);

describe("layoutGenerations", () => {
  it("platziert jede Person genau einmal und ohne Überlappung (Mock-Daten)", () => {
    const data = mockTreeData();
    const { nodes, edges } = layoutGenerations(data);

    const placed = placedIds(nodes);
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(data.persons.length);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    expect(edges.length).toBeGreaterThan(0);
    assertNoOverlap(nodes);
  });

  it("ist deterministisch", () => {
    const a = layoutGenerations(mockTreeData());
    const b = layoutGenerations(mockTreeData());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("verkraftet mehr als zwei Eltern (leiblich + Adoptiv + Stief)", () => {
    const data: TreeData = {
      persons: [
        person("mutter", 1960),
        person("vater", 1958),
        person("adoptivmutter", 1955),
        person("adoptivvater", 1954),
        person("stiefvater", 1962),
        person("kind", 1985),
      ],
      relationships: [
        rel("r1", "PARTNER_OF", "mutter", "vater", "DIVORCED"),
        rel("r2", "PARTNER_OF", "adoptivmutter", "adoptivvater"),
        rel("r3", "PARTNER_OF", "mutter", "stiefvater"),
        rel("r4", "PARENT_OF", "mutter", "kind"),
        rel("r5", "PARENT_OF", "vater", "kind"),
        rel("r6", "PARENT_OF", "adoptivmutter", "kind", "ADOPTIVE"),
        rel("r7", "PARENT_OF", "adoptivvater", "kind", "ADOPTIVE"),
        rel("r8", "PARENT_OF", "stiefvater", "kind", "STEP"),
      ],
    };

    const { nodes, junctions } = layoutGenerations(data);
    expect(placedIds(nodes).sort()).toEqual(data.persons.map((p) => p.id).sort());

    const kind = nodes.find((n) => n.person.id === "kind" || n.partner?.id === "kind")!;
    const parentRows = nodes.filter((n) => n !== kind).map((n) => n.y);
    expect(Math.max(...parentRows)).toBeLessThan(kind.y);
    expect(junctions.every((j) => Number.isFinite(j.x) && Number.isFinite(j.y))).toBe(true);
    assertNoOverlap(nodes);

    // Zeitstrahl ebenfalls ohne Absturz.
    const timeline = layoutTimeline(data);
    expect(timeline.nodes).toHaveLength(data.persons.length);
  });

  it("bleibt kompakt: kaum breiter als die breiteste dicht gepackte Ebene (Mock-Daten)", () => {
    // Früher richtete das Layout jede Ebene für sich mittig aus und schob
    // Gruppen beim Auflösen von Überlappungen einseitig nach außen — der
    // Mock-Baum wurde dadurch gut doppelt so breit wie nötig (17 119 px bei
    // 8 340 px dicht gepackt). Jetzt: höchstens 35 % Zuschlag.
    const { nodes } = layoutGenerations(mockTreeData());
    const rows = new Map<number, LayoutNode[]>();
    for (const n of nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
    const H_GAP = 40;
    const packed = Math.max(
      ...[...rows.values()].map(
        (row) => row.reduce((sum, n) => sum + width(n) + H_GAP, 0) - H_GAP,
      ),
    );
    const extent =
      Math.max(...nodes.map((n) => n.x + width(n))) - Math.min(...nodes.map((n) => n.x));
    expect(extent).toBeLessThanOrEqual(packed * 1.35);
  });

  it("läuft bei Zyklen in fehlerhaften Daten nicht endlos", () => {
    const data: TreeData = {
      persons: [person("a", 1900), person("b", 1930), person("c", null)],
      relationships: [
        rel("r1", "PARENT_OF", "a", "b"),
        rel("r2", "PARENT_OF", "b", "a"),
        rel("r3", "PARENT_OF", "b", "c"),
        rel("r4", "PARTNER_OF", "a", "c"),
      ],
    };
    const { nodes } = layoutGenerations(data);
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("layoutTimeline", () => {
  it("liefert für die Mock-Daten alle Personen und Achsenbeschriftung", () => {
    const data = mockTreeData();
    const t = layoutTimeline(data);
    expect(t.nodes).toHaveLength(data.persons.length);
    expect(t.axis.ticks.length).toBeGreaterThan(5);
    expect(t.events.length).toBeGreaterThan(0);
  });
});
