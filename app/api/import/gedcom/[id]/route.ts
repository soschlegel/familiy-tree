import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { getGedcomPlan, recomputeGedcomPreview, type TreeChoice } from "@/lib/services/gedcom-import";

export const runtime = "nodejs";
type Params = { id: string };

/** Zusammenfassung der Vorschau (ohne Einträge — die kommen seitenweise). */
export const GET = route<Params>("data:import", async (ctx, _req, { id }) => {
  return NextResponse.json(await getGedcomPlan(ctx.scope, id));
});

/** Vorschau mit anderer Wahl des Quell-Baums neu berechnen: { mode: "auto" | "new" | "existing", sourceTreeId? }. */
export const POST = route<Params>("data:import", async (ctx, req, { id }) => {
  const body = (await req.json()) as TreeChoice;
  return NextResponse.json(await recomputeGedcomPreview(ctx.scope, id, body));
});
