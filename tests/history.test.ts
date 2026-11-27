/**
 * Zeitgeschichte — reine Logik (lib/history/events.ts, lib/history/lifetime.ts)
 * und die mitgelieferte Liste (lib/history/builtin.ts).
 */
import { describe, expect, it } from "vitest";

import { BUILTIN_HISTORY } from "@/lib/history/builtin";
import {
  CUSTOM_RANK,
  checkHistoryInput,
  eventsInSpan,
  eventsInYear,
  formatHistoryYears,
  HISTORY_KINDS,
  historyCookie,
  historyEnabled,
  historyLanes,
  mergeHistory,
  splitByRank,
  type BuiltinHistoryEvent,
  type CustomHistoryEvent,
  type HistoryEvent,
} from "@/lib/history/events";
import { lifetimeHistory, lifetimeYears, MAX_SPREAD } from "@/lib/history/lifetime";
import { parseFuzzyDate, type FuzzyDate } from "@/lib/dates";

const fuzzy = (text: string): FuzzyDate => {
  const r = parseFuzzyDate(text);
  if (!r.ok || !r.value) throw new Error(`kein Datum: ${text}`);
  return r.value;
};

const B: BuiltinHistoryEvent[] = [
  { id: "a", title: "Krieg A", from: 1914, to: 1918, kind: "krieg", rank: 1, description: "…", areas: [] },
  { id: "b", title: "Seuche B", from: 1918, to: 1920, kind: "not", rank: 2, description: "…", areas: [] },
  { id: "c", title: "Zäsur C", from: 1923, to: null, kind: "politik", rank: 3, description: "…", areas: [] },
  { id: "d", title: "Wende D", from: 1871, to: null, kind: "politik", rank: 1, description: "…", areas: [] },
];
const C: CustomHistoryEvent[] = [
  { id: "x1", title: "Hochwasser", yearFrom: 1920, yearTo: null, kind: "not", description: " Fluss trat über ", region: " Talort " },
  { id: "x2", title: "Unbekannte Art", yearFrom: 1950, yearTo: 1950, kind: "gibt-es-nicht", description: "", region: null },
];

describe("mitgelieferte Liste", () => {
  it("eindeutige, stabile Kennungen in Kleinbuchstaben", () => {
    const ids = BUILTIN_HISTORY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("Jahre: von ≤ bis, ganze Zahlen, plausible Spanne (17. bis 20. Jahrhundert)", () => {
    for (const e of BUILTIN_HISTORY) {
      expect(Number.isInteger(e.from), e.id).toBe(true);
      expect(e.from, e.id).toBeGreaterThanOrEqual(1600);
      expect(e.from, e.id).toBeLessThanOrEqual(2000);
      if (e.to !== null) {
        expect(Number.isInteger(e.to), e.id).toBe(true);
        expect(e.to, e.id).toBeGreaterThan(e.from);
        expect(e.to, e.id).toBeLessThanOrEqual(2000);
        // Längster Eintrag ist der Dreißigjährige Krieg.
        expect(e.to - e.from, e.id).toBeLessThanOrEqual(30);
      }
    }
  });

  it("keine leeren Texte, bekannte Art, Rang 1–3, kurze Titel", () => {
    for (const e of BUILTIN_HISTORY) {
      expect(e.title.trim(), e.id).not.toBe("");
      expect(e.title.length, e.id).toBeLessThanOrEqual(60);
      expect(e.description.trim(), e.id).not.toBe("");
      expect(e.description.length, e.id).toBeLessThanOrEqual(200);
      expect(HISTORY_KINDS, e.id).toContain(e.kind);
      expect([1, 2, 3], e.id).toContain(e.rank);
    }
  });

  it("etwa 30 Einträge, nach Beginn sortiert, Stichproben der Jahreszahlen", () => {
    expect(BUILTIN_HISTORY.length).toBeGreaterThanOrEqual(25);
    expect(BUILTIN_HISTORY.length).toBeLessThanOrEqual(40);
    const froms = BUILTIN_HISTORY.map((e) => e.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
    const byId = Object.fromEntries(BUILTIN_HISTORY.map((e) => [e.id, e]));
    expect(byId["dreissigjaehriger-krieg"]).toMatchObject({ from: 1618, to: 1648 });
    expect(byId["erster-weltkrieg"]).toMatchObject({ from: 1914, to: 1918 });
    expect(byId["zweiter-weltkrieg"]).toMatchObject({ from: 1939, to: 1945 });
    expect(byId["mauerfall"]).toMatchObject({ from: 1989, to: null });
    expect(byId["wiedervereinigung"]).toMatchObject({ from: 1990, to: null });
  });
});

describe("zusammenführen und ausblenden", () => {
  it("ausgeblendete mitgelieferte fallen heraus, eigene kommen dazu (vereinheitlicht), nach der Zeit sortiert", () => {
    const all = mergeHistory(B, C, ["b"]);
    expect(all.map((e) => e.id)).toEqual(["d", "a", "c:x1", "c", "c:x2"]);
    const own = all.find((e) => e.id === "c:x1")!;
    expect(own).toMatchObject({ source: "custom", from: 1920, to: null, kind: "not", description: "Fluss trat über", region: "Talort", rank: CUSTOM_RANK });
    // „bis“ gleich „von“ → Einzeljahr; unbekannte Art → Sonstiges; leere Beschreibung → null.
    expect(all.find((e) => e.id === "c:x2")).toMatchObject({ to: null, kind: "sonstiges", description: null });
  });

  it("ungeprüfte KI-Einträge zählen als Ergänzung, bestätigte und von Hand angelegte als wichtig", () => {
    const base = { title: "Hochwasser", yearFrom: 1920, yearTo: null, kind: "not", description: null, region: null };
    const all = mergeHistory([], [
      { id: "k1", ...base, origin: "AI", confirmedAt: null },
      { id: "k2", ...base, origin: "AI", confirmedAt: new Date("2026-01-01") },
      { id: "k3", ...base, origin: "MANUAL", confirmedAt: null },
    ], []);
    const byId = Object.fromEntries(all.map((e) => [e.id, e]));
    expect(byId["c:k1"]).toMatchObject({ rank: 3, aiUnconfirmed: true });
    expect(byId["c:k2"].rank).toBe(CUSTOM_RANK);
    expect(byId["c:k2"].aiUnconfirmed).toBeUndefined();
    expect(byId["c:k3"].rank).toBe(CUSTOM_RANK);
  });

  it("unbekannte ausgeblendete Kennung stört nicht", () => {
    expect(mergeHistory(B, [], ["gibt-es-nicht"])).toHaveLength(B.length);
  });
});

describe("Auswahl je Jahr und Spanne", () => {
  const all = mergeHistory(B, C, []);

  it("Zeiträume schließen beide Ränder ein", () => {
    expect(eventsInYear(all, 1914).map((e) => e.id)).toEqual(["a"]);
    expect(eventsInYear(all, 1918).map((e) => e.id)).toEqual(["a", "b"]);
    expect(eventsInYear(all, 1920).map((e) => e.id)).toEqual(["b", "c:x1"]);
    expect(eventsInYear(all, 1921)).toEqual([]);
    expect(eventsInYear(all, 1913)).toEqual([]);
  });

  it("Einzeljahre nur in ihrem Jahr", () => {
    expect(eventsInYear(all, 1923).map((e) => e.id)).toEqual(["c"]);
    expect(eventsInYear(all, 1922)).toEqual([]);
  });

  it("Spanne: berührt am Rand, umschließt, liegt innen", () => {
    expect(eventsInSpan(all, 1900, 1914).map((e) => e.id)).toEqual(["a"]);
    expect(eventsInSpan(all, 1916, 1916).map((e) => e.id)).toEqual(["a"]);
    expect(eventsInSpan(all, 1800, 2000)).toHaveLength(all.length);
    expect(eventsInSpan(all, 1930, 1920)).toEqual([]);
  });
});

describe("Rangfolge und Bahnen", () => {
  it("die wichtigsten zuerst, beide Teile nach der Zeit", () => {
    const all = mergeHistory(B, C, []);
    const { top, rest } = splitByRank(all, 3);
    // Rang 1: d (1871), a (1914), eigene x1 (1920) und x2 (1950) — die ersten drei nach Rang, dann Zeit.
    expect(top.map((e) => e.id)).toEqual(["d", "a", "c:x1"]);
    expect(rest.map((e) => e.id)).toEqual(["b", "c", "c:x2"]);
    expect(splitByRank(all, 0).top).toEqual([]);
  });

  it("überschneidende Ereignisse in getrennte Bahnen, danach wieder Bahn 0", () => {
    const lanes = historyLanes(mergeHistory(B, [], []));
    expect(Object.fromEntries(lanes.map((l) => [l.event.id, l.lane]))).toEqual({ d: 0, a: 0, b: 1, c: 0 });
  });

  it("Jahre lesbar", () => {
    expect(formatHistoryYears({ from: 1914, to: 1918 })).toBe("1914–1918");
    expect(formatHistoryYears({ from: 1923, to: null })).toBe("1923");
    expect(formatHistoryYears({ from: 1923, to: 1923 })).toBe("1923");
  });
});

describe("Lebenszeit", () => {
  const events: HistoryEvent[] = mergeHistory(B, [], []);
  const now = 2026;

  it("Geburt und Tod genau: Ereignisse dazwischen, Ränder eingeschlossen", () => {
    const h = lifetimeHistory(events, { birth: fuzzy("12.03.1880"), death: fuzzy("1918"), deceased: true }, now)!;
    expect(h).toMatchObject({ from: 1880, to: 1918, living: false });
    expect([...h.top, ...h.rest].map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("ohne brauchbares Geburtsjahr keine Zeile", () => {
    for (const birth of [null, fuzzy("vor 1880"), fuzzy("nach 1880"), fuzzy("bis 1880")]) {
      expect(lifetimeYears({ birth, death: fuzzy("1950"), deceased: true }, now)).toBeNull();
    }
    expect(lifetimeYears({ birth: fuzzy(`zwischen 1850 und ${1850 + MAX_SPREAD + 1}`), death: null, deceased: false }, now)).toBeNull();
  });

  it("ungenaue Geburt: spätestes mögliches Jahr; ungenauer Tod: frühestes", () => {
    expect(lifetimeYears({ birth: fuzzy("um 1880"), death: fuzzy("um 1950"), deceased: true }, now)).toEqual({ from: 1880, to: 1950 });
    expect(lifetimeYears({ birth: fuzzy("zwischen 1880 und 1885"), death: fuzzy("zwischen 1950 und 1952"), deceased: true }, now)).toEqual({
      from: 1885,
      to: 1950,
    });
    expect(lifetimeYears({ birth: fuzzy("1880"), death: fuzzy("vor 1950"), deceased: true }, now)).toBeNull();
  });

  it("verstorben ohne Sterbedatum: keine Zeile; lebend: bis heute, aber nicht über 100 Jahre", () => {
    expect(lifetimeYears({ birth: fuzzy("1900"), death: null, deceased: true }, now)).toBeNull();
    expect(lifetimeYears({ birth: fuzzy("1960"), death: null, deceased: false }, now)).toEqual({ from: 1960, to: now });
    expect(lifetimeYears({ birth: fuzzy("1900"), death: null, deceased: false }, now)).toBeNull();
    const h = lifetimeHistory(events, { birth: fuzzy("1960"), death: null, deceased: false }, now);
    expect(h).toBeNull(); // nichts aus der Beispielliste nach 1960
  });

  it("Tod vor Geburt (Datenfehler): keine Zeile; nichts in der Spanne: keine Zeile", () => {
    expect(lifetimeYears({ birth: fuzzy("1950"), death: fuzzy("1940"), deceased: true }, now)).toBeNull();
    expect(lifetimeHistory(events, { birth: fuzzy("1800"), death: fuzzy("1850"), deceased: true }, now)).toBeNull();
  });

  it("begrenzt auf die wichtigsten, Rest getrennt", () => {
    const h = lifetimeHistory(events, { birth: fuzzy("1860"), death: fuzzy("1930"), deceased: true }, now, 2)!;
    expect(h.top.map((e) => e.id)).toEqual(["d", "a"]);
    expect(h.rest.map((e) => e.id)).toEqual(["b", "c"]);
  });
});

describe("Eingaben prüfen", () => {
  const ok = { title: "  Großer   Stadtbrand ", yearFrom: "1842", yearTo: "", kind: "not", description: " ", region: "Beispielstadt" };

  it("vereinheitlicht: Leerraum, leeres „bis“, leere Beschreibung", () => {
    expect(checkHistoryInput(ok, 2026)).toEqual({
      ok: true,
      value: { title: "Großer Stadtbrand", yearFrom: 1842, yearTo: null, kind: "not", description: null, region: "Beispielstadt", areas: [] },
    });
    expect(checkHistoryInput({ ...ok, yearFrom: 1900, yearTo: 1900 }, 2026)).toMatchObject({ ok: true, value: { yearTo: null } });
    expect(checkHistoryInput({ ...ok, yearTo: "1845" }, 2026)).toMatchObject({ ok: true, value: { yearTo: 1845 } });
  });

  it("Fehler je Feld", () => {
    const fields = (input: Record<string, unknown>) => {
      const r = checkHistoryInput(input, 2026);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(fields({ ...ok, title: " " })).toEqual(["title"]);
    expect(fields({ ...ok, title: "x".repeat(121) })).toEqual(["title"]);
    expect(fields({ ...ok, yearFrom: "" })).toEqual(["yearFrom"]);
    expect(fields({ ...ok, yearFrom: "18.5" })).toEqual(["yearFrom"]);
    expect(fields({ ...ok, yearFrom: "999" })).toEqual(["yearFrom"]);
    expect(fields({ ...ok, yearFrom: "2027" })).toEqual(["yearFrom"]);
    expect(fields({ ...ok, yearTo: "1800" })).toEqual(["yearTo"]);
    expect(fields({ ...ok, kind: "krieg!" })).toEqual(["kind"]);
    expect(fields({ ...ok, description: "x".repeat(501) })).toEqual(["description"]);
    expect(fields({ ...ok, region: "x".repeat(121) })).toEqual(["region"]);
  });
});

describe("Schalter (Cookie)", () => {
  it("Standard an, nur „0“ heißt aus", () => {
    expect(historyEnabled(undefined)).toBe(true);
    expect(historyEnabled("")).toBe(true);
    expect(historyEnabled("0")).toBe(false);
    expect(historyCookie(false)).toMatch(/^zeitgeschichte=0;/);
    expect(historyCookie(true)).toMatch(/max-age=0/);
  });
});
