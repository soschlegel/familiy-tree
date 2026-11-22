import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { route } from "@/lib/api";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { loadMapView, type MapMode } from "@/lib/services/map";

/**
 * Kartendaten (wie die Seite /map): ?person=<id>&mode=ancestors|all.
 * Nur sichtbare Personen; ohne person gilt die Bezugsperson.
 */
export const GET = route(null, async (ctx, req) => {
  const p = new URL(req.url).searchParams;
  const mode = p.get("mode");
  const view = await loadMapView(ctx.scope, {
    person: p.get("person"),
    cookie: (await cookies()).get(REFERENCE_COOKIE)?.value ?? null,
    mode: mode === "all" || mode === "ancestors" ? (mode as MapMode) : undefined,
  });
  return NextResponse.json(view);
});
