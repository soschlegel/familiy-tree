import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { placeHint, suggestPlaces, warmPlaceDirectory } from "@/lib/services/places";

/**
 * Vorschlag unter einem Ortsfeld (Person, Ereignis, Beziehung): welcher Ort
 * zu ?q= erkannt wird — dieselbe Regel wie die automatische Zuordnung.
 * Für Administratoren und Bearbeiter (sonst 403). Liefert nur Daten des
 * Ortsverzeichnisses bzw. eigener Orte, nichts über Personen.
 * Ohne q: lädt das Ortsverzeichnis vorab (beim Öffnen eines Formulars).
 * Mit candidates=1 zusätzlich die Kandidaten zum Auswählen (Verzeichnis und
 * eigene Orte, höchstens 10).
 */
export const GET = route(null, async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (q === null) {
    warmPlaceDirectory(ctx.scope);
    return NextResponse.json({ warming: true });
  }
  const hint = await placeHint(ctx.scope, q.slice(0, 500));
  const body: Record<string, unknown> = { ...hint };
  if (new URL(req.url).searchParams.get("candidates") === "1") {
    const s = await suggestPlaces({ ...ctx.scope, isAdmin: false }, q.slice(0, 500));
    body.candidates = s.candidates.slice(0, 10).map((c) => ({
      gazetteerId: c.gazetteerId,
      label: c.label,
      kind: c.kind,
      precision: c.precision,
      latitude: c.latitude,
      longitude: c.longitude,
      population: c.population,
      own: c.source === "own",
      recommended: c.recommended,
    }));
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
});
