import { NextResponse } from "next/server";
import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { getObjectBuffer } from "@/lib/storage";
import { personVisibilityFilter, type Scope } from "@/lib/scope";
import { canViewMedia } from "@/lib/media-scope";
import {
  EXCHANGE_VERSION,
  mediaFileName,
  type ExchangeFile,
} from "@/lib/exchange";

export const runtime = "nodejs";

/**
 * Baut den Export — beschränkt auf die für diesen Benutzer sichtbaren
 * Personen. Ohne diese Einschränkung wäre der Export ein Weg, das gesamte
 * Rechtekonzept mit einem Klick zu umgehen.
 */
async function buildExport(scope: Scope): Promise<{
  data: ExchangeFile;
  keyByFileName: Map<string, string>;
}> {
  const persons = await prisma.person.findMany({
    where: personVisibilityFilter(scope),
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
  const citations = await prisma.citation.findMany({
    where: {
      OR: [{ personId: { in: [...personIds] } }, { relationshipId: { in: [...relationshipIds] } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const sources = await prisma.source.findMany({
    where: scope.isAdmin
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

  const iso = (d: Date | null) => d?.toISOString() ?? null;

  const data: ExchangeFile = {
    version: EXCHANGE_VERSION,
    exportedAt: new Date().toISOString(),
    persons: persons.map((p) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      gender: p.gender,
      birthDate: iso(p.birthDate),
      birthDatePrecision: p.birthDatePrecision,
      birthDateQualifier: p.birthDateQualifier,
      birthPlace: p.birthPlace,
      deathDate: iso(p.deathDate),
      deathDatePrecision: p.deathDatePrecision,
      deathDateQualifier: p.deathDateQualifier,
      deathPlace: p.deathPlace,
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
      startDate: iso(r.startDate),
      startDatePrecision: r.startDatePrecision,
      startDateQualifier: r.startDateQualifier,
      endDate: iso(r.endDate),
      endDatePrecision: r.endDatePrecision,
      endDateQualifier: r.endDateQualifier,
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
      author: s.author,
      repository: s.repository,
      callNumber: s.callNumber,
      url: s.url,
      date: iso(s.date),
      datePrecision: s.datePrecision,
      dateQualifier: s.dateQualifier,
      notes: s.notes,
      mediaId: sourceMedia.get(s.id) ?? null,
    })),
    citations: citations.map((c) => ({
      id: c.id,
      sourceId: c.sourceId,
      personId: c.personId,
      relationshipId: c.relationshipId,
      fact: c.fact,
      detail: c.detail,
      confidence: c.confidence,
    })),
  };

  return { data, keyByFileName };
}

/**
 * Export als JSON (?format=json) oder als ZIP mit den Bilddateien
 * (?format=zip). Nur wer Bilder sehen darf, darf auch exportieren — der
 * Export enthält denselben Bestand.
 */
export const GET = route(null, async (ctx, req) => {
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const { data, keyByFileName } = await buildExport(ctx.scope);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="stammbaum_${stamp}.json"`,
      },
    });
  }

  if (format !== "zip") {
    return NextResponse.json(
      { error: "format muss json oder zip sein" },
      { status: 400 },
    );
  }

  const zip = new JSZip();
  zip.file("stammbaum.json", JSON.stringify(data, null, 2));

  const folder = zip.folder("media")!;
  let missing = 0;

  for (const [fileName, storageKey] of keyByFileName) {
    try {
      const content = await getObjectBuffer(storageKey);
      if (!content) {
        missing++;
        continue;
      }
      folder.file(fileName, content);
    } catch (err) {
      // Ein einzelnes fehlendes Bild darf den gesamten Export nicht kippen.
      console.error("[export] Bild übersprungen:", storageKey, err);
      missing++;
    }
  }

  if (missing > 0) {
    zip.file(
      "HINWEIS.txt",
      `${missing} Bilddatei(en) konnten nicht gelesen werden und fehlen in diesem Archiv.\n` +
        `Die zugehörigen Einträge stehen weiterhin in stammbaum.json.\n`,
    );
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    // Bilder sind bereits WebP-komprimiert — hohe Stufen kosten viel Zeit
    // und bringen fast nichts.
    compressionOptions: { level: 1 },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="stammbaum_${stamp}.zip"`,
    },
  });
});
