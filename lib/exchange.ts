import { z } from "zod";

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
 * Quellen und Belege. Alle neuen Felder sind optional — eine Datei der
 * Version 1 lässt sich unverändert importieren (Daten gelten dann als
 * tagesgenau, Quellen fehlen einfach).
 */
export const EXCHANGE_VERSION = 2;

const isoDate = z.string().datetime().nullable().optional();
const precision = z.enum(["DAY", "MONTH", "YEAR"]).optional();
const qualifier = z.enum(["EXACT", "ABOUT", "BEFORE", "AFTER"]).optional();

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
  familyName: z.string().nullable().optional(),
  birthName: z.string().nullable().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: isoDate,
  birthDatePrecision: precision,
  birthDateQualifier: qualifier,
  birthPlace: z.string().nullable().optional(),
  deathDate: isoDate,
  deathDatePrecision: precision,
  deathDateQualifier: qualifier,
  deathPlace: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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
    ])
    .default("BIOLOGICAL"),
  fromPersonId: z.string(),
  toPersonId: z.string(),
  startDate: isoDate,
  startDatePrecision: precision,
  startDateQualifier: qualifier,
  endDate: isoDate,
  endDatePrecision: precision,
  endDateQualifier: qualifier,
  notes: z.string().nullable().optional(),
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
  author: z.string().nullable().optional(),
  repository: z.string().nullable().optional(),
  callNumber: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  date: isoDate,
  datePrecision: precision,
  dateQualifier: qualifier,
  notes: z.string().nullable().optional(),
  /** Scan: Verweis auf einen Eintrag in `media`. */
  mediaId: z.string().nullable().optional(),
});

export const citationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  personId: z.string().nullable().optional(),
  relationshipId: z.string().nullable().optional(),
  fact: z.enum(["NAME", "BIRTH", "DEATH", "PARTNERSHIP", "PARENTAGE", "OTHER"]).default("OTHER"),
  detail: z.string().nullable().optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
});

export const exchangeSchema = z.object({
  version: z.number(),
  exportedAt: z.string().optional(),
  persons: z.array(personSchema),
  relationships: z.array(relationshipSchema),
  media: z.array(mediaSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  citations: z.array(citationSchema).default([]),
});

export type ExchangeFile = z.infer<typeof exchangeSchema>;
export type ExchangePerson = z.infer<typeof personSchema>;
export type ExchangeRelationship = z.infer<typeof relationshipSchema>;
export type ExchangeMedia = z.infer<typeof mediaSchema>;
export type ExchangeSource = z.infer<typeof sourceSchema>;
export type ExchangeCitation = z.infer<typeof citationSchema>;

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
