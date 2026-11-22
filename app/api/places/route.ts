import { NextResponse } from "next/server";

import { badRequest, route } from "@/lib/api";
import { assignPlace, listPlaces, placeAssignSchema, type PlaceStatus } from "@/lib/services/places";

const STATUSES: (PlaceStatus | "all")[] = ["all", "open", "auto", "manual", "unresolvable"];

/**
 * Ortszuordnung (nur Administratoren, README „Karte und Orte“).
 * GET ?status=all|open|auto|manual|unresolvable&q=&page= — vorkommende
 * Ortstexte mit Häufigkeit, Zuordnung und Vorschlag.
 */
export const GET = route("place:manage", async (ctx, req) => {
  const p = new URL(req.url).searchParams;
  const status = p.get("status") as PlaceStatus | "all" | null;
  return NextResponse.json(
    await listPlaces(ctx.scope, {
      status: status && STATUSES.includes(status) ? status : "all",
      q: p.get("q") ?? undefined,
      page: Number(p.get("page") ?? "") || 1,
    }),
  );
});

/**
 * Einen Ortstext von Hand zuordnen: { action: "directory", text, gazetteerId }
 * | { action: "coordinates", text, latitude, longitude, precision, label? }
 * | { action: "confirm" | "unresolvable" | "reset", text }.
 */
export const PUT = route("place:manage", async (ctx, req) => {
  const parsed = placeAssignSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);
  return NextResponse.json({ assignment: await assignPlace(ctx.scope, parsed.data) });
});
