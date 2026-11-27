/**
 * Zeitgeschichte mit Geltungsbereich — reine Logik (lib/history/areas.ts,
 * Reihenfolge in lib/history/lifetime.ts und lib/history/events.ts) und die
 * Bereiche der mitgelieferten Liste gegen das Ortsverzeichnis.
 */
import { describe, expect, it } from "vitest";

import {
  areaOfKey,
  areasAtTime,
  bestMatch,
  compactAreas,
  expandAreaInput,
  HISTORY_AREA_GROUPS,
  historyAreaGroup,
  isAreaKey,
  matchArea,
  type AreaOfPlace,
  type TimedArea,
} from "@/lib/history/areas";
import { BUILTIN_HISTORY } from "@/lib/history/builtin";
import { checkHistoryInput, mergeHistory, partitionByArea, type HistoryEvent } from "@/lib/history/events";
import { lifetimeHistory, timedAreas } from "@/lib/history/lifetime";
import { parseFuzzyDate, type FuzzyDate } from "@/lib/dates";
import { loadGazetteerSync } from "@/lib/places/gazetteer-file";

const fuzzy = (text: string): FuzzyDate => {
  const r = parseFuzzyDate(text);
  if (!r.ok || !r.value) throw new Error(`kein Datum: ${text}`);
  return r.value;
};

const SACHSEN: AreaOfPlace = { country: "DE", region: "DE.13", regionName: "Sachsen" };
const BAYERN: AreaOfPlace = { country: "DE", region: "DE.02", regionName: "Bayern" };
const NUR_DE: AreaOfPlace = { country: "DE", region: null };
const WIEN: AreaOfPlace = { country: "AT", region: "AT.09", regionName: "Wien" };
const OHIO: AreaOfPlace = { country: "US", region: "US.OH", regionName: "Ohio" };

const builtin = Object.fromEntries(BUILTIN_HISTORY.map((b) => [b.id, b]));

describe("Gebiete und Gruppen", () => {
  it("Schlüssel: Land oder Region erster Ebene", () => {
    for (const k of ["DE", "AT", "DE.13", "CH.ZH", "PL.72"]) expect(isAreaKey(k), k).toBe(true);
    for (const k of ["de", "DEU", "DE.", "DE-13", "Sachsen", ""]) expect(isAreaKey(k), k).toBe(false);
  });

  it("Eingabe: Gruppen aufgelöst, vereinheitlicht, doppelte entfernt, Unbekanntes gemeldet", () => {
    const r = expandAreaInput(["group:ostdeutschland", " de ", "DE.13", "Sachsen", "group:gibt-es-nicht"]);
    expect(r.keys).toEqual(["DE", "DE.11", "DE.12", "DE.13", "DE.14", "DE.15", "DE.16"]);
    expect(r.invalid).toEqual(["Sachsen", "group:gibt-es-nicht"]);
    expect(expandAreaInput([]).keys).toEqual([]);
  });

  it("benannte Gruppen: eindeutig, nur gültige Schlüssel, mit Erläuterung", () => {
    const ids = HISTORY_AREA_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of HISTORY_AREA_GROUPS) {
      expect(g.keys.length, g.id).toBeGreaterThan(0);
      for (const k of g.keys) expect(isAreaKey(k), `${g.id}: ${k}`).toBe(true);
      expect(g.note.trim(), g.id).not.toBe("");
    }
    expect(historyAreaGroup("group:ostdeutschland")?.keys).toEqual(["DE.11", "DE.12", "DE.13", "DE.14", "DE.15", "DE.16"]);
  });

  it("zusammenfassen für die Anzeige: vollständige Gruppen als group:…, Rest einzeln", () => {
    expect(compactAreas(builtin["mauerfall"].areas)).toEqual(["group:ostdeutschland", "DE"]);
    expect(compactAreas(["DE.13", "DE"])).toEqual(["DE", "DE.13"]);
    expect(compactAreas([])).toEqual([]);
    // Europa enthält Mitteleuropa — nur die größere Gruppe erscheint.
    expect(compactAreas(builtin["zweiter-weltkrieg"].areas)).toEqual(["group:europa", "AU", "CA", "NZ", "US"]);
  });
});

describe("Passung zu einem Ort", () => {
  it("Ort, Land, überall, passt nicht", () => {
    expect(matchArea(["DE.13"], SACHSEN)).toBe("place");
    expect(matchArea(["DE"], SACHSEN)).toBe("country");
    expect(matchArea([], SACHSEN)).toBe("neutral");
    expect(matchArea(["AT"], SACHSEN)).toBe("foreign");
  });

  it("eine andere Region desselben Landes zählt nicht", () => {
    expect(matchArea(["DE.13"], BAYERN)).toBe("foreign");
  });

  it("nur das Land bekannt: Bereich mit Regionen dieses Landes ist unklar (neutral), mit dem Land ein Treffer", () => {
    expect(matchArea(["DE.13"], NUR_DE)).toBe("neutral");
    expect(matchArea(["DE"], NUR_DE)).toBe("country");
    expect(matchArea(["AT.09"], NUR_DE)).toBe("foreign");
  });

  it("Kern- und weiterer Bereich (Mauerfall): Ort in Ostdeutschland, Land im übrigen Deutschland, sonst nicht", () => {
    const wall = builtin["mauerfall"].areas;
    expect(matchArea(wall, SACHSEN)).toBe("place");
    expect(matchArea(wall, { country: "DE", region: "DE.16" })).toBe("place");
    expect(matchArea(wall, BAYERN)).toBe("country");
    expect(matchArea(wall, NUR_DE)).toBe("country");
    expect(matchArea(wall, WIEN)).toBe("foreign");
    expect(matchArea(wall, OHIO)).toBe("foreign");
  });

  it("beste Passung über mehrere Orte; ohne Orte neutral", () => {
    expect(bestMatch(["DE.13", "DE"], [OHIO, BAYERN, SACHSEN])).toEqual({ match: "place", at: SACHSEN });
    expect(bestMatch(["DE"], [OHIO, BAYERN])).toEqual({ match: "country", at: BAYERN });
    expect(bestMatch(["DE"], [OHIO]).match).toBe("foreign");
    expect(bestMatch(["DE"], [])).toEqual({ match: "neutral", at: null });
  });

  it("Schlüssel der Karte", () => {
    expect(areaOfKey("DE.13")).toEqual({ country: "DE", region: "DE.13" });
    expect(areaOfKey("DE")).toEqual({ country: "DE", region: null });
  });
});

describe("Ort zur Zeit des Ereignisses", () => {
  const life: TimedArea[] = [
    { year: 1930, area: SACHSEN },
    { year: 1955, area: BAYERN },
    { year: 1975, area: OHIO },
  ];

  it("letzte Station bis zum Ereignis", () => {
    expect(areasAtTime(life, 1950, 1950)).toEqual([SACHSEN]);
    expect(areasAtTime(life, 1955, 1955)).toEqual([BAYERN]);
    expect(areasAtTime(life, 1989, 1989)).toEqual([OHIO]);
  });

  it("Zeitraum mit Umzug: die Station davor und jede im Zeitraum", () => {
    expect(areasAtTime(life, 1950, 1960)).toEqual([SACHSEN, BAYERN]);
    expect(areasAtTime(life, 1940, 1980)).toEqual([SACHSEN, BAYERN, OHIO]);
  });

  it("keine Station vor dem Ereignis: die früheste bekannte", () => {
    expect(areasAtTime(life, 1914, 1918)).toEqual([SACHSEN]);
  });

  it("ohne Stationen: nichts", () => {
    expect(areasAtTime([], 1914, 1918)).toEqual([]);
  });

  it("Stationen ordnen: Geburt ohne Datum vorn, Tod ohne Datum hinten, andere ohne Datum zählen nicht, ohne Gebiet nicht", () => {
    const t = timedAreas([
      { date: null, role: "end", area: OHIO },
      { date: fuzzy("1950"), role: "middle", area: BAYERN },
      { date: null, role: "middle", area: WIEN },
      { date: fuzzy("1960"), role: "middle", area: null },
      { date: null, role: "start", area: SACHSEN },
      { date: fuzzy("zwischen 1940 und 1944"), role: "middle", area: WIEN },
    ]);
    expect(t.map((s) => [s.year, s.area])).toEqual([
      [-Infinity, SACHSEN],
      [1942, WIEN],
      [1950, BAYERN],
      [Infinity, OHIO],
    ]);
  });
});

describe("Lebenslauf: passendes vorn, unpassendes unter „weitere“", () => {
  const ev = (id: string, from: number, rank: 1 | 2 | 3, areas: string[], extra: Partial<HistoryEvent> = {}): HistoryEvent => ({
    id,
    source: "builtin",
    title: id,
    from,
    to: null,
    kind: "politik",
    description: null,
    region: null,
    areas,
    rank,
    ...extra,
  });
  const events = [
    ev("ost-1961", 1961, 1, ["DE.11", "DE.12", "DE.13", "DE.14", "DE.15", "DE.16", "DE"]),
    ev("west-1965", 1965, 3, ["DE.01", "DE.02"]),
    ev("de-1990", 1990, 1, ["DE"]),
    ev("welt-1969", 1969, 2, []),
    ev("usa-1970", 1970, 1, ["US"]),
    ev("ki-sachsen-1975", 1975, 3, ["DE.13"], { source: "custom", aiUnconfirmed: true }),
  ];
  const person = { birth: fuzzy("1950"), death: fuzzy("2000"), deceased: true };

  it("Person in Sachsen: Ort vor Land vor überall; USA unter „anderen Gegenden“", () => {
    const h = lifetimeHistory(events, person, 2026, 4, [{ year: 1950, area: SACHSEN }])!;
    expect(h.top.map((e) => e.id)).toEqual(["ost-1961", "welt-1969", "ki-sachsen-1975", "de-1990"]);
    expect(h.rest.map((e) => e.id)).toEqual([]);
    expect(h.other.map((e) => e.id)).toEqual(["west-1965", "usa-1970"]);
    // Dezenter Bezug: Region bzw. Land — keine Aussage über die Person.
    expect(h.top.find((e) => e.id === "ost-1961")!.near).toBe("Sachsen");
    // Nur der Treffer „Ort“ nennt die Region; „Land“ bliebe fast immer „Deutschland“.
    expect(h.top.find((e) => e.id === "de-1990")!.near).toBeUndefined();
    expect(h.top.find((e) => e.id === "welt-1969")!.near).toBeUndefined();
  });

  it("ungeprüfte KI-Einträge: innerhalb der Stufe nach ihrem Rang (Ergänzung)", () => {
    const h = lifetimeHistory(events, person, 2026, 2, [{ year: 1950, area: SACHSEN }])!;
    // Stufe „Ort“: ost-1961 (Rang 1) vor ki-sachsen-1975 (Rang 3) — beide vor „Land“.
    expect(h.top.map((e) => e.id)).toEqual(["ost-1961", "ki-sachsen-1975"]);
    expect(h.rest.map((e) => e.id)).toEqual(["welt-1969", "de-1990"]);
  });

  it("Person in Bayern: dieselben Ereignisse, andere Reihenfolge", () => {
    const h = lifetimeHistory(events, person, 2026, 3, [{ year: 1950, area: BAYERN }])!;
    expect(h.top.map((e) => e.id)).toEqual(["ost-1961", "west-1965", "de-1990"]);
    expect(h.top.find((e) => e.id === "ost-1961")!.near).toBeUndefined();
    expect(h.top.find((e) => e.id === "west-1965")!.near).toBe("Bayern");
    expect(h.rest.map((e) => e.id)).toEqual(["welt-1969"]);
    expect(h.other.map((e) => e.id)).toEqual(["usa-1970", "ki-sachsen-1975"]);
  });

  it("Umzug: es zählt der Ort zur Zeit des Ereignisses", () => {
    const h = lifetimeHistory(events, person, 2026, 4, [
      { year: 1950, area: SACHSEN },
      { year: 1968, area: OHIO },
    ])!;
    // 1961 in Sachsen, ab 1968 in Ohio: „de-1990“ und „ki-sachsen-1975“ passen nicht mehr, „usa-1970“ schon.
    expect(h.top.map((e) => e.id)).toEqual(["ost-1961", "welt-1969", "usa-1970"]);
    expect(h.other.map((e) => e.id)).toEqual(["west-1965", "ki-sachsen-1975", "de-1990"]);
  });

  it("Person ohne zugeordneten Ort: bisherige Reihenfolge (nur Rang), nichts unpassend", () => {
    const h = lifetimeHistory(events, person, 2026, 4)!;
    expect(h.top.map((e) => e.id)).toEqual(["ost-1961", "welt-1969", "usa-1970", "de-1990"]);
    expect(h.other).toEqual([]);
    expect(h.top.every((e) => e.near === undefined)).toBe(true);
  });

  it("alles unpassend: keine „wichtigsten“, alles unter „anderen Gegenden“", () => {
    const h = lifetimeHistory([events[4]], person, 2026, 4, [{ year: 1950, area: SACHSEN }])!;
    expect(h.top).toEqual([]);
    expect(h.other.map((e) => e.id)).toEqual(["usa-1970"]);
  });
});

describe("Zeitreise: Gruppierung nach Passung", () => {
  it("passende vorn, dann überall, unpassende getrennt", () => {
    const all = mergeHistory(BUILTIN_HISTORY, [], []).filter((e) => e.from <= 1961 && (e.to ?? e.from) >= 1961);
    const at = [SACHSEN];
    const { shown, foreign } = partitionByArea(all, (e) => bestMatch(e.areas, at).match);
    expect(shown.map((e) => e.id)).toEqual(["mauerbau"]);
    expect(foreign.map((e) => e.id)).toEqual(["anwerbung-gastarbeiter"]);
    const west = partitionByArea(all, (e) => bestMatch(e.areas, [BAYERN]).match);
    expect(west.shown.map((e) => e.id)).toEqual(["anwerbung-gastarbeiter", "mauerbau"]);
    expect(west.foreign).toEqual([]);
  });
});

describe("Eingabe des Geltungsbereichs", () => {
  const ok = { title: "Hochwasser", yearFrom: "1882", kind: "not" };
  const known = (k: string) => ["DE", "DE.13", "DE.11", "DE.12", "DE.14", "DE.15", "DE.16"].includes(k);

  it("fehlt oder leer: überall", () => {
    expect(checkHistoryInput(ok, 2026)).toMatchObject({ ok: true, value: { areas: [] } });
    expect(checkHistoryInput({ ...ok, areas: [] }, 2026)).toMatchObject({ ok: true, value: { areas: [] } });
  });

  it("Schlüssel und Gruppen, aufgelöst", () => {
    expect(checkHistoryInput({ ...ok, areas: ["de.13", "DE"] }, 2026, known)).toMatchObject({ ok: true, value: { areas: ["DE", "DE.13"] } });
    expect(checkHistoryInput({ ...ok, areas: ["group:ostdeutschland"] }, 2026, known)).toMatchObject({
      ok: true,
      value: { areas: ["DE.11", "DE.12", "DE.13", "DE.14", "DE.15", "DE.16"] },
    });
  });

  it("ungültige bzw. unbekannte Schlüssel abgelehnt", () => {
    const issues = (areas: unknown) => {
      const r = checkHistoryInput({ ...ok, areas }, 2026, known);
      return r.ok ? [] : r.issues;
    };
    expect(issues(["Sachsen"])[0]).toMatchObject({ path: "areas", message: "Unbekanntes Gebiet: Sachsen." });
    expect(issues(["XX"])[0]).toMatchObject({ path: "areas", message: "Unbekanntes Gebiet: XX." });
    expect(issues("DE")[0]).toMatchObject({ path: "areas" });
  });
});

describe("mitgelieferte Liste: Geltungsbereich", () => {
  const gaz = loadGazetteerSync();

  it("jeder Eintrag hat einen gültigen Bereich mit bekannten Schlüsseln (Land bzw. Region im Ortsverzeichnis)", () => {
    for (const e of BUILTIN_HISTORY) {
      expect(Array.isArray(e.areas), e.id).toBe(true);
      expect([...e.areas], e.id).toEqual([...new Set(e.areas)].sort());
      for (const k of e.areas) {
        expect(isAreaKey(k), `${e.id}: ${k}`).toBe(true);
        const known = k.includes(".") ? gaz.regions.has(k) : gaz.countries.has(k);
        expect(known, `${e.id}: ${k} nicht im Ortsverzeichnis`).toBe(true);
      }
    }
  });

  it("benannte Gruppen nur mit Schlüsseln aus dem Ortsverzeichnis", () => {
    for (const g of HISTORY_AREA_GROUPS) {
      for (const k of g.keys) expect(k.includes(".") ? gaz.regions.has(k) : gaz.countries.has(k), `${g.id}: ${k}`).toBe(true);
    }
  });

  it("weltweite Ereignisse „überall“, deutsche für Deutschland, Mauer mit Schwerpunkt Ostdeutschland", () => {
    expect(builtin["spanische-grippe"].areas).toEqual([]);
    expect(builtin["weltwirtschaftskrise"].areas).toEqual([]);
    for (const id of ["reichsgruendung", "inflation-1923", "waehrungsreform-1948", "deutsche-teilung", "wiedervereinigung"]) {
      expect(builtin[id].areas, id).toEqual(["DE"]);
    }
    for (const id of ["mauerbau", "mauerfall"]) {
      expect(matchArea(builtin[id].areas, SACHSEN), id).toBe("place");
      expect(matchArea(builtin[id].areas, BAYERN), id).toBe("country");
    }
    expect(builtin["belagerung-wien-1683"].areas).toEqual(["AT"]);
    expect(builtin["franzoesische-revolution"].areas).toEqual(["FR"]);
    for (const id of ["auswanderung-1846", "auswanderung-1864", "auswanderung-1880"]) expect(builtin[id].areas, id).toEqual(["DE"]);
    expect(matchArea(builtin["flucht-vertreibung"].areas, { country: "PL", region: "PL.72" })).toBe("country");
    expect(matchArea(builtin["erster-weltkrieg"].areas, SACHSEN)).toBe("country");
  });
});
