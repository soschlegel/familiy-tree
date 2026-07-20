import { NextResponse } from "next/server";
import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { getObjectBuffer } from "@/lib/storage";
import {
  EXCHANGE_VERSION,
  mediaFileName,
  type ExchangeFile,
} from "@/lib/exchange";

export const runtime = "nodejs";

async function buildExport(): Promise<{
  data: ExchangeFile;
  keyByFileName: Map<string, string>;
}> {
  const [persons, relationships, assets] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      include: { media: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.relationship.findMany({ include: { media: true } }),
    prisma.mediaAsset.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

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
      birthPlace: p.birthPlace,
      deathDate: iso(p.deathDate),
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
      endDate: iso(r.endDate),
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
  };

  return { data, keyByFileName };
}

/**
 * Export als JSON (?format=json) oder als ZIP mit den Bilddateien
 * (?format=zip). Nur wer Bilder sehen darf, darf auch exportieren — der
 * Export enthält denselben Bestand.
 */
export const GET = route("person:read", async (_ctx, req) => {
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const { data, keyByFileName } = await buildExport();
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
