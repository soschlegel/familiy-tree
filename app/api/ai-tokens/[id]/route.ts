import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { revokeApiToken } from "@/lib/services";

type Params = { id: string };

/**
 * Widerruft einen Schlüssel — eigene immer, fremde nur als Admin (sonst 404).
 * Der Datensatz bleibt zur Nachvollziehbarkeit erhalten (Status REVOKED).
 */
export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  const token = await revokeApiToken(ctx.scope, id);
  return NextResponse.json(token);
});
