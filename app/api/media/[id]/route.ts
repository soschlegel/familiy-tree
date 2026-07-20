import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getObjectStream, deleteObject } from "@/lib/storage";

type Params = { id: string };

export const runtime = "nodejs";

/**
 * Bilder werden durch die App ausgeliefert, nicht per öffentlicher Bucket-URL.
 * Dadurch gilt die Anmeldepflicht auch für Fotos — bei einem privaten
 * Familienarchiv ist das der Punkt.
 */
export const GET = route<Params>("media:read", async (_ctx, req, { id }) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

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
  "media:delete",
  async (ctx, _req, { id }) => {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    }

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
