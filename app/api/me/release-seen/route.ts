import { NextResponse } from "next/server";
import { z } from "zod";

import { route, badRequest } from "@/lib/api";
import { markReleaseSeen } from "@/lib/services";
import { releaseNotes } from "@/lib/release-notes-data";

// Nur die Kennung; weitere Felder (etwa eine Benutzerkennung) lehnt `strict`
// ab — gespeichert wird immer für den angemeldeten Benutzer.
const input = z.object({ releaseId: z.string().min(1).max(32) }).strict();

/**
 * Neuigkeiten: „Gelesen“ — merkt das zuletzt gesehene Release des
 * angemeldeten Benutzers (Fenster „Was ist neu?“, docs/entwicklung/neuigkeiten.md).
 * Nur bekannte Kennungen aus CHANGELOG.md, sonst 400.
 */
export const PUT = route(null, async (ctx, req) => {
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await markReleaseSeen(ctx.scope, parsed.data.releaseId, releaseNotes()));
});
