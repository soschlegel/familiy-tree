/**
 * Automatische Zuordnung eines Ortstexts zu einem Eintrag des
 * Ortsverzeichnisses (README, „Karte und Orte“). Reine Funktion.
 *
 * Regel, vom spezifischen zum allgemeinen Teil:
 * 1. Der letzte Teil ist ein Land („Germany“, „Deutschland“, „USA“)? Dann ist
 *    er der Länderhinweis. Heutige Ländernamen schränken die Suche ein;
 *    historische („Preußen“, „Österreich-Ungarn“) und ein Land zusammen mit
 *    einer historischen Landschaft („Breslau, Schlesien, Germany“) geben nur
 *    einen Vorzug — Breslau liegt heute in Polen.
 * 2. Teile, die eine Region nennen (Bundesland, Bundesstaat, „Schlesien“),
 *    sind Regionshinweis: ein Ort in diesem Land muss in dieser Region liegen.
 * 3. Von vorn nach hinten wird jeder Teil als Ort gesucht (auch unter
 *    weiteren und historischen Namen). Nennt ein späterer Teil ebenfalls
 *    einen Ort („Berkum, Peine“), muss der Kandidat höchstens
 *    ANCHOR_KM von ihm entfernt liegen — sonst ist es ein gleichnamiger Ort
 *    anderswo, und die Suche geht beim nächsten Teil weiter.
 * 4. Kein Ort gefunden: die Region (Genauigkeit „Region“), sonst das Land
 *    („Land“), sonst keine Zuordnung.
 *
 * Unter mehreren gleichnamigen Kandidaten gewinnt der im Hinweisland, sonst
 * nach Heimatvorzug (Deutschland, Österreich/Schweiz, Europa) und Größe
 * zusammen (rank). `ambiguous` zählt die übrigen Kandidaten, die mehr als
 * AMBIGUOUS_KM entfernt liegen und mindestens ein Zehntel so groß sind — die Admin-Seite zeigt sie als „mehrdeutig“.
 */
import { distanceKm, entryLabel, type Gazetteer, type GeoEntry } from "./gazetteer";
import { normalizeForLookup, splitPlaceText, type PlacePart } from "./normalize";

export type MatchPrecision = "PLACE" | "REGION" | "COUNTRY";

export type PlaceMatch = {
  entry: GeoEntry;
  precision: MatchPrecision;
  label: string;
  /** Der Teil des Texts, der getroffen hat. */
  matchedPart: string;
  /** Weitere, weit entfernte Kandidaten gleichen Namens. */
  ambiguous: number;
  /**
   * Die übrigen Kandidaten desselben Teils in Rangfolge (höchstens
   * MAX_OTHERS) — für den Vorschlag an die KI („A, B oder C“).
   */
  others: GeoEntry[];
};

export const MAX_OTHERS = 9;

export const ANCHOR_KM = 50;
export const AMBIGUOUS_KM = 25;
/** Umkreis einer historischen Landschaft um ihre ungefähre Mitte. */
export const HISTORIC_KM = 300;
/** Ab dieser Einwohnerzahl ist ein Name eher die Stadt als die Region („Hamburg“). */
const CITY_OVER_REGION_POP = 10_000;

/** Ländernamen, die nur einen Vorzug geben (Grenzen haben sich geändert). */
const HISTORIC_COUNTRY = new Set(
  [
    "Deutsches Reich", "Preußen", "Preussen", "Prussia", "Königreich Preußen", "Österreich-Ungarn", "Austria-Hungary",
    "Cisleithanien", "Tschechoslowakei", "Czechoslovakia", "Jugoslawien", "Yugoslavia", "Sowjetunion", "UdSSR",
    "USSR", "Soviet Union", "Russisches Reich", "Russian Empire", "Königreich Ungarn", "Böhmen und Mähren",
  ].map(normalizeForLookup),
);

const isEuropeanLocation = (e: GeoEntry) => e.lon >= -25 && e.lon <= 45 && e.lat >= 34 && e.lat <= 72;

function homePreference(e: GeoEntry): number {
  if (e.cc === "DE") return 3;
  if (e.cc === "AT" || e.cc === "CH") return 2;
  return isEuropeanLocation(e) ? 1 : 0;
}

/**
 * Rang ohne Länderhinweis: Heimatvorzug und Größe zusammen — ein Weiler in
 * Deutschland schlägt ein gleich großes Dorf in den Niederlanden („Berkum“),
 * aber nicht die Großstadt, die unter diesem Namen bekannt war („Breslau“).
 */
const rank = (e: GeoEntry) => homePreference(e) * 1.5 + Math.log10(e.pop + 1);

function entriesOf(gaz: Gazetteer, lookups: string[], kinds: string): GeoEntry[] {
  for (const l of lookups) {
    const ids = gaz.byName.get(l);
    if (!ids) continue;
    const list = ids.map((i) => gaz.entries[i]).filter((e) => kinds.includes(e.kind));
    if (list.length) return list;
  }
  return [];
}

type CountryHint = { cc: string; strict: boolean; entry: GeoEntry };
type RegionHint = { entry: GeoEntry; index: number };

export function matchPlace(gaz: Gazetteer, text: string): PlaceMatch | null {
  const parts: PlacePart[] = splitPlaceText(text);
  if (parts.length === 0) return null;
  const result = (entry: GeoEntry, precision: MatchPrecision, part: PlacePart, ambiguous = 0, others: GeoEntry[] = []): PlaceMatch => ({
    entry,
    precision,
    label: entryLabel(gaz, entry, part.raw),
    matchedPart: part.raw,
    ambiguous,
    others,
  });

  // 1. Land im letzten Teil.
  let country: CountryHint | null = null;
  const last = parts[parts.length - 1];
  const countryEntries = entriesOf(gaz, last.lookups, "C");
  if (countryEntries.length) {
    const entry = countryEntries[0];
    if (parts.length === 1) {
      // Nur ein Teil: eine große gleichnamige Stadt im selben Land geht vor
      // („Luxemburg“, „Singapur“).
      const city = entriesOf(gaz, last.lookups, "P").filter((e) => e.cc === entry.cc && e.pop >= 50_000);
      if (city.length) return result(city.sort((a, b) => b.pop - a.pop)[0], "PLACE", last);
      return result(entry, "COUNTRY", last);
    }
    country = { cc: entry.cc, strict: !HISTORIC_COUNTRY.has(last.lookups[0]), entry };
    parts.pop();
  }

  // 2. Regionen (Bundesland, Bundesstaat, historische Landschaft).
  const regionAt = new Map<number, GeoEntry>();
  parts.forEach((part, i) => {
    if (part.address) return;
    const list = entriesOf(gaz, part.lookups, "AH")
      .filter((e) => !country || e.kind === "H" || e.cc === country.cc)
      // Historische Landschaft vor heutiger Verwaltungseinheit gleichen
      // Namens: „Schlesien“ meint in alten Angaben das ganze Schlesien, nicht
      // die Woiwodschaft.
      .sort((a, b) => Number(b.kind === "H") - Number(a.kind === "H"));
    if (!list.length) return;
    // Hinter dem ersten Teil ist ein Regionsname (nicht die von Hand gepflegten
    // historischen Landschaften), der auch eine größere Stadt ist
    // („Altona, Hamburg“, „Diez, Limburg“), ein Ort und kein Regionshinweis.
    const city = entriesOf(gaz, part.lookups, "P").some(
      (e) =>
        e.pop >= CITY_OVER_REGION_POP &&
        (country ? e.cc === country.cc : e.cc === list[0].cc || isEuropeanLocation(e)),
    );
    if (i > 0 && city && list[0].kind === "A") return;
    regionAt.set(i, list[0]);
  });
  // Eine historische Landschaft lockert den Länderhinweis.
  if (country && [...regionAt.values()].some((e) => e.kind === "H")) country.strict = false;
  // Regionshinweis: die spezifischste Region erster Ebene (A) hinter Teil 0.
  let region: RegionHint | null = null;
  for (const [index, entry] of [...regionAt].sort((a, b) => a[0] - b[0])) {
    if (entry.kind === "A" && (index > 0 || parts.length === 1)) {
      region = { entry, index };
      break;
    }
  }

  const historic: RegionHint[] = [...regionAt]
    .filter(([, e]) => e.kind === "H")
    .map(([index, entry]) => ({ index, entry }));

  const filterCandidates = (list: GeoEntry[]): GeoEntry[] => {
    let out = list;
    // Heutiges Land: nur dort. Historisches Land: kein Filter, nur Vorzug
    // beim Sortieren (die Grenzen lagen anders).
    if (country?.strict) out = out.filter((e) => e.cc === country.cc);
    if (region) {
      const r = region.entry;
      out = out.filter((e) => e.cc !== r.cc || e.a1 === r.a1);
      if (country?.strict || !country) out = out.filter((e) => e.cc === r.cc);
    }
    return out;
  };
  const placeCandidates = (i: number): GeoEntry[] => {
    const part = parts[i];
    if (part.address) return [];
    let list = filterCandidates(entriesOf(gaz, part.lookups, "P"));
    if (!list.length && !regionAt.has(i)) list = filterCandidates(entriesOf(gaz, part.fallbacks, "P"));
    return list;
  };

  // 3. Orte, vom spezifischen zum allgemeinen Teil.
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const reg = regionAt.get(i);
    // Spätere Teile, die eine Region nennen, sind keine Orte.
    if (reg && i > 0) continue;
    let cands = placeCandidates(i);
    // Erster Teil, der auch eine Region ist: nur eine größere Stadt unter
    // ihrem Hauptnamen geht vor („Hamburg“, aber nicht „Ostpreußen“ als
    // weiterer Name eines Städtchens).
    if (reg && i === 0) {
      cands = cands.filter((e) => e.pop >= CITY_OVER_REGION_POP && part.lookups.includes(normalizeForLookup(e.name)));
    }
    // Historische Landschaft dahinter: Kandidaten in ihrer Nähe bevorzugen
    // („Königsberg, Ostpreußen“ ist Kaliningrad, nicht Königsberg in Bayern).
    for (const h of historic) {
      if (h.index <= i) continue;
      const near = cands.filter((c) => distanceKm(c, h.entry) <= HISTORIC_KM);
      if (near.length) cands = near;
    }
    if (!cands.length) continue;

    // Anker: der nächste spätere Teil, der ebenfalls einen Ort nennt.
    for (let j = i + 1; j < parts.length; j++) {
      if (regionAt.has(j)) continue;
      const anchors = placeCandidates(j);
      if (!anchors.length) continue;
      cands = cands.filter((c) => anchors.some((a) => distanceKm(a, c) <= ANCHOR_KM));
      break;
    }
    if (!cands.length) continue;

    const sorted = [...cands].sort(
      (a, b) =>
        Number(b.cc === country?.cc) - Number(a.cc === country?.cc) ||
        rank(b) - rank(a) ||
        a.id.localeCompare(b.id),
    );
    const best = sorted[0];
    // Mehrdeutig nur, wenn ein entfernter Kandidat ähnlich bedeutend ist — ein
    // Weiler gleichen Namens macht Göttingen nicht zweifelhaft.
    const ambiguous = cands.filter(
      (c) => c !== best && distanceKm(c, best) > AMBIGUOUS_KM && (best.pop === 0 || c.pop * 10 >= best.pop),
    ).length;
    return result(best, "PLACE", part, ambiguous, sorted.slice(1, 1 + MAX_OTHERS));
  }

  // 4. Region, dann Land.
  const firstRegion = [...regionAt].sort((a, b) => a[0] - b[0])[0];
  if (firstRegion) return result(firstRegion[1], "REGION", parts[firstRegion[0]]);
  if (country) return result(country.entry, "COUNTRY", last);
  return null;
}
