import { NextResponse } from "next/server";
import { z } from "zod";

import { route, badRequest } from "@/lib/api";
import { createSetting, listSettings } from "@/lib/services";

/**
 * Einstellungen der Installation (nur Administratoren). Welche Schlüssel es
 * gibt, steht in lib/settings/registry.ts; Prüfung und Protokoll in
 * lib/services/settings.ts.
 */
const createInput = z.object({
  key: z.string().trim().min(1, "Einstellung fehlt").max(100),
  value: z.string().max(4000),
});

export const GET = route("setting:manage", async (ctx) => {
  return NextResponse.json(await listSettings(ctx.scope));
});

export const POST = route("setting:manage", async (ctx, req) => {
  const parsed = createInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  const state = await createSetting(ctx.scope, parsed.data.key, parsed.data.value);
  return NextResponse.json(state, { status: 201 });
});
