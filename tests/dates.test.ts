import { describe, expect, it } from "vitest";

import {
  certainlyBefore,
  dateBounds,
  formatFuzzyDate,
  formatFuzzyYear,
  minYearDistance,
  parseFuzzyDate,
  toDateInput,
  toFuzzyDate,
  toIsoPartial,
  yearsBetween,
  type FuzzyDate,
} from "@/lib/dates";
import { formatDate, lifeSpan } from "@/lib/tree-layout";

const ok = (input: string): FuzzyDate => {
  const r = parseFuzzyDate(input);
  if (!r.ok || !r.value) throw new Error(`nicht erkannt: ${input} (${r.ok ? "leer" : r.error})`);
  return r.value;
};
const iso = (f: FuzzyDate) => f.date.toISOString().slice(0, 10);

describe("parseFuzzyDate", () => {
  it("deutsche Schreibweisen", () => {
    expect(ok("1850")).toMatchObject({ precision: "YEAR", qualifier: "EXACT" });
    expect(iso(ok("1850"))).toBe("1850-01-01");
    expect(ok("03.1850")).toMatchObject({ precision: "MONTH" });
    expect(iso(ok("3/1850"))).toBe("1850-03-01");
    expect(ok("12.03.1850")).toMatchObject({ precision: "DAY", qualifier: "EXACT" });
    expect(iso(ok("1.3.1850"))).toBe("1850-03-01");
    expect(iso(ok("12. 3. 1850"))).toBe("1850-03-12");
    expect(ok("März 1850")).toMatchObject({ precision: "MONTH" });
    expect(iso(ok("12. März 1850"))).toBe("1850-03-12");
    expect(iso(ok("Dez. 1850"))).toBe("1850-12-01");
  });

  it("ISO, auch volle Zeitstempel (Altbestand der API)", () => {
    expect(ok("1850-03")).toMatchObject({ precision: "MONTH" });
    expect(iso(ok("1850-03-12"))).toBe("1850-03-12");
    expect(ok("1950-01-01T00:00:00.000Z")).toMatchObject({ precision: "DAY", qualifier: "EXACT" });
    expect(iso(ok("1950-01-01T00:00:00.000Z"))).toBe("1950-01-01");
  });

  it("Zusätze: um, ca., circa, ~, vor, nach, GEDCOM-Kürzel", () => {
    for (const s of ["um 1850", "ca. 1850", "ca 1850", "circa 1850", "~1850", "ABT 1850", "etwa 1850"]) {
      expect(ok(s), s).toMatchObject({ precision: "YEAR", qualifier: "ABOUT" });
    }
    expect(ok("vor 1900")).toMatchObject({ qualifier: "BEFORE" });
    expect(ok("BEF 1900")).toMatchObject({ qualifier: "BEFORE" });
    expect(ok("nach 1723")).toMatchObject({ qualifier: "AFTER" });
    expect(ok("AFT 1723")).toMatchObject({ qualifier: "AFTER" });
    expect(ok("um 03.1850")).toMatchObject({ precision: "MONTH", qualifier: "ABOUT" });
    expect(ok("  Um   12.03.1850 ")).toMatchObject({ precision: "DAY", qualifier: "ABOUT" });
  });

  it("leer ist kein Fehler", () => {
    expect(parseFuzzyDate("")).toEqual({ ok: true, value: null });
    expect(parseFuzzyDate("   ")).toEqual({ ok: true, value: null });
    expect(parseFuzzyDate(null)).toEqual({ ok: true, value: null });
  });

  it("Unsinn und unmögliche Daten mit deutscher Meldung", () => {
    for (const s of ["irgendwann", "um", "18500", "12.13.1850", "31.02.1850", "1850-13", "Foo 1850", "vor"]) {
      const r = parseFuzzyDate(s);
      expect(r.ok, s).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/gibt es nicht|kein erkennbares Datum|nicht gültig/);
    }
    expect(parseFuzzyDate("29.02.1900").ok).toBe(false); // kein Schaltjahr
    expect(parseFuzzyDate("29.02.1904").ok).toBe(true);
  });
});

describe("Anzeige und Rundlauf", () => {
  it("formatFuzzyDate", () => {
    expect(formatFuzzyDate(ok("12.03.1850"))).toBe("12.03.1850");
    expect(formatFuzzyDate(ok("1850-03"))).toBe("März 1850");
    expect(formatFuzzyDate(ok("1850"))).toBe("1850");
    expect(formatFuzzyDate(ok("ca. 1850"))).toBe("um 1850");
    expect(formatFuzzyDate(ok("BEF 1900"))).toBe("vor 1900");
    expect(formatFuzzyDate(ok("nach 1723"))).toBe("nach 1723");
    expect(formatFuzzyDate(null)).toBe("");
  });

  it("Eingabetext ergibt wieder genau dasselbe Datum", () => {
    for (const s of ["12.03.1850", "03.1850", "1850", "um 1850", "vor 01.1900", "nach 31.12.1723", "um 29.02.1904"]) {
      const f = ok(s);
      const again = ok(toDateInput(f));
      expect(again, s).toEqual(f);
    }
    // Anzeige lässt sich ebenfalls wieder einlesen.
    for (const s of ["12.03.1850", "März 1850", "um 1850", "vor 1900"]) {
      expect(formatFuzzyDate(ok(formatFuzzyDate(ok(s))))).toBe(s);
    }
  });

  it("gespeicherte Altdaten (ohne Genauigkeit) bleiben tagesgenau", () => {
    const f = toFuzzyDate("1984-08-01T00:00:00.000Z");
    expect(f).toMatchObject({ precision: "DAY", qualifier: "EXACT" });
    expect(toDateInput(f)).toBe("01.08.1984");
    expect(formatDate("1984-08-01T00:00:00.000Z")).toBe("01.08.1984");
  });

  it("Anker wird auf die Genauigkeit gekürzt", () => {
    expect(iso(toFuzzyDate("1850-07-15T00:00:00.000Z", "YEAR")!)).toBe("1850-01-01");
    expect(iso(toFuzzyDate("1850-07-15T00:00:00.000Z", "MONTH")!)).toBe("1850-07-01");
    expect(toFuzzyDate("1850-07-15T00:00:00.000Z", "UNSINN", "XYZ")).toMatchObject({ precision: "DAY", qualifier: "EXACT" });
  });

  it("ISO in Genauigkeit, Jahreskurzform und Lebensspanne", () => {
    expect(toIsoPartial(ok("1850"))).toBe("1850");
    expect(toIsoPartial(ok("03.1850"))).toBe("1850-03");
    expect(toIsoPartial(ok("12.03.1850"))).toBe("1850-03-12");
    expect(formatFuzzyYear(ok("12.03.1850"))).toBe("1850");
    expect(formatFuzzyYear(ok("um 1850"))).toBe("um 1850");
    // „vor 12.03.1850“ lässt sich nicht ehrlich auf ein Jahr kürzen.
    expect(formatFuzzyYear(ok("vor 12.03.1850"))).toBe("vor 12.03.1850");

    const d = (s: string) => ok(s).date.toISOString();
    expect(
      lifeSpan({ birthDate: d("um 1850"), birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT", deathDate: d("1912-04-02") }),
    ).toBe("um 1850 – 1912");
    expect(lifeSpan({ birthDate: d("1850"), birthDatePrecision: "YEAR", deathDate: null })).toBe("* 1850");
    expect(
      lifeSpan({ birthDate: null, deathDate: d("vor 1900"), deathDatePrecision: "YEAR", deathDateQualifier: "BEFORE" }),
    ).toBe("† vor 1900");
    expect(formatDate(d("1850-03"), "MONTH")).toBe("März 1850");
  });
});

describe("Vergleich ungenauer Daten", () => {
  it("Zeiträume", () => {
    const year = dateBounds(ok("1850"));
    expect(new Date(year.start).toISOString()).toBe("1850-01-01T00:00:00.000Z");
    expect(new Date(year.end).toISOString()).toBe("1851-01-01T00:00:00.000Z");
    expect(dateBounds(ok("vor 1900"))).toEqual({ start: -Infinity, end: Date.UTC(1900, 0, 1) });
    expect(dateBounds(ok("nach 1723")).end).toBe(Infinity);
    const about = dateBounds(ok("um 1850"));
    expect(about.start).toBeLessThan(Date.UTC(1849, 0, 1));
    expect(dateBounds(ok("um 1850"), { tolerant: false })).toEqual(year);
  });

  it("certainlyBefore nur bei sicherem Widerspruch", () => {
    expect(certainlyBefore(ok("1849"), ok("1850"))).toBe(true);
    expect(certainlyBefore(ok("1850"), ok("12.03.1850"))).toBe(false); // gleiches Jahr: unklar
    expect(certainlyBefore(ok("11.03.1850"), ok("12.03.1850"))).toBe(true);
    expect(certainlyBefore(ok("12.03.1850"), ok("12.03.1850"))).toBe(false);
    expect(certainlyBefore(ok("1849"), ok("um 1850"))).toBe(false);
    expect(certainlyBefore(ok("vor 1900"), ok("1900"))).toBe(true);
    expect(certainlyBefore(ok("vor 1900"), ok("1899"))).toBe(false);
  });

  it("yearsBetween: exakt bei Tagesdaten, sonst Bereich", () => {
    const exact = yearsBetween(ok("01.01.1900"), ok("01.01.1950"));
    expect(exact.exact).toBe(true);
    expect(Math.round(exact.min)).toBe(50);
    const range = yearsBetween(ok("1900"), ok("1950"));
    expect(range.exact).toBe(false);
    expect(range.min).toBeCloseTo(49, 0);
    expect(range.max).toBeCloseTo(51, 0);
    const open = yearsBetween(ok("vor 1900"), ok("1950"));
    expect(open.max).toBe(Infinity);
    expect(yearsBetween(ok("1900"), new Date(Date.UTC(1950, 5, 1))).min).toBeGreaterThan(49);
  });

  it("minYearDistance", () => {
    expect(minYearDistance(ok("um 1850"), ok("1852"))).toBe(0);
    expect(Math.round(minYearDistance(ok("1850"), ok("1855")))).toBe(4);
  });
});
