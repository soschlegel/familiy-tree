/**
 * Ansicht „Ringe“ (lib/ancestor-rings.ts): Platzvergabe (volle Belegung,
 * Lücken, Seitenregel, Ahnenschwund, Zyklus, nicht sichtbarer Vorfahr),
 * Geometrie, lesbare Textausrichtung, Beschriftungsplan und
 * Verwandtschaftsstufe. Rein, ohne Datenbank; erfundene Personen.
 */
import { describe, expect, it } from "vitest";

import {
  assignRingSlots,
  fitName,
  fitYears,
  isLowerHalf,
  labelArcPath,
  lineTint,
  orderParents,
  parseRingsColoring,
  parseRingsGeneration,
  radialRotation,
  ringGeometry,
  ringLabelPlan,
  ringRelationTerm,
  ringSlotCount,
  ringsSummary,
  RINGS_VIEWBOX,
  sectorPath,
  slotAngles,
  slotLine,
  slotSide,
  type RingParent,
  type RingSlot,
} from "@/lib/ancestor-rings";
import type { Sex } from "@/lib/kinship";
import { treeUrl } from "@/components/tree-url";

/** Stammbaum aus „Kind: [Elternteil, Geschlecht]“-Listen. */
function graph(
  rootId: string,
  generations: number,
  edges: Record<string, [string, Sex][]>,
  opts: { hidden?: string[] } = {},
) {
  const hidden = new Set(opts.hidden ?? []);
  const asked: string[] = [];
  return {
    asked,
    graph: {
      rootId,
      generations,
      parentsOf: (id: string): RingParent[] => {
        asked.push(id);
        return (edges[id] ?? []).map(([pid, gender]) => ({ id: pid, gender }));
      },
      visible: (id: string) => !hidden.has(id),
    },
  };
}

const at = (slots: RingSlot[]) =>
  Object.fromEntries(slots.map((s) => [`${s.generation}:${s.index}`, s.kind === "person" ? s.personId : "gesperrt"]));

describe("Platzvergabe", () => {
  it("volle Belegung: Vater im Uhrzeigersinn zuerst, Mutter danach — in jeder Generation", () => {
    const { graph: g } = graph("kind", 2, {
      kind: [["mutter", "FEMALE"], ["vater", "MALE"]],
      vater: [["vv", "MALE"], ["vm", "FEMALE"]],
      mutter: [["mm", "FEMALE"], ["mv", "MALE"]],
    });
    expect(at(assignRingSlots(g))).toEqual({
      "1:0": "vater",
      "1:1": "mutter",
      "2:0": "vv",
      "2:1": "vm",
      "2:2": "mv",
      "2:3": "mm",
    });
  });

  it("Reihenfolge innen nach außen, im Uhrzeigersinn", () => {
    const { graph: g } = graph("k", 2, {
      k: [["v", "MALE"], ["m", "FEMALE"]],
      m: [["mv", "MALE"]],
      v: [["vm", "FEMALE"]],
    });
    expect(assignRingSlots(g).map((s) => `${s.generation}:${s.index}`)).toEqual(["1:0", "1:1", "2:1", "2:2"]);
  });

  it("Lücken: ein fehlender Elternteil lässt seinen Platz frei, nichts verschiebt sich", () => {
    // Nur die Mutter bekannt: sie steht auf dem Mutterplatz, der Vaterplatz bleibt leer.
    const { graph: g } = graph("k", 3, {
      k: [["m", "FEMALE"]],
      m: [["mm", "FEMALE"]],
      mm: [["mmv", "MALE"]],
    });
    expect(at(assignRingSlots(g))).toEqual({ "1:1": "m", "2:3": "mm", "3:6": "mmv" });
  });

  it("unbekanntes Geschlecht: einzeln auf den Vaterplatz, zu zweit in stabiler Reihenfolge", () => {
    expect(orderParents([{ id: "a", gender: "UNKNOWN" }])).toEqual([{ id: "a", gender: "UNKNOWN" }, null]);
    expect(orderParents([{ id: "b", gender: "UNKNOWN" }, { id: "a", gender: "OTHER" }]).map((p) => p?.id)).toEqual(["b", "a"]);
    // Gleiches Geschlecht: Eingabereihenfolge.
    expect(orderParents([{ id: "y", gender: "FEMALE" }, { id: "x", gender: "FEMALE" }]).map((p) => p?.id)).toEqual(["y", "x"]);
    // Bekannter Vater + unbekannt: unbekannt auf den Mutterplatz; bekannte Mutter + unbekannt: unbekannt auf den Vaterplatz.
    expect(orderParents([{ id: "u", gender: "UNKNOWN" }, { id: "v", gender: "MALE" }]).map((p) => p?.id)).toEqual(["v", "u"]);
    expect(orderParents([{ id: "m", gender: "FEMALE" }, { id: "u", gender: "UNKNOWN" }]).map((p) => p?.id)).toEqual(["u", "m"]);
    // Doppelte zählen einmal, mehr als zwei: nur die ersten zwei nach der Regel.
    expect(orderParents([{ id: "v", gender: "MALE" }, { id: "v", gender: "MALE" }])).toEqual([{ id: "v", gender: "MALE" }, null]);
    expect(
      orderParents([
        { id: "m", gender: "FEMALE" },
        { id: "v1", gender: "MALE" },
        { id: "v2", gender: "MALE" },
      ]).map((p) => p?.id),
    ).toEqual(["v1", "v2"]);
  });

  it("Ahnenschwund: derselbe Vorfahr auf jedem seiner Plätze", () => {
    // Die Eltern sind Cousin und Cousine: gemeinsames Großelternpaar.
    const { graph: g } = graph("k", 3, {
      k: [["v", "MALE"], ["m", "FEMALE"]],
      v: [["vv", "MALE"], ["vm", "FEMALE"]],
      m: [["mv", "MALE"], ["mm", "FEMALE"]],
      vv: [["ahn", "MALE"], ["ahnin", "FEMALE"]],
      mm: [["ahn", "MALE"], ["ahnin", "FEMALE"]],
    });
    const slots = assignRingSlots(g);
    expect(slots.filter((s) => s.kind === "person" && s.personId === "ahn").map((s) => s.index)).toEqual([0, 6]);
    expect(slots.filter((s) => s.kind === "person" && s.personId === "ahnin").map((s) => s.index)).toEqual([1, 7]);
  });

  it("Zyklus in fehlerhaften Daten: hängt nicht, der Platz bleibt leer", () => {
    const { graph: g, asked } = graph("k", 7, {
      k: [["v", "MALE"], ["m", "FEMALE"]],
      v: [["k", "MALE"], ["vm", "FEMALE"]],
      vm: [["v", "MALE"]],
      m: [["m", "FEMALE"]],
    });
    const slots = assignRingSlots(g);
    expect(at(slots)).toEqual({ "1:0": "v", "1:1": "m", "2:1": "vm" });
    expect(asked.length).toBeLessThan(20);
  });

  it("nicht sichtbarer Vorfahr: Platz ohne Kennung, über ihn hinaus nichts", () => {
    const { graph: g, asked } = graph(
      "k",
      4,
      {
        k: [["v", "MALE"], ["m", "FEMALE"]],
        m: [["mv", "MALE"], ["mm", "FEMALE"]],
        mm: [["geheim1", "MALE"], ["geheim2", "FEMALE"]],
      },
      { hidden: ["m"] },
    );
    const slots = assignRingSlots(g);
    expect(slots).toContainEqual({ generation: 1, index: 1, kind: "restricted" });
    expect(JSON.stringify(slots)).not.toMatch(/"m"|mv|mm|geheim/);
    expect(asked).not.toContain("m");
  });

  it("Tiefe begrenzt: nichts jenseits der letzten Generation", () => {
    const { graph: g } = graph("k", 1, {
      k: [["v", "MALE"]],
      v: [["vv", "MALE"]],
    });
    expect(at(assignRingSlots(g))).toEqual({ "1:0": "v" });
  });
});

describe("Seite, Linie und Verwandtschaftsstufe", () => {
  it("Vaterseite oben (erste Hälfte), Mutterseite unten", () => {
    expect(slotSide(1, 0)).toBe("paternal");
    expect(slotSide(1, 1)).toBe("maternal");
    expect(slotSide(3, 3)).toBe("paternal");
    expect(slotSide(3, 4)).toBe("maternal");
    expect(slotLine(1, 0)).toBeNull();
    expect([0, 1, 2, 3].map((i) => slotLine(2, i))).toEqual(["FF", "FM", "MF", "MM"]);
    expect(slotLine(4, 5)).toBe("FM");
    expect(slotLine(4, 15)).toBe("MM");
  });

  it("Begriffe aus lib/kinship.ts", () => {
    expect(ringRelationTerm(1, "MALE")).toBe("Vater");
    expect(ringRelationTerm(1, "FEMALE", "maternal")).toBe("Mutter");
    expect(ringRelationTerm(2, "FEMALE", "paternal")).toBe("Großmutter väterlicherseits");
    expect(ringRelationTerm(3, "FEMALE", "maternal")).toBe("Urgroßmutter mütterlicherseits");
    expect(ringRelationTerm(4, "UNKNOWN")).toBe("Ururgroßelternteil");
    expect(ringRelationTerm(7, "MALE", "paternal")).toBe("Vorfahr in der 7. Generation väterlicherseits");
  });
});

describe("Geometrie", () => {
  it("Ringe lückenlos von der Mitte bis kurz vor den Rand, äußere schmaler", () => {
    for (let n = 3; n <= 7; n++) {
      const g = ringGeometry(n);
      expect(g.rings).toHaveLength(n);
      expect(g.rings[0].inner).toBeCloseTo(g.centerRadius);
      for (let i = 1; i < n; i++) expect(g.rings[i].inner).toBeCloseTo(g.rings[i - 1].outer);
      expect(g.rings[n - 1].outer).toBeLessThanOrEqual(RINGS_VIEWBOX / 2);
      expect(g.rings[n - 1].outer).toBeGreaterThan(RINGS_VIEWBOX / 2 - 20);
    }
    const seven = ringGeometry(7);
    const w = (i: number) => seven.rings[i].outer - seven.rings[i].inner;
    expect(w(6)).toBeLessThan(w(3));
    // Auch der äußerste Ring bleibt zu treffen (≥ 4 % des Durchmessers).
    expect(w(6)).toBeGreaterThan(RINGS_VIEWBOX * 0.04);
  });

  it("Winkel: beginnt links, jeder Bogen halbiert sich für die Eltern", () => {
    expect(slotAngles(1, 0)).toEqual({ start: 180, end: 360, mid: 270 });
    expect(slotAngles(1, 1)).toEqual({ start: 360, end: 540, mid: 450 });
    const child = slotAngles(2, 1);
    expect(slotAngles(3, 2).start).toBe(child.start);
    expect(slotAngles(3, 3).end).toBe(child.end);
    expect(slotAngles(3, 2).end).toBe(child.mid);
  });

  it("Pfade: Ringstück mit zwei Bögen", () => {
    const d = sectorPath(500, 100, 200, 180, 270);
    expect(d).toMatch(/^M300 500A200 200 0 0 1 500 300L500 400A100 100 0 0 0 400 500Z$/);
    // Halber Kreis: kein großer Bogen nötig.
    expect(sectorPath(500, 100, 200, 180, 360)).toContain("A200 200 0 0 1");
  });

  it("Text im Bogen nie auf dem Kopf: unten umgekehrter Pfad", () => {
    expect(isLowerHalf(270)).toBe(false); // oben
    expect(isLowerHalf(90)).toBe(true); // unten
    expect(isLowerHalf(450)).toBe(true);
    // Oben im Uhrzeigersinn (Bogenflag 1), von links nach rechts.
    expect(labelArcPath(500, 100, 180, 360)).toBe("M400 500A100 100 0 0 1 600 500");
    // Unten gegen den Uhrzeigersinn (Bogenflag 0), ebenfalls von links nach rechts.
    const lower = labelArcPath(500, 100, 360, 540);
    expect(lower).toBe("M400 500A100 100 0 0 0 600 500");
  });

  it("Text entlang des Radius: rechts nach außen, links nach innen gedreht", () => {
    expect(radialRotation(10)).toBe(10);
    expect(radialRotation(300)).toBe(300);
    expect(radialRotation(200)).toBe(20);
    expect(radialRotation(100)).toBe(-80);
    for (const deg of [0, 45, 95, 179, 181, 269, 271, 359, 400, 530]) {
      const r = radialRotation(deg);
      // Gedreht um r zeigt die Schrift nach rechts (cos ≥ 0) — also nie kopfüber.
      expect(Math.cos((r * Math.PI) / 180)).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe("Beschriftung", () => {
  it("großer Kreis: innen im Bogen mit Name und Jahren, außen nichts", () => {
    const plan = ringLabelPlan(ringGeometry(7), 0.8);
    expect(plan[0]).toMatchObject({ mode: "arc", lines: 2 });
    expect(plan[1]).toMatchObject({ mode: "arc", lines: 2 });
    expect(plan[6].mode).toBe("none");
  });

  it("kleiner Kreis (Telefon): weniger Ringe beschriftet, Schrift in viewBox-Einheiten größer", () => {
    const g = ringGeometry(5);
    const big = ringLabelPlan(g, 0.8);
    const small = ringLabelPlan(g, 0.34);
    expect(small[0].fontSize).toBeGreaterThan(big[0].fontSize);
    const labelled = (p: typeof big) => p.filter((r) => r.mode !== "none").length;
    expect(labelled(small)).toBeLessThanOrEqual(labelled(big));
    for (const r of small) if (r.mode !== "none") expect(r.maxChars).toBeGreaterThanOrEqual(4);
  });

  it("Namen und Jahre kürzen, wenn der Platz nicht reicht", () => {
    expect(fitName("Anna", "Muster", 20)).toBe("Anna Muster");
    expect(fitName("Anna", "Musterfrau", 10)).toBe("Anna M.");
    expect(fitName("Wilhelmine", "Musterfrau", 10)).toBe("Wilhelmine");
    expect(fitName("Wilhelmine", "Musterfrau", 6)).toBe("Wilhe…");
    expect(fitName("Wilhelmine", null, 3)).toBe("");
    expect(fitYears("1850 – 1912", 20)).toBe("1850 – 1912");
    expect(fitYears("1850 – 1912", 9)).toBe("1850–1912");
    expect(fitYears("1850 – 1912", 5)).toBe("");
  });

  it("Zusammenfassung und Zahl der Plätze", () => {
    expect(ringSlotCount(5)).toBe(62);
    expect(ringsSummary(5, 23, 0)).toBe("23 von 62 Vorfahren bis zur 5. Generation bekannt");
    expect(ringsSummary(3, 5, 2)).toBe("5 von 14 Vorfahren bis zur 3. Generation bekannt, davon 2 nicht freigegeben");
  });

  it("Farbton nach außen heller", () => {
    for (let g = 1; g < 7; g++) expect(lineTint(g + 1)).toBeLessThanOrEqual(lineTint(g));
    expect(lineTint(1)).toBeLessThanOrEqual(50);
  });
});

describe("Adresse", () => {
  it("Tiefe 3–7 (Standard 5), Färbung linie/wurzeln", () => {
    expect(parseRingsGeneration(undefined)).toBe(5);
    expect(parseRingsGeneration("abc")).toBe(5);
    expect(parseRingsGeneration("2")).toBe(3);
    expect(parseRingsGeneration("12")).toBe(7);
    expect(parseRingsGeneration("6")).toBe(6);
    expect(parseRingsColoring("wurzeln")).toBe("wurzeln");
    expect(parseRingsColoring("bunt")).toBe("linie");
  });

  it("treeUrl: Standardwerte bleiben weg", () => {
    expect(treeUrl({ view: "rings", focus: "p1" })).toBe("/tree?view=rings&focus=p1");
    expect(treeUrl({ view: "rings", focus: "p1", generations: 7, coloring: "wurzeln", vollbild: true })).toBe(
      "/tree?view=rings&focus=p1&generationen=7&farbe=wurzeln&vollbild=1",
    );
    // Andere Ansichten tragen die Ringe-Parameter nicht.
    expect(treeUrl({ view: "focus", focus: "p1", generations: 7 })).toBe("/tree?focus=p1");
  });
});
