import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { historyAreaLegend } from "@/lib/services/history-areas";

/**
 * Geltungsbereich der Zeitgeschichte (nur Administratoren): benannte Gruppen
 * und — mit `?country=DE` — die Regionen erster Ebene dieses Landes mit
 * Schlüsseln. Für die Auswahl in der Verwaltung (components/HistoryAdmin.tsx);
 * dieselben Daten bekommt die KI über list_history_areas.
 */
export const GET = route("history:manage", async (_ctx, req) => {
  const country = new URL(req.url).searchParams.get("country");
  return NextResponse.json(await historyAreaLegend(country));
});
