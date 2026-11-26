import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { importJobState, startImportJob } from "@/lib/services/import-jobs";

export const runtime = "nodejs";
type Params = { id: string };

/**
 * Import ausführen (läuft im Hintergrund; Stand per GET). Body: die
 * Entscheidungen aus der Vorschau (siehe applyDecisionsSchema). Doppeltes
 * Absenden startet keinen zweiten Lauf. Gewählte Verknüpfungen werden vorab
 * nachgeprüft — Abweichung → 409 mit `linkIssues`, nichts importiert.
 */
export const POST = route<Params>("data:import", async (ctx, req, { id }) => {
  const decisions = await req.json().catch(() => ({}));
  return NextResponse.json(await startImportJob(ctx.scope, id, decisions), { status: 202 });
});

export const GET = route<Params>("data:import", async (ctx, _req, { id }) => {
  return NextResponse.json(await importJobState(ctx.scope, id));
});
