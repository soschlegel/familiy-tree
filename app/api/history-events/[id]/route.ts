import { NextResponse } from "next/server";

import { route, badRequest } from "@/lib/api";
import { deleteHistoryEvent, updateHistoryEvent } from "@/lib/services";
import { historyRequestInput } from "@/lib/history/input";

type Params = { id: string };

/** Eigenes Ereignis der Zeitgeschichte ändern (nur Administratoren). */
export const PATCH = route<Params>("history:manage", async (ctx, req, { id }) => {
  const parsed = historyRequestInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await updateHistoryEvent(ctx.scope, id, parsed.data));
});

/** Eigenes Ereignis löschen (nur Administratoren). */
export const DELETE = route<Params>("history:manage", async (ctx, _req, { id }) => {
  await deleteHistoryEvent(ctx.scope, id);
  return NextResponse.json({ ok: true });
});
