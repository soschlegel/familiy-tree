/**
 * „Lebensweg“ auf der Karte: reine Logik aus lib/map/life-path.ts —
 * Reihenfolge der Stationen, ungenaue und fehlende Daten, Zusammenfassen
 * gleicher Orte, Orte ohne Zuordnung, Vater-/Mutterlinie und das Ende der
 * Linie an einem nicht sichtbaren Vorfahren. Alle Namen und Orte erfunden.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate, type FuzzyDate } from "@/lib/dates";
import {
  buildLifePath,
  nextInLine,
  orderStations,
  pointNumbers,
  walkLines,
  type LineParent,
  type PathPlace,
  type PlaceLookup,
  type StationInput,
} from "@/lib/map/life-path";
import { placeKey } from "@/lib/places/normalize";

const year = (y: number, qualifier = "EXACT"): FuzzyDate => toFuzzyDate(`${y}-01-01`, "YEAR", qualifier)!;
const day = (iso: string): FuzzyDate => toFuzzyDate(iso, "DAY", "EXACT")!;

const PLACES: Record<string, PathPlace | "unresolvable"> = {
  musterstadt: { label: "Musterstadt", lat: 52, lon: 10, precision: "PLACE" },
  beispielhausen: { label: "Beispielhausen", lat: 53, lon: 9, precision: "PLACE" },
  "neu-erfunden": { label: "Neu-Erfunden, USA", lat: 40.7, lon: -74, precision: "PLACE" },
  "musterstadt, altkreis": { label: "Musterstadt", lat: 52, lon: 10, precision: "PLACE" },
  nirgendwo: "unresolvable",
};
const lookup: PlaceLookup = (key) => PLACES[key] ?? null;

const st = (key: string, role: StationInput["role"], date: FuzzyDate | null, place: string | null, extra: Partial<StationInput> = {}): StationInput => ({
  key,
  role,
  date,
  place,
  title: key,
  ...extra,
});

describe("orderStations", () => {
  it("Geburt vorn, Tod und Beerdigung hinten — auch ohne Datum", () => {
    const { line, undated } = orderStations([
      st("beerdigung", "end", null, "Musterstadt", { endRank: 1 }),
      st("wohnort", "middle", year(1880), "Beispielhausen"),
      st("tod", "end", null, "Musterstadt", { endRank: 0 }),
      st("geburt", "start", null, "Musterstadt"),
      st("heirat", "middle", day("1875-05-02"), "Beispielhausen"),
    ]);
    expect(line.map((s) => s.key)).toEqual(["geburt", "heirat", "wohnort", "tod", "beerdigung"]);
    expect(undated).toEqual([]);
  });

  it("Geburt bleibt vorn, selbst wenn ein Ereignis (Datenfehler) früher datiert ist", () => {
    const { line } = orderStations([st("taufe", "middle", year(1849), "A"), st("geburt", "start", year(1850), "A")]);
    expect(line.map((s) => s.key)).toEqual(["geburt", "taufe"]);
  });

  it("ungenaue Daten nach ihrem Anker; bei gleichem Anker das genauere zuerst", () => {
    const { line } = orderStations([
      st("um1850", "middle", year(1850, "ABOUT"), "A"),
      st("1851", "middle", year(1851), "A"),
      st("tag1850", "middle", day("1850-01-01"), "A"),
      st("jahr1850", "middle", year(1850), "A"),
      st("vor1849", "middle", year(1849, "BEFORE"), "A"),
    ]);
    expect(line.map((s) => s.key)).toEqual(["vor1849", "tag1850", "jahr1850", "um1850", "1851"]);
  });

  it("mittlere Stationen ohne Datum kommen unter „ohne Datum“, in gegebener Reihenfolge", () => {
    const { line, undated } = orderStations([
      st("beruf", "middle", null, "A"),
      st("wohnort", "middle", year(1900), "A"),
      st("konfirmation", "middle", null, "B"),
    ]);
    expect(line.map((s) => s.key)).toEqual(["wohnort"]);
    expect(undated.map((s) => s.key)).toEqual(["beruf", "konfirmation"]);
  });

  it("Linien („fixed“): Reihenfolge bleibt, nichts fällt unter „ohne Datum“", () => {
    const { line, undated } = orderStations([st("b", "middle", null, null), st("a", "middle", year(1700), "A")], { fixed: true });
    expect(line.map((s) => s.key)).toEqual(["b", "a"]);
    expect(undated).toEqual([]);
  });
});

describe("buildLifePath", () => {
  it("nummeriert die Linie, fasst aufeinanderfolgende gleiche Orte zusammen", () => {
    const path = buildLifePath(
      [
        st("geburt", "start", year(1850), "Musterstadt"),
        st("taufe", "middle", year(1850), "Musterstadt, Altkreis"),
        st("auswanderung", "middle", year(1880), "Neu-Erfunden"),
        st("rueckkehr", "middle", year(1890), "Musterstadt"),
        st("tod", "end", year(1912), "Beispielhausen"),
      ],
      lookup,
    );
    expect(path.stations.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    // Geburt und Taufe (gleiche Koordinaten, anderer Text) = ein Punkt; die
    // Rückkehr nach Musterstadt ist ein neuer Punkt (nicht aufeinanderfolgend).
    expect(path.points.map((p) => p.label)).toEqual(["Musterstadt", "Neu-Erfunden, USA", "Musterstadt", "Beispielhausen"]);
    expect(pointNumbers(path, 0)).toBe("1–2");
    expect(pointNumbers(path, 1)).toBe("3");
    expect(path.segments).toEqual([
      { from: 0, to: 1, skipped: false },
      { from: 1, to: 2, skipped: false },
      { from: 2, to: 3, skipped: false },
    ]);
    expect(path.stations[1].point).toBe(0);
  });

  it("Orte ohne Zuordnung bzw. nicht zuordenbar: in der Liste, nicht auf der Karte, Teilstück gestrichelt", () => {
    const path = buildLifePath(
      [
        st("geburt", "start", year(1850), "Musterstadt"),
        st("wohnort", "middle", year(1870), "Unbekanntdorf"),
        st("volkszaehlung", "middle", year(1875), "Nirgendwo"),
        st("tod", "end", year(1900), "Beispielhausen"),
      ],
      lookup,
    );
    expect(path.stations.map((s) => s.placeStatus)).toEqual(["map", "unassigned", "unresolvable", "map"]);
    expect(path.stations.map((s) => s.point)).toEqual([0, null, null, 1]);
    expect(path.points).toHaveLength(2);
    expect(path.segments).toEqual([{ from: 0, to: 1, skipped: true }]);
  });

  it("gleicher Ort mit einer Station ohne Karte dazwischen bleibt ein Punkt", () => {
    const path = buildLifePath(
      [st("geburt", "start", year(1850), "Musterstadt"), st("w", "middle", year(1860), "Unbekanntdorf"), st("tod", "end", year(1900), "Musterstadt")],
      lookup,
    );
    expect(path.points).toHaveLength(1);
    expect(pointNumbers(path, 0)).toBe("1, 3");
    expect(path.segments).toEqual([]);
  });

  it("ungenaue Daten werden beschriftet; ohne Datum ohne Nummer und ohne Punkt", () => {
    const path = buildLifePath(
      [
        st("geburt", "start", year(1850, "ABOUT"), "Musterstadt"),
        st("beruf", "middle", null, "Beispielhausen", { detail: "Bäcker" }),
        st("tod", "end", day("1912-03-04"), "Beispielhausen"),
      ],
      lookup,
    );
    const [birth, death, job] = path.stations;
    expect(birth).toMatchObject({ n: 1, dateText: "um 1850", yearText: "um 1850", approx: true });
    expect(death).toMatchObject({ n: 2, dateText: "04.03.1912", yearText: "1912", approx: false });
    expect(job).toMatchObject({ key: "beruf", n: null, point: null, dateText: "", detail: "Bäcker", placeStatus: "map" });
    expect(path.points).toHaveLength(2);
  });

  it("Station ganz ohne Ort: Status „none“", () => {
    const path = buildLifePath([st("a", "middle", year(1700), null), st("b", "middle", year(1730), "Musterstadt")], lookup, { fixed: true });
    expect(path.stations[0]).toMatchObject({ placeStatus: "none", placeText: null, point: null });
    expect(path.points).toHaveLength(1);
  });

  it("Ortsschlüssel wie die Karte (placeKey)", () => {
    expect(placeKey("  Musterstadt ")).toBe("musterstadt");
  });
});

describe("Vater- und Mutterlinie", () => {
  const v = (id: string, gender: string): LineParent => ({ id, visible: true, gender });
  const hidden = (id: string): LineParent => ({ id, visible: false, gender: "UNKNOWN" });

  it("nextInLine: Vater bzw. Mutter nach Geschlecht", () => {
    const parents = [v("vater", "MALE"), v("mutter", "FEMALE")];
    expect(nextInLine(parents, "father")).toEqual({ next: "vater" });
    expect(nextInLine(parents, "mother")).toEqual({ next: "mutter" });
  });

  it("nextInLine: keiner, nicht eindeutig, nicht freigegeben", () => {
    expect(nextInLine([], "father")).toEqual({ end: "none" });
    expect(nextInLine([v("m", "FEMALE")], "father")).toEqual({ end: "none" });
    expect(nextInLine([v("a", "MALE"), v("b", "MALE")], "father")).toEqual({ end: "ambiguous" });
    expect(nextInLine([v("x", "UNKNOWN"), v("m", "FEMALE")], "father")).toEqual({ end: "ambiguous" });
    expect(nextInLine([hidden("h"), v("m", "FEMALE")], "father")).toEqual({ end: "restricted" });
    // Sichtbarer Vater plus gesperrter Elternteil: weiter mit dem Vater.
    expect(nextInLine([hidden("h"), v("vater", "MALE")], "father")).toEqual({ next: "vater" });
  });

  const tree: Record<string, LineParent[]> = {
    kind: [v("vater", "MALE"), v("mutter", "FEMALE")],
    vater: [v("opa", "MALE"), v("oma", "FEMALE")],
    mutter: [hidden("gesperrt"), v("omaM", "FEMALE")],
    opa: [],
    omaM: [v("uroma", "FEMALE")],
    uroma: [],
  };
  const loader = (calls: string[][]) => async (ids: string[]) => {
    calls.push(ids);
    return new Map(ids.map((id) => [id, tree[id] ?? []]));
  };

  it("walkLines: beide Linien in einem Durchgang, je Generation ein Aufruf", async () => {
    const calls: string[][] = [];
    const out = await walkLines("kind", loader(calls), ["father", "mother"]);
    expect(out.father).toEqual({ ids: ["kind", "vater", "opa"], end: "none" });
    expect(out.mother).toEqual({ ids: ["kind", "mutter", "omaM", "uroma"], end: "none" });
    expect(calls[0]).toEqual(["kind"]);
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it("walkLines: gesperrter Vorfahr beendet die Linie; Grenze der Generationen", async () => {
    const out = await walkLines("mutter", loader([]), ["father"]);
    expect(out.father).toEqual({ ids: ["mutter"], end: "restricted" });
    const limited = await walkLines("kind", loader([]), ["mother"], 1);
    expect(limited.mother).toEqual({ ids: ["kind", "mutter"], end: "limit" });
    const exact = await walkLines("vater", loader([]), ["father"], 1);
    expect(exact.father).toEqual({ ids: ["vater", "opa"], end: "none" });
  });

  it("walkLines: Zyklus in fehlerhaften Daten endet als „nicht eindeutig“", async () => {
    const cyc: Record<string, LineParent[]> = { a: [v("b", "MALE")], b: [v("a", "MALE")] };
    const out = await walkLines("a", async (ids) => new Map(ids.map((id) => [id, cyc[id] ?? []])), ["father"]);
    expect(out.father).toEqual({ ids: ["a", "b"], end: "ambiguous" });
  });
});
