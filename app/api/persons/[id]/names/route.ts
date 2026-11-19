import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import { createPersonName, listPersonNames } from "@/lib/services";

type Params = { id: string };

/** Weitere Namen einer Person (Ehename, Schreibvariante, „auch bekannt als“ …). */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const names = await listPersonNames(ctx.scope, id);
  if (!names) return notFound();
  return NextResponse.json(names);
});

/** Neuer Name: { type, givenName?, familyName?, prefix?, suffix?, nickname?, label?, notes? }. */
export const POST = route<Params>(null, async (ctx, req, { id }) => {
  const body = (await req.json()) as Record<string, unknown>;
  const name = await createPersonName(ctx.scope, { ...body, personId: id });
  return NextResponse.json(name, { status: 201 });
});
