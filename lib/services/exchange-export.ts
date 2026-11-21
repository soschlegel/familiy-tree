import { prisma } from "../prisma";
import { personVisibilityFilter, type Scope } from "../scope";
import { canViewMedia } from "../media-scope";
import { EXCHANGE_VERSION, exportDateFields, mediaFileName, type ExchangeFile } from "../exchange";
import type { ExportSelection } from "../export-selection";
import { selectionPersonFilter } from "./export-selection";

/**
 * Baut den Export — beschränkt auf die für diesen Benutzer sichtbaren
 * Personen. Ohne diese Einschränkung wäre der Export ein Weg, das gesamte
 * Rechtekonzept mit einem Klick zu umgehen.
 *
 * Mit `selection` (Familienauswahl des GEDCOM-Exports) zusätzlich nur die
 * Personen der gewählten Familien; alles Weitere folgt daraus wie gehabt
 * (Beziehungen nur zwischen exportierten Personen, Ereignisse, Namen, Belege,
 * Rohdaten, Bilder nur an Exportiertem). Quellen dann nur die zitierten —
 * unbelegte Quellen gehören zu keiner Familie.
 */
export async function buildExport(scope: Scope, selection: ExportSelection | null = null): Promise<{
  data: ExchangeFile;
  keyByFileName: Map<string, string>;
}> {
  const persons = await prisma.person.findMany({
    where: selection ? { AND: [personVisibilityFilter(scope), selectionPersonFilter(selection)] } : personVisibilityFilter(scope),
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    include: { media: { orderBy: { sortOrder: "asc" } } },
  });

  const personIds = new Set(persons.map((p) => p.id));

  // Nur Beziehungen, deren BEIDE Seiten sichtbar sind — eine halbe Beziehung
  // verweist beim Empfänger ins Leere und verrät die Existenz der anderen.
  const relationships = (
    await prisma.relationship.findMany({ include: { media: true } })
  ).filter(
    (r) => personIds.has(r.fromPersonId) && personIds.has(r.toPersonId),
  );

  const referenced = new Set([
    ...persons.flatMap((p) => p.media.map((m) => m.mediaId)),
    ...relationships.flatMap((r) => r.media.map((m) => m.mediaId)),
  ]);

  // Belege nur an exportierten Personen bzw. Beziehungen — dieselbe Grenze
  // wie oben. Quellen: die zitierten, dazu (Admin) alle bzw. (sonst) die
  // eigenen noch unbelegten.
  const relationshipIds = new Set(relationships.map((r) => r.id));
  // Ereignisse, weitere Namen, Fremdkennungen und Rohdaten: dieselbe Grenze —
  // nur an exportierten Personen bzw. Beziehungen (bzw. Quellen, s.u.).
  const events = await prisma.event.findMany({
    where: { OR: [{ personId: { in: [...personIds] } }, { relationshipId: { in: [...relationshipIds] } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const eventIds = new Set(events.map((e) => e.id));
  const personNames = await prisma.personName.findMany({
    where: { personId: { in: [...personIds] } },
    orderBy: [{ personId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  const citations = await prisma.citation.findMany({
    where: {
      OR: [{ personId: { in: [...personIds] } }, { relationshipId: { in: [...relationshipIds] } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const sources = await prisma.source.findMany({
    where: selection
      ? { id: { in: [...new Set(citations.map((c) => c.sourceId))] } }
      : scope.isAdmin
      ? {}
      : {
          OR: [
            { id: { in: [...new Set(citations.map((c) => c.sourceId))] } },
            { createdById: scope.userId, citations: { none: {} } },
          ],
        },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  // Scans gehören mit ins Archiv, sofern der Benutzer sie sehen darf.
  const sourceIds = new Set(sources.map((s) => s.id));
  const externalIds = (
    await prisma.externalId.findMany({
      where: {
        OR: [
          { personId: { in: [...personIds] } },
          { relationshipId: { in: [...relationshipIds] } },
          { eventId: { in: [...eventIds] } },
          { sourceId: { in: [...sourceIds] } },
          { mediaId: { in: [...referenced] } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  );
  // Rohdaten (nicht zugeordnete Importdaten) gehören zu ihrem Träger und
  // reisen mit ihm — sonst ginge bei einem Umzug über den Export verloren,
  // was der Import ausdrücklich aufbewahrt hat. Rohdaten ohne Träger bleiben
  // in der Instanz (sie gehören zu einem Importlauf).
  const rawRecords = await prisma.importRawRecord.findMany({
    where: {
      OR: [
        { personId: { in: [...personIds] } },
        { relationshipId: { in: [...relationshipIds] } },
        { sourceId: { in: [...sourceIds] } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const sourceMedia = new Map<string, string | null>();
  for (const s of sources) {
    if (!s.mediaId) continue;
    const ok = referenced.has(s.mediaId) || scope.isAdmin || (await canViewMedia(scope, s.mediaId));
    sourceMedia.set(s.id, ok ? s.mediaId : null);
    if (ok) referenced.add(s.mediaId);
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: [...referenced] } },
    orderBy: { createdAt: "asc" },
  });

  const taken = new Set<string>();
  const nameById = new Map<string, string>();
  const keyByFileName = new Map<string, string>();

  for (const asset of assets) {
    const name = mediaFileName(asset, taken);
    nameById.set(asset.id, name);
    keyByFileName.set(name, asset.storageKey);
  }

  // Medien-Fremdkennungen nur für Bilder, die mit exportiert werden.
  const exportedMedia = new Set(assets.map((a) => a.id));

  const data = {
    version: EXCHANGE_VERSION,
    exportedAt: new Date().toISOString(),
    persons: persons.map((p) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      nickname: p.nickname,
      namePrefix: p.namePrefix,
      nameSuffix: p.nameSuffix,
      gender: p.gender,
      ...exportDateFields("birthDate", p),
      birthPlace: p.birthPlace,
      ...exportDateFields("deathDate", p),
      deathPlace: p.deathPlace,
      deathCause: p.deathCause,
      notes: p.notes,
      media: p.media.map((m) => ({
        mediaId: m.mediaId,
        isPrimary: m.isPrimary,
      })),
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
      ...exportDateFields("startDate", r),
      startPlace: r.startPlace,
      ...exportDateFields("endDate", r),
      endPlace: r.endPlace,
      notes: r.notes,
      media: r.media.map((m) => ({
        mediaId: m.mediaId,
        isPrimary: m.isPrimary,
      })),
    })),
    media: assets.map((a) => ({
      id: a.id,
      fileName: nameById.get(a.id)!,
      caption: a.caption,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
    })),
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      kindLabel: s.kindLabel,
      provider: s.provider,
      author: s.author,
      repository: s.repository,
      callNumber: s.callNumber,
      url: s.url,
      ...exportDateFields("date", s),
      notes: s.notes,
      mediaId: sourceMedia.get(s.id) ?? null,
    })),
    citations: citations.map((c) => ({
      id: c.id,
      sourceId: c.sourceId,
      personId: c.personId,
      relationshipId: c.relationshipId,
      eventId: c.eventId,
      fact: c.fact,
      detail: c.detail,
      url: c.url,
      confidence: c.confidence,
      text: c.text,
    })),
    events: events.map((e) => ({
      id: e.id,
      personId: e.personId,
      relationshipId: e.relationshipId,
      type: e.type,
      label: e.label,
      isAlternative: e.isAlternative,
      ...exportDateFields("date", e),
      place: e.place,
      address: e.address,
      value: e.value,
      cause: e.cause,
      age: e.age,
      agency: e.agency,
      notes: e.notes,
      sortOrder: e.sortOrder,
    })),
    personNames: personNames.map((n) => ({
      id: n.id,
      personId: n.personId,
      type: n.type,
      givenName: n.givenName,
      familyName: n.familyName,
      prefix: n.prefix,
      suffix: n.suffix,
      nickname: n.nickname,
      label: n.label,
      notes: n.notes,
      sortOrder: n.sortOrder,
    })),
    externalIds: externalIds
      .filter((x) => !x.mediaId || exportedMedia.has(x.mediaId))
      .map((x) => ({
        id: x.id,
        system: x.system,
        value: x.value,
        personId: x.personId,
        relationshipId: x.relationshipId,
        eventId: x.eventId,
        sourceId: x.sourceId,
        mediaId: x.mediaId,
      })),
    rawRecords: rawRecords.map((r) => ({
      id: r.id,
      personId: r.personId,
      relationshipId: r.relationshipId,
      sourceId: r.sourceId,
      recordType: r.recordType,
      xref: r.xref,
      content: r.content,
      reason: r.reason,
      superseded: r.supersededAt !== null,
    })),
  } as ExchangeFile;

  return { data, keyByFileName };
}

