import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { createSource, listSources, type SourceKind } from "@/lib/services";
import { SOURCE_KINDS } from "@/lib/validation";

/**
 * Sichtbare Quellen suchen (q, kind, limit, offset). Gesamtzahl im Header
 * `X-Total-Count`. Sichtbarkeit und Rechte: lib/services/sources.ts.
 */
export const GET = route(null, async (ctx, req) => {
  const params = new URL(req.url).searchParams;
  const num = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const kind = params.get("kind");
  const { items, total } = await listSources(ctx.scope, {
    q: params.get("q") ?? undefined,
    kind: kind && (SOURCE_KINDS as readonly string[]).includes(kind) ? (kind as SourceKind) : undefined,
    limit: num("limit"),
    offset: num("offset"),
  });
  return NextResponse.json(items, { headers: { "X-Total-Count": String(total) } });
});

/** Neue Quelle (Bearbeitungsrecht in mindestens einer Familie). */
export const POST = route(null, async (ctx, req) => {
  const source = await createSource(ctx.scope, await req.json());
  return NextResponse.json(source, { status: 201 });
});
