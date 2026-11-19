import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import { deleteEvent, getEvent, updateEvent } from "@/lib/services";

type Params = { id: string };

/** Ein Ereignis — 404, wenn es fehlt oder sein Träger unsichtbar ist. */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const event = await getEvent(ctx.scope, id);
  if (!event) return notFound();
  return NextResponse.json(event);
});

/** Teil-Update; der Träger (Person bzw. Beziehung) bleibt fest. */
export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  return NextResponse.json(await updateEvent(ctx.scope, id, await req.json()));
});

/** Löscht das Ereignis samt seiner Belege. */
export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await deleteEvent(ctx.scope, id));
});
