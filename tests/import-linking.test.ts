/**
 * „Importe verbinden“ (lib/import-linking.ts) gegen erfundene Wahrheit:
 * Genauigkeit (Precision) und Trefferquote (Recall) je Klasse, Fallen,
 * Laufzeit. „sicher“ muss fehlerfrei sein — ein falsches „sicher“ wiegt
 * schwerer als ein verpasstes Paar.
 */
import { describe, expect, it } from "vitest";

import { linkImports, type LinkPair, type LinkPerson } from "@/lib/import-linking";
import { generate } from "./fixtures/linking-generator";

function evaluate(pairs: LinkPair[], people: LinkPerson[], truthOf: Map<string, string>) {
  const groupOf = new Map(people.map((p) => [p.id, p.group]));
  // alle wahren Paare über Gruppengrenzen
  const byTruth = new Map<string, string[]>();
  for (const p of people) byTruth.set(truthOf.get(p.id)!, [...(byTruth.get(truthOf.get(p.id)!) ?? []), p.id]);
  let truePairs = 0;
  for (const list of byTruth.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (groupOf.get(list[i]) !== groupOf.get(list[j])) truePairs++;
  }
  const out: Record<string, { found: number; correct: number; precision: number; recall: number }> = {};
  for (const cls of ["high", "medium", "low"] as const) {
    const found = pairs.filter((p) => p.confidence === cls);
    const correct = found.filter((p) => truthOf.get(p.a) === truthOf.get(p.b)).length;
    out[cls] = { found: found.length, correct, precision: found.length ? correct / found.length : 1, recall: truePairs ? correct / truePairs : 0 };
  }
  const wrongSure = pairs.filter((p) => p.confidence === "high" && truthOf.get(p.a) !== truthOf.get(p.b));
  return { truePairs, classes: out, wrongSure };
}

describe("Importe verbinden — Genauigkeit", () => {
  for (const seed of [1, 7, 42]) {
    it(`drei Importe mit Fallen (Startwert ${seed}): „sicher“ ohne Fehler`, () => {
      const g = generate({ families: 12, generations: 5, imports: 3, seed });
      const people = g.imports.flat();
      const r = linkImports(people);
      const e = evaluate(r.pairs, people, g.truthOf);
      console.log(
        `[Importe verbinden] Startwert ${seed}: ${people.length} Einträge, ${e.truePairs} wahre Paare; ` +
          Object.entries(e.classes)
            .map(([k, v]) => `${k}: ${v.found} gefunden, Precision ${(v.precision * 100).toFixed(1)} %, Recall ${(v.recall * 100).toFixed(1)} %`)
            .join("; ") +
          `; Teile ${r.components.before} → ${r.components.afterSure}; ${r.durationMs} ms`,
      );
      expect(e.wrongSure.map((p) => `${p.a} ~ ${p.b}: ${p.reasons.join(", ")}`)).toEqual([]);
      // Falsche Einzelbrücke nie sicher
      const lone = r.pairs.find((p) => p.a.includes("LONE") && p.b.includes("LONE"));
      if (lone) expect(lone.confidence).not.toBe("high");
      // Zwillinge (Anna Maria / Anna Katharina) nie miteinander
      const twins = r.pairs.filter((p) => {
        const a = people.find((x) => x.id === p.a)!;
        const b = people.find((x) => x.id === p.b)!;
        return a.givenName.startsWith("Anna ") && b.givenName.startsWith("Anna ") && a.givenName !== b.givenName;
      });
      expect(twins.filter((p) => p.confidence !== "low")).toEqual([]);
      expect(e.classes.high.recall).toBeGreaterThan(0.2);
    });
  }

  it("Laufzeit: 2×3000 und 5×1500 Einträge", () => {
    for (const [imports, families] of [
      [2, 60],
      [5, 60],
    ] as const) {
      const g = generate({ families, generations: 6, imports, seed: 3, coverage: imports === 2 ? 0.8 : 0.45 });
      const people = g.imports.flat();
      const mem0 = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const r = linkImports(people);
      const ms = Math.round(performance.now() - t0);
      const mb = Math.round((process.memoryUsage().heapUsed - mem0) / 1e6);
      const e = evaluate(r.pairs, people, g.truthOf);
      console.log(
        `[Importe verbinden] ${imports} Importe, ${g.imports.map((x) => x.length).join("+")} Einträge: ${ms} ms, ~${mb} MB; ` +
          `sicher ${e.classes.high.found} (Precision ${(e.classes.high.precision * 100).toFixed(1)} %, Recall ${(e.classes.high.recall * 100).toFixed(1)} %), ` +
          `wahrscheinlich ${e.classes.medium.found} (Precision ${(e.classes.medium.precision * 100).toFixed(1)} %)`,
      );
      expect(e.wrongSure).toEqual([]);
      expect(ms).toBeLessThan(20000);
    }
  });

  it("Teilklasse „sehr wahrscheinlich“: fehlerfrei auf großen Testbäumen", () => {
    let n = 0;
    let ok = 0;
    let truePairs = 0;
    for (const [imports, families, seed, coverage] of [
      [2, 60, 3, 0.8],
      [5, 60, 3, 0.45],
      [3, 40, 11, 0.6],
      [4, 50, 23, 0.5],
      [2, 50, 99, 0.7],
    ] as const) {
      const g = generate({ families, generations: 6, imports, seed, coverage });
      const people = g.imports.flat();
      const r = linkImports(people);
      const t = r.pairs.filter((p) => p.veryLikely);
      n += t.length;
      ok += t.filter((p) => g.truthOf.get(p.a) === g.truthOf.get(p.b)).length;
      truePairs += evaluate(r.pairs, people, g.truthOf).truePairs;
    }
    console.log(`[Importe verbinden] sehr wahrscheinlich: ${n} Paare, Precision ${((ok / n) * 100).toFixed(2)} %, Recall ${((ok / truePairs) * 100).toFixed(1)} %`);
    expect(ok).toBe(n);
  }, 60_000);

  it("Runden: sichere Paare zusammenführen und neu abgleichen — in jeder Runde fehlerfrei", () => {
    for (const seed of [1, 7, 42]) {
      const g = generate({ families: 12, generations: 5, imports: 3, seed });
      let people = g.imports.flat();
      const truthOf = new Map(g.truthOf);
      const count = new Map<string, number>();
      for (const p of people) count.set(truthOf.get(p.id)!, (count.get(truthOf.get(p.id)!) ?? 0) + 1);
      const needed = [...count.values()].reduce((s, x) => s + x - 1, 0);
      let merged = 0;
      let rounds = 0;
      for (; rounds < 10; rounds++) {
        const r = linkImports(people);
        const sure = r.pairs.filter((p) => p.confidence === "high");
        expect(sure.filter((p) => truthOf.get(p.a) !== truthOf.get(p.b))).toEqual([]);
        if (!sure.length) break;
        const before = people.length;
        people = mergeSure(people, r.pairs, truthOf);
        merged += before - people.length;
      }
      console.log(`[Importe verbinden] Startwert ${seed}: ${rounds} Runden, sicher zusammengeführt ${merged}/${needed} (${((merged / needed) * 100).toFixed(1)} %)`);
    }
  });
});

/** Sichere Paare „zusammenführen“: Einträge vereinen, Verweise umhängen. */
function mergeSure(people: LinkPerson[], pairs: LinkPair[], truthOf: Map<string, string>) {
  const uf = new Map<string, string>();
  const find = (x: string): string => {
    let r = uf.get(x) ?? x;
    while ((uf.get(r) ?? r) !== r) r = uf.get(r)!;
    return r;
  };
  for (const p of pairs.filter((x) => x.confidence === "high")) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) uf.set(rb, ra);
  }
  const by = new Map<string, LinkPerson>();
  for (const p of people) {
    const root = find(p.id);
    const cur = by.get(root);
    const remap = (l: string[]) => [...new Set(l.map(find))];
    if (!cur) {
      by.set(root, { ...p, id: root, parents: remap(p.parents), partners: remap(p.partners), children: remap(p.children) });
      truthOf.set(root, truthOf.get(p.id)!);
    } else {
      cur.parents = [...new Set([...cur.parents, ...remap(p.parents)])];
      cur.partners = [...new Set([...cur.partners, ...remap(p.partners)])];
      cur.children = [...new Set([...cur.children, ...remap(p.children)])];
      cur.parentNames = [...new Set([...cur.parentNames, ...p.parentNames])];
      cur.partnerNames = [...new Set([...cur.partnerNames, ...p.partnerNames])];
      cur.trees = [...new Set([...cur.trees, ...p.trees])];
      cur.group = [...new Set([...cur.group.split("+"), ...p.group.split("+")])].sort().join("+");
      cur.birth ??= p.birth;
      cur.death ??= p.death;
      cur.birthName ??= p.birthName;
    }
  }
  for (const p of by.values()) if (p.trees.length) p.group = [...new Set(p.trees)].sort().join("+");
  return [...by.values()];
}


describe("Importe verbinden — Vorfahren und Nachkommen", () => {
  const person = (id: string, group: string, x: Partial<LinkPerson> = {}): LinkPerson => ({
    id,
    group,
    givenName: "Ortwin",
    familyName: "Quellmar",
    birthName: null,
    gender: "MALE",
    birth: null,
    death: null,
    birthPlace: "Nirgendhausen",
    variants: [],
    parents: [],
    partners: [],
    children: [],
    parentNames: [],
    partnerNames: [],
    trees: [],
    ...x,
  });
  const link = (parent: LinkPerson, child: LinkPerson) => {
    parent.children.push(child.id);
    child.parents.push(parent.id);
  };

  it("innerhalb eines Imports: Urgroßvater und gleichnamiger Urenkel sind kein Paar, ein Namensvetter schon", () => {
    const top = person("A:1", "A");
    const m1 = person("A:2", "A", { givenName: "Lambert" });
    const m2 = person("A:3", "A", { givenName: "Eckhard" });
    const bottom = person("A:4", "A");
    const stranger = person("A:5", "A");
    link(top, m1);
    link(m1, m2);
    link(m2, bottom);
    const res = linkImports([top, m1, m2, bottom, stranger], { withinGroup: true });
    const has = (x: string, y: string) => res.pairs.some((p) => [p.a, p.b].includes(x) && [p.a, p.b].includes(y));
    expect(has(top.id, bottom.id)).toBe(false);
    expect(has(top.id, stranger.id)).toBe(true);
  });

  it("über Importgrenzen: Kette über Personen eines anderen Imports zählt mit, auch in der Ausbreitung", () => {
    // Import A: Großvater; Import B: dessen gleichnamiger Enkel, verbunden über
    // einen Sohn aus A (z.B. nach einer früheren Zusammenführung).
    const grand = person("A:1", "A", { birth: { date: new Date("1800-01-01T00:00:00Z"), precision: "YEAR", qualifier: "EXACT" } });
    const son = person("A:2", "A", { givenName: "Lambert" });
    const grandson = person("B:1", "B", { birth: { date: new Date("1800-01-01T00:00:00Z"), precision: "YEAR", qualifier: "EXACT" } });
    link(grand, son);
    link(son, grandson);
    const all = [grand, son, grandson];
    expect(linkImports(all).pairs).toEqual([]);
    // Kontrolle: ohne die Kette (Sohn fehlt) wären sie ein Paar.
    const g2 = person("A:1", "A", { birth: grand.birth });
    const s2 = person("B:1", "B", { birth: grandson.birth });
    expect(linkImports([g2, s2]).pairs).toHaveLength(1);
  });

  it("Ausbreitung: verbundenes Paar schlägt Eltern×Eltern nicht vor, wenn einer Vorfahre des anderen ist", () => {
    // A:k ↔ B:k sicher (gleiche genaue Daten). Eltern: A:p und B:p, wobei B:p
    // laut Eintrag ein Enkel von A:p ist (Kette über A:x).
    const exact = (iso: string) => ({ date: new Date(`${iso}T00:00:00Z`), precision: "DAY" as const, qualifier: "EXACT" as const });
    const ak = person("A:k", "A", { givenName: "Bertold", birth: exact("1850-05-05"), death: exact("1900-01-01") });
    const bk = person("B:k", "B", { givenName: "Bertold", birth: exact("1850-05-05"), death: exact("1900-01-01") });
    const ap = person("A:p", "A", { givenName: "Hugo", birthPlace: null });
    const ax = person("A:x", "A", { givenName: "Zeno" });
    const bp = person("B:p", "B", { givenName: "Hugo", birthPlace: null });
    link(ap, ak);
    link(bp, bk);
    link(ap, ax);
    link(ax, bp);
    const res = linkImports([ak, bk, ap, ax, bp]);
    expect(res.pairs.some((p) => p.a === "A:k" && p.b === "B:k")).toBe(true);
    expect(res.pairs.some((p) => [p.a, p.b].includes("A:p") && [p.a, p.b].includes("B:p"))).toBe(false);
  });
});
