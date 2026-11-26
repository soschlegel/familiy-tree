import { NextResponse } from "next/server";
import { z } from "zod";

import { route, badRequest } from "@/lib/api";
import { setSelfPerson } from "@/lib/services";

const input = z.object({ personId: z.string().min(1).max(64).nullable() });

/**
 * „Das bin ich“: eigene Person des angemeldeten Benutzers setzen (oder mit
 * `null` aufheben). Nur Personen, die er sehen darf — sonst 404 wie überall
 * (docs/fachlich/bezugsperson.md).
 */
export const PUT = route(null, async (ctx, req) => {
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json(await setSelfPerson(ctx.scope, parsed.data.personId));
});
