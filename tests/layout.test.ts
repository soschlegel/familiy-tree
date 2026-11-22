import { describe, expect, it } from "vitest";

import { EVENT_BOX, layoutGenerations, layoutTimeline } from "@/lib/layout-generations";
import { NODE_HEIGHT, NODE_WIDTH, type LayoutNode, type TreeData } from "@/lib/tree-layout";
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

  it("liest Jahre in UTC — auch in einer Zeitzone westlich von Greenwich", () => {
    // Daten liegen als Mitternacht UTC vor; lokal gelesen wäre der 1.1.1900
    // in New York noch Silvester 1899 und die Karte säße ein Jahr zu früh.
    const before = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(new Date("1900-01-01T00:00:00.000Z").getFullYear()).toBe(1899); // Voraussetzung
      const data: TreeData = {
        persons: [person("alt", 1900), person("jung", 1950)],
        relationships: [rel("r1", "PARENT_OF", "alt", "jung")],
      };
      const t = layoutTimeline(data);
      const y = (id: string) => t.nodes.find((n) => n.person.id === id)!.y;
      expect(y("alt")).toBe(t.axis.toY(1900));
      expect(y("jung")).toBe(t.axis.toY(1950));
      expect(t.axis.toY(1899)).toBe(t.axis.toY(1900)); // 1899 liegt vor der Achse
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("layoutTimeline — Hochzeiten", () => {
  it("legt keine Hochzeit auf eine Personenkarte oder eine andere Hochzeit (Mock-Daten)", () => {
    const t = layoutTimeline(mockTreeData());
    const boxes = t.nodes.map((n) => ({ id: n.person.id, x: n.x, y: n.y, w: width(n), h: NODE_HEIGHT }));
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const placed: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const overlaps: string[] = [];
    for (const ev of t.events) {
      const p = t.eventPositions.get(ev.id)!;
      const box = { id: ev.id, x: p.x, y: p.y, w: EVENT_BOX.width, h: EVENT_BOX.height };
      for (const b of [...boxes, ...placed]) if (hit(box, b)) overlaps.push(`${ev.id} / ${b.id}`);
      placed.push(box);
    }
    expect(overlaps).toEqual([]);
  });

  it("bleibt nah an ihrem Jahr", () => {
    const data = mockTreeData();
    const t = layoutTimeline(data);
    for (const ev of t.events) {
      const p = t.eventPositions.get(ev.id)!;
      const year = new Date(ev.date!).getUTCFullYear();
      // höchstens rund eine Kartenhöhe neben dem eigenen Jahr
      expect(Math.abs(p.y - t.axis.toY(year)), ev.id).toBeLessThanOrEqual(NODE_HEIGHT + EVENT_BOX.height + 16);
    }
  });
});
