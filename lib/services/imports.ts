import { createHash, randomBytes } from "node:crypto";

import type { ImportBatch, ImportStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../prisma";
import { audit, auditActor } from "../audit";
import { canViewPerson, type Scope } from "../scope";
import { deleteObject, getObjectBuffer, putObject } from "../storage";
import { importFingerprint, type ImportEntity } from "../import-fingerprint";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { getSource } from "./sources";

/**
 * Importläufe, Herkunft importierter Datensätze, Fremdkennungen und der
 * Rohdatenspeicher. Alles hier ist Verwaltung und nur für Administratoren —
 * mit einer Ausnahme: listRawRecords liefert die Rohdaten einer Person bzw.
 * Beziehung jedem, der sie sehen darf (die Rohdaten gehören zu ihr).
 *
 * Schreiben der eigentlichen Daten: applyGenealogyImport (import-apply.ts).
 */

/** Unterordner in MEDIA_DIR für Originaldateien von Importen. */
export const IMPORT_FILES_DIR = "imports";

/** Höchstgröße eines Rohdatensatzes (serialisiertes JSON). */
export const MAX_RAW_RECORD_BYTES = 256 * 1024;

/** Höchstgröße einer gespeicherten Importdatei. */
export const MAX_IMPORT_FILE_BYTES = 200 * 1024 * 1024;

/** cuid-ähnliche ID, vorab erzeugt — der Massenimport braucht sie vor dem Schreiben. */
export function newId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString("hex")}`.slice(0, 25);
}

function assertAdmin(scope: Scope, what: string) {
  if (!scope.isAdmin) throw forbiddenError(what);
}

// ---------------------------------------------------------------------------
// Importläufe
// ---------------------------------------------------------------------------

export type ImportBatchDto = {
  id: string;
  userId: string | null;
  format: string;
  fileName: string;
  fileSizeBytes: number;
  fileSha256: string;
  hasFile: boolean;
  sourceTreeId: string | null;
  sourceSystem: string | null;
  sourceSystemName: string | null;
  sourceVersion: string | null;
  gedcomVersion: string | null;
  charset: string | null;
  header: unknown;
  counts: unknown;
  warnings: unknown;
  status: ImportStatus;
  notes: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function toBatchDto(b: ImportBatch): ImportBatchDto {
  return {
    id: b.id,
    userId: b.userId,
    format: b.format,
    fileName: b.fileName,
    fileSizeBytes: b.fileSizeBytes,
    fileSha256: b.fileSha256,
    hasFile: Boolean(b.storageKey),
    sourceTreeId: b.sourceTreeId,
    sourceSystem: b.sourceSystem,
    sourceSystemName: b.sourceSystemName,
    sourceVersion: b.sourceVersion,
    gedcomVersion: b.gedcomVersion,
    charset: b.charset,
    header: b.header,
    counts: b.counts,
    warnings: b.warnings,
    status: b.status,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    finishedAt: b.finishedAt?.toISOString() ?? null,
  };
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const batchInput = z.object({
  format: z.string().trim().min(1).max(40),
  fileName: z.string().trim().min(1).max(300),
  sourceTreeId: optText(300),
  sourceSystem: optText(200),
  sourceSystemName: optText(300),
  sourceVersion: optText(100),
  gedcomVersion: optText(40),
  charset: optText(40),
  header: z.unknown().optional(),
  notes: optText(5000),
  /** false: Datei nicht aufbewahren (nur Hash und Größe). Standard: aufbewahren. */
  keepFile: z.boolean().default(true),
});

/**
 * Neuer Importlauf: speichert die Originaldatei unverändert unter
 * MEDIA_DIR/imports/<id>.<endung> (mehrere Stände desselben Baums liegen
 * nebeneinander) und legt den Lauf mit Status PENDING an. Nur Administratoren.
 *
 * Gleiche Datei schon einmal importiert? → listImportBatches({ fileSha256 }).
 */
export async function createImportBatch(
  scope: Scope,
  input: unknown,
  content: Buffer | Uint8Array,
): Promise<ImportBatchDto> {
  assertAdmin(scope, "Daten zu importieren");
  const data = parseOrThrow(batchInput.safeParse(input));
  if (content.byteLength > MAX_IMPORT_FILE_BYTES) {
    // Eine zu große Datei ist ein Eingabefehler, keine Rechtefrage.
    throw validationError([
      { path: "file", message: `Die Datei ist zu groß (höchstens ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB)` },
    ]);
  }
  const id = newId();
  const sha = createHash("sha256").update(content).digest("hex");
  const ext = (data.fileName.match(/\.([A-Za-z0-9]{1,10})$/)?.[1] ?? "bin").toLowerCase();
  const storageKey = data.keepFile ? `${IMPORT_FILES_DIR}/${id}.${ext}` : null;
  if (storageKey) await putObject(storageKey, content);

  try {
    const batch = await prisma.importBatch.create({
      data: {
        id,
        userId: scope.userId,
        format: data.format,
        fileName: data.fileName,
        fileSizeBytes: content.byteLength,
        fileSha256: sha,
        storageKey,
        sourceTreeId: data.sourceTreeId,
        sourceSystem: data.sourceSystem,
        sourceSystemName: data.sourceSystemName,
        sourceVersion: data.sourceVersion,
        gedcomVersion: data.gedcomVersion,
        charset: data.charset,
        header: (data.header ?? undefined) as Prisma.InputJsonValue | undefined,
        notes: data.notes,
      },
    });
    await audit({
      ...auditActor(scope),
      action: "CREATE",
      entityType: "ImportBatch",
      entityId: id,
      diff: { format: data.format, fileName: data.fileName, fileSha256: sha, sourceTreeId: data.sourceTreeId },
    });
    return toBatchDto(batch);
  } catch (err) {
    if (storageKey) await deleteObject(storageKey).catch(() => {});
    throw err;
  }
}

/** Lauf abschließen: Status, Zählungen, Warnungen. */
export async function finishImportBatch(
  scope: Scope,
  id: string,
  result: { status: "COMPLETED" | "FAILED"; counts?: unknown; warnings?: unknown; notes?: string | null },
): Promise<ImportBatchDto> {
  assertAdmin(scope, "Importläufe zu ändern");
  const before = await prisma.importBatch.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw notFoundError("Importlauf");
  const batch = await prisma.importBatch.update({
    where: { id },
    data: {
      status: result.status,
      counts: (result.counts ?? undefined) as Prisma.InputJsonValue | undefined,
      warnings: (result.warnings ?? undefined) as Prisma.InputJsonValue | undefined,
      ...(result.notes !== undefined ? { notes: result.notes } : {}),
      finishedAt: new Date(),
    },
  });
  await audit({ ...auditActor(scope), action: "UPDATE", entityType: "ImportBatch", entityId: id, diff: { status: result.status, changes: { status: { from: before.status, to: result.status } } } });
  return toBatchDto(batch);
}

export async function listImportBatches(
  scope: Scope,
  options: { sourceTreeId?: string; fileSha256?: string; limit?: number } = {},
): Promise<ImportBatchDto[]> {
  assertAdmin(scope, "Importläufe zu sehen");
  const rows = await prisma.importBatch.findMany({
    where: {
      ...(options.sourceTreeId ? { sourceTreeId: options.sourceTreeId } : {}),
      ...(options.fileSha256 ? { fileSha256: options.fileSha256 } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: Math.max(1, Math.min(1000, options.limit ?? 100)),
  });
  return rows.map(toBatchDto);
}

export async function getImportBatch(scope: Scope, id: string): Promise<ImportBatchDto | null> {
  assertAdmin(scope, "Importläufe zu sehen");
  const b = await prisma.importBatch.findUnique({ where: { id } });
  return b ? toBatchDto(b) : null;
}

/** Originaldatei eines Laufs (null, wenn nicht aufbewahrt oder verschwunden). */
export async function readImportBatchFile(scope: Scope, id: string): Promise<Buffer | null> {
  assertAdmin(scope, "Importdateien zu lesen");
  const b = await prisma.importBatch.findUnique({ where: { id }, select: { storageKey: true } });
  if (!b) throw notFoundError("Importlauf");
  return b.storageKey ? getObjectBuffer(b.storageKey) : null;
}

// ---------------------------------------------------------------------------
// Herkunft (ImportLink) — Grundlage der Vorschau eines erneuten Imports
// ---------------------------------------------------------------------------

export type ImportLinkState = {
  linkId: string;
  entityType: ImportEntity;
  /** ID des Datensatzes in der App. */
  entityId: string;
  externalKey: string | null;
  sourceTreeId: string | null;
  firstBatchId: string | null;
  lastBatchId: string | null;
  importedAt: string;
  importHash: string;
  /** Fingerabdruck des heutigen Stands. */
  currentHash: string;
  /** In der App geändert, seit der letzte Import ihn geschrieben hat. */
  editedSinceImport: boolean;
  sourceStamp: string | null;
  missingSinceBatchId: string | null;
};

const LINK_FK: Record<ImportEntity, "personId" | "relationshipId" | "eventId" | "personNameId" | "citationId" | "sourceId" | "mediaId"> = {
  PERSON: "personId",
  RELATIONSHIP: "relationshipId",
  EVENT: "eventId",
  PERSON_NAME: "personNameId",
  CITATION: "citationId",
  SOURCE: "sourceId",
  MEDIA: "mediaId",
};
export const importLinkColumn = (entity: ImportEntity) => LINK_FK[entity];

/** Heutige Zeilen eines Typs (für den Fingerabdruck), nach ID. */
export async function loadRowsForFingerprint(
  db: Prisma.TransactionClient | typeof prisma,
  entity: ImportEntity,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();
  const where = { id: { in: ids } };
  let rows: { id: string }[];
  switch (entity) {
    case "PERSON":
      rows = await db.person.findMany({ where });
      break;
    case "RELATIONSHIP":
      rows = await db.relationship.findMany({ where });
      break;
    case "EVENT":
      rows = await db.event.findMany({ where });
      break;
    case "PERSON_NAME":
      rows = await db.personName.findMany({ where });
      break;
    case "CITATION":
      rows = await db.citation.findMany({ where });
      break;
    case "SOURCE":
      rows = await db.source.findMany({ where });
      break;
    case "MEDIA":
      rows = await db.mediaAsset.findMany({ where });
      break;
  }
  return new Map(rows.map((r) => [r.id, r as unknown as Record<string, unknown>]));
}

/**
 * Herkunftsangaben importierter Datensätze — für die Vorschau eines erneuten
 * Imports: was kam woher, was wurde seither in der App geändert
 * (editedSinceImport), was fehlte schon in einem früheren Stand. Gefiltert
 * nach Baum der Quelle und/oder Lauf. Nur Administratoren.
 */
export async function listImportLinks(
  scope: Scope,
  options: { sourceTreeId?: string; batchId?: string; entityTypes?: ImportEntity[] } = {},
): Promise<ImportLinkState[]> {
  assertAdmin(scope, "Importherkunft zu sehen");
  const links = await prisma.importLink.findMany({
    where: {
      ...(options.sourceTreeId ? { sourceTreeId: options.sourceTreeId } : {}),
      ...(options.batchId ? { OR: [{ lastBatchId: options.batchId }, { firstBatchId: options.batchId }] } : {}),
      ...(options.entityTypes?.length ? { entityType: { in: options.entityTypes } } : {}),
    },
    orderBy: [{ entityType: "asc" }, { externalKey: "asc" }, { id: "asc" }],
  });

  const out: ImportLinkState[] = [];
  const byEntity = new Map<ImportEntity, typeof links>();
  for (const l of links) {
    const e = l.entityType as ImportEntity;
    const list = byEntity.get(e) ?? [];
    list.push(l);
    byEntity.set(e, list);
  }
  for (const [entity, list] of byEntity) {
    const col = LINK_FK[entity];
    const rows = await loadRowsForFingerprint(
      prisma,
      entity,
      list.map((l) => l[col]).filter((x): x is string => Boolean(x)),
    );
    for (const l of list) {
      const entityId = l[col];
      const row = entityId ? rows.get(entityId) : undefined;
      if (!entityId || !row) continue;
      const currentHash = importFingerprint(entity, row);
      out.push({
        linkId: l.id,
        entityType: entity,
        entityId,
        externalKey: l.externalKey,
        sourceTreeId: l.sourceTreeId,
        firstBatchId: l.firstBatchId,
        lastBatchId: l.lastBatchId,
        importedAt: l.importedAt.toISOString(),
        importHash: l.importHash,
        currentHash,
        editedSinceImport: currentHash !== l.importHash,
        sourceStamp: l.sourceStamp,
        missingSinceBatchId: l.missingSinceBatchId,
      });
    }
  }
  return out;
}

/**
 * Vom Admin entschieden: diese importierten Datensätze fehlen im Stand
 * `batchId` der Quelle, bleiben aber erhalten. Löschen geht über die
 * normalen Dienste (deletePerson, deleteEvent …) — nie automatisch.
 */
export async function markMissingInSource(
  scope: Scope,
  batchId: string,
  linkIds: string[],
): Promise<{ count: number }> {
  assertAdmin(scope, "Importherkunft zu ändern");
  const r = await prisma.importLink.updateMany({
    where: { id: { in: linkIds } },
    data: { missingSinceBatchId: batchId },
  });
  return { count: r.count };
}

// ---------------------------------------------------------------------------
// Fremdkennungen
// ---------------------------------------------------------------------------

export type ExternalIdMatch = {
  system: string;
  value: string;
  batchId: string | null;
  entityType: ImportEntity;
  entityId: string;
};

/**
 * Datensätze zu Fremdkennungen, z.B. system "UID" mit allen _UID-Werten einer
 * Datei. `batchId` schränkt ein (für Xrefs, die nur je Datei eindeutig sind).
 * Nur Administratoren.
 */
export async function findExternalIds(
  scope: Scope,
  query: { system: string; values: string[]; batchId?: string },
): Promise<ExternalIdMatch[]> {
  assertAdmin(scope, "Fremdkennungen zu lesen");
  if (query.values.length === 0) return [];
  const rows = await prisma.externalId.findMany({
    where: {
      system: query.system,
      value: { in: query.values },
      ...(query.batchId ? { batchId: query.batchId } : {}),
    },
  });
  const out: ExternalIdMatch[] = [];
  for (const r of rows) {
    const [entityType, entityId] = r.personId
      ? (["PERSON", r.personId] as const)
      : r.relationshipId
        ? (["RELATIONSHIP", r.relationshipId] as const)
        : r.eventId
          ? (["EVENT", r.eventId] as const)
          : r.sourceId
            ? (["SOURCE", r.sourceId] as const)
            : r.mediaId
              ? (["MEDIA", r.mediaId] as const)
              : ([null, null] as const);
    if (!entityType) continue;
    out.push({ system: r.system, value: r.value, batchId: r.batchId, entityType, entityId });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rohdaten
// ---------------------------------------------------------------------------

export type RawRecordDto = {
  id: string;
  batchId: string | null;
  personId: string | null;
  relationshipId: string | null;
  sourceId: string | null;
  recordType: string;
  xref: string | null;
  content: unknown;
  reason: string | null;
  sizeBytes: number;
  superseded: boolean;
  createdAt: string;
};

/**
 * Nicht zugeordnete Importdaten eines Trägers. Sichtbar wie der Träger:
 * Person — ihre Familienrechte; Beziehung — sobald eine Seite sichtbar ist;
 * Quelle — wer die Quelle sieht; ein ganzer Lauf (batchId) bzw. Rohdaten
 * ohne Träger — nur Administratoren. Unsichtbar ergibt null.
 */
export async function listRawRecords(
  scope: Scope,
  target: { personId?: string; relationshipId?: string; sourceId?: string; batchId?: string },
  options: { includeSuperseded?: boolean } = {},
): Promise<RawRecordDto[] | null> {
  const fam = (p: { families: { familyId: string }[] }) => p.families.map((f) => f.familyId);
  let where: Prisma.ImportRawRecordWhereInput;
  if (target.personId) {
    const p = await prisma.person.findUnique({ where: { id: target.personId }, select: { families: { select: { familyId: true } } } });
    if (!p || !canViewPerson(scope, fam(p))) return null;
    where = { personId: target.personId };
  } else if (target.relationshipId) {
    const r = await prisma.relationship.findUnique({
      where: { id: target.relationshipId },
      select: {
        fromPerson: { select: { families: { select: { familyId: true } } } },
        toPerson: { select: { families: { select: { familyId: true } } } },
      },
    });
    if (!r || !(canViewPerson(scope, fam(r.fromPerson)) || canViewPerson(scope, fam(r.toPerson)))) return null;
    where = { relationshipId: target.relationshipId };
  } else if (target.sourceId) {
    if (!(await getSource(scope, target.sourceId))) return null;
    where = { sourceId: target.sourceId };
  } else if (target.batchId) {
    if (!scope.isAdmin) return null;
    where = { batchId: target.batchId };
  } else {
    return null;
  }
  const rows = await prisma.importRawRecord.findMany({
    where: { ...where, ...(options.includeSuperseded ? {} : { supersededAt: null }) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batchId,
    personId: r.personId,
    relationshipId: r.relationshipId,
    sourceId: r.sourceId,
    recordType: r.recordType,
    xref: r.xref,
    content: r.content,
    reason: r.reason,
    sizeBytes: r.sizeBytes,
    superseded: r.supersededAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Rohdaten bewusst entfernen (Admin): alle eines Laufs, oder nur die durch
 * spätere Importe überholten (optional älter als ein Zeitpunkt).
 */
export async function pruneRawRecords(
  scope: Scope,
  options: { batchId?: string; supersededOnly?: boolean; supersededBefore?: Date },
): Promise<{ count: number }> {
  assertAdmin(scope, "Rohdaten zu löschen");
  if (!options.batchId && !options.supersededOnly && !options.supersededBefore) {
    throw forbiddenError("alle Rohdaten ohne Einschränkung zu löschen");
  }
  const where: Prisma.ImportRawRecordWhereInput = {
    ...(options.batchId ? { batchId: options.batchId } : {}),
    ...(options.supersededOnly || options.supersededBefore
      ? { supersededAt: options.supersededBefore ? { lt: options.supersededBefore } : { not: null } }
      : {}),
  };
  const r = await prisma.importRawRecord.deleteMany({ where });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "ImportRawRecord",
    entityId: options.batchId ?? "superseded",
    diff: { count: r.count, ...options, supersededBefore: options.supersededBefore?.toISOString() },
  });
  return { count: r.count };
}
