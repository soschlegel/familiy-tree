import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listGedcomPlanItems, PLAN_GROUPS, PLAN_KINDS, type PlanGroup, type PlanKind } from "@/lib/services/gedcom-import";

export const runtime = "nodejs";
type Params = { id: string };

/** Einträge der Vorschau: ?kind=persons&group=changed&offset=0&limit=50&q=… */
export const GET = route<Params>("data:import", async (ctx, req, { id }) => {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const group = sp.get("group");
  return NextResponse.json(
    await listGedcomPlanItems(ctx.scope, id, {
      kind: PLAN_KINDS.includes(kind as PlanKind) ? (kind as PlanKind) : undefined,
      group: PLAN_GROUPS.includes(group as PlanGroup) ? (group as PlanGroup) : undefined,
      offset: Number(sp.get("offset") ?? 0) || 0,
      limit: Number(sp.get("limit") ?? 50) || 50,
      q: sp.get("q") ?? undefined,
    }),
  );
});
