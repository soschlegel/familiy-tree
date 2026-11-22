/**
 * Mitgeliefertes Ortsverzeichnis (geo/gazetteer.tsv.gz, erzeugt von
 * scripts/build-geodata.mjs aus GeoNames, CC BY 4.0, und Natural Earth).
 *
 * Reine Datenstruktur und Suche — das Laden von der Platte steht in
 * lib/places/gazetteer-file.ts (nur Server). Kein Dienst im Netz: die
 * Ortsnamen verlassen den Server nie.
 */
import { normalizeForLookup, splitPlaceText } from "./normalize";

/** P Ort, A Region erster Ebene, H historische Landschaft, C Land. */
export type GeoKind = "P" | "A" | "H" | "C";

export type GeoEntry = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** ISO-Ländercode („DE“). */
  cc: string;
  /** Code der Region erster Ebene im Land („06“ = Niedersachsen), leer wenn unbekannt. */
  a1: string;
  pop: number;
  kind: GeoKind;
  /** Deutscher bzw. historischer Name, wenn er sich vom heutigen unterscheidet („Breslau“ zu „Wrocław“). */
  de: string;
};

export type Gazetteer = {
  entries: GeoEntry[];
  /** normalisierter Name (auch weitere Namen) → Einträge */
  byName: Map<string, number[]>;
  /** Region „DE.09“ → Eintrag der Region */
  regions: Map<string, number>;
  /** Land „DE“ → Eintrag des Landes */
  countries: Map<string, number>;
  /** Für die Präfixsuche: [normalisierter Name, Eintrag], sortiert. */
  sorted: { keys: string[]; ids: number[] } | null;
};

/** Liest das Verzeichnis aus dem Text der (entpackten) Datei. */
export function parseGazetteer(text: string): Gazetteer {
  const entries: GeoEntry[] = [];
  const byName = new Map<string, number[]>();
  const regions = new Map<string, number>();
  const countries = new Map<string, number>();
  const addName = (n: string, idx: number) => {
    const k = normalizeForLookup(n);
    if (!k) return;
    const list = byName.get(k);
    if (!list) byName.set(k, [idx]);
    else if (list[list.length - 1] !== idx) list.push(idx);
  };
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c.length < 9) continue;
    const kind = c[8].trim() as GeoKind;
    const entry: GeoEntry = {
      id: c[0],
      name: c[1],
      lat: Number(c[3]),
      lon: Number(c[4]),
      cc: c[5],
      a1: c[6],
      pop: Number(c[7]) || 0,
      kind,
      de: (c[9] ?? "").trim(),
    };
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) continue;
    const idx = entries.length;
    entries.push(entry);
    addName(entry.name, idx);
    if (c[2]) for (const alt of c[2].split(";")) addName(alt, idx);
    if (kind === "A") regions.set(`${entry.cc}.${entry.a1}`, idx);
    if (kind === "C") countries.set(entry.cc, idx);
  }
  return { entries, byName, regions, countries, sorted: null };
}

/** Deutscher Sprachraum: keine Klammer, Bundesland bzw. Kanton im Namen. */
const GERMAN_SPEAKING = new Set(["DE", "AT", "CH"]);

const stripParen = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, " ").trim();

/**
 * Anzeigename (Entscheidung des Eigentümers): heutiger offizieller Name
 * vorn, in Klammern der Name, unter dem der Ort in den Daten steht, sonst
 * der deutsche bzw. historische Name — nur wenn er sich unterscheidet:
 * „Wrocław (Breslau), Polen“, „Gdańsk (Danzig), Polen“, „Timișoara (Temeswar),
 * Rumänien“. Orte im deutschen Sprachraum ohne Klammer, dafür mit
 * Bundesland: „Peine, Niedersachsen, Deutschland“.
 *
 * `dataName`: der Name aus den Daten (ein Teil des Ortstexts); zählt nur,
 * wenn er wirklich ein Name dieses Eintrags ist.
 */
export function entryLabel(gaz: Gazetteer, e: GeoEntry, dataName?: string | null): string {
  let name = e.name;
  if (e.kind !== "C" && !GERMAN_SPEAKING.has(e.cc)) {
    const alt = bracketName(gaz, e, dataName);
    if (alt) name = `${e.name} (${alt})`;
  }
  const parts = [name];
  if (e.kind === "P" && e.a1 && GERMAN_SPEAKING.has(e.cc)) {
    const r = gaz.regions.get(`${e.cc}.${e.a1}`);
    if (r !== undefined && gaz.entries[r].name !== e.name) parts.push(gaz.entries[r].name);
  }
  if (e.kind !== "C") {
    const c = gaz.countries.get(e.cc);
    if (c !== undefined) parts.push(gaz.entries[c].name);
  }
  return parts.join(", ");
}

function bracketName(gaz: Gazetteer, e: GeoEntry, dataName?: string | null): string | null {
  const own = normalizeForLookup(e.name);
  if (dataName) {
    const clean = stripParen(dataName);
    const key = normalizeForLookup(clean);
    if (key && key !== own && (gaz.byName.get(key) ?? []).some((i) => gaz.entries[i] === e)) return clean;
  }
  return e.de && normalizeForLookup(e.de) !== own ? e.de : null;
}

/**
 * Anzeigename für einen Ortstext: der erste Teil des Texts, der ein Name
 * dieses Eintrags ist, kommt in die Klammer („Breslau, Schlesien“ →
 * „Wrocław (Breslau), Polen“).
 */
export function labelForText(gaz: Gazetteer, e: GeoEntry, text: string): string {
  for (const part of splitPlaceText(text)) {
    for (const l of [...part.lookups, ...part.fallbacks]) {
      if ((gaz.byName.get(l) ?? []).some((i) => gaz.entries[i] === e)) return entryLabel(gaz, e, part.raw);
    }
  }
  return entryLabel(gaz, e);
}

function ensureSorted(gaz: Gazetteer) {
  if (gaz.sorted) return gaz.sorted;
  const keys = [...gaz.byName.keys()].sort();
  const ids: number[] = [];
  const flatKeys: string[] = [];
  for (const k of keys) {
    for (const i of gaz.byName.get(k)!) {
      flatKeys.push(k);
      ids.push(i);
    }
  }
  gaz.sorted = { keys: flatKeys, ids };
  return gaz.sorted;
}

const KIND_RANK: Record<GeoKind, number> = { C: 0, A: 1, H: 2, P: 3 };

/**
 * Suche für die Admin-Seite: Namen, die mit der Eingabe beginnen (auch
 * weitere/historische Namen). Genaue Treffer zuerst, dann Länder/Regionen,
 * dann nach Einwohnerzahl.
 */
export function searchGazetteer(gaz: Gazetteer, query: string, limit = 20): (GeoEntry & { label: string })[] {
  const q = normalizeForLookup(query);
  if (q.length < 2) return [];
  const { keys, ids } = ensureSorted(gaz);
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < q) lo = mid + 1;
    else hi = mid;
  }
  const hits = new Map<number, string>();
  for (let i = lo; i < keys.length && keys[i].startsWith(q) && hits.size < 2000; i++) {
    if (!hits.has(ids[i])) hits.set(ids[i], keys[i]);
  }
  return [...hits]
    .map(([idx, key]) => ({ e: gaz.entries[idx], exact: key === q }))
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        (a.e.kind === "P" ? 1 : 0) - (b.e.kind === "P" ? 1 : 0) ||
        KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind] ||
        b.e.pop - a.e.pop ||
        a.e.name.localeCompare(b.e.name, "de"),
    )
    .slice(0, limit)
    .map(({ e }) => ({ ...e, label: entryLabel(gaz, e) }));
}

/** Entfernung in Kilometern (Großkreis). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
