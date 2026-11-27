import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { exportLineageCount } from "@/lib/services/export-selection";

export const runtime = "nodejs";

/**
 * Personenzahl der Auswahl „Ab einer Person“ für den GEDCOM-Exportdialog
 * (components/GedcomExportDialog.tsx): dieselben Parameter wie der Export
 * (`person=<id>&partners=1&siblings=1&siblingFamilies=1&descendants=1&allParents=1&generations=<n>`),
 * Antwort nur Zahlen je Gruppe — keine Personenkennungen. Gesperrte und
 * unbekannte Personen: 404.
 */
export const GET = route(null, async (ctx, req) => {
  const counts = await exportLineageCount(ctx.scope, new URL(req.url).searchParams);
  return NextResponse.json(counts);
});
