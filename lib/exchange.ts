import { z } from "zod";

import { EVENT_TYPES, PERSON_NAME_TYPES } from "./events";

/**
 * Austauschformat für Export und Import. Bewusst eine Datei für beide
 * Richtungen: was der Export schreibt, muss der Import lesen können, und ein
 * auseinandergelaufenes Schema fällt hier sofort auf.
 *
 * Bilder erscheinen als Verweis (fileName) plus Metadaten. Im ZIP-Export
 * liegen die Dateien unter media/<fileName> daneben.
 */

/**
 * Version 2: Genauigkeit/Zusatz der Daten (…Precision, …Qualifier) sowie
 * Quellen und Belege.
 *
 * Version 3: Datumsbereiche und Wortlaut (…To, …ToPrecision, …Phrase),
 * weitere Zusätze (geschätzt, errechnet, zwischen, von–bis, bis), Namensteile
 * (nickname, namePrefix, nameSuffix), Todesursache, Orte von Heirat/Scheidung
 * (startPlace, endPlace), Lebensereignisse (`events`), weitere Namen
 * (`personNames`), Belege an Ereignissen (eventId, fact EVENT, text),
 * Fremdkennungen (`externalIds`) und nicht zugeordnete Importdaten
 * (`rawRecords`). Importläufe selbst und ihre Herkunftsangaben (ImportLink)
 * gehören zur Instanz und werden nicht exportiert.
 *
 * Alle neuen Felder sind optional — Dateien der Versionen 1 und 2 lassen sich
 * unverändert importieren (Daten gelten dann als tagesgenau, fehlende
 * Abschnitte als leer).
 */
export const EXCHANGE_VERSION = 3;

const isoDate = z.string().datetime().nullable().optional();
const precision = z.enum(["DAY", "MONTH", "YEAR"]).optional();
const qualifier = z
  .enum(["EXACT", "ABOUT", "BEFORE", "AFTER", "ESTIMATED", "CALCULATED", "BETWEEN", "PERIOD", "UNTIL"])
  .optional();
const text = z.string().nullable().optional();

/** Bereichsende und Wortlaut eines Datumsfelds (ab Version 3). */
const dateExtras = <K extends string>(key: K) =>
  ({
    [`${key}To`]: isoDate,
    [`${key}ToPrecision`]: precision,
    [`${key}Phrase`]: text,
  }) as Record<`${K}To`, typeof isoDate> &
    Record<`${K}ToPrecision`, typeof precision> &
    Record<`${K}Phrase`, typeof text>;

export const mediaSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  caption: z.string().nullable().optional(),
  mimeType: z.string().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

export const personSchema = z.object({
  id: z.string(),
  givenName: z.string().min(1),
  familyName: text,
  birthName: text,
  nickname: text,
  namePrefix: text,
  nameSuffix: text,
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: isoDate,
  birthDatePrecision: precision,
  birthDateQualifier: qualifier,
  ...dateExtras("birthDate"),
  birthPlace: text,
  deathDate: isoDate,
  deathDatePrecision: precision,
  deathDateQualifier: qualifier,
  ...dateExtras("deathDate"),
  deathPlace: text,
  deathCause: text,
  notes: text,
  media: z
    .array(z.object({ mediaId: z.string(), isPrimary: z.boolean().default(false) }))
    .default([]),
});

export const relationshipSchema = z.object({
  id: z.string(),
  type: z.enum(["PARENT_OF", "PARTNER_OF"]),
  subtype: z
    .enum([
      "BIOLOGICAL",
      "ADOPTIVE",
      "STEP",
      "FOSTER",
      "MARRIED",
      "UNMARRIED",
      "DIVORCED",
      "PARTNER_UNKNOWN",
    ])
    .default("BIOLOGICAL"),
  fromPersonId: z.string(),
  toPersonId: z.string(),
  startDate: isoDate,
  startDatePrecision: precision,
  startDateQualifier: qualifier,
  ...dateExtras("startDate"),
  startPlace: text,
  endDate: isoDate,
  endDatePrecision: precision,
  endDateQualifier: qualifier,
  ...dateExtras("endDate"),
  endPlace: text,
  notes: text,
  media: z
    .array(z.object({ mediaId: z.string(), isPrimary: z.boolean().default(false) }))
    .default([]),
});

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  kind: z
    .enum(["CHURCH_BOOK", "CIVIL_REGISTRY", "CENSUS", "GRAVESTONE", "FAMILY_DOCUMENT", "ORAL", "WEBSITE", "OTHER"])
    .default("OTHER"),
  kindLabel: text,
  author: text,
  repository: text,
  callNumber: text,
  url: text,
  date: isoDate,
  datePrecision: precision,
  dateQualifier: qualifier,
  ...dateExtras("date"),
  notes: text,
  /** Scan: Verweis auf einen Eintrag in `media`. */
  mediaId: text,
});

export const citationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  personId: text,
  relationshipId: text,
  /** Ab Version 3: Beleg für ein Ereignis (personId/relationshipId = dessen Träger). */
  eventId: text,
  fact: z.enum(["NAME", "BIRTH", "DEATH", "PARTNERSHIP", "PARENTAGE", "OTHER", "EVENT"]).default("OTHER"),
  detail: text,
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  text,
});

/** Ab Version 3. */
export const eventSchema = z.object({
  id: z.string(),
  personId: text,
  relationshipId: text,
  type: z.enum(EVENT_TYPES),
  label: text,
  isAlternative: z.boolean().default(false),
  date: isoDate,
  datePrecision: precision,
  dateQualifier: qualifier,
  ...dateExtras("date"),
  place: text,
  address: text,
  value: text,
  cause: text,
  age: text,
  agency: text,
  notes: text,
  sortOrder: z.number().int().default(0),
});

/** Ab Version 3. */
export const personNameSchema = z.object({
  id: z.string(),
  personId: z.string(),
  type: z.enum(PERSON_NAME_TYPES).default("OTHER"),
  givenName: text,
  familyName: text,
  prefix: text,
  suffix: text,
  nickname: text,
  label: text,
  notes: text,
  sortOrder: z.number().int().default(0),
});

/** Ab Version 3: Fremdkennung (ohne Importlauf — der gehört zur Instanz). */
export const externalIdSchema = z.object({
  id: z.string(),
  system: z.string().min(1),
  value: z.string(),
  personId: text,
  relationshipId: text,
  eventId: text,
  sourceId: text,
  mediaId: text,
});

/** Ab Version 3: nicht zugeordnete Importdaten einer Person/Beziehung/Quelle. */
export const rawRecordSchema = z.object({
  id: z.string(),
  personId: text,
  relationshipId: text,
  sourceId: text,
  recordType: z.string().min(1),
  xref: text,
  content: z.unknown(),
  reason: text,
  superseded: z.boolean().optional(),
});

export const exchangeSchema = z.object({
  version: z.number(),
  exportedAt: z.string().optional(),
  persons: z.array(personSchema),
  relationships: z.array(relationshipSchema),
  media: z.array(mediaSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  citations: z.array(citationSchema).default([]),
  events: z.array(eventSchema).default([]),
  personNames: z.array(personNameSchema).default([]),
  externalIds: z.array(externalIdSchema).default([]),
  rawRecords: z.array(rawRecordSchema).default([]),
});

export type ExchangeFile = z.infer<typeof exchangeSchema>;
export type ExchangePerson = z.infer<typeof personSchema>;
export type ExchangeRelationship = z.infer<typeof relationshipSchema>;
export type ExchangeMedia = z.infer<typeof mediaSchema>;
export type ExchangeSource = z.infer<typeof sourceSchema>;
export type ExchangeCitation = z.infer<typeof citationSchema>;
export type ExchangeEvent = z.infer<typeof eventSchema>;
export type ExchangePersonName = z.infer<typeof personNameSchema>;
export type ExchangeExternalId = z.infer<typeof externalIdSchema>;
export type ExchangeRawRecord = z.infer<typeof rawRecordSchema>;

/**
 * Datumsspalten aus einem Datensatz der Datei. Ältere Dateien kennen keine
 * Genauigkeit, keinen Zusatz und kein Bereichsende: dann tagesgenau, genau,
 * ohne Ende. Ein Ende wird nur bei Bereichen (BETWEEN, PERIOD) übernommen.
 */
export function exchangeDateColumns<K extends string>(
  key: K,
  r: Record<string, unknown>,
): Record<string, Date | string | null> {
  const iso = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const date = iso(r[key]);
  const q = (date ? (r[`${key}Qualifier`] as string | undefined) : undefined) ?? "EXACT";
  const to = date && (q === "BETWEEN" || q === "PERIOD") ? iso(r[`${key}To`]) : null;
  return {
    [key]: date,
    [`${key}Precision`]: (date ? (r[`${key}Precision`] as string | undefined) : undefined) ?? "DAY",
    [`${key}Qualifier`]: q,
    [`${key}To`]: to,
    [`${key}ToPrecision`]: (to ? (r[`${key}ToPrecision`] as string | undefined) : undefined) ?? "DAY",
    [`${key}Phrase`]: (r[`${key}Phrase`] as string | null | undefined) ?? null,
  };
}

/** Gegenstück für den Export: Datumsspalten einer DB-Zeile als Datei-Felder. */
export function exportDateFields(key: string, row: Record<string, unknown>): Record<string, unknown> {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  return {
    [key]: iso(row[key]),
    [`${key}Precision`]: row[`${key}Precision`],
    [`${key}Qualifier`]: row[`${key}Qualifier`],
    [`${key}To`]: iso(row[`${key}To`]),
    [`${key}ToPrecision`]: row[`${key}ToPrecision`],
    [`${key}Phrase`]: row[`${key}Phrase`] ?? null,
  };
}

/**
 * Erzeugt einen im ZIP eindeutigen Dateinamen. Zwei Bilder dürfen denselben
 * ursprünglichen Namen tragen ("IMG_1234.jpg" kommt aus jeder Kamera) — ohne
 * Vereindeutigung würde eines das andere überschreiben.
 */
export function mediaFileName(
  asset: { id: string; fileName: string | null },
  taken: Set<string>,
): string {
  const raw = (asset.fileName ?? `${asset.id}.webp`).replace(/[/\\]/g, "_");
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  // Bilder werden beim Upload nach WebP konvertiert — die Endung muss das
  // widerspiegeln, sonst zeigt der Verweis auf ein Format, das nicht drin ist.
  let candidate = `${stem}.webp`;

  if (taken.has(candidate)) {
    candidate = `${stem}_${asset.id.slice(-6)}.webp`;
  }
  taken.add(candidate);
  return candidate;
}
