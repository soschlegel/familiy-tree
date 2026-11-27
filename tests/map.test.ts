/**
 * Karte „Wurzeln nach Jahr“: Lebend- und Ortsregel (lib/map/build.ts), ein
 * Jahr auswerten (lib/map/year.ts), Projektion — und die Laufzeit bei rund
 * 12 000 erzeugten Personen.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate, type FuzzyDate } from "@/lib/dates";
import { PRESUMED_LIFESPAN } from "@/lib/consistency";
import { buildMapData, factYear, LINE_BIT, pickMarriages, type MapFactInput, type MapPersonInput, type MapPlace } from "@/lib/map/build";
import { fitViewBox, project, VIEWS, zoomAt } from "@/lib/map/projection";
import {
  ageInYear,
  aliveByYear,
  clampYear,
  eventsInYear,
  formatAge,
  groupLivedByPlace,
  livedInYear,
  parseYearInput,
  placeInYear,
  snapshot,
  sortLived,
} from "@/lib/map/year";
import { placeKey } from "@/lib/places/normalize";
import type { LineKey } from "@/lib/reference";

const d = (s: string, precision = "YEAR", qualifier = "EXACT", to?: string): FuzzyDate =>
  toFuzzyDate(new Date(`${s.length === 4 ? `${s}-01-01` : s}T00:00:00Z`), precision, qualifier, to ? new Date(`${to}-01-01T00:00:00Z`) : null, "YEAR")!;

const PLACES: Record<string, MapPlace> = {
  kiel: { label: "Kiel", lat: 54.3, lon: 10.1, precision: "PLACE" },
  hamburg: { label: "Hamburg", lat: 53.5, lon: 10, precision: "PLACE" },
  "new york": { label: "New York", lat: 40.7, lon: -74, precision: "PLACE" },
};
const coords = (key: string) => PLACES[key] ?? null;

function person(p: Partial<MapPersonInput> & { id: string }): MapPersonInput {
  return { name: p.id, birth: null, birthPlace: null, death: null, deathPlace: null, lines: [], ...p };
}

const build = (persons: MapPersonInput[], facts: MapFactInput[] = [], currentYear = 2025) =>
  buildMapData({ persons, facts, coords, currentYear });

describe("factYear (ungenaue Daten)", () => {
  it("nimmt das Jahr, bei „zwischen“ die Mitte", () => {
    expect(factYear(d("1850", "YEAR", "ABOUT"))).toBe(1850);
    expect(factYear(d("1850", "YEAR", "BEFORE"))).toBe(1850);
    expect(factYear(d("1850", "YEAR", "AFTER"))).toBe(1850);
    expect(factYear(d("1850", "YEAR", "BETWEEN", "1854"))).toBe(1852);
    expect(factYear(d("1850", "YEAR", "PERIOD", "1860"))).toBe(1850);
    expect(factYear(d("1850-03-12", "DAY"))).toBe(1850);
  });
});

describe("buildMapData: wer lebt wann", () => {
  it("lebt von Geburt bis Tod (beide Jahre eingeschlossen)", () => {
    const { persons } = build([person({ id: "a", birth: d("1850"), death: d("1900"), birthPlace: "Kiel" })]);
    const p = persons[0];
    expect([p.y0, p.y1, p.est]).toEqual([1850, 1900, undefined]);
    expect(placeInYear(p, 1849)).toBeUndefined();
    expect(placeInYear(p, 1850)).toBe(0);
    expect(placeInYear(p, 1900)).toBe(0);
    expect(placeInYear(p, 1901)).toBeUndefined();
  });

  it("ohne Tod: Beerdigung, sonst geschätzt (Höchstlebensdauer, nicht über heute)", () => {
    const burial = build([person({ id: "b", birth: d("1850") })], [{ personId: "b", date: d("1911"), place: "Kiel", burial: true }]);
    expect(burial.persons[0]).toMatchObject({ y1: 1911 });
    expect(burial.persons[0].est).toBeUndefined();
    const est = build([person({ id: "c", birth: d("1850") })]);
    expect(est.persons[0]).toMatchObject({ y1: 1850 + PRESUMED_LIFESPAN, est: 1 });
    const young = build([person({ id: "y", birth: d("1990") })], [], 2025);
    expect(young.persons[0].y1).toBe(2025);
    // Ein späteres datiertes Ereignis verlängert die Schätzung.
    const late = build([person({ id: "l", birth: d("1850") })], [{ personId: "l", date: d("1955"), place: "Kiel" }]);
    expect(late.persons[0].y1).toBe(1955);
  });

  it("ohne Geburt: frühestes datiertes Ereignis; ganz ohne Datum: nur gezählt", () => {
    const r = build(
      [person({ id: "t", birthPlace: "Kiel" }), person({ id: "u", birthPlace: "Kiel" })],
      [{ personId: "t", date: d("1870"), place: "Hamburg" }],
    );
    expect(r.persons.map((p) => p.id)).toEqual(["t"]);
    expect(r.persons[0].y0).toBe(1870);
    expect(r.undated).toBe(1);
  });

  it("„um 1850“ geboren zählt ab 1850", () => {
    const r = build([person({ id: "a", birth: d("1850", "YEAR", "ABOUT"), death: d("1900", "YEAR", "BEFORE") })]);
    expect([r.persons[0].y0, r.persons[0].y1]).toEqual([1850, 1900]);
    expect(r.persons[0].life).toBe("um 1850 – vor 1900");
  });
});

describe("buildMapData: wo", () => {
  it("zuletzt bekannter Ort: Geburt, Ereignisse, Heirat, Tod", () => {
    const r = build(
      [person({ id: "a", birth: d("1850"), birthPlace: "Kiel", death: d("1920"), deathPlace: "Hamburg" })],
      [
        { personId: "a", date: d("1875"), place: "New York" },
        { personId: "a", date: d("1880"), place: "kiel" },
      ],
    );
    const p = r.persons[0];
    const at = (y: number) => {
      const i = placeInYear(p, y);
      return typeof i === "number" && i >= 0 ? r.places[i].label : i;
    };
    expect(at(1860)).toBe("Kiel");
    expect(at(1876)).toBe("New York");
    expect(at(1885)).toBe("Kiel");
    expect(at(1919)).toBe("Kiel");
    expect(at(1920)).toBe("Hamburg");
  });

  it("vor der ersten Ortsangabe: ohne Ort; Text ohne Koordinaten: nicht auf der Karte", () => {
    const r = build(
      [person({ id: "a", birth: d("1850"), death: d("1920") })],
      [
        { personId: "a", date: d("1880"), place: "Kiel" },
        { personId: "a", date: d("1890"), place: "Unbekanntdorf" },
      ],
    );
    const p = r.persons[0];
    expect(placeInYear(p, 1870)).toBeNull();
    expect(placeInYear(p, 1885)).toBe(0);
    expect(placeInYear(p, 1895)).toBe(-1);
    expect(r.unmappedTexts).toBe(1);
  });

  it("Ereignisse ohne Datum zählen nicht, Geburtsort ohne Datum ab dem Beginn", () => {
    const r = build(
      [person({ id: "a", birthPlace: "Hamburg" })],
      [
        { personId: "a", date: d("1870"), place: null },
        { personId: "a", date: null, place: "Kiel" },
      ],
    );
    expect(r.persons[0].st).toEqual([1870, 0]);
    expect(r.places[0].label).toBe("Hamburg");
  });

  it("im selben Jahr zählt die letzte Angabe (Tod nach Geburt)", () => {
    const r = build([person({ id: "a", birth: d("1850"), birthPlace: "Kiel", death: d("1850"), deathPlace: "Hamburg" })]);
    expect(r.persons[0].st.length).toBe(2);
    expect(r.places[r.persons[0].st[1]].label).toBe("Hamburg");
  });

  it("Ortsschlüssel wie die Tabelle Place (Groß-/Kleinschreibung, Leerzeichen)", () => {
    expect(placeKey(" KIEL ")).toBe("kiel");
    const r = build([person({ id: "a", birth: d("1850"), birthPlace: "  KIEL" })]);
    expect(r.places).toHaveLength(1);
  });

  it("Startjahr: das Jahr mit den meisten Personen auf der Karte", () => {
    const r = build([
      person({ id: "a", birth: d("1850"), death: d("1860"), birthPlace: "Kiel" }),
      person({ id: "b", birth: d("1855"), death: d("1900"), birthPlace: "Kiel" }),
      person({ id: "c", birth: d("1858"), death: d("1859"), birthPlace: "Hamburg" }),
    ]);
    expect(r.defaultYear).toBe(1858);
    expect([r.yearMin, r.yearMax]).toEqual([1850, 1900]);
  });
});

describe("snapshot (ein Jahr)", () => {
  it("gruppiert je Ort, zählt Linien und Personen ohne Ort", () => {
    const lines = (...k: LineKey[]) => k;
    const r = build([
      person({ id: "vater", birth: d("1850"), birthPlace: "Kiel", lines: lines("FF", "FM") }),
      person({ id: "opa", birth: d("1830"), birthPlace: "Kiel", lines: lines("FF") }),
      person({ id: "x", birth: d("1850"), birthPlace: "Hamburg" }),
      person({ id: "ohne", birth: d("1850") }),
    ]);
    const s = snapshot(r, 1860);
    expect(s.alive).toBe(4);
    expect(s.noPlace).toBe(1);
    expect(s.unmapped).toBe(0);
    const kiel = s.groups.find((g) => r.places[g.place].label === "Kiel")!;
    expect(kiel.persons).toHaveLength(2);
    expect(kiel.perLine).toEqual({ FF: 2, FM: 1, MF: 0, MM: 0 });
    expect(kiel.weights.FF).toBeCloseTo(1.5);
    expect(kiel.weights.FM).toBeCloseTo(0.5);
    const hamburg = s.groups.find((g) => r.places[g.place].label === "Hamburg")!;
    expect(hamburg.weights.none).toBe(1);
    expect(r.persons.find((p) => p.id === "vater")!.ln).toBe(LINE_BIT.FF | LINE_BIT.FM);
  });
});

describe("Zeitreise: Regler, Alter, wer lebte, In diesem Jahr", () => {
  it("Spanne des Reglers: frühestes bis spätestes Jahr, Eingaben werden begrenzt", () => {
    const r = build([
      person({ id: "a", birth: d("1820"), death: d("1880") }),
      person({ id: "b", birth: d("1990") }),
    ]);
    expect([r.yearMin, r.yearMax]).toEqual([1820, 2025]);
    expect(clampYear(1700, r.yearMin, r.yearMax)).toBe(1820);
    expect(clampYear(3000, r.yearMin, r.yearMax)).toBe(2025);
    expect(clampYear(1850.6, r.yearMin, r.yearMax)).toBe(1851);
    expect(clampYear(Number.NaN, r.yearMin, r.yearMax)).toBe(1820);
    expect(parseYearInput(" 1850 ")).toBe(1850);
    expect(parseYearInput("18a0")).toBeNull();
    expect(parseYearInput("")).toBeNull();
    expect(aliveByYear(r, 1879, 1881)).toEqual([1, 1, 0]);
    expect(aliveByYear(r, 1990, 1991)).toEqual([1, 1]);
  });

  it("Alter: Jahr minus Geburtsjahr, „etwa“ bei ungenauer Geburt oder nur Taufe, sonst unbekannt", () => {
    const r = build(
      [
        person({ id: "genau", birth: d("1816-03-12", "DAY") }),
        person({ id: "um", birth: d("1816", "YEAR", "ABOUT") }),
        person({ id: "zwischen", birth: d("1814", "YEAR", "BETWEEN", "1818") }),
        person({ id: "taufe", baptism: d("1816-04-01", "DAY") }),
        person({ id: "ohne" }),
      ],
      [{ personId: "ohne", date: d("1840"), place: "Kiel" }],
    );
    const age = (id: string, y: number) => formatAge(ageInYear(r.persons.find((p) => p.id === id)!, y));
    expect(age("genau", 1850)).toBe("34 Jahre");
    expect(age("genau", 1817)).toBe("1 Jahr");
    expect(age("genau", 1816)).toBe("unter 1 Jahr");
    expect(age("um", 1850)).toBe("etwa 34 Jahre");
    expect(age("zwischen", 1850)).toBe("etwa 34 Jahre");
    expect(age("taufe", 1850)).toBe("etwa 34 Jahre");
    expect(age("ohne", 1850)).toBe("Alter unbekannt");
    // Die Taufe ohne Ort setzt auch den Beginn (Taufe statt Geburt).
    expect(r.persons.find((p) => p.id === "taufe")).toMatchObject({ y0: 1816, bt: 1, ba: 1 });
    expect(r.persons.find((p) => p.id === "ohne")).toMatchObject({ y0: 1840, nb: 1 });
    // Genaue Geburt: keine Zusatzfelder (Datenmenge).
    const genau = r.persons.find((p) => p.id === "genau")!;
    expect([genau.b, genau.ba, genau.bt, genau.nb]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("wer lebte: dieselben Personen wie die Karte, ohne Sterbedatum höchstens die angenommene Lebensspanne", () => {
    const r = build(
      [
        person({ id: "a", birth: d("1800"), death: d("1860"), birthPlace: "Kiel" }),
        person({ id: "b", birth: d("1830"), birthPlace: "Hamburg" }),
        person({ id: "c", birth: d("1855") }),
        person({ id: "d" }),
      ],
      [],
    );
    const ids = (y: number) => livedInYear(r, y).map((e) => r.persons[e.i].id);
    expect(ids(1850)).toEqual(["a", "b"]);
    expect(ids(1860)).toEqual(["a", "b", "c"]);
    expect(ids(1861)).toEqual(["b", "c"]);
    expect(ids(1830 + PRESUMED_LIFESPAN)).toContain("b");
    expect(ids(1830 + PRESUMED_LIFESPAN + 1)).not.toContain("b");
    for (let y = 1800; y <= 2000; y += 7) expect(livedInYear(r, y).length).toBe(snapshot(r, y).alive);
    // Person ohne Datum zählt nie.
    expect(r.persons.some((p) => p.id === "d")).toBe(false);
  });

  it("nach Ort gruppiert (Orte der Karte nach Zahl, dann ohne Koordinaten, dann ohne Ort), nach Name und Alter sortiert", () => {
    const r = build(
      [
        person({ id: "Zora", name: "Zora", birth: d("1800"), birthPlace: "Kiel" }),
        person({ id: "Anna", name: "Anna", birth: d("1820"), birthPlace: "Kiel" }),
        person({ id: "Bert", name: "Bert", birth: d("1810"), birthPlace: "Hamburg" }),
        person({ id: "Carl", name: "Carl", birth: d("1815"), birthPlace: "Nirgendwo" }),
        person({ id: "Dora", name: "Dora", birth: d("1805") }),
        person({ id: "Emil", name: "Emil" }),
      ],
      [{ personId: "Emil", date: d("1830"), place: null }],
    );
    const rows = livedInYear(r, 1850);
    const groups = groupLivedByPlace(r, rows);
    expect(groups.map((g) => [g.label, g.rows.map((x) => r.persons[x.i].n)])).toEqual([
      ["Kiel", ["Anna", "Zora"]],
      ["Hamburg", ["Bert"]],
      ["Ort nicht auf der Karte", ["Carl"]],
      ["ohne bekannten Ort", ["Dora", "Emil"]],
    ]);
    expect(sortLived(r, rows, "name").map((x) => r.persons[x.i].n)).toEqual(["Anna", "Bert", "Carl", "Dora", "Emil", "Zora"]);
    // Älteste zuerst, ohne Alter am Ende.
    expect(sortLived(r, rows, "age").map((x) => r.persons[x.i].n)).toEqual(["Zora", "Dora", "Bert", "Carl", "Anna", "Emil"]);
  });

  it("In diesem Jahr: Geburten (ersatzweise Taufe), Hochzeiten, Todesfälle (ohne geschätztes Ende)", () => {
    const r = buildMapData({
      persons: [
        person({ id: "a", birth: d("1850"), death: d("1900") }),
        person({ id: "b", baptism: d("1850") }),
        person({ id: "c", birth: d("1825") }),
        person({ id: "e", birth: d("1830") }),
        person({ id: "f", birth: d("1700") }),
      ],
      facts: [{ personId: "e", date: d("1900"), place: "Kiel", burial: true }],
      coords,
      currentYear: 2025,
      marriages: [
        { a: "c", b: "e", date: d("1850", "YEAR", "ABOUT") },
        { a: "a", b: null, date: d("1875") },
        { a: "unbekannt", b: null, date: d("1850") },
      ],
    });
    const name = (i: number) => r.persons[i].id;
    const y1850 = eventsInYear(r, 1850);
    expect(y1850.births.map(name).sort()).toEqual(["a", "b"]);
    expect(y1850.marriages.map(([x, y]) => [name(x), y >= 0 ? name(y) : null])).toEqual([["c", "e"]]);
    expect(y1850.deaths).toEqual([]);
    expect(eventsInYear(r, 1875).marriages.map(([x, y]) => [name(x), y])).toEqual([["a", -1]]);
    // Tod und Beerdigung zählen, das geschätzte Ende (1700 + Lebensspanne) nicht.
    expect(eventsInYear(r, 1900).deaths.map(name).sort()).toEqual(["a", "e"]);
    expect(eventsInYear(r, 1700 + PRESUMED_LIFESPAN).deaths).toEqual([]);
  });

  it("Hochzeiten: nur Ehen mit Datum, beide Partner sichtbar, mindestens einer in der Auswahl", () => {
    const rel = (from: string, to: string, subtype: string, date: FuzzyDate | null = d("1850"), type = "PARTNER_OF") => ({ type, subtype, from, to, date });
    const visible = (id: string) => id !== "gesperrt";
    const selected = (id: string) => ["a", "b", "c"].includes(id);
    const picked = pickMarriages(
      [
        rel("a", "b", "MARRIED"),
        rel("a", "gesperrt", "MARRIED"),
        rel("c", "x", "DIVORCED"),
        rel("a", "b", "UNMARRIED"),
        rel("a", "b", "MARRIED", null),
        rel("x", "y", "MARRIED"),
        rel("a", "b", "BIOLOGICAL", d("1850"), "PARENT_OF"),
      ],
      visible,
      selected,
    );
    expect(picked.map((m) => [m.a, m.b])).toEqual([
      ["a", "b"],
      ["c", null],
    ]);
  });
});

describe("Projektion", () => {
  it("Mercator, Europa-Ausschnitt enthält Kiel, Zoom hält den Punkt fest", () => {
    const [x, y] = project(10.1, 54.3);
    const e = VIEWS.europe;
    expect(x).toBeGreaterThan(e.x);
    expect(x).toBeLessThan(e.x + e.w);
    expect(y).toBeGreaterThan(e.y);
    expect(y).toBeLessThan(e.y + e.h);
    const f = fitViewBox(e, 390, 600);
    expect(f.w / f.h).toBeCloseTo(390 / 600);
    const z = zoomAt(f, 2, x, y);
    expect(z.w).toBeCloseTo(f.w / 2);
    expect((x - z.x) / z.w).toBeCloseTo((x - f.x) / f.w);
  });
});

describe("Leistung", () => {
  it("12 000 Personen: Aufbau und alle Jahre zügig", () => {
    const N = 12_000;
    const texts = ["Kiel", "Hamburg", "New York", ...Array.from({ length: 800 }, (_, i) => `Ort ${i}`)];
    const many: Record<string, MapPlace> = {};
    texts.forEach((t, i) => (many[placeKey(t)] = { label: t, lat: 40 + (i % 30), lon: (i % 40) - 10, precision: "PLACE" }));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const persons: MapPersonInput[] = [];
    const facts: MapFactInput[] = [];
    for (let i = 0; i < N; i++) {
      const by = 1700 + Math.floor(rnd() * 300);
      persons.push(
        person({
          id: `p${i}`,
          name: `Person ${i}`,
          birth: d(String(by)),
          birthPlace: texts[Math.floor(rnd() * texts.length)],
          death: rnd() < 0.8 ? d(String(Math.min(2024, by + 20 + Math.floor(rnd() * 70)))) : null,
          deathPlace: texts[Math.floor(rnd() * texts.length)],
          lines: rnd() < 0.3 ? ["FF"] : [],
        }),
      );
      for (let k = 0; k < 2; k++) facts.push({ personId: `p${i}`, date: d(String(by + 15 + k * 10)), place: texts[Math.floor(rnd() * texts.length)] });
    }
    // Jede zweite Person heiratet (Zeile „In diesem Jahr“).
    const marriages = Array.from({ length: N / 2 }, (_, k) => ({ a: `p${2 * k}`, b: `p${2 * k + 1}`, date: d(String(1720 + (k % 280))) }));
    const t0 = performance.now();
    const r = buildMapData({ persons, facts, coords: (k) => many[k] ?? null, currentYear: 2025, marriages });
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    let total = 0;
    for (let y = r.yearMin; y <= r.yearMax; y++) total += snapshot(r, y).alive;
    const years = r.yearMax - r.yearMin + 1;
    const tYear = (performance.now() - t1) / years;
    // Zeitreise je Jahr: Liste (gruppiert) und „In diesem Jahr“.
    const t2 = performance.now();
    let listed = 0;
    for (let y = r.yearMin; y <= r.yearMax; y++) {
      listed += groupLivedByPlace(r, livedInYear(r, y)).length;
      listed += eventsInYear(r, y).births.length;
    }
    const tList = (performance.now() - t2) / years;
    const size = JSON.stringify(r).length;
    const marSize = JSON.stringify(r.mar).length;
    console.log(
      `[karte] ${N} Personen: Aufbau ${tBuild.toFixed(0)} ms, je Jahr ${tYear.toFixed(2)} ms Karte + ${tList.toFixed(2)} ms Liste (${years} Jahre), Daten ${(size / 1e6).toFixed(2)} MB JSON (davon Hochzeiten ${(marSize / 1e3).toFixed(0)} KB)`,
    );
    expect(total).toBeGreaterThan(0);
    expect(listed).toBeGreaterThan(0);
    expect(tBuild).toBeLessThan(2000);
    expect(tYear).toBeLessThan(50);
    expect(tList).toBeLessThan(100);
  });
});
