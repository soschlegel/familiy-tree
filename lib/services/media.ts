import { prisma } from "../prisma";
import { deleteObject } from "../storage";

/**
 * Löscht Bilder, die an nichts mehr hängen — weder an einer Person noch an
 * einer Beziehung noch als Scan einer Quelle —, samt Dateien im
 * Objektspeicher. Ein Bild, das noch woanders zugeordnet ist, bleibt.
 * Liefert die IDs der gelöschten Bilder.
 */
export async function removeOrphanedMedia(candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const orphans = await prisma.mediaAsset.findMany({
    where: {
      id: { in: candidateIds },
      persons: { none: {} },
      relationships: { none: {} },
      sources: { none: {} },
    },
    select: { id: true, storageKey: true, thumbnailKey: true },
  });
  if (orphans.length === 0) return [];
  await prisma.mediaAsset.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
  // Objektspeicher nach der Datenbank aufräumen (wie beim Löschen eines
  // einzelnen Bildes): schlägt das fehl, bleibt nur eine verwaiste Datei.
  await Promise.all(
    orphans
      .flatMap((o) => [o.storageKey, o.thumbnailKey])
      .filter((k): k is string => Boolean(k))
      .map((k) => deleteObject(k).catch((e) => console.error("[media] Bild nicht gelöscht:", k, e))),
  );
  return orphans.map((o) => o.id);
}
