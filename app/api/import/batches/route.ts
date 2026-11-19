import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listImportHistory } from "@/lib/services/gedcom-import";

export const runtime = "nodejs";

/** Importverlauf (alle Formate), neueste zuerst. Nur Admins. */
export const GET = route("data:import", async (ctx, req) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
  return NextResponse.json(await listImportHistory(ctx.scope, limit));
});
