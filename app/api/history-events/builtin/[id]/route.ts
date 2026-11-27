import { NextResponse } from "next/server";

import { route, badRequest } from "@/lib/api";
import { setBuiltinHidden } from "@/lib/services";
import { historyHiddenInput } from "@/lib/history/input";

type Params = { id: string };

/**
 * Mitgelieferten Eintrag der Zeitgeschichte aus- bzw. wieder einblenden
 * (nur Administratoren). Unbekannte Kennung → 404.
 */
export const PATCH = route<Params>("history:manage", async (ctx, req, { id }) => {
  const parsed = historyHiddenInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await setBuiltinHidden(ctx.scope, id, parsed.data.hidden));
});
