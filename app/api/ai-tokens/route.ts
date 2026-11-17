import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { createApiToken, getAiAccessInfo, listAllApiTokens, listApiTokens } from "@/lib/services";

/**
 * KI-Zugangsschlüssel (MCP).
 *
 * GET                       eigene Schlüssel samt eigenem KI-Recht und Grenzen
 *                           → { info, tokens }
 * GET ?all=1[&userId=…]     nur Admins: Schlüssel aller (bzw. eines) Benutzer
 *                           → { tokens } (mit Besitzer)
 * POST { name, level, expiresInDays? }
 *                           neuer eigener Schlüssel → { token, secret } (201)
 *
 * Kein Ergebnis enthält den Hash; das Geheimnis steht nur in der Antwort auf
 * POST — deshalb dort ausdrücklich nicht zwischenspeichern.
 */
export const GET = route(null, async (ctx, req) => {
  const params = new URL(req.url).searchParams;
  if (params.get("all") === "1") {
    const userId = params.get("userId") || undefined;
    const tokens = await listAllApiTokens(ctx.scope, { userId });
    return NextResponse.json({ tokens });
  }
  const [info, tokens] = await Promise.all([getAiAccessInfo(ctx.scope), listApiTokens(ctx.scope)]);
  return NextResponse.json({ info, tokens });
});

export const POST = route(null, async (ctx, req) => {
  const created = await createApiToken(ctx.scope, await req.json());
  return NextResponse.json(created, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
});
