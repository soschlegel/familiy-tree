import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { deletePersonName, updatePersonName } from "@/lib/services";

type Params = { id: string };

/** Teil-Update eines weiteren Namens; die Person bleibt fest. */
export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  return NextResponse.json(await updatePersonName(ctx.scope, id, await req.json()));
});

export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  return NextResponse.json(await deletePersonName(ctx.scope, id));
});
