import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { changeFilterFrom, listChangeSetEntries } from "@/lib/services";

type Params = { key: string };

/** Einträge eines Pakets (nur Administratoren), mit denselben Filtern: ?cursor=… */
export const GET = route<Params>("audit:read", async (ctx, req, { key }) => {
  const url = new URL(req.url);
  return NextResponse.json(
    await listChangeSetEntries(ctx.scope, decodeURIComponent(key), changeFilterFrom(url.searchParams), {
      cursor: url.searchParams.get("cursor"),
    }),
  );
});
