import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listDuplicateCandidates } from "@/lib/services";

const CONFIDENCES = ["high", "medium", "low"] as const;
const REVIEWS = ["any", "none", "open", "MERGE", "DISPUTED", "NOT_DUPLICATE"] as const;

/**
 * Mögliche Dubletten seitenweise: ?offset&limit&confidence=high|medium|low
 * &review=any|none|open|MERGE|DISPUTED|NOT_DUPLICATE (Stand der KI-Vorprüfung).
 */
export const GET = route(null, async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const c = q.get("confidence");
  const r = q.get("review");
  return NextResponse.json(
    await listDuplicateCandidates(ctx.scope, {
      offset: Number(q.get("offset") ?? 0) || 0,
      limit: Number(q.get("limit") ?? 25) || 25,
      confidence: (CONFIDENCES as readonly string[]).includes(c ?? "") ? (c as (typeof CONFIDENCES)[number]) : undefined,
      review: (REVIEWS as readonly string[]).includes(r ?? "") ? (r as (typeof REVIEWS)[number]) : undefined,
    }),
  );
});
