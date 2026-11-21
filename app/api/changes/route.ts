import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { changeFilterFrom, listChangeSets } from "@/lib/services";

/**
 * Änderungsübersicht (nur Administratoren): eine Zeile je Paket.
 * ?family=&user=&channel=APP|MCP&from=JJJJ-MM-TT&to=JJJJ-MM-TT&page=1
 */
export const GET = route("audit:read", async (ctx, req) => {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "") || 1;
  return NextResponse.json(await listChangeSets(ctx.scope, changeFilterFrom(url.searchParams), { page }));
});
