import { prisma } from "../prisma";
import { deleteObject } from "../storage";

/**
 * Löscht Bilder, die an nichts mehr hängen — weder an einer Person, einer
 * Beziehung, einem Ereignis, einem Beleg noch an einer Quelle (Hauptscan oder
 * SourceMedia) —, samt Dateien im Medienordner. Ein Bild, das noch woanders
 * zugeordnet ist, bleibt.
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
      sourceLinks: { none: {} },
      eventLinks: { none: {} },
      citationLinks: { none: {} },
    },
    select: { id: true, storageKey: true, thumbnailKey: true },
  });
  if (orphans.length === 0) return [];
  await prisma.mediaAsset.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
  // Dateien nach der Datenbank aufräumen (wie beim Löschen eines
  // einzelnen Bildes): schlägt das fehl, bleibt nur eine verwaiste Datei.
  await Promise.all(
    orphans
      .flatMap((o) => [o.storageKey, o.thumbnailKey])
      .filter((k): k is string => Boolean(k))
      .map((k) => deleteObject(k).catch((e) => console.error("[media] Bild nicht gelöscht:", k, e))),
  );
  return orphans.map((o) => o.id);
}

/**
 * Bilder, die an den genannten Ereignissen, Belegen bzw. Quellen hängen (auch
 * an den Belegen dieser Ereignisse bzw. Quellen) — Kandidaten für
 * removeOrphanedMedia, bevor diese Einträge gelöscht werden.
 */
export async function mediaAttachedTo(where: { eventIds?: string[]; citationIds?: string[]; sourceIds?: string[] }): Promise<string[]> {
  const eventIds = where.eventIds ?? [];
  const citationIds = where.citationIds ?? [];
  const sourceIds = where.sourceIds ?? [];
  const [events, cites, links, mains] = await Promise.all([
    eventIds.length ? prisma.eventMedia.findMany({ where: { eventId: { in: eventIds } }, select: { mediaId: true } }) : [],
    citationIds.length || eventIds.length || sourceIds.length
      ? prisma.citationMedia.findMany({
          where: {
            citation: {
              OR: [{ id: { in: citationIds } }, { eventId: { in: eventIds } }, { sourceId: { in: sourceIds } }],
            },
          },
          select: { mediaId: true },
        })
      : [],
    sourceIds.length ? prisma.sourceMedia.findMany({ where: { sourceId: { in: sourceIds } }, select: { mediaId: true } }) : [],
    sourceIds.length ? prisma.source.findMany({ where: { id: { in: sourceIds }, mediaId: { not: null } }, select: { mediaId: true } }) : [],
  ]);
  return [
    ...new Set([...events, ...cites, ...links].map((r) => r.mediaId).concat(mains.map((m) => m.mediaId!))),
  ];
}
