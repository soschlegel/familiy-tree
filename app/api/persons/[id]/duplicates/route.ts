import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listDuplicatesOfPerson } from "@/lib/services";

type Params = { id: string };

/**
 * Mögliche Dubletten EINER Person für den Dialog „Zusammenführen …“ der
 * Personenseite: alle drei Klassen, je mit Begründungssatz. Wer die Person
 * oder einen Kandidaten nicht bearbeiten darf, bekommt eine leere Liste —
 * auch keine Anzahl (lib/services/duplicates.ts).
 */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await listDuplicatesOfPerson(ctx.scope, id, { limit: 20, includeUnclear: true }));
});
