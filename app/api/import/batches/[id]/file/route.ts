import { NextResponse } from "next/server";

import { notFound, route } from "@/lib/api";
import { getImportBatch, readImportBatchFile } from "@/lib/services";

export const runtime = "nodejs";
type Params = { id: string };

/** Aufbewahrte Originaldatei eines Laufs herunterladen. Nur Admins. */
export const GET = route<Params>("data:import", async (ctx, _req, { id }) => {
  const batch = await getImportBatch(ctx.scope, id);
  if (!batch) return notFound();
  const buf = await readImportBatchFile(ctx.scope, id);
  if (!buf) return notFound();
  const name = batch.fileName.replace(/[^\w.\-]+/g, "_") || "import";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
