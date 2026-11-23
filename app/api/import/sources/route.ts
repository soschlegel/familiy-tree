import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { listImportSources, renameImportSource } from "@/lib/services/origin";

export const runtime = "nodejs";

/** Importe (Quell-Bäume) mit Buchstabe, Farbe, Anzeigename und Zahl der Personen. Nur Admins. */
export const GET = route("data:import", async (ctx) => {
  return NextResponse.json(await listImportSources(ctx.scope));
});

/** Anzeigenamen setzen: { sourceTreeId, displayName } — leer entfernt die eigene Benennung. Nur Admins. */
export const PATCH = route("data:import", async (ctx, req) => {
  return NextResponse.json(await renameImportSource(ctx.scope, await req.json()));
});
