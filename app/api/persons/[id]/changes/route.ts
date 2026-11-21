import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listPersonChanges } from "@/lib/services";

type Params = { id: string };

/**
 * Änderungsverlauf einer Person, neueste zuerst: ?cursor=<Eintrag>&limit=20.
 * Nur für Bearbeiter der Person (lib/services/changes.ts).
 */
export const GET = route<Params>(null, async (ctx, req, { id }) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
  return NextResponse.json(
    await listPersonChanges(ctx.scope, id, { cursor: url.searchParams.get("cursor"), limit }),
  );
});
