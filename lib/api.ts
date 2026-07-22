import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

import { auth } from "./auth";
import { assertCan, ForbiddenError, type Action } from "./authz";
import { loadScope, type Scope } from "./scope";

export type Ctx = { userId: string; role: Role; scope: Scope };

/**
 * Umschließt einen Route-Handler mit Authentifizierung und einheitlicher
 * Fehlerbehandlung.
 *
 * `action` prüft nur GLOBALE Verwaltungsrechte. Inhaltliche Routen übergeben
 * `null` und prüfen selbst über ctx.scope, welche Personen der Benutzer sehen
 * oder ändern darf — pauschal lässt sich das nicht entscheiden, weil es von
 * den Familien der betroffenen Person abhängt.
 */
export function route<T>(
  action: Action | null,
  handler: (ctx: Ctx, req: Request, params: T) => Promise<Response>,
) {
  return async (req: Request, segment: { params: Promise<T> }) => {
    try {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
      }

      if (action) assertCan(session.user.role, action);

      const scope = await loadScope(session.user.id, session.user.role);
      const params = segment?.params ? await segment.params : ({} as T);

      return await handler(
        { userId: session.user.id, role: session.user.role, scope },
        req,
        params,
      );
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
      }
      console.error("[api]", err);
      const message =
        err instanceof Error ? err.message : "Unbekannter Fehler";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export function badRequest(issues: unknown) {
  return NextResponse.json(
    { error: "Validierung fehlgeschlagen", issues },
    { status: 400 },
  );
}

export function forbidden(what = "diese Aktion") {
  return NextResponse.json(
    { error: `Keine Berechtigung für: ${what}` },
    { status: 403 },
  );
}

export function notFound() {
  return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
}
