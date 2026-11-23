import type { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { audit, auditActor } from "../audit";
import { deleteObject } from "../storage";
import {
  canDeleteMedia,
  canViewMedia,
  citationRights,
  eventRights,
  sourceRights,
} from "../media-scope";
import { canEditPerson, canEditRelationshipBetween, canViewPerson, type Scope } from "../scope";
import {
  detectImageFormat,
  IMAGE_MIME_FORMAT,
  ImageFormatError,
  processAndStoreImage,
  type StoredImage,
} from "../media-processing";
import { SafeFetchError, safeFetch, type SafeFetchOptions } from "../safe-fetch";
import { conflictError, forbiddenError, notFoundError, ServiceError, validationError } from "./errors";
import { removeOrphanedMedia } from "./media";

/**
 * Bilder anlegen und an Einträge hängen bzw. davon lösen — gemeinsam für den
 * Upload der App (app/api/media), die Verknüpfungen (app/api/media/[id]/links)
 * und die MCP-Werkzeuge add_media / link_media.
 *
 * Ziele: Personen, Beziehungen, Ereignisse, Belege, Quellen. Jedes Ziel muss
 * der Benutzer BEARBEITEN dürfen (geprüft, bevor etwas gespeichert wird);
 * unsichtbare Ziele gelten als nicht vorhanden. Ein vorhandenes Bild lässt
 * sich nur verknüpfen, wenn der Benutzer es sehen darf.
 */

export type MediaTargets = {
  personIds?: string[];
  relationshipIds?: string[];
  eventIds?: string[];
  citationIds?: string[];
  sourceIds?: string[];
};

export type MediaTargetKind = "person" | "relationship" | "event" | "citation" | "source";

/** Höchstzahl der Ziele je Aufruf. */
export const MAX_MEDIA_TARGETS = 50;

export function maxUploadBytes(): number {
  const n = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 15 * 1024 * 1024;
}

const mb = (n: number) => Math.round(n / 1024 / 1024);

/** Fehler mit Grund für die HTTP-Abbildung (413/415) — sonst ein normaler VALIDATION-Fehler. */
export type MediaErrorReason = "TOO_LARGE" | "FORMAT" | "FETCH" | "TYPE_MISMATCH" | "DATA";
const mediaError = (reason: MediaErrorReason, message: string, path = "file") =>
  new ServiceError("VALIDATION", message, { issues: [{ path: [path], message }], details: { reason } });

export function mediaErrorReason(err: unknown): MediaErrorReason | null {
  if (!(err instanceof ServiceError)) return null;
  const r = err.details?.reason;
  return typeof r === "string" ? (r as MediaErrorReason) : null;
}

type Resolved = {
  persons: string[];
  relationships: string[];
  events: string[];
  citations: string[];
  sources: string[];
  /** Betroffene Personen fürs Changelog. */
  personIds: string[];
};

const uniq = (list: string[] | undefined) => [...new Set((list ?? []).filter((x) => typeof x === "string" && x.length > 0))];

export function targetCount(t: MediaTargets): number {
  return uniq(t.personIds).length + uniq(t.relationshipIds).length + uniq(t.eventIds).length + uniq(t.citationIds).length + uniq(t.sourceIds).length;
}

const famSel = { families: { select: { familyId: true } } } as const;
const fam = (p: { families: { familyId: string }[] }) => p.families.map((f) => f.familyId);

/** Höchstzahl der Personen, die ein Eintrag über eine Quelle mitführt (wie lib/audit.ts). */
const SOURCE_PERSON_LIMIT = 1000;

async function personsOfSource(sourceId: string): Promise<string[]> {
  const cites = await prisma.citation.findMany({
    where: { sourceId },
    select: { personId: true, relationship: { select: { fromPersonId: true, toPersonId: true } } },
    take: SOURCE_PERSON_LIMIT,
  });
  return cites.flatMap((c) => [
    ...(c.personId ? [c.personId] : []),
    ...(c.relationship ? [c.relationship.fromPersonId, c.relationship.toPersonId] : []),
  ]);
}

async function carrierPersons(c: { personId: string | null; relationshipId: string | null }): Promise<string[]> {
  if (c.personId) return [c.personId];
  if (!c.relationshipId) return [];
  const r = await prisma.relationship.findUnique({ where: { id: c.relationshipId }, select: { fromPersonId: true, toPersonId: true } });
  return r ? [r.fromPersonId, r.toPersonId] : [];
}

/**
 * Prüft alle Ziele: vorhanden und sichtbar (sonst NOT_FOUND), bearbeitbar
 * (sonst FORBIDDEN). Wirft beim ersten Problem — so wird nie nur ein Teil
 * verknüpft.
 */
export async function resolveTargets(scope: Scope, t: MediaTargets): Promise<Resolved> {
  const out: Resolved = {
    persons: uniq(t.personIds),
    relationships: uniq(t.relationshipIds),
    events: uniq(t.eventIds),
    citations: uniq(t.citationIds),
    sources: uniq(t.sourceIds),
    personIds: [],
  };
  const total = out.persons.length + out.relationships.length + out.events.length + out.citations.length + out.sources.length;
  if (total > MAX_MEDIA_TARGETS) {
    throw validationError([{ path: ["targets"], message: `Höchstens ${MAX_MEDIA_TARGETS} Ziele je Aufruf` }]);
  }
  const affected: string[] = [];

  for (const id of out.persons) {
    const p = await prisma.person.findUnique({ where: { id }, select: famSel });
    if (!p || !canViewPerson(scope, fam(p))) throw notFoundError(`Person ${id}`);
    if (!canEditPerson(scope, fam(p))) throw forbiddenError(`Bilder an dieser Person (${id})`);
    affected.push(id);
  }
  for (const id of out.relationships) {
    const r = await prisma.relationship.findUnique({
      where: { id },
      select: { fromPersonId: true, toPersonId: true, fromPerson: { select: famSel }, toPerson: { select: famSel } },
    });
    if (!r || !(canViewPerson(scope, fam(r.fromPerson)) || canViewPerson(scope, fam(r.toPerson)))) throw notFoundError(`Beziehung ${id}`);
    if (!canEditRelationshipBetween(scope, fam(r.fromPerson), fam(r.toPerson))) throw forbiddenError(`Bilder an dieser Beziehung (${id})`);
    affected.push(r.fromPersonId, r.toPersonId);
  }
  for (const id of out.events) {
    const rights = await eventRights(scope, id);
    if (!rights?.visible) throw notFoundError(`Ereignis ${id}`);
    if (!rights.editable) throw forbiddenError(`Bilder an diesem Ereignis (${id})`);
    const e = await prisma.event.findUnique({ where: { id }, select: { personId: true, relationshipId: true } });
    if (e) affected.push(...(await carrierPersons(e)));
  }
  for (const id of out.citations) {
    const rights = await citationRights(scope, id);
    if (!rights?.visible) throw notFoundError(`Beleg ${id}`);
    if (!rights.editable) throw forbiddenError(`Bilder an diesem Beleg (${id})`);
    const c = await prisma.citation.findUnique({ where: { id }, select: { personId: true, relationshipId: true } });
    if (c) affected.push(...(await carrierPersons(c)));
  }
  for (const id of out.sources) {
    const rights = await sourceRights(scope, id);
    if (!rights?.visible) throw notFoundError(`Quelle ${id}`);
    if (!rights.editable) throw forbiddenError(`Bilder an dieser Quelle (${id})`);
    // Ein Bild an einer Quelle erscheint bei allen Einträgen, die sie belegt.
    affected.push(...(await personsOfSource(id)));
  }
  out.personIds = [...new Set(affected)];
  return out;
}

/** Zusammenfassung der Ziele fürs Audit und die Antwort. */
function targetSummary(r: Resolved): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries({
      personIds: r.persons,
      relationshipIds: r.relationships,
      eventIds: r.events,
      citationIds: r.citations,
      sourceIds: r.sources,
    }).filter(([, v]) => v.length > 0),
  );
}

type Db = Prisma.TransactionClient;

/** Verknüpfungen anlegen (vorhandene bleiben unverändert). Liefert die Zahl der neuen. */
async function createLinks(db: Db, mediaId: string, r: Resolved): Promise<number> {
  let created = 0;
  for (const personId of r.persons) {
    if (await db.personMedia.findUnique({ where: { personId_mediaId: { personId, mediaId } } })) continue;
    const [hasPrimary, order] = await Promise.all([
      db.personMedia.count({ where: { personId, isPrimary: true } }),
      db.personMedia.count({ where: { personId } }),
    ]);
    // Wie beim Upload: das erste Bild einer Person wird ihr Porträt.
    await db.personMedia.create({ data: { personId, mediaId, isPrimary: hasPrimary === 0, sortOrder: order } });
    created++;
  }
  for (const relationshipId of r.relationships) {
    if (await db.relationshipMedia.findUnique({ where: { relationshipId_mediaId: { relationshipId, mediaId } } })) continue;
    const [hasPrimary, order] = await Promise.all([
      db.relationshipMedia.count({ where: { relationshipId, isPrimary: true } }),
      db.relationshipMedia.count({ where: { relationshipId } }),
    ]);
    await db.relationshipMedia.create({ data: { relationshipId, mediaId, isPrimary: hasPrimary === 0, sortOrder: order } });
    created++;
  }
  for (const eventId of r.events) {
    if (await db.eventMedia.findUnique({ where: { eventId_mediaId: { eventId, mediaId } } })) continue;
    const order = await db.eventMedia.count({ where: { eventId } });
    await db.eventMedia.create({ data: { eventId, mediaId, sortOrder: order } });
    created++;
  }
  for (const citationId of r.citations) {
    if (await db.citationMedia.findUnique({ where: { citationId_mediaId: { citationId, mediaId } } })) continue;
    const order = await db.citationMedia.count({ where: { citationId } });
    await db.citationMedia.create({ data: { citationId, mediaId, sortOrder: order } });
    created++;
  }
  for (const sourceId of r.sources) {
    const [link, main] = await Promise.all([
      db.sourceMedia.findUnique({ where: { sourceId_mediaId: { sourceId, mediaId } } }),
      db.source.findUnique({ where: { id: sourceId }, select: { mediaId: true } }),
    ]);
    if (link || main?.mediaId === mediaId) continue;
    const order = await db.sourceMedia.count({ where: { sourceId } });
    await db.sourceMedia.create({ data: { sourceId, mediaId, sortOrder: order + 1 } });
    created++;
  }
  return created;
}

export type MediaBrief = {
  id: string;
  fileName: string | null;
  caption: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

const brief = (m: MediaBrief): MediaBrief => ({
  id: m.id,
  fileName: m.fileName,
  caption: m.caption,
  mimeType: m.mimeType,
  sizeBytes: m.sizeBytes,
  width: m.width,
  height: m.height,
});

// ---------------------------------------------------------------------------
// Eingänge: Upload-Bytes, base64, Adresse
// ---------------------------------------------------------------------------

/**
 * base64 (auch als data:-URL) in Bytes. Größe wird VOR dem Dekodieren
 * geschätzt, damit ein riesiger Text nicht erst in den Speicher dekodiert wird.
 */
export function decodeBase64Image(input: string, maxBytes = maxUploadBytes()): { bytes: Buffer; declaredMime: string | null } {
  let s = input.trim();
  let declaredMime: string | null = null;
  const dataUrl = /^data:([a-z0-9.+/-]+)?(;[a-z0-9=.+-]+)*;base64,/i.exec(s);
  if (dataUrl) {
    declaredMime = dataUrl[1]?.toLowerCase() ?? null;
    s = s.slice(dataUrl[0].length);
  }
  s = s.replace(/\s+/g, "");
  if (!s) throw mediaError("DATA", "Keine Bilddaten übermittelt", "data_base64");
  // Auch base64url (- und _) annehmen, Auffüllung ergänzen.
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw mediaError("DATA", "data_base64 ist kein gültiges base64", "data_base64");
  const unpadded = s.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) throw mediaError("DATA", "data_base64 ist kein gültiges base64", "data_base64");
  const estimated = Math.floor((unpadded.length * 3) / 4);
  if (estimated > maxBytes) throw mediaError("TOO_LARGE", `Datei zu groß (max. ${mb(maxBytes)} MB)`, "data_base64");
  const bytes = Buffer.from(unpadded, "base64");
  if (bytes.byteLength === 0) throw mediaError("DATA", "Keine Bilddaten übermittelt", "data_base64");
  return { bytes, declaredMime };
}

/** Dateiname aus einer Adresse („…/scan_12.jpg“ → „scan_12.jpg“). */
function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "bild";
  } catch {
    return "bild";
  }
}

/**
 * Bild von einer Adresse holen — ausschließlich über lib/safe-fetch.ts: nur
 * https auf Port 443, alle aufgelösten Adressen öffentlich (kein Heimnetz,
 * kein localhost, keine Cloud-Metadaten), Verbindung genau an die geprüfte
 * Adresse, höchstens 3 Weiterleitungen (jede neu geprüft), Größe beim Lesen
 * gezählt (MAX_UPLOAD_BYTES), nur image/* bzw. octet-stream, 20 s Gesamtzeit.
 * Den Inhalt prüft danach sharp wie beim Upload.
 */
export async function fetchImageFromUrl(
  url: string,
  fetchOptions: SafeFetchOptions = {},
): Promise<{ bytes: Buffer; fileName: string; contentType: string; finalUrl: string }> {
  try {
    const res = await safeFetch(url, { maxBytes: maxUploadBytes(), ...fetchOptions });
    return { bytes: res.bytes, fileName: fileNameFromUrl(res.finalUrl), contentType: res.contentType, finalUrl: res.finalUrl };
  } catch (err) {
    if (err instanceof SafeFetchError) {
      throw mediaError(err.code === "TOO_LARGE" ? "TOO_LARGE" : "FETCH", `Bild nicht abrufbar: ${err.message}`, "url");
    }
    throw err;
  }
}

/** Format anhand der Bytes; eine Typangabe muss dazu passen (sie wird nicht geglaubt). */
async function checkFormat(bytes: Buffer, declaredMime: string | null | undefined): Promise<string> {
  let format: string;
  try {
    format = await detectImageFormat(bytes);
  } catch (err) {
    if (err instanceof ImageFormatError) throw mediaError("FORMAT", err.message);
    throw err;
  }
  const declared = declaredMime?.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") {
    const expected = IMAGE_MIME_FORMAT[declared];
    if (!expected) throw mediaError("FORMAT", `Bildtyp nicht erlaubt: ${declared}`, "mime_type");
    // sharp meldet AVIF als heif — beides als dieselbe Familie werten.
    const norm = (f: string) => (f === "heif" ? "avif" : f);
    if (norm(expected) !== norm(format)) {
      throw mediaError("TYPE_MISMATCH", `Angegebener Typ ${declared} passt nicht zum Inhalt (erkannt: ${format})`, "mime_type");
    }
  }
  return format;
}

// ---------------------------------------------------------------------------
// Anlegen, verknüpfen, lösen
// ---------------------------------------------------------------------------

export type AddMediaInput = {
  bytes: Buffer;
  fileName?: string | null;
  caption?: string | null;
  /** Angegebene Inhaltsart — nur zur Gegenprobe, entscheidend sind die Bytes. */
  declaredMime?: string | null;
  targets: MediaTargets;
  /** Ohne Ziel ablehnen (MCP); in der App dürfen Admins ohne Ziel hochladen. */
  requireTarget?: boolean;
  /** Herkunft fürs Audit. */
  via?: "upload" | "url" | "data";
  url?: string | null;
};

/**
 * Neues Bild: Ziele prüfen, Größe und Typ prüfen, nach WebP umrechnen
 * (lib/media-processing.ts), Bild und Verknüpfungen in einer Transaktion
 * anlegen, Audit mit allen betroffenen Personen.
 */
export async function addMedia(scope: Scope, input: AddMediaInput): Promise<{ media: MediaBrief; linked: Record<string, string[]> }> {
  const resolved = await resolveTargets(scope, input.targets);
  const total = targetCount(input.targets);
  if (total === 0) {
    if (input.requireTarget) {
      throw validationError([{ path: ["targets"], message: "Mindestens ein Ziel angeben (Person, Beziehung, Ereignis, Beleg oder Quelle)" }]);
    }
    if (!scope.isAdmin) throw forbiddenError("Bilder ohne Zuordnung");
  }
  const max = maxUploadBytes();
  if (input.bytes.byteLength === 0) throw mediaError("DATA", "Leere Datei");
  if (input.bytes.byteLength > max) throw mediaError("TOO_LARGE", `Datei zu groß (max. ${mb(max)} MB)`);
  await checkFormat(input.bytes, input.declaredMime);

  let stored: StoredImage;
  try {
    stored = await processAndStoreImage(input.bytes, { checkFormat: false });
  } catch (err) {
    if (err instanceof ImageFormatError) throw mediaError("FORMAT", err.message);
    throw err;
  }

  const caption = input.caption?.trim() ? input.caption.trim().slice(0, 500) : null;
  const fileName = input.fileName?.trim() ? input.fileName.trim().slice(0, 200) : null;
  let asset;
  try {
    asset = await prisma.$transaction(async (tx) => {
      const a = await tx.mediaAsset.create({
        data: { ...stored, fileName, caption, uploadedById: scope.userId },
      });
      await createLinks(tx, a.id, resolved);
      return a;
    });
  } catch (err) {
    // Dateien ohne Datenbankeintrag wieder entfernen.
    await Promise.all([deleteObject(stored.storageKey), deleteObject(stored.thumbnailKey)].map((p) => p.catch(() => {})));
    throw err;
  }

  const linked = targetSummary(resolved);
  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "MediaAsset",
    entityId: asset.id,
    diff: {
      subject: fileName ?? caption ?? null,
      caption,
      sizeBytes: asset.sizeBytes,
      via: input.via ?? "upload",
      ...(input.url ? { url: input.url.slice(0, 500) } : {}),
      // Rückwärtsverträglich (ältere Einträge): erste Person bzw. Beziehung.
      personId: resolved.persons[0] ?? null,
      relationshipId: resolved.relationships[0] ?? null,
      linked,
    },
    personIds: resolved.personIds,
  });
  return { media: brief(asset), linked };
}

async function loadVisibleMedia(scope: Scope, mediaId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  // Kein Verknüpfen fremder, unsichtbarer Bilder: unsichtbar = nicht vorhanden.
  if (!asset || !(await canViewMedia(scope, mediaId))) throw notFoundError("Bild");
  return asset;
}

/** Vorhandenes Bild an weitere Einträge hängen. */
export async function linkMedia(
  scope: Scope,
  mediaId: string,
  targets: MediaTargets,
): Promise<{ media: MediaBrief; linked: Record<string, string[]>; created: number }> {
  if (targetCount(targets) === 0) throw validationError([{ path: ["targets"], message: "Mindestens ein Ziel angeben" }]);
  const asset = await loadVisibleMedia(scope, mediaId);
  const resolved = await resolveTargets(scope, targets);
  const created = await prisma.$transaction((tx) => createLinks(tx, mediaId, resolved));
  const linked = targetSummary(resolved);
  if (created > 0) {
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "MediaAsset",
      entityId: mediaId,
      diff: { subject: asset.fileName ?? asset.caption ?? null, linked },
      personIds: resolved.personIds,
    });
  }
  return { media: brief(asset), linked, created };
}

/** Zahl der Zuordnungen eines Bildes (alle Arten, Hauptscan eingeschlossen). */
export async function mediaLinkCount(mediaId: string, db: Db | typeof prisma = prisma): Promise<number> {
  const counts = await Promise.all([
    db.personMedia.count({ where: { mediaId } }),
    db.relationshipMedia.count({ where: { mediaId } }),
    db.eventMedia.count({ where: { mediaId } }),
    db.citationMedia.count({ where: { mediaId } }),
    db.sourceMedia.count({ where: { mediaId } }),
    db.source.count({ where: { mediaId } }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Bild von Einträgen lösen. Hinge es danach an nichts mehr, wird es mit
 * `deleteOrphan` gelöscht (App, nach Rückfrage) — sonst abgelehnt (MCP: die
 * KI löscht keine Bilder).
 */
export async function unlinkMedia(
  scope: Scope,
  mediaId: string,
  targets: MediaTargets,
  options: { deleteOrphan?: boolean } = {},
): Promise<{ media: MediaBrief; unlinked: Record<string, string[]>; deleted: boolean }> {
  if (targetCount(targets) === 0) throw validationError([{ path: ["targets"], message: "Mindestens ein Ziel angeben" }]);
  const asset = await loadVisibleMedia(scope, mediaId);
  const resolved = await resolveTargets(scope, targets);

  // Jede genannte Zuordnung muss bestehen — sonst ist der Aufruf ein Irrtum.
  const missing: string[] = [];
  const has = async (kind: MediaTargetKind, id: string) => {
    switch (kind) {
      case "person":
        return Boolean(await prisma.personMedia.findUnique({ where: { personId_mediaId: { personId: id, mediaId } } }));
      case "relationship":
        return Boolean(await prisma.relationshipMedia.findUnique({ where: { relationshipId_mediaId: { relationshipId: id, mediaId } } }));
      case "event":
        return Boolean(await prisma.eventMedia.findUnique({ where: { eventId_mediaId: { eventId: id, mediaId } } }));
      case "citation":
        return Boolean(await prisma.citationMedia.findUnique({ where: { citationId_mediaId: { citationId: id, mediaId } } }));
      case "source": {
        const [link, main] = await Promise.all([
          prisma.sourceMedia.findUnique({ where: { sourceId_mediaId: { sourceId: id, mediaId } } }),
          prisma.source.findUnique({ where: { id }, select: { mediaId: true } }),
        ]);
        return Boolean(link) || main?.mediaId === mediaId;
      }
    }
  };
  const pairs: [MediaTargetKind, string[]][] = [
    ["person", resolved.persons],
    ["relationship", resolved.relationships],
    ["event", resolved.events],
    ["citation", resolved.citations],
    ["source", resolved.sources],
  ];
  for (const [kind, ids] of pairs) for (const id of ids) if (!(await has(kind, id))) missing.push(`${kind} ${id}`);
  if (missing.length) throw notFoundError(`Zuordnung (${missing.join(", ")})`);

  const removedCount = pairs.reduce((n, [, ids]) => n + ids.length, 0);
  if (!options.deleteOrphan && (await mediaLinkCount(mediaId)) - removedCount <= 0) {
    throw conflictError(
      "Das Bild hinge danach an nichts mehr. Entfernen geht nur, solange es noch an einem anderen Eintrag hängt — ganz löschen lässt es sich nur in der App.",
      { reason: "LAST_LINK" },
    );
  }

  // Würde das Bild dabei endgültig gelöscht, gilt die Löschregel des Bildes
  // (lib/media-scope.ts) — sonst ließe sich der Scan einer gemeinsam
  // genutzten Quelle über „lösen“ entfernen, obwohl „löschen“ verboten ist.
  if (options.deleteOrphan && (await mediaLinkCount(mediaId)) - removedCount <= 0 && !(await canDeleteMedia(scope, mediaId))) {
    throw forbiddenError("dieses Bild endgültig zu löschen");
  }

  await prisma.$transaction(async (tx) => {
    for (const personId of resolved.persons) {
      const link = await tx.personMedia.delete({ where: { personId_mediaId: { personId, mediaId } } });
      if (link.isPrimary) {
        // Porträt weg: das nächste Bild der Person übernimmt.
        const next = await tx.personMedia.findFirst({ where: { personId }, orderBy: [{ sortOrder: "asc" }, { mediaId: "asc" }] });
        if (next) await tx.personMedia.update({ where: { personId_mediaId: { personId, mediaId: next.mediaId } }, data: { isPrimary: true } });
      }
    }
    for (const relationshipId of resolved.relationships) {
      const link = await tx.relationshipMedia.delete({ where: { relationshipId_mediaId: { relationshipId, mediaId } } });
      if (link.isPrimary) {
        const next = await tx.relationshipMedia.findFirst({ where: { relationshipId }, orderBy: [{ sortOrder: "asc" }, { mediaId: "asc" }] });
        if (next) await tx.relationshipMedia.update({ where: { relationshipId_mediaId: { relationshipId, mediaId: next.mediaId } }, data: { isPrimary: true } });
      }
    }
    if (resolved.events.length) await tx.eventMedia.deleteMany({ where: { mediaId, eventId: { in: resolved.events } } });
    if (resolved.citations.length) await tx.citationMedia.deleteMany({ where: { mediaId, citationId: { in: resolved.citations } } });
    if (resolved.sources.length) {
      await tx.sourceMedia.deleteMany({ where: { mediaId, sourceId: { in: resolved.sources } } });
      await tx.source.updateMany({ where: { id: { in: resolved.sources }, mediaId }, data: { mediaId: null } });
    }
  });

  const deleted = options.deleteOrphan ? (await removeOrphanedMedia([mediaId])).length > 0 : false;
  const unlinked = targetSummary(resolved);
  await audit({
    ...auditActor(scope),
    action: deleted ? "DELETE" : "UPDATE",
    entityType: "MediaAsset",
    entityId: mediaId,
    diff: { subject: asset.fileName ?? asset.caption ?? null, unlinked, ...(deleted ? { deletedAsOrphan: true } : {}) },
    personIds: resolved.personIds,
  });
  return { media: brief(asset), unlinked, deleted };
}
