import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { deleteCitation, updateCitation } from "@/lib/services";

type Params = { id: string };

/** Angabe, Fundstelle und Verlässlichkeit ändern — Quelle und Bezug bleiben fest. */
export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  return NextResponse.json(await updateCitation(ctx.scope, id, await req.json()));
});

export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await deleteCitation(ctx.scope, id));
});
