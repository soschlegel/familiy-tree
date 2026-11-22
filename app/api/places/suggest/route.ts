import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { placeHint, warmPlaceDirectory } from "@/lib/services/places";

/**
 * Vorschlag unter einem Ortsfeld (Person, Ereignis, Beziehung): welcher Ort
 * zu ?q= erkannt wird — dieselbe Regel wie die automatische Zuordnung.
 * Für Administratoren und Bearbeiter (sonst 403). Liefert nur Daten des
 * Ortsverzeichnisses bzw. eigener Orte, nichts über Personen.
 * Ohne q: lädt das Ortsverzeichnis vorab (beim Öffnen eines Formulars).
 */
export const GET = route(null, async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (q === null) {
    warmPlaceDirectory(ctx.scope);
    return NextResponse.json({ warming: true });
  }
  return NextResponse.json(await placeHint(ctx.scope, q.slice(0, 500)), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
