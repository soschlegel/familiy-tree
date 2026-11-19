import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, notFound, forbidden } from "@/lib/api";
import { audit } from "@/lib/audit";
import { openObject, deleteObject } from "@/lib/storage";
import { canViewMedia, canDeleteMedia } from "@/lib/media-scope";

type Params = { id: string };

export const runtime = "nodejs";

/**
 * Bilder werden durch die App ausgeliefert, nie direkt aus dem Medienordner.
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

  // Fehlt die Datei (z.B. nach einem unvollständigen Restore), ist das ein
  // 404 — kein Serverfehler mit Stacktrace.
  const file = await openObject(key);
  if (!file) {
    console.warn("[media] Datei fehlt im Medienordner:", key);
    return NextResponse.json({ error: "Datei fehlt im Speicher" }, { status: 404 });
  }

  const headers = {
    ETag: file.etag,
    // private: Zwischenspeicher nur im Browser des angemeldeten Nutzers.
    "Cache-Control": "private, max-age=31536000, immutable",
  };

  // Bedingte Anfrage: hat der Browser die Datei schon, reicht ein 304.
  if (etagMatches(req.headers.get("if-none-match"), file.etag)) {
    await file.close();
    return new Response(null, { status: 304, headers });
  }

  return new Response(file.stream(), {
    headers: {
      ...headers,
      "Content-Type": asset.mimeType,
      "Content-Length": String(file.size),
    },
  });
});

/** If-None-Match mit schwachem Vergleich (RFC 9110, 13.1.2). */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const strip = (t: string) => t.trim().replace(/^W\//, "");
  const wanted = strip(etag);
  return header.split(",").some((t) => strip(t) === wanted);
}

export const DELETE = route<Params>(
  null,
  async (ctx, _req, { id }) => {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return notFound();
    if (!(await canViewMedia(ctx.scope, id))) return notFound();
    if (!(await canDeleteMedia(ctx.scope, id))) {
      return forbidden("dieses Bild zu löschen");
    }

    await prisma.mediaAsset.delete({ where: { id } });

    // Dateien nach der DB aufräumen: schlägt das fehl, bleibt eine
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
