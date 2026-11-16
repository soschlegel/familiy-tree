import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { createRelationship } from "@/lib/services";

/**
 * Legt eine Beziehung an. Alle Regeln (Art passend zum Typ, plausible Daten,
 * keine Zyklen, höchstens zwei leibliche Eltern, Rechte) prüft
 * createRelationship in lib/services/relationships.ts.
 */
export const POST = route(null, async (ctx, req) => {
  const relationship = await createRelationship(ctx.scope, await req.json());
  return NextResponse.json(relationship, { status: 201 });
});
