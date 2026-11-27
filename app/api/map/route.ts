import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { route } from "@/lib/api";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { loadLifePathView, type LifePathKind } from "@/lib/services/life-path";
import { loadMapView, type MapMode } from "@/lib/services/map";

const LIFE_PATH_KINDS: readonly LifePathKind[] = ["person", "father", "mother"];

/**
 * Kartendaten (wie die Seite /map): ?person=<id>&mode=ancestors|all.
 * Nur sichtbare Personen; ohne person gilt die Bezugsperson.
 * mode=lifepath&kind=person|father|mother: „Lebensweg“ (lib/services/life-path.ts).
 */
export const GET = route(null, async (ctx, req) => {
  const p = new URL(req.url).searchParams;
  const mode = p.get("mode");
  const cookie = (await cookies()).get(REFERENCE_COOKIE)?.value ?? null;
  if (mode === "lifepath") {
    const kind = p.get("kind") as LifePathKind | null;
    const view = await loadLifePathView(ctx.scope, {
      person: p.get("person"),
      cookie,
      kind: kind && LIFE_PATH_KINDS.includes(kind) ? kind : "person",
    });
    return NextResponse.json(view);
  }
  const view = await loadMapView(ctx.scope, {
    person: p.get("person"),
    cookie,
    mode: mode === "all" || mode === "ancestors" ? (mode as MapMode) : undefined,
  });
  return NextResponse.json(view);
});
