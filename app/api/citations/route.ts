import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { createCitation } from "@/lib/services";

/**
 * Beleg anlegen: { sourceId, personId | relationshipId, fact, detail?,
 * confidence? }. Regeln und Rechte: createCitation in lib/services/sources.ts.
 */
export const POST = route(null, async (ctx, req) => {
  const citation = await createCitation(ctx.scope, await req.json());
  return NextResponse.json(citation, { status: 201 });
});
