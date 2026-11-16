import { describe, expect, it } from "vitest";

import {
  defaultFocusId,
  FOCUS_DEPTH,
  FOCUS_ROW_GAP,
  focusSubgraph,
  layoutFocus,
  parseDepth,
  type FocusTreeData,
} from "@/lib/focus-tree";
import { NODE_HEIGHT, NODE_WIDTH, type LayoutNode, type TreeData } from "@/lib/tree-layout";
import { mockData, mockTreeData } from "./helpers";

const L = mockData().landmarks;
const CONNECTOR = 56;
const width = (n: LayoutNode) => (n.partner ? NODE_WIDTH * 2 + CONNECTOR : NODE_WIDTH);
const PITCH = NODE_HEIGHT + FOCUS_ROW_GAP;

function focus(id: string, up: number = FOCUS_DEPTH.up, down: number = FOCUS_DEPTH.down): FocusTreeData {
  const result = focusSubgraph(mockTreeData(), id, { up, down });
  expect(result, id).not.toBeNull();
  return result!;
}

const roleOf = (f: FocusTreeData, id: string) => f.members[id]?.role;

/** Wie loadTree für einen Betrachter: Personen fremder Familien als Platzhalter. */
function maskedFor(families: string[]): TreeData {
  const data = mockTreeData();
  return {
    persons: data.persons.map((p) =>
      p.familyIds?.some((f) => families.includes(f))
        ? p
        : {
            id: p.id,
            givenName: "",
            familyName: null,
            gender: "UNKNOWN" as const,
            birthDate: null,
            deathDate: null,
            primaryMediaId: null,
            restricted: true,
          },
    ),
    relationships: data.relationships,
  };
}

describe("focusSubgraph — Mitglieder", () => {
  it("zeigt Halbgeschwister, Stiefelternteil und beide leiblichen Eltern", () => {
    const [stepChild, halfSibling] = L.halfSiblings;
    const f = focus(stepChild, 1, 1);
    expect(roleOf(f, stepChild)).toBe("focus");
    expect(roleOf(f, halfSibling)).toBe("sibling");
    expect(roleOf(f, L.divorced.person)).toBe("ancestor");
    expect(roleOf(f, L.divorced.firstSpouse)).toBe("ancestor");
    // Stiefmutter über die STEP-Beziehung
    expect(roleOf(f, L.divorced.secondSpouse)).toBe("ancestor");
    for (const id of [L.divorced.person, L.divorced.firstSpouse, L.divorced.secondSpouse]) {
      expect(f.members[id].generation).toBe(-1);
    }
    expect(f.members[halfSibling].generation).toBe(0);
  });

  it("zeigt leibliche und Adoptiveltern sowie Pflegeeltern", () => {
    const a = focus(L.adoptee, 1, 1);
    for (const id of [L.biologicalMotherNoFamily, ...L.adoptiveParents]) {
      expect(roleOf(a, id)).toBe("ancestor");
      expect(a.members[id].generation).toBe(-1);
    }
    const subtypes = a.relationships
      .filter((r) => r.type === "PARENT_OF" && r.toPersonId === L.adoptee)
      .map((r) => r.subtype)
      .sort();
    expect(subtypes).toEqual(["ADOPTIVE", "ADOPTIVE", "BIOLOGICAL"]);

    const f = focus(L.fosterChild, 1, 1);
    for (const id of L.fosterParents) expect(roleOf(f, id)).toBe("ancestor");
  });

  it("zeigt bei mehreren Ehen beide Partner samt Kindern aus beiden Ehen", () => {
    const f = focus(L.divorced.person, 1, 1);
    expect(roleOf(f, L.divorced.firstSpouse)).toBe("partner");
    expect(roleOf(f, L.divorced.secondSpouse)).toBe("partner");
    for (const id of L.halfSiblings) {
      expect(roleOf(f, id)).toBe("descendant");
      expect(f.members[id].generation).toBe(1);
    }
    const partnerRels = f.relationships.filter((r) => r.type === "PARTNER_OF");
    expect(partnerRels.length).toBeGreaterThanOrEqual(2);
    expect(partnerRels.some((r) => r.subtype === "DIVORCED")).toBe(true);
  });

  it("hält die Tiefe ein und zählt, was jenseits liegt", () => {
    const data = mockTreeData();
    const { founders } = L;
    // Ein Urenkel des Stammvaters A: drei Generationen darüber gibt es.
    const f1 = focus(L.divorced.person, 1, 1);
    const f2 = focus(L.divorced.person, 2, 2);
    const gens = (f: FocusTreeData) => Object.values(f.members).map((m) => m.generation);
    expect(Math.min(...gens(f1))).toBe(-1);
    expect(Math.max(...gens(f1))).toBeLessThanOrEqual(1);
    expect(Math.min(...gens(f2))).toBe(-2);
    expect(Object.keys(f2.members).length).toBeGreaterThan(Object.keys(f1.members).length);

    // Eltern der obersten Reihe sind gezählt, aber nicht enthalten.
    const top = Object.entries(f1.members).filter(([, m]) => m.generation === -1);
    expect(top.some(([, m]) => m.hiddenParents > 0)).toBe(true);
    for (const [id, m] of Object.entries(f1.members)) {
      const parents = data.relationships.filter((r) => r.type === "PARENT_OF" && r.toPersonId === id);
      const inside = parents.filter((r) => f1.members[r.fromPersonId]).length;
      expect(m.hiddenParents + inside, id).toBe(new Set(parents.map((r) => r.fromPersonId)).size);
    }
    // Der Stammvater hat keine Vorfahren mehr.
    const root = focus(founders.A);
    expect(root.members[founders.A].hiddenParents).toBe(0);
  });

  it("enthält nur Beziehungen innerhalb des Ausschnitts", () => {
    const f = focus(L.crossMarriedPartnerA);
    for (const r of f.relationships) {
      expect(f.members[r.fromPersonId]).toBeDefined();
      expect(f.members[r.toPersonId]).toBeDefined();
    }
    expect(f.persons.map((p) => p.id).sort()).toEqual(Object.keys(f.members).sort());
  });

  it("lässt gesperrte Personen nicht in den Fokus und zeigt sie nur als Platzhalter", () => {
    const familyA = "A"; // mockTreeData nutzt die Familienschlüssel als IDs
    const masked = maskedFor([familyA]);
    expect(focusSubgraph(masked, L.inLawOnlyB)).toBeNull();
    expect(focusSubgraph(masked, "gibt-es-nicht")).toBeNull();

    const f = focusSubgraph(masked, L.crossMarriedIntoA)!;
    expect(f).not.toBeNull();
    const inLaw = f.persons.find((p) => p.id === L.inLawOnlyB);
    expect(inLaw?.restricted).toBe(true);
    expect(inLaw?.givenName).toBe("");
  });

  it("ist deterministisch", () => {
    const a = layoutFocus(focus(L.divorced.person));
    const b = layoutFocus(focus(L.divorced.person));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("layoutFocus", () => {
  it("legt jeden Ausschnitt der Mock-Daten überlappungsfrei und kompakt an", () => {
    const data = mockTreeData();
    for (const p of data.persons) {
      const f = focusSubgraph(data, p.id)!;
      const { nodes } = layoutFocus(f);

      const placed = nodes.flatMap((n) => [n.person.id, ...(n.partner ? [n.partner.id] : [])]);
      expect(new Set(placed).size).toBe(placed.length);
      expect(placed.length).toBe(f.persons.length);

      // Reihen: jede Generation genau eine Zeile.
      const rows = new Map<number, LayoutNode[]>();
      for (const n of nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
      for (const row of rows.values()) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + width(sorted[i - 1]) - 0.001);
        }
      }

      // Höhe: höchstens up + down + 1 Reihen.
      const height = Math.max(...nodes.map((n) => n.y)) - Math.min(...nodes.map((n) => n.y)) + NODE_HEIGHT;
      expect(height).toBeLessThanOrEqual((f.up + f.down) * PITCH + NODE_HEIGHT);

      // Breite: nicht wesentlich breiter als die breiteste dicht gepackte Reihe.
      const packed = Math.max(
        ...[...rows.values()].map((row) => row.reduce((s, n) => s + width(n) + 40, 0) - 40),
      );
      const extent = Math.max(...nodes.map((n) => n.x + width(n))) - Math.min(...nodes.map((n) => n.x));
      expect(extent, p.id).toBeLessThanOrEqual(packed * 1.6 + 200);
    }
  });

  it("stellt die Fokusperson in ihre eigene Reihe, Eltern darüber, Kinder darunter", () => {
    const f = focus(L.divorced.person);
    const { nodes } = layoutFocus(f);
    const yOf = (id: string) => nodes.find((n) => n.person.id === id || n.partner?.id === id)!.y;
    const y0 = yOf(L.divorced.person);
    for (const [id, m] of Object.entries(f.members)) {
      expect(yOf(id), id).toBe(y0 + m.generation * PITCH);
    }
  });

  it("nimmt ohne Ehen kinderlose Partner heraus, behält aber Eltern der Nachkommen", () => {
    const f = focus(L.divorced.person, 1, 1);
    const withMarriages = layoutFocus(f);
    const without = layoutFocus(f, { showMarriages: false });
    const ids = (l: typeof without) => l.nodes.flatMap((n) => [n.person.id, ...(n.partner ? [n.partner.id] : [])]);
    expect(ids(without).length).toBeLessThanOrEqual(ids(withMarriages).length);
    // Beide Ehefrauen sind Mütter von Kindern im Ausschnitt.
    expect(ids(without)).toContain(L.divorced.firstSpouse);
    expect(ids(without)).toContain(L.divorced.secondSpouse);
    expect(without.edges.every((e) => e.kind === "parent")).toBe(true);
  });
});

describe("defaultFocusId / parseDepth", () => {
  it("wählt deterministisch eine sichtbare Person", () => {
    const data = mockTreeData();
    const depth = { up: FOCUS_DEPTH.up, down: FOCUS_DEPTH.down };
    const id = defaultFocusId(data, depth);
    expect(id).not.toBeNull();
    expect(defaultFocusId(data, depth)).toBe(id);

    const familyA = "A"; // mockTreeData nutzt die Familienschlüssel als IDs
    const masked = maskedFor([familyA]);
    const forViewer = defaultFocusId(masked, depth)!;
    expect(masked.persons.find((p) => p.id === forViewer)?.restricted).toBeFalsy();

    expect(defaultFocusId(maskedFor([]), depth)).toBeNull();
  });

  it("begrenzt die Tiefe", () => {
    expect(parseDepth(undefined, 2)).toBe(2);
    expect(parseDepth("3", 2)).toBe(3);
    expect(parseDepth("99", 2)).toBe(FOCUS_DEPTH.max);
    expect(parseDepth("0", 2)).toBe(FOCUS_DEPTH.min);
    expect(parseDepth("abc", 2)).toBe(2);
    expect(parseDepth("1.5", 2)).toBe(2);
  });
});
