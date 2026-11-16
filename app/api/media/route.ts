import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, forbidden, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ImageFormatError, processAndStoreImage } from "@/lib/media-processing";
import {
  canUploadForPerson,
  canUploadForRelationship,
} from "@/lib/media-scope";

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);

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
  const rawPersonId = form.get("personId");
  const rawRelationshipId = form.get("relationshipId");
  const caption = form.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
  }

  const personId =
    typeof rawPersonId === "string" && rawPersonId ? rawPersonId : null;
  const relationshipId =
    typeof rawRelationshipId === "string" && rawRelationshipId
      ? rawRelationshipId
      : null;

  // Genau eine Zuordnung: sonst würde nur die eine geprüft, das Bild aber an
  // beide gehängt — ein Weg, Bilder an fremde Beziehungen zu heften.
  if (personId && relationshipId) {
    return NextResponse.json(
      { error: "Nur eines von personId oder relationshipId angeben." },
      { status: 400 },
    );
  }

  // Vor dem Verarbeiten prüfen: ein Bild muss an etwas hängen, das der
  // Benutzer bearbeiten darf. Ohne Zuordnung dürfen nur Admins hochladen,
  // sonst entstünden Bilder außerhalb jeder Rechteprüfung.
  if (personId) {
    const exists = await prisma.person.count({ where: { id: personId } });
    if (!exists) return notFound();
    if (!(await canUploadForPerson(ctx.scope, personId))) {
      return forbidden("hier Bilder hochzuladen");
    }
  } else if (relationshipId) {
    const exists = await prisma.relationship.count({ where: { id: relationshipId } });
    if (!exists) return notFound();
    if (!(await canUploadForRelationship(ctx.scope, relationshipId))) {
      return forbidden("hier Bilder hochzuladen");
    }
  } else if (!ctx.scope.isAdmin) {
    return forbidden("Bilder ohne Zuordnung");
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Datei zu groß (max. ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }

  let stored;
  try {
    stored = await processAndStoreImage(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImageFormatError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    throw err;
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      ...stored,
      fileName: file.name || null,
      caption:
        typeof caption === "string" && caption.trim()
          ? caption.trim().slice(0, 500)
          : null,
      uploadedById: ctx.userId,
    },
  });

  if (personId) {
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

  if (relationshipId) {
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
