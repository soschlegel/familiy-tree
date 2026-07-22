import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getObjectStream, deleteObject } from "@/lib/storage";
import { canViewMedia, canDeleteMedia } from "@/lib/media-scope";

type Params = { id: string };

export const runtime = "nodejs";

/**
 * Bilder werden durch die App ausgeliefert, nicht per öffentlicher Bucket-URL.
 * Dadurch gilt die Anmeldepflicht auch für Fotos — bei einem privaten
 * Familienarchiv ist das der Punkt.
 */
export const GET = route<Params>(null, async (ctx, req, { id }) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return notFound();

  // 404 statt 403: die Existenz eines Bildes ist selbst schon eine Auskunft.
  if (!(await canViewMedia(ctx.scope, id))) return notFound();

  const wantsThumb =
    new URL(req.url).searchParams.get("variant") === "thumb";
  const key = wantsThumb ? (asset.thumbnailKey ?? asset.storageKey) : asset.storageKey;

  const body = await getObjectStream(key);
  if (!body) {
    return NextResponse.json({ error: "Datei fehlt im Speicher" }, { status: 404 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": asset.mimeType,
      // private: Zwischenspeicher nur im Browser des angemeldeten Nutzers.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

export const DELETE = route<Params>(
  null,
  async (ctx, _req, { id }) => {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return notFound();
    if (!(await canDeleteMedia(ctx.scope, id))) return notFound();

    await prisma.mediaAsset.delete({ where: { id } });

    // Objektspeicher nach der DB aufräumen: schlägt das fehl, bleibt eine
    // verwaiste Datei zurück — das ist harmloser als ein DB-Eintrag ohne Bild.
    await Promise.all(
      [asset.storageKey, asset.thumbnailKey]
        .filter((k): k is string => Boolean(k))
        .map((k) => deleteObject(k).catch((e) => console.error("[media]", e))),
    );

    await audit({
      userId: ctx.userId,
      action: "DELETE",
      entityType: "MediaAsset",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  },
);
