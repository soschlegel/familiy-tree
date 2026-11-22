import type { GedcomPlace } from "../gedcom/types";
import { prisma } from "../prisma";
import type { Gazetteer, GeoEntry } from "../places/gazetteer";
import { getGazetteer } from "../places/gazetteer-file";
import { placeKey } from "../places/normalize";

/**
 * Orte im Export (README, „Karte und Orte“ und „Export“).
 *
 * GEDCOM (Entscheidung des Eigentümers, immer ohne Schalter): Für einen
 * zugeordneten Ortstext steht im PLAC die volle HEUTIGE Form „Ort, Region,
 * Land“ ohne Klammer („Wrocław, Niederschlesien, Polen“; Bestandteile aus
 * dem Ortsverzeichnis, Land ausgeschrieben), darunter MAP/LATI/LONG
 * (N/S/E/W) und — wenn er abweicht — der Originaltext als NOTE
 * „Originaltext: …“. Der eigene GEDCOM-Import liest diese NOTE zurück
 * (`originalPlaceText` in lib/gedcom-import/mapping.ts), sodass ein
 * Wiederimport der eigenen Datei den Freitext unverändert lässt.
 * Nicht zugeordnete und „nicht zuordenbare“ Orte bleiben Freitext.
 */

export const ORIGINAL_TEXT_PREFIX = "Originaltext: ";

/** Heutige Form eines Verzeichniseintrags: „Ort, Region, Land“ (ohne Klammer). */
export function presentDayName(gaz: Gazetteer, e: GeoEntry): string {
  const parts = [e.name];
  if (e.kind === "P" && e.a1) {
    const r = gaz.regions.get(`${e.cc}.${e.a1}`);
    if (r !== undefined && gaz.entries[r].name !== e.name) parts.push(gaz.entries[r].name);
  }
  if (e.kind === "P" || e.kind === "A") {
    const c = gaz.countries.get(e.cc);
    if (c !== undefined) parts.push(gaz.entries[c].name);
  }
  return parts.join(", ");
}

const plain = (text: string): GedcomPlace => ({
  name: text,
  parts: text.split(",").map((s) => s.trim()),
  notes: [],
  citations: [],
  extensions: [],
});

/**
 * Liefert eine Funktion Ortstext → GEDCOM-PLAC für die Texte eines Exports
 * (eine Abfrage, das Verzeichnis nur bei Bedarf).
 */
export async function gedcomPlaceResolver(texts: (string | null | undefined)[]): Promise<(text: string) => GedcomPlace> {
  const keys = [...new Set(texts.filter((t): t is string => Boolean(t?.trim())).map(placeKey))];
  const rows = keys.length
    ? await prisma.place.findMany({
        where: { key: { in: keys }, unresolvable: false, latitude: { not: null }, longitude: { not: null } },
        select: { key: true, gazetteerId: true, latitude: true, longitude: true, label: true, text: true },
      })
    : [];
  if (!rows.length) return plain;
  const gaz = rows.some((r) => r.gazetteerId) ? await getGazetteer() : null;
  const byId = new Map<string, GeoEntry>();
  if (gaz) {
    const wanted = new Set(rows.map((r) => r.gazetteerId).filter(Boolean));
    for (const e of gaz.entries) if (wanted.has(e.id)) byId.set(e.id, e);
  }
  const names = new Map<string, { name: string; lat: number; lon: number }>();
  for (const r of rows) {
    const e = r.gazetteerId ? byId.get(r.gazetteerId) : undefined;
    const name = e && gaz ? presentDayName(gaz, e) : (r.label ?? r.text).replace(/\s*\([^)]*\)/g, "").trim();
    names.set(r.key, { name, lat: r.latitude!, lon: r.longitude! });
  }
  return (text: string) => {
    const n = names.get(placeKey(text));
    if (!n) return plain(text);
    const out = { ...plain(n.name), latitude: n.lat, longitude: n.lon };
    if (n.name !== text.trim()) {
      out.notes = [{ content: { text: `${ORIGINAL_TEXT_PREFIX}${text.trim()}`, isHtml: false }, citations: [], extensions: [] }];
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Austauschformat (JSON/ZIP): Zuordnungen zusätzlich zum Freitext
// ---------------------------------------------------------------------------

export type ExchangePlace = {
  text: string;
  source: "AUTO" | "MANUAL" | "AI";
  unresolvable: boolean;
  precision: "PLACE" | "REGION" | "COUNTRY" | null;
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  countryCode: string | null;
  gazetteerId: string | null;
  note?: string | null;
  uncertain?: boolean;
};

/** Zuordnungen der Ortstexte eines Exports. Notizen (Begründungen) nur für Administratoren. */
export async function exchangePlacesFor(texts: (string | null | undefined)[], withNotes: boolean): Promise<ExchangePlace[]> {
  const keys = [...new Set(texts.filter((t): t is string => Boolean(t?.trim())).map(placeKey))];
  if (!keys.length) return [];
  const rows = await prisma.place.findMany({ where: { key: { in: keys } }, orderBy: { key: "asc" } });
  return rows.map((r) => ({
    text: r.text,
    source: r.source,
    unresolvable: r.unresolvable,
    precision: r.precision,
    latitude: r.latitude,
    longitude: r.longitude,
    label: r.label,
    countryCode: r.countryCode,
    gazetteerId: r.gazetteerId,
    ...(withNotes ? { note: r.note, uncertain: r.uncertain } : { uncertain: r.uncertain }),
  }));
}
