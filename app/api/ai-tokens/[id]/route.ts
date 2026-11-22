import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { deleteApiToken, revokeApiToken } from "@/lib/services";

type Params = { id: string };

/**
 * Schlüssel widerrufen oder endgültig löschen — eigene immer, fremde nur als
 * Admin (sonst 404).
 *
 * DELETE                 widerruft; der Datensatz bleibt (Status REVOKED).
 * DELETE ?endgueltig=1   löscht endgültig — nur widerrufene, abgelaufene
 *                        oder noch nie benutzte Schlüssel, sonst 409
 *                        (aktiv und schon benutzt: erst widerrufen).
 *                        Protokoll und Änderungsgeschichte bleiben erhalten.
 */
export const DELETE = route<Params>(null, async (ctx, req, { id }) => {
  if (new URL(req.url).searchParams.get("endgueltig") === "1") {
    const token = await deleteApiToken(ctx.scope, id);
    return NextResponse.json({ ...token, deleted: true });
  }
  const token = await revokeApiToken(ctx.scope, id);
  return NextResponse.json(token);
});
