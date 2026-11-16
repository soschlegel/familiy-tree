import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { createPerson, searchPersons, type PersonSort } from "@/lib/services";

const SORTS: PersonSort[] = ["name", "birthDate", "birthDateDesc", "updatedAt"];

/**
 * Sichtbare Personen suchen.
 *
 * Antwort wie bisher als Array (rückwärtskompatibel); die Gesamtzahl steht im
 * Header `X-Total-Count`. Optionale Parameter: q, familyId, limit, offset,
 * sort (name | birthDate | birthDateDesc | updatedAt).
 */
export const GET = route(null, async (ctx, req) => {
  const params = new URL(req.url).searchParams;
  const num = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const sort = params.get("sort") as PersonSort | null;

  const { items, total } = await searchPersons(ctx.scope, {
    q: params.get("q") ?? undefined,
    familyId: params.get("familyId") ?? undefined,
    limit: num("limit"),
    offset: num("offset"),
    sort: sort && SORTS.includes(sort) ? sort : undefined,
  });

  return NextResponse.json(
    items.map(({ relationCount: _relationCount, ...p }) => p),
    { headers: { "X-Total-Count": String(total) } },
  );
});

/**
 * Neue Person. Regeln (Familienzuordnung, Validierung) siehe createPerson in
 * lib/services/persons.ts.
 */
export const POST = route(null, async (ctx, req) => {
  const person = await createPerson(ctx.scope, await req.json());
  return NextResponse.json(person, { status: 201 });
});
