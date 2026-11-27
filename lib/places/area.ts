/**
 * Ort → Land bzw. Region (Gebiet) aus der vorhandenen Ortszuordnung
 * (Tabelle Place). Rein, auch im Browser lauffähig — das Ortsverzeichnis
 * wird nur übergeben, nicht geladen (das macht lib/services/place-areas.ts).
 *
 * Zwei Stufen:
 * - **Land:** `countryCode` der Zuordnung, Name deutsch über
 *   `Intl.DisplayNames` („DE“ → „Deutschland“).
 * - **Region:** Region erster Ebene (Bundesland, Woiwodschaft, Provinz …)
 *   aus dem Ortsverzeichnis über `gazetteerId` → Eintrag → Regionscode
 *   (`cc.a1`). Bewusst NICHT aus dem Anzeigenamen `label` gelesen: der nennt
 *   die Region nur im deutschen Sprachraum, lässt sie bei Stadtstaaten weg
 *   („Bremen, Deutschland“) und ist bei von Hand bestätigten bzw. eigenen
 *   Orten frei formuliert. Ohne verlässliche Region (eigene Koordinaten,
 *   Zuordnung nur auf ein Land, historische Landschaft, Eintrag nicht mehr
 *   im Verzeichnis) steht das Land mit dem Zusatz „ohne Region“.
 *
 * Nicht zugeordnet ist ein Ort ohne Zeile in Place („offen“), mit „nicht
 * zuordenbar“ oder ohne Ländercode. „Unsicher“ gesetzte Zuordnungen zählen
 * wie sichere.
 */
import type { Gazetteer } from "./gazetteer";

export type AreaLevel = "country" | "region";

/** Ausschnitt einer Zeile der Tabelle Place, der für das Gebiet zählt. */
export type PlaceAreaRow = {
  unresolvable: boolean;
  countryCode: string | null;
  gazetteerId: string | null;
};

/** Region erster Ebene eines Verzeichniseintrags. */
export type RegionInfo = { code: string; name: string };

export type PlaceArea =
  | { kind: "area"; key: string; label: string; countryCode: string }
  | { kind: "unassigned" };

let displayNames: Intl.DisplayNames | null | undefined;

/** Deutscher Name eines Landes zum ISO-Code; unbekannte Codes bleiben, wie sie sind. */
export function countryName(code: string): string {
  const cc = code.trim().toUpperCase();
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["de"], { type: "region", fallback: "code" });
    } catch {
      displayNames = null;
    }
  }
  if (!displayNames || !/^[A-Z]{2}$/.test(cc)) return cc;
  try {
    return displayNames.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/**
 * Regionen zu Kennungen des Ortsverzeichnisses: Eintrag einer Stadt (P) oder
 * einer Region (A) mit Regionscode → Code „DE.06“ und Name (deutscher Name
 * des Verzeichnisses, sonst der heutige: „Niedersachsen“, „Niederschlesien“).
 * Kennungen ohne verlässliche Region fehlen in der Antwort.
 */
export function regionIndex(gaz: Gazetteer, gazetteerIds: Iterable<string>): Map<string, RegionInfo> {
  const wanted = new Set(gazetteerIds);
  const out = new Map<string, RegionInfo>();
  if (!wanted.size) return out;
  for (const e of gaz.entries) {
    if (!wanted.has(e.id) || out.has(e.id)) continue;
    if ((e.kind !== "P" && e.kind !== "A") || !e.a1) continue;
    const code = `${e.cc}.${e.a1}`;
    const r = gaz.regions.get(code);
    if (r === undefined) continue;
    const region = gaz.entries[r];
    out.set(e.id, { code, name: region.de || region.name });
  }
  return out;
}

/**
 * Gebiet einer Zuordnung. `regions` (aus `regionIndex`) braucht nur die
 * Stufe „Region“; fehlt dort die Kennung, gilt „Land (ohne Region)“.
 */
export function placeArea(
  row: PlaceAreaRow | null | undefined,
  level: AreaLevel,
  regions?: ReadonlyMap<string, RegionInfo>,
): PlaceArea {
  if (!row || row.unresolvable || !row.countryCode?.trim()) return { kind: "unassigned" };
  const cc = row.countryCode.trim().toUpperCase();
  const country = countryName(cc);
  if (level === "country") return { kind: "area", key: cc, label: country, countryCode: cc };
  const region = row.gazetteerId ? regions?.get(row.gazetteerId) : undefined;
  // Die Region gehört zum Land der Zuordnung; weicht es ab (von Hand
  // geändert), lieber „ohne Region“ als eine falsche Region.
  if (region && region.code.startsWith(`${cc}.`)) {
    return { kind: "area", key: region.code, label: `${region.name}, ${country}`, countryCode: cc };
  }
  return { kind: "area", key: `${cc}.?`, label: `${country} (ohne Region)`, countryCode: cc };
}
