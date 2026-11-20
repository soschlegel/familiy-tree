/**
 * Erkennung möglicher Dubletten — rein, ohne Datenbank, gemeinsam für die
 * Recherche-Seite (lib/services/duplicates.ts), die Importvorschläge und das
 * Zusammenlegen von Bäumen. Verglichen werden nur Personen mit gleichem
 * (erstem) Vornamen in Vergleichsform (auch aus Namensvarianten) — so bleibt
 * es bei einigen tausend Personen schnell (kein Vergleich aller Paare).
 *
 * ## Signale (Punkte, gedeckelt bei 1)
 * - Vorname: ganz gleich +0,2; einer hat einen Vornamen mehr („Anna“ /
 *   „Anna Maria“) +0,15; nur der erste gleich +0,05 und höchstens „unklar“.
 *   Ein gemeinsamer erster Vorname ist Pflicht.
 * - Nachname: gleicher Nachname +0,35; Nachname der einen = Geburtsname bzw.
 *   Namensvariante der anderen +0,3 (Ehe- und Geburtsname); ähnliche
 *   Schreibweise +0,25; sonst kein Kandidat.
 * - Geburt: gleiches tagesgenaues Datum +0,3; vereinbar („um 1760“ und
 *   „12.03.1760“) +0,25; Jahre höchstens `maxYearDiff` auseinander +0,15;
 *   weiter auseinander → kein Kandidat; nur bei einer bekannt +0,03.
 * - Tod: gleich +0,15, vereinbar +0,1; sicher verschieden (mehr als zwei Jahre)
 *   −0,4 und Widerspruch.
 * - Orte: gleicher Geburtsort +0,1.
 * - Verwandte: dieselben eingetragenen Eltern +0,3 (Dublette innerhalb eines
 *   Baums), Eltern gleichen Namens +0,1 je (höchstens 0,2); derselbe Partner
 *   +0,3, Partner gleichen Namens +0,1; dasselbe Kind +0,2. Zwei verschiedene,
 *   vollständige Elternpaare ohne gemeinsamen Namen: −0,2 und Widerspruch.
 * - Direkt verbunden (Eltern/Kind/Partner) oder verschiedenes Geschlecht:
 *   nie ein Kandidat (Vater und Sohn gleichen Namens).
 *
 * ## Klassen
 * - `high` („sicher“): gleicher ganzer Vor- und Nachname (auch über Geburts-
 *   name/Variante), gleiches tagesgenaues Geburtsdatum, beim Tod gleiches
 *   tagesgenaues Datum oder bei beiden keines — dann aber eingetragene
 *   gemeinsame Eltern/Partner bzw. Eltern gleichen Namens —, kein Widerspruch.
 *   Nur diese Klasse ist für das Zusammenführen in einem Rutsch vorgesehen.
 * - `medium` („wahrscheinlich“): ab 0,75 ohne Widerspruch.
 * - `low` („unklar — bitte prüfen“): ab der Schwelle (Standard 0,5).
 */
import { formatFuzzyDate, formatFuzzyYear, isPreciseDate, minYearDistance, sameFuzzyDate, type FuzzyDate } from "./dates";
import { datesCompatible } from "./merge-rules";
import { editDistance, firstGivenKey, nameKey, placeKey } from "./name-keys";

export type DupPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: string;
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
  birthPlace: string | null;
  /** Weitere Namen (PersonName). */
  variants: { givenName: string | null; familyName: string | null }[];
  /** Eingetragene Eltern, Partner, Kinder (IDs). */
  parents: string[];
  partners: string[];
  children: string[];
  /** Vergleichsformen der Namen von Eltern/Partnern („vorname nachname“). */
  parentNames: string[];
  partnerNames: string[];
  /** Quell-Bäume (ImportLink.sourceTreeId); leer = von Hand angelegt. */
  trees: string[];
};

export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "sicher",
  medium: "wahrscheinlich",
  low: "unklar — bitte prüfen",
};

export type DupScore = {
  score: number;
  confidence: Confidence;
  reasons: string[];
  conflicts: string[];
  /** Aus verschiedenen Quell-Bäumen importiert. */
  crossTree: boolean;
};

export type ScoreOptions = { maxYearDiff?: number };

const fullName = (given: string | null | undefined, family: string | null | undefined) => `${nameKey(given)} ${nameKey(family)}`.trim();

/** Vergleichsformen je Person, einmal berechnet (nameKey ist teuer). */
type Prepared = { given: string[]; first: string[]; surnames: { key: string; via: "family" | "birth" | "variant" }[]; parentNames: Set<string> };
const prepared = new WeakMap<DupPerson, Prepared>();
function prep(p: DupPerson): Prepared {
  let x = prepared.get(p);
  if (!x) {
    x = {
      given: givenKeysRaw(p),
      first: blockKeysRaw(p),
      surnames: surnameKeysRaw(p),
      parentNames: new Set(p.parentNames.filter(Boolean)),
    };
    prepared.set(p, x);
  }
  return x;
}

function surnameKeysRaw(p: DupPerson): { key: string; via: "family" | "birth" | "variant" }[] {
  const out: { key: string; via: "family" | "birth" | "variant" }[] = [];
  const add = (v: string | null, via: "family" | "birth" | "variant") => {
    const k = nameKey(v);
    if (k && !out.some((x) => x.key === k)) out.push({ key: k, via });
  };
  add(p.familyName, "family");
  add(p.birthName, "birth");
  for (const v of p.variants) add(v.familyName, "variant");
  return out;
}

function givenKeysRaw(p: DupPerson): string[] {
  return [...new Set([nameKey(p.givenName), ...p.variants.map((v) => nameKey(v.givenName))].filter(Boolean))];
}

/** Blockschlüssel: erste Vornamen (Hauptname und Varianten). */
export function blockKeys(p: DupPerson): string[] {
  return prep(p).first;
}
function blockKeysRaw(p: DupPerson): string[] {
  return [...new Set([firstGivenKey(p.givenName), ...p.variants.map((v) => firstGivenKey(v.givenName))].filter(Boolean))];
}

const dateText = (f: FuzzyDate) => formatFuzzyDate(f);

/** Ähnliche Schreibweise zweier Vergleichsformen. */
function similarKeys(x: string, y: string): boolean {
  if (x === y) return true;
  const limit = Math.min(x.length, y.length) >= 7 ? 2 : 1;
  if (Math.abs(x.length - y.length) > limit) return false;
  return editDistance(x, y) <= limit;
}

/** Bewertung eines Paares; null = kein Kandidat. */
export function scoreDuplicate(a: DupPerson, b: DupPerson, options: ScoreOptions = {}): DupScore | null {
  const maxYearDiff = options.maxYearDiff ?? 2;
  if (a.id === b.id) return null;
  if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) return null;
  if (a.parents.includes(b.id) || b.parents.includes(a.id) || a.partners.includes(b.id) || a.children.includes(b.id) || b.children.includes(a.id)) {
    return null;
  }
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let score = 0;

  // Vorname
  const pa = prep(a);
  const pb = prep(b);
  const ga = pa.given;
  const gb = pb.given;
  const fullGiven = ga.some((x) => gb.includes(x));
  const firstA = pa.first;
  const firstB = pb.first;
  // „Anna“ und „Anna Maria“: ein Vorname mehr — ziemlich sicher dieselbe;
  // „Anna Maria“ und „Anna Katharina“: nur der erste gleich — schwach.
  const tokens = (k: string) => k.split(" ").filter(Boolean);
  const subset = ga.some((x) => gb.some((y) => {
    const tx = tokens(x);
    const ty = tokens(y);
    const [short, long] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
    return short.length > 0 && short.every((t) => long.includes(t));
  }));
  let weakGiven = false;
  if (fullGiven) {
    score += 0.2;
    reasons.push(ga[0] === gb[0] ? "gleicher Vorname" : "gleicher Vorname (über einen weiteren Namen)");
  } else if (subset) {
    score += 0.15;
    reasons.push(`Vorname mit weiterem Vornamen (${a.givenName} / ${b.givenName})`);
  } else if (firstA.some((x) => firstB.includes(x))) {
    score += 0.05;
    weakGiven = true;
    reasons.push(`nur der erste Vorname gleich (${a.givenName} / ${b.givenName})`);
  } else return null;

  // Nachname
  const sa = pa.surnames;
  const sb = pb.surnames;
  let exactSurname = false;
  const famA = sa.find((x) => x.via === "family")?.key ?? "";
  const famB = sb.find((x) => x.via === "family")?.key ?? "";
  if (famA && famA === famB) {
    score += 0.35;
    exactSurname = true;
    reasons.push(a.familyName === b.familyName ? "gleicher Nachname" : `gleicher Nachname (${a.familyName} / ${b.familyName})`);
  } else {
    const hit = sa.find((x) => sb.some((y) => y.key === x.key));
    if (hit) {
      const other = sb.find((y) => y.key === hit.key)!;
      score += 0.3;
      exactSurname = true;
      const viaText = (p: DupPerson, via: string) =>
        via === "birth" ? `Geburtsname von ${p.givenName}` : via === "variant" ? `Namensvariante von ${p.givenName}` : `Nachname von ${p.givenName}`;
      reasons.push(`${viaText(a, hit.via)} = ${viaText(b, other.via)} (${hit.key === nameKey(a.familyName) ? a.familyName : (a.birthName ?? hit.key)})`);
    } else if (sa.some((x) => sb.some((y) => similarKeys(x.key, y.key)))) {
      score += 0.25;
      reasons.push(`ähnliche Schreibweise des Nachnamens (${a.familyName ?? a.birthName} / ${b.familyName ?? b.birthName})`);
    } else if (sa.length || sb.length) {
      return null;
    }
  }

  // Geburt
  let birthIdentical = false;
  if (a.birth && b.birth) {
    if (isPreciseDate(a.birth) && isPreciseDate(b.birth) && sameFuzzyDate(a.birth, b.birth)) {
      score += 0.3;
      birthIdentical = true;
      reasons.push(`gleiches Geburtsdatum (${dateText(a.birth)})`);
    } else if (datesCompatible(a.birth, b.birth)) {
      score += 0.25;
      reasons.push(
        sameFuzzyDate(a.birth, b.birth) ? `gleiche Geburtsangabe (${dateText(a.birth)})` : `Geburt ${dateText(a.birth)} passt zu ${dateText(b.birth)}`,
      );
    } else {
      const exactYears = a.birth.qualifier === "EXACT" && b.birth.qualifier === "EXACT";
      const diff = exactYears ? Math.abs(a.birth.date.getUTCFullYear() - b.birth.date.getUTCFullYear()) : Math.ceil(minYearDistance(a.birth, b.birth) - 1e-9);
      if (diff > maxYearDiff) return null;
      score += diff === 0 ? 0.2 : 0.15;
      reasons.push(diff === 0 ? `gleiches Geburtsjahr (${formatFuzzyYear(a.birth)})` : `Geburtsjahre ${formatFuzzyYear(a.birth)} / ${formatFuzzyYear(b.birth)}`);
    }
  } else if (a.birth || b.birth) {
    score += 0.03;
    reasons.push("Geburtsdatum nur bei einer Person bekannt");
  }

  // Tod
  let deathIdentical = false;
  if (a.death && b.death) {
    if (isPreciseDate(a.death) && isPreciseDate(b.death) && sameFuzzyDate(a.death, b.death)) {
      score += 0.15;
      deathIdentical = true;
      reasons.push(`gleiches Sterbedatum (${dateText(a.death)})`);
    } else if (datesCompatible(a.death, b.death) || minYearDistance(a.death, b.death) <= 1) {
      score += 0.1;
      reasons.push(`Tod ${dateText(a.death)} passt zu ${dateText(b.death)}`);
    } else if (minYearDistance(a.death, b.death) > 2) {
      score -= 0.4;
      conflicts.push(`verschiedene Sterbedaten (${dateText(a.death)} / ${dateText(b.death)})`);
    }
  }

  if (a.birthPlace && b.birthPlace && placeKey(a.birthPlace) === placeKey(b.birthPlace)) {
    score += 0.1;
    reasons.push(`gleicher Geburtsort (${a.birthPlace})`);
  }

  // Verwandte
  let relativesAgree = false;
  const sharedParents = a.parents.filter((x) => b.parents.includes(x)).length;
  if (sharedParents) {
    score += 0.3;
    relativesAgree = true;
    reasons.push(sharedParents > 1 ? "dieselben Eltern eingetragen" : "ein Elternteil derselbe");
  } else {
    const shared = [...new Set(b.parentNames.filter((x) => x && pa.parentNames.has(x)))].length;
    if (shared) {
      score += 0.1 * Math.min(2, shared);
      relativesAgree = true;
      reasons.push(shared > 1 ? "Eltern mit gleichen Namen" : "ein Elternteil mit gleichem Namen");
    } else if (a.parentNames.length >= 2 && b.parentNames.length >= 2) {
      score -= 0.2;
      conflicts.push("verschiedene Eltern");
    }
  }
  if (a.partners.some((x) => b.partners.includes(x))) {
    score += 0.3;
    relativesAgree = true;
    reasons.push("derselbe Partner eingetragen");
  } else if (a.partnerNames.some((x) => x && b.partnerNames.includes(x))) {
    score += 0.1;
    relativesAgree = true;
    reasons.push("Partner mit gleichem Namen");
  }
  if (a.children.some((x) => b.children.includes(x))) {
    score += 0.2;
    relativesAgree = true;
    reasons.push("dasselbe Kind eingetragen");
  }

  const crossTree = a.trees.length > 0 && b.trees.length > 0 && !a.trees.some((t) => b.trees.includes(t));
  if (crossTree) reasons.push("aus verschiedenen Importen");

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const sameFullName = fullGiven && exactSurname;
  const deathOk = deathIdentical || (!a.death && !b.death && relativesAgree);
  let confidence: Confidence = "low";
  if (conflicts.length === 0 && sameFullName && birthIdentical && deathOk) confidence = "high";
  else if (conflicts.length === 0 && !weakGiven && score >= 0.75) confidence = "medium";
  return { score, confidence, reasons, conflicts, crossTree };
}

export type DupPair = DupScore & { a: string; b: string };

/**
 * Alle Kandidatenpaare (a < b nach ID) ab `minScore`, nach Klasse und Punkten
 * sortiert. `include(a, b)` filtert vorab (z.B. nur Paare über zwei Bäume,
 * ohne „kein Duplikat“-Markierungen).
 */
export function findDuplicatePairs(
  people: DupPerson[],
  options: ScoreOptions & { minScore?: number; include?: (a: DupPerson, b: DupPerson) => boolean } = {},
): DupPair[] {
  const minScore = options.minScore ?? 0.5;
  const blocks = new Map<string, DupPerson[]>();
  for (const p of people) {
    for (const k of blockKeys(p)) {
      const list = blocks.get(k);
      if (list) list.push(p);
      else blocks.set(k, [p]);
    }
  }
  const seen = new Set<string>();
  const out: DupPair[] = [];
  const consider = (x: DupPerson, y: DupPerson) => {
    if (x === y) return;
    const [a, b] = x.id < y.id ? [x, y] : [y, x];
    const key = `${a.id}|${b.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (options.include && !options.include(a, b)) return;
    const s = scoreDuplicate(a, b, options);
    if (s && s.score >= minScore) out.push({ ...s, a: a.id, b: b.id });
  };
  for (const group of blocks.values()) {
    // Innerhalb eines Vornamens nur Paare mit gleichem oder ähnlichem
    // Nachnamen (inkl. Geburtsname/Varianten); Personen ohne Nachnamen mit allen.
    const bySurname = new Map<string, DupPerson[]>();
    const noSurname: DupPerson[] = [];
    for (const p of group) {
      const keys = prep(p).surnames.map((x) => x.key);
      if (!keys.length) noSurname.push(p);
      for (const k of keys) bySurname.set(k, [...(bySurname.get(k) ?? []), p]);
    }
    const keys = [...bySurname.keys()];
    for (let i = 0; i < keys.length; i++) {
      const own = bySurname.get(keys[i])!;
      for (let x = 0; x < own.length; x++) for (let y = x + 1; y < own.length; y++) consider(own[x], own[y]);
      for (let j = i + 1; j < keys.length; j++) {
        if (!similarKeys(keys[i], keys[j])) continue;
        for (const x of own) for (const y of bySurname.get(keys[j])!) consider(x, y);
      }
    }
    for (const x of noSurname) for (const y of group) consider(x, y);
  }
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => rank[x.confidence] - rank[y.confidence] || y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

export { fullName as relativeNameKey };
