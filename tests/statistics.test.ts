/**
 * Seite „Statistik“ (lib/statistics.ts, lib/chart-slices.ts): Zählungen,
 * Namensregeln, ungenaue Daten, kleine Grundlagen und Sichtbarkeit. Rein,
 * ohne Datenbank; erfundene Personen.
 */
import { describe, expect, it } from "vitest";

import { groupAreaSlices } from "@/lib/chart-slices";
import { toFuzzyDate, type DatePrecision, type DateQualifier } from "@/lib/dates";
import type { PlaceArea } from "@/lib/places/area";
import {
  cleanName,
  computeStatistics,
  firstGivenName,
  MIN_BASIS,
  surnameForCount,
  usableAge,
  usableYear,
  type StatPerson,
  type StatRelationship,
} from "@/lib/statistics";

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

let n = 0;
function person(p: Partial<StatPerson> = {}): StatPerson {
  n += 1;
  return {
    id: p.id ?? `p${n}`,
    visible: true,
    givenName: "Anna",
    familyName: "Muster",
    birthName: null,
    gender: "FEMALE",
    birth: null,
    death: null,
    deathWithoutDate: false,
    place: null,
    ...p,
  };
}

const AREAS: Record<string, PlaceArea> = {
  Musterstadt: { kind: "area", key: "DE", label: "Deutschland", countryCode: "DE" },
  Beispielhausen: { kind: "area", key: "DE", label: "Deutschland", countryCode: "DE" },
  Exempelburg: { kind: "area", key: "AT", label: "Österreich", countryCode: "AT" },
  Irgendwo: { kind: "unassigned" },
};

function stats(persons: StatPerson[], relationships: StatRelationship[] = []) {
  return computeStatistics({ persons, relationships, now: NOW, level: "country", areaOf: (t) => AREAS[t] });
}

const parentOf = (from: string, to: string, subtype = "BIOLOGICAL"): StatRelationship => ({
  type: "PARENT_OF",
  subtype,
  from,
  to,
  start: null,
});
const married = (a: string, b: string, start: string | null, subtype = "MARRIED"): StatRelationship => ({
  type: "PARTNER_OF",
  subtype,
  from: a,
  to: b,
  start: start ? d(start) : null,
});

describe("Datumsregeln", () => {
  it("Jahr: genau, nur Jahr, „um“, kurzer Bereich zählen; „vor“, „nach“, weiter Bereich nicht", () => {
    expect(usableYear(d("1850-03-12"))).toBe(1850);
    expect(usableYear(d("1850"))).toBe(1850);
    expect(usableYear(d("1850", "ABOUT"))).toBe(1850);
    expect(usableYear(d("1850", "BETWEEN", "1854"))).toBe(1852);
    expect(usableYear(d("1850", "BEFORE"))).toBeNull();
    expect(usableYear(d("1850", "AFTER"))).toBeNull();
    expect(usableYear(d("1800", "BETWEEN", "1850"))).toBeNull();
    expect(usableYear(null)).toBeNull();
  });

  it("Alter: tagesgenau exakt, nur Jahre als Mitte, offene oder widersprüchliche Angaben nicht", () => {
    expect(usableAge(d("1850-03-12"), d("1920-03-12"))).toBe(70);
    expect(usableAge(d("1850-03-12"), d("1920-03-11"))).toBe(69);
    expect(usableAge(d("1850"), d("1920"))).toBe(70);
    expect(usableAge(d("1850", "ABOUT"), d("1920"))).toBe(70);
    expect(usableAge(d("1850-03"), d("1920-01-05"))).toBe(69);
    expect(usableAge(d("1850", "BEFORE"), d("1920"))).toBeNull();
    expect(usableAge(d("1850"), d("1920", "AFTER"))).toBeNull();
    // Tod vor Geburt, über 110 Jahre: Fehler in den Daten.
    expect(usableAge(d("1920-01-01"), d("1850-01-01"))).toBeNull();
    expect(usableAge(d("1700-01-01"), d("1830-01-01"))).toBeNull();
  });
});

describe("Namensregeln", () => {
  it("Geburtsname vor Ehename, Platzhalter zählen nicht", () => {
    expect(surnameForCount({ birthName: "Beispiel", familyName: "Muster" })).toBe("Beispiel");
    expect(surnameForCount({ birthName: null, familyName: " Muster " })).toBe("Muster");
    expect(surnameForCount({ birthName: "NN", familyName: "Muster" })).toBe("Muster");
    expect(surnameForCount({ birthName: null, familyName: "?" })).toBeNull();
    expect(cleanName("N.N.")).toBeNull();
    expect(cleanName("unbekannt")).toBeNull();
  });

  it("erster Vorname", () => {
    expect(firstGivenName("Johann Georg")).toBe("Johann");
    expect(firstGivenName("Anna-Maria Luise")).toBe("Anna-Maria");
    expect(firstGivenName("  ")).toBeNull();
    expect(firstGivenName("NN")).toBeNull();
  });

  it("Häufigste Nachnamen: ohne Groß-/Kleinschreibung, häufigste Schreibweise, absteigend", () => {
    const r = stats([
      person({ familyName: "Muster" }),
      person({ familyName: "muster" }),
      person({ familyName: "Muster" }),
      person({ familyName: "Muster", birthName: "Beispiel" }),
      person({ familyName: "Exempel" }),
      person({ familyName: null }),
    ]);
    expect(r.surnames.bars.map((b) => [b.label, b.count])).toEqual([
      ["Muster", 3],
      ["Beispiel", 1],
      ["Exempel", 1],
    ]);
    expect(r.surnames.withName).toBe(5);
    expect(r.surnames.distinct).toBe(3);
  });

  it("höchstens 15 Namen", () => {
    const r = stats(Array.from({ length: 20 }, (_, i) => person({ givenName: `Name${String.fromCharCode(65 + i)}` })));
    expect(r.givenNames.bars).toHaveLength(15);
    expect(r.givenNames.distinct).toBe(20);
  });
});

describe("Kennzahlen", () => {
  it("lebend, verstorben (auch vermutlich und ohne Datum), Geburtsjahre", () => {
    const r = stats([
      person({ birth: d("1990-05-01") }),
      person({ birth: d("1850"), death: d("1920") }),
      person({ birth: d("1900") }), // über 100, ohne Sterbeangabe
      person({ deathWithoutDate: true }),
      person({ birth: d("1700", "BEFORE") }), // Jahr unbrauchbar
    ]);
    expect(r.totals).toMatchObject({
      persons: 5,
      deceased: 4,
      presumedDeceased: 2,
      living: 1,
      earliestBirthYear: 1850,
      latestBirthYear: 1990,
      withBirthYear: 3,
    });
  });
});

describe("Sichtbarkeit", () => {
  it("nicht sichtbare Personen und ihre Beziehungen zählen nirgends", () => {
    const parent = person({ id: "eltern", birth: d("1850") });
    const kids = ["k1", "k2", "k3"].map((id) => person({ id, birth: d("1880") }));
    const hidden = person({ id: "versteckt", visible: false, familyName: "Geheim", place: "Exempelburg", birth: d("1700") });
    const r = stats(
      [parent, ...kids, hidden],
      [
        parentOf("eltern", "k1"),
        parentOf("eltern", "k2"),
        parentOf("eltern", "versteckt"),
        married("eltern", "versteckt", "1875"),
        parentOf("versteckt", "k3"),
      ],
    );
    expect(r.totals.persons).toBe(4);
    expect(r.totals.partnerships).toBe(0);
    expect(r.totals.parentChild).toBe(2);
    expect(r.totals.earliestBirthYear).toBe(1850);
    expect(r.children.parents).toBe(1);
    expect(r.children.distribution.find((b) => b.key === "2")?.count).toBe(1);
    expect(r.surnames.bars.map((b) => b.label)).not.toContain("Geheim");
    expect(r.birthPlaces.slices.map((s) => s.label)).not.toContain("Österreich");
    expect(r.marriageAge.basis).toBe(0);
    // Keine Kennungen im Ergebnis.
    expect(JSON.stringify(r)).not.toMatch(/eltern|versteckt|"k\d"/);
  });
});

describe("Auswertungen", () => {
  it("Geburtsorte: Gebiete, „Ort nicht zugeordnet“, „Unbekannt“, Summe 100", () => {
    const r = stats([
      person({ place: "Musterstadt" }),
      person({ place: "Beispielhausen" }),
      person({ place: "Exempelburg" }),
      person({ place: "Irgendwo" }),
      person({ place: "Nirgendwo" }), // ohne Zeile in der Ortstabelle
      person({ place: null }),
    ]);
    expect(r.birthPlaces.slices.map((s) => [s.label, s.value])).toEqual([
      ["Deutschland", 2],
      ["Österreich", 1],
      ["Ort nicht zugeordnet", 2],
      ["Unbekannt", 1],
    ]);
    expect(r.birthPlaces.slices.reduce((s, x) => s + x.percent, 0)).toBe(100);
    expect(r.birthPlaces).toMatchObject({ withPlace: 5, assigned: 3 });
  });

  it("Geschlecht: Reihenfolge, Unbekannt grau", () => {
    const r = stats([person({ gender: "MALE" }), person({ gender: "FEMALE" }), person({ gender: "UNKNOWN" })]);
    expect(r.gender.slices.map((s) => s.label)).toEqual(["Weiblich", "Männlich", "Unbekannt"]);
    expect(r.gender.slices.find((s) => s.key === "UNKNOWN")?.color).toBe("var(--chart-unknown)");
    expect(r.gender.known).toBe(2);
  });

  it("Geburten: Jahrzehnte lückenlos, bei langer Spanne Jahrhunderte", () => {
    const short = stats([person({ birth: d("1851") }), person({ birth: d("1878") }), person({ birth: d("1879", "ABOUT") })]);
    expect(short.births.unit).toBe("decade");
    expect(short.births.bars.map((b) => [b.label, b.count])).toEqual([
      ["1850–1859", 1],
      ["1860–1869", 0],
      ["1870–1879", 2],
    ]);
    const long = stats([person({ birth: d("1620") }), person({ birth: d("1990") })]);
    expect(long.births.unit).toBe("century");
    expect(long.births.bars.map((b) => b.label)).toEqual(["1600–1699", "1700–1799", "1800–1899", "1900–1999"]);
  });

  it("Lebensalter: Durchschnitt erst ab 5 Personen, je Geburtsjahrhundert, Altersklassen", () => {
    const four = Array.from({ length: MIN_BASIS - 1 }, () => person({ birth: d("1850"), death: d("1910") }));
    const few = stats(four);
    expect(few.lifespan.basis).toBe(4);
    expect(few.lifespan.average).toBeNull();
    expect(few.lifespan.byCentury).toEqual([{ key: "1800", label: "1800–1899", count: 4, average: null }]);

    const five = stats([
      ...four,
      person({ birth: d("1860-01-01"), death: d("1940-01-01") }),
      person({ birth: d("1900"), death: d("1900", "AFTER") }), // unbrauchbar
    ]);
    expect(five.lifespan.basis).toBe(5);
    expect(five.lifespan.average).toBeCloseTo((60 * 4 + 80) / 5, 0);
    expect(five.lifespan.classes.find((c) => c.key === "60")?.count).toBe(4);
    expect(five.lifespan.classes.find((c) => c.key === "80")?.count).toBe(1);
    expect(five.lifespan.classes.at(-1)?.label).toBe("100 und älter");
  });

  it("Kinderzahl: nur leibliche und adoptierte, Doppelte einmal, Verteilung bis „10 und mehr“", () => {
    const big = person({ id: "gross", birth: d("1800") });
    const kids = Array.from({ length: 12 }, (_, i) => person({ id: `kind${i}` }));
    const r = stats(
      [big, ...kids],
      [
        ...kids.slice(0, 11).map((k) => parentOf("gross", k.id)),
        parentOf("gross", "kind0"), // doppelt
        parentOf("gross", "kind11", "STEP"),
        parentOf("kind0", "kind1", "ADOPTIVE"),
      ],
    );
    expect(r.children.parents).toBe(2);
    expect(r.children.distribution.find((b) => b.key === "10")).toMatchObject({ label: "10 und mehr", count: 1 });
    expect(r.children.distribution.find((b) => b.key === "1")?.count).toBe(1);
    expect(r.children.byCentury).toEqual([{ key: "1800", label: "1800–1899", count: 1, average: null }]);
  });

  it("Heiratsalter: erste Ehe je Person, nach Geschlecht", () => {
    const people = Array.from({ length: 5 }, (_, i) => [
      person({ id: `m${i}`, gender: "MALE", birth: d("1850-01-01") }),
      person({ id: `f${i}`, gender: "FEMALE", birth: d("1855-01-01") }),
    ]).flat();
    const rels = Array.from({ length: 5 }, (_, i) => married(`m${i}`, `f${i}`, "1880-01-01"));
    rels.push(married("m0", "f1", "1890-01-01", "DIVORCED")); // spätere Ehe zählt nicht
    rels.push(married("m1", "f2", null)); // ohne Datum
    const r = stats(people, rels);
    expect(r.marriageAge.basis).toBe(10);
    expect(r.marriageAge.byGender.map((g) => [g.label, Math.round(g.average!)])).toEqual([
      ["Männer", 30],
      ["Frauen", 25],
    ]);
    expect(r.marriageAge.classes.find((c) => c.key === "25")?.count).toBe(5);
    expect(r.marriageAge.classes.find((c) => c.key === "30")?.count).toBe(5);
  });

  it("Geburtsmonate nur bei genau bekanntem Monat", () => {
    const r = stats([
      person({ birth: d("1850-03-12") }),
      person({ birth: d("1851-03") }),
      person({ birth: d("1852") }),
      person({ birth: d("1853-04", "ABOUT") }),
    ]);
    expect(r.birthMonths.basis).toBe(2);
    expect(r.birthMonths.bars.find((b) => b.label === "März")?.count).toBe(2);
  });

  it("leere Eingabe: alles 0, keine Stücke", () => {
    const r = stats([]);
    expect(r.totals.persons).toBe(0);
    expect(r.birthPlaces.slices).toEqual([]);
    expect(r.births.bars).toEqual([]);
    expect(r.lifespan.average).toBeNull();
  });
});

describe("groupAreaSlices", () => {
  it("kleine Gebiete werden „Sonstige“, aber nie ein einzelnes", () => {
    const areas = new Map([
      ["DE", { label: "Deutschland", value: 90 }],
      ["AT", { label: "Österreich", value: 1 }],
      ["CH", { label: "Schweiz", value: 1 }],
    ]);
    const s = groupAreaSlices(areas, { unknown: 8 });
    expect(s.map((x) => x.label)).toEqual(["Deutschland", "Sonstige", "Unbekannt"]);
    expect(s[1].members).toEqual(["Österreich", "Schweiz"]);
    expect(s.reduce((a, x) => a + x.percent, 0)).toBe(100);

    const one = groupAreaSlices(new Map([...areas].slice(0, 2)), {});
    expect(one.map((x) => x.label)).toEqual(["Deutschland", "Österreich"]);
  });
});
