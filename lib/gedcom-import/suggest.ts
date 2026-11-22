/**
 * Vorschläge: Welche Person der Datei könnte eine schon (von Hand) in der App
 * erfasste Person sein? Nur Vorschläge — zusammengeführt wird nie
 * automatisch, der Administrator bestätigt jeden einzeln. Bewertung wie
 * findPossibleDuplicates (lib/services/research.ts): Name, Geburtsjahr,
 * Geburtsort, zusätzlich die Namen der Eltern. Rein, ohne Datenbank.
 */

import { editDistance } from "../name-keys";

export type SuggestPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: string;
  birthYear: number | null;
  birthPlace: string | null;
  /** Nachnamen/Vornamen der Eltern (normalisiert verglichen). */
  parentNames: string[];
};

export type Suggestion = { personId: string; score: number; reasons: string[] };

/**
 * Vergleichsform für die Vorschläge. Bewusst NICHT `nameKey` aus
 * lib/name-keys.ts: diese Form faltet Umlaute zu „u“ statt „ue“, lässt
 * ph/th und Doppelbuchstaben stehen und behält Ziffern — ein Umstieg würde
 * andere Vorschläge liefern (z.B. „Müller“ = „Muller“ hier, dort nicht).
 */
function suggestKey(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const firstGiven = (s: string) => suggestKey(s).split(" ")[0] ?? "";

/** Bewertung eines Paares; null, wenn es nicht in Frage kommt. */
export function scorePair(a: SuggestPerson, b: SuggestPerson, maxYearDiff = 2): Suggestion | null {
  if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) return null;
  if (firstGiven(a.givenName) !== firstGiven(b.givenName) || !firstGiven(a.givenName)) return null;
  const reasons: string[] = [];
  let score = 0;
  const surnamesA = [a.familyName, a.birthName].map(suggestKey).filter(Boolean);
  const surnamesB = [b.familyName, b.birthName].map(suggestKey).filter(Boolean);
  if (surnamesA.some((x) => surnamesB.includes(x))) {
    score += 0.4;
    reasons.push("gleicher Nachname");
  } else if (surnamesA.some((x) => surnamesB.some((y) => editDistance(x, y) <= 1))) {
    score += 0.3;
    reasons.push("ähnlicher Nachname");
  } else return null;
  if (suggestKey(a.givenName) === suggestKey(b.givenName)) {
    score += 0.2;
    reasons.push("gleicher Vorname");
  } else {
    score += 0.1;
    reasons.push("ähnlicher Vorname");
  }
  if (a.birthYear !== null && b.birthYear !== null) {
    const diff = Math.abs(a.birthYear - b.birthYear);
    if (diff > maxYearDiff) return null;
    score += diff === 0 ? 0.3 : 0.2;
    reasons.push(diff === 0 ? `gleiches Geburtsjahr (${a.birthYear})` : `Geburtsjahre ${a.birthYear} / ${b.birthYear}`);
  } else if (a.birthYear === null && b.birthYear === null) {
    score += 0;
  } else {
    score += 0.05;
    reasons.push("Geburtsjahr nur bei einer Person bekannt");
  }
  if (a.birthPlace && b.birthPlace && suggestKey(a.birthPlace) === suggestKey(b.birthPlace)) {
    score += 0.1;
    reasons.push("gleicher Geburtsort");
  }
  const pa = new Set(a.parentNames.map(suggestKey).filter(Boolean));
  const shared = b.parentNames.map(suggestKey).filter((x) => x && pa.has(x)).length;
  if (shared > 0) {
    score += 0.15 * Math.min(2, shared);
    reasons.push(shared > 1 ? "gleiche Eltern" : "ein Elternteil gleich");
  }
  return { personId: b.id, score: Math.min(1, Math.round(score * 100) / 100), reasons };
}

/**
 * Für jede Dateiperson die besten Kandidaten aus der App (Schwelle 0.6,
 * höchstens `limit` je Person). Gruppiert nach erstem Vornamen — vergleicht
 * nur, was überhaupt in Frage kommt.
 */
export function suggestMatches(
  fromFile: SuggestPerson[],
  inApp: SuggestPerson[],
  options: { threshold?: number; limit?: number } = {},
): Map<string, Suggestion[]> {
  const threshold = options.threshold ?? 0.6;
  const limit = options.limit ?? 3;
  const byGiven = new Map<string, SuggestPerson[]>();
  for (const p of inApp) {
    const k = firstGiven(p.givenName);
    if (!k) continue;
    const list = byGiven.get(k);
    if (list) list.push(p);
    else byGiven.set(k, [p]);
  }
  const out = new Map<string, Suggestion[]>();
  for (const f of fromFile) {
    const candidates = byGiven.get(firstGiven(f.givenName)) ?? [];
    const found = candidates
      .map((c) => scorePair(f, c))
      .filter((s): s is Suggestion => s !== null && s.score >= threshold)
      .sort((x, y) => y.score - x.score || x.personId.localeCompare(y.personId))
      .slice(0, limit);
    if (found.length) out.set(f.id, found);
  }
  return out;
}
