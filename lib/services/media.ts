import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { deleteObject } from "../storage";
import { conflictError } from "./errors";

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

/**
 * Welche der Bilder hingen an nichts mehr, wenn die genannten Beziehungen,
 * Ereignisse und Belege gelöscht würden? (Vorab-Prüfung: über den KI-Zugang
 * wird nie ein Bild gelöscht — siehe assertNoMediaLossViaAi.)
 */
export async function mediaOrphanedWithout(
  candidateIds: string[],
  gone: { relationshipIds?: string[]; eventIds?: string[]; citationIds?: string[] },
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await prisma.mediaAsset.findMany({
    where: {
      id: { in: candidateIds },
      persons: { none: {} },
      sources: { none: {} },
      sourceLinks: { none: {} },
      relationships: { none: { relationshipId: { notIn: gone.relationshipIds ?? [] } } },
      eventLinks: { none: { eventId: { notIn: gone.eventIds ?? [] } } },
      citationLinks: { none: { citationId: { notIn: gone.citationIds ?? [] } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Über den KI-Zugang (MCP) wird nie ein Bild gelöscht — auch nicht als
 * Nebenwirkung, wenn eine Beziehung oder ein Ereignis entfernt wird, an dem
 * das Bild als einzigem hängt. Dann wird das Löschen abgelehnt; in der App
 * (mit Rückfrage) geht es weiterhin.
 */
export async function assertNoMediaLossViaAi(
  scope: Pick<Scope, "via">,
  candidateIds: string[],
  gone: { relationshipIds?: string[]; eventIds?: string[]; citationIds?: string[] },
): Promise<void> {
  if (!scope.via) return;
  const lost = await mediaOrphanedWithout(candidateIds, gone);
  if (lost.length === 0) return;
  throw conflictError(
    `Mit diesem Eintrag gingen ${lost.length === 1 ? "ein Bild" : `${lost.length} Bilder`} verloren, die nur daran hängen. ` +
      "Über den KI-Zugang werden keine Bilder gelöscht — den Eintrag bitte in der App löschen oder die Bilder vorher an einen anderen Eintrag hängen.",
    { reason: "WOULD_DELETE_MEDIA", mediaIds: lost },
  );
}
