import { NextResponse } from "next/server";

import { route, badRequest } from "@/lib/api";
import { decideConnectPairs, getConnectRun, startConnectApply, startConnectPreview } from "@/lib/services/import-linking";

export const runtime = "nodejs";
type Params = { id: string };

/** Stand eines Laufs samt Paaren seitenweise (?confidence, ?bridges=1, ?sehrWahrscheinlich=1, ?offset, ?limit). */
export const GET = route<Params>("data:import", async (ctx, req, { id }) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(
    await getConnectRun(ctx.scope, id, {
      confidence: q.get("confidence") ?? undefined,
      bridgesOnly: q.get("bridges") === "1",
      veryLikely: q.get("sehrWahrscheinlich") === "1",
      offset: Number(q.get("offset") ?? 0) || 0,
      limit: Number(q.get("limit") ?? 50) || 50,
    }),
  );
});

/**
 * { action: "decide", accept, reject, dismiss } | { action: "preview" } |
 * { action: "apply" } (auch: nach Unterbrechung fortsetzen).
 */
export const POST = route<Params>("data:import", async (ctx, req, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "decide") return NextResponse.json(await decideConnectPairs(ctx.scope, id, body));
  if (body.action === "preview") return NextResponse.json(await startConnectPreview(ctx.scope, id), { status: 202 });
  if (body.action === "apply") return NextResponse.json(await startConnectApply(ctx.scope, id), { status: 202 });
  return badRequest([{ path: ["action"], message: "Unbekannte Aktion" }]);
});
