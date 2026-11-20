/**
 * Regeln für das Zusammenführen zweier Personen (Dubletten) — rein, ohne
 * Datenbank, damit Vorschau, Zusammenführen, Massen-Zusammenführen und Tests
 * dieselben Regeln verwenden. Der Dienst dazu: lib/services/merge.ts.
 *
 * ## Hauptangaben (Spalten der Person)
 * Je Feld wählt der Benutzer den Wert der bleibenden („keep“) oder der
 * aufgehenden Person („other“); Notizen auch „beide“. Vorgabe:
 * - gleich oder nur auf einer Seite vorhanden → dieser Wert;
 * - Datum: ist eine Seite genauer und mit der anderen vereinbar („um 1760“
 *   und „12.03.1760“), die genauere — ohne abweichende Zweitangabe;
 * - Nachname/Geburtsname: Führt die eine Person den Geburtsnamen als
 *   Nachnamen und die andere „Ehename geb. Geburtsname“, wird es eine
 *   Person mit Ehename als Nachname und gesetztem Geburtsnamen;
 * - sonst der Wert der bleibenden Person; Notizen: beide.
 * Nichts geht verloren: Eine nicht gewählte, abweichende Geburts- bzw.
 * Todesangabe wird ein Ereignis BIRTH/DEATH mit isAlternative (lib/events.ts),
 * ein nicht gewählter Name eine Namensvariante (PersonName) — außer, er steckt
 * schon im Ergebnis (Nachname oder Geburtsname) oder in einer vorhandenen
 * Variante. Nur das Geschlecht lässt sich nicht als Zweitangabe ablegen; ein
 * abweichendes, nicht gewähltes Geschlecht steht im Ergebnis unter „dropped“.
 */
import {
  dateBounds,
  formatDateWithPhrase,
  fuzzyField,
  sameFuzzyDate,
  type FuzzyDate,
  type FuzzyKey,
} from "./dates";
import { editDistance, nameKey, samePlace } from "./name-keys";

export type MergeSide = "keep" | "other";
export type FieldChoice = MergeSide | "both";

export const MERGE_FIELDS = [
  "givenName",
  "familyName",
  "birthName",
  "nickname",
  "namePrefix",
  "nameSuffix",
  "gender",
  "birthDate",
  "birthPlace",
  "deathDate",
  "deathPlace",
  "deathCause",
  "notes",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_LABEL: Record<MergeField, string> = {
  givenName: "Vorname",
  familyName: "Nachname",
  birthName: "Geburtsname",
  nickname: "Rufname",
  namePrefix: "Titel/Vorsatz",
  nameSuffix: "Namenszusatz",
  gender: "Geschlecht",
  birthDate: "Geburtsdatum",
  birthPlace: "Geburtsort",
  deathDate: "Sterbedatum",
  deathPlace: "Sterbeort",
  deathCause: "Todesursache",
  notes: "Notizen",
};

const GENDER_LABEL: Record<string, string> = { MALE: "männlich", FEMALE: "weiblich", OTHER: "divers", UNKNOWN: "unbekannt" };

const dateCols = (key: "birthDate" | "deathDate") => [
  key,
  `${key}Precision`,
  `${key}Qualifier`,
  `${key}To`,
  `${key}ToPrecision`,
  `${key}Phrase`,
];

/** Spalten der Person, die ein Feld umfasst (ein Datum samt Genauigkeit und Wortlaut). */
export function fieldColumns(field: MergeField): string[] {
  return field === "birthDate" || field === "deathDate" ? dateCols(field) : [field];
}

/** Alle Spalten, die das Zusammenführen an der bleibenden Person setzt. */
export const MERGE_COLUMNS: string[] = MERGE_FIELDS.flatMap(fieldColumns);

export type PersonValues = Record<string, unknown> & { givenName: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function dateOf(p: PersonValues, field: "birthDate" | "deathDate"): FuzzyDate | null {
  return fuzzyField(p, field as FuzzyKey);
}

/** Feld leer? (Geschlecht UNKNOWN zählt als leer.) */
export function fieldEmpty(p: PersonValues, field: MergeField): boolean {
  if (field === "gender") return !p.gender || p.gender === "UNKNOWN";
  if (field === "birthDate" || field === "deathDate") return !dateOf(p, field) && !str(p[`${field}Phrase`]);
  return !str(p[field]);
}

/** Gleicher Wert (Datum: gleiche Angabe und gleicher Wortlaut). */
export function fieldEqual(a: PersonValues, b: PersonValues, field: MergeField): boolean {
  if (field === "birthDate" || field === "deathDate") {
    return sameFuzzyDate(dateOf(a, field), dateOf(b, field)) && str(a[`${field}Phrase`]) === str(b[`${field}Phrase`]);
  }
  if (field === "gender") return (a.gender ?? "UNKNOWN") === (b.gender ?? "UNKNOWN");
  return str(a[field]) === str(b[field]);
}

/** Anzeige eines Feldes (deutsch). */
export function fieldText(p: PersonValues, field: MergeField): string {
  if (field === "gender") return GENDER_LABEL[String(p.gender ?? "UNKNOWN")] ?? String(p.gender);
  if (field === "birthDate" || field === "deathDate") return formatDateWithPhrase(dateOf(p, field), str(p[`${field}Phrase`]) || null);
  return str(p[field]);
}

/**
 * Ist `fine` eine genauere Lesart von `coarse`? („12.03.1760“ zu „um 1760“,
 * „1760“ zu „zwischen 1755 und 1765“.) Der Zeitraum der genaueren Angabe muss
 * ganz im (großzügig gelesenen) Zeitraum der ungenaueren liegen und echt
 * kleiner sein.
 */
export function refinesDate(fine: FuzzyDate | null, coarse: FuzzyDate | null): boolean {
  if (!fine || !coarse || sameFuzzyDate(fine, coarse)) return false;
  const f = dateBounds(fine, { tolerant: false });
  const c = dateBounds(coarse);
  if (!Number.isFinite(f.start) || !Number.isFinite(f.end)) return false;
  return f.start >= c.start && f.end <= c.end && f.end - f.start < c.end - c.start;
}

/** Zwei Datumsangaben vereinbar (gleich oder eine verfeinert die andere)? */
export function datesCompatible(a: FuzzyDate | null, b: FuzzyDate | null): boolean {
  if (!a || !b) return true;
  return sameFuzzyDate(a, b) || refinesDate(a, b) || refinesDate(b, a);
}

export type FieldComparison = {
  field: MergeField;
  label: string;
  keep: string;
  other: string;
  /** Beide Seiten haben einen Wert, und er ist verschieden. */
  differs: boolean;
  /** Erlaubte Wahl (Notizen: auch „both“). */
  options: FieldChoice[];
  /** Vorgabe nach den Regeln oben. */
  choice: FieldChoice;
  /** Warum diese Vorgabe (nur bei Abweichung bzw. leerer Seite). */
  why?: string;
};

export type MergeChoices = Partial<Record<MergeField, FieldChoice>>;

/** Vorgaben je Feld samt Begründung (siehe Kopf). */
export function compareFields(keep: PersonValues, other: PersonValues): FieldComparison[] {
  const out: FieldComparison[] = [];
  // Nachname/Geburtsname: die „bekannt unter Geburtsname“ ↔ „Ehename geb. …“-Regel
  const kF = nameKey(str(keep.familyName));
  const kB = nameKey(str(keep.birthName));
  const oF = nameKey(str(other.familyName));
  const oB = nameKey(str(other.birthName));
  const marriedFromOther = !kB && Boolean(oB) && Boolean(oF) && oB === kF && oF !== kF;
  const marriedFromKeep = !oB && Boolean(kB) && Boolean(kF) && kB === oF && kF !== oF;

  for (const field of MERGE_FIELDS) {
    const kEmpty = fieldEmpty(keep, field);
    const oEmpty = fieldEmpty(other, field);
    const equal = fieldEqual(keep, other, field) || (kEmpty && oEmpty);
    const differs = !kEmpty && !oEmpty && !equal;
    let choice: FieldChoice = "keep";
    let why: string | undefined;
    if (field === "notes" && differs) {
      choice = "both";
      why = "Beide Notizen werden aneinandergehängt";
    } else if (marriedFromOther && (field === "familyName" || field === "birthName")) {
      choice = "other";
      why =
        field === "familyName"
          ? "Der bleibende Eintrag führt den Geburtsnamen als Nachnamen — Ehename aus dem anderen"
          : "Geburtsname aus dem anderen Eintrag";
    } else if (marriedFromKeep && field === "familyName") {
      choice = "keep";
      why = "Der Nachname des anderen Eintrags ist der Geburtsname des bleibenden";
    } else if (kEmpty && !oEmpty) {
      choice = "other";
      why = "Nur beim anderen Eintrag vorhanden";
    } else if (differs && (field === "birthDate" || field === "deathDate")) {
      const k = dateOf(keep, field);
      const o = dateOf(other, field);
      if (refinesDate(o, k)) {
        choice = "other";
        why = "Genauere, damit vereinbare Angabe";
      } else if (refinesDate(k, o)) {
        why = "Genauere, damit vereinbare Angabe";
      } else {
        why = "Widersprüchlich — die andere Angabe bleibt als abweichende Zweitangabe erhalten";
      }
    }
    out.push({
      field,
      label: MERGE_FIELD_LABEL[field],
      keep: fieldText(keep, field),
      other: fieldText(other, field),
      differs,
      options: field === "notes" ? ["keep", "other", "both"] : ["keep", "other"],
      choice,
      ...(why && (differs || kEmpty !== oEmpty || marriedFromOther) ? { why } : {}),
    });
  }
  return out;
}

export const NOTES_SEPARATOR = "\n\n———\n\n";

// ---------------------------------------------------------------------------
// Ergebnis berechnen
// ---------------------------------------------------------------------------

/** Abweichende Zweitangabe, die als Ereignis (isAlternative) angelegt wird. */
export type AlternateFact = {
  type: "BIRTH" | "DEATH" | "MARRIAGE" | "DIVORCE";
  /** Woher: Seite der Person bzw. Beziehung. */
  from: MergeSide;
  date: FuzzyDate | null;
  datePhrase: string | null;
  place: string | null;
  cause: string | null;
};

export type NameDraft = {
  type: "BIRTH" | "VARIANT" | "ALIAS";
  givenName: string | null;
  familyName: string | null;
  prefix: string | null;
  suffix: string | null;
  nickname: string | null;
  from: MergeSide;
};

/** Vorhandene Namensvariante (zum Prüfen, ob ein Name schon erfasst ist). */
export type ExistingName = { type: string; givenName: string | null; familyName: string | null };

export type ResolvedPerson = {
  /** Neue Werte der bleibenden Person (alle MERGE_COLUMNS). */
  columns: Record<string, unknown>;
  alternates: AlternateFact[];
  names: NameDraft[];
  /** Bewusst verworfene Angaben (für das Ergebnis, in ganzen Sätzen). */
  dropped: string[];
  /** Die gewählten Werte, wie angewandt (für Audit und erneuten Import). */
  choices: Record<MergeField, FieldChoice>;
};

function birthOrDeath(p: PersonValues, kind: "birth" | "death") {
  const key = kind === "birth" ? "birthDate" : "deathDate";
  return {
    date: dateOf(p, key),
    phrase: str(p[`${key}Phrase`]) || null,
    place: str(p[kind === "birth" ? "birthPlace" : "deathPlace"]) || null,
    cause: kind === "death" ? str(p.deathCause) || null : null,
  };
}

/** Steckt die Angabe `s` schon im Ergebnis `r` (gleich, verfeinert, leer)? */
function factCovered(s: ReturnType<typeof birthOrDeath>, r: ReturnType<typeof birthOrDeath>): boolean {
  const dateOk =
    (!s.date && !s.phrase) ||
    (sameFuzzyDate(s.date, r.date) && (s.phrase ?? "") === (r.phrase ?? "")) ||
    (!s.phrase && refinesDate(r.date, s.date)) ||
    (!s.date && s.phrase === r.phrase);
  const placeOk = !s.place || s.place === r.place || samePlace(s.place, r.place);
  const causeOk = !s.cause || s.cause === r.cause;
  return dateOk && placeOk && causeOk;
}

function similarSpelling(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return !x && !y;
  return x === y || editDistance(x, y) <= 2;
}

/**
 * Neue Werte, Zweitangaben und Namensvarianten nach den gewählten Feldern.
 * `existingNames`: Namensvarianten beider Personen (vor dem Zusammenführen).
 */
export function resolvePersonMerge(
  keep: PersonValues,
  other: PersonValues,
  choicesIn: MergeChoices,
  existingNames: ExistingName[] = [],
  labels: { keep: string; other: string } = { keep: "bleibende Person", other: "andere Person" },
): ResolvedPerson {
  const defaults = compareFields(keep, other);
  const choices = Object.fromEntries(
    defaults.map((d) => {
      const c = choicesIn[d.field];
      return [d.field, c && d.options.includes(c) ? c : d.choice];
    }),
  ) as Record<MergeField, FieldChoice>;

  const columns: Record<string, unknown> = {};
  for (const field of MERGE_FIELDS) {
    const c = choices[field];
    if (field === "notes") {
      const k = str(keep.notes);
      const o = str(other.notes);
      columns.notes =
        c === "both" ? ([k, o].filter(Boolean).join(NOTES_SEPARATOR) || null) : (c === "other" ? o : k) || null;
      if (c === "both" && k && o && k === o) columns.notes = k;
      continue;
    }
    const src = c === "other" ? other : keep;
    for (const col of fieldColumns(field)) columns[col] = src[col] ?? null;
  }
  if (!str(columns.givenName)) columns.givenName = keep.givenName;

  const result = columns as PersonValues;
  const alternates: AlternateFact[] = [];
  for (const kind of ["birth", "death"] as const) {
    const r = birthOrDeath(result, kind);
    for (const [side, p] of [
      ["keep", keep],
      ["other", other],
    ] as const) {
      const s = birthOrDeath(p, kind);
      if (factCovered(s, r)) continue;
      alternates.push({
        type: kind === "birth" ? "BIRTH" : "DEATH",
        from: side,
        date: s.date,
        datePhrase: s.phrase,
        place: s.place,
        cause: s.cause,
      });
    }
  }

  // Namen
  const G = str(result.givenName);
  const F = str(result.familyName);
  const B = str(result.birthName);
  const known: ExistingName[] = [...existingNames];
  const isKnown = (given: string, family: string) =>
    known.some((n) => nameKey(n.givenName ?? G) === nameKey(given) && nameKey(n.familyName) === nameKey(family));
  const names: NameDraft[] = [];
  for (const [side, p] of [
    ["keep", keep],
    ["other", other],
  ] as const) {
    const g = str(p.givenName);
    const f = str(p.familyName);
    const b = str(p.birthName);
    const partsEqual = (["nickname", "namePrefix", "nameSuffix"] as const).every(
      (k) => !str(p[k]) || str(p[k]) === str(result[k]),
    );
    const surnameCovered = !f || nameKey(f) === nameKey(F) || nameKey(f) === nameKey(B);
    if (!(nameKey(g) === nameKey(G) && surnameCovered && partsEqual) && !isKnown(g, f)) {
      const spelling = similarSpelling(g, G) && (!f || similarSpelling(f, F) || similarSpelling(f, B));
      const draft: NameDraft = {
        type: spelling ? "VARIANT" : "ALIAS",
        givenName: g || null,
        familyName: f || null,
        prefix: str(p.namePrefix) || null,
        suffix: str(p.nameSuffix) || null,
        nickname: str(p.nickname) || null,
        from: side,
      };
      names.push(draft);
      known.push({ type: draft.type, givenName: draft.givenName, familyName: draft.familyName });
    }
    if (b && nameKey(b) !== nameKey(B) && nameKey(b) !== nameKey(F) && !isKnown(g || G, b)) {
      names.push({ type: "BIRTH", givenName: g || null, familyName: b, prefix: null, suffix: null, nickname: null, from: side });
      known.push({ type: "BIRTH", givenName: g || null, familyName: b });
    }
  }

  const dropped: string[] = [];
  if (!fieldEmpty(keep, "gender") && !fieldEmpty(other, "gender") && keep.gender !== other.gender) {
    const loser = choices.gender === "other" ? keep : other;
    const label = choices.gender === "other" ? labels.keep : labels.other;
    dropped.push(`Geschlecht „${fieldText(loser, "gender")}“ von ${label} wird verworfen.`);
  }
  if (choices.notes !== "both") {
    const loser = choices.notes === "other" ? keep : other;
    if (str(loser.notes) && str(loser.notes) !== str(result.notes)) {
      dropped.push(`Notizen von ${choices.notes === "other" ? labels.keep : labels.other} werden verworfen.`);
    }
  }
  return { columns, alternates, names, dropped, choices };
}

// ---------------------------------------------------------------------------
// Beziehungen
// ---------------------------------------------------------------------------

/** Rang der Art einer Partnerschaft: bestimmter schlägt unbestimmter. */
export const PARTNER_SUBTYPE_RANK: Record<string, number> = {
  DIVORCED: 4,
  MARRIED: 3,
  UNMARRIED: 2,
  PARTNER_UNKNOWN: 1,
};

/** Eltern-Kind: Adoptiv/Stief/Pflege ist genauer als die Vorgabe „leiblich“. */
export function moreSpecificSubtype(type: "PARENT_OF" | "PARTNER_OF", a: string, b: string): string {
  if (a === b) return a;
  if (type === "PARTNER_OF") return (PARTNER_SUBTYPE_RANK[b] ?? 0) > (PARTNER_SUBTYPE_RANK[a] ?? 0) ? b : a;
  if (a === "BIOLOGICAL") return b;
  return a;
}

/** Art einer Beziehung in Sätzen. */
export const SUBTYPE_TEXT: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "Adoption",
  STEP: "Stiefeltern",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
  PARTNER_UNKNOWN: "Ehestand unbekannt",
};

export type RelationshipValues = Record<string, unknown> & {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
};

export type ResolvedRelationship = {
  /** Neue Werte der bleibenden Beziehung (nur geänderte Spalten). */
  patch: Record<string, unknown>;
  alternates: AlternateFact[];
  dropped: string[];
};

const relDateCols = (key: "startDate" | "endDate") => [
  key,
  `${key}Precision`,
  `${key}Qualifier`,
  `${key}To`,
  `${key}ToPrecision`,
  `${key}Phrase`,
];

/**
 * Zwei gleiche Beziehungen (dieselben Personen nach dem Umhängen) werden eine:
 * genauere Art, fehlende Daten/Orte ergänzt, genauere vereinbare Daten
 * übernommen; abweichende Heirat/Scheidung der wegfallenden Beziehung als
 * Zweitangabe MARRIAGE/DIVORCE (nur Partnerschaften — bei Eltern-Kind steht
 * ein abweichender Beginn in den Notizen), Notizen aneinandergehängt.
 * `subtypeChoice` überschreibt die Art.
 */
export function resolveRelationshipMerge(
  keep: RelationshipValues,
  other: RelationshipValues,
  subtypeChoice?: string | null,
): ResolvedRelationship {
  const patch: Record<string, unknown> = {};
  const alternates: AlternateFact[] = [];
  const dropped: string[] = [];
  const subtype = subtypeChoice ?? moreSpecificSubtype(keep.type, keep.subtype, other.subtype);
  if (subtype !== keep.subtype) patch.subtype = subtype;
  const losingSubtype = subtype === keep.subtype ? other.subtype : keep.subtype;
  if (losingSubtype !== subtype) dropped.push(`Art „${SUBTYPE_TEXT[losingSubtype] ?? losingSubtype}“ wird zu „${SUBTYPE_TEXT[subtype] ?? subtype}“.`);

  const extraNotes: string[] = [];
  for (const [key, placeKey, altType] of [
    ["startDate", "startPlace", "MARRIAGE"],
    ["endDate", "endPlace", "DIVORCE"],
  ] as const) {
    const kd = fuzzyField(keep, key);
    const od = fuzzyField(other, key);
    const kp = str(keep[`${key}Phrase`]) || null;
    const op = str(other[`${key}Phrase`]) || null;
    const kPlace = str(keep[placeKey]) || null;
    const oPlace = str(other[placeKey]) || null;
    let date = { d: kd, p: kp };
    if ((!kd && !kp && (od || op)) || refinesDate(od, kd)) {
      date = { d: od, p: op };
      for (const c of relDateCols(key)) patch[c] = other[c] ?? null;
    }
    const place = kPlace ?? oPlace;
    if (!kPlace && oPlace) patch[placeKey] = oPlace;
    // Ist die Angabe der wegfallenden Beziehung abgedeckt?
    const covered = (s: { d: FuzzyDate | null; p: string | null; place: string | null }) =>
      ((!s.d && !s.p) || (sameFuzzyDate(s.d, date.d) && (s.p ?? "") === (date.p ?? "")) || (!s.p && refinesDate(date.d, s.d))) &&
      (!s.place || s.place === place || samePlace(s.place, place));
    for (const [side, s] of [
      ["keep", { d: kd, p: kp, place: kPlace }],
      ["other", { d: od, p: op, place: oPlace }],
    ] as const) {
      if (covered(s)) continue;
      if (keep.type === "PARTNER_OF") {
        alternates.push({ type: altType, from: side, date: s.d, datePhrase: s.p, place: s.place, cause: null });
      } else {
        const text = [formatDateWithPhrase(s.d, s.p), s.place].filter(Boolean).join(", ");
        extraNotes.push(`Abweichender ${key === "startDate" ? "Beginn" : "Endpunkt"} laut zusammengeführtem Eintrag: ${text}`);
      }
    }
  }
  const kn = str(keep.notes);
  const on = str(other.notes);
  const notes = [kn, on && on !== kn ? on : "", ...extraNotes].filter(Boolean).join(NOTES_SEPARATOR) || null;
  if ((notes ?? "") !== kn) patch.notes = notes;
  return { patch, alternates, dropped };
}

// ---------------------------------------------------------------------------
// Gleiche Untereinträge erkennen
// ---------------------------------------------------------------------------

const k = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined || v === null || v === "" ? null : v);

/** Schlüssel eines Ereignisses ohne Träger, Notizen und Reihenfolge. */
export function eventKey(e: Record<string, unknown>): string {
  return JSON.stringify(
    [
      "type",
      "label",
      "isAlternative",
      "date",
      "datePrecision",
      "dateQualifier",
      "dateTo",
      "dateToPrecision",
      "datePhrase",
      "place",
      "address",
      "value",
      "cause",
      "age",
      "agency",
    ].map((f) => k(e[f])),
  );
}

/** Schlüssel eines Belegs ohne Träger (eventId wird vorher umgehängt). */
export function citationKey(c: Record<string, unknown>): string {
  return JSON.stringify(["sourceId", "eventId", "fact", "detail", "confidence", "text"].map((f) => k(c[f])));
}

/** Schlüssel einer Namensvariante ohne Träger, Notizen und Reihenfolge. */
export function personNameKey(n: Record<string, unknown>): string {
  return JSON.stringify([
    k(n.type),
    nameKey(str(n.givenName)),
    nameKey(str(n.familyName)),
    k(n.prefix),
    k(n.suffix),
    k(n.nickname),
    k(n.label),
  ]);
}

/** Notizen zweier gleicher Untereinträge zusammenführen. */
export function mergeNotes(a: unknown, b: unknown): string | null {
  const x = str(a);
  const y = str(b);
  if (!y || x === y) return x || null;
  if (!x) return y;
  return `${x}${NOTES_SEPARATOR}${y}`;
}
