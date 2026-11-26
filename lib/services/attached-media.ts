import { prisma } from "../prisma";

/**
 * Bilder an Ereignissen, Belegen und Quellen lesen — und die Regel, wo ein
 * Bild erscheint (docs/fachlich/bilder-an-eintraegen.md):
 *
 * - Bild an einem Ereignis: beim Ereignis (Personenseite, auch bei
 *   Ereignissen einer Beziehung auf beiden Personenseiten).
 * - Bild an einem Beleg: beim Beleg, also beim belegten Eintrag (Person,
 *   Ereignis bzw. Beziehung), und auf der Seite der Quelle beim Beleg.
 * - Bild an einer Quelle (Hauptscan `Source.mediaId` oder `SourceMedia`): auf
 *   der Seite der Quelle und als „Belegbild“ bei jedem Beleg dieser Quelle —
 *   AUSSER das Bild ist zugleich mindestens einem Beleg derselben Quelle
 *   zugeordnet. Dann gehört es erkennbar zu diesem Beleg (der Eintrag auf
 *   Seite 12) und erscheint nur dort, nicht bei allen anderen Belegen der
 *   Quelle (inheritedSourceImages).
 *
 * Diese Funktionen prüfen keine Rechte: die Aufrufer übergeben nur
 * Ereignisse, Belege und Quellen, die der Benutzer sieht — und was an etwas
 * Sichtbarem hängt, ist sichtbar (lib/media-scope.ts).
 */

export type AttachedImage = {
  mediaId: string;
  caption: string | null;
  width: number | null;
  height: number | null;
};

export type SourceImage = AttachedImage & {
  /** Hauptscan (Source.mediaId) — steht immer zuerst. */
  isMain: boolean;
};

const mediaSel = { id: true, caption: true, width: true, height: true } as const;
type MediaRow = { id: string; caption: string | null; width: number | null; height: number | null };
const toImage = (m: MediaRow): AttachedImage => ({ mediaId: m.id, caption: m.caption, width: m.width, height: m.height });

function group<T>(rows: T[], key: (r: T) => string, value: (r: T) => AttachedImage): Map<string, AttachedImage[]> {
  const out = new Map<string, AttachedImage[]>();
  for (const r of rows) {
    const list = out.get(key(r)) ?? [];
    list.push(value(r));
    out.set(key(r), list);
  }
  return out;
}

const linkOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }, { mediaId: "asc" as const }];

export async function imagesOfEvents(eventIds: string[]): Promise<Map<string, AttachedImage[]>> {
  if (eventIds.length === 0) return new Map();
  const rows = await prisma.eventMedia.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: linkOrder,
    select: { eventId: true, media: { select: mediaSel } },
  });
  return group(rows, (r) => r.eventId, (r) => toImage(r.media));
}

export async function imagesOfCitations(citationIds: string[]): Promise<Map<string, AttachedImage[]>> {
  if (citationIds.length === 0) return new Map();
  const rows = await prisma.citationMedia.findMany({
    where: { citationId: { in: citationIds } },
    orderBy: linkOrder,
    select: { citationId: true, media: { select: mediaSel } },
  });
  return group(rows, (r) => r.citationId, (r) => toImage(r.media));
}

/** Bilder je Quelle: Hauptscan zuerst, dann SourceMedia (ohne Doppel). */
export async function imagesOfSources(sourceIds: string[]): Promise<Map<string, SourceImage[]>> {
  if (sourceIds.length === 0) return new Map();
  const [sources, links] = await Promise.all([
    prisma.source.findMany({ where: { id: { in: sourceIds }, mediaId: { not: null } }, select: { id: true, media: { select: mediaSel } } }),
    prisma.sourceMedia.findMany({
      where: { sourceId: { in: sourceIds } },
      orderBy: linkOrder,
      select: { sourceId: true, media: { select: mediaSel } },
    }),
  ]);
  const out = new Map<string, SourceImage[]>();
  for (const s of sources) if (s.media) out.set(s.id, [{ ...toImage(s.media), isMain: true }]);
  for (const l of links) {
    const list = out.get(l.sourceId) ?? [];
    if (!list.some((x) => x.mediaId === l.media.id)) list.push({ ...toImage(l.media), isMain: false });
    out.set(l.sourceId, list);
  }
  return out;
}

/**
 * Die Regel für Quellenbilder als reine Funktion: Welche Bilder der Quelle
 * erscheinen bei welchem Beleg? `assigned` = Paare „Quelle|Bild“, bei denen
 * das Bild mindestens einem Beleg dieser Quelle zugeordnet ist (auch Belegen,
 * die der Benutzer nicht sieht). Bilder, die schon direkt am Beleg hängen
 * (`own`), erscheinen dort nicht ein zweites Mal.
 */
export function inheritedSourceImages(
  citations: { id: string; sourceId: string }[],
  sourceImages: Map<string, AttachedImage[]>,
  assigned: Set<string>,
  own: Map<string, AttachedImage[]> = new Map(),
): Map<string, AttachedImage[]> {
  const out = new Map<string, AttachedImage[]>();
  for (const c of citations) {
    const ownIds = new Set((own.get(c.id) ?? []).map((m) => m.mediaId));
    const list = (sourceImages.get(c.sourceId) ?? []).filter(
      (m) => !assigned.has(`${c.sourceId}|${m.mediaId}`) && !ownIds.has(m.mediaId),
    );
    if (list.length) out.set(c.id, list.map(({ mediaId, caption, width, height }) => ({ mediaId, caption, width, height })));
  }
  return out;
}

/**
 * Bilder für eine Liste sichtbarer Belege: eigene (`own`) und die nach der
 * Regel geerbten Bilder ihrer Quellen (`fromSource`).
 */
export async function imagesForCitations(
  citations: { id: string; sourceId: string }[],
): Promise<{ own: Map<string, AttachedImage[]>; fromSource: Map<string, AttachedImage[]> }> {
  if (citations.length === 0) return { own: new Map(), fromSource: new Map() };
  const sourceIds = [...new Set(citations.map((c) => c.sourceId))];
  const [own, sourceImages] = await Promise.all([imagesOfCitations(citations.map((c) => c.id)), imagesOfSources(sourceIds)]);
  const imageIds = [...new Set([...sourceImages.values()].flat().map((m) => m.mediaId))];
  const assignedRows = imageIds.length
    ? await prisma.citationMedia.findMany({
        where: { mediaId: { in: imageIds }, citation: { sourceId: { in: sourceIds } } },
        select: { mediaId: true, citation: { select: { sourceId: true } } },
      })
    : [];
  const assigned = new Set(assignedRows.map((r) => `${r.citation.sourceId}|${r.mediaId}`));
  return { own, fromSource: inheritedSourceImages(citations, sourceImages, assigned, own) };
}
