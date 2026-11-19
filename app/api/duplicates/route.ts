import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listDuplicateCandidates } from "@/lib/services";

const CONFIDENCES = ["high", "medium", "low"] as const;

/** Mögliche Dubletten seitenweise: ?offset&limit&confidence=high|medium|low. */
export const GET = route(null, async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const c = q.get("confidence");
  return NextResponse.json(
    await listDuplicateCandidates(ctx.scope, {
      offset: Number(q.get("offset") ?? 0) || 0,
      limit: Number(q.get("limit") ?? 25) || 25,
      confidence: (CONFIDENCES as readonly string[]).includes(c ?? "") ? (c as (typeof CONFIDENCES)[number]) : undefined,
    }),
  );
});
