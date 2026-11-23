import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { originOverview } from "@/lib/services/origin";

export const runtime = "nodejs";

/**
 * Übersicht der Herkunft: Personen je Import und Verbindungspersonen je
 * Import-Paar. Der Dienst zählt nur Personen, die der Benutzer bearbeiten
 * darf; wer nirgends Bearbeiter ist, bekommt 403.
 */
export const GET = route(null, async (ctx) => {
  return NextResponse.json(await originOverview(ctx.scope));
});
