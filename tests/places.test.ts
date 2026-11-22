/**
 * Ortszuordnung (lib/places): Zerlegen von Ortstexten, Suche im
 * Ortsverzeichnis, automatische Zuordnung — mit einem kleinen, von Hand
 * gebauten Verzeichnis für die Regeln und mit dem mitgelieferten
 * (geo/gazetteer.tsv.gz) für echte Ortsformen und historische Namen.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { parseGazetteer, searchGazetteer, type Gazetteer } from "@/lib/places/gazetteer";
import { loadGazetteerSync } from "@/lib/places/gazetteer-file";
import { matchPlace } from "@/lib/places/match";
import { normalizeForLookup, placeKey, splitPlaceText } from "@/lib/places/normalize";
import { mockData } from "./helpers";

describe("normalize", () => {
  it("placeKey vereinheitlicht nur Schreibung und Leerzeichen", () => {
    expect(placeKey("  Berkum ,Peine,  Saarland ")).toBe("berkum, peine, saarland");
    expect(placeKey("KIEL")).toBe(placeKey("kiel"));
    expect(placeKey("Vöhrum")).not.toBe(placeKey("Peine-Vöhrum"));
  });

  it("normalizeForLookup entfernt Akzente und Sonderzeichen", () => {
    expect(normalizeForLookup("Timișoara")).toBe("varias");
    expect(normalizeForLookup("Timişoara")).toBe("varias");
    expect(normalizeForLookup("Wrocław")).toBe("wroclaw");
    expect(normalizeForLookup("Straße")).toBe("strasse");
    expect(normalizeForLookup("Halle (Saale)")).toBe("halle saale");
  });

  it("zerlegt GEDCOM-Ortsformen und entfernt Verwaltungsvorsätze", () => {
    const parts = splitPlaceText("Berkum, Peine, Lk Peine, Saarland, Germany");
    expect(parts.map((p) => p.raw)).toEqual(["Berkum", "Peine", "Lk Peine", "Saarland", "Germany"]);
    expect(parts[2].lookups).toContain("peine");
    // „Kreisstadt“ allein nennt keinen Ort.
    expect(splitPlaceText("Vöhrum, Peine, Kreisstadt, Saarland").map((p) => p.raw)).not.toContain("Kreisstadt");
    // Anschrift: wird nicht als Ort gesucht.
    expect(splitPlaceText("Hannover, Lister Meile 12")[1].address).toBe(true);
    // Postleitzahl ist keine Anschrift.
    expect(splitPlaceText("66740 Peine")[0]).toMatchObject({ address: false, lookups: ["peine"] });
    // Klammerzusatz mit und ohne, St./Sankt, zusammengesetzte Namen als Rückfall.
    expect(splitPlaceText("Hannover (Amtsgericht)")[0].lookups).toEqual(["hannover amtsgericht", "hannover"]);
    expect(splitPlaceText("St. Wendel")[0].lookups).toContain("sankt wendel");
    expect(splitPlaceText("Peine-Vöhrum")[0].fallbacks).toEqual(["vohrum", "peine"]);
  });
});

// Kleines Verzeichnis: id, name, weitere Namen, lat, lon, Land, Region, Einwohner, Art
const MINI = [
  "1\tPeine\tPaane\t49.31\t6.75\tDE\t09\t38000\tP",
  "2\tRoden\t\t49.33\t6.75\tDE\t09\t\tP",
  "3\tRoden\t\t49.90\t9.63\tDE\t02\t1089\tP",
  "4\tRoden\t\t53.14\t6.43\tNL\t01\t7030\tP",
  "5\tKiel\t\t54.32\t10.13\tDE\t10\t246000\tP",
  "6\tWrocław\tBreslau\t51.10\t17.03\tPL\t72\t672000\tP",
  "7\tBreslau\t\t48.40\t12.00\tDE\t02\t\tP",
  "10\tSaarland\tSarre\t49.40\t6.96\tDE\t09\t\tA",
  "11\tBayern\tBavaria\t48.90\t11.40\tDE\t02\t\tA",
  "12\tHamburg\t\t53.55\t10.00\tDE\t04\t\tA",
  "13\tHamburg\t\t53.55\t9.99\tDE\t04\t1800000\tP",
  "14\tAltona\t\t53.55\t9.93\tDE\t04\t250000\tP",
  "20\tDeutschland\tGermany;Preußen\t51.0\t10.0\tDE\t\t\tC",
  "21\tPolen\tPoland\t52.0\t19.0\tPL\t\t\tC",
  "22\tNiederlande\tNetherlands;Holland\t52.2\t5.5\tNL\t\t\tC",
  "h1\tSchlesien\tSilesia\t51.0\t16.8\tPL\t\t\tH",
].join("\n");

describe("matchPlace (Regeln, kleines Verzeichnis)", () => {
  const gaz = parseGazetteer(MINI);
  const m = (t: string) => matchPlace(gaz, t);

  it("sucht vom spezifischen zum allgemeinen Teil, Region schränkt ein", () => {
    expect(m("Berkum, Peine, Lk Peine, Saarland, Germany")).toMatchObject({ precision: "PLACE", matchedPart: "Berkum", entry: { id: "2" } });
  });

  it("gleichnamiger Ort weit weg vom nächsten genannten Ort wird verworfen", () => {
    // Ohne Region: das Berkum bei Peine, nicht das in Bayern oder den Niederlanden.
    expect(m("Berkum, Peine")?.entry.id).toBe("2");
    const gazNoLocal = parseGazetteer(MINI.split("\n").filter((l) => !l.startsWith("2\t")).join("\n"));
    expect(matchPlace(gazNoLocal, "Berkum, Peine, Germany")).toMatchObject({ entry: { id: "1" }, matchedPart: "Peine" });
  });

  it("heutiger Ländername schränkt ein, historischer nur als Vorzug", () => {
    expect(m("Berkum, Holland")?.entry.id).toBe("4");
    // „Breslau, Germany“: das deutsche Dorf Breslau (strikt Deutschland)
    expect(m("Breslau, Germany")?.entry.id).toBe("7");
    // „Breslau, Preußen“: historisch — die Großstadt (heute Polen) bleibt möglich; mit Schlesien eindeutig.
    expect(m("Breslau, Schlesien, Preußen")?.entry.id).toBe("6");
    expect(m("Breslau, Schlesien, Germany")?.entry.id).toBe("6");
  });

  it("ohne Ort: Region, dann Land", () => {
    expect(m("Unbekanntdorf, Saarland, Germany")).toMatchObject({ precision: "REGION", entry: { id: "10" } });
    expect(m("Schlesien")).toMatchObject({ precision: "REGION", entry: { id: "h1" } });
    expect(m("Irgendwo, Deutschland")).toMatchObject({ precision: "COUNTRY", entry: { id: "20" } });
    expect(m("Deutschland")).toMatchObject({ precision: "COUNTRY" });
    expect(m("Nirgendwo")).toBeNull();
    expect(m("")).toBeNull();
  });

  it("Stadt vor gleichnamiger Region, Stadt als Anker", () => {
    expect(m("Hamburg")).toMatchObject({ precision: "PLACE", entry: { id: "13" } });
    expect(m("Altona, Hamburg")).toMatchObject({ precision: "PLACE", entry: { id: "14" } });
  });

  it("weitere Namen und Akzente", () => {
    expect(m("Paane")?.entry.id).toBe("1");
    // Großstadt vor gleichnamigem Weiler, auch wenn der in Deutschland liegt …
    expect(m("Breslau")?.entry.id).toBe("6");
    // … aber ein deutsches Dorf vor einem etwas größeren im Ausland.
    expect(m("Berkum")?.entry.id).toBe("3");
  });

  it("Präfixsuche findet auch historische Namen", () => {
    const hits = searchGazetteer(gaz, "bresl");
    expect(hits.map((h) => h.id)).toEqual(expect.arrayContaining(["6", "7"]));
    expect(searchGazetteer(gaz, "b")).toEqual([]);
  });
});

describe("matchPlace mit dem mitgelieferten Ortsverzeichnis", () => {
  let gaz: Gazetteer;
  beforeAll(() => {
    gaz = loadGazetteerSync();
  });

  const cases: [string, { label: RegExp; precision: string; lat: number; lon: number }][] = [
    ["Berkum, Peine, Lk Peine, Saarland, Germany", { label: /^Berkum, Saarland/, precision: "PLACE", lat: 49.33, lon: 6.75 }],
    ["Vöhrum, Peine, Kreisstadt, Saarland, Germany", { label: /^Vöhrum, Saarland/, precision: "PLACE", lat: 49.33, lon: 6.77 }],
    ["Kirchhofen, Baden-Württemberg, Germany", { label: /^Kirchhofen, Baden-Württemberg/, precision: "PLACE", lat: 47.92, lon: 7.74 }],
    ["Breslau", { label: /^Wrocław/, precision: "PLACE", lat: 51.1, lon: 17.03 }],
    ["Breslau, Schlesien, Preußen", { label: /^Wrocław/, precision: "PLACE", lat: 51.1, lon: 17.03 }],
    ["Paane", { label: /^Peine, Saarland/, precision: "PLACE", lat: 49.31, lon: 6.75 }],
    ["Temeswar", { label: /^Timişoara/, precision: "PLACE", lat: 46.02, lon: 20.95 }],
    ["Temeswar, Banat", { label: /^Timişoara/, precision: "PLACE", lat: 46.02, lon: 20.95 }],
    ["Timișoara, Timiș, Romania", { label: /^Timişoara/, precision: "PLACE", lat: 46.02, lon: 20.95 }],
    ["Danzig, Westpreußen", { label: /Polen$/, precision: "PLACE", lat: 54.35, lon: 18.65 }],
    ["Königsberg, Ostpreußen", { label: /^Kaliningrad/, precision: "PLACE", lat: 54.71, lon: 20.51 }],
    ["Lemberg, Galizien", { label: /Ukraine$/, precision: "PLACE", lat: 49.84, lon: 24.02 }],
    ["New York, New York, USA", { label: /^New York City/, precision: "PLACE", lat: 40.71, lon: -74.01 }],
    ["München", { label: /^München, Bayern, Deutschland$/, precision: "PLACE", lat: 48.14, lon: 11.58 }],
    ["Saarland, Germany", { label: /^Saarland/, precision: "REGION", lat: 49.4, lon: 6.96 }],
    ["Ostpreußen", { label: /^Ostpreußen/, precision: "REGION", lat: 54.4, lon: 21 }],
    ["Deutschland", { label: /^Deutschland$/, precision: "COUNTRY", lat: 50.96, lon: 9.68 }],
  ];
  for (const [text, want] of cases) {
    it(`„${text}“`, () => {
      const m = matchPlace(gaz, text);
      expect(m, text).not.toBeNull();
      expect(m!.precision).toBe(want.precision);
      expect(m!.label).toMatch(want.label);
      expect(m!.entry.lat).toBeCloseTo(want.lat, 1);
      expect(m!.entry.lon).toBeCloseTo(want.lon, 1);
    });
  }

  it("ordnet alle Ortsformen der Mock-Daten zu", () => {
    const d = mockData();
    const texts = new Set<string>();
    for (const p of d.persons) for (const t of [p.birthPlace, p.deathPlace]) if (t) texts.add(t);
    for (const r of d.relationships) for (const t of [r.startPlace, r.endPlace]) if (t) texts.add(t);
    for (const e of d.events) if (e.place) texts.add(e.place);
    const missing = [...texts].filter((t) => matchPlace(gaz, t)?.precision !== "PLACE");
    expect(missing).toEqual([]);
    expect(texts.size).toBeGreaterThanOrEqual(30);
  });

  it("Suche im Verzeichnis: Name, alter Name, Region", () => {
    expect(searchGazetteer(gaz, "Peine")[0].label).toMatch(/^Peine, Saarland/);
    expect(searchGazetteer(gaz, "Breslau").some((h) => /Wrocław/.test(h.label))).toBe(true);
    expect(searchGazetteer(gaz, "Schlesien").some((h) => h.kind === "H")).toBe(true);
  });
});
