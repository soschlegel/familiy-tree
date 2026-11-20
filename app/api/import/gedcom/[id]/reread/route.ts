import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { rereadGedcomBatch } from "@/lib/services/gedcom-import";

export const runtime = "nodejs";

/**
 * Ausgeführten GEDCOM-Import aus der aufbewahrten Originaldatei erneut
 * einlesen: neuer Lauf mit Vorschau (schreibt keine Stammbaumdaten). Nur Admins.
 */
export const POST = route<{ id: string }>("data:import", async (ctx, _req, { id }) => {
  return NextResponse.json(await rereadGedcomBatch(ctx.scope, id));
});
