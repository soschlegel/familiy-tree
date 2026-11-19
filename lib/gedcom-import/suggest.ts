/**
 * Vorschläge: Welche Person der Datei könnte eine schon (von Hand) in der App
 * erfasste Person sein? Nur Vorschläge — zusammengeführt wird nie
 * automatisch, der Administrator bestätigt jeden einzeln. Bewertung wie
 * findPossibleDuplicates (lib/services/research.ts): Name, Geburtsjahr,
 * Geburtsort, zusätzlich die Namen der Eltern. Rein, ohne Datenbank.
 */

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

export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const firstGiven = (s: string) => normalizeName(s).split(" ")[0] ?? "";

/** Bewertung eines Paares; null, wenn es nicht in Frage kommt. */
export function scorePair(a: SuggestPerson, b: SuggestPerson, maxYearDiff = 2): Suggestion | null {
  if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) return null;
  if (firstGiven(a.givenName) !== firstGiven(b.givenName) || !firstGiven(a.givenName)) return null;
  const reasons: string[] = [];
  let score = 0;
  const surnamesA = [a.familyName, a.birthName].map(normalizeName).filter(Boolean);
  const surnamesB = [b.familyName, b.birthName].map(normalizeName).filter(Boolean);
  if (surnamesA.some((x) => surnamesB.includes(x))) {
    score += 0.4;
    reasons.push("gleicher Nachname");
  } else if (surnamesA.some((x) => surnamesB.some((y) => levenshtein(x, y) <= 1))) {
    score += 0.3;
    reasons.push("ähnlicher Nachname");
  } else return null;
  if (normalizeName(a.givenName) === normalizeName(b.givenName)) {
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
  if (a.birthPlace && b.birthPlace && normalizeName(a.birthPlace) === normalizeName(b.birthPlace)) {
    score += 0.1;
    reasons.push("gleicher Geburtsort");
  }
  const pa = new Set(a.parentNames.map(normalizeName).filter(Boolean));
  const shared = b.parentNames.map(normalizeName).filter((x) => x && pa.has(x)).length;
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
