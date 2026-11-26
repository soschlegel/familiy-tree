import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listGedcomPlanItems, PLAN_GROUPS, PLAN_KINDS, type PlanGroup, type PlanKind } from "@/lib/services/gedcom-import";
import { SUGGESTION_CLASS_RANK, type SuggestionClass } from "@/lib/services/import-suggestions";

export const runtime = "nodejs";
type Params = { id: string };

/**
 * Einträge der Vorschau: ?kind=persons&group=changed&offset=0&limit=50&q=…;
 * `suggest=high|veryLikely|medium|low` liefert die neuen Personen, deren
 * bester Vorschlag in dieser Klasse liegt.
 */
export const GET = route<Params>("data:import", async (ctx, req, { id }) => {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const group = sp.get("group");
  const suggest = sp.get("suggest");
  return NextResponse.json(
    await listGedcomPlanItems(ctx.scope, id, {
      kind: PLAN_KINDS.includes(kind as PlanKind) ? (kind as PlanKind) : undefined,
      group: PLAN_GROUPS.includes(group as PlanGroup) ? (group as PlanGroup) : undefined,
      offset: Number(sp.get("offset") ?? 0) || 0,
      limit: Number(sp.get("limit") ?? 50) || 50,
      q: sp.get("q") ?? undefined,
      suggest: suggest && Object.hasOwn(SUGGESTION_CLASS_RANK, suggest) ? (suggest as SuggestionClass) : undefined,
    }),
  );
});
