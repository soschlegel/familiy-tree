import { NextResponse } from "next/server";
import { z } from "zod";

import { route, badRequest } from "@/lib/api";
import { setPersonFamilies } from "@/lib/services";

type Params = { id: string };

const input = z.object({ familyIds: z.array(z.string().min(1)).max(50) });

/**
 * Setzt die Familienzugehörigkeit einer Person. Regeln siehe
 * setPersonFamilies in lib/services/persons.ts.
 */
export const PUT = route<Params>(null, async (ctx, req, { id }) => {
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  return NextResponse.json(
    await setPersonFamilies(ctx.scope, id, parsed.data.familyIds),
  );
});
