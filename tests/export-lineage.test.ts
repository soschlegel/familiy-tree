/**
 * Auswahl „Ab einer Person“ des GEDCOM-Exports (lib/export-lineage.ts) —
 * reine Logik ohne Datenbank: Vorfahren, je Kästchen, Kombinationen,
 * Halbgeschwister, Kreise, gesperrte Personen, Adoptiveltern, Generationen;
 * dazu Parameter und Dateiname (lib/export-selection.ts).
 */
import { describe, expect, it } from "vitest";

import { collectLineage, DEFAULT_LINEAGE_OPTIONS, type LineageEdge, type LineageOptions } from "@/lib/export-lineage";
import { parseLineageOptions, personSelectionParams, selectionFileSuffix } from "@/lib/export-selection";

/*
 * Erfundene Familie (Kennungen statt Namen):
 *
 *   uu (Urgroßvater)
 *   └─ gv ═ gm (Großeltern)          gm hat einen Bruder: onkelG
 *      ├─ vater ═ mutter (Eltern)    vater früher verheiratet mit exfrau
 *      │  ├─ ich ═ partnerin
 *      │  │  └─ kind ═ schwiegerkind
 *      │  │     └─ enkel
 *      │  ├─ bruder ═ schwaegerin
 *      │  │  └─ neffe
 *      │  │     └─ grossneffe
 *      │  └─ halbschwester (nur vater, mit exfrau)
 *      └─ tante
 *   stiefvater ═ mutter (später), stiefvater ist STEP-Elternteil von ich;
 *   adoptivmutter ist ADOPTIVE-Elternteil von ich, ihre Mutter: adoptivoma.
 */
const P = (from: string, to: string, subtype = "BIOLOGICAL"): LineageEdge => ({ type: "PARENT_OF", subtype, from, to });
const M = (a: string, b: string, subtype = "MARRIED"): LineageEdge => ({ type: "PARTNER_OF", subtype, from: a, to: b });

const EDGES: LineageEdge[] = [
  P("uu", "gv"),
  P("gv", "vater"),
  P("gm", "vater"),
  P("gv", "tante"),
  P("gm", "tante"),
  P("ugm", "gm"),
  P("ugm", "onkelG"),
  M("gv", "gm"),
  M("vater", "mutter"),
  M("vater", "exfrau", "DIVORCED"),
  P("vater", "ich"),
  P("mutter", "ich"),
  P("vater", "bruder"),
  P("mutter", "bruder"),
  P("vater", "halbschwester"),
  P("exfrau", "halbschwester"),
  M("ich", "partnerin"),
  P("ich", "kind"),
  P("partnerin", "kind"),
  M("kind", "schwiegerkind", "UNMARRIED"),
  P("kind", "enkel"),
  M("bruder", "schwaegerin"),
  P("bruder", "neffe"),
  P("neffe", "grossneffe"),
  M("stiefvater", "mutter"),
  P("stiefvater", "ich", "STEP"),
  P("adoptivmutter", "ich", "ADOPTIVE"),
  P("adoptivoma", "adoptivmutter"),
];

const ALL = new Set(EDGES.flatMap((e) => [e.from, e.to]));

const run = (opts: Partial<LineageOptions> = {}, visible: ReadonlySet<string> = ALL, edges = EDGES, start = "ich") =>
  collectLineage(visible, edges, start, { ...DEFAULT_LINEAGE_OPTIONS, ...opts });

const sorted = (s: Set<string>) => [...s].sort();
const ANCESTORS = ["gm", "gv", "ich", "mutter", "ugm", "uu", "vater"];

describe("collectLineage", () => {
  it("nur Vorfahren: Person und leibliche Vorfahren, ohne Tiefengrenze — sonst niemand", () => {
    const r = run();
    expect(sorted(r.ids)).toEqual(ANCESTORS);
    expect(r.counts).toMatchObject({ person: 1, ancestors: 6, partners: 0, siblings: 0, siblingFamilies: 0, descendants: 0, total: 7 });
  });

  it("Partner: Ehe- und Lebenspartner der Person und der Vorfahren, auch frühere — nicht die der Geschwister", () => {
    const r = run({ partners: true });
    expect(sorted(r.ids)).toEqual([...ANCESTORS, "exfrau", "partnerin", "stiefvater"].sort());
    // gv ═ gm und vater ═ mutter sind schon als Vorfahren dabei.
    expect(r.counts.partners).toBe(3);
    expect(r.ids.has("schwaegerin")).toBe(false);
    expect(r.ids.has("schwiegerkind")).toBe(false);
  });

  it("Geschwister: der Person und aller Vorfahren, Halbgeschwister eingeschlossen", () => {
    const r = run({ siblings: true });
    expect(sorted(r.ids)).toEqual([...ANCESTORS, "bruder", "halbschwester", "tante", "onkelG"].sort());
    expect(r.counts.siblings).toBe(4);
    // ohne „Partner und Kinder der Geschwister“ keine Neffen und Schwägerinnen
    expect(r.ids.has("neffe")).toBe(false);
    expect(r.ids.has("schwaegerin")).toBe(false);
  });

  it("Partner und Kinder der Geschwister: eine Stufe, und nur zusammen mit „Geschwister“", () => {
    expect(sorted(run({ siblingFamilies: true }).ids)).toEqual(ANCESTORS);
    const r = run({ siblings: true, siblingFamilies: true });
    expect(r.ids.has("schwaegerin")).toBe(true);
    expect(r.ids.has("neffe")).toBe(true);
    expect(r.ids.has("grossneffe")).toBe(false);
    // Die Mutter der Halbschwester kommt über deren Familie nicht hinzu (sie ist keine Partnerin der Halbschwester).
    expect(r.ids.has("exfrau")).toBe(false);
    expect(r.counts.siblingFamilies).toBe(2);
  });

  it("Nachkommen: Kinder, Enkel usw.; deren Partner nur zusammen mit „Partner“", () => {
    const d = run({ descendants: true });
    expect(d.ids.has("kind")).toBe(true);
    expect(d.ids.has("enkel")).toBe(true);
    expect(d.ids.has("schwiegerkind")).toBe(false);
    expect(d.counts.descendants).toBe(2);
    const dp = run({ descendants: true, partners: true });
    expect(dp.ids.has("schwiegerkind")).toBe(true);
    expect(dp.ids.has("partnerin")).toBe(true);
  });

  it("Adoptiv-, Stief- und Pflegeeltern: nur mit dem Schalter, dann samt ihren Vorfahren", () => {
    const plain = run();
    expect(plain.ids.has("stiefvater")).toBe(false);
    expect(plain.ids.has("adoptivmutter")).toBe(false);
    const r = run({ allParents: true });
    expect(r.ids.has("stiefvater")).toBe(true);
    expect(r.ids.has("adoptivmutter")).toBe(true);
    expect(r.ids.has("adoptivoma")).toBe(true);
    expect(r.counts.ancestors).toBe(9);
  });

  it("alle Kästchen: jede Person zählt einmal, die Gruppen ergeben die Summe", () => {
    const r = run({ partners: true, siblings: true, siblingFamilies: true, descendants: true, allParents: true });
    const { total, ...groups } = r.counts;
    expect(Object.values(groups).reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(r.ids.size);
    expect(r.ids.has("grossneffe")).toBe(false);
  });

  it("Generationen hinauf begrenzt die Vorfahren (1 = Eltern)", () => {
    expect(sorted(run({ generations: 1 }).ids)).toEqual(["ich", "mutter", "vater"]);
    expect(sorted(run({ generations: 2 }).ids)).toEqual(["gm", "gv", "ich", "mutter", "vater"]);
    // Geschwister der obersten Vorfahren brauchen deren (nicht exportierte) Eltern — sie fehlen.
    const s = run({ generations: 2, siblings: true });
    expect(s.ids.has("tante")).toBe(true);
    expect(s.ids.has("onkelG")).toBe(false);
  });

  it("Kreis in fehlerhaften Daten hängt nichts auf", () => {
    const cyclic = [P("a", "b"), P("b", "c"), P("c", "a"), P("a", "a"), M("b", "c")];
    const r = run({ partners: true, siblings: true, siblingFamilies: true, descendants: true }, new Set(["a", "b", "c"]), cyclic, "a");
    expect(sorted(r.ids)).toEqual(["a", "b", "c"]);
    expect(r.counts.total).toBe(3);
  });

  it("gesperrter Elternteil beendet die Linie — auch sichtbare Vorfahren dahinter fehlen und zählen nicht", () => {
    const visible = new Set([...ALL].filter((id) => id !== "gv"));
    const r = run({ partners: true, siblings: true }, visible);
    expect(r.ids.has("gv")).toBe(false);
    expect(r.ids.has("uu")).toBe(false); // nur über gv erreichbar
    expect(r.ids.has("gm")).toBe(true); // andere Linie läuft weiter
    expect(r.ids.has("ugm")).toBe(true);
    expect(r.ids.has("tante")).toBe(true); // über gm
  });

  it("gesperrte Partner und Geschwister fehlen", () => {
    const visible = new Set([...ALL].filter((id) => id !== "exfrau" && id !== "bruder"));
    const r = run({ partners: true, siblings: true, siblingFamilies: true }, visible);
    expect(r.ids.has("exfrau")).toBe(false);
    expect(r.ids.has("bruder")).toBe(false);
    // Familie des gesperrten Bruders wird nicht über ihn erreicht.
    expect(r.ids.has("schwaegerin")).toBe(false);
    expect(r.ids.has("neffe")).toBe(false);
    expect(r.ids.has("halbschwester")).toBe(true);
  });

  it("gesperrte oder unbekannte Ausgangsperson: leer", () => {
    expect(run({}, new Set([...ALL].filter((id) => id !== "ich"))).ids.size).toBe(0);
    expect(run({}, ALL, EDGES, "gibt-es-nicht").counts.total).toBe(0);
  });
});

describe("Parameter und Dateiname", () => {
  it("Schalter ↔ Suchparameter; „Partner und Kinder der Geschwister“ nur mit „Geschwister“", () => {
    const opts = { ...DEFAULT_LINEAGE_OPTIONS, partners: true, siblings: true, siblingFamilies: true, generations: 3 };
    const q = personSelectionParams("p1", opts);
    expect(q).toBe("person=p1&partners=1&siblings=1&siblingFamilies=1&generations=3");
    expect(parseLineageOptions(new URLSearchParams(q))).toEqual(opts);
    expect(personSelectionParams("p1", { ...DEFAULT_LINEAGE_OPTIONS, siblingFamilies: true })).toBe("person=p1");
    expect(parseLineageOptions(new URLSearchParams("person=p1&siblingFamilies=1"))).toEqual(DEFAULT_LINEAGE_OPTIONS);
    expect(parseLineageOptions(new URLSearchParams("generations=0"))).toBe("invalid");
    expect(parseLineageOptions(new URLSearchParams("generations=abc"))).toBe("invalid");
    expect((parseLineageOptions(new URLSearchParams("generations=500")) as LineageOptions).generations).toBeNull();
  });

  it("Dateiname: nur die Anzahl, kein Personenname", () => {
    const counts = { person: 1, ancestors: 0, descendants: 0, siblings: 0, partners: 0, siblingFamilies: 0, total: 1 };
    const sel = (n: number) => ({ kind: "person" as const, personId: "p1", options: DEFAULT_LINEAGE_OPTIONS, personIds: Array.from({ length: n }, (_, i) => `x${i}`), counts });
    expect(selectionFileSuffix(sel(1))).toBe("_auswahl-ab-person-1-person");
    expect(selectionFileSuffix(sel(23))).toBe("_auswahl-ab-person-23-personen");
  });
});
