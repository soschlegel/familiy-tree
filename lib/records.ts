/**
 * Seite „Rekorde“: die Bestwerte des sichtbaren Stammbaums, mit den Personen
 * beim Namen. Reine Funktionen ohne Datenbank — Laden, Rechte und
 * Familienfilter macht lib/services/records.ts. Fachliche Regeln:
 * docs/komponenten/bibliotheken.md („lib/records.ts“).
 *
 * Grundsätze:
 * - Gezählt werden nur Personen mit `visible` (der Dienst reicht ohnehin nur
 *   sichtbare herein; die Funktion filtert trotzdem selbst). Beziehungen
 *   zählen nur, wenn beide Seiten gezählt werden — Kinder, Nachkommen,
 *   Partner und Ehen also nur sichtbare. Linien und Nachkommen laufen nur
 *   über sichtbare Personen: Ein sichtbares Enkelkind hinter einem nicht
 *   sichtbaren Kind zählt nicht (es verriete das Kind).
 * - Datumsregeln wie die Statistik (lib/statistics.ts), aber enger: Ein
 *   ungenaues Alter bzw. eine ungenaue Dauer zählt nur, wenn die mögliche
 *   Spanne höchstens RECORD_MAX_SPAN_YEARS Jahre weit ist, und trägt dann
 *   `about` („etwa“). Tagesgenau sind es die vollendeten Jahre. Negative
 *   Werte und unplausible (über MAX_LIFESPAN, Eltern unter MIN_PARENT_AGE …)
 *   gelten als Datenfehler und zählen nicht.
 * - Rangfolge mit Gleichstand: Platz = 1 + Zahl der besseren Einträge
 *   („1, 1, 3“); gezeigt werden die Plätze bis TOP_PLACES, je Platz
 *   höchstens MAX_TIED Einträge, der Rest als Anzahl.
 */
import type { Gender } from "@prisma/client";

import { MAX_LIFESPAN } from "./consistency";
import { dateBounds, isPreciseDate, YEAR_MS, yearsBetween, type FuzzyDate } from "./dates";
import { centuryOf, completedYears, firstGivenName, presumedDead, usableYear } from "./statistics";

/** Gezeigt werden die Plätze 1 bis TOP_PLACES. */
export const TOP_PLACES = 5;
/** Höchstens so viele gleichrangige Einträge je Platz; der Rest als „und N weitere“. */
export const MAX_TIED = 5;
/** So weit darf ein ungenaues Alter, eine Dauer oder ein Jahr offen sein, um zu zählen. */
export const RECORD_MAX_SPAN_YEARS = 5;
/** Eltern bei der Geburt eines Kindes: jünger gilt als Datenfehler. */
export const MIN_PARENT_AGE = 12;
/** Mütter bei der Geburt eines Kindes: älter gilt als Datenfehler. */
export const MAX_MOTHER_AGE = 55;
/** Väter bei der Geburt eines Kindes: älter gilt als Datenfehler. */
export const MAX_FATHER_AGE = 70;
/** Alter bei der Heirat: jünger gilt als Datenfehler. */
export const MIN_MARRIAGE_AGE = 14;
/** Dauer einer Ehe/Partnerschaft: länger gilt als Datenfehler. */
export const MAX_PARTNERSHIP_YEARS = 90;
/** Altersunterschied eines Paares: größer gilt als Datenfehler. */
export const MAX_PARTNER_AGE_GAP = 60;
/** Ein Vorname braucht so viele Träger, um „häufigster“ zu heißen. */
export const MIN_NAME_COUNT = 2;
/** Höchstens so viele gleich häufige Vornamen je Zelle. */
export const MAX_TIED_NAMES = 3;

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

export type RecordPerson = {
  id: string;
  visible: boolean;
  /** Anzeigename („Vorname Nachname“). */
  name: string;
  /** Lebensjahre für die Anzeige („1850 – 1920“). */
  lifespan: string;
  givenName: string;
  gender: Gender;
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
  /** Sterbeangabe ohne Datum (Ort, Wortlaut) — die Person ist verstorben. */
  deathWithoutDate: boolean;
};

export type RecordRelationship = {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  from: string;
  to: string;
  /** Beginn (Heirat) bei Partnerschaften. */
  start: FuzzyDate | null;
  /** Ende (Scheidung, Trennung) bei Partnerschaften. */
  end: FuzzyDate | null;
};

export type RecordsInput = {
  persons: readonly RecordPerson[];
  relationships: readonly RecordRelationship[];
  now: Date;
};

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

export type RecordPersonRef = { id: string; name: string; lifespan: string };
/** Ein Satzteil eines Eintrags: Vorwort und Personen („bei der Geburt von“ + Kind). */
export type RecordPart = { prefix?: string; persons: RecordPersonRef[] };
export type RecordEntry = {
  /** Wert für die Rangfolge (Jahre, Anzahl; bei Daten der Zeitpunkt). */
  value: number;
  /** Anzeige des Werts („93 Jahre“, „etwa 12 Jahre“, „8 Kinder“). */
  valueText: string;
  /** Ungenaue Grundlage („etwa“). */
  about: boolean;
  parts: RecordPart[];
  /** Zusatz („besteht noch“). */
  note?: string;
  /** Einzelwerte des Eintrags, wenn der Rang aus einer Summe kommt („20 und 19 Jahre“). */
  detail?: string;
};
export type RecordPlace = {
  /** Platz (1 = Bestwert); bei Gleichstand teilen sich Einträge einen Platz. */
  rank: number;
  entries: RecordEntry[];
  /** Weitere gleichrangige Einträge über MAX_TIED hinaus. */
  more: number;
};

export const RECORD_KEYS = [
  "oldestDeceased",
  "oldestLiving",
  "youngest",
  "earliest",
  "longestPartnership",
  "mostChildren",
  "mostDescendants",
  "longestLine",
  "largestSiblingGroup",
  "youngestParent",
  "oldestParent",
  "partnerAgeGap",
  "youngestCouple",
  "oldestCouple",
] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];

export type RecordCard = {
  key: RecordKey;
  places: RecordPlace[];
  /** Zahl der Einträge, die überhaupt in Frage kamen (Personen, Paare, Linien). */
  basis: number;
};

export type NameCell = { names: string[]; count: number } | null;
export type NameRow = { key: string; label: string; female: NameCell; male: NameCell };

export type RecordsResult = {
  persons: number;
  cards: Record<RecordKey, RecordCard>;
  /** Häufigster Vorname je Geburtsjahrhundert, getrennt nach Mädchen und Jungen (ohne Personen). */
  givenNames: { rows: NameRow[]; basis: number };
};

// ---------------------------------------------------------------------------
// Datumsregeln
// ---------------------------------------------------------------------------

type Span = { value: number; about: boolean };

const EXACT_DAY = (d: Date): FuzzyDate => ({ date: d, precision: "DAY", qualifier: "EXACT" });

/**
 * Ganze Jahre von `from` bis `to`: tagesgenau die vollendeten Jahre, sonst
 * die vollendeten Jahre zur Mitte der möglichen Spanne, wenn diese höchstens
 * RECORD_MAX_SPAN_YEARS Jahre weit ist (`about`). null bei offenen Angaben,
 * zu weiter Spanne oder negativem Ergebnis. Obergrenzen prüft der Aufrufer.
 */
export function recordYears(from: FuzzyDate | null | undefined, to: FuzzyDate | Date | null | undefined): Span | null {
  if (!from || !to) return null;
  const target = to instanceof Date ? EXACT_DAY(to) : to;
  const r = yearsBetween(from, target);
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) return null;
  if (r.max - r.min > RECORD_MAX_SPAN_YEARS + 0.01) return null;
  const value = r.exact ? completedYears(from.date, target.date) : Math.floor((r.min + r.max) / 2 + 0.01);
  if (value < 0) return null;
  return { value, about: !r.exact };
}

/** Zeitpunkt einer Angabe (Mitte des möglichen Zeitraums), wenn er höchstens RECORD_MAX_SPAN_YEARS offen ist. */
export function recordInstant(f: FuzzyDate | null | undefined): number | null {
  if (!f) return null;
  const { start, end } = dateBounds(f);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if ((end - start) / YEAR_MS > RECORD_MAX_SPAN_YEARS + 0.01) return null;
  return (start + end) / 2;
}

/** Lebt laut Daten: keine Sterbeangabe und nicht „vermutlich verstorben“ (wie lib/statistics.ts). */
export function isLiving(p: Pick<RecordPerson, "birth" | "death" | "deathWithoutDate">, now: Date): boolean {
  return !p.death && !p.deathWithoutDate && !presumedDead(p.birth, now);
}

// ---------------------------------------------------------------------------
// Rangfolge
// ---------------------------------------------------------------------------

type Candidate = { value: number; order: string; entry: RecordEntry };

/**
 * Plätze mit Gleichstand: gleiche Werte teilen sich einen Platz, der nächste
 * Platz zählt die besseren Einträge mit („1, 1, 3“). Innerhalb eines Platzes
 * genaue vor ungenauen Angaben, dann nach Namen.
 */
export function rankPlaces(cands: readonly Candidate[], dir: "desc" | "asc"): RecordPlace[] {
  const sorted = [...cands].sort(
    (a, b) =>
      (dir === "desc" ? b.value - a.value : a.value - b.value) ||
      Number(a.entry.about) - Number(b.entry.about) ||
      a.order.localeCompare(b.order, "de"),
  );
  const places: RecordPlace[] = [];
  let i = 0;
  while (i < sorted.length && i + 1 <= TOP_PLACES) {
    let j = i;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    const group = sorted.slice(i, j);
    places.push({
      rank: i + 1,
      entries: group.slice(0, MAX_TIED).map((c) => c.entry),
      more: Math.max(0, group.length - MAX_TIED),
    });
    i = j;
  }
  return places;
}

const yearsText = (s: Span) => `${s.about ? "etwa " : ""}${s.value} ${s.value === 1 ? "Jahr" : "Jahre"}`;
const countText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

/** Elternschaften, die als Kinder bzw. Abstammung zählen (wie Statistik und Verwandtschaft). */
const LINEAGE_SUBTYPES = new Set(["BIOLOGICAL", "ADOPTIVE"]);
const MARRIAGE_SUBTYPES = new Set(["MARRIED", "DIVORCED"]);

/** Alle Rekorde in wenigen Durchgängen über Personen und Beziehungen. */
export function computeRecords(input: RecordsInput): RecordsResult {
  const now = input.now;
  const persons = input.persons.filter((p) => p.visible);
  const byId = new Map(persons.map((p) => [p.id, p]));
  const rels = input.relationships.filter((r) => byId.has(r.from) && byId.has(r.to) && r.from !== r.to);

  const refCache = new Map<string, RecordPersonRef>();
  const ref = (id: string): RecordPersonRef => {
    let r = refCache.get(id);
    if (!r) {
      const p = byId.get(id)!;
      refCache.set(id, (r = { id, name: p.name, lifespan: p.lifespan }));
    }
    return r;
  };
  const sortedRefs = (ids: Iterable<string>) =>
    [...ids].map(ref).sort((a, b) => a.name.localeCompare(b.name, "de") || (a.id < b.id ? -1 : 1));
  const orderOf = (ids: Iterable<string>) => sortedRefs(ids).map((r) => `${r.name}\u0000${r.id}`).join("\u0001");

  const living = new Map(persons.map((p) => [p.id, isLiving(p, now)]));
  const birthInstant = new Map<string, number>();
  for (const p of persons) {
    const t = recordInstant(p.birth);
    if (t !== null) birthInstant.set(p.id, t);
  }

  // --- Personen: Alter, jüngste, früheste ---------------------------------
  const oldestDeceased: Candidate[] = [];
  const oldestLiving: Candidate[] = [];
  const youngest: Candidate[] = [];
  const earliest: Candidate[] = [];
  for (const p of persons) {
    if (p.death) {
      const age = recordYears(p.birth, p.death);
      if (age && age.value <= MAX_LIFESPAN) {
        oldestDeceased.push({ value: age.value, order: orderOf([p.id]), entry: { value: age.value, valueText: yearsText(age), about: age.about, parts: [{ persons: [ref(p.id)] }] } });
      }
    } else if (living.get(p.id)) {
      const age = recordYears(p.birth, now);
      if (age && age.value <= MAX_LIFESPAN) {
        oldestLiving.push({ value: age.value, order: orderOf([p.id]), entry: { value: age.value, valueText: yearsText(age), about: age.about, parts: [{ persons: [ref(p.id)] }] } });
      }
    }
    const t = birthInstant.get(p.id);
    if (t !== undefined && p.birth && t <= now.getTime()) {
      const about = !isPreciseDate(p.birth);
      youngest.push({
        value: t,
        order: orderOf([p.id]),
        entry: { value: t, valueText: birthText(p.birth), about, parts: [{ persons: [ref(p.id)] }] },
      });
      const year = new Date(t).getUTCFullYear();
      const yearAbout = p.birth.qualifier !== "EXACT";
      earliest.push({
        value: year,
        order: orderOf([p.id]),
        entry: { value: year, valueText: `${yearAbout ? "etwa " : ""}${year}`, about: yearAbout, parts: [{ persons: [ref(p.id)] }] },
      });
    }
  }

  // --- Beziehungen in einem Durchgang --------------------------------------
  const childrenOf = new Map<string, Set<string>>();
  const parentsOf = new Map<string, Set<string>>();
  const bioEdges: { parent: string; child: string }[] = [];
  const partnerRels = new Map<string, RecordRelationship>();
  for (const r of rels) {
    if (r.type === "PARENT_OF") {
      if (!LINEAGE_SUBTYPES.has(r.subtype)) continue;
      addTo(childrenOf, r.from, r.to);
      addTo(parentsOf, r.to, r.from);
      if (r.subtype === "BIOLOGICAL") bioEdges.push({ parent: r.from, child: r.to });
    } else {
      // Dasselbe Paar mehrfach erfasst: die früheste Partnerschaft mit Beginn zählt.
      const key = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      const prev = partnerRels.get(key);
      const t = r.start ? dateBounds(r.start).start : Infinity;
      if (!prev || t < (prev.start ? dateBounds(prev.start).start : Infinity)) partnerRels.set(key, r);
    }
  }

  // --- Partnerschaften: Dauer, Altersunterschied, Brautpaare ---------------
  const longestPartnership: Candidate[] = [];
  const partnerAgeGap: Candidate[] = [];
  const youngestCouple: Candidate[] = [];
  const oldestCouple: Candidate[] = [];
  for (const r of partnerRels.values()) {
    const a = byId.get(r.from)!;
    const b = byId.get(r.to)!;
    const pair = sortedRefs([a.id, b.id]);
    const order = orderOf([a.id, b.id]);

    // Altersunterschied: beide Geburten hinreichend genau.
    const ta = birthInstant.get(a.id);
    const tb = birthInstant.get(b.id);
    if (ta !== undefined && tb !== undefined) {
      const [older, younger] = ta <= tb ? [a, b] : [b, a];
      const gap = recordYears(older.birth, younger.birth);
      if (gap && gap.value > 0 && gap.value <= MAX_PARTNER_AGE_GAP) {
        partnerAgeGap.push({
          value: gap.value,
          order,
          entry: { value: gap.value, valueText: yearsText(gap), about: gap.about, parts: [{ persons: [ref(older.id)] }, { prefix: "älter als", persons: [ref(younger.id)] }] },
        });
      }
    }

    if (!r.start) continue;
    // Alter beider bei Beginn — auch Plausibilitätsprüfung für die Dauer.
    const ageA = recordYears(a.birth, r.start);
    const ageB = recordYears(b.birth, r.start);
    const implausible = [ageA, ageB].some((x) => x !== null && (x.value < MIN_MARRIAGE_AGE || x.value > MAX_LIFESPAN));
    if (implausible) continue;

    if (MARRIAGE_SUBTYPES.has(r.subtype) && ageA && ageB) {
      const sum = ageA.value + ageB.value;
      const about = ageA.about || ageB.about;
      const [first, second] = pair[0].id === a.id ? [ageA, ageB] : [ageB, ageA];
      const entry: RecordEntry = {
        value: sum,
        valueText: `${about ? "etwa " : ""}${sum} Jahre zusammen`,
        about,
        parts: [{ persons: pair }],
        detail: `${about ? "etwa " : ""}${first.value} und ${second.value} Jahre`,
      };
      youngestCouple.push({ value: sum, order, entry });
      oldestCouple.push({ value: sum, order, entry });
    }

    const end = partnershipEnd(r, a, b, now, living);
    if (!end) continue;
    const span = recordYears(r.start, end.at);
    if (!span || span.value > MAX_PARTNERSHIP_YEARS) continue;
    longestPartnership.push({
      value: span.value,
      order,
      entry: {
        value: span.value,
        valueText: yearsText(span),
        about: span.about,
        parts: [{ persons: pair }],
        note: end.ongoing ? "besteht noch" : undefined,
      },
    });
  }

  // --- Eltern bei der Geburt (nur leiblich) --------------------------------
  const youngestParentOf = new Map<string, { age: Span; child: string }>();
  const oldestParentOf = new Map<string, { age: Span; child: string }>();
  for (const { parent, child } of bioEdges) {
    const pa = byId.get(parent)!;
    const age = recordYears(pa.birth, byId.get(child)!.birth);
    if (!age) continue;
    const max = pa.gender === "MALE" ? MAX_FATHER_AGE : MAX_MOTHER_AGE;
    if (age.value < MIN_PARENT_AGE || age.value > max) continue;
    const y = youngestParentOf.get(parent);
    if (!y || age.value < y.age.value) youngestParentOf.set(parent, { age, child });
    const o = oldestParentOf.get(parent);
    if (!o || age.value > o.age.value) oldestParentOf.set(parent, { age, child });
  }
  const parentCands = (m: Map<string, { age: Span; child: string }>): Candidate[] =>
    [...m.entries()].map(([parent, { age, child }]) => ({
      value: age.value,
      order: orderOf([parent]),
      entry: {
        value: age.value,
        valueText: yearsText(age),
        about: age.about,
        parts: [{ persons: [ref(parent)] }, { prefix: "bei der Geburt von", persons: [ref(child)] }],
      },
    }));

  // --- Kinder: je Person, gleiche Kinderschar = ein Paar -------------------
  const childGroups = new Map<string, { parents: string[]; count: number }>();
  for (const [parent, kids] of childrenOf) {
    const key = [...kids].sort().join("|");
    const g = childGroups.get(key);
    if (g) g.parents.push(parent);
    else childGroups.set(key, { parents: [parent], count: kids.size });
  }
  const mostChildren: Candidate[] = [...childGroups.values()].map((g) => ({
    value: g.count,
    order: orderOf(g.parents),
    entry: { value: g.count, valueText: countText(g.count, "Kind", "Kinder"), about: false, parts: [{ persons: sortedRefs(g.parents) }] },
  }));

  // --- Geschwisterschar: Kinder derselben Eltern ---------------------------
  const siblingGroups = new Map<string, { parents: string[]; count: number }>();
  for (const parents of parentsOf.values()) {
    const key = [...parents].sort().join("|");
    const g = siblingGroups.get(key);
    if (g) g.count++;
    else siblingGroups.set(key, { parents: [...parents], count: 1 });
  }
  const largestSiblingGroup: Candidate[] = [...siblingGroups.values()]
    .filter((g) => g.count >= 2)
    .map((g) => ({
      value: g.count,
      order: orderOf(g.parents),
      entry: { value: g.count, valueText: countText(g.count, "Geschwister", "Geschwister"), about: false, parts: [{ prefix: "Kinder von", persons: sortedRefs(g.parents) }] },
    }));

  // --- Generationen: Reihenfolge von oben nach unten (Kreise fallen weg) ----
  const order = topoOrder(persons.map((p) => p.id), parentsOf, childrenOf);
  const up = new Map<string, number>();
  for (const id of order) {
    let best = 0;
    for (const par of parentsOf.get(id) ?? []) best = Math.max(best, up.get(par) ?? 0);
    up.set(id, best + 1);
  }
  const down = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    let best = 0;
    for (const c of childrenOf.get(id) ?? []) best = Math.max(best, down.get(c) ?? 0);
    down.set(id, best + 1);
  }

  // --- Nachkommen: nur wer weniger als TOP_PLACES Generationen über sich hat,
  // kann vorn liegen (jeder Vorfahr hat strikt mehr Nachkommen). -------------
  const descendantGroups = new Map<string, { persons: string[]; count: number }>();
  let descendantBasis = 0;
  for (const id of order) {
    if (!childrenOf.has(id)) continue;
    descendantBasis++;
    if ((up.get(id) ?? Infinity) > TOP_PLACES) continue;
    const count = countDescendants(id, childrenOf);
    const key = `${count}/${[...childrenOf.get(id)!].sort().join("|")}`;
    const g = descendantGroups.get(key);
    if (g) g.persons.push(id);
    else descendantGroups.set(key, { persons: [id], count });
  }
  const mostDescendants: Candidate[] = [...descendantGroups.values()].map((g) => ({
    value: g.count,
    order: orderOf(g.persons),
    entry: { value: g.count, valueText: countText(g.count, "Nachkomme", "Nachkommen"), about: false, parts: [{ persons: sortedRefs(g.persons) }] },
  }));

  // --- Längste Linie: von einem Stammvater/einer Stammmutter bis zum tiefsten
  // Nachkommen; als Endpunkt eine lebende Person, sonst die zuletzt geborene.
  const roots = order.filter((id) => !parentsOf.has(id) && (down.get(id) ?? 0) >= 2);
  const topValues = [...new Set(roots.map((id) => down.get(id)!))].sort((x, y) => y - x).slice(0, TOP_PLACES);
  const lineGroups = new Map<string, { ancestors: string[]; end: string; gens: number }>();
  for (const root of roots) {
    const gens = down.get(root)!;
    if (!topValues.includes(gens)) continue;
    const end = lineEnd(root, gens, childrenOf, down, living, birthInstant, byId);
    const key = `${gens}/${end}`;
    const g = lineGroups.get(key);
    if (g) g.ancestors.push(root);
    else lineGroups.set(key, { ancestors: [root], end, gens });
  }
  const longestLine: Candidate[] = [...lineGroups.values()].map((g) => ({
    value: g.gens,
    order: orderOf(g.ancestors),
    entry: {
      value: g.gens,
      valueText: countText(g.gens, "Generation", "Generationen"),
      about: false,
      parts: [{ prefix: "von", persons: sortedRefs(g.ancestors) }, { prefix: "bis", persons: [ref(g.end)] }],
    },
  }));

  const card = (key: RecordKey, cands: Candidate[], dir: "desc" | "asc", basis = cands.length): RecordCard => ({
    key,
    places: rankPlaces(cands, dir),
    basis,
  });

  return {
    persons: persons.length,
    cards: {
      oldestDeceased: card("oldestDeceased", oldestDeceased, "desc"),
      oldestLiving: card("oldestLiving", oldestLiving, "desc"),
      youngest: card("youngest", youngest, "desc"),
      earliest: card("earliest", earliest, "asc"),
      longestPartnership: card("longestPartnership", longestPartnership, "desc"),
      mostChildren: card("mostChildren", mostChildren, "desc", childrenOf.size),
      mostDescendants: card("mostDescendants", mostDescendants, "desc", descendantBasis),
      longestLine: card("longestLine", longestLine, "desc", roots.length),
      largestSiblingGroup: card("largestSiblingGroup", largestSiblingGroup, "desc"),
      youngestParent: card("youngestParent", parentCands(youngestParentOf), "asc"),
      oldestParent: card("oldestParent", parentCands(oldestParentOf), "desc"),
      partnerAgeGap: card("partnerAgeGap", partnerAgeGap, "desc"),
      youngestCouple: card("youngestCouple", youngestCouple, "asc"),
      oldestCouple: card("oldestCouple", oldestCouple, "desc"),
    },
    givenNames: givenNamesByCentury(persons),
  };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

/** „* 12.03.2024“ bzw. die ungenaue Angabe, wie sie erfasst ist. */
function birthText(f: FuzzyDate): string {
  const d = f.date;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  if (isPreciseDate(f)) return `* ${dd}.${mm}.${yyyy}`;
  if (f.qualifier === "EXACT" && f.precision === "MONTH") return `* ${mm}.${yyyy}`;
  if (f.qualifier === "EXACT") return `* ${yyyy}`;
  return `* etwa ${new Date(recordInstant(f) ?? d.getTime()).getUTCFullYear()}`;
}

/**
 * Ende einer Partnerschaft für die Dauer: erfasstes Ende; sonst bei einer
 * Scheidung ohne Datum nichts; sonst der Tod des zuerst verstorbenen
 * Partners — nur, wenn er feststeht (der andere lebt oder starb sicher
 * später); leben beide, bis heute (`ongoing`).
 */
function partnershipEnd(
  r: RecordRelationship,
  a: RecordPerson,
  b: RecordPerson,
  now: Date,
  living: Map<string, boolean>,
): { at: FuzzyDate | Date; ongoing: boolean } | null {
  if (r.end) return { at: r.end, ongoing: false };
  if (r.subtype === "DIVORCED") return null;
  const la = living.get(a.id)!;
  const lb = living.get(b.id)!;
  if (la && lb) return { at: now, ongoing: true };
  const da = a.death;
  const db = b.death;
  if (da && lb) return { at: da, ongoing: false };
  if (db && la) return { at: db, ongoing: false };
  if (da && db) {
    const ta = recordInstant(da);
    const tb = recordInstant(db);
    if (ta === null || tb === null) return null;
    return { at: ta <= tb ? da : db, ongoing: false };
  }
  // Ein Partner ohne Sterbedatum, aber verstorben (oder vermutlich): offen.
  return null;
}

/** Reihenfolge von den Vorfahren zu den Nachkommen (Kahn); Personen in Kreisen fallen weg. */
function topoOrder(ids: string[], parentsOf: Map<string, Set<string>>, childrenOf: Map<string, Set<string>>): string[] {
  const indegree = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    const n = parentsOf.get(id)?.size ?? 0;
    indegree.set(id, n);
    if (n === 0) queue.push(id);
  }
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const c of childrenOf.get(id) ?? []) {
      const n = indegree.get(c)! - 1;
      indegree.set(c, n);
      if (n === 0) queue.push(c);
    }
  }
  return order;
}

/** Zahl der verschiedenen Nachkommen über sichtbare Kinder (Breitensuche). */
function countDescendants(id: string, childrenOf: Map<string, Set<string>>): number {
  const seen = new Set<string>([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const c of childrenOf.get(queue[i]) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(c);
    }
  }
  return seen.size - 1;
}

/**
 * Endpunkt der längsten Linie unter `root`: alle Personen auf einem längsten
 * Weg Generation für Generation hinab; aus der letzten eine lebende, sonst
 * die zuletzt geborene, sonst nach Namen.
 */
function lineEnd(
  root: string,
  gens: number,
  childrenOf: Map<string, Set<string>>,
  down: Map<string, number>,
  living: Map<string, boolean>,
  birthInstant: Map<string, number>,
  byId: Map<string, RecordPerson>,
): string {
  let level = [root];
  for (let g = gens; g > 1; g--) {
    const next = new Set<string>();
    for (const id of level) {
      for (const c of childrenOf.get(id) ?? []) if (down.get(c) === g - 1) next.add(c);
    }
    level = [...next];
  }
  level.sort(
    (x, y) =>
      Number(living.get(y)) - Number(living.get(x)) ||
      (birthInstant.get(y) ?? -Infinity) - (birthInstant.get(x) ?? -Infinity) ||
      byId.get(x)!.name.localeCompare(byId.get(y)!.name, "de") ||
      (x < y ? -1 : 1),
  );
  return level[0];
}

/** Häufigster erster Vorname je Geburtsjahrhundert, für Mädchen und Jungen getrennt. */
function givenNamesByCentury(persons: readonly RecordPerson[]): { rows: NameRow[]; basis: number } {
  const groups = new Map<string, { label: string; start: number; female: Map<string, NameCount>; male: Map<string, NameCount> }>();
  let basis = 0;
  for (const p of persons) {
    if (p.gender !== "FEMALE" && p.gender !== "MALE") continue;
    const year = usableYear(p.birth);
    const name = firstGivenName(p.givenName);
    if (year === null || !name) continue;
    basis++;
    const c = centuryOf(year);
    let g = groups.get(c.key);
    if (!g) groups.set(c.key, (g = { label: c.label, start: c.start, female: new Map(), male: new Map() }));
    const m = p.gender === "FEMALE" ? g.female : g.male;
    const key = name.toLocaleLowerCase("de");
    let n = m.get(key);
    if (!n) m.set(key, (n = { count: 0, spellings: new Map() }));
    n.count++;
    n.spellings.set(name, (n.spellings.get(name) ?? 0) + 1);
  }
  const rows = [...groups.entries()]
    .sort((x, y) => x[1].start - y[1].start)
    .map(([key, g]) => ({ key, label: g.label, female: topName(g.female), male: topName(g.male) }))
    .filter((r) => r.female || r.male);
  return { rows, basis };
}

type NameCount = { count: number; spellings: Map<string, number> };

const capitalFirst = (s: string) => Number(/^\p{Lu}/u.test(s));

function topName(m: Map<string, NameCount>): NameCell {
  let max = 0;
  for (const n of m.values()) max = Math.max(max, n.count);
  if (max < MIN_NAME_COUNT) return null;
  const names = [...m.values()]
    .filter((n) => n.count === max)
    // Häufigste Schreibweise; bei Gleichstand die großgeschriebene.
    .map((n) => [...n.spellings.entries()].sort((a, b) => b[1] - a[1] || capitalFirst(b[0]) - capitalFirst(a[0]) || a[0].localeCompare(b[0], "de"))[0][0])
    .sort((a, b) => a.localeCompare(b, "de"));
  return { names: names.slice(0, MAX_TIED_NAMES), count: max };
}
