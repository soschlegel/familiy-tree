import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { dismissDuplicate, undismissDuplicate } from "@/lib/services";

/** Paar { a, b } als „kein Duplikat“ markieren (POST) bzw. wieder aufheben (DELETE). */
export const POST = route(null, async (ctx, req) => {
  const { a, b } = (await req.json()) as { a?: string; b?: string };
  return NextResponse.json(await dismissDuplicate(ctx.scope, String(a ?? ""), String(b ?? "")));
});

export const DELETE = route(null, async (ctx, req) => {
  const { a, b } = (await req.json()) as { a?: string; b?: string };
  return NextResponse.json(await undismissDuplicate(ctx.scope, String(a ?? ""), String(b ?? "")));
});
