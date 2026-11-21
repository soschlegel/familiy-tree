import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, route } from "@/lib/api";
import { linkMedia, unlinkMedia, type MediaTargets } from "@/lib/services";

type Params = { id: string };

const ids = z.array(z.string().min(1).max(64)).max(50).optional();
const one = z.string().min(1).max(64).optional();
const input = z.object({
  personId: one,
  relationshipId: one,
  eventId: one,
  citationId: one,
  sourceId: one,
  personIds: ids,
  relationshipIds: ids,
  eventIds: ids,
  citationIds: ids,
  sourceIds: ids,
});

function targetsOf(d: z.infer<typeof input>): MediaTargets {
  const both = (a: string | undefined, b: string[] | undefined) => [...(a ? [a] : []), ...(b ?? [])];
  return {
    personIds: both(d.personId, d.personIds),
    relationshipIds: both(d.relationshipId, d.relationshipIds),
    eventIds: both(d.eventId, d.eventIds),
    citationIds: both(d.citationId, d.citationIds),
    sourceIds: both(d.sourceId, d.sourceIds),
  };
}

/**
 * Vorhandenes Bild an weitere Einträge hängen (Person, Beziehung, Ereignis,
 * Beleg, Quelle). Das Bild muss sichtbar, jedes Ziel bearbeitbar sein
 * (lib/services/media-links.ts).
 */
export const POST = route<Params>(null, async (ctx, req, { id }) => {
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await linkMedia(ctx.scope, id, targetsOf(parsed.data)));
});

/**
 * Bild von Einträgen lösen (Ziele als Suchparameter, z.B. ?eventId=…). Hängt
 * es danach an nichts mehr, wird es gelöscht — die Oberfläche fragt vorher.
 */
export const DELETE = route<Params>(null, async (ctx, req, { id }) => {
  const sp = new URL(req.url).searchParams;
  const parsed = input.safeParse({
    personIds: sp.getAll("personId"),
    relationshipIds: sp.getAll("relationshipId"),
    eventIds: sp.getAll("eventId"),
    citationIds: sp.getAll("citationId"),
    sourceIds: sp.getAll("sourceId"),
  });
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await unlinkMedia(ctx.scope, id, targetsOf(parsed.data), { deleteOrphan: true }));
});
