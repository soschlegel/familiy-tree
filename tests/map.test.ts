/**
 * Karte „Wurzeln nach Jahr“: Lebend- und Ortsregel (lib/map/build.ts), ein
 * Jahr auswerten (lib/map/year.ts), Projektion — und die Laufzeit bei rund
 * 12 000 erzeugten Personen.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate, type FuzzyDate } from "@/lib/dates";
import { buildMapData, factYear, LINE_BIT, MAX_LIFESPAN, type MapFactInput, type MapPersonInput, type MapPlace } from "@/lib/map/build";
import { fitViewBox, project, VIEWS, zoomAt } from "@/lib/map/projection";
import { placeInYear, snapshot } from "@/lib/map/year";
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
    expect(est.persons[0]).toMatchObject({ y1: 1850 + MAX_LIFESPAN, est: 1 });
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
    const t0 = performance.now();
    const r = buildMapData({ persons, facts, coords: (k) => many[k] ?? null, currentYear: 2025 });
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    let total = 0;
    for (let y = r.yearMin; y <= r.yearMax; y++) total += snapshot(r, y).alive;
    const years = r.yearMax - r.yearMin + 1;
    const tYear = (performance.now() - t1) / years;
    const size = JSON.stringify(r).length;
    console.log(
      `[karte] ${N} Personen: Aufbau ${tBuild.toFixed(0)} ms, je Jahr ${tYear.toFixed(2)} ms (${years} Jahre), Daten ${(size / 1e6).toFixed(2)} MB JSON`,
    );
    expect(total).toBeGreaterThan(0);
    expect(tBuild).toBeLessThan(2000);
    expect(tYear).toBeLessThan(50);
  });
});
