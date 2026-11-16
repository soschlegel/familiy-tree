import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { loadTree } from "@/lib/services";

/**
 * Liefert den kompletten Graphen — sichtbare Personen mit Angaben, alle
 * übrigen als anonymer Platzhalter (siehe loadTree in lib/services/tree.ts).
 */
export const GET = route(null, async (ctx) => {
  return NextResponse.json(await loadTree(ctx.scope));
});
