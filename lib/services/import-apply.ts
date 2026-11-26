import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../prisma";
import type { Scope } from "../scope";
import {
  DATE_PRECISIONS,
  DATE_QUALIFIERS,
  MAX_DATE_PHRASE_LENGTH,
  fuzzyColumns,
  toFuzzyDate,
  type DatePrecision,
  type FuzzyDate,
} from "../dates";
import { EVENT_TYPES, PERSON_NAME_TYPES, eventIssues, type EventTypeName } from "../events";
import { FINGERPRINT_FIELDS, OPTIONAL_FINGERPRINT_FIELDS, importFingerprint, type ImportEntity } from "../import-fingerprint";
import { MAX_URL_LENGTH, safeHttpUrl } from "../source-classify";

/** Vergleichsform eines Feldes (wie im Fingerabdruck). */
function canonicalValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return v;
}
import {
  ALL_SUBTYPES,
  CITATION_CONFIDENCES,
  CITATION_FACTS,
  MAX_BIOLOGICAL_PARENTS,
  PERSON_FACTS,
  SOURCE_KINDS,
  defaultSubtype,
  personDateIssues,
  relationshipFacts,
  relationshipIssues,
  eventDateIssues,
  type RelationTypeName,
} from "../validation";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { auditActor, auditData, fieldChanges } from "../audit";
import { changeSetIdOf } from "../change-sets";
import { importLinkColumn, loadRowsForFingerprint, MAX_RAW_RECORD_BYTES, newId } from "./imports";
import { eventKey, resolvePersonMerge, type ExistingName, type PersonValues } from "../merge-rules";

/**
 * Massenimport für GEDCOM- und andere Importe: Personen, Namen, Beziehungen,
 * Ereignisse, Quellen, Belege, Fremdkennungen und Rohdaten in EINEM Aufruf,
 * in einer Transaktion, mit createMany je Tabelle statt Einzel-Inserts.
 * Nur Administratoren (wie jeder Import).
 *
 * ## Verweise
 * Jeder Eintrag hat eine `ref` (frei, z.B. der GEDCOM-Xref "@I12@"); andere
 * Einträge verweisen über `personRef`, `relationshipRef`, `eventRef`,
 * `sourceRef` darauf — oder über `personId` usw. auf vorhandene Datensätze.
 *
 * ## Aktion je Eintrag (vom Aufrufer entschieden, z.B. nach der Vorschau)
 * - `create` (Standard): neu anlegen, Herkunft (ImportLink) mit Fingerabdruck.
 * - `update`: vorhandenen Datensatz `id` mit den Werten überschreiben.
 * - `updateIfUnchanged`: wie update, aber nur, wenn der Datensatz seit dem
 *   letzten Import nicht in der App geändert wurde (Fingerabdruck ==
 *   ImportLink.importHash); sonst Ergebnis `skippedEdited`, nichts wird
 *   geschrieben. Ohne ImportLink (manuell angelegt) ebenfalls `skippedEdited`.
 * - `skip`: nichts schreiben; die `ref` verweist dann auf `id` (falls
 *   angegeben), damit andere Einträge sich darauf beziehen können.
 * Sind die neuen Werte gleich den gespeicherten, ist das Ergebnis `unchanged`
 * (nur die Herkunft wird fortgeschrieben). Gelöscht wird nie.
 *
 * ## Ungültige Einträge
 * `onInvalid: "throw"` (Standard) bricht mit allen Fehlern ab, bevor etwas
 * geschrieben wird. `"skip"` lässt ungültige Einträge und alles, was davon
 * abhängt, aus und meldet sie in `invalid`.
 *
 * ## Transaktion
 * Ohne `tx` öffnet der Aufruf eine eigene (bis 5 Minuten). Mit `tx` läuft er
 * in der des Aufrufers — z.B. um Lauf, Bilder und Daten gemeinsam
 * zurückzurollen.
 */

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

/**
 * `link` (für den GEDCOM-Abgleich): den vorhandenen Datensatz `id` NICHT
 * ändern, aber seine Herkunft (ImportLink) auf die neuen Dateiwerte setzen —
 * „App-Version behalten, diese Dateiversion ist gesehen“. Ergebnis
 * `unchanged` (gleiche Werte) bzw. `skippedEdited` (App-Werte behalten).
 *
 * `enrich` (nur Personen; Vorschlag beim GEDCOM-Import, vom Administrator
 * ausdrücklich gewählt): die Person der Datei mit der vorhandenen Person `id`
 * verknüpfen — anreichern wie beim Zusammenführen (lib/merge-rules.ts,
 * `resolvePersonMerge` mit den Vorgaben): Leeres wird gefüllt, das genauere
 * Datum gewinnt, sonst bleibt der Wert der App; Widersprüchliches wird
 * Zweitangabe (Ereignis mit isAlternative) bzw. Namensvariante, Notizen
 * werden angehängt. Dazu ein weiterer Herkunftsvermerk dieses Baums (mit
 * `mergedAt`, damit ein erneuter Import ohne Neues still bleibt). Ergebnis
 * `linked`; je Person ein Eintrag „verknüpft“ mit vorher → nachher.
 */
const ACTIONS = ["create", "update", "updateIfUnchanged", "skip", "link", "enrich"] as const;
export type ImportAction = (typeof ACTIONS)[number];

const txt = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const longTxt = txt(50000);
const ref = z.string().min(1).max(300);
const optRef = ref.optional().nullable();
const optId = z.string().min(1).max(100).optional().nullable();

/**
 * Datum im Massenimport — strukturiert, nicht als Text:
 * `{ date: "1850" | "1850-03" | "1850-03-12" | ISO-Zeitstempel, precision?,
 * qualifier?, to?, toPrecision?, phrase? }`. Ohne precision ergibt sie sich
 * aus der Schreibweise. Nur Wortlaut: `{ phrase: "Weihnachten 1850" }`.
 */
export const bulkDateSchema = z
  .object({
    date: z.string().max(40).optional().nullable(),
    precision: z.enum(DATE_PRECISIONS as unknown as ["DAY", "MONTH", "YEAR"]).optional(),
    qualifier: z
      .enum(DATE_QUALIFIERS as unknown as ["EXACT", "ABOUT", "BEFORE", "AFTER", "ESTIMATED", "CALCULATED", "BETWEEN", "PERIOD", "UNTIL"])
      .optional(),
    to: z.string().max(40).optional().nullable(),
    toPrecision: z.enum(DATE_PRECISIONS as unknown as ["DAY", "MONTH", "YEAR"]).optional(),
    phrase: z.string().trim().max(MAX_DATE_PHRASE_LENGTH).optional().nullable(),
  })
  .nullable()
  .optional();
export type BulkDate = z.infer<typeof bulkDateSchema>;

function isoPrecision(s: string): DatePrecision {
  if (/^\d{4}$/.test(s)) return "YEAR";
  if (/^\d{4}-\d{1,2}$/.test(s)) return "MONTH";
  return "DAY";
}
function isoAnchor(s: string): string {
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return s;
  return `${m[1]}-${(m[2] ?? "1").padStart(2, "0")}-${(m[3] ?? "1").padStart(2, "0")}T00:00:00.000Z`;
}

/** BulkDate -> FuzzyDate + Wortlaut; Fehler als Text. */
export function resolveBulkDate(d: BulkDate): { value: FuzzyDate | null; phrase: string | null; error?: string } {
  if (!d) return { value: null, phrase: null };
  const phrase = d.phrase ? d.phrase : null;
  if (!d.date) return { value: null, phrase };
  const value = toFuzzyDate(
    isoAnchor(d.date),
    d.precision ?? isoPrecision(d.date),
    d.qualifier ?? "EXACT",
    d.to ? isoAnchor(d.to) : null,
    d.to ? (d.toPrecision ?? isoPrecision(d.to)) : undefined,
  );
  if (!value) return { value: null, phrase, error: `Datum „${d.date}“ ist ungültig` };
  if (d.to && !value.to) return { value, phrase, error: "Ein Bereichsende gibt es nur bei BETWEEN und PERIOD" };
  return { value, phrase };
}

const common = {
  ref,
  action: z.enum(ACTIONS).default("create"),
  /** Ziel bei update/updateIfUnchanged/skip. */
  id: optId,
  /** Schlüssel in der Quelle für ImportLink.externalKey, z.B. "UID:…" oder "XREF:@I12@". */
  externalKey: txt(500),
  /** Änderungsstempel der Quelle (z.B. _UPD, CHAN.DATE), wörtlich. */
  sourceStamp: txt(200),
};

const personItem = z.object({
  ...common,
  givenName: z.string().trim().min(1).max(200),
  familyName: txt(200),
  birthName: txt(200),
  nickname: txt(200),
  namePrefix: txt(200),
  nameSuffix: txt(200),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birth: bulkDateSchema,
  birthPlace: txt(),
  death: bulkDateSchema,
  deathPlace: txt(),
  deathCause: txt(),
  notes: longTxt,
  /** Familien neuer Personen; ohne Angabe die des Aufrufs. */
  familyIds: z.array(z.string().min(1)).max(50).optional(),
});

const personNameItem = z.object({
  ...common,
  personRef: optRef,
  personId: optId,
  type: z.enum(PERSON_NAME_TYPES).default("OTHER"),
  givenName: txt(200),
  familyName: txt(200),
  prefix: txt(200),
  suffix: txt(200),
  nickname: txt(200),
  label: txt(200),
  notes: txt(),
  sortOrder: z.number().int().default(0),
});

const relationshipItem = z.object({
  ...common,
  type: z.enum(["PARENT_OF", "PARTNER_OF"]),
  subtype: z.enum(ALL_SUBTYPES).optional().nullable(),
  fromRef: optRef,
  fromId: optId,
  toRef: optRef,
  toId: optId,
  start: bulkDateSchema,
  startPlace: txt(),
  end: bulkDateSchema,
  endPlace: txt(),
  notes: longTxt,
});

const eventItem = z.object({
  ...common,
  personRef: optRef,
  personId: optId,
  relationshipRef: optRef,
  relationshipId: optId,
  type: z.enum(EVENT_TYPES),
  label: txt(200),
  isAlternative: z.boolean().default(false),
  date: bulkDateSchema,
  place: txt(),
  address: txt(),
  value: txt(),
  cause: txt(),
  age: txt(60),
  agency: txt(),
  notes: longTxt,
  sortOrder: z.number().int().default(0),
});

const sourceItem = z.object({
  ...common,
  title: z.string().trim().min(1).max(300),
  kind: z.enum(SOURCE_KINDS).default("OTHER"),
  kindLabel: txt(200),
  provider: txt(200),
  author: txt(),
  repository: txt(),
  callNumber: txt(),
  url: txt(),
  date: bulkDateSchema,
  notes: longTxt,
});

const citationItem = z.object({
  ...common,
  sourceRef: optRef,
  sourceId: optId,
  personRef: optRef,
  personId: optId,
  relationshipRef: optRef,
  relationshipId: optId,
  eventRef: optRef,
  eventId: optId,
  fact: z.enum(CITATION_FACTS).default("OTHER"),
  detail: txt(),
  /** Internetadresse des Eintrags; nur http/https ohne Zugangsdaten (sonst ungültig). */
  url: txt(MAX_URL_LENGTH),
  confidence: z.enum(CITATION_CONFIDENCES).optional().nullable().transform((v) => v ?? null),
  text: txt(20000),
});

const targetRefs = {
  personRef: optRef,
  personId: optId,
  relationshipRef: optRef,
  relationshipId: optId,
  eventRef: optRef,
  eventId: optId,
  sourceRef: optRef,
  sourceId: optId,
};

const externalIdItem = z.object({
  system: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(500),
  ...targetRefs,
});

const rawRecordItem = z.object({
  recordType: z.string().trim().min(1).max(200),
  xref: txt(300),
  content: z.unknown(),
  reason: txt(),
  personRef: optRef,
  personId: optId,
  relationshipRef: optRef,
  relationshipId: optId,
  sourceRef: optRef,
  sourceId: optId,
  /** Ältere Rohdaten desselben Trägers als überholt markieren (Standard: ja). */
  replace: z.boolean().default(true),
});

export const genealogyImportSchema = z.object({
  /** Lauf (createImportBatch) — Herkunft für Links, Fremdkennungen, Rohdaten. */
  batchId: optId,
  /** Baum der Quelle; ohne Angabe der des Laufs. */
  sourceTreeId: txt(300),
  /** Familien für neue Personen (Rechte!). Leer = nur für Admins sichtbar. */
  familyIds: z.array(z.string().min(1)).max(50).default([]),
  persons: z.array(personItem).default([]),
  names: z.array(personNameItem).default([]),
  relationships: z.array(relationshipItem).default([]),
  events: z.array(eventItem).default([]),
  sources: z.array(sourceItem).default([]),
  citations: z.array(citationItem).default([]),
  externalIds: z.array(externalIdItem).default([]),
  rawRecords: z.array(rawRecordItem).default([]),
});
export type GenealogyImportInput = z.input<typeof genealogyImportSchema>;

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

export type ImportOutcome = "created" | "updated" | "unchanged" | "skippedEdited" | "skipped" | "linked" | "invalid";

type Section = "persons" | "names" | "relationships" | "events" | "sources" | "citations";
const SECTION_ENTITY: Record<Section, ImportEntity> = {
  persons: "PERSON",
  names: "PERSON_NAME",
  relationships: "RELATIONSHIP",
  events: "EVENT",
  sources: "SOURCE",
  citations: "CITATION",
};

export type GenealogyImportResult = {
  batchId: string | null;
  /** ref -> ID in der App (auch für unchanged/skipped mit id). */
  ids: Record<Section, Record<string, string>>;
  /** ref -> Ergebnis. */
  outcomes: Record<Section, Record<string, ImportOutcome>>;
  counts: Record<Section, Record<ImportOutcome, number>> & {
    externalIds: number;
    rawRecords: number;
    supersededRawRecords: number;
  };
  /** Ungültige Einträge (nur bei onInvalid "skip"; sonst wird geworfen). */
  invalid: { section: string; ref: string; path: string; message: string }[];
  /**
   * Je vorhandenem Ziel (update/updateIfUnchanged/link): welche Importfelder
   * sich zwischen App-Stand und neuen Werten unterscheiden, und ob die Datei
   * seit dem letzten Import dieses Datensatzes andere Werte liefert.
   */
  changes: Record<Section, Record<string, { fields: string[]; fileChangedSinceImport: boolean }>>;
};

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient;

type Pending<T> = { item: T; id: string; row: Record<string, unknown>; hash: string };

export async function applyGenealogyImport(
  scope: Scope,
  input: unknown,
  options: { tx?: Db; onInvalid?: "throw" | "skip"; now?: Date; dryRun?: boolean } = {},
): Promise<GenealogyImportResult> {
  if (!scope.isAdmin) throw forbiddenError("Daten zu importieren");
  const data = parseOrThrow(genealogyImportSchema.safeParse(input));
  const run = (db: Db) => applyInTx(scope, data, db, options.onInvalid ?? "throw", options.now ?? new Date(), options.dryRun ?? false);
  if (options.tx) return run(options.tx);
  return prisma.$transaction(run, { timeout: 5 * 60_000, maxWait: 10_000 });
}

async function applyInTx(
  scope: Scope,
  data: z.infer<typeof genealogyImportSchema>,
  db: Db,
  onInvalid: "throw" | "skip",
  now: Date,
  dryRun = false,
): Promise<GenealogyImportResult> {
  // Probelauf (Vorschau): alle Prüfungen und Ergebnisse, aber kein Schreiben.
  const write = !dryRun;
  const invalid: GenealogyImportResult["invalid"] = [];
  const sections: Section[] = ["persons", "names", "relationships", "events", "sources", "citations"];
  const ids = Object.fromEntries(sections.map((s) => [s, {}])) as GenealogyImportResult["ids"];
  const outcomes = Object.fromEntries(sections.map((s) => [s, {}])) as GenealogyImportResult["outcomes"];
  // Verzeichnisse statt Suchen über alle refs (große Importe: sonst quadratisch).
  const invalidIds = Object.fromEntries(sections.map((s) => [s, new Set<string>()])) as Record<Section, Set<string>>;
  const assignedIds = Object.fromEntries(sections.map((s) => [s, new Set<string>()])) as Record<Section, Set<string>>;
  const bad = (section: string, refName: string, path: string, message: string) => {
    invalid.push({ section, ref: refName, path, message });
    if (section in outcomes) {
      (outcomes as Record<string, Record<string, ImportOutcome>>)[section][refName] = "invalid";
      const id = ids[section as Section][refName];
      if (id) invalidIds[section as Section].add(id);
    }
  };

  // --- Lauf und Familien ----------------------------------------------------
  let sourceTreeId = data.sourceTreeId;
  if (data.batchId) {
    const batch = await db.importBatch.findUnique({ where: { id: data.batchId }, select: { sourceTreeId: true } });
    if (!batch) throw notFoundError("Importlauf");
    sourceTreeId ??= batch.sourceTreeId;
  }
  const allFamilyIds = [...new Set([...data.familyIds, ...data.persons.flatMap((p) => p.familyIds ?? [])])];
  if (allFamilyIds.length) {
    const n = await db.family.count({ where: { id: { in: allFamilyIds } } });
    if (n !== allFamilyIds.length) throw validationError([{ path: "familyIds", message: "Unbekannte Familie" }]);
  }

  // Doppelte refs je Abschnitt
  for (const s of sections) {
    const seen = new Set<string>();
    for (const it of data[s] as { ref: string }[]) {
      if (seen.has(it.ref)) bad(s, it.ref, "ref", `ref „${it.ref}“ kommt mehrfach vor`);
      seen.add(it.ref);
    }
  }

  // --- Vorhandene Ziele für update/skip und Herkunft laden ------------------
  async function existingFor(
    section: Section,
    items: { ref: string; action: ImportAction; id?: string | null; externalKey?: string | null }[],
  ) {
    const entity = SECTION_ENTITY[section];
    const wanted = items.filter((i) => i.action !== "create");
    for (const i of wanted) {
      if (!i.id && i.action !== "skip") bad(section, i.ref, "id", `Aktion ${i.action} braucht eine id`);
      if (i.action === "enrich" && section !== "persons") bad(section, i.ref, "action", "Verknüpfen (enrich) gibt es nur für Personen");
    }
    const targetIds = wanted.map((i) => i.id).filter((x): x is string => Boolean(x));
    const rows = await loadRowsForFingerprint(db, entity, targetIds);
    const col = importLinkColumn(entity);
    const links = targetIds.length
      ? await db.importLink.findMany({ where: { [col]: { in: targetIds } } })
      : [];
    // Ein Datensatz kann mehrere Links haben (zusammengeführt, oder aus
    // mehreren Quell-Bäumen verknüpft). Maßgeblich ist der Link DIESES Baums
    // und DIESES Datensatzes der Quelle (externalKey); ohne passenden Schlüssel
    // ein Link dieses Baums, dessen Schlüssel in diesem Lauf niemand sonst
    // benutzt (umnummerierte Quelle). Sonst entsteht ein neuer Link — der
    // Datensatz wird damit aus diesem Baum zusätzlich wiedererkennbar, ohne
    // dass die Links anderer Bäume (bzw. des anderen Datensatzes einer
    // zusammengeführten Dublette) verloren gehen.
    const linksOf = new Map<string, typeof links>();
    for (const l of links) {
      const id = (l as Record<string, unknown>)[col] as string;
      linksOf.set(id, [...(linksOf.get(id) ?? []), l]);
    }
    const keysInRun = new Set(items.map((i) => i.externalKey).filter((k): k is string => Boolean(k)));
    const linkBy = new Map<string, (typeof links)[number]>();
    for (const i of wanted) {
      if (!i.id || linkBy.has(`${i.id}|${i.ref}`)) continue;
      const own = (linksOf.get(i.id) ?? []).filter((l) => (l.sourceTreeId ?? null) === (sourceTreeId ?? null));
      const pick =
        (i.externalKey ? own.find((l) => l.externalKey === i.externalKey) : own[0]) ??
        own.find((l) => !l.externalKey || !keysInRun.has(l.externalKey));
      if (pick) linkBy.set(`${i.id}|${i.ref}`, pick);
    }
    for (const i of wanted) {
      if (i.id && !rows.has(i.id)) bad(section, i.ref, "id", `${entity} ${i.id} gibt es nicht`);
    }
    return { rows, linkBy };
  }

  const existing = {} as Record<Section, Awaited<ReturnType<typeof existingFor>>>;
  for (const s of sections) existing[s] = await existingFor(s, data[s] as never);

  const isBad = (section: Section, r: string) => outcomes[section][r] === "invalid";
  /** ID zu einer ref in einem Abschnitt (create: neue ID; sonst die angegebene). */
  const assign = (section: Section, item: { ref: string; action: ImportAction; id?: string | null }) => {
    if (isBad(section, item.ref)) return;
    ids[section][item.ref] = item.action === "create" ? newId() : (item.id ?? "");
    if (!ids[section][item.ref]) delete ids[section][item.ref];
  };
  for (const s of sections) for (const it of data[s] as { ref: string; action: ImportAction; id?: string | null }[]) assign(s, it);

  /** Verweis auflösen: ref (dieser Import) oder vorhandene ID. */
  async function resolve(
    section: Section,
    refName: string | null | undefined,
    id: string | null | undefined,
  ): Promise<string | null | "missing"> {
    if (refName) return ids[section][refName] ?? "missing";
    if (id) return id;
    return null;
  }
  const existsCache = new Map<string, boolean>();
  async function existsInDb(entity: "person" | "relationship" | "event" | "source", id: string) {
    const key = `${entity}:${id}`;
    if (!existsCache.has(key)) {
      const where = { where: { id } };
      const n =
        entity === "person"
          ? await db.person.count(where)
          : entity === "relationship"
            ? await db.relationship.count(where)
            : entity === "event"
              ? await db.event.count(where)
              : await db.source.count(where);
      existsCache.set(key, n > 0);
    }
    return existsCache.get(key)!;
  }
  for (const s of sections) for (const v of Object.values(ids[s])) assignedIds[s].add(v);
  const isNewRef = (section: Section, id: string) => assignedIds[section].has(id) && !invalidIds[section].has(id);

  async function pointer(
    section: Section,
    entity: "person" | "relationship" | "event" | "source",
    refName: string | null | undefined,
    id: string | null | undefined,
  ): Promise<string | null | "missing"> {
    const r = await resolve(section, refName, id);
    if (r === null || r === "missing") return r;
    if (refName) return r;
    return isNewRef(section, r) || (await existsInDb(entity, r)) ? r : "missing";
  }

  // --- Personen --------------------------------------------------------------
  const personCreates: Pending<z.infer<typeof personItem>>[] = [];
  const personUpdates: Pending<z.infer<typeof personItem>>[] = [];
  for (const p of data.persons) {
    if (isBad("persons", p.ref)) continue;
    const birth = resolveBulkDate(p.birth);
    const death = resolveBulkDate(p.death);
    if (birth.error) bad("persons", p.ref, "birth", birth.error);
    if (death.error) bad("persons", p.ref, "death", death.error);
    for (const i of personDateIssues({ birthDate: birth.value, deathDate: death.value })) bad("persons", p.ref, i.path, i.message);
    if (isBad("persons", p.ref)) continue;
    const row = {
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      nickname: p.nickname,
      namePrefix: p.namePrefix,
      nameSuffix: p.nameSuffix,
      gender: p.gender,
      ...fuzzyColumns("birthDate", birth.value),
      birthDatePhrase: birth.phrase,
      birthPlace: p.birthPlace,
      ...fuzzyColumns("deathDate", death.value),
      deathDatePhrase: death.phrase,
      deathPlace: p.deathPlace,
      deathCause: p.deathCause,
      notes: p.notes,
    };
    queue("persons", p, row, personCreates, personUpdates);
  }

  // --- Quellen ---------------------------------------------------------------
  const sourceCreates: Pending<z.infer<typeof sourceItem>>[] = [];
  const sourceUpdates: Pending<z.infer<typeof sourceItem>>[] = [];
  for (const s of data.sources) {
    if (isBad("sources", s.ref)) continue;
    const date = resolveBulkDate(s.date);
    if (date.error) {
      bad("sources", s.ref, "date", date.error);
      continue;
    }
    const row = {
      title: s.title,
      kind: s.kind,
      kindLabel: s.kindLabel,
      provider: s.provider,
      author: s.author,
      repository: s.repository,
      callNumber: s.callNumber,
      url: s.url,
      ...fuzzyColumns("date", date.value),
      datePhrase: date.phrase,
      notes: s.notes,
    };
    queue("sources", s, row, sourceCreates, sourceUpdates);
  }

  // --- Beziehungen -----------------------------------------------------------
  const relCreates: Pending<z.infer<typeof relationshipItem>>[] = [];
  const relUpdates: Pending<z.infer<typeof relationshipItem>>[] = [];
  const relTypeById = new Map<string, RelationTypeName>();
  const batchEdges: { id: string; type: RelationTypeName; subtype: string; from: string; to: string }[] = [];
  for (const r of data.relationships) {
    if (isBad("relationships", r.ref)) continue;
    const from = await pointer("persons", "person", r.fromRef, r.fromId);
    const to = await pointer("persons", "person", r.toRef, r.toId);
    if (!from || from === "missing" || !to || to === "missing") {
      bad("relationships", r.ref, "from/to", "Person unbekannt oder ungültig");
      continue;
    }
    if (from === to) {
      bad("relationships", r.ref, "toRef", "Eine Person kann keine Beziehung zu sich selbst haben");
      continue;
    }
    const subtype = r.subtype ?? defaultSubtype(r.type);
    const start = resolveBulkDate(r.start);
    const end = resolveBulkDate(r.end);
    if (start.error) bad("relationships", r.ref, "start", start.error);
    if (end.error) bad("relationships", r.ref, "end", end.error);
    for (const i of relationshipIssues({ type: r.type, subtype, startDate: start.value, endDate: end.value })) {
      bad("relationships", r.ref, i.path, i.message);
    }
    if (isBad("relationships", r.ref)) continue;
    const [a, b] = r.type === "PARTNER_OF" && from > to ? [to, from] : [from, to];
    const row = {
      type: r.type,
      subtype,
      fromPersonId: a,
      toPersonId: b,
      ...fuzzyColumns("startDate", start.value),
      startDatePhrase: start.phrase,
      startPlace: r.startPlace,
      ...fuzzyColumns("endDate", end.value),
      endDatePhrase: end.phrase,
      endPlace: r.endPlace,
      notes: r.notes,
    };
    const id = ids.relationships[r.ref];
    if (r.action !== "create" && id) {
      const old = existing.relationships.rows.get(id);
      if (old && (old.fromPersonId !== a || old.toPersonId !== b || old.type !== r.type)) {
        bad("relationships", r.ref, "from/to", "Personen und Typ einer Beziehung sind fest — anlegen statt ändern");
        continue;
      }
    }
    if (r.action === "create") batchEdges.push({ id: id!, type: r.type, subtype, from: a, to: b });
    relTypeById.set(id ?? "", r.type);
    queue("relationships", r, row, relCreates, relUpdates);
  }
  await checkRelationshipRules(db, batchEdges, (edgeId, message) => {
    const r = Object.entries(ids.relationships).find(([, v]) => v === edgeId)?.[0];
    if (r) bad("relationships", r, "from/to", message);
  });

  // --- Namen -----------------------------------------------------------------
  const nameCreates: Pending<z.infer<typeof personNameItem>>[] = [];
  const nameUpdates: Pending<z.infer<typeof personNameItem>>[] = [];
  for (const n of data.names) {
    if (isBad("names", n.ref)) continue;
    const personId = await pointer("persons", "person", n.personRef, n.personId);
    if (!personId || personId === "missing") {
      bad("names", n.ref, "personRef", "Person unbekannt oder ungültig");
      continue;
    }
    if (!n.givenName && !n.familyName && !n.nickname) {
      bad("names", n.ref, "givenName", "Name ohne Vor-, Nach- und Rufname");
      continue;
    }
    const row = {
      personId,
      type: n.type,
      givenName: n.givenName,
      familyName: n.familyName,
      prefix: n.prefix,
      suffix: n.suffix,
      nickname: n.nickname,
      label: n.label,
      notes: n.notes,
      sortOrder: n.sortOrder,
    };
    queue("names", n, row, nameCreates, nameUpdates);
  }

  // --- Ereignisse ------------------------------------------------------------
  const eventCreates: Pending<z.infer<typeof eventItem>>[] = [];
  const eventUpdates: Pending<z.infer<typeof eventItem>>[] = [];
  const eventOwner = new Map<string, { personId: string | null; relationshipId: string | null }>();
  for (const e of data.events) {
    if (isBad("events", e.ref)) continue;
    const personId = await pointer("persons", "person", e.personRef, e.personId);
    const relationshipId = await pointer("relationships", "relationship", e.relationshipRef, e.relationshipId);
    if (personId === "missing" || relationshipId === "missing" || Boolean(personId) === Boolean(relationshipId)) {
      bad("events", e.ref, "personRef", "Ein Ereignis gehört zu genau einer (gültigen) Person oder Beziehung");
      continue;
    }
    let relType: RelationTypeName | undefined;
    if (relationshipId) {
      relType =
        relTypeById.get(relationshipId) ??
        (await db.relationship.findUnique({ where: { id: relationshipId }, select: { type: true } }))?.type;
      if (!relType || isRelInvalid(relationshipId)) {
        bad("events", e.ref, "relationshipRef", "Beziehung unbekannt oder ungültig");
        continue;
      }
    }
    for (const i of eventIssues({
      type: e.type as EventTypeName,
      isAlternative: e.isAlternative,
      label: e.label,
      owner: personId ? { kind: "person" } : { kind: "relationship", type: relType! },
    })) {
      bad("events", e.ref, i.path, i.message);
    }
    const date = resolveBulkDate(e.date);
    if (date.error) bad("events", e.ref, "date", date.error);
    for (const i of eventDateIssues({ date: date.value })) bad("events", e.ref, i.path, i.message);
    if (isBad("events", e.ref)) continue;
    const row = {
      personId: personId ?? null,
      relationshipId: relationshipId ?? null,
      type: e.type,
      label: e.label,
      isAlternative: e.isAlternative,
      ...fuzzyColumns("date", date.value),
      datePhrase: date.phrase,
      place: e.place,
      address: e.address,
      value: e.value,
      cause: e.cause,
      age: e.age,
      agency: e.agency,
      notes: e.notes,
      sortOrder: e.sortOrder,
    };
    const id = ids.events[e.ref];
    if (id) eventOwner.set(id, { personId: row.personId, relationshipId: row.relationshipId });
    queue("events", e, row, eventCreates, eventUpdates);
  }

  // --- Belege ----------------------------------------------------------------
  const citationCreates: Pending<z.infer<typeof citationItem>>[] = [];
  const citationUpdates: Pending<z.infer<typeof citationItem>>[] = [];
  for (const c of data.citations) {
    if (isBad("citations", c.ref)) continue;
    const sourceId = await pointer("sources", "source", c.sourceRef, c.sourceId);
    if (!sourceId || sourceId === "missing" || isInvalidId("sources", sourceId)) {
      bad("citations", c.ref, "sourceRef", "Quelle unbekannt oder ungültig");
      continue;
    }
    const personId = await pointer("persons", "person", c.personRef, c.personId);
    const relationshipId = await pointer("relationships", "relationship", c.relationshipRef, c.relationshipId);
    const eventId = await pointer("events", "event", c.eventRef, c.eventId);
    const targets = [personId, relationshipId, eventId].filter((x) => x !== null);
    if (targets.length !== 1 || targets[0] === "missing") {
      bad("citations", c.ref, "personRef", "Ein Beleg gehört zu genau einer (gültigen) Person, Beziehung oder einem Ereignis");
      continue;
    }
    let target: { personId: string | null; relationshipId: string | null; eventId: string | null };
    let fact = c.fact;
    if (eventId) {
      if (isInvalidId("events", eventId)) {
        bad("citations", c.ref, "eventRef", "Ereignis ungültig");
        continue;
      }
      const owner =
        eventOwner.get(eventId) ??
        (await db.event.findUnique({ where: { id: eventId }, select: { personId: true, relationshipId: true } }));
      if (!owner) {
        bad("citations", c.ref, "eventRef", "Ereignis unbekannt");
        continue;
      }
      target = { ...owner, eventId };
      if (fact === "OTHER") fact = "EVENT";
      if (fact !== "EVENT") bad("citations", c.ref, "fact", "Ein Beleg an einem Ereignis hat die Angabe EVENT");
    } else if (personId) {
      if (isInvalidId("persons", personId)) {
        bad("citations", c.ref, "personRef", "Person ungültig");
        continue;
      }
      target = { personId, relationshipId: null, eventId: null };
      if (!PERSON_FACTS.includes(fact)) bad("citations", c.ref, "fact", `Angabe ${fact} passt nicht zu einer Person`);
    } else {
      const rid = relationshipId as string;
      const type = relTypeById.get(rid) ?? (await db.relationship.findUnique({ where: { id: rid }, select: { type: true } }))?.type;
      if (!type || isRelInvalid(rid)) {
        bad("citations", c.ref, "relationshipRef", "Beziehung unbekannt oder ungültig");
        continue;
      }
      target = { personId: null, relationshipId: rid, eventId: null };
      if (!relationshipFacts(type).includes(fact)) bad("citations", c.ref, "fact", `Angabe ${fact} passt nicht zur Beziehung`);
    }
    const url = c.url ? safeHttpUrl(c.url) : null;
    if (c.url && !url) bad("citations", c.ref, "url", "Nur http- und https-Adressen ohne Zugangsdaten");
    if (isBad("citations", c.ref)) continue;
    const row = { sourceId, ...target, fact, detail: c.detail, url, confidence: c.confidence, text: c.text };
    queue("citations", c, row, citationCreates, citationUpdates);
  }

  if (invalid.length > 0 && onInvalid === "throw") {
    throw validationError(invalid.map((i) => ({ path: [i.section, i.ref, i.path], message: i.message })));
  }

  // Abhängige Einträge nach „skip“-Ungültigen herausnehmen (Kaskade).
  pruneDependents();

  // --- Schreiben ---------------------------------------------------------------
  const linkCreates: Prisma.ImportLinkCreateManyInput[] = [];
  const counts = Object.fromEntries(
    sections.map((s) => [s, { created: 0, updated: 0, unchanged: 0, skippedEdited: 0, skipped: 0, linked: 0, invalid: 0 }]),
  ) as Record<Section, Record<ImportOutcome, number>>;

  const familyOf = new Map(data.persons.map((p) => [p.ref, p.familyIds ?? data.familyIds]));

  // Personen
  if (write) await db.person.createMany({ data: personCreates.map((c) => ({ id: c.id, ...c.row })) as Prisma.PersonCreateManyInput[] });
  if (write) await db.personFamily.createMany({
    data: personCreates.flatMap((c) => (familyOf.get(c.item.ref) ?? []).map((familyId) => ({ personId: c.id, familyId }))),
    skipDuplicates: true,
  });
  if (write) await db.source.createMany({
    data: sourceCreates.map((c) => ({ id: c.id, ...c.row, createdById: scope.userId })) as Prisma.SourceCreateManyInput[],
  });
  if (write) await db.relationship.createMany({ data: relCreates.map((c) => ({ id: c.id, ...c.row })) as Prisma.RelationshipCreateManyInput[] });
  if (write) await db.personName.createMany({ data: nameCreates.map((c) => ({ id: c.id, ...c.row })) as Prisma.PersonNameCreateManyInput[] });
  if (write) await db.event.createMany({ data: eventCreates.map((c) => ({ id: c.id, ...c.row })) as Prisma.EventCreateManyInput[] });
  if (write) await db.citation.createMany({ data: citationCreates.map((c) => ({ id: c.id, ...c.row })) as Prisma.CitationCreateManyInput[] });

  for (const [section, creates] of [
    ["persons", personCreates],
    ["sources", sourceCreates],
    ["relationships", relCreates],
    ["names", nameCreates],
    ["events", eventCreates],
    ["citations", citationCreates],
  ] as const) {
    const entity = SECTION_ENTITY[section];
    for (const c of creates as Pending<{ ref: string; externalKey: string | null; sourceStamp: string | null }>[]) {
      outcomes[section][c.item.ref] = "created";
      counts[section].created++;
      linkCreates.push({
        entityType: entity,
        [importLinkColumn(entity)]: c.id,
        sourceTreeId,
        externalKey: c.item.externalKey,
        firstBatchId: data.batchId ?? null,
        lastBatchId: data.batchId ?? null,
        importedAt: now,
        importHash: c.hash,
        sourceStamp: c.item.sourceStamp,
      });
    }
  }
  if (write) await db.importLink.createMany({ data: linkCreates });

  // Verknüpfen (enrich): vorhandene Namen und Ereignisse der Zielpersonen,
  // damit Zweitangaben und Namensvarianten nichts doppelt anlegen.
  const enrichTargets = [...new Set(personUpdates.filter((u) => u.item.action === "enrich").map((u) => u.id))];
  const enrichExisting = {
    names: enrichTargets.length ? await db.personName.findMany({ where: { personId: { in: enrichTargets } } }) : [],
    events: enrichTargets.length ? await db.event.findMany({ where: { personId: { in: enrichTargets } } }) : [],
  };
  const enriched = new Map<
    string,
    { ref: string; before: Record<string, unknown>; patch: Record<string, unknown>; alternates: number; names: number; dropped: string[] }
  >();
  const enrichEventRows: Prisma.EventCreateManyInput[] = [];
  const enrichNameRows: Prisma.PersonNameCreateManyInput[] = [];

  // Aktualisierungen (einzeln — bei einem erneuten Import meist wenige).
  // Herkunft unveränderter Datensätze wird gesammelt fortgeschrieben.
  const changes = Object.fromEntries(sections.map((s) => [s, {}])) as GenealogyImportResult["changes"];
  const refreshOnly: string[] = [];
  for (const [section, updates] of [
    ["persons", personUpdates],
    ["sources", sourceUpdates],
    ["relationships", relUpdates],
    ["names", nameUpdates],
    ["events", eventUpdates],
    ["citations", citationUpdates],
  ] as const) {
    const entity = SECTION_ENTITY[section];
    const col = importLinkColumn(entity);
    for (const u of updates as Pending<{ ref: string; action: ImportAction; externalKey: string | null; sourceStamp: string | null }>[]) {
      const current = existing[section].rows.get(u.id)!;
      const link = existing[section].linkBy.get(`${u.id}|${u.item.ref}`);
      const currentHash = importFingerprint(entity, current);
      if (u.item.action === "skip") {
        outcomes[section][u.item.ref] = "skipped";
        counts[section].skipped++;
        continue;
      }
      const fields = [...FINGERPRINT_FIELDS[entity], ...(OPTIONAL_FINGERPRINT_FIELDS[entity] ?? [])].filter(
        (f) => canonicalValue(current[f]) !== canonicalValue(u.row[f]),
      );
      changes[section][u.item.ref] = { fields, fileChangedSinceImport: !link || link.importHash !== u.hash };
      if (u.item.action === "updateIfUnchanged" && (!link || link.importHash !== currentHash)) {
        outcomes[section][u.item.ref] = "skippedEdited";
        counts[section].skippedEdited++;
        continue;
      }
      const changed = currentHash !== u.hash;
      if (u.item.action === "enrich") {
        await enrichPerson(u.id, u.item.ref, current, u.row);
      } else if (u.item.action === "link") {
        outcomes[section][u.item.ref] = changed ? "skippedEdited" : "unchanged";
        counts[section][changed ? "skippedEdited" : "unchanged"]++;
      } else {
        if (changed && write) await updateRow(db, entity, u.id, u.row);
        outcomes[section][u.item.ref] = changed ? "updated" : "unchanged";
        counts[section][changed ? "updated" : "unchanged"]++;
      }
      if (
        link &&
        link.importHash === u.hash &&
        (u.item.externalKey ?? link.externalKey) === link.externalKey &&
        (u.item.sourceStamp ?? link.sourceStamp) === link.sourceStamp &&
        (sourceTreeId ?? link.sourceTreeId) === link.sourceTreeId
      ) {
        refreshOnly.push(link.id);
        continue;
      }
      const linkData = {
        sourceTreeId: sourceTreeId ?? link?.sourceTreeId ?? null,
        externalKey: u.item.externalKey ?? link?.externalKey ?? null,
        lastBatchId: data.batchId ?? link?.lastBatchId ?? null,
        importedAt: now,
        importHash: u.hash,
        sourceStamp: u.item.sourceStamp ?? link?.sourceStamp ?? null,
        missingSinceBatchId: null,
        // Verknüpft wie beim Zusammenführen: ein erneuter Import ohne neue
        // Angaben meldet die Person nicht als „in der App geändert“.
        ...(u.item.action === "enrich" ? { mergedAt: now } : {}),
      };
      if (!write) continue;
      if (link) await db.importLink.update({ where: { id: link.id }, data: linkData });
      else
        await db.importLink.create({
          data: { entityType: entity, [col]: u.id, firstBatchId: data.batchId ?? null, ...linkData },
        });
    }
  }
  if (write && enrichEventRows.length) await db.event.createMany({ data: enrichEventRows });
  if (write && enrichNameRows.length) await db.personName.createMany({ data: enrichNameRows });
  for (let i = 0; i < refreshOnly.length; i += 5000) {
    if (write) await db.importLink.updateMany({
      where: { id: { in: refreshOnly.slice(i, i + 5000) } },
      data: { lastBatchId: data.batchId ?? undefined, importedAt: now, missingSinceBatchId: null },
    });
  }
  // skip ohne id
  for (const s of sections) {
    for (const it of data[s] as { ref: string; action: ImportAction; id?: string | null }[]) {
      if (it.action === "skip" && !it.id && outcomes[s][it.ref] !== "invalid") {
        outcomes[s][it.ref] = "skipped";
        counts[s].skipped++;
      }
    }
  }
  for (const s of sections) counts[s].invalid = Object.values(outcomes[s]).filter((o) => o === "invalid").length;

  // --- Fremdkennungen -------------------------------------------------------
  const extRows: Prisma.ExternalIdCreateManyInput[] = [];
  for (const [i, x] of data.externalIds.entries()) {
    const t = await targetOf(x);
    if (!t) {
      bad("externalIds", String(i), "target", `Fremdkennung ${x.system}=${x.value}: Ziel fehlt oder ungültig`);
      continue;
    }
    extRows.push({ system: x.system, value: x.value, batchId: data.batchId ?? null, ...t });
  }
  if (write) await db.externalId.createMany({ data: extRows });

  // --- Rohdaten ---------------------------------------------------------------
  const rawRows: Prisma.ImportRawRecordCreateManyInput[] = [];
  let superseded = 0;
  const replaceTargets = { personId: new Set<string>(), relationshipId: new Set<string>(), sourceId: new Set<string>() };
  for (const [i, r] of data.rawRecords.entries()) {
    const json = JSON.stringify(r.content ?? null);
    const size = Buffer.byteLength(json, "utf8");
    if (size > MAX_RAW_RECORD_BYTES) {
      bad("rawRecords", String(i), "content", `Rohdaten zu groß (${size} Bytes, höchstens ${MAX_RAW_RECORD_BYTES}) — die Originaldatei des Laufs enthält sie`);
      continue;
    }
    // Nichts geht verloren: Gehört der Datensatz zu einer Beziehung, die an
    // einer Regel der App scheitert (z.B. Paar, das zugleich Eltern und Kind
    // ist; dritter leiblicher Elternteil), bleibt er bei einer der beteiligten
    // Personen erhalten — mit Vermerk, warum. Ereignisse und Belege der
    // Beziehung stecken im Original und gehen so mit. Ohne „replace“: er soll
    // die eigenen Rohdaten der Person nicht überholen. Liegt derselbe Stand
    // dort schon (erneuter Import), wird er nicht doppelt abgelegt.
    if (r.relationshipRef && !r.relationshipId && isBad("relationships", r.relationshipRef)) {
      const rehomed = await rehomeRejected(r);
      if (rehomed === "duplicate") continue;
      if (rehomed) {
        rawRows.push({ batchId: data.batchId ?? null, ...rehomed, sizeBytes: Buffer.byteLength(JSON.stringify(rehomed.content), "utf8") });
        continue;
      }
    }
    const t = await targetOf({ ...r, eventRef: null, eventId: null });
    const hasTarget = Boolean(r.personRef || r.personId || r.relationshipRef || r.relationshipId || r.sourceRef || r.sourceId);
    if (hasTarget && !t) {
      bad("rawRecords", String(i), "target", "Träger fehlt oder ungültig");
      continue;
    }
    if (r.replace && t) {
      for (const k of ["personId", "relationshipId", "sourceId"] as const) {
        const v = (t as Record<string, string | undefined>)[k];
        if (v) replaceTargets[k].add(v);
      }
    }
    rawRows.push({
      batchId: data.batchId ?? null,
      ...(t ?? {}),
      recordType: r.recordType,
      xref: r.xref,
      content: (r.content ?? null) as Prisma.InputJsonValue,
      reason: r.reason,
      sizeBytes: size,
    });
  }
  const or: Prisma.ImportRawRecordWhereInput[] = [];
  if (replaceTargets.personId.size) or.push({ personId: { in: [...replaceTargets.personId] } });
  if (replaceTargets.relationshipId.size) or.push({ relationshipId: { in: [...replaceTargets.relationshipId] } });
  if (replaceTargets.sourceId.size) or.push({ sourceId: { in: [...replaceTargets.sourceId] } });
  if (or.length) {
    // Abgelehnte Beziehungen, die bei einer Person liegen, überholt nur ein
    // neuer Stand derselben Familie (rehomeRejected), nicht der Personendatensatz.
    if (write) {
      superseded += (
        await db.importRawRecord.updateMany({
          where: {
            AND: [
              { OR: or },
              // Nur Rohdaten desselben Baums (bzw. ohne Lauf): Hat der Träger
              // auch Rohdaten eines anderen Imports (verknüpft oder
              // zusammengeführt), bleiben diese gültig — der GEDCOM-Export
              // braucht sie für dessen Originaldatensatz.
              ...(sourceTreeId ? [{ OR: [{ batchId: null }, { batch: { sourceTreeId } }] }] : []),
            ],
            supersededAt: null,
            NOT: { recordType: { endsWith: REJECTED_RAW_SUFFIX } },
          },
          data: { supersededAt: now },
        })
      ).count;
    }
  }
  if (write) await db.importRawRecord.createMany({ data: rawRows });

  if (invalid.length > 0 && onInvalid === "throw") {
    throw validationError(invalid.map((i) => ({ path: [i.section, i.ref, i.path], message: i.message })));
  }

  const result: GenealogyImportResult = {
    batchId: data.batchId ?? null,
    ids,
    outcomes,
    counts: { ...counts, externalIds: extRows.length, rawRecords: rawRows.length, supersededRawRecords: superseded },
    invalid,
    changes,
  };
  for (const s of sections) {
    for (const [r, o] of Object.entries(outcomes[s])) if (o === "invalid") delete ids[s][r];
  }

  // Audit in derselben Transaktion: ein Eintrag je Aufruf mit den Zählungen,
  // dazu je betroffener Person einer für ihren Verlauf (Changelog).
  if (write) {
    await db.auditLog.create({
      data: await auditData(
        {
          ...auditActor(scope),
          action: "CREATE",
          entityType: "ImportBatch",
          entityId: data.batchId ?? "bulk",
          diff: { counts: result.counts, invalid: invalid.length } as Prisma.InputJsonValue,
          familyIds: allFamilyIds,
        },
        db,
      ),
    });
    await writePersonAudit();
  }

  return result;

  // --- Hilfsfunktionen (Closures) -------------------------------------------

  /**
   * Person der Datei mit der vorhandenen Person `id` verknüpfen (Aktion
   * `enrich`): anreichern nach den Vorgaben des Zusammenführens, nie
   * überschreiben. Die App ist die Wahrheit, die Datei eine Quelle.
   */
  async function enrichPerson(id: string, refName: string, current: Record<string, unknown>, fileRow: Record<string, unknown>) {
    // Namen und Ereignisse, die es an der Person schon gibt oder die dieser
    // Lauf aus der Datei an ihr anlegt bzw. ihr zuordnet.
    const names: ExistingName[] = [
      ...enrichExisting.names.filter((n) => n.personId === id),
      ...[...nameCreates, ...nameUpdates].filter((n) => n.row.personId === id).map((n) => n.row as ExistingName),
      ...enrichNameRows.filter((n) => n.personId === id).map((n) => ({ type: n.type as string, givenName: n.givenName ?? null, familyName: n.familyName ?? null })),
    ];
    const resolved = resolvePersonMerge(current as PersonValues, fileRow as PersonValues, {}, names, {
      keep: "der vorhandenen Person",
      other: "der Person aus der Datei",
    });
    const patch: Record<string, unknown> = {};
    for (const [col, v] of Object.entries(resolved.columns)) {
      if (canonicalValue(current[col]) !== canonicalValue(v)) patch[col] = v;
    }
    if (write && Object.keys(patch).length) await updateRow(db, "PERSON", id, patch);

    const eventKeys = new Set<string>([
      ...enrichExisting.events.filter((e) => e.personId === id).map((e) => eventKey(e)),
      ...[...eventCreates, ...eventUpdates].filter((e) => e.row.personId === id).map((e) => eventKey(e.row)),
      ...enrichEventRows.filter((e) => e.personId === id).map((e) => eventKey(e as Record<string, unknown>)),
    ]);
    let alternates = 0;
    for (const a of resolved.alternates) {
      const row = {
        personId: id,
        relationshipId: null,
        type: a.type,
        label: null,
        isAlternative: true,
        ...fuzzyColumns("date", a.date),
        datePhrase: a.datePhrase,
        place: a.place,
        address: null,
        value: null,
        cause: a.cause,
        age: null,
        agency: null,
        notes: null,
        sortOrder: 0,
      };
      const key = eventKey(row);
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      enrichEventRows.push({ id: newId(), ...row });
      alternates++;
    }
    for (const n of resolved.names) {
      enrichNameRows.push({
        id: newId(),
        personId: id,
        type: n.type,
        givenName: n.givenName,
        familyName: n.familyName,
        prefix: n.prefix,
        suffix: n.suffix,
        nickname: n.nickname,
      });
    }
    enriched.set(id, { ref: refName, before: current, patch, alternates, names: resolved.names.length, dropped: resolved.dropped });
    outcomes.persons[refName] = "linked";
    counts.persons.linked++;
  }

  /**
   * Je betroffener Person ein Eintrag für ihren Verlauf: Person angelegt bzw.
   * welche Felder sich geändert haben (vorher → nachher), dazu die Zahl der
   * angelegten bzw. geänderten Namen, Beziehungen, Ereignisse und Belege.
   */
  async function writePersonAudit() {
    type Tally = {
      person?: "created" | "updated" | "linked";
      changes?: Record<string, unknown>;
      linked?: { sourceTreeId: string | null; externalKey: string | null; dropped?: string[] };
      created: Record<string, number>;
      updated: Record<string, number>;
    };
    const per = new Map<string, Tally>();
    const tally = (personId: string): Tally => {
      let t = per.get(personId);
      if (!t) per.set(personId, (t = { created: {}, updated: {} }));
      return t;
    };
    const isUpdated = (section: Section, r: string) => outcomes[section][r] === "updated";
    for (const c of personCreates) if (outcomes.persons[c.item.ref] === "created") tally(c.id).person = "created";
    for (const u of personUpdates) {
      if (!isUpdated("persons", u.item.ref)) continue;
      const t = tally(u.id);
      t.person = "updated";
      const current = existing.persons.rows.get(u.id);
      if (current) t.changes = fieldChanges(current, u.row);
    }
    // Verknüpfte Personen: immer ein Eintrag, mit vorher → nachher (auch ohne
    // geänderte Hauptangaben) und den angelegten Zweitangaben/Namen.
    for (const u of personUpdates) {
      const e = enriched.get(u.id);
      if (!e || e.ref !== u.item.ref) continue;
      const t = tally(u.id);
      t.person = "linked";
      t.changes = fieldChanges(e.before, e.patch);
      t.linked = {
        sourceTreeId: sourceTreeId ?? null,
        externalKey: (u.item as { externalKey?: string | null }).externalKey ?? null,
        ...(e.dropped.length ? { dropped: e.dropped } : {}),
      };
      if (e.alternates) t.created.events = (t.created.events ?? 0) + e.alternates;
      if (e.names) t.created.names = (t.created.names ?? 0) + e.names;
    }
    // Personen der Beziehungen und Träger der Ereignisse: aus diesem Lauf,
    // sonst aus der Datenbank.
    const relPersons = new Map<string, string[]>();
    for (const r of [...relCreates, ...relUpdates]) relPersons.set(r.id, [r.row.fromPersonId as string, r.row.toPersonId as string]);
    const eventOwner = new Map<string, { personId: string | null; relationshipId: string | null }>();
    for (const e of [...eventCreates, ...eventUpdates]) {
      eventOwner.set(e.id, {
        personId: (e.row.personId as string | null | undefined) ?? null,
        relationshipId: (e.row.relationshipId as string | null | undefined) ?? null,
      });
    }
    const missingEvents = [...citationCreates, ...citationUpdates]
      .map((c) => c.row.eventId as string | null | undefined)
      .filter((id): id is string => typeof id === "string" && id.length > 0 && !eventOwner.has(id));
    if (missingEvents.length) {
      const evs = await db.event.findMany({ where: { id: { in: missingEvents } }, select: { id: true, personId: true, relationshipId: true } });
      for (const e of evs) eventOwner.set(e.id, { personId: e.personId, relationshipId: e.relationshipId });
    }
    const missingRels = new Set<string>();
    for (const row of [...eventCreates, ...eventUpdates, ...citationCreates, ...citationUpdates].map((x) => x.row)) {
      const rid = row.relationshipId as string | null | undefined;
      if (rid && !relPersons.has(rid)) missingRels.add(rid);
    }
    for (const o of eventOwner.values()) if (o.relationshipId && !relPersons.has(o.relationshipId)) missingRels.add(o.relationshipId);
    if (missingRels.size) {
      const rels = await db.relationship.findMany({ where: { id: { in: [...missingRels] } }, select: { id: true, fromPersonId: true, toPersonId: true } });
      for (const r of rels) relPersons.set(r.id, [r.fromPersonId, r.toPersonId]);
    }
    const personsOf = (row: Record<string, unknown>): string[] => {
      if (row.personId) return [row.personId as string];
      if (row.fromPersonId) return [row.fromPersonId as string, row.toPersonId as string];
      if (row.relationshipId) return relPersons.get(row.relationshipId as string) ?? [];
      if (row.eventId) {
        const o = eventOwner.get(row.eventId as string);
        return o ? personsOf({ personId: o.personId, relationshipId: o.relationshipId }) : [];
      }
      return [];
    };
    for (const [section, creates, updates] of [
      ["relationships", relCreates, relUpdates],
      ["names", nameCreates, nameUpdates],
      ["events", eventCreates, eventUpdates],
      ["citations", citationCreates, citationUpdates],
    ] as const) {
      for (const c of creates as Pending<{ ref: string }>[]) {
        if (outcomes[section][c.item.ref] !== "created") continue;
        for (const p of personsOf(c.row)) {
          const t = tally(p);
          t.created[section] = (t.created[section] ?? 0) + 1;
        }
      }
      for (const u of updates as Pending<{ ref: string }>[]) {
        if (!isUpdated(section, u.item.ref)) continue;
        for (const p of personsOf(u.row)) {
          const t = tally(p);
          t.updated[section] = (t.updated[section] ?? 0) + 1;
        }
      }
    }
    if (!per.size) return;
    const personIds = [...per.keys()];
    const fams = new Map<string, string[]>();
    for (let i = 0; i < personIds.length; i += 5000) {
      const pf = await db.personFamily.findMany({
        where: { personId: { in: personIds.slice(i, i + 5000) } },
        select: { personId: true, familyId: true },
      });
      for (const r of pf) fams.set(r.personId, [...(fams.get(r.personId) ?? []), r.familyId]);
    }
    const changeSetId = await changeSetIdOf(scope, "Import");
    const actor = auditActor(scope);
    const auditRows: Prisma.AuditLogCreateManyInput[] = personIds.map((personId) => {
      const t = per.get(personId)!;
      return {
        userId: actor.userId ?? null,
        action: t.person === "created" ? "CREATE" : "UPDATE",
        entityType: "Person",
        entityId: personId,
        diff: {
          import: data.batchId ?? true,
          ...(t.person ? { person: t.person } : {}),
          ...(t.changes && Object.keys(t.changes).length ? { changes: t.changes } : {}),
          ...(t.linked ? { linked: t.linked } : {}),
          ...(Object.keys(t.created).length ? { created: t.created } : {}),
          ...(Object.keys(t.updated).length ? { updated: t.updated } : {}),
        } as Prisma.InputJsonValue,
        channel: actor.channel ?? null,
        apiTokenId: actor.apiTokenId ?? null,
        changeSetId,
        personIds: [personId],
        familyIds: fams.get(personId) ?? [],
        // Familien der Person selbst (wie auditRefs) — für das Leserecht im
        // Verlauf, auch nachdem die Person gelöscht wurde oder aufging.
        subjectFamilyIds: fams.get(personId) ?? [],
        subjectFamiliesKnown: true,
        createdAt: now,
      };
    });
    for (let i = 0; i < auditRows.length; i += 2000) await db.auditLog.createMany({ data: auditRows.slice(i, i + 2000) });
  }

  function queue<T extends { ref: string; action: ImportAction }>(
    section: Section,
    item: T,
    row: Record<string, unknown>,
    creates: Pending<T>[],
    updates: Pending<T>[],
  ) {
    const id = ids[section][item.ref];
    if (!id) return;
    const hash = importFingerprint(SECTION_ENTITY[section], row);
    (item.action === "create" ? creates : updates).push({ item, id, row, hash });
  }

  function isInvalidId(section: Section, id: string) {
    return invalidIds[section].has(id);
  }
  function isRelInvalid(id: string) {
    return isInvalidId("relationships", id);
  }

  /** Bei onInvalid "skip": Einträge entfernen, deren Verweis ungültig wurde. */
  function pruneDependents() {
    let changed = true;
    const drop = <T extends { item: { ref: string } }>(section: Section, list: T[], dead: (p: T) => boolean) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (dead(list[i])) {
          bad(section, list[i].item.ref, "ref", "hängt von einem ungültigen Eintrag ab");
          list.splice(i, 1);
          changed = true;
        }
      }
    };
    while (changed) {
      changed = false;
      const deadPerson = (id: unknown) => typeof id === "string" && isInvalidId("persons", id);
      const deadRel = (id: unknown) => typeof id === "string" && isInvalidId("relationships", id);
      const deadEvent = (id: unknown) => typeof id === "string" && isInvalidId("events", id);
      const deadSource = (id: unknown) => typeof id === "string" && isInvalidId("sources", id);
      for (const [list, section] of [[relCreates, "relationships"], [relUpdates, "relationships"]] as const) {
        drop(section, list as Pending<{ ref: string }>[], (p) => deadPerson(p.row.fromPersonId) || deadPerson(p.row.toPersonId) || isBad("relationships", p.item.ref));
      }
      for (const list of [nameCreates, nameUpdates]) drop("names", list, (p) => deadPerson(p.row.personId));
      for (const list of [eventCreates, eventUpdates]) {
        drop("events", list, (p) => deadPerson(p.row.personId) || deadRel(p.row.relationshipId));
      }
      for (const list of [citationCreates, citationUpdates]) {
        drop(
          "citations",
          list,
          (p) => deadSource(p.row.sourceId) || deadPerson(p.row.personId) || deadRel(p.row.relationshipId) || deadEvent(p.row.eventId),
        );
      }
    }
  }

  /**
   * Rohdatensatz einer abgelehnten Beziehung an die erste auffindbare
   * beteiligte Person hängen (siehe Aufruf). Liefert die Zeile, "duplicate",
   * wenn genau dieser Stand dort schon aktiv liegt, oder null, wenn keine
   * Person greifbar ist (dann gilt der Datensatz wie bisher als ungültig).
   */
  async function rehomeRejected(r: z.infer<typeof rawRecordItem>) {
    const rel = data.relationships.find((x) => x.ref === r.relationshipRef);
    if (!rel) return null;
    const involved: string[] = [];
    for (const [ref, id] of [[rel.fromRef, rel.fromId], [rel.toRef, rel.toId]] as const) {
      if (!ref && !id) continue;
      const v = await pointer("persons", "person", ref, id);
      if (v && v !== "missing" && !isInvalidId("persons", v)) involved.push(v);
    }
    const personId = involved[0];
    if (!personId) return null;
    const why = invalid.find((x) => x.section === "relationships" && x.ref === r.relationshipRef)?.message ?? "Regel der App";
    const kind = rel.type === "PARTNER_OF" ? "Partnerschaft" : "Eltern-Kind-Beziehung";
    const base = r.content && typeof r.content === "object" && !Array.isArray(r.content) ? (r.content as Record<string, unknown>) : { value: r.content ?? null };
    // Verweise auf Quellen dieses Imports (Xref → ref) in App-IDs übersetzen.
    const sourceIds: Record<string, string> = {};
    const refs = base.sourceRefs && typeof base.sourceRefs === "object" ? (base.sourceRefs as Record<string, unknown>) : {};
    for (const [xref, ref] of Object.entries(refs)) {
      if (typeof ref !== "string") continue;
      const v = await pointer("sources", "source", ref, null);
      if (v && v !== "missing" && !isInvalidId("sources", v)) sourceIds[xref] = v;
    }
    const content = { ...base, rejected: { type: rel.type, reason: why, personIds: involved, sourceIds } } as Prisma.InputJsonValue;
    const reason = `${kind} nicht übernehmbar (${why}) — Original bleibt bei dieser Person erhalten`;
    const recordType = `${r.recordType}${REJECTED_RAW_SUFFIX}`;
    const prior = await db.importRawRecord.findMany({
      where: { personId, recordType, xref: r.xref ?? null, supersededAt: null },
      select: { id: true, content: true },
    });
    if (prior.some((s) => stableJson(s.content) === stableJson(content))) return "duplicate" as const;
    // Anderer Stand derselben abgelehnten Familie: der alte gilt als überholt.
    if (write && prior.length) {
      superseded += (await db.importRawRecord.updateMany({ where: { id: { in: prior.map((x) => x.id) } }, data: { supersededAt: now } })).count;
    }
    return { personId, recordType, xref: r.xref ?? null, content, reason };
  }

  async function targetOf(x: {
    personRef?: string | null;
    personId?: string | null;
    relationshipRef?: string | null;
    relationshipId?: string | null;
    eventRef?: string | null;
    eventId?: string | null;
    sourceRef?: string | null;
    sourceId?: string | null;
  }): Promise<Partial<Record<"personId" | "relationshipId" | "eventId" | "sourceId", string>> | null> {
    const options = [
      ["personId", "persons", "person", x.personRef, x.personId],
      ["relationshipId", "relationships", "relationship", x.relationshipRef, x.relationshipId],
      ["eventId", "events", "event", x.eventRef, x.eventId],
      ["sourceId", "sources", "source", x.sourceRef, x.sourceId],
    ] as const;
    const found: Partial<Record<"personId" | "relationshipId" | "eventId" | "sourceId", string>> = {};
    let n = 0;
    for (const [key, section, entity, r, id] of options) {
      if (!r && !id) continue;
      n++;
      const v = await pointer(section, entity, r, id);
      if (!v || v === "missing" || isInvalidId(section, v)) return null;
      found[key] = v;
    }
    return n === 1 ? found : null;
  }
}

/**
 * Endung der Datensatzart für Rohdaten einer beim Import abgelehnten
 * Beziehung, die ersatzweise bei einer beteiligten Person liegen (z.B.
 * "GEDCOM_FAM:ABGELEHNT"). Der GEDCOM-Export schreibt sie als Familie zurück.
 */
export const REJECTED_RAW_SUFFIX = ":ABGELEHNT";

/** JSON mit sortierten Schlüsseln — Postgres (jsonb) speichert Schlüssel in eigener Reihenfolge. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

async function updateRow(db: Db, entity: ImportEntity, id: string, row: Record<string, unknown>) {
  const where = { where: { id } };
  switch (entity) {
    case "PERSON":
      await db.person.update({ ...where, data: row as Prisma.PersonUpdateInput });
      break;
    case "RELATIONSHIP": {
      const { type: _t, fromPersonId: _f, toPersonId: _to, ...rest } = row;
      await db.relationship.update({ ...where, data: rest as Prisma.RelationshipUpdateInput });
      break;
    }
    case "EVENT":
      await db.event.update({ ...where, data: row as Prisma.EventUncheckedUpdateInput });
      break;
    case "PERSON_NAME":
      await db.personName.update({ ...where, data: row as Prisma.PersonNameUncheckedUpdateInput });
      break;
    case "CITATION":
      await db.citation.update({ ...where, data: row as Prisma.CitationUncheckedUpdateInput });
      break;
    case "SOURCE":
      await db.source.update({ ...where, data: row as Prisma.SourceUpdateInput });
      break;
    case "MEDIA":
      await db.mediaAsset.update({ ...where, data: row as Prisma.MediaAssetUpdateInput });
      break;
  }
}

/**
 * Regeln für neue Beziehungen über Bestand und Import hinweg: keine
 * Dubletten (auch umgekehrt), nicht zugleich Partner und Elternteil,
 * höchstens zwei leibliche Eltern, keine Zyklen.
 */
async function checkRelationshipRules(
  db: Db,
  edges: { id: string; type: RelationTypeName; subtype: string; from: string; to: string }[],
  fail: (edgeId: string, message: string) => void,
): Promise<void> {
  if (edges.length === 0) return;
  const involved = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const existing = await db.relationship.findMany({
    where: { OR: [{ fromPersonId: { in: involved } }, { toPersonId: { in: involved } }] },
    select: { id: true, type: true, subtype: true, fromPersonId: true, toPersonId: true },
  });
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seenTyped = new Set(existing.map((r) => `${r.type}|${pairKey(r.fromPersonId, r.toPersonId)}`));
  const partnerPairs = new Set(existing.filter((r) => r.type === "PARTNER_OF").map((r) => pairKey(r.fromPersonId, r.toPersonId)));
  const parentPairs = new Set(existing.filter((r) => r.type === "PARENT_OF").map((r) => pairKey(r.fromPersonId, r.toPersonId)));
  const bioCount = new Map<string, number>();
  for (const r of existing) {
    if (r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL") bioCount.set(r.toPersonId, (bioCount.get(r.toPersonId) ?? 0) + 1);
  }

  // Zyklen: alle Eltern-Kind-Kanten (der Weg kann über Unbeteiligte führen).
  const hasParentEdges = edges.some((e) => e.type === "PARENT_OF");
  const children = new Map<string, string[]>();
  if (hasParentEdges) {
    const all = await db.relationship.findMany({ where: { type: "PARENT_OF" }, select: { fromPersonId: true, toPersonId: true } });
    for (const r of all) children.set(r.fromPersonId, [...(children.get(r.fromPersonId) ?? []), r.toPersonId]);
  }
  const reaches = (start: string, target: string) => {
    const stack = [start];
    const seen = new Set<string>([start]);
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      for (const n of children.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return false;
  };

  // Eltern-Kind-Kanten zuerst: Widersprechen sich eine Abstammung und eine
  // Partnerschaft derselben zwei Personen (z.B. Kind als Partner seiner
  // Mutter), trägt die Abstammung den Baum, und die Partnerschaft ist der
  // wahrscheinlichere Fehler — sie wird ausgelassen, nicht die Abstammung.
  // Innerhalb einer Art bleibt die Reihenfolge der Datei (stabile Sortierung).
  const ordered = [...edges].sort((x, y) => Number(x.type !== "PARENT_OF") - Number(y.type !== "PARENT_OF"));
  for (const e of ordered) {
    const pk = pairKey(e.from, e.to);
    const typed = `${e.type}|${pk}`;
    if (seenTyped.has(typed)) {
      fail(e.id, "Diese Beziehung existiert bereits");
      continue;
    }
    if (e.type === "PARENT_OF" && partnerPairs.has(pk)) {
      fail(e.id, "Diese beiden Personen sind bereits als Partner verbunden");
      continue;
    }
    if (e.type === "PARTNER_OF" && parentPairs.has(pk)) {
      fail(e.id, "Eltern und Kind können nicht als Partner verbunden werden");
      continue;
    }
    if (e.type === "PARENT_OF") {
      if (e.subtype === "BIOLOGICAL" && (bioCount.get(e.to) ?? 0) >= MAX_BIOLOGICAL_PARENTS) {
        fail(e.id, `Mehr als ${MAX_BIOLOGICAL_PARENTS} leibliche Elternteile`);
        continue;
      }
      if (reaches(e.to, e.from)) {
        fail(e.id, "Diese Eltern-Kind-Beziehung würde einen Zyklus erzeugen");
        continue;
      }
      children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
      parentPairs.add(pk);
      if (e.subtype === "BIOLOGICAL") bioCount.set(e.to, (bioCount.get(e.to) ?? 0) + 1);
    } else {
      partnerPairs.add(pk);
    }
    seenTyped.add(typed);
  }
}
