import fs from "node:fs";
import zlib from "node:zlib";

import { GAZETTEER_FILE } from "./gazetteer-file";
import { countryName } from "./area";

/**
 * Regionen erster Ebene aus dem mitgelieferten Ortsverzeichnis — schlank,
 * für die Zeitgeschichte (lib/history/areas.ts) auf viel besuchten Seiten
 * (Personenseite, Karte, Baum). Nur Server.
 *
 * Anders als lib/places/gazetteer-file.ts (rund 1 s, gut 100 MB) liest dieses
 * Modul die Datei nur zeilenweise durch (rund 50 ms) und behält lediglich:
 * - den Katalog der Länder und Regionen (einige tausend Namen, dauerhaft);
 * - je angefragter Verzeichniskennung den Regionsschlüssel („DE.13“) bzw.
 *   „keine Region“ (dauerhaft, höchstens so viele wie Zeilen in Place).
 * Neue Kennungen lösen einen weiteren Durchlauf aus. Regeln wie
 * `regionIndex` in lib/places/area.ts: Ort (P) oder Region (A) mit
 * Regionscode, den es als Region im Verzeichnis gibt.
 */

export type AreaCatalog = {
  /** Land „DE“ → deutscher Name. */
  countries: Map<string, string>;
  /** Region „DE.13“ → Name (deutsch, sonst heutiger). */
  regions: Map<string, string>;
  /** Land → Regionen (nach Name sortiert). */
  regionsByCountry: Map<string, { key: string; name: string }[]>;
};

let catalog: AreaCatalog | null = null;
const regionOfId = new Map<string, string | null>();
let pending: Promise<void> | null = null;

function scan(wanted: Set<string>): void {
  const text = zlib.gunzipSync(fs.readFileSync(GAZETTEER_FILE)).toString("utf8");
  const countries = new Map<string, string>();
  const regions = new Map<string, string>();
  const found = new Map<string, string>();
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    if (text.charCodeAt(start) !== 35 /* # */ && end > start) {
      const c = text.slice(start, end).split("\t");
      if (c.length >= 9) {
        const kind = c[8].trim();
        const cc = c[5];
        if (kind === "C" && /^[A-Z]{2}$/.test(cc)) countries.set(cc, countryName(cc));
        else if (kind === "A" && c[6]) regions.set(`${cc}.${c[6]}`, (c[9] ?? "").trim() || c[1]);
        if (wanted.has(c[0]) && (kind === "P" || kind === "A") && c[6]) found.set(c[0], `${cc}.${c[6]}`);
      }
    }
    start = end + 1;
  }
  for (const id of wanted) {
    const code = found.get(id);
    regionOfId.set(id, code && regions.has(code) ? code : null);
  }
  if (!catalog) {
    const regionsByCountry = new Map<string, { key: string; name: string }[]>();
    for (const [key, name] of regions) {
      const cc = key.slice(0, 2);
      const list = regionsByCountry.get(cc);
      if (list) list.push({ key, name });
      else regionsByCountry.set(cc, [{ key, name }]);
    }
    for (const list of regionsByCountry.values()) list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    catalog = { countries, regions, regionsByCountry };
  }
}

/** Nacheinander, damit parallele Aufrufe die Datei nicht mehrfach lesen. */
async function ensure(wanted: Set<string>): Promise<void> {
  while (pending) await pending;
  const missing = new Set([...wanted].filter((id) => !regionOfId.has(id)));
  if (catalog && missing.size === 0) return;
  pending = Promise.resolve().then(() => scan(missing));
  try {
    await pending;
  } finally {
    pending = null;
  }
}

/** Katalog der Länder und Regionen (einmal gelesen, dann im Speicher). */
export async function areaCatalog(): Promise<AreaCatalog> {
  await ensure(new Set());
  return catalog!;
}

/** Verzeichniskennungen → Regionsschlüssel („DE.13“); Kennungen ohne verlässliche Region fehlen. */
export async function regionKeysOf(gazetteerIds: Iterable<string>): Promise<Map<string, string>> {
  const wanted = new Set(gazetteerIds);
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  await ensure(wanted);
  for (const id of wanted) {
    const code = regionOfId.get(id);
    if (code) out.set(id, code);
  }
  return out;
}

/** Ist der Schlüssel ein bekanntes Land bzw. eine bekannte Region? */
export function isKnownAreaKey(c: AreaCatalog, key: string): boolean {
  return c.countries.has(key) || c.regions.has(key);
}

/** Anzeigename eines Schlüssels: „Sachsen (Deutschland)“, „Deutschland“; unbekannt: der Schlüssel. */
export function areaKeyLabel(c: AreaCatalog, key: string): string {
  const region = c.regions.get(key);
  if (region) return `${region} (${c.countries.get(key.slice(0, 2)) ?? key.slice(0, 2)})`;
  return c.countries.get(key) ?? key;
}
