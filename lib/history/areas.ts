/**
 * Geltungsbereich der Zeitgeschichte („regionaler Bezug“): Für welche
 * Gebiete gilt ein Ereignis, und passt es zu den Orten, an denen eine Person
 * zur Zeit des Ereignisses lebte? Reine Funktionen ohne Datenbank — auch im
 * Browser lauffähig (Karte, Zeitstrahl, Verwaltung).
 *
 * Gebiete sind dieselben Schlüssel wie bei lib/places/area.ts:
 * - **Land:** ISO-Ländercode wie `Place.countryCode` („DE“, „AT“).
 * - **Region:** Region erster Ebene aus dem Ortsverzeichnis, „Land.Code“
 *   („DE.13“ = Sachsen, „PL.72“ = Niederschlesien).
 * Ein leerer Bereich heißt „überall“ (kein regionaler Bezug). Historische
 * Gebilde (DDR, Preußen, Habsburgermonarchie …) werden als benannte Gruppen
 * heutiger Länder bzw. Regionen ausgedrückt (`HISTORY_AREA_GROUPS`) — heutige
 * Grenzen sind eine bewusste Vereinfachung. Gespeichert werden immer die
 * einzelnen Schlüssel; eine Gruppe ist nur eine Eingabehilfe
 * (`group:<kennung>`), `compactAreas` fasst für die Anzeige wieder zusammen.
 *
 * Passung (`matchArea`) in Stufen, Reihenfolge der Anzeige danach:
 * 1. „place“ — der Bereich nennt genau die Region der Person;
 * 2. „country“ — der Bereich nennt das Land der Person als Ganzes (eine
 *    andere Region desselben Landes zählt NICHT);
 * 3. „neutral“ — Ereignis „überall“; ebenso, wenn von der Person nur das
 *    Land bekannt ist und der Bereich nur einzelne Regionen dieses Landes
 *    nennt (unklar, ob sie dort lebte);
 * 4. „foreign“ — passt nicht.
 * Ohne einen zugeordneten Ort der Person ist alles „neutral“.
 */

/** Stufe der Passung — Reihenfolge: place vor country vor neutral vor foreign. */
export type AreaMatch = "place" | "country" | "neutral" | "foreign";

export const AREA_MATCH_ORDER: Record<AreaMatch, number> = { place: 0, country: 1, neutral: 2, foreign: 3 };

/** Gebiet eines Orts der Person: Land und — wenn bekannt — Region („DE.13“). */
export type AreaOfPlace = {
  country: string;
  region: string | null;
  /** Anzeigename der Region („Sachsen“), nur für den dezenten Bezug im Lebenslauf. */
  regionName?: string | null;
};

export const COUNTRY_KEY = /^[A-Z]{2}$/;
export const REGION_KEY = /^[A-Z]{2}\.[A-Z0-9]{1,4}$/;
export const GROUP_PREFIX = "group:";

/** Höchstzahl der Schlüssel eines Bereichs. */
export const MAX_AREA_KEYS = 120;

export const isCountryKey = (k: string) => COUNTRY_KEY.test(k);
export const isRegionKey = (k: string) => REGION_KEY.test(k);
export const isAreaKey = (k: string) => isCountryKey(k) || isRegionKey(k);
export const countryOfKey = (k: string) => k.slice(0, 2);

export type HistoryAreaGroup = {
  /** Kennung ohne Präfix („ostdeutschland“); Eingabe als `group:ostdeutschland`. */
  id: string;
  label: string;
  /** Kurze Erläuterung der Vereinfachung. */
  note: string;
  keys: readonly string[];
};

const range = (cc: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${cc}.${String(from + i).padStart(2, "0")}`);

const EUROPE = [
  "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR",
  "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS",
  "RU", "SE", "SI", "SK", "SM", "UA", "VA", "XK",
];

/**
 * Benannte Gruppen — Schnellwahl in der Verwaltung und für die KI
 * (list_history_areas). Nur heutige Länder bzw. Regionen erster Ebene; die
 * Grenzen früherer Staaten lassen sich damit nur grob nachzeichnen.
 */
export const HISTORY_AREA_GROUPS: readonly HistoryAreaGroup[] = [
  {
    id: "ostdeutschland",
    label: "Ostdeutschland (Gebiet der DDR)",
    note: "Die fünf östlichen Länder und ganz Berlin.",
    keys: range("DE", 11, 16),
  },
  {
    id: "westdeutschland",
    label: "Westdeutschland (alte Bundesrepublik)",
    note: "Die zehn westlichen Länder, ohne Berlin.",
    keys: range("DE", 1, 10),
  },
  {
    id: "deutscher-sprachraum",
    label: "Deutschland, Österreich, Schweiz",
    note: "Mit Liechtenstein.",
    keys: ["AT", "CH", "DE", "LI"],
  },
  {
    id: "deutsche-staaten",
    label: "Deutsche Staaten (Heiliges Römisches Reich, Deutscher Bund)",
    note: "Grob nach heutigen Ländern: Deutschland, Österreich, Tschechien, Luxemburg, Liechtenstein.",
    keys: ["AT", "CZ", "DE", "LI", "LU"],
  },
  {
    id: "preussen",
    label: "Preußen (um 1900)",
    note:
      "Grob nach heutigen Regionen: die meisten nord- und westdeutschen Länder, die früheren Ostprovinzen im heutigen " +
      "Polen, das Gebiet um Kaliningrad und um Klaipėda. Teile von Hessen, Rheinland-Pfalz und Niedersachsen gehörten nicht dazu.",
    keys: [
      "DE.05", "DE.06", "DE.07", "DE.08", "DE.10", "DE.11", "DE.12", "DE.14", "DE.16",
      "PL.72", "PL.73", "PL.76", "PL.79", "PL.82", "PL.83", "PL.85", "PL.86", "PL.87",
      "RU.23", "LT.58",
    ],
  },
  {
    id: "habsburg",
    label: "Habsburgermonarchie (Österreich-Ungarn)",
    note:
      "Kernländer nach heutigen Grenzen: Österreich, Tschechien, Slowakei, Ungarn, Slowenien, Kroatien, Bosnien und " +
      "Herzegowina sowie Kleinpolen und das Karpatenvorland. Ohne Ostgalizien, Bukowina, Siebenbürgen, Banat und Südtirol.",
    keys: ["AT", "BA", "CZ", "HR", "HU", "PL.77", "PL.80", "SI", "SK"],
  },
  {
    id: "ostmitteleuropa",
    label: "Ostmitteleuropa mit den früheren deutschen Ostgebieten",
    note: "Polen, Tschechien, Slowakei, Ungarn, Rumänien, Serbien, das Gebiet um Kaliningrad und um Klaipėda.",
    keys: ["CZ", "HU", "LT.58", "PL", "RO", "RS", "RU.23", "SK"],
  },
  {
    id: "mitteleuropa",
    label: "Mitteleuropa",
    note: "Deutschland, Österreich, Schweiz, Liechtenstein, Luxemburg, Polen, Tschechien, Slowakei, Ungarn, Slowenien.",
    keys: ["AT", "CH", "CZ", "DE", "HU", "LI", "LU", "PL", "SI", "SK"],
  },
  {
    id: "europa",
    label: "Europa",
    note: "Alle Länder Europas einschließlich Russland und der Ukraine, ohne die Türkei.",
    keys: EUROPE,
  },
];

const GROUP_BY_ID = new Map(HISTORY_AREA_GROUPS.map((g) => [g.id, g]));

export const historyAreaGroup = (id: string): HistoryAreaGroup | undefined =>
  GROUP_BY_ID.get(id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : id);

/** Sortierung: nach Land, das Land selbst vor seinen Regionen. */
export function sortAreaKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Eingabe eines Bereichs vereinheitlichen: Schlüssel groß geschrieben,
 * Gruppen (`group:<kennung>`) aufgelöst, doppelte entfernt, sortiert.
 * `invalid` nennt Einträge, die weder Schlüssel noch bekannte Gruppe sind.
 */
export function expandAreaInput(list: readonly unknown[]): { keys: string[]; invalid: string[] } {
  const keys: string[] = [];
  const invalid: string[] = [];
  for (const raw of list) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      invalid.push(String(raw));
      continue;
    }
    if (text.toLowerCase().startsWith(GROUP_PREFIX)) {
      const g = historyAreaGroup(text.toLowerCase());
      if (g) keys.push(...g.keys);
      else invalid.push(text);
      continue;
    }
    const key = text.toUpperCase();
    if (isAreaKey(key)) keys.push(key);
    else invalid.push(text);
  }
  return { keys: sortAreaKeys(keys), invalid };
}

/**
 * Für die Anzeige zusammenfassen: Sind alle Schlüssel einer Gruppe
 * enthalten, steht dafür `group:<kennung>` (größte Gruppen zuerst); der Rest
 * bleibt einzeln. Ergebnis: Gruppen vorn, dann die Schlüssel sortiert.
 */
export function compactAreas(keys: readonly string[]): string[] {
  const rest = new Set(keys);
  const groups: string[] = [];
  const bySize = [...HISTORY_AREA_GROUPS].sort((a, b) => b.keys.length - a.keys.length);
  for (const g of bySize) {
    if (g.keys.every((k) => rest.has(k))) {
      groups.push(`${GROUP_PREFIX}${g.id}`);
      for (const k of g.keys) rest.delete(k);
    }
  }
  return [...groups, ...sortAreaKeys(rest)];
}

// ---------------------------------------------------------------------------
// Passung
// ---------------------------------------------------------------------------

/** Passung eines Bereichs zu EINEM Ort (siehe Kopfkommentar). */
export function matchArea(areas: readonly string[] | ReadonlySet<string>, at: AreaOfPlace): AreaMatch {
  const set = areas instanceof Set ? areas : new Set(areas as readonly string[]);
  if (set.size === 0) return "neutral";
  if (at.region && set.has(at.region)) return "place";
  if (set.has(at.country)) return "country";
  if (!at.region) {
    const prefix = `${at.country}.`;
    for (const k of set) if (k.startsWith(prefix)) return "neutral";
  }
  return "foreign";
}

/**
 * Beste Passung über mehrere Orte (z.B. mehrere Stationen im Zeitraum) und
 * der Ort, der sie liefert. Ohne Orte: „neutral“.
 */
export function bestMatch(
  areas: readonly string[] | ReadonlySet<string>,
  ats: readonly AreaOfPlace[],
): { match: AreaMatch; at: AreaOfPlace | null } {
  if (ats.length === 0) return { match: "neutral", at: null };
  const set = areas instanceof Set ? areas : new Set(areas as readonly string[]);
  let best: { match: AreaMatch; at: AreaOfPlace | null } = { match: "foreign", at: null };
  for (const at of ats) {
    const m = matchArea(set, at);
    if (AREA_MATCH_ORDER[m] < AREA_MATCH_ORDER[best.match]) best = { match: m, at };
    if (m === "place") break;
  }
  return best;
}

/** Ein Ort eines Lebens mit Jahr — chronologisch geordnet (lib/history/lifetime.ts baut die Liste). */
export type TimedArea = {
  /** Jahr der Station; -Infinity für eine Geburt ohne Datum, Infinity für Tod/Beerdigung ohne Datum. */
  year: number;
  area: AreaOfPlace;
};

/**
 * Orte zur Zeit eines Ereignisses [from, to] (Entscheidung des Eigentümers):
 * die letzte Station bis einschließlich `from` (dort lebte die Person bei
 * Beginn) und jede Station im Zeitraum (Umzug während eines Kriegs …). Gibt
 * es vor dem Ereignis keine Station, zählt die früheste bekannte. Ohne
 * Stationen: leer.
 */
export function areasAtTime(stations: readonly TimedArea[], from: number, to: number): AreaOfPlace[] {
  if (stations.length === 0) return [];
  let last = -1;
  const inside: AreaOfPlace[] = [];
  stations.forEach((s, i) => {
    if (s.year <= from) last = i;
    else if (s.year <= to) inside.push(s.area);
  });
  return [last >= 0 ? stations[last].area : stations[0].area, ...inside];
}

/** Gebiet aus einem Schlüssel der Karte („DE.13“ bzw. „DE“). */
export function areaOfKey(key: string): AreaOfPlace {
  return isRegionKey(key) ? { country: countryOfKey(key), region: key } : { country: key, region: null };
}
