import { placeArea, regionIndex, type AreaLevel, type PlaceArea, type RegionInfo } from "../places/area";
import { getGazetteer } from "../places/gazetteer-file";
import { placeKey } from "../places/normalize";
import { prisma } from "../prisma";

/**
 * Ortstexte → Land bzw. Region (lib/places/area.ts) in einer Abfrage der
 * Tabelle Place. Das Ortsverzeichnis wird nur für die Stufe „Region“ und
 * nur bei Zuordnungen mit Verzeichniskennung geladen.
 *
 * Kein Rechte-Check: Der Aufrufer reicht nur Ortstexte von Angaben, die der
 * Benutzer sehen darf. Heraus kommen nur Länder- bzw. Regionsnamen — keine
 * Koordinaten, keine Zuordnungsnotizen.
 *
 * Ergebnis: placeKey → Gebiet. Leere Texte fehlen; Texte ohne Zuordnung
 * sind `{ kind: "unassigned" }`.
 */
export async function placeAreasFor(
  texts: Iterable<string | null | undefined>,
  level: AreaLevel,
): Promise<Map<string, PlaceArea>> {
  const keys = [...new Set([...texts].filter((t): t is string => Boolean(t?.trim())).map(placeKey))];
  const out = new Map<string, PlaceArea>();
  if (!keys.length) return out;
  const rows = await prisma.place.findMany({
    where: { key: { in: keys } },
    select: { key: true, unresolvable: true, countryCode: true, gazetteerId: true },
  });
  let regions: Map<string, RegionInfo> | undefined;
  if (level === "region") {
    const ids = rows.filter((r) => !r.unresolvable && r.gazetteerId).map((r) => r.gazetteerId!);
    if (ids.length) regions = regionIndex(await getGazetteer(), ids);
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const key of keys) out.set(key, placeArea(byKey.get(key), level, regions));
  return out;
}
