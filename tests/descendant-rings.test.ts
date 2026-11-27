/**
 * Ansicht „Ringe“, Richtung „Nachfahren“ (lib/descendant-rings.ts):
 * Aufteilung nach Gewicht, kinderlose Kinder, Reihenfolge und Gruppen nach
 * Partnerschaft, Mehrfach-Nachkomme, Zyklus, nicht sichtbarer Nachkomme,
 * Obergrenze, Mindestbreite, Begriffe und Zusammenfassung; dazu die Adresse
 * mit Richtung. Rein, ohne Datenbank; erfundene Personen.
 */
import { describe, expect, it } from "vitest";

import {
  arcLabelPlan,
  parseRingsDirection,
  parseRingsGeneration,
  ringGeometry,
  ringLabelPlan,
  ringsDefaultGeneration,
  sectorPath,
} from "@/lib/ancestor-rings";
import {
  descendantRelationTerm,
  descendantsCapNotice,
  descendantsSummary,
  groupChildren,
  GROUP_GAP_DEG,
  layoutDescendants,
  MIN_SPAN_DEG,
  splitArc,
  type DescendantSegment,
  type RingChild,
} from "@/lib/descendant-rings";
import { treeUrl } from "@/components/tree-url";

/** Stammbaum aus „Elternteil: [Kind, Gruppe?, adoptiert?]“-Listen. */
function graph(
  rootId: string,
  generations: number,
  edges: Record<string, (string | [string, string?, boolean?])[]>,
  opts: { hidden?: string[]; maxSegments?: number } = {},
) {
  const hidden = new Set(opts.hidden ?? []);
  const asked: string[] = [];
  return {
    asked,
    graph: {
      rootId,
      generations,
      maxSegments: opts.maxSegments,
      childrenOf: (id: string): RingChild[] => {
        asked.push(id);
        return (edges[id] ?? []).map((e) =>
          typeof e === "string" ? { id: e, adopted: false, group: "" } : { id: e[0], group: e[1] ?? "", adopted: e[2] ?? false },
        );
      },
      visible: (id: string) => !hidden.has(id),
    },
  };
}

const span = (s: DescendantSegment) => s.end - s.start;
const byPerson = (segs: DescendantSegment[], id: string) => segs.filter((s) => s.kind === "person" && s.personId === id);
const one = (segs: DescendantSegment[], id: string) => {
  const found = byPerson(segs, id);
  expect(found).toHaveLength(1);
  return found[0];
};

describe("Nachfahren-Ringe: Aufteilung", () => {
  it("teilt den Vollkreis nach der Größe der Teilbäume; jede Person zählt sich selbst", () => {
    // a hat zwei Kinder (Gewicht 3), b ist kinderlos (Gewicht 1).
    const { graph: g } = graph("r", 4, { r: ["a", "b"], a: ["a1", "a2"] });
    const { segments, deepest, capped } = layoutDescendants(g);
    expect(deepest).toBe(2);
    expect(capped).toBe(false);
    const a = one(segments, "a");
    const b = one(segments, "b");
    // Kinderloses Kind bleibt sichtbar; Verhältnis nach Mindestbreite 3 : 1.
    expect(span(b)).toBeGreaterThan(0);
    const rest = 360 - 2 * MIN_SPAN_DEG;
    expect(span(a)).toBeCloseTo(MIN_SPAN_DEG + (rest * 3) / 4, 6);
    expect(span(b)).toBeCloseTo(MIN_SPAN_DEG + rest / 4, 6);
    // Vollkreis ab 9 Uhr im Uhrzeigersinn, lückenlos.
    expect(a.start).toBe(180);
    expect(b.end).toBeCloseTo(540, 6);
    // a gibt seinen Bogen ganz an seine Kinder weiter.
    const [a1, a2] = [one(segments, "a1"), one(segments, "a2")];
    expect(a1.start).toBeCloseTo(a.start, 6);
    expect(a2.end).toBeCloseTo(a.end, 6);
    expect(span(a1)).toBeCloseTo(span(a2), 6);
    expect(a1.parentKey).toBe(a.key);
    expect(a.parentKey).toBeNull();
  });

  it("Reihenfolge der Eingabe (nach Geburt) im Uhrzeigersinn, Schlüssel je Ring durchnummeriert", () => {
    const { graph: g } = graph("r", 3, { r: ["c1", "c2", "c3"], c2: ["e1"], c3: ["e2"] });
    const { segments } = layoutDescendants(g);
    expect(segments.map((s) => (s.kind === "person" ? s.personId : "?"))).toEqual(["c1", "c2", "c3", "e1", "e2"]);
    expect(segments.map((s) => s.key)).toEqual(["1:0", "1:1", "1:2", "2:0", "2:1"]);
    // Linie = Kind der Mitte.
    expect(one(segments, "e2").line).toBe(2);
    expect(one(segments, "e1").line).toBe(1);
  });

  it("gruppiert Kinder nach Partnerschaft (Gruppe des ältesten Kindes zuerst) mit kleiner Lücke", () => {
    expect(groupChildren([{ id: "1", group: "x" }, { id: "2", group: "y" }, { id: "3", group: "x" }]).map((c) => c.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
    const { graph: g } = graph("r", 3, { r: [["k1", "p"], ["k2", "q"], ["k3", "p"]] });
    const { segments } = layoutDescendants(g);
    const [k1, k3, k2] = [one(segments, "k1"), one(segments, "k3"), one(segments, "k2")];
    expect(k3.start).toBeCloseTo(k1.end, 6); // gleiche Partnerschaft: keine Lücke
    expect(k2.start - k3.end).toBeCloseTo(GROUP_GAP_DEG, 6); // Lücke zwischen den Gruppen
    expect(k2.end).toBeCloseTo(540 - 0, 6);
  });

  it("splitArc: Mindestbreite, Lücken nur bei Platz, gleichmäßig wenn der Bogen nicht reicht", () => {
    const parts = splitArc(10, [
      { weight: 100, group: "" },
      { weight: 1, group: "" },
    ]);
    expect(parts[1].end - parts[1].start).toBeGreaterThanOrEqual(MIN_SPAN_DEG);
    expect(parts[1].end).toBeCloseTo(10, 6);
    const tiny = splitArc(1, [
      { weight: 5, group: "a" },
      { weight: 1, group: "b" },
      { weight: 1, group: "c" },
    ]);
    // Lücken höchstens ein Zehntel des Bogens.
    expect(tiny[1].start - tiny[0].end).toBeCloseTo(0.05, 6);
    expect(tiny[2].end).toBeCloseTo(1, 6);
    expect(splitArc(5, [])).toEqual([]);
  });

  it("Mehrfach-Nachkomme erscheint an jeder Stelle; Gewicht zählt ihn je Stelle", () => {
    // x ist Enkel über a und über b (Ehe unter Verwandten).
    const { graph: g, asked } = graph("r", 4, { r: ["a", "b"], a: ["x"], b: ["x"], x: ["y"] });
    const { segments } = layoutDescendants(g);
    expect(byPerson(segments, "x")).toHaveLength(2);
    expect(byPerson(segments, "y")).toHaveLength(2);
    expect(span(one(segments, "a"))).toBeCloseTo(span(one(segments, "b")), 6);
    // Kinder werden je Stelle gefragt (der Dienst lädt sie trotzdem nur einmal).
    expect(asked.filter((id) => id === "x")).toHaveLength(2);
  });

  it("Zyklus in fehlerhaften Daten hängt nicht und lässt das Kind weg", () => {
    const { graph: g } = graph("r", 7, { r: ["a"], a: ["b"], b: ["a", "r", "c"], c: ["c"] });
    const { segments } = layoutDescendants(g);
    expect(segments.map((s) => (s.kind === "person" ? s.personId : "?"))).toEqual(["a", "b", "c"]);
  });

  it("nicht sichtbarer Nachkomme: Fläche ohne Kennung, nichts dahinter, zählt als eine Person", () => {
    const { graph: g, asked } = graph("r", 4, { r: ["h", "v"], h: ["h1", "h2", "h3"], v: ["v1"] }, { hidden: ["h"] });
    const { segments } = layoutDescendants(g);
    const h = segments.find((s) => s.generation === 1 && s.kind === "restricted")!;
    expect(h).toBeDefined();
    expect("personId" in h).toBe(false);
    expect(asked).not.toContain("h");
    expect(segments.filter((s) => s.parentKey === h.key)).toHaveLength(0);
    // Gewicht h = 1, v = 2.
    const rest = 360 - 2 * MIN_SPAN_DEG;
    expect(span(h)).toBeCloseTo(MIN_SPAN_DEG + rest / 3, 6);
    expect(JSON.stringify(segments)).not.toContain('"h"');
  });

  it("Obergrenze: äußere Generationen entfallen ganz, Kinder der Mitte bleiben", () => {
    // 3 Kinder × 4 Enkel × 4 Urenkel = 3 + 12 + 48 Flächen.
    const edges: Record<string, string[]> = { r: ["a", "b", "c"] };
    for (const k of ["a", "b", "c"]) {
      edges[k] = [0, 1, 2, 3].map((i) => `${k}${i}`);
      for (const e of edges[k]) edges[e] = [0, 1, 2, 3].map((i) => `${e}${i}`);
    }
    const full = layoutDescendants(graph("r", 5, edges).graph);
    expect(full.segments).toHaveLength(63);
    expect(full.capped).toBe(false);
    expect(full.shownGenerations).toBe(5);
    const capped = layoutDescendants(graph("r", 5, edges, { maxSegments: 20 }).graph);
    expect(capped.capped).toBe(true);
    expect(capped.shownGenerations).toBe(2);
    expect(capped.deepest).toBe(2);
    expect(capped.segments).toHaveLength(15);
    // Die gezeigten Generationen füllen trotzdem den Vollkreis.
    const outer = capped.segments.filter((s) => s.generation === 2);
    expect(outer[0].start).toBe(180);
    expect(outer[outer.length - 1].end).toBeCloseTo(540, 6);
    const tiny = layoutDescendants(graph("r", 5, edges, { maxSegments: 1 }).graph);
    expect(tiny.segments).toHaveLength(3);
    expect(tiny.capped).toBe(true);
  });

  it("ohne Kinder: keine Flächen, Tiefe 0", () => {
    const r = layoutDescendants(graph("r", 4, {}).graph);
    expect(r.segments).toEqual([]);
    expect(r.deepest).toBe(0);
    expect(r.capped).toBe(false);
  });

  it("Adoption wird an der Fläche vermerkt; doppelte Kinder zählen einmal", () => {
    const { graph: g } = graph("r", 3, { r: [["a", "", true], "a", "b"] });
    const { segments } = layoutDescendants(g);
    expect(one(segments, "a").adopted).toBe(true);
    expect(one(segments, "b").adopted).toBe(false);
  });
});

describe("Nachfahren-Ringe: Texte und Adresse", () => {
  it("Verwandtschaftsstufe aus Sicht der Mitte", () => {
    expect(descendantRelationTerm(1, "FEMALE")).toBe("Tochter");
    expect(descendantRelationTerm(2, "FEMALE")).toBe("Enkelin");
    expect(descendantRelationTerm(3, "MALE")).toBe("Urenkel");
    expect(descendantRelationTerm(2, "UNKNOWN")).toBe("Enkelkind");
  });

  it("Zusammenfassung und Hinweis zur Obergrenze", () => {
    expect(descendantsSummary(47, 4, 0)).toBe("47 Nachkommen in 4 Generationen");
    expect(descendantsSummary(1, 1, 0)).toBe("1 Nachkomme in 1 Generation");
    expect(descendantsSummary(12, 3, 2)).toBe("12 Nachkommen in 3 Generationen, davon 2 nicht freigegeben");
    expect(descendantsSummary(0, 0, 0)).toBe("Keine Nachkommen erfasst");
    expect(descendantsCapNotice(5, 7)).toContain("5 statt 7 Generationen");
  });

  it("Richtung und Standardtiefe aus der Adresse", () => {
    expect(parseRingsDirection("nachfahren")).toBe("nachfahren");
    expect(parseRingsDirection("x")).toBe("vorfahren");
    expect(parseRingsDirection(undefined)).toBe("vorfahren");
    expect(ringsDefaultGeneration("nachfahren")).toBe(4);
    expect(ringsDefaultGeneration("vorfahren")).toBe(5);
    expect(parseRingsGeneration(undefined, 4)).toBe(4);
    expect(parseRingsGeneration("9", 4)).toBe(7);
  });

  it("treeUrl: Richtung nur, wenn nicht Standard; Tiefe nur, wenn nicht Standard der Richtung", () => {
    expect(treeUrl({ view: "rings", focus: "p1" })).toBe("/tree?view=rings&focus=p1");
    expect(treeUrl({ view: "rings", focus: "p1", direction: "nachfahren", generations: 4 })).toBe(
      "/tree?view=rings&focus=p1&richtung=nachfahren",
    );
    expect(treeUrl({ view: "rings", focus: "p1", direction: "nachfahren", generations: 5, coloring: "wurzeln" })).toBe(
      "/tree?view=rings&focus=p1&richtung=nachfahren&generationen=5&farbe=wurzeln",
    );
    expect(treeUrl({ view: "rings", focus: "p1", generations: 4 })).toBe("/tree?view=rings&focus=p1&generationen=4");
    // Andere Ansichten tragen die Richtung nicht.
    expect(treeUrl({ view: "focus", focus: "p1", direction: "nachfahren" })).toBe("/tree?focus=p1");
  });

  it("sectorPath zeichnet einen Vollkreis (ein einziges Kind) als Ring mit zwei Halbbögen je Rand", () => {
    const d = sectorPath(500, 100, 200, 180, 540);
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d).toContain("M300 500A200 200 0 1 1 700 500");
    expect(d).toContain("M400 500A100 100 0 1 0 600 500");
    expect(sectorPath(500, 0, 200, 180, 540).match(/A/g)).toHaveLength(2);
  });

  it("arcLabelPlan entspricht für gleich breite Plätze genau ringLabelPlan", () => {
    const geo = ringGeometry(7);
    for (const px of [0.3, 0.56, 1]) {
      const plans = ringLabelPlan(geo, px);
      geo.rings.forEach((ring, i) => expect(arcLabelPlan(ring, 1 / 2 ** ring.generation, px)).toEqual(plans[i]));
    }
    // Ein schmaler Bogen bekommt keine oder höchstens radiale Schrift.
    expect(arcLabelPlan(geo.rings[0], 0.002, 1).mode).toBe("none");
  });
});
