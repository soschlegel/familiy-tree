import { NextResponse } from "next/server";

import { route, notFound } from "@/lib/api";
import type { Scope } from "@/lib/scope";
import { deletePerson, getPersonDetail, mergedIntoError, resolvePersonRedirect, ServiceError, updatePerson } from "@/lib/services";

type Params = { id: string };

/**
 * Person samt gruppierten Beziehungen. Verwandte, die der Benutzer nicht
 * sehen darf, erscheinen als Platzhalter. Bewusst 404 statt 403 für
 * unsichtbare Personen: ein 403 würde bestätigen, dass es sie gibt.
 *
 * Alte Kennung (Person ist in einer anderen aufgegangen): 308 auf die
 * bleibende Person — nur, wenn der Benutzer diese sehen darf; sonst 404 wie
 * bei einer unbekannten Kennung.
 */
export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const detail = await getPersonDetail(ctx.scope, id);
  if (!detail) {
    const to = await resolvePersonRedirect(ctx.scope, id);
    if (!to) return notFound();
    // Relativer Verweis: stimmt auch hinter einem Reverse-Proxy.
    return NextResponse.json({ mergedInto: to }, { status: 308, headers: { Location: `/api/persons/${encodeURIComponent(to)}` } });
  }
  return NextResponse.json(detail);
});

/**
 * Schreiben auf eine alte Kennung wird nicht still umgeleitet: 409 mit
 * `mergedInto`, damit der Aufrufer bewusst den bleibenden Eintrag nimmt.
 */
async function orMergedInto<T>(scope: Scope, id: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") {
      const merged = await mergedIntoError(scope, id);
      if (merged) throw merged;
    }
    throw err;
  }
}

export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  const body = await req.json();
  const person = await orMergedInto(ctx.scope, id, () => updatePerson(ctx.scope, id, body));
  return NextResponse.json(person);
});

export const DELETE = route<Params>(null, async (ctx, req, { id }) => {
  const force = new URL(req.url).searchParams.get("force") === "true";
  return NextResponse.json(await orMergedInto(ctx.scope, id, () => deletePerson(ctx.scope, id, { force })));
});
