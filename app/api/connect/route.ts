import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listConnectGroups, listConnectRuns, startConnectRun } from "@/lib/services/import-linking";

export const runtime = "nodejs";

/** Importe verbinden: Auswahl (Importe) und letzte Läufe. Nur Admins. */
export const GET = route("data:import", async (ctx) => {
  return NextResponse.json({ groups: await listConnectGroups(ctx.scope), runs: await listConnectRuns(ctx.scope) });
});

/** Abgleich starten: { groups?: string[], withinGroup?: boolean } — läuft im Hintergrund. */
export const POST = route("data:import", async (ctx, req) => {
  return NextResponse.json(await startConnectRun(ctx.scope, await req.json().catch(() => ({}))), { status: 202 });
});
