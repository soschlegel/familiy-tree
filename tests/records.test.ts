/**
 * Seite „Rekorde“ (lib/records.ts): Rangfolge mit Gleichstand, ungenaue
 * Daten, Datenfehler, lebend/verstorben, Partnerschaften, Kinder und
 * Nachkommen, Linien, Vornamen und Sichtbarkeit. Rein, ohne Datenbank;
 * erfundene Personen.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate, type DatePrecision, type DateQualifier } from "@/lib/dates";
import {
  computeRecords,
  isLiving,
  MAX_TIED,
  rankPlaces,
  recordYears,
  type RecordPerson,
  type RecordPlace,
  type RecordRelationship,
} from "@/lib/records";

const NOW = new Date(Date.UTC(2026, 10, 27));

/** Datum: "1850-03-12" (Tag), "1850-03" (Monat), "1850" (Jahr), optional mit Zusatz. */
function d(text: string, qualifier: DateQualifier = "EXACT", to?: string) {
  const parts = text.split("-");
  const precision: DatePrecision = parts.length === 3 ? "DAY" : parts.length === 2 ? "MONTH" : "YEAR";
  const iso = `${parts[0]}-${parts[1] ?? "01"}-${parts[2] ?? "01"}`;
  const toParts = to?.split("-");
  return toFuzzyDate(
    iso,
    precision,
    qualifier,
    to ? `${toParts![0]}-${toParts![1] ?? "01"}-${toParts![2] ?? "01"}` : null,
    to ? (toParts!.length === 3 ? "DAY" : toParts!.length === 2 ? "MONTH" : "YEAR") : null,
  );
}

function person(id: string, p: Partial<RecordPerson> = {}): RecordPerson {
  return {
    id,
    visible: true,
    name: `Person ${id}`,
    lifespan: "",
    givenName: "Anna",
    gender: "FEMALE",
    birth: null,
    death: null,
    deathWithoutDate: false,
    ...p,
  };
}

const parentOf = (from: string, to: string, subtype = "BIOLOGICAL"): RecordRelationship => ({
  type: "PARENT_OF",
  subtype,
  from,
  to,
  start: null,
  end: null,
});
const partner = (from: string, to: string, start: string | null, subtype = "MARRIED", end: string | null = null): RecordRelationship => ({
  type: "PARTNER_OF",
  subtype,
  from,
  to,
  start: start ? d(start) : null,
  end: end ? d(end) : null,
});

const run = (persons: RecordPerson[], relationships: RecordRelationship[] = []) =>
  computeRecords({ persons, relationships, now: NOW });

/** Kennungen je Platz: [[rank, [ids…]], …] (Personen aller Satzteile). */
const ids = (places: RecordPlace[]) =>
  places.map((p) => [p.rank, p.entries.map((e) => e.parts.flatMap((part) => part.persons.map((x) => x.id)))]);

describe("Datumsregeln", () => {
  it("tagesgenau vollendete Jahre, ungenau mit „etwa“, zu weit oder negativ nichts", () => {
    expect(recordYears(d("1900-05-10"), d("1990-05-09"))).toEqual({ value: 89, about: false });
    expect(recordYears(d("1900-05-10"), d("1990-05-10"))).toEqual({ value: 90, about: false });
    expect(recordYears(d("1900"), d("1990"))).toEqual({ value: 90, about: true });
    // „um“ auf einer Seite: Spanne 5 Jahre — gerade noch.
    expect(recordYears(d("1900", "ABOUT"), d("1990-01-01"))?.about).toBe(true);
    // „um“ auf beiden Seiten: Spanne 9 Jahre — zu ungenau für einen Rekord.
    expect(recordYears(d("1900", "ABOUT"), d("1990", "ABOUT"))).toBeNull();
    expect(recordYears(d("1900", "BEFORE"), d("1990"))).toBeNull();
    expect(recordYears(d("1990"), d("1900"))).toBeNull();
    expect(recordYears(d("2000-01-01"), NOW)).toEqual({ value: 26, about: false });
  });

  it("lebend: ohne Sterbeangabe und nicht über 100 Jahre", () => {
    expect(isLiving(person("a", { birth: d("1950") }), NOW)).toBe(true);
    expect(isLiving(person("a", { birth: d("1900") }), NOW)).toBe(false);
    expect(isLiving(person("a", { deathWithoutDate: true }), NOW)).toBe(false);
    expect(isLiving(person("a", { death: d("2000") }), NOW)).toBe(false);
  });
});

describe("Rangfolge", () => {
  const cand = (id: string, value: number, about = false) => ({
    value,
    order: id,
    entry: { value, valueText: String(value), about, parts: [{ persons: [{ id, name: id, lifespan: "" }] }] },
  });

  it("Gleichstand teilt den Platz, der nächste zählt die besseren mit; höchstens fünf Plätze", () => {
    const places = rankPlaces([cand("a", 90), cand("b", 95), cand("c", 95), cand("d", 80), cand("e", 70), cand("f", 60), cand("g", 50)], "desc");
    expect(places.map((p) => [p.rank, p.entries.map((e) => e.parts[0].persons[0].id)])).toEqual([
      [1, ["b", "c"]],
      [3, ["a"]],
      [4, ["d"]],
      [5, ["e"]],
    ]);
  });

  it("genaue vor ungenauen Werten; zu viele Gleiche als Anzahl", () => {
    const many = Array.from({ length: MAX_TIED + 3 }, (_, i) => cand(`p${i}`, 7, i === 0));
    const [first] = rankPlaces(many, "asc");
    expect(first.entries).toHaveLength(MAX_TIED);
    expect(first.more).toBe(3);
    expect(first.entries[0].about).toBe(false);
    expect(first.entries.at(-1)!.about).toBe(false);
  });
});

describe("Personen: Alter, jüngste, früheste", () => {
  it("höchstes Alter: Gleichstand, Datenfehler über 110 zählt nicht, ungenau mit „etwa“", () => {
    const r = run([
      person("a", { birth: d("1900-01-01"), death: d("1995-06-01") }),
      person("b", { birth: d("1901-03-01"), death: d("1996-04-01") }),
      person("c", { birth: d("1800"), death: d("1950") }), // 150 Jahre: Fehler
      person("d", { birth: d("1850"), death: d("1940") }), // etwa 90
      person("e", { birth: d("1850", "BEFORE"), death: d("1960") }), // offen
    ]);
    const card = r.cards.oldestDeceased;
    expect(ids(card.places)).toEqual([
      [1, [["a"], ["b"]]],
      [3, [["d"]]],
    ]);
    expect(card.places[0].entries[0].valueText).toBe("95 Jahre");
    expect(card.places[1].entries[0].valueText).toBe("etwa 90 Jahre");
    expect(card.basis).toBe(3);
  });

  it("ältestes lebendes Mitglied: ohne Sterbeangabe, nicht vermutlich verstorben", () => {
    const r = run([
      person("old", { birth: d("1930-02-01") }),
      person("presumed", { birth: d("1910-01-01") }), // über 100: vermutlich verstorben
      person("deadNoDate", { birth: d("1920-01-01"), deathWithoutDate: true }),
      person("young", { birth: d("2000-01-01") }),
    ]);
    expect(ids(r.cards.oldestLiving.places)).toEqual([
      [1, [["old"]]],
      [2, [["young"]]],
    ]);
    expect(r.cards.oldestLiving.places[0].entries[0].valueText).toBe("96 Jahre");
  });

  it("jüngste und früheste: Zukunft und „vor …“ zählen nicht", () => {
    const r = run([
      person("baby", { birth: d("2026-03-14") }),
      person("twin1", { birth: d("2025-07-01") }),
      person("twin2", { birth: d("2025-07-01") }),
      person("future", { birth: d("2030-01-01") }),
      person("old", { birth: d("1650") }),
      person("vague", { birth: d("1600", "BEFORE") }),
      person("about", { birth: d("1655", "ABOUT") }),
    ]);
    expect(ids(r.cards.youngest.places).slice(0, 2)).toEqual([
      [1, [["baby"]]],
      [2, [["twin1"], ["twin2"]]],
    ]);
    expect(r.cards.youngest.places[0].entries[0].valueText).toBe("* 14.03.2026");
    expect(ids(r.cards.earliest.places).slice(0, 2)).toEqual([
      [1, [["old"]]],
      [2, [["about"]]],
    ]);
    expect(r.cards.earliest.places[1].entries[0].valueText).toBe("etwa 1655");
  });
});

describe("Partnerschaften", () => {
  it("Dauer bis zum ersten Tod, bis heute oder bis zur Scheidung; Unklares zählt nicht", () => {
    const r = run(
      [
        person("m1", { gender: "MALE", birth: d("1920-01-01"), death: d("2000-01-01") }),
        person("w1", { birth: d("1922-01-01"), death: d("2010-01-01") }),
        person("m2", { gender: "MALE", birth: d("1950-01-01") }),
        person("w2", { birth: d("1952-01-01") }),
        person("m3", { gender: "MALE", birth: d("1930-01-01"), death: d("1990-01-01") }),
        person("w3", { birth: d("1932-01-01"), deathWithoutDate: true }),
        person("m4", { gender: "MALE", birth: d("1940-01-01") }),
        person("w4", { birth: d("1941-01-01") }),
        person("m5", { gender: "MALE", birth: d("1945-01-01") }),
        person("w5", { birth: d("1946-01-01") }),
      ],
      [
        partner("m1", "w1", "1945-06-01"), // bis 2000: 54 Jahre
        partner("m2", "w2", "1975-05-01"), // beide leben: 51 Jahre, besteht noch
        partner("m3", "w3", "1955-01-01"), // Tod der Frau ohne Datum: offen
        partner("m4", "w4", "1965-01-01", "DIVORCED"), // Scheidung ohne Datum: offen
        partner("m5", "w5", "1970-01-01", "DIVORCED", "1980-01-01"), // 10 Jahre
      ],
    );
    const card = r.cards.longestPartnership;
    expect(ids(card.places)).toEqual([
      [1, [["m1", "w1"]]],
      [2, [["m2", "w2"]]],
      [3, [["m5", "w5"]]],
    ]);
    expect(card.places[1].entries[0].note).toBe("besteht noch");
    expect(card.places[0].entries[0].note).toBeUndefined();
  });

  it("Altersunterschied und Brautpaare mit Plausibilität", () => {
    const r = run(
      [
        person("a", { gender: "MALE", birth: d("1900-01-01") }),
        person("b", { birth: d("1925-06-01") }),
        person("c", { gender: "MALE", birth: d("1950-01-01") }),
        person("e", { birth: d("1951-01-01") }),
        person("f", { gender: "MALE", birth: d("1960-01-01") }),
        person("g", { birth: d("1962-01-01") }),
      ],
      [
        partner("a", "b", "1945-01-01"), // 45 und 19
        partner("c", "e", "1970-01-01"), // 20 und 19
        partner("f", "g", "1970-01-01"), // 10 und 8: Datenfehler
      ],
    );
    expect(ids(r.cards.partnerAgeGap.places)[0]).toEqual([1, [["a", "b"]]]);
    expect(r.cards.partnerAgeGap.places[0].entries[0].valueText).toBe("25 Jahre");
    expect(ids(r.cards.youngestCouple.places)).toEqual([
      [1, [["c", "e"]]],
      [2, [["a", "b"]]],
    ]);
    expect(r.cards.youngestCouple.places[0].entries[0].valueText).toBe("39 Jahre zusammen");
    expect(r.cards.youngestCouple.places[0].entries[0].detail).toBe("20 und 19 Jahre");
    expect(ids(r.cards.oldestCouple.places)[0]).toEqual([1, [["a", "b"]]]);
  });
});

describe("Eltern, Kinder, Nachkommen, Linien", () => {
  it("jüngste/älteste Eltern nur leiblich und mit Grenzen", () => {
    const r = run(
      [
        person("mum", { birth: d("1900-01-01") }),
        person("dad", { gender: "MALE", birth: d("1880-01-01") }),
        person("k1", { birth: d("1920-01-01") }),
        person("k2", { birth: d("1945-01-01") }), // Mutter 45, Vater 65
        person("k3", { birth: d("1960-01-01") }), // Mutter 60: Fehler; Vater 80: Fehler
        person("adopt", { birth: d("1910-01-01") }), // adoptiert: zählt nicht
      ],
      [
        parentOf("mum", "k1"),
        parentOf("mum", "k2"),
        parentOf("dad", "k2"),
        parentOf("mum", "k3"),
        parentOf("dad", "k3"),
        parentOf("mum", "adopt", "ADOPTIVE"),
      ],
    );
    expect(ids(r.cards.youngestParent.places)[0]).toEqual([1, [["mum", "k1"]]]);
    expect(r.cards.youngestParent.places[0].entries[0].valueText).toBe("20 Jahre");
    expect(ids(r.cards.oldestParent.places)).toEqual([
      [1, [["dad", "k2"]]],
      [2, [["mum", "k2"]]],
    ]);
  });

  it("meiste Kinder: Paar mit denselben Kindern zusammen, adoptiert ja, Stief nein, nicht sichtbar nein", () => {
    const r = run(
      [
        person("p1"),
        person("p2", { gender: "MALE" }),
        person("p3", { gender: "MALE" }),
        person("c1"),
        person("c2"),
        person("c3"),
        person("hidden", { visible: false }),
      ],
      [
        parentOf("p1", "c1"),
        parentOf("p2", "c1"),
        parentOf("p1", "c2", "ADOPTIVE"),
        parentOf("p2", "c2", "ADOPTIVE"),
        parentOf("p3", "c3"),
        parentOf("p3", "c1", "STEP"),
        parentOf("p3", "hidden"),
      ],
    );
    expect(ids(r.cards.mostChildren.places)).toEqual([
      [1, [["p1", "p2"]]],
      [2, [["p3"]]],
    ]);
    expect(r.cards.mostChildren.places[0].entries[0].valueText).toBe("2 Kinder");
    expect(r.cards.mostChildren.places[1].entries[0].valueText).toBe("1 Kind");
    expect(ids(r.cards.largestSiblingGroup.places)).toEqual([[1, [["p1", "p2"]]]]);
    expect(JSON.stringify(r)).not.toContain("hidden");
  });

  it("Nachkommen und Linie laufen nur über sichtbare Personen", () => {
    // g → p → c → e (vier Generationen); x → hidden → y: y zählt für x nicht.
    const r = run(
      [
        person("g", { gender: "MALE" }),
        person("p"),
        person("c", { birth: d("1990") }),
        person("e", { birth: d("2015-01-01") }),
        person("e2", { birth: d("2018-01-01"), death: d("2020-01-01") }),
        person("x", { gender: "MALE" }),
        person("hidden", { visible: false }),
        person("y"),
        person("z"),
      ],
      [
        parentOf("g", "p"),
        parentOf("p", "c"),
        parentOf("c", "e"),
        parentOf("c", "e2"),
        parentOf("x", "hidden"),
        parentOf("hidden", "y"),
        parentOf("x", "z"),
      ],
    );
    const desc = r.cards.mostDescendants;
    expect(desc.places[0].entries[0].value).toBe(4);
    expect(ids(desc.places)[0]).toEqual([1, [["g"]]]);
    // x hat nur z als sichtbaren Nachkommen.
    const xEntry = desc.places.flatMap((p) => p.entries).find((e) => e.parts[0].persons[0].id === "x")!;
    expect(xEntry.value).toBe(1);

    const line = r.cards.longestLine;
    expect(line.places[0].entries[0].valueText).toBe("4 Generationen");
    // Endpunkt: der lebende Urenkel vor dem später geborenen, verstorbenen.
    expect(ids(line.places)[0]).toEqual([1, [["g", "e"]]]);
    expect(JSON.stringify(r)).not.toContain("hidden");
  });

  it("Stammeltern-Paar einer Linie steht zusammen; Kreise in den Daten brechen nichts", () => {
    const r = run(
      [person("a", { gender: "MALE" }), person("b"), person("k"), person("loop1"), person("loop2")],
      [parentOf("a", "k"), parentOf("b", "k"), parentOf("loop1", "loop2"), parentOf("loop2", "loop1")],
    );
    expect(ids(r.cards.longestLine.places)).toEqual([[1, [["a", "b", "k"]]]]);
  });
});

describe("Vornamen und Sichtbarkeit", () => {
  it("häufigster Vorname je Jahrhundert, getrennt, Gleichstand, mindestens zwei Träger", () => {
    const r = run([
      person("1", { givenName: "Maria Anna", birth: d("1850") }),
      person("2", { givenName: "maria", birth: d("1860") }),
      person("3", { givenName: "Anna", birth: d("1870") }),
      person("4", { givenName: "Anna", birth: d("1880") }),
      person("5", { givenName: "Johann", gender: "MALE", birth: d("1855") }),
      person("6", { givenName: "Karl", gender: "MALE", birth: d("1950") }),
      person("7", { givenName: "Karl", gender: "MALE", birth: d("1960") }),
      person("8", { givenName: "Petra", birth: d("1700", "BEFORE") }),
    ]);
    expect(r.givenNames.rows).toEqual([
      { key: "1800", label: "1800–1899", female: { names: ["Anna", "Maria"], count: 2 }, male: null },
      { key: "1900", label: "1900–1999", female: null, male: { names: ["Karl"], count: 2 } },
    ]);
    expect(r.givenNames.basis).toBe(7);
  });

  it("nicht sichtbare Personen, Partner und Kinder fließen nirgends ein", () => {
    const r = run(
      [
        person("v", { birth: d("1900-01-01"), death: d("1990-01-01") }),
        person("secret", { visible: false, birth: d("1800-01-01"), death: d("1905-01-01"), givenName: "Geheim" }),
        person("k", { birth: d("1930-01-01") }),
      ],
      [partner("v", "secret", "1920-01-01"), parentOf("secret", "k"), parentOf("v", "k")],
    );
    const json = JSON.stringify(r);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("Geheim");
    expect(r.persons).toBe(2);
    expect(r.cards.longestPartnership.places).toEqual([]);
    expect(r.cards.partnerAgeGap.places).toEqual([]);
    expect(r.cards.mostChildren.places[0].entries[0].parts[0].persons.map((p) => p.id)).toEqual(["v"]);
  });

  it("Familienfilter: nur die hereingereichten Personen zählen (Beziehungen nach außen fallen weg)", () => {
    const all = [person("a", { birth: d("1900-01-01"), death: d("1999-01-01") }), person("b"), person("c")];
    const rels = [parentOf("a", "b"), parentOf("a", "c")];
    const filtered = run(all.slice(0, 2), rels);
    expect(filtered.cards.mostChildren.places[0].entries[0].value).toBe(1);
    expect(run(all, rels).cards.mostChildren.places[0].entries[0].value).toBe(2);
  });
});

describe("Leistung", () => {
  it("12 000 Personen mit rund 40 000 Beziehungen in deutlich unter einer Sekunde", () => {
    const persons: RecordPerson[] = [];
    const rels: RecordRelationship[] = [];
    // Zehn Stämme à 1 200 Personen: Paare, je drei Kinder, über viele Generationen.
    for (let tree = 0; tree < 10; tree++) {
      const base = tree * 1200;
      for (let i = 0; i < 1200; i++) {
        const year = 1600 + Math.floor(i / 6) * 2;
        persons.push(
          person(`t${base + i}`, {
            gender: i % 2 ? "MALE" : "FEMALE",
            givenName: i % 3 ? "Anna" : "Karl",
            birth: d(`${year}-0${1 + (i % 9)}-1${i % 10}`),
            death: year < 1930 ? d(`${year + 40 + (i % 50)}-01-01`) : null,
          }),
        );
      }
      for (let i = 0; i + 1 < 1200; i += 2) {
        rels.push(partner(`t${base + i}`, `t${base + i + 1}`, `${1620 + Math.floor(i / 6) * 2}-05-01`));
        for (const k of [1, 2, 3]) {
          const child = i + 2 * k + 4;
          if (child < 1200) {
            rels.push(parentOf(`t${base + i}`, `t${base + child}`));
            rels.push(parentOf(`t${base + i + 1}`, `t${base + child}`));
          }
        }
      }
    }
    const started = performance.now();
    const r = computeRecords({ persons, relationships: rels, now: NOW });
    const ms = performance.now() - started;
    expect(r.persons).toBe(12_000);
    expect(r.cards.mostDescendants.places.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});
