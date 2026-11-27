import { NextResponse } from "next/server";

import { notFound, route } from "@/lib/api";
import { getPersonRoots } from "@/lib/services/roots";

type Params = { id: string };

/**
 * Abschnitt „Wurzeln“ der Personenseite: ?generations=2…8 (Standard 4) und
 * ?level=country|region (Standard country). 404, wenn es die Person nicht
 * gibt oder sie nicht sichtbar ist; 400 bei ungültigen Angaben
 * (lib/services/roots.ts).
 */
export const GET = route<Params>(null, async (ctx, req, { id }) => {
  const url = new URL(req.url);
  const roots = await getPersonRoots(ctx.scope, id, {
    generations: url.searchParams.get("generations") ?? undefined,
    level: url.searchParams.get("level") ?? undefined,
  });
  return roots ? NextResponse.json(roots) : notFound();
});
