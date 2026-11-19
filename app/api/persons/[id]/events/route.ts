import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import { createEvent, listPersonEvents } from "@/lib/services";

type Params = { id: string };

/** Lebensereignisse einer Person (ohne die ihrer Beziehungen), chronologisch. */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const events = await listPersonEvents(ctx.scope, id);
  if (!events) return notFound();
  return NextResponse.json(events);
});

/**
 * Neues Ereignis an dieser Person: { type, label?, isAlternative?, date?,
 * datePhrase?, place?, value?, cause?, age?, agency?, address?, notes? }.
 * Regeln (Art je Träger, Hauptangaben nur als Alternative): lib/events.ts.
 */
export const POST = route<Params>(null, async (ctx, req, { id }) => {
  const body = (await req.json()) as Record<string, unknown>;
  const event = await createEvent(ctx.scope, { ...body, personId: id, relationshipId: null });
  return NextResponse.json(event, { status: 201 });
});
