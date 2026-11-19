import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { setUserAiAccess } from "@/lib/services";

type Params = { id: string };

/**
 * Admin: KI-Recht eines Benutzers setzen — { aiAccess: "NONE"|"READ"|"WRITE" }.
 * Vorhandene Schlüssel bleiben bestehen; ihre wirksame Stufe richtet sich ab
 * sofort nach dem neuen Recht.
 */
export const PUT = route<Params>("user:manage", async (ctx, req, { id }) => {
  const user = await setUserAiAccess(ctx.scope, id, await req.json());
  return NextResponse.json(user);
});
