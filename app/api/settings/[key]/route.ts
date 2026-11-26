import { NextResponse } from "next/server";
import { z } from "zod";

import { route, badRequest } from "@/lib/api";
import { deleteSetting, updateSetting } from "@/lib/services";

type Params = { key: string };

const patchInput = z.object({ value: z.string().max(4000) });

/** Wert einer gesetzten Einstellung ändern (nur Administratoren). */
export const PATCH = route<Params>("setting:manage", async (ctx, req, { key }) => {
  const parsed = patchInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await updateSetting(ctx.scope, key, parsed.data.value));
});

/** In der App gesetzten Wert entfernen — danach gilt die Umgebungsvariable. */
export const DELETE = route<Params>("setting:manage", async (ctx, _req, { key }) => {
  return NextResponse.json(await deleteSetting(ctx.scope, key));
});
