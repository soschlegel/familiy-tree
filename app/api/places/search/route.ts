import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { searchPlaceDirectory } from "@/lib/services/places";

/** Suche im mitgelieferten Ortsverzeichnis: ?q= (nur Administratoren). */
export const GET = route("place:manage", async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchPlaceDirectory(ctx.scope, q.slice(0, 100)));
});
