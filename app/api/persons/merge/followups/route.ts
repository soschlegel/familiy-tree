import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listFollowUpDuplicates } from "@/lib/services";

/**
 * Folgedubletten nach einem Zusammenführen: `?ids=<bleibende Person>[,…]` →
 * Eltern, Partner und Kinder dieser Personen, die selbst doppelt aussehen
 * (Klasse, Begründungssatz). Liest nur; zusammengeführt wird über
 * /api/persons/merge bzw. /api/persons/merge/bulk.
 */
export const GET = route(null, async (ctx, req) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  return NextResponse.json(await listFollowUpDuplicates(ctx.scope, ids));
});
