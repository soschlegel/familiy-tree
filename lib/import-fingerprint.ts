import { createHash } from "node:crypto";

/**
 * Fingerabdruck importierter Werte — die Grundlage dafür, bei einem erneuten
 * Import zu erkennen, ob ein Datensatz seit dem letzten Import in der App
 * geändert wurde (ImportLink.importHash, siehe prisma/schema.prisma).
 *
 * Gehasht werden genau die Spalten, die ein Import schreibt, in fester
 * Reihenfolge und kanonischer Form (Datum als ISO, fehlend = null). Dieselbe
 * Funktion läuft über die Zeile, die der Import schreibt, und über die Zeile,
 * die später in der Datenbank steht — stimmen beide überein, ist der
 * Datensatz unverändert. Ändert sich die Feldliste in einer späteren Version,
 * gelten alle älteren Importe als „geändert“ (sicher: nichts wird
 * überschrieben, die Vorschau fragt nach); deshalb trägt der Hash die
 * Versionsnummer.
 */

export const IMPORT_ENTITIES = [
  "PERSON",
  "RELATIONSHIP",
  "EVENT",
  "PERSON_NAME",
  "CITATION",
  "SOURCE",
  "MEDIA",
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

const FINGERPRINT_VERSION = 1;

const dateCols = (key: string) => [key, `${key}Precision`, `${key}Qualifier`, `${key}To`, `${key}ToPrecision`, `${key}Phrase`];

export const FINGERPRINT_FIELDS: Record<ImportEntity, readonly string[]> = {
  PERSON: [
    "givenName",
    "familyName",
    "birthName",
    "nickname",
    "namePrefix",
    "nameSuffix",
    "gender",
    ...dateCols("birthDate"),
    "birthPlace",
    ...dateCols("deathDate"),
    "deathPlace",
    "deathCause",
    "notes",
  ],
  RELATIONSHIP: [
    "type",
    "subtype",
    "fromPersonId",
    "toPersonId",
    ...dateCols("startDate"),
    "startPlace",
    ...dateCols("endDate"),
    "endPlace",
    "notes",
  ],
  EVENT: [
    "personId",
    "relationshipId",
    "type",
    "label",
    "isAlternative",
    ...dateCols("date"),
    "place",
    "address",
    "value",
    "cause",
    "age",
    "agency",
    "notes",
    "sortOrder",
  ],
  PERSON_NAME: ["personId", "type", "givenName", "familyName", "prefix", "suffix", "nickname", "label", "notes", "sortOrder"],
  CITATION: ["sourceId", "personId", "relationshipId", "eventId", "fact", "detail", "confidence", "text"],
  SOURCE: ["title", "kind", "kindLabel", "author", "repository", "callNumber", "url", ...dateCols("date"), "notes"],
  MEDIA: ["fileName", "caption"],
};

function canonical(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return v;
}

/** Fingerabdruck (SHA-256, hex) der Importfelder einer Zeile. */
export function importFingerprint(entity: ImportEntity, row: Record<string, unknown>): string {
  const values = FINGERPRINT_FIELDS[entity].map((f) => canonical(row[f]));
  return createHash("sha256")
    .update(JSON.stringify([FINGERPRINT_VERSION, entity, values]))
    .digest("hex");
}
