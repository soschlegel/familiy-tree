/**
 * Regeln des Forschungs-Fortschritts (lib/research-progress.ts): Zählung je
 * Generation und Linie, Ahnenschwund, nicht freigegebene Vorfahren,
 * Qualitätspunkte, Beleg gegenüber fremdem Stammbaum, lebend/verstorben,
 * Reihenfolge der Vorschläge. Reine Funktionen, keine Datenbank.
 */
import { describe, expect, it } from "vitest";

import type { RingParent } from "@/lib/ancestor-rings";
import type { FuzzyDate } from "@/lib/dates";
import type { Sex } from "@/lib/kinship";
import {
  compareSuggestions,
  computeProgress,
  parseProgressGeneration,
  personQuality,
  type Evidence,
  type ProgressPerson,
  type Suggestion,
} from "@/lib/research-progress";

const NOW = new Date(Date.UTC(2026, 10, 27));

const year = (y: number): FuzzyDate => ({ date: new Date(Date.UTC(y, 0, 1)), precision: "YEAR", qualifier: "EXACT" });
const day = (y: number, m = 3, d = 12): FuzzyDate => ({ date: new Date(Date.UTC(y, m - 1, d)), precision: "DAY", qualifier: "EXACT" });

function person(id: string, over: Partial<ProgressPerson> = {}): ProgressPerson {
  return {
    id,
    name: `Person ${id}`,
    gender: "UNKNOWN",
    birth: null,
    birthPhrase: false,
    birthPlace: null,
    death: null,
    deathPhrase: false,
    deathPlace: null,
    ...over,
  };
}

/** Kleiner Stammbaum: Kind → [Vater, Mutter]; `hidden` sind nicht sichtbar. */
function input(opts: {
  persons: ProgressPerson[];
  parents: Record<string, string[]>;
  hidden?: string[];
  generations?: number;
  evidence?: Record<string, Evidence>;
  rootId?: string;
}) {
  const byId = new Map(opts.persons.map((p) => [p.id, p]));
  const hidden = new Set(opts.hidden ?? []);
  const visible = (id: string) => byId.has(id) && !hidden.has(id);
  return {
    rootId: opts.rootId ?? "root",
    generations: opts.generations ?? 4,
    now: NOW,
    person: (id: string) => (visible(id) ? byId.get(id) : undefined),
    parentsOf: (id: string): RingParent[] =>
      (opts.parents[id] ?? []).map((p) => ({ id: p, gender: visible(p) ? (byId.get(p)?.gender ?? "UNKNOWN") : ("UNKNOWN" as Sex) })),
    visible,
    evidence: (id: string, fact: "BIRTH" | "DEATH") => opts.evidence?.[`${id}|${fact}`] ?? "none",
  };
}

const M = (id: string, over: Partial<ProgressPerson> = {}) => person(id, { gender: "MALE", ...over });
const F = (id: string, over: Partial<ProgressPerson> = {}) => person(id, { gender: "FEMALE", ...over });

describe("Tiefe", () => {
  it("4…10, Standard 6", () => {
    expect(parseProgressGeneration(undefined)).toBe(6);
    expect(parseProgressGeneration("x")).toBe(6);
    expect(parseProgressGeneration("2")).toBe(4);
    expect(parseProgressGeneration("12")).toBe(10);
    expect(parseProgressGeneration(["8"])).toBe(8);
  });
});

describe("Zählung je Generation", () => {
  it("gefunden X von 2^n, fehlende Plätze, Gesamtzahl", () => {
    const r = computeProgress(
      input({
        persons: [person("root"), M("f"), F("m"), M("ff"), F("fm")],
        parents: { root: ["f", "m"], f: ["ff", "fm"] },
      }),
    );
    expect(r.byGeneration.map((g) => [g.generation, g.label, g.found, g.places, g.missing])).toEqual([
      [1, "Eltern", 2, 2, 0],
      [2, "Großeltern", 2, 4, 2],
      [3, "Urgroßeltern", 0, 8, 8],
      [4, "Ururgroßeltern", 0, 16, 16],
    ]);
    expect(r.total).toMatchObject({ places: 30, found: 4, restricted: 0, missing: 26, distinct: 4 });
  });

  it("Ahnenschwund zählt je Platz, verschiedene Personen getrennt", () => {
    // Die Eltern sind Cousins: gemeinsame Großeltern gp1/gp2 auf beiden Seiten.
    const r = computeProgress(
      input({
        persons: [person("root"), M("f"), F("m"), M("a"), F("b"), M("c"), F("d"), M("gp1"), F("gp2")],
        parents: { root: ["f", "m"], f: ["a", "b"], m: ["c", "d"], a: ["gp1", "gp2"], c: ["gp1", "gp2"] },
        generations: 4,
      }),
    );
    const g3 = r.byGeneration[2];
    expect(g3.found).toBe(4);
    expect(g3.distinct).toBe(2);
    // Qualität zählt jede Person einmal.
    expect(g3.quality.persons).toBe(2);
  });

  it("nicht freigegebener Vorfahr: eigene Kategorie samt allen Plätzen dahinter, keine Vorschläge zu ihm", () => {
    const r = computeProgress(
      input({
        persons: [person("root"), M("f"), F("m"), M("mf"), F("mm"), M("x")],
        parents: { root: ["f", "m"], m: ["mf", "mm"], mf: ["x"] },
        hidden: ["mf"],
        generations: 4,
      }),
    );
    const g = (n: number) => r.byGeneration[n - 1];
    expect([g(2).found, g(2).restricted, g(2).missing]).toEqual([1, 1, 2]);
    // Hinter dem gesperrten Großvater: 2 bzw. 4 Plätze „nicht freigegeben“, x wird nicht gezählt.
    expect([g(3).found, g(3).restricted, g(3).missing]).toEqual([0, 2, 6]);
    expect([g(4).restricted, g(4).missing]).toEqual([4, 12]);
    expect(r.total.restricted).toBe(7);
    const json = JSON.stringify(r);
    expect(json).not.toContain('"mf"');
    expect(json).not.toContain("Person x");
    expect(json).not.toContain("Person mf");
    // Linie MV: Großvater nicht freigegeben.
    const mv = r.lines.find((l) => l.line === "MF")!;
    expect(mv.grandparent).toEqual({ kind: "restricted" });
    expect(mv.restricted).toBe(1 + 2 + 4);
    expect(mv.found).toBe(0);
    // Ein gesperrter Elternteil gilt als erfasst — „Eltern fehlen“ nur für den sichtbaren Teil.
    expect(r.suggestions.some((s) => s.personId === "m" && s.kind === "missingParents")).toBe(false);
  });

  it("Linien: Plätze ab den Großeltern, je Linie 2^(n−1)−1", () => {
    const r = computeProgress(
      input({
        persons: [person("root"), M("f"), F("m"), M("ff"), F("fm"), M("mf"), F("mm"), M("fff")],
        parents: { root: ["f", "m"], f: ["ff", "fm"], m: ["mf", "mm"], ff: ["fff"] },
        generations: 4,
      }),
    );
    expect(r.lines.map((l) => [l.line, l.places, l.found])).toEqual([
      ["FF", 7, 2],
      ["FM", 7, 1],
      ["MF", 7, 1],
      ["MM", 7, 1],
    ]);
    expect(r.lines[0].grandparent).toEqual({ kind: "person", id: "ff", name: "Person ff" });
  });
});

describe("Qualitätspunkte", () => {
  const ctx = { parentCount: 2, bornBy: Infinity, now: NOW, birthEvidence: "none" as Evidence, deathEvidence: "none" as Evidence };

  it("Geburtsdatum genau 2, ungenau 1, fehlt 0; Lebende ohne Sterbepunkte (höchstens 5)", () => {
    const exact = personQuality(person("a", { birth: day(1990), birthPlace: "Musterdorf" }), ctx);
    expect(exact.mortal).toBe(false);
    expect(exact.max).toBe(5);
    expect(exact.points).toBe(4);
    expect(exact.complete).toBe(true);
    expect(exact.sourced).toBe(false);
    expect(personQuality(person("a", { birth: year(1990) }), ctx).checks.find((c) => c.key === "birthDate")!.points).toBe(1);
    expect(personQuality(person("a", { birthPhrase: true }), ctx).checks.find((c) => c.key === "birthDate")!.points).toBe(1);
    expect(personQuality(person("a"), ctx).checks.find((c) => c.key === "birthDate")!.points).toBe(0);
  });

  it("Verstorbene: Sterbedatum, Sterbeort, Tod belegt (höchstens 8)", () => {
    const q = personQuality(
      person("a", { birth: day(1850), birthPlace: "Musterdorf", death: year(1910), deathPlace: "Beispielstadt" }),
      { ...ctx, birthEvidence: "independent", deathEvidence: "independent" },
    );
    expect(q.mortal).toBe(true);
    expect(q.max).toBe(8);
    expect(q.points).toBe(8);
    expect(q.complete && q.sourced).toBe(true);
  });

  it("fremder Stammbaum ist kein Beleg", () => {
    const q = personQuality(person("a", { birth: day(1990) }), { ...ctx, birthEvidence: "hintOnly" });
    expect(q.checks.find((c) => c.key === "birthEvidence")!.points).toBe(0);
    expect(q.sourced).toBe(false);
  });

  it("vermutlich verstorben: über 100 Jahre laut eigener Geburt oder der eines Kindes", () => {
    expect(personQuality(person("a", { birth: year(1900) }), ctx).presumedDead).toBe(true);
    expect(personQuality(person("a", { birth: year(1950) }), ctx).presumedDead).toBe(false);
    // Ohne eigenes Datum: Kind 1880 geboren.
    expect(personQuality(person("a"), { ...ctx, bornBy: Date.UTC(1881, 0, 1) }).presumedDead).toBe(true);
    // „nach 1900“ ist nach hinten offen — nie vermutlich verstorben.
    const after: FuzzyDate = { ...year(1900), qualifier: "AFTER" };
    expect(personQuality(person("a", { birth: after }), ctx).presumedDead).toBe(false);
    // Ein Sterbeort genügt für „verstorben“.
    expect(personQuality(person("a", { deathPlace: "Musterdorf" }), ctx).mortal).toBe(true);
  });

  it("beide Eltern erfasst", () => {
    expect(personQuality(person("a"), { ...ctx, parentCount: 1 }).checks.find((c) => c.key === "parents")!.points).toBe(0);
  });
});

describe("Vorschläge", () => {
  it("Lebende bekommen keine Vorschläge zu Sterbedaten; vermutlich Verstorbene schon", () => {
    const r = computeProgress(
      input({
        persons: [
          person("root", { birth: day(1995), birthPlace: "Musterdorf" }),
          M("f", { birth: day(1960), birthPlace: "Musterdorf" }),
          F("m", { birth: year(1890) }),
        ],
        parents: { root: ["f", "m"] },
      }),
    );
    const kinds = (id: string) => r.suggestions.filter((s) => s.personId === id).map((s) => s.kind);
    expect(kinds("f")).not.toContain("missingDeathDate");
    expect(kinds("root")).not.toContain("missingDeathDate");
    expect(kinds("m")).toContain("missingDeathDate");
    const death = r.suggestions.find((s) => s.personId === "m" && s.kind === "missingDeathDate")!;
    expect(death.title).toBe("Sterbedatum von Person m fehlt");
    expect(death.detail).toContain("geboren 1890");
  });

  it("nur fremder Stammbaum: eigener Hinweis „nur ein Hinweis, kein Beleg“", () => {
    const r = computeProgress(
      input({
        persons: [person("root", { birth: day(1990), birthPlace: "Musterdorf" }), M("f"), F("m")],
        parents: { root: ["f", "m"] },
        evidence: { "root|BIRTH": "hintOnly" },
      }),
    );
    const s = r.suggestions.find((x) => x.kind === "birthHintOnly")!;
    expect(s.personId).toBe("root");
    expect(s.title).toBe("Geburt von Person root ist nur durch einen fremden Stammbaum belegt");
    expect(s.detail).toContain("kein Beleg");
    expect(r.suggestions.some((x) => x.personId === "root" && x.kind === "birthUnsourced")).toBe(false);
  });

  it("fehlende Eltern: welcher Elternteil, Linie und abgeschnittene Plätze", () => {
    const r = computeProgress(
      input({
        persons: [person("root"), M("f", { birth: year(1950), birthPlace: "Musterdorf" }), F("m"), M("ff")],
        parents: { root: ["f", "m"], f: ["ff"] },
        generations: 6,
      }),
    );
    const f = r.suggestions.find((s) => s.personId === "f" && s.kind === "missingParents")!;
    expect(f.title).toBe("Mutter von Person f fehlt");
    expect(f.cutOff).toBe(2 ** 5 - 1);
    expect(f.detail).toBe("* 1950 in Musterdorf · nächste Lücke auf der väterlichen Seite — dahinter fehlen 31 Plätze bis zur 6. Generation");
    const m = r.suggestions.find((s) => s.personId === "m" && s.kind === "missingParents")!;
    expect(m.title).toBe("Eltern von Person m fehlen");
    expect(m.cutOff).toBe(62);
    const ff = r.suggestions.find((s) => s.personId === "ff" && s.kind === "missingParents")!;
    expect(ff.detail).toContain("in der Linie VV (Großvater väterlicherseits)");
  });

  it("gesperrter Elternteil verrät sein Geschlecht nicht", () => {
    const r = computeProgress(
      input({
        persons: [person("root"), F("m")],
        parents: { root: ["m"] },
        hidden: ["m"],
      }),
    );
    expect(r.suggestions.find((s) => s.personId === "root" && s.kind === "missingParents")!.title).toBe(
      "Ein Elternteil von Person root fehlt",
    );
  });

  it("Reihenfolge: Generation, dann Art, dann abgeschnittene Plätze, dann Aussicht, dann Name", () => {
    const base: Suggestion = {
      kind: "missingBirthPlace",
      personId: "x",
      name: "B",
      generation: 2,
      title: "",
      detail: "",
      prospect: 0,
      cutOff: 0,
    };
    const list: Suggestion[] = [
      { ...base, personId: "1", generation: 3, kind: "missingParents", cutOff: 7 },
      { ...base, personId: "2", kind: "birthUnsourced" },
      { ...base, personId: "3", kind: "missingDeathDate" },
      { ...base, personId: "4", kind: "missingParents", cutOff: 7 },
      { ...base, personId: "5", kind: "missingParents", cutOff: 15 },
      { ...base, personId: "6", kind: "missingDeathDate", prospect: 2 },
      { ...base, personId: "7", kind: "missingDeathDate", name: "A" },
    ];
    expect([...list].sort(compareSuggestions).map((s) => s.personId)).toEqual(["5", "4", "6", "7", "3", "2", "1"]);
  });

  it("computeProgress sortiert so: nähere Generation zuerst, fehlende Eltern vor Daten", () => {
    const r = computeProgress(
      input({
        persons: [person("root", { birth: day(1990), birthPlace: "Musterdorf" }), M("f"), F("m")],
        parents: { root: ["f", "m"] },
      }),
    );
    expect(r.suggestions[0]).toMatchObject({ personId: "root", kind: "birthUnsourced" });
    const gen1 = r.suggestions.filter((s) => s.generation === 1);
    expect(gen1[0].kind).toBe("missingParents");
    for (let i = 1; i < r.suggestions.length; i++) {
      expect(compareSuggestions(r.suggestions[i - 1], r.suggestions[i])).toBeLessThanOrEqual(0);
    }
  });
});
