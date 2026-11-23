import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { loadTree } from "@/lib/services";

/**
 * Liefert den kompletten Graphen — sichtbare Personen mit Angaben, alle
 * übrigen als anonymer Platzhalter (siehe loadTree in lib/services/tree.ts).
 */
export const GET = route(null, async (ctx) => {
  // Ohne freigegebene Familie gibt es nichts zu zeigen — auch keine
  // Platzhalter: Zahl und Verknüpfung fremder Personen gingen den Benutzer
  // nichts an (wie die Baumseite, die dann gar nichts lädt).
  if (!ctx.scope.isAdmin && ctx.scope.families.size === 0) {
    return NextResponse.json({ persons: [], relationships: [] });
  }
  return NextResponse.json(await loadTree(ctx.scope));
});
