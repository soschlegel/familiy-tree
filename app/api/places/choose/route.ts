import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { choosePlaceForEntry } from "@/lib/services/places";

/**
 * Auswahl im Ortsfeld (Person, Ereignis, Beziehung): ordnet genau den
 * Freitext dieses Eintrags dem gewählten Ort zu („von Hand“).
 * { text, personId | eventId | relationshipId, gazetteerId | latitude+longitude+label(+precision) }.
 * Für jeden, der den Eintrag bearbeiten darf; Prüfung im Dienst.
 */
export const POST = route(null, async (ctx, req) => {
  return NextResponse.json({ assignment: await choosePlaceForEntry(ctx.scope, await req.json()) });
});
