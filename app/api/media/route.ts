import { NextResponse } from "next/server";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { route, forbidden } from "@/lib/api";
import { audit } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import {
  canUploadForPerson,
  canUploadForRelationship,
} from "@/lib/media-scope";

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
const ALLOWED = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);

export const runtime = "nodejs";

/**
 * Upload läuft bewusst durch den Server statt per presigned URL direkt zum
 * Objektspeicher: sharp parst das Bild ohnehin (Thumbnail), und damit ist der
 * Dateityp echt validiert statt nur anhand des Content-Type-Headers geraten.
 * Bei diesem Volumen ist der Durchsatz kein Thema.
 */
export const POST = route(null, async (ctx, req) => {
  const form = await req.formData();
  const file = form.get("file");
  const personId = form.get("personId");
  const relationshipId = form.get("relationshipId");
  const caption = form.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
  }

  // Vor dem Verarbeiten prüfen: ein Bild muss an etwas hängen, das der
  // Benutzer bearbeiten darf. Ohne Zuordnung dürfen nur Admins hochladen,
  // sonst entstünden Bilder außerhalb jeder Rechteprüfung.
  const target =
    typeof personId === "string" && personId
      ? { kind: "person" as const, id: personId }
      : typeof relationshipId === "string" && relationshipId
        ? { kind: "relationship" as const, id: relationshipId }
        : null;

  if (!target) {
    if (!ctx.scope.isAdmin) return forbidden("Bilder ohne Zuordnung");
  } else {
    const allowed =
      target.kind === "person"
        ? await canUploadForPerson(ctx.scope, target.id)
        : await canUploadForRelationship(ctx.scope, target.id);
    if (!allowed) return forbidden("hier Bilder hochzuladen");
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Datei zu groß (max. ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }

  const input = Buffer.from(await file.arrayBuffer());

  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return NextResponse.json(
      { error: "Datei ist kein lesbares Bild" },
      { status: 415 },
    );
  }

  if (!meta.format || !ALLOWED.has(meta.format)) {
    return NextResponse.json(
      { error: `Bildformat nicht erlaubt: ${meta.format ?? "unbekannt"}` },
      { status: 415 },
    );
  }

  const id = randomUUID();
  const originalKey = `originals/${id}.webp`;
  const thumbnailKey = `thumbs/${id}.webp`;

  // .rotate() wendet die EXIF-Orientierung an, bevor die Metadaten wegfallen —
  // sonst liegen Handyfotos später auf der Seite. Das Entfernen der übrigen
  // EXIF-Daten (u.a. GPS) ist beabsichtigt.
  const pipeline = sharp(input).rotate();

  const [original, thumbnail] = await Promise.all([
    pipeline.clone().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true }),
    pipeline.clone().resize(320, 320, { fit: "cover" }).webp({ quality: 75 }).toBuffer(),
  ]);

  await Promise.all([
    putObject(originalKey, original.data, "image/webp"),
    putObject(thumbnailKey, thumbnail, "image/webp"),
  ]);

  const asset = await prisma.mediaAsset.create({
    data: {
      storageKey: originalKey,
      thumbnailKey,
      fileName: file.name || null,
      mimeType: "image/webp",
      sizeBytes: original.data.byteLength,
      width: original.info.width,
      height: original.info.height,
      caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
      uploadedById: ctx.userId,
    },
  });

  if (typeof personId === "string" && personId) {
    const hasPrimary = await prisma.personMedia.count({
      where: { personId, isPrimary: true },
    });
    await prisma.personMedia.create({
      data: {
        personId,
        mediaId: asset.id,
        // Das erste Bild einer Person wird automatisch zum Primärbild.
        isPrimary: hasPrimary === 0,
      },
    });
  }

  if (typeof relationshipId === "string" && relationshipId) {
    const hasPrimary = await prisma.relationshipMedia.count({
      where: { relationshipId, isPrimary: true },
    });
    await prisma.relationshipMedia.create({
      data: {
        relationshipId,
        mediaId: asset.id,
        isPrimary: hasPrimary === 0,
      },
    });
  }

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "MediaAsset",
    entityId: asset.id,
    diff: { personId, relationshipId, sizeBytes: asset.sizeBytes },
  });

  return NextResponse.json(asset, { status: 201 });
});
