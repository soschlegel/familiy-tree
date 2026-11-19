import { NextResponse } from "next/server";
import { z } from "zod";

import { route } from "@/lib/api";
import { parseOrThrow, pruneRawRecords } from "@/lib/services";

export const runtime = "nodejs";

const body = z.object({ batchId: z.string().min(1).optional() });

/** Überholte Rohdaten entfernen (eines Laufs oder alle überholten). Nur Admins. */
export const POST = route("data:import", async (ctx, req) => {
  const { batchId } = parseOrThrow(body.safeParse(await req.json().catch(() => ({}))));
  return NextResponse.json(await pruneRawRecords(ctx.scope, { batchId, supersededOnly: true }));
});
