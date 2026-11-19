import { describe, expect, it } from "vitest";

import { formatGedcomDate, fromAppDate, parseGedcomDate, toAppDate } from "@/lib/gedcom/dates";
import type { GedcomDateKind } from "@/lib/gedcom/types";

type Row = [input: string, kind: GedcomDateKind, start?: object, end?: object, extra?: object];

const G = (year: number, month?: number, day?: number) => ({
  calendar: "GREGORIAN",
  year,
  ...(month !== undefined ? { month } : {}),
  ...(day !== undefined ? { day } : {}),
});

const STANDARD: Row[] = [
  ["12 MAR 1850", "EXACT", G(1850, 3, 12)],
  ["MAR 1850", "EXACT", G(1850, 3)],
  ["1850", "EXACT", G(1850)],
  ["01 JAN 1900", "EXACT", G(1900, 1, 1)],
  ["ABT 1850", "ABOUT", G(1850)],
  ["CAL 1850", "CALCULATED", G(1850)],
  ["EST MAY 1850", "ESTIMATED", G(1850, 5)],
  ["BEF 1900", "BEFORE", G(1900)],
  ["AFT 3 JUN 1723", "AFTER", G(1723, 6, 3)],
  ["BET 1850 AND 1860", "BETWEEN", G(1850), G(1860)],
  ["BET JAN 1850 AND 12 FEB 1850", "BETWEEN", G(1850, 1), G(1850, 2, 12)],
  ["FROM 1880 TO 1905", "FROM_TO", G(1880), G(1905)],
  ["FROM 1880", "FROM", G(1880)],
  ["TO 1905", "TO", G(1905)],
  ["INT 1850 (laut Grabstein)", "INTERPRETED", G(1850), undefined, { phrase: "laut Grabstein" }],
  ["(kurz nach dem Krieg)", "PHRASE", undefined, undefined, { phrase: "kurz nach dem Krieg" }],
  ["11 FEB 1749/50", "EXACT", { calendar: "GREGORIAN", year: 1749, dualYear: 1750, month: 2, day: 11 }],
  ["1699/00", "EXACT", { calendar: "GREGORIAN", year: 1699, dualYear: 1700 }],
  ["44 B.C.", "EXACT", { calendar: "GREGORIAN", year: 44, bc: true }],
  ["@#DGREGORIAN@ 5 MAY 1900", "EXACT", G(1900, 5, 5)],
  ["@#DJULIAN@ 1 JAN 1700", "EXACT", { calendar: "JULIAN", year: 1700, month: 1, day: 1, gregorian: { year: 1700, month: 1, day: 11 } }],
  ["@#DJULIAN@ 4 OCT 1582", "EXACT", { calendar: "JULIAN", year: 1582, month: 10, day: 4, gregorian: { year: 1582, month: 10, day: 14 } }],
  ["@#DFRENCH R@ 1 VEND 1", "EXACT", { calendar: "FRENCH_R", year: 1, month: 1, day: 1, gregorian: { year: 1792, month: 9, day: 22 } }],
  ["@#DFRENCH R@ 18 BRUM 8", "EXACT", { calendar: "FRENCH_R", year: 8, month: 2, day: 18, gregorian: { year: 1799, month: 11, day: 9 } }],
  ["@#DFRENCH R@ 1 VEND 12", "EXACT", { calendar: "FRENCH_R", year: 12, month: 1, day: 1, gregorian: { year: 1803, month: 9, day: 24 } }],
  ["@#DFRENCH R@ BRUM 8", "EXACT", { calendar: "FRENCH_R", year: 8, month: 2, unconverted: true }],
  ["@#DHEBREW@ 15 NSN 5600", "EXACT", { calendar: "HEBREW", year: 5600, month: 8, day: 15, unconverted: true }],
  ["@#DROMAN@ 1000", "EXACT", { calendar: "ROMAN", year: 1000, unconverted: true }],
  ["ABT @#DJULIAN@ 1650", "ABOUT", { calendar: "JULIAN", year: 1650, gregorian: { year: 1650 } }],
  // GEDCOM 7
  ["JULIAN 1 MAR 1699", "EXACT", { calendar: "JULIAN", year: 1699, month: 3, day: 1, gregorian: { year: 1699, month: 3, day: 11 } }],
  ["10 BCE", "EXACT", { calendar: "GREGORIAN", year: 10, bc: true }],
];

const LENIENT: Row[] = [
  ["abt 1850", "ABOUT", G(1850)],
  ["Abt. 1850", "ABOUT", G(1850)],
  ["ca. 1850", "ABOUT", G(1850)],
  ["circa 1850", "ABOUT", G(1850)],
  ["um 1850", "ABOUT", G(1850)],
  ["vor 1900", "BEFORE", G(1900)],
  ["nach 1723", "AFTER", G(1723)],
  ["Bef. 12 Mar 1850", "BEFORE", G(1850, 3, 12)],
  ["12 March 1850", "EXACT", G(1850, 3, 12)],
  ["12. März 1850", "EXACT", G(1850, 3, 12)],
  ["12.03.1850", "EXACT", G(1850, 3, 12)],
  ["1850-03-12", "EXACT", G(1850, 3, 12)],
  ["03.1850", "EXACT", G(1850, 3)],
  ["BET ABT 1850 AND 1860", "BETWEEN", G(1850), G(1860)],
  ["BET 1850 - 1860", "BETWEEN", G(1850), G(1860)],
  ["1850 - 1860", "BETWEEN", G(1850), G(1860)],
  ["1850-1860", "BETWEEN", G(1850), G(1860)],
  ["von 1850 bis 1860", "FROM_TO", G(1850), G(1860)],
  ["1850 bis 1860", "FROM_TO", G(1850), G(1860)],
  ["12.3. 1850 oder 14.3.1851", "BETWEEN", G(1850, 3, 12), G(1851, 3, 14)],
  ["zwischen 1850 und 1860", "BETWEEN", G(1850), G(1860)],
  ["INT 1850", "INTERPRETED", G(1850)],
];

const INVALID = ["", "irgendwann", "31 FEB 1850", "12 MAR", "13.13.1850", "@#DUNBEKANNT@ 1850", "BET 1850", "32 JAN 1900", "29 FEB 1900"];

function check([input, kind, start, end, extra]: Row) {
  const d = parseGedcomDate(input);
  expect(d.kind).toBe(kind);
  expect(d.original).toBe(input.trim());
  if (start) expect(d.start).toEqual(start);
  else expect(d.start).toBeUndefined();
  if (end) expect(d.end).toEqual(end);
  else expect(d.end).toBeUndefined();
  if (extra) expect(d).toMatchObject(extra);
}

describe("parseGedcomDate — genormte Formen", () => {
  it.each(STANDARD)("%s", (...row) => {
    check(row as Row);
    expect(parseGedcomDate(row[0]).lenient).toBeUndefined();
  });
});

describe("parseGedcomDate — nachsichtige Formen", () => {
  it.each(LENIENT)("%s", (...row) => {
    check(row as Row);
    expect(parseGedcomDate(row[0]).lenient).toBe(true);
  });
});

describe("parseGedcomDate — ungültig bleibt als Text erhalten", () => {
  it.each(INVALID)("„%s“", (input) => {
    const d = parseGedcomDate(input);
    expect(d.kind).toBe("INVALID");
    expect(d.original).toBe(input);
  });
  it("29 FEB 1900 ist gregorianisch ungültig, julianisch gültig", () => {
    expect(parseGedcomDate("@#DJULIAN@ 29 FEB 1900").kind).toBe("EXACT");
  });
});

describe("formatGedcomDate", () => {
  it.each(STANDARD.map((r) => r[0]))("genormtes Original bleibt wörtlich: %s", (input) => {
    expect(formatGedcomDate(parseGedcomDate(input))).toBe(input);
  });

  it.each([
    ["abt 1850", "ABT 1850"],
    ["12. März 1850", "12 MAR 1850"],
    ["12.03.1850", "12 MAR 1850"],
    ["BET ABT 1850 AND 1860", "BET 1850 AND 1860"],
    ["von 1850 bis 1860", "FROM 1850 TO 1860"],
    ["um 03.1850", "ABT MAR 1850"],
  ])("nachsichtig gelesen wird genormt geschrieben: %s → %s", (input, out) => {
    expect(formatGedcomDate(parseGedcomDate(input))).toBe(out);
  });

  it("aus der Struktur (ohne Original), keine deutschen Monatsnamen", () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      formatGedcomDate({ original: "", kind: "EXACT", start: { calendar: "GREGORIAN", year: 1900, month: i + 1, day: 1 } }),
    );
    expect(months.join(" ")).toBe(
      "1 JAN 1900 1 FEB 1900 1 MAR 1900 1 APR 1900 1 MAY 1900 1 JUN 1900 1 JUL 1900 1 AUG 1900 1 SEP 1900 1 OCT 1900 1 NOV 1900 1 DEC 1900",
    );
    expect(
      formatGedcomDate({
        original: "",
        kind: "BETWEEN",
        start: { calendar: "JULIAN", year: 1700, month: 3 },
        end: { calendar: "GREGORIAN", year: 1749, dualYear: 1750, month: 2, day: 1 },
      }),
    ).toBe("BET @#DJULIAN@ MAR 1700 AND 1 FEB 1749/50");
    expect(formatGedcomDate({ original: "", kind: "PHRASE", phrase: "unbekannt" })).toBe("(unbekannt)");
    expect(formatGedcomDate({ original: "", kind: "EXACT", start: { calendar: "GREGORIAN", year: 44, bc: true } })).toBe("44 B.C.");
  });

  it("veraltetes Original wird ignoriert, wenn die Struktur geändert wurde", () => {
    const d = parseGedcomDate("ABT 1850");
    d.kind = "BEFORE";
    expect(formatGedcomDate(d)).toBe("BEF 1850");
  });

  it("ungültige Daten werden wörtlich geschrieben", () => {
    expect(formatGedcomDate(parseGedcomDate("irgendwann im Winter"))).toBe("irgendwann im Winter");
  });

  it("GEDCOM 7: Kalender als Wort, BCE", () => {
    expect(formatGedcomDate({ original: "", kind: "EXACT", start: { calendar: "JULIAN", year: 1700, month: 1, day: 1 } }, 7)).toBe(
      "JULIAN 1 JAN 1700",
    );
  });
});

describe("toAppDate / fromAppDate", () => {
  it.each([
    ["12 MAR 1850", { start: { year: 1850, month: 3, day: 12 }, precision: "DAY", qualifier: "EXACT", lossy: false }],
    ["MAR 1850", { precision: "MONTH", qualifier: "EXACT" }],
    ["ABT 1850", { precision: "YEAR", qualifier: "ABOUT", lossy: false }],
    ["EST 1850", { qualifier: "ABOUT", lossy: true }],
    ["CAL 1850", { qualifier: "ABOUT", lossy: true }],
    ["BEF 1900", { qualifier: "BEFORE" }],
    ["AFT 1723", { qualifier: "AFTER" }],
    ["BET 1850 AND 1860", { start: { year: 1850 }, end: { year: 1860 }, range: "BETWEEN", lossy: true }],
    ["FROM 1880 TO 1905", { start: { year: 1880 }, end: { year: 1905 }, range: "PERIOD" }],
    ["11 FEB 1749/50", { start: { year: 1750, month: 2, day: 11 } }],
    ["@#DJULIAN@ 1 JAN 1700", { start: { year: 1700, month: 1, day: 11 }, precision: "DAY" }],
  ])("%s", (input, expected) => {
    expect(toAppDate(parseGedcomDate(input))).toMatchObject(expected);
  });

  it.each(["(Text)", "Unsinn", "44 B.C.", "@#DHEBREW@ 15 NSN 5600"])("nicht rechenbar: %s", (input) => {
    expect(toAppDate(parseGedcomDate(input))).toBeNull();
  });

  it("fromAppDate erzeugt genormtes GEDCOM", () => {
    expect(fromAppDate({ start: { year: 1850, month: 3, day: 12 } }).original).toBe("12 MAR 1850");
    expect(fromAppDate({ start: { year: 1850 }, qualifier: "ABOUT" }).original).toBe("ABT 1850");
    expect(fromAppDate({ start: { year: 1850 }, end: { year: 1860 } }).original).toBe("BET 1850 AND 1860");
    expect(fromAppDate({ start: { year: 1850 }, end: { year: 1860 }, range: "PERIOD" }).original).toBe("FROM 1850 TO 1860");
  });
});
