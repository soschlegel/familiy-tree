import { describe, expect, it } from "vitest";

import { buildGraphIndex, type GraphEdge } from "@/lib/graph";
import {
  bloodRelationTerm,
  describePath,
  findBloodRelation,
  stepTerm,
  type KinshipStep,
} from "@/lib/kinship";

let n = 0;
const parent = (from: string, to: string, subtype = "BIOLOGICAL"): GraphEdge => ({
  id: `e${++n}`,
  type: "PARENT_OF",
  subtype,
  from,
  to,
});
const partner = (from: string, to: string, subtype = "MARRIED"): GraphEdge => ({
  id: `e${++n}`,
  type: "PARTNER_OF",
  subtype,
  from,
  to,
});

describe("bloodRelationTerm", () => {
  const t = (up: number, down: number, sex: "MALE" | "FEMALE" | "UNKNOWN", extra = {}) =>
    bloodRelationTerm({ up, down, sex, ...extra });

  it("Vorfahren und Nachfahren", () => {
    expect(t(0, 0, "MALE")).toBe("dieselbe Person");
    expect(t(1, 0, "MALE")).toBe("Vater");
    expect(t(1, 0, "UNKNOWN")).toBe("Elternteil");
    expect(t(2, 0, "FEMALE", { side: "paternal" })).toBe("Großmutter väterlicherseits");
    expect(t(3, 0, "MALE")).toBe("Urgroßvater");
    expect(t(4, 0, "FEMALE", { side: "maternal" })).toBe("Ururgroßmutter mütterlicherseits");
    expect(t(9, 0, "MALE")).toBe("Vorfahr in der 9. Generation");
    expect(t(0, 1, "FEMALE")).toBe("Tochter");
    expect(t(0, 2, "MALE")).toBe("Enkel");
    expect(t(0, 3, "FEMALE")).toBe("Urenkelin");
    expect(t(0, 4, "UNKNOWN")).toBe("Ururenkelkind");
  });

  it("Seitenlinien", () => {
    expect(t(1, 1, "MALE")).toBe("Bruder");
    expect(t(1, 1, "FEMALE", { half: true })).toBe("Halbschwester");
    expect(t(2, 1, "MALE", { side: "maternal" })).toBe("Onkel mütterlicherseits");
    expect(t(2, 1, "FEMALE")).toBe("Tante");
    expect(t(3, 1, "FEMALE")).toBe("Großtante");
    expect(t(4, 1, "MALE")).toBe("Urgroßonkel");
    expect(t(1, 2, "MALE")).toBe("Neffe");
    expect(t(1, 2, "FEMALE")).toBe("Nichte");
    expect(t(1, 3, "MALE")).toBe("Großneffe");
    expect(t(2, 2, "MALE")).toBe("Cousin 1. Grades");
    expect(t(2, 2, "FEMALE", { side: "paternal" })).toBe("Cousine 1. Grades väterlicherseits");
    expect(t(3, 3, "MALE")).toBe("Cousin 2. Grades");
    expect(t(3, 2, "FEMALE")).toBe("Cousine 1. Grades, eine Generation darüber");
    expect(t(2, 4, "MALE")).toBe("Cousin 1. Grades, 2 Generationen darunter");
    expect(t(3, 2, "FEMALE", { side: "maternal" })).toBe(
      "Cousine 1. Grades mütterlicherseits, eine Generation darüber",
    );
    expect(t(2, 2, "MALE", { half: true })).toBe("Halbcousin 1. Grades");
  });

  it("Adoption", () => {
    expect(t(1, 0, "MALE", { adoptive: true })).toBe("Adoptivvater");
    expect(t(0, 1, "FEMALE", { adoptive: true })).toBe("Adoptivtochter");
    expect(t(2, 0, "FEMALE", { adoptive: true })).toBe("Großmutter (über Adoption)");
  });
});

describe("findBloodRelation", () => {
  // Großeltern G1+G2 -> Kinder V (Vater) und T (Tante); V+M -> A und B;
  // T -> C (Cousin von A). V hat mit X noch das Kind H (Halbbruder).
  // A adoptiert D.
  const edges = [
    parent("G1", "V"),
    parent("G2", "V"),
    parent("G1", "T"),
    parent("G2", "T"),
    parent("V", "A"),
    parent("M", "A"),
    parent("V", "B"),
    parent("M", "B"),
    parent("T", "C"),
    parent("V", "H"),
    parent("X", "H"),
    parent("A", "D", "ADOPTIVE"),
    parent("S", "A", "STEP"),
    partner("V", "M"),
    partner("C", "CP"),
  ];
  const index = buildGraphIndex(edges);

  it("Geschwister voll und halb", () => {
    expect(findBloodRelation(index, "A", "B")).toMatchObject({ up: 1, down: 1, half: false, commonAncestorIds: ["M", "V"] });
    expect(findBloodRelation(index, "A", "H")).toMatchObject({ up: 1, down: 1, half: true, commonAncestorIds: ["V"] });
  });

  it("Cousin mit Seite und Großeltern", () => {
    const r = findBloodRelation(index, "A", "C")!;
    expect(r).toMatchObject({ up: 2, down: 2, half: false, lineParentId: "V" });
    expect(r.commonAncestorIds).toEqual(["G1", "G2"]);
    expect(findBloodRelation(index, "A", "G1")).toMatchObject({ up: 2, down: 0, lineParentId: "V" });
    expect(findBloodRelation(index, "G1", "A")).toMatchObject({ up: 0, down: 2 });
    expect(findBloodRelation(index, "A", "T")).toMatchObject({ up: 2, down: 1 });
  });

  it("Adoption zählt, Stiefelternschaft und Partnerschaft nicht", () => {
    expect(findBloodRelation(index, "D", "A")).toMatchObject({ up: 1, down: 0, adoptive: true });
    expect(findBloodRelation(index, "D", "V")).toMatchObject({ up: 2, down: 0, adoptive: true });
    expect(findBloodRelation(index, "A", "S")).toBeNull();
    expect(findBloodRelation(index, "A", "CP")).toBeNull();
  });

  it("fehlender zweiter Elternteil ist keine Halbverwandtschaft", () => {
    const idx = buildGraphIndex([parent("P", "K1"), parent("P", "K2")]);
    expect(findBloodRelation(idx, "K1", "K2")).toMatchObject({ up: 1, down: 1, half: false });
  });

  it("bricht bei Zyklen in fehlerhaften Daten nicht ab", () => {
    const idx = buildGraphIndex([parent("Z1", "Z2"), parent("Z2", "Z1")]);
    expect(findBloodRelation(idx, "Z1", "Z2")).not.toBeNull();
  });
});

describe("describePath", () => {
  const s = (relation: KinshipStep["relation"], sex: KinshipStep["sex"], subtype?: string): KinshipStep => ({
    relation,
    sex,
    subtype: subtype ?? (relation === "partner" ? "MARRIED" : "BIOLOGICAL"),
  });

  it("Einzelschritte", () => {
    expect(stepTerm(s("parent", "MALE", "STEP"))).toBe("Stiefvater");
    expect(stepTerm(s("child", "FEMALE", "FOSTER"))).toBe("Pflegetochter");
    expect(stepTerm(s("partner", "FEMALE", "DIVORCED"))).toBe("geschiedene Ehefrau");
    expect(describePath([s("partner", "MALE")]).term).toBe("Ehemann");
  });

  it("Abstammung über den Weg", () => {
    const r = describePath([s("parent", "MALE"), s("parent", "FEMALE")]);
    expect(r.term).toBe("Großmutter väterlicherseits");
    expect(r.chain).toBe("Vater → Mutter");
  });

  it("Schwägerschaft", () => {
    expect(describePath([s("partner", "FEMALE"), s("parent", "FEMALE")]).term).toBe("Schwiegermutter");
    expect(describePath([s("child", "FEMALE"), s("partner", "MALE")]).term).toBe("Schwiegersohn");
    expect(describePath([s("parent", "MALE"), s("child", "FEMALE"), s("partner", "MALE")]).term).toBe("Schwager");
    expect(describePath([s("partner", "MALE"), s("parent", "FEMALE"), s("child", "MALE")]).term).toBe("Schwager");
    expect(describePath([s("partner", "MALE"), s("parent", "FEMALE"), s("child", "FEMALE")]).term).toBe("Schwägerin");
    expect(describePath([s("parent", "FEMALE"), s("partner", "MALE")]).term).toBe("Stiefvater");
    expect(describePath([s("partner", "FEMALE"), s("child", "MALE")]).term).toBe("Stiefsohn");
    expect(
      describePath([s("parent", "MALE"), s("parent", "MALE"), s("child", "MALE"), s("partner", "FEMALE")]).term,
    ).toBe("angeheiratete Tante väterlicherseits");
    expect(
      describePath([s("partner", "FEMALE"), s("parent", "MALE"), s("child", "MALE"), s("partner", "FEMALE")]).term,
    ).toBe("Schwippschwägerin");
    expect(describePath([s("partner", "MALE"), s("parent", "FEMALE"), s("parent", "MALE"), s("child", "MALE")]).term).toBe(
      "Onkel des Ehemanns",
    );
    expect(describePath([s("child", "MALE"), s("parent", "FEMALE")]).term).toBe("Mutter eines gemeinsamen Kindes");
  });

  it("Fallback auf die Kette", () => {
    const r = describePath([s("partner", "FEMALE"), s("partner", "MALE")]);
    expect(r.term).toBeNull();
    expect(r.chain).toBe("Ehefrau → Ehemann");
    // Platzhalter ohne Geschlecht bleiben neutral.
    expect(describePath([s("parent", "UNKNOWN"), s("partner", "UNKNOWN", "UNMARRIED")]).chain).toBe("Elternteil → Partner/in");
  });
});
