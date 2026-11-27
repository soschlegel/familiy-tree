import { GROUP_PREFIX, HISTORY_AREA_GROUPS, type AreaOfPlace } from "../history/areas";
import { placeKey } from "../places/normalize";
import { areaCatalog, areaKeyLabel, isKnownAreaKey, regionKeysOf } from "../places/region-codes";
import { prisma } from "../prisma";
import { validationError } from "./errors";

/**
 * Geltungsbereich der Zeitgeschichte — Daten aus Ortszuordnung und
 * Ortsverzeichnis (die reinen Regeln: lib/history/areas.ts).
 *
 * - `placeAreasOf`: Ortstexte → Gebiet (Land, Region) in EINER Abfrage der
 *   Tabelle Place; die Region kommt schlank aus lib/places/region-codes.ts.
 *   Kein Rechte-Check: Der Aufrufer reicht nur Ortstexte, die der Benutzer
 *   sehen darf; heraus kommen nur Länder- und Regionsschlüssel.
 * - `historyAreaLegend`: Gruppen und (zu einem Land) dessen Regionen mit
 *   Schlüsseln — für die KI (list_history_areas) und die Verwaltung.
 * - `knownAreaCheck`: Prüffunktion für checkHistoryInput (Schlüssel muss im
 *   Ortsverzeichnis stehen).
 */

/** Ortstexte → Gebiet; nicht zugeordnete Texte (offen, nicht zuordenbar, ohne Land) fehlen. */
export async function placeAreasOf(texts: Iterable<string | null | undefined>): Promise<Map<string, AreaOfPlace>> {
  const keys = [...new Set([...texts].filter((t): t is string => Boolean(t?.trim())).map(placeKey))];
  const out = new Map<string, AreaOfPlace>();
  if (keys.length === 0) return out;
  const rows = await prisma.place.findMany({
    where: { key: { in: keys }, unresolvable: false, countryCode: { not: null } },
    select: { key: true, countryCode: true, gazetteerId: true },
  });
  if (rows.length === 0) return out;
  const ids = rows.filter((r) => r.gazetteerId).map((r) => r.gazetteerId!);
  const [regions, catalog] = await Promise.all([regionKeysOf(ids), areaCatalog()]);
  for (const r of rows) {
    const cc = r.countryCode!.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const region = r.gazetteerId ? regions.get(r.gazetteerId) : undefined;
    // Wie lib/places/area.ts: Die Region gehört zum Land der Zuordnung, sonst lieber keine.
    const ok = region && region.startsWith(`${cc}.`) ? region : null;
    out.set(r.key, { country: cc, region: ok, regionName: ok ? (catalog.regions.get(ok) ?? null) : null });
  }
  return out;
}

/** Gebiet als kurzer Schlüssel für die Karte: Region („DE.13“), sonst Land („DE“). */
export const areaKeyOf = (a: AreaOfPlace): string => a.region ?? a.country;

/** Prüffunktion für checkHistoryInput. */
export async function knownAreaCheck(): Promise<(key: string) => boolean> {
  const c = await areaCatalog();
  return (key) => isKnownAreaKey(c, key);
}

export type HistoryAreaGroupDto = { key: string; label: string; note: string; areas: string[] };

export type HistoryAreaLegend = {
  groups: HistoryAreaGroupDto[];
  country?: { key: string; name: string; regions: { key: string; name: string }[] };
};

/** Gruppen und — zu einem Land — dessen Regionen mit Schlüsseln. Unbekanntes Land → VALIDATION. */
export async function historyAreaLegend(country?: string | null): Promise<HistoryAreaLegend> {
  const groups = HISTORY_AREA_GROUPS.map((g) => ({ key: `${GROUP_PREFIX}${g.id}`, label: g.label, note: g.note, areas: [...g.keys] }));
  if (!country?.trim()) return { groups };
  const c = await areaCatalog();
  const cc = country.trim().toUpperCase();
  const name = c.countries.get(cc);
  if (!name) throw validationError([{ path: "country", message: `Unbekanntes Land „${country.trim()}“ — bitte den ISO-Ländercode angeben (z.B. DE, AT, PL).` }]);
  return { groups, country: { key: cc, name, regions: c.regionsByCountry.get(cc) ?? [] } };
}

/**
 * Für die Verwaltungsseite: alle Länder (Name, Schlüssel) und die Namen der
 * Schlüssel, die in Gruppen und vorhandenen Bereichen vorkommen.
 */
export async function historyAreaAdminCatalog(usedKeys: Iterable<string>): Promise<{
  countries: { key: string; name: string }[];
  labels: Record<string, string>;
}> {
  const c = await areaCatalog();
  const keys = new Set<string>(usedKeys);
  for (const g of HISTORY_AREA_GROUPS) for (const k of g.keys) keys.add(k);
  const labels: Record<string, string> = {};
  for (const k of keys) labels[k] = areaKeyLabel(c, k);
  const countries = [...c.countries].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { countries, labels };
}
