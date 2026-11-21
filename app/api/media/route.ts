import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { addMedia, mediaErrorReason, type MediaTargets } from "@/lib/services";

export const runtime = "nodejs";

/** Formularfeld → Ziel. Genau eines davon (siehe unten). */
const TARGET_FIELDS = {
  personId: "personIds",
  relationshipId: "relationshipIds",
  eventId: "eventIds",
  citationId: "citationIds",
  sourceId: "sourceIds",
} as const satisfies Record<string, keyof MediaTargets>;

/**
 * Upload läuft bewusst durch den Server: sharp parst das Bild ohnehin (Thumbnail), und damit ist der
 * Dateityp echt validiert statt nur anhand des Content-Type-Headers geraten.
 * Bei diesem Volumen ist der Durchsatz kein Thema.
 *
 * Ziel: genau eines von personId, relationshipId, eventId, citationId,
 * sourceId. Rechte, Größe, Typ, Verknüpfung und Audit: addMedia
 * (lib/services/media-links.ts). Ohne Ziel nur für Administratoren.
 */
export const POST = route(null, async (ctx, req) => {
  const form = await req.formData();
  const file = form.get("file");
  const caption = form.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
  }

  const targets: MediaTargets = {};
  let given = 0;
  for (const [field, key] of Object.entries(TARGET_FIELDS)) {
    const raw = form.get(field);
    if (typeof raw === "string" && raw) {
      targets[key] = [raw];
      given++;
    }
  }
  // Genau eine Zuordnung: ein Upload hängt an einem Eintrag; weitere
  // Verknüpfungen gehen über /api/media/{id}/links mit eigener Prüfung.
  if (given > 1) {
    return NextResponse.json(
      { error: "Nur eines von personId, relationshipId, eventId, citationId oder sourceId angeben." },
      { status: 400 },
    );
  }

  try {
    const { media } = await addMedia(ctx.scope, {
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || null,
      caption: typeof caption === "string" ? caption : null,
      targets,
      via: "upload",
    });
    return NextResponse.json(media, { status: 201 });
  } catch (err) {
    const reason = mediaErrorReason(err);
    if (reason === "TOO_LARGE") return NextResponse.json({ error: (err as Error).message }, { status: 413 });
    if (reason === "FORMAT" || reason === "TYPE_MISMATCH") {
      return NextResponse.json({ error: (err as Error).message }, { status: 415 });
    }
    throw err;
  }
});
