import { NextResponse } from "next/server";

import { route, badRequest } from "@/lib/api";
import { confirmHistoryEvents } from "@/lib/services";
import { historyConfirmInput } from "@/lib/history/input";

/**
 * Einträge der KI bestätigen (nur Administratoren): einzeln oder „alle
 * sichtbaren bestätigen“ auf /admin/history. Schon bestätigte und von Hand
 * angelegte bleiben unverändert (lib/services/history.ts,
 * confirmHistoryEvents). Über MCP gibt es dafür kein Werkzeug.
 */
export const POST = route("history:manage", async (ctx, req) => {
  const parsed = historyConfirmInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await confirmHistoryEvents(ctx.scope, parsed.data.ids));
});
