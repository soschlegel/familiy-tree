/**
 * Dublettenerkennung (lib/duplicates.ts) — ohne Datenbank, erfundene Namen.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate } from "@/lib/dates";
import { findDuplicatePairs, scoreDuplicate, type DupPerson } from "@/lib/duplicates";

const d = (iso: string, precision: "DAY" | "MONTH" | "YEAR" = "DAY", qualifier = "EXACT") => toFuzzyDate(iso, precision, qualifier)!;

let n = 0;
function p(x: Partial<DupPerson>): DupPerson {
  return {
    id: `p${String(++n).padStart(5, "0")}`,
    givenName: "Anna",
    familyName: "Kelvaro",
    birthName: null,
    gender: "FEMALE",
    birth: null,
    death: null,
    birthPlace: null,
    variants: [],
    parents: [],
    partners: [],
    children: [],
    parentNames: [],
    partnerNames: [],
    trees: [],
    ...x,
  };
}

describe("scoreDuplicate", () => {
  it("Ehename/Geburtsname mit gleichen genauen Daten: sicher, aus verschiedenen Bäumen", () => {
    const a = p({ familyName: "Wendtner", birthName: "Kelvaro", birth: d("1801-04-02"), death: d("1870-01-05"), trees: ["A"] });
    const b = p({ familyName: "Kelvaro", birth: d("1801-04-02"), death: d("1870-01-05"), trees: ["B"] });
    const s = scoreDuplicate(a, b)!;
    expect(s.confidence).toBe("high");
    expect(s.crossTree).toBe(true);
    expect(s.reasons.join(" ")).toContain("Geburtsname");
    expect(s.reasons).toContain("aus verschiedenen Importen");
  });

  it("Name über eine Namensvariante", () => {
    const a = p({ familyName: "Wendtner", variants: [{ givenName: "Anna", familyName: "Kelvaro" }], birth: d("1801-04-02") });
    const b = p({ familyName: "Kelvaro", birth: d("1801-04-02") });
    expect(scoreDuplicate(a, b)!.reasons.join(" ")).toContain("Namensvariante");
  });

  it("ungenau und genau vereinbar: Kandidat, aber nicht sicher", () => {
    const s = scoreDuplicate(p({ birth: d("1760-01-01", "YEAR", "ABOUT") }), p({ birth: d("1760-03-12") }))!;
    expect(s.reasons.join(" ")).toContain("passt zu");
    expect(s.confidence).not.toBe("high");
  });

  it("Vater und Sohn gleichen Namens (verbunden): nie", () => {
    const father = p({ givenName: "Johann", gender: "MALE", birth: d("1800-01-01", "YEAR") });
    const son = p({ givenName: "Johann", gender: "MALE", birth: d("1801-01-01", "YEAR"), parents: [father.id] });
    father.children = [son.id];
    expect(scoreDuplicate(father, son)).toBeNull();
  });

  it("gleichnamige Geschwister (Name nach frühem Tod neu vergeben): kein Kandidat", () => {
    const first = p({ givenName: "Maria", birth: d("1830-02-01"), death: d("1830-05-01"), parents: ["vater", "mutter"] });
    const second = p({ givenName: "Maria", birth: d("1834-07-01"), parents: ["vater", "mutter"] });
    expect(scoreDuplicate(first, second)).toBeNull();
  });

  it("Zwillinge: verschiedene Vornamen → kein Kandidat; gleicher Name mit verschiedenem Tod → Widerspruch, unklar", () => {
    expect(scoreDuplicate(p({ givenName: "Paul", gender: "MALE", birth: d("1900-01-01") }), p({ givenName: "Peter", gender: "MALE", birth: d("1900-01-01") }))).toBeNull();
    const s = scoreDuplicate(
      p({ givenName: "Paul", gender: "MALE", birth: d("1900-01-01"), death: d("1901-01-01") }),
      p({ givenName: "Paul", gender: "MALE", birth: d("1900-01-01"), death: d("1980-01-01") }),
    )!;
    expect(s.conflicts.length).toBeGreaterThan(0);
    expect(s.confidence).toBe("low");
  });

  it("Dublette innerhalb eines Baums: dieselben eingetragenen Eltern, kein Tod → sicher", () => {
    const s = scoreDuplicate(
      p({ familyName: "Wendtner", birthName: "Kelvaro", birth: d("1801-04-02"), parents: ["karl"] }),
      p({ birth: d("1801-04-02"), parents: ["karl"] }),
    )!;
    expect(s.confidence).toBe("high");
  });

  it("verschiedene Elternpaare: Widerspruch, nie sicher", () => {
    const s = scoreDuplicate(
      p({ birth: d("1801-04-02"), death: d("1870-01-05"), parentNames: ["karl kelvaro", "liese kelvaro"] }),
      p({ birth: d("1801-04-02"), death: d("1870-01-05"), parentNames: ["oto mustermann", "olga mustermann"] }),
    )!;
    expect(s.conflicts).toContain("verschiedene Eltern");
    expect(s.confidence).not.toBe("high");
  });

  it("ohne Tod und ohne Verwandte: höchstens wahrscheinlich", () => {
    expect(scoreDuplicate(p({ birth: d("1801-04-02") }), p({ birth: d("1801-04-02") }))!.confidence).toBe("medium");
  });

  it("verschiedenes Geschlecht, ganz anderer Nachname: kein Kandidat", () => {
    expect(scoreDuplicate(p({ gender: "MALE" }), p({ gender: "FEMALE" }))).toBeNull();
    expect(scoreDuplicate(p({ familyName: "Kelvaro" }), p({ familyName: "Zubitan" }))).toBeNull();
  });
});

describe("findDuplicatePairs", () => {
  it("bleibt schnell bei einigen tausend Personen (Blöcke nach Vornamen)", () => {
    const given = ["Johann", "Anna", "Maria", "Georg", "Elisabeth", "Heinrich", "Katharina", "Peter", "Margarete", "Friedrich"];
    const family = ["Kelvaro", "Wendtner", "Zubitan", "Mortes", "Lavinsk", "Pemura", "Toskal", "Rivane", "Bolden", "Sartek"];
    const people: DupPerson[] = [];
    for (let i = 0; i < 4000; i++) {
      people.push(
        p({
          givenName: given[i % given.length],
          familyName: family[Math.floor(i / given.length) % family.length],
          gender: i % 2 ? "MALE" : "FEMALE",
          birth: d(`${1700 + (i % 250)}-0${1 + (i % 9)}-1${i % 10}`),
        }),
      );
    }
    const t0 = performance.now();
    findDuplicatePairs(people);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("sortiert sicher zuerst; filtert über include", () => {
    const a = p({ birth: d("1801-04-02"), death: d("1870-01-05") });
    const b = p({ birth: d("1801-04-02"), death: d("1870-01-05") });
    const c = p({ birth: d("1802-01-01", "YEAR") });
    const pairs = findDuplicatePairs([c, a, b]);
    expect(pairs[0]).toMatchObject({ confidence: "high", a: a.id, b: b.id });
    expect(findDuplicatePairs([a, b], { include: () => false })).toEqual([]);
  });
});
