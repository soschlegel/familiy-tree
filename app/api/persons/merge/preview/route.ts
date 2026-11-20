import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { previewPersonMerge } from "@/lib/services";

/**
 * Vorschau des Zusammenführens: { keepId, mergeId, choices?,
 * relationshipSubtypes? } → was geschähe (Felder, Zusammenfassung,
 * Blockaden, token). Schreibt nichts. Unsichtbare Personen: 404.
 */
export const POST = route(null, async (ctx, req) => {
  const body = (await req.json()) as { keepId?: string; mergeId?: string; choices?: unknown; relationshipSubtypes?: unknown };
  const preview = await previewPersonMerge(ctx.scope, String(body.keepId ?? ""), String(body.mergeId ?? ""), {
    choices: (body.choices ?? {}) as never,
    relationshipSubtypes: (body.relationshipSubtypes ?? {}) as never,
  });
  return NextResponse.json(preview);
});
