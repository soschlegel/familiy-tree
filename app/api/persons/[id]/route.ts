import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import { deletePerson, getPersonDetail, updatePerson } from "@/lib/services";

type Params = { id: string };

/**
 * Person samt gruppierten Beziehungen. Verwandte, die der Benutzer nicht
 * sehen darf, erscheinen als Platzhalter. Bewusst 404 statt 403 für
 * unsichtbare Personen: ein 403 würde bestätigen, dass es sie gibt.
 */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const detail = await getPersonDetail(ctx.scope, id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
});

export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  const person = await updatePerson(ctx.scope, id, await req.json());
  return NextResponse.json(person);
});

export const DELETE = route<Params>(null, async (ctx, req, { id }) => {
  const force = new URL(req.url).searchParams.get("force") === "true";
  return NextResponse.json(await deletePerson(ctx.scope, id, { force }));
});
