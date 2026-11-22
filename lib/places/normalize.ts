/**
 * Ortstexte normalisieren und zerlegen — reine Funktionen, auch im Browser
 * verwendbar.
 *
 * Zwei verschiedene Normalisierungen:
 * - `placeKey`: Schlüssel der Tabelle Place (nicht zu verwechseln mit
 *   `placeCompareKey` in lib/name-keys.ts, dem Dublettenvergleich). Nur Groß-/Kleinschreibung,
 *   Unicode-Form und Leerzeichen werden vereinheitlicht — „Berkum, Peine“
 *   und „berkum ,  peine“ teilen sich eine Zuordnung, „Vöhrum“ und
 *   „Peine-Vöhrum“ aber nicht (das entscheidet ein Mensch).
 * - `normalizeForLookup`: Vergleich mit dem Ortsverzeichnis, ohne
 *   diakritische Zeichen und Satzzeichen („Timișoara“ = „Timişoara“ = „varias“).
 *   Muss mit `norm` in scripts/build-geodata.mjs übereinstimmen.
 */

export function placeKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

export function normalizeForLookup(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Vorsätze, die eine Verwaltungseinheit bezeichnen und für die Suche
 * wegfallen („Lk Peine“ → „Peine“, „Kreis Ahrweiler“ → „Ahrweiler“).
 */
const DESCRIPTOR_PREFIX =
  /^(?:lk|landkreis|kreis|kr|amt|gemeinde|gem|stadt|stadtkreis|bezirk|bezirksamt|ba|oberamt|oa|regierungsbezirk|rb|reg bez|herrschaft|kirchspiel|pfarrei|county|co|district|parish|gmina|powiat|okres|judet|comitat|komitat|departement|dept|provinz|province|kanton|canton)\s+/;

/** Teile, die nur beschreiben und keinen Ort nennen („Kreisstadt“, „Landkreis“). */
const DESCRIPTOR_ONLY =
  /^(?:kreisstadt|kreisfreie stadt|stadt|landkreis|kreis|gemeinde|ortsteil|stadtteil|ortschaft|dorf|amt|verbandsgemeinde|samtgemeinde|markt|marktgemeinde|kirchspiel|pfarrei|bezirk|county|township|parish|city|town|village|unbekannt|unknown|ort unbekannt)$/;

/** Kennzeichen, dass ein Teil eine Anschrift ist („Lister Meile 12“). */
const ADDRESS = /\d/;

export type PlacePart = {
  /** Wortlaut des Teils (ohne Leerzeichen am Rand). */
  raw: string;
  /** Suchformen, die beste zuerst (normalizeForLookup, ohne Vorsatz/Klammer). */
  lookups: string[];
  /**
   * Nur wenn keine Suchform trifft: Teile eines zusammengesetzten Namens
   * („Peine-Vöhrum“, „Frankfurt/Main“), der spezifischere zuerst.
   */
  fallbacks: string[];
  /** Enthält Ziffern — wird nicht als Ort gesucht, nur mitgezählt. */
  address: boolean;
};

/** Schreibweisen von „Sankt“ angleichen: „St. Andreasberg“ findet „Sankt Andreasberg“. */
function saintVariants(n: string): string[] {
  const out = [n];
  const m = /^(st|sankt|saint|san|santa|sainte|ste)\s+(.+)$/.exec(n);
  if (m) {
    const rest = m[2];
    for (const p of ["sankt", "st", "saint", "san", "sainte"]) {
      const v = `${p} ${rest}`;
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

/**
 * Zerlegt einen Ortstext an Kommas (und Semikolons) in Teile, vom
 * spezifischen zum allgemeinen — so schreiben GEDCOM-Programme Orte:
 * „Berkum, Peine, Lk Peine, Niedersachsen, Germany“.
 */
export function splitPlaceText(text: string): PlacePart[] {
  const parts: PlacePart[] = [];
  for (const piece of text.split(/[,;]/)) {
    const raw = piece.trim();
    if (!raw) continue;
    const lookups: string[] = [];
    const fallbacks: string[] = [];
    const add = (s: string, into = lookups) => {
      const n = normalizeForLookup(s);
      if (!n || DESCRIPTOR_ONLY.test(n)) return;
      for (const v of saintVariants(n)) if (!lookups.includes(v) && !into.includes(v)) into.push(v);
      const stripped = n.replace(DESCRIPTOR_PREFIX, "");
      if (stripped !== n && stripped) for (const v of saintVariants(stripped)) if (!lookups.includes(v) && !into.includes(v)) into.push(v);
    };
    // Postleitzahl vorn („31224 Peine“) ist keine Anschrift.
    const withoutZip = raw.replace(/^\d{4,5}\s+(?=\D)/, "");
    add(withoutZip);
    // Klammerzusatz: erst mit („Halle (Saale)“), dann ohne („Hannover (Amtsgericht)“).
    const noParen = withoutZip.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    if (noParen !== withoutZip) add(noParen);
    // „Peine-Vöhrum“ / „Frankfurt/Main“: zusätzlich der erste Teil.
    const slash = noParen.split("/")[0].trim();
    if (slash !== noParen) add(slash, fallbacks);
    // „Peine-Vöhrum“ (Stadt-Ortsteil): zuletzt die beiden Hälften,
    // die spezifischere (hintere) zuerst.
    const halves = slash.split(/\s*-\s*/);
    if (halves.length === 2 && halves.every((h) => h.length >= 3)) {
      add(halves[1], fallbacks);
      add(halves[0], fallbacks);
    }
    if (lookups.length === 0) continue;
    parts.push({ raw, lookups, fallbacks, address: ADDRESS.test(withoutZip) });
  }
  return parts;
}
