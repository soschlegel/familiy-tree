import { NextResponse } from "next/server";

import { notFound, route } from "@/lib/api";
import { deleteSource, getSource, updateSource } from "@/lib/services";

type Params = { id: string };

/**
 * Quelle mit allen sichtbaren Belegen. Unsichtbare Quellen beantwortet die
 * API mit 404 — wie bei Personen.
 */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const detail = await getSource(ctx.scope, id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
});

export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  return NextResponse.json(await updateSource(ctx.scope, id, await req.json()));
});

/** Löscht die Quelle samt aller Belege. */
export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await deleteSource(ctx.scope, id));
});
