import { NextResponse } from "next/server";

import { route, badRequest } from "@/lib/api";
import { createHistoryEvent, historyAdminState } from "@/lib/services";
import { historyRequestInput } from "@/lib/history/input";

/**
 * Zeitgeschichte (nur Administratoren): Zustand der Verwaltungsseite und
 * eigenes Ereignis anlegen. Prüfung der Felder und Protokoll in
 * lib/services/history.ts (lib/history/events.ts, checkHistoryInput).
 */
export const GET = route("history:manage", async (ctx) => {
  return NextResponse.json(await historyAdminState(ctx.scope));
});

export const POST = route("history:manage", async (ctx, req) => {
  const parsed = historyRequestInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await createHistoryEvent(ctx.scope, parsed.data), { status: 201 });
});
