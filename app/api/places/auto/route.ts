import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { autoAssignPlaces } from "@/lib/services/places";

/** Alle nicht von Hand bestätigten Ortstexte aus dem Ortsverzeichnis zuordnen (nur Administratoren). */
export const POST = route("place:manage", async (ctx) => {
  return NextResponse.json(await autoAssignPlaces(ctx.scope));
});
