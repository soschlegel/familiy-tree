import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { deleteRelationship, updateRelationship } from "@/lib/services";

type Params = { id: string };

/**
 * Korrigiert Art, Zeitraum und Notiz. Die verknüpften Personen bleiben fest —
 * eine falsche Zuordnung wird gelöscht und neu angelegt, nicht umgebogen.
 */
export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  const relationship = await updateRelationship(ctx.scope, id, await req.json());
  return NextResponse.json(relationship);
});

export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await deleteRelationship(ctx.scope, id));
});
