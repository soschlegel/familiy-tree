import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { mergePersons } from "@/lib/services";

/**
 * Zwei Personen zusammenführen: { keepId, mergeId, choices?,
 * relationshipSubtypes?, expectedToken? }. Eine Transaktion; doppeltes
 * Absenden liefert das gespeicherte Ergebnis (alreadyMerged). Blockaden und
 * geänderte Daten seit der Vorschau: 409 mit Erklärung.
 */
export const POST = route(null, async (ctx, req) => {
  return NextResponse.json(await mergePersons(ctx.scope, await req.json()));
});
