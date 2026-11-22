/**
 * Ortszuordnung (lib/places): Zerlegen von Ortstexten, Suche im
 * Ortsverzeichnis, automatische Zuordnung — mit einem kleinen, von Hand
 * gebauten Verzeichnis für die Regeln und mit dem mitgelieferten
 * (geo/gazetteer.tsv.gz) für echte Ortsformen und historische Namen.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { entryLabel, labelForText, parseGazetteer, searchGazetteer, type Gazetteer } from "@/lib/places/gazetteer";
import { loadGazetteerSync } from "@/lib/places/gazetteer-file";
import { matchPlace } from "@/lib/places/match";
import { normalizeForLookup, placeKey, splitPlaceText } from "@/lib/places/normalize";
import { mockData } from "./helpers";

describe("normalize", () => {
  it("placeKey vereinheitlicht nur Schreibung und Leerzeichen", () => {
    expect(placeKey("  Berkum ,Peine,  Niedersachsen ")).toBe("berkum, peine, niedersachsen");
    expect(placeKey("KIEL")).toBe(placeKey("kiel"));
    expect(placeKey("Vöhrum")).not.toBe(placeKey("Peine-Vöhrum"));
  });

  it("normalizeForLookup entfernt Akzente und Sonderzeichen", () => {
    expect(normalizeForLookup("Timișoara")).toBe("timisoara");
    expect(normalizeForLookup("Timişoara")).toBe("timisoara");
    expect(normalizeForLookup("Wrocław")).toBe("wroclaw");
    expect(normalizeForLookup("Straße")).toBe("strasse");
    expect(normalizeForLookup("Halle (Saale)")).toBe("halle saale");
  });

  it("zerlegt GEDCOM-Ortsformen und entfernt Verwaltungsvorsätze", () => {
    const parts = splitPlaceText("Berkum, Peine, Lk Peine, Niedersachsen, Germany");
    expect(parts.map((p) => p.raw)).toEqual(["Berkum", "Peine", "Lk Peine", "Niedersachsen", "Germany"]);
    expect(parts[2].lookups).toContain("peine");
    // „Kreisstadt“ allein nennt keinen Ort.
    expect(splitPlaceText("Vöhrum, Peine, Kreisstadt, Niedersachsen").map((p) => p.raw)).not.toContain("Kreisstadt");
    // Anschrift: wird nicht als Ort gesucht.
    expect(splitPlaceText("Hannover, Lister Meile 12")[1].address).toBe(true);
    // Postleitzahl ist keine Anschrift.
    expect(splitPlaceText("31224 Peine")[0]).toMatchObject({ address: false, lookups: ["peine"] });
    // Klammerzusatz mit und ohne, St./Sankt, zusammengesetzte Namen als Rückfall.
    expect(splitPlaceText("Hannover (Amtsgericht)")[0].lookups).toEqual(["hannover amtsgericht", "hannover"]);
    expect(splitPlaceText("St. Andreasberg")[0].lookups).toContain("sankt andreasberg");
    expect(splitPlaceText("Peine-Vöhrum")[0].fallbacks).toEqual(["vohrum", "peine"]);
  });
});

// Kleines Verzeichnis: id, name, weitere Namen, lat, lon, Land, Region, Einwohner, Art
const MINI = [
  "1\tPeine\tPaane\t52.32\t10.24\tDE\t06\t49953\tP",
  "2\tBerkum\t\t52.31\t10.19\tDE\t06\t\tP",
  "3\tBerkum\t\t50.62\t7.13\tDE\t07\t2432\tP",
  "4\tBerkum\t\t52.52\t6.14\tNL\t15\t3720\tP",
  "5\tKiel\t\t54.32\t10.13\tDE\t10\t246000\tP",
  "6\tWrocław\tBreslau\t51.10\t17.03\tPL\t72\t672000\tP",
  "7\tBreslau\t\t48.40\t12.00\tDE\t02\t\tP",
  "10\tNiedersachsen\tLower Saxony\t52.83\t9.17\tDE\t06\t\tA",
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
    expect(m("Berkum, Peine, Lk Peine, Niedersachsen, Germany")).toMatchObject({ precision: "PLACE", matchedPart: "Berkum", entry: { id: "2" } });
  });

  it("gleichnamiger Ort weit weg vom nächsten genannten Ort wird verworfen", () => {
    // Ohne Region: das Berkum bei Peine, nicht das in Nordrhein-Westfalen oder den Niederlanden.
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
    expect(m("Unbekanntdorf, Niedersachsen, Germany")).toMatchObject({ precision: "REGION", entry: { id: "10" } });
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
    ["Berkum, Peine, Lk Peine, Niedersachsen, Germany", { label: /^Berkum, Niedersachsen/, precision: "PLACE", lat: 52.31, lon: 10.19 }],
    ["Vöhrum, Peine, Kreisstadt, Niedersachsen, Germany", { label: /^Vöhrum, Niedersachsen/, precision: "PLACE", lat: 52.34, lon: 10.19 }],
    ["Peine-Vöhrum", { label: /^Vöhrum, Niedersachsen/, precision: "PLACE", lat: 52.34, lon: 10.19 }],
    ["Kirchhofen, Baden-Württemberg, Germany", { label: /^Kirchhofen, Baden-Württemberg/, precision: "PLACE", lat: 47.92, lon: 7.74 }],
    ["Breslau", { label: /^Wrocław/, precision: "PLACE", lat: 51.1, lon: 17.03 }],
    ["Breslau, Schlesien, Preußen", { label: /^Wrocław/, precision: "PLACE", lat: 51.1, lon: 17.03 }],
    ["Aix-la-Chapelle", { label: /^Aachen, Nordrhein-Westfalen/, precision: "PLACE", lat: 50.78, lon: 6.08 }],
    ["Temeswar", { label: /^Timișoara/, precision: "PLACE", lat: 45.75, lon: 21.23 }],
    ["Temeswar, Banat", { label: /^Timișoara/, precision: "PLACE", lat: 45.75, lon: 21.23 }],
    ["Timișoara, Timiș, Romania", { label: /^Timișoara/, precision: "PLACE", lat: 45.75, lon: 21.23 }],
    ["Danzig, Westpreußen", { label: /Polen$/, precision: "PLACE", lat: 54.35, lon: 18.65 }],
    ["Königsberg, Ostpreußen", { label: /^Kaliningrad/, precision: "PLACE", lat: 54.71, lon: 20.51 }],
    ["Lemberg, Galizien", { label: /Ukraine$/, precision: "PLACE", lat: 49.84, lon: 24.02 }],
    ["New York, New York, USA", { label: /^New York City/, precision: "PLACE", lat: 40.71, lon: -74.01 }],
    ["München", { label: /^München, Bayern, Deutschland$/, precision: "PLACE", lat: 48.14, lon: 11.58 }],
    ["Niedersachsen, Germany", { label: /^Niedersachsen/, precision: "REGION", lat: 52.83, lon: 9.17 }],
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
    expect(searchGazetteer(gaz, "Peine")[0].label).toMatch(/^Peine, Niedersachsen/);
    expect(searchGazetteer(gaz, "Breslau").some((h) => /Wrocław/.test(h.label))).toBe(true);
    expect(searchGazetteer(gaz, "Schlesien").some((h) => h.kind === "H")).toBe(true);
  });
});

describe("Anzeigename: heutiger Name, in Klammern der alte bzw. deutsche", () => {
  let gaz: Gazetteer;
  beforeAll(() => {
    gaz = loadGazetteerSync();
  });
  const label = (text: string) => matchPlace(gaz, text)?.label;

  it("Beispiele des Eigentümers", () => {
    expect(label("Breslau, Schlesien, Preußen")).toBe("Wrocław (Breslau), Polen");
    expect(label("Danzig, Westpreußen")).toBe("Gdańsk (Danzig), Polen");
    expect(label("Temeswar, Banat")).toBe("Timișoara (Temeswar), Rumänien");
  });

  it("ohne alten Namen in den Daten: der deutsche bzw. historische Name", () => {
    expect(label("Wrocław")).toBe("Wrocław (Breslau), Polen");
    expect(label("Gdańsk")).toBe("Gdańsk (Danzig), Polen");
    expect(label("Praha")).toBe("Praha (Prag), Tschechien");
    expect(label("Königsberg, Ostpreußen")).toBe("Kaliningrad (Königsberg), Russland");
    expect(label("Lemberg, Galizien")).toBe("Lviv (Lemberg), Ukraine");
  });

  it("keine Klammer, wenn der Name gleich ist oder es keinen anderen gibt", () => {
    expect(label("Ploiești, Prahova, Romania")).toBe("Ploiești, Rumänien");
    expect(label("Ploieşti")).toBe("Ploiești, Rumänien"); // nur andere Schreibweise (ş/ș)
    expect(label("Timişoara")).toBe("Timișoara (Temeswar), Rumänien"); // ş/ș ist kein alter Name
    expect(label("Wroclaw")).toBe("Wrocław (Breslau), Polen");
  });

  it("Orte im deutschen Sprachraum: nie eine Klammer, mit Bundesland", () => {
    expect(label("Aachen")).toBe("Aachen, Nordrhein-Westfalen, Deutschland");
    expect(label("Aix-la-Chapelle")).toBe("Aachen, Nordrhein-Westfalen, Deutschland");
    expect(label("München")).toBe("München, Bayern, Deutschland");
    expect(label("Berkum, Peine, Lk Peine, Niedersachsen, Germany")).toBe("Berkum, Niedersachsen, Deutschland");
    expect(label("St. Andreasberg")).toBe("Sankt Andreasberg, Niedersachsen, Deutschland");
  });

  it("Suche im Verzeichnis zeigt dieselbe Form", () => {
    expect(searchGazetteer(gaz, "Breslau").map((h) => h.label)).toContain("Wrocław (Breslau), Polen");
    expect(searchGazetteer(gaz, "Danzig").map((h) => h.label)).toContain("Gdańsk (Danzig), Polen");
  });

  it("Name aus den Daten zählt nur, wenn er ein Name des Ortes ist", () => {
    const mini = parseGazetteer("6\tWrocław\tBreslau;Vratislavia\t51.1\t17.03\tPL\t72\t672000\tP\tBreslau\n21\tPolen\t\t52\t19\tPL\t\t\tC\t");
    const e = mini.entries[0];
    expect(entryLabel(mini, e)).toBe("Wrocław (Breslau), Polen");
    expect(entryLabel(mini, e, "Vratislavia")).toBe("Wrocław (Vratislavia), Polen");
    expect(entryLabel(mini, e, "Irgendwas")).toBe("Wrocław (Breslau), Polen");
    expect(entryLabel(mini, e, "wroclaw")).toBe("Wrocław (Breslau), Polen");
    expect(labelForText(mini, e, "Vratislavia, Schlesien")).toBe("Wrocław (Vratislavia), Polen");
  });
});
