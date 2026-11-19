import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import { createEvent, listRelationshipEvents } from "@/lib/services";

type Params = { id: string };

/** Ereignisse einer Beziehung (Verlobung, Aufgebot, abweichende Heiratsangabe …). */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const events = await listRelationshipEvents(ctx.scope, id);
  if (!events) return notFound();
  return NextResponse.json(events);
});

/** Neues Ereignis an dieser Beziehung; Felder wie bei /api/persons/{id}/events. */
export const POST = route<Params>(null, async (ctx, req, { id }) => {
  const body = (await req.json()) as Record<string, unknown>;
  const event = await createEvent(ctx.scope, { ...body, relationshipId: id, personId: null });
  return NextResponse.json(event, { status: 201 });
});
