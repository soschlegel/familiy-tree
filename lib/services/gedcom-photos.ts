import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { importFingerprint } from "../import-fingerprint";
import { ImageFormatError, processAndStoreImage } from "../media-processing";
import { deleteObject } from "../storage";
import { SafeFetchError, safeFetch, withConcurrency, type SafeFetchOptions } from "../safe-fetch";
import type { PhotoRef } from "../gedcom-import/mapping";
import { forbiddenError } from "./errors";
import { audit, auditActor } from "../audit";

/**
 * Fotos eines GEDCOM-Imports herunterladen (nur auf ausdrücklichen Wunsch,
 * nie in der Vorschau) und wie ein Upload verarbeiten (sharp prüft das Bild
 * und rechnet es nach WebP um). Jede Adresse wird im Bericht festgehalten
 * und im Lauf gespeichert. Schon geholte Fotos (ImportLink MEDIA mit
 * demselben Schlüssel im Quell-Baum) werden übersprungen. Fehler einzelner
 * Fotos brechen nichts ab.
 */

export type PhotoLogEntry = {
  url: string;
  personId: string;
  status: "stored" | "skipped" | "failed";
  message?: string;
  bytes?: number;
  ms?: number;
  redirects?: number;
};

export type PhotoDownloadReport = {
  requested: number;
  stored: number;
  skipped: number;
  failed: PhotoLogEntry[];
  log: PhotoLogEntry[];
};

export const PHOTO_CONCURRENCY = 4;

export async function downloadImportPhotos(
  scope: Scope,
  args: {
    batchId: string;
    sourceTreeId: string;
    photos: PhotoRef[];
    /** Personen-ref der Datei → ID in der App. */
    personIds: Map<string, string>;
    fetchOptions?: SafeFetchOptions;
  },
): Promise<PhotoDownloadReport> {
  if (!scope.isAdmin) throw forbiddenError("Fotos zu importieren");
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
  const wanted = args.photos.filter((p) => args.personIds.has(p.personRef));
  const known = new Set(
    (
      await prisma.importLink.findMany({
        where: { sourceTreeId: args.sourceTreeId, entityType: "MEDIA", externalKey: { in: wanted.map((p) => p.key) } },
        select: { externalKey: true },
      })
    ).map((l) => l.externalKey),
  );
  const seen = new Set<string>();
  const log: PhotoLogEntry[] = [];
  await withConcurrency(wanted, PHOTO_CONCURRENCY, async (p) => {
    const personId = args.personIds.get(p.personRef)!;
    if (known.has(p.key) || seen.has(p.key)) {
      log.push({ url: p.url, personId, status: "skipped", message: "bereits gespeichert" });
      return;
    }
    seen.add(p.key);
    const t0 = Date.now();
    let stored: Awaited<ReturnType<typeof processAndStoreImage>> | null = null;
    try {
      const res = await safeFetch(p.url, { maxBytes, ...args.fetchOptions });
      stored = await processAndStoreImage(res.bytes);
      const fileName = decodeURIComponent(new URL(res.finalUrl).pathname.split("/").pop() || "foto").slice(0, 200);
      const mediaId = await prisma.$transaction(async (tx) => {
        const hasPrimary = await tx.personMedia.count({ where: { personId, isPrimary: true } });
        const order = await tx.personMedia.count({ where: { personId } });
        const media = await tx.mediaAsset.create({
          data: {
            storageKey: stored!.storageKey,
            thumbnailKey: stored!.thumbnailKey,
            fileName,
            mimeType: stored!.mimeType,
            sizeBytes: stored!.sizeBytes,
            width: stored!.width,
            height: stored!.height,
            caption: p.title,
            uploadedById: scope.userId,
          },
        });
        await tx.personMedia.create({ data: { personId, mediaId: media.id, isPrimary: p.primary && hasPrimary === 0, sortOrder: order } });
        await tx.importLink.create({
          data: {
            entityType: "MEDIA",
            mediaId: media.id,
            sourceTreeId: args.sourceTreeId,
            externalKey: p.key,
            firstBatchId: args.batchId,
            lastBatchId: args.batchId,
            importHash: importFingerprint("MEDIA", { fileName, caption: p.title }),
          },
        });
        const ids = [{ system: "MEDIA_URL", value: p.url.slice(0, 500) }];
        if (p.key.startsWith("PHOTO:")) ids.push({ system: "PHOTO_RIN", value: p.key.slice(6, 506) });
        await tx.externalId.createMany({ data: ids.map((x) => ({ ...x, mediaId: media.id, batchId: args.batchId })) });
        return media.id;
      });
      await audit({
        ...auditActor(scope),
        action: "CREATE",
        entityType: "MediaAsset",
        entityId: mediaId,
        diff: { personId, label: fileName, import: args.batchId, sizeBytes: stored.sizeBytes },
      });
      log.push({ url: p.url, personId, status: "stored", bytes: res.bytes.byteLength, ms: Date.now() - t0, redirects: res.redirects.length });
    } catch (err) {
      if (stored) {
        await deleteObject(stored.storageKey).catch(() => {});
        await deleteObject(stored.thumbnailKey).catch(() => {});
      }
      const message =
        err instanceof SafeFetchError || err instanceof ImageFormatError ? err.message : `Fehler: ${(err as Error).message}`;
      log.push({ url: p.url, personId, status: "failed", message, ms: Date.now() - t0 });
    }
  });
  const failed = log.filter((l) => l.status === "failed");
  return {
    requested: wanted.length,
    stored: log.filter((l) => l.status === "stored").length,
    skipped: log.filter((l) => l.status === "skipped").length,
    failed,
    log,
  };
}
