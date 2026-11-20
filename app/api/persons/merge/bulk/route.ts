import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { bulkMerge, previewBulkMerge } from "@/lib/services";

/**
 * Mehrere „sichere“ Dubletten: { pairs: [{a, b}], dryRun? }. Mit dryRun die
 * gemeinsame Vorschau, sonst Ausführen (Paar für Paar, Eltern zuerst).
 */
export const POST = route(null, async (ctx, req) => {
  const body = (await req.json()) as { pairs?: unknown; dryRun?: boolean };
  const input = { pairs: body.pairs };
  return NextResponse.json(body.dryRun ? await previewBulkMerge(ctx.scope, input) : await bulkMerge(ctx.scope, input));
});
