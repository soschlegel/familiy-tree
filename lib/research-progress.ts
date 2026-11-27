/**
 * Seite „Forschungs-Fortschritt“ (/progress): Wie vollständig sind die
 * Vorfahren einer Person erforscht — je Generation und je Großeltern-Linie —
 * und wo lohnt sich das Weitersuchen am meisten? Reine Funktionen ohne
 * Datenbank und ohne Rechteprüfung: Laden und Sichtbarkeit macht
 * lib/services/research-progress.ts. Fachliche Regeln:
 * docs/komponenten/bibliotheken.md („lib/research-progress.ts“).
 *
 * Plätze wie in der Ansicht „Ringe“ (assignRingSlots, lib/ancestor-rings.ts):
 * Generation g hat 2^g Plätze, nur leibliche Eltern, Ahnenschwund zählt je
 * Platz, ein Zyklus lässt den Platz leer. Ein nicht sichtbarer Vorfahr
 * belegt seinen Platz als „nicht freigegeben“; alle Plätze dahinter zählen
 * ebenfalls als „nicht freigegeben“ — weder gefunden noch fehlend, und über
 * ihn hinaus wird nichts gerechnet und nichts vorgeschlagen.
 */

import { assignRingSlots, slotLine, type RingParent } from "./ancestor-rings";
import { PRESUMED_LIFESPAN } from "./consistency";
import { dateBounds, formatFuzzyYear, isPreciseDate, type FuzzyDate } from "./dates";
import type { Sex } from "./kinship";
import { LINE_CODE, LINE_KEYS, LINE_LABEL, type LineKey } from "./reference";
import { generationName } from "./roots";

export const PROGRESS_MIN_GENERATION = 4;
export const PROGRESS_MAX_GENERATION = 10;
export const PROGRESS_DEFAULT_GENERATION = 6;
/** Adressparameter der Seite (`/progress?person=…&generationen=8`). */
export const PROGRESS_GENERATION_PARAM = "generationen";
/** So viele Vorschläge zeigt die Seite zuerst; der Rest hinter „weitere anzeigen“. */
export const PROGRESS_SHOWN_SUGGESTIONS = 20;
/** Höchstens so viele Vorschläge insgesamt. */
export const PROGRESS_MAX_SUGGESTIONS = 200;

/** Tiefe aus der Adresse: ganze Zahl 4…10, sonst der Standard 6. */
export function parseProgressGeneration(value: unknown): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return PROGRESS_DEFAULT_GENERATION;
  return Math.min(PROGRESS_MAX_GENERATION, Math.max(PROGRESS_MIN_GENERATION, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

/** Eine sichtbare Person mit den Angaben, die in die Punkte eingehen. */
export type ProgressPerson = {
  id: string;
  /** „Vorname Nachname“. */
  name: string;
  gender: Sex;
  birth: FuzzyDate | null;
  /** Geburt nur als Wortlaut („Palmsonntag 1864“) — zählt als ungenaues Datum. */
  birthPhrase: boolean;
  birthPlace: string | null;
  death: FuzzyDate | null;
  deathPhrase: boolean;
  deathPlace: string | null;
};

/**
 * Wie eine Angabe belegt ist: durch eine unabhängige Quelle, nur durch einen
 * fremden Stammbaum (Quellenart ONLINE_TREE — ein Hinweis, kein Beleg) oder
 * gar nicht.
 */
export type Evidence = "independent" | "hintOnly" | "none";

export type ProgressInput = {
  rootId: string;
  generations: number;
  now: Date;
  /** Angaben einer sichtbaren Person; undefined bei nicht sichtbaren. */
  person: (id: string) => ProgressPerson | undefined;
  /**
   * Leibliche Eltern einer sichtbaren Person in stabiler Reihenfolge — auch
   * nicht sichtbare (dann mit Geschlecht UNKNOWN). Für die Personen der
   * letzten Generation nötig, damit „beide Eltern erfasst“ stimmt.
   */
  parentsOf: (id: string) => readonly RingParent[];
  visible: (id: string) => boolean;
  evidence: (id: string, fact: "BIRTH" | "DEATH") => Evidence;
};

// ---------------------------------------------------------------------------
// Qualität je Person
// ---------------------------------------------------------------------------

export type QualityKey =
  | "birthDate"
  | "birthPlace"
  | "deathDate"
  | "deathPlace"
  | "parents"
  | "birthEvidence"
  | "deathEvidence";

export type QualityCheck = { key: QualityKey; points: number; max: number };

export type PersonQuality = {
  /** Verstorben laut Sterbeangabe oder vermutlich (älter als 100 Jahre). */
  mortal: boolean;
  /** Ohne Sterbeangabe, aber laut Geburt (eigener oder eines Nachkommen in der Linie) über 100 Jahre. */
  presumedDead: boolean;
  checks: QualityCheck[];
  points: number;
  max: number;
  /** Alle Datenpunkte erfasst (Belege zählen nicht mit). */
  complete: boolean;
  /** Geburt — und bei Verstorbenen der Tod — unabhängig belegt. */
  sourced: boolean;
};

/** Punkte je Angabe; die Summe ist die Höchstzahl (8 bei Verstorbenen, 5 bei Lebenden). */
export const QUALITY_POINTS: Record<QualityKey, number> = {
  birthDate: 2,
  birthPlace: 1,
  deathDate: 1,
  deathPlace: 1,
  parents: 1,
  birthEvidence: 1,
  deathEvidence: 1,
};

export const hasBirthDate = (p: ProgressPerson) => Boolean(p.birth) || p.birthPhrase;
export const hasDeathDate = (p: ProgressPerson) => Boolean(p.death) || p.deathPhrase;
const hasText = (s: string | null) => Boolean(s?.trim());
/** Geburt bzw. Tod überhaupt erfasst (Datum, Wortlaut oder Ort) — erst dann lässt sie sich belegen. */
export const birthRecorded = (p: ProgressPerson) => hasBirthDate(p) || hasText(p.birthPlace);
export const deathRecorded = (p: ProgressPerson) => hasDeathDate(p) || hasText(p.deathPlace);

/** Spätester möglicher Zeitpunkt einer Angabe (ms), Infinity bei offenem Ende. */
function latest(f: FuzzyDate | null): number {
  if (!f) return Infinity;
  const end = dateBounds(f).end;
  return Number.isFinite(end) ? end : Infinity;
}

/** Älter als PRESUMED_LIFESPAN Jahre, wenn spätestens zum Zeitpunkt `bornBy` geboren. */
export function olderThanLifespan(bornBy: number, now: Date): boolean {
  if (!Number.isFinite(bornBy)) return false;
  return now.getUTCFullYear() - new Date(bornBy - 1).getUTCFullYear() > PRESUMED_LIFESPAN;
}

/**
 * Punkte einer Person:
 * - Geburtsdatum: 2 genau (Tag ohne Zusatz), 1 ungenau (nur Jahr/Monat,
 *   „um“, „vor“, Zeitraum, nur Wortlaut), 0 fehlt.
 * - Geburtsort, beide Eltern erfasst, Geburt belegt: je 1.
 * - Nur bei Verstorbenen bzw. vermutlich Verstorbenen: Sterbedatum (auch
 *   ungenau), Sterbeort, Tod belegt: je 1.
 * „Belegt“ heißt: Zitat einer Quelle, die kein fremder Stammbaum ist.
 * `bornBy`: spätester Geburtszeitpunkt laut eigener Geburt oder der eines
 * Nachkommen in der Linie (wer ein vor über 100 Jahren geborenes Kind hat,
 * ist selbst älter).
 */
export function personQuality(
  p: ProgressPerson,
  ctx: { parentCount: number; bornBy: number; now: Date; birthEvidence: Evidence; deathEvidence: Evidence },
): PersonQuality {
  const deceased = deathRecorded(p);
  const presumedDead = !deceased && olderThanLifespan(Math.min(ctx.bornBy, latest(p.birth)), ctx.now);
  const mortal = deceased || presumedDead;
  const check = (key: QualityKey, points: number): QualityCheck => ({ key, points, max: QUALITY_POINTS[key] });
  const checks: QualityCheck[] = [
    check("birthDate", p.birth && isPreciseDate(p.birth) ? 2 : hasBirthDate(p) ? 1 : 0),
    check("birthPlace", hasText(p.birthPlace) ? 1 : 0),
  ];
  if (mortal) {
    checks.push(check("deathDate", hasDeathDate(p) ? 1 : 0), check("deathPlace", hasText(p.deathPlace) ? 1 : 0));
  }
  checks.push(check("parents", ctx.parentCount >= 2 ? 1 : 0), check("birthEvidence", ctx.birthEvidence === "independent" ? 1 : 0));
  if (mortal) checks.push(check("deathEvidence", ctx.deathEvidence === "independent" ? 1 : 0));
  const got = (k: QualityKey) => (checks.find((c) => c.key === k)?.points ?? 0) > 0;
  return {
    mortal,
    presumedDead,
    checks,
    points: checks.reduce((s, c) => s + c.points, 0),
    max: checks.reduce((s, c) => s + c.max, 0),
    complete: got("birthDate") && got("birthPlace") && got("parents") && (!mortal || (got("deathDate") && got("deathPlace"))),
    sourced: got("birthEvidence") && (!mortal || got("deathEvidence")),
  };
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

/** Qualität einer Gruppe (Generation, Linie): jede Person einmal. */
export type QualitySummary = { persons: number; complete: number; sourced: number; points: number; maxPoints: number };

export type PlaceCounts = {
  places: number;
  /** Plätze mit einer sichtbaren Person (Ahnenschwund: je Platz). */
  found: number;
  /** Nicht freigegebene Vorfahren und alle Plätze dahinter. */
  restricted: number;
  missing: number;
  /** Verschiedene sichtbare Personen auf diesen Plätzen. */
  distinct: number;
};

export type GenerationRow = PlaceCounts & { generation: number; label: string; quality: QualitySummary };

export type LineRow = PlaceCounts & {
  line: LineKey;
  code: string;
  label: string;
  /** Der Großelternteil am Anfang der Linie. */
  grandparent: { kind: "person"; id: string; name: string } | { kind: "restricted" } | null;
  quality: QualitySummary;
};

export type SuggestionKind =
  | "missingParents"
  | "missingBirthDate"
  | "missingDeathDate"
  | "birthHintOnly"
  | "missingBirthPlace"
  | "deathHintOnly"
  | "birthUnsourced"
  | "deathUnsourced"
  | "missingDeathPlace";

/** Reihenfolge der Arten innerhalb einer Generation (siehe sortSuggestions). */
export const SUGGESTION_ORDER: readonly SuggestionKind[] = [
  "missingParents",
  "missingBirthDate",
  "missingDeathDate",
  "birthHintOnly",
  "missingBirthPlace",
  "deathHintOnly",
  "birthUnsourced",
  "deathUnsourced",
  "missingDeathPlace",
];

export type Suggestion = {
  kind: SuggestionKind;
  personId: string;
  name: string;
  /** Generation der Person (0 = Ausgangsperson). */
  generation: number;
  /** Ganzer Satz: „Eltern von Karl Beispiel fehlen“. */
  title: string;
  /** Person und Zusammenhang: „* 1850 in Musterdorf · nächste Lücke in der Linie VV …“. */
  detail: string;
  /** Aussicht der Suche: Geburtsjahr und Geburtsort bekannt (je 1). */
  prospect: number;
  /** Plätze bis zur gewählten Tiefe, die hinter der Lücke fehlen (nur bei fehlenden Eltern). */
  cutOff: number;
};

export type ProgressResult = {
  generations: number;
  total: PlaceCounts;
  quality: QualitySummary;
  byGeneration: GenerationRow[];
  lines: LineRow[];
  suggestions: Suggestion[];
  /** Alle Vorschläge vor der Begrenzung auf PROGRESS_MAX_SUGGESTIONS. */
  suggestionsTotal: number;
};

type SlotState = { kind: "person"; personId: string } | { kind: "restricted" } | { kind: "missing" };

const emptySummary = (): QualitySummary => ({ persons: 0, complete: 0, sourced: 0, points: 0, maxPoints: 0 });

function summarize(ids: Iterable<string>, quality: ReadonlyMap<string, PersonQuality>): QualitySummary {
  const s = emptySummary();
  for (const id of new Set(ids)) {
    const q = quality.get(id);
    if (!q) continue;
    s.persons += 1;
    if (q.complete) s.complete += 1;
    if (q.sourced) s.sourced += 1;
    s.points += q.points;
    s.maxPoints += q.max;
  }
  return s;
}

function countStates(states: readonly SlotState[]): PlaceCounts {
  const c: PlaceCounts = { places: states.length, found: 0, restricted: 0, missing: 0, distinct: 0 };
  const ids = new Set<string>();
  for (const s of states) {
    if (s.kind === "person") {
      c.found += 1;
      ids.add(s.personId);
    } else c[s.kind] += 1;
  }
  c.distinct = ids.size;
  return c;
}

/** „* um 1850 in Musterdorf“, „* 1850“, „* in Musterdorf“; leer ohne Angabe. */
export function birthSummary(p: ProgressPerson): string {
  const year = formatFuzzyYear(p.birth);
  const place = p.birthPlace?.trim();
  if (!year && !place) return "";
  return `* ${[year, place ? `in ${place}` : ""].filter(Boolean).join(" ")}`;
}

/** Wo eine Lücke liegt, aus Sicht der Ausgangsperson. */
export function lineContext(generation: number, index: number): string {
  if (generation === 0) return "direkt bei der Ausgangsperson";
  if (generation === 1) return index === 0 ? "auf der väterlichen Seite" : "auf der mütterlichen Seite";
  const line = slotLine(generation, index)!;
  return `in der Linie ${LINE_CODE[line]} (${LINE_LABEL[line]})`;
}

/**
 * Reihenfolge der Vorschläge (dokumentierte Regel):
 * 1. nähere Generation zuerst (die Ausgangsperson, dann die Eltern …);
 * 2. in einer Generation nach Art: zuerst fehlende Eltern (sie schneiden
 *    eine ganze Linie ab), dann fehlende Daten, dann Belege (SUGGESTION_ORDER);
 * 3. bei fehlenden Eltern: mehr abgeschnittene Plätze zuerst;
 * 4. dann, wo eine Suche Aussicht hat (Geburtsjahr und -ort bekannt);
 * 5. zuletzt nach Name.
 */
export function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return (
    a.generation - b.generation ||
    SUGGESTION_ORDER.indexOf(a.kind) - SUGGESTION_ORDER.indexOf(b.kind) ||
    b.cutOff - a.cutOff ||
    b.prospect - a.prospect ||
    a.name.localeCompare(b.name, "de") ||
    a.personId.localeCompare(b.personId)
  );
}

/** Alles für die Seite aus den Plätzen und den Angaben der sichtbaren Personen. */
export function computeProgress(input: ProgressInput): ProgressResult {
  const n = Math.max(1, Math.floor(input.generations));
  const slots = assignRingSlots({
    rootId: input.rootId,
    generations: n,
    parentsOf: input.parentsOf,
    visible: input.visible,
  });

  // Zustand jedes Platzes, Generation für Generation; hinter einem nicht
  // freigegebenen Platz ist alles „nicht freigegeben“.
  const byKey = new Map(slots.map((s) => [`${s.generation}:${s.index}`, s]));
  const states: SlotState[][] = [[{ kind: "person", personId: input.rootId }]];
  for (let g = 1; g <= n; g++) {
    const row: SlotState[] = [];
    for (let i = 0; i < 2 ** g; i++) {
      const child = states[g - 1][i >> 1];
      const slot = byKey.get(`${g}:${i}`);
      if (child.kind === "restricted") row.push({ kind: "restricted" });
      else if (!slot) row.push({ kind: "missing" });
      else row.push(slot.kind === "person" ? { kind: "person", personId: slot.personId } : { kind: "restricted" });
    }
    states.push(row);
  }

  // Spätester Geburtszeitpunkt je Person: eigene Geburt oder die eines
  // Nachkommen in der Linie (Kind, Enkel … bis zur Ausgangsperson).
  const bornBy = new Map<string, number>();
  const slotBornBy: number[][] = [];
  for (let g = 0; g <= n; g++) {
    slotBornBy.push(
      states[g].map((s, i) => {
        if (s.kind !== "person") return Infinity;
        const own = latest(input.person(s.personId)?.birth ?? null);
        const value = g === 0 ? own : Math.min(own, slotBornBy[g - 1][i >> 1]);
        bornBy.set(s.personId, Math.min(bornBy.get(s.personId) ?? Infinity, value));
        return value;
      }),
    );
  }

  // Erste (nächste) Stelle jeder sichtbaren Person.
  const firstAt = new Map<string, { generation: number; index: number }>();
  states.forEach((row, g) =>
    row.forEach((s, i) => {
      if (s.kind === "person" && !firstAt.has(s.personId)) firstAt.set(s.personId, { generation: g, index: i });
    }),
  );

  const uniqueParents = (id: string) => {
    const seen = new Set<string>();
    return input.parentsOf(id).filter((p) => !seen.has(p.id) && Boolean(seen.add(p.id)));
  };

  const quality = new Map<string, PersonQuality>();
  for (const id of firstAt.keys()) {
    const p = input.person(id);
    if (!p) continue;
    quality.set(
      id,
      personQuality(p, {
        parentCount: uniqueParents(id).length,
        bornBy: bornBy.get(id) ?? Infinity,
        now: input.now,
        birthEvidence: input.evidence(id, "BIRTH"),
        deathEvidence: input.evidence(id, "DEATH"),
      }),
    );
  }

  const personIds = (row: readonly SlotState[]) => row.flatMap((s) => (s.kind === "person" ? [s.personId] : []));

  const byGeneration: GenerationRow[] = [];
  for (let g = 1; g <= n; g++) {
    byGeneration.push({
      generation: g,
      label: generationName(g),
      ...countStates(states[g]),
      quality: summarize(personIds(states[g]), quality),
    });
  }

  const allStates = states.slice(1).flat();
  const total = countStates(allStates);

  const lines: LineRow[] = LINE_KEYS.map((line, li) => {
    const lineStates: SlotState[] = [];
    for (let g = 2; g <= n; g++) {
      const width = 2 ** (g - 2);
      lineStates.push(...states[g].slice(li * width, (li + 1) * width));
    }
    const gp = states[2]?.[li];
    const gpPerson = gp?.kind === "person" ? input.person(gp.personId) : undefined;
    return {
      line,
      code: LINE_CODE[line],
      label: LINE_LABEL[line],
      grandparent:
        gp?.kind === "person" && gpPerson
          ? { kind: "person" as const, id: gpPerson.id, name: gpPerson.name }
          : gp?.kind === "restricted"
            ? { kind: "restricted" as const }
            : null,
      ...countStates(lineStates),
      quality: summarize(personIds(lineStates), quality),
    };
  });

  // Vorschläge: je sichtbarer Person an ihrer nächsten Stelle.
  const suggestions: Suggestion[] = [];
  for (const [id, at] of firstAt) {
    const p = input.person(id);
    const q = quality.get(id);
    if (!p || !q) continue;
    const about = birthSummary(p);
    const prospect = (p.birth ? 1 : 0) + (p.birthPlace?.trim() ? 1 : 0);
    const add = (kind: SuggestionKind, title: string, context: string, cutOff = 0, ownDetail?: string) =>
      suggestions.push({
        kind,
        personId: id,
        name: p.name,
        generation: at.generation,
        title,
        detail: ownDetail ?? [about, context].filter(Boolean).join(" · "),
        prospect,
        cutOff,
      });

    const parents = uniqueParents(id);
    if (parents.length < 2) {
      const missingCount = 2 - parents.length;
      // Plätze, die hinter den fehlenden Eltern bis zur gewählten Tiefe fehlen.
      const cutOff = at.generation < n ? missingCount * (2 ** (n - at.generation) - 1) : 0;
      let title: string;
      if (parents.length === 0) title = `Eltern von ${p.name} fehlen`;
      else {
        // Ein nicht sichtbarer Elternteil kommt mit Geschlecht UNKNOWN an —
        // sein Geschlecht verrät also nicht, welcher Elternteil fehlt.
        const sex = parents[0].gender;
        title =
          sex === "MALE"
            ? `Mutter von ${p.name} fehlt`
            : sex === "FEMALE"
              ? `Vater von ${p.name} fehlt`
              : `Ein Elternteil von ${p.name} fehlt`;
      }
      const where = `nächste Lücke ${lineContext(at.generation, at.index)}`;
      add(
        "missingParents",
        title,
        cutOff > 0 ? `${where} — dahinter fehlen ${cutOff} Plätze bis zur ${n}. Generation` : where,
        cutOff,
      );
    }
    if (!hasBirthDate(p)) add("missingBirthDate", `Geburtsdatum von ${p.name} fehlt`, "");
    if (q.mortal && !hasDeathDate(p)) {
      const born = formatFuzzyYear(p.birth);
      const place = p.birthPlace?.trim();
      const bornText = born ? `geboren ${born}${place ? ` in ${place}` : ""}` : "";
      add(
        "missingDeathDate",
        `Sterbedatum von ${p.name} fehlt`,
        "",
        0,
        [bornText, q.presumedDead ? "vermutlich verstorben" : ""].filter(Boolean).join(" · "),
      );
    }
    const birthEv = input.evidence(id, "BIRTH");
    const deathEv = input.evidence(id, "DEATH");
    if (birthRecorded(p) && birthEv === "hintOnly") {
      add(
        "birthHintOnly",
        `Geburt von ${p.name} ist nur durch einen fremden Stammbaum belegt`,
        "nur ein Hinweis, kein Beleg — mit Kirchenbuch oder Standesamt bestätigen",
      );
    }
    if (!p.birthPlace?.trim()) add("missingBirthPlace", `Geburtsort von ${p.name} fehlt`, "");
    if (q.mortal && deathRecorded(p) && deathEv === "hintOnly") {
      add(
        "deathHintOnly",
        `Tod von ${p.name} ist nur durch einen fremden Stammbaum belegt`,
        "nur ein Hinweis, kein Beleg — mit Kirchenbuch oder Standesamt bestätigen",
      );
    }
    if (birthRecorded(p) && birthEv === "none") add("birthUnsourced", `Geburt von ${p.name} ist nicht belegt`, "");
    if (q.mortal && deathRecorded(p) && deathEv === "none") add("deathUnsourced", `Tod von ${p.name} ist nicht belegt`, "");
    if (q.mortal && hasDeathDate(p) && !p.deathPlace?.trim()) add("missingDeathPlace", `Sterbeort von ${p.name} fehlt`, "");
  }
  suggestions.sort(compareSuggestions);

  return {
    generations: n,
    total,
    quality: summarize(personIds(allStates), quality),
    byGeneration,
    lines,
    suggestions: suggestions.slice(0, PROGRESS_MAX_SUGGESTIONS),
    suggestionsTotal: suggestions.length,
  };
}
