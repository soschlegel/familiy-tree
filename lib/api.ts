import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

import { auth } from "./auth";
import { assertCan, ForbiddenError, type Action } from "./authz";

export type Ctx = { userId: string; role: Role };

/**
 * Umschließt einen Route-Handler mit Authentifizierung, Rollenprüfung und
 * einheitlicher Fehlerbehandlung. Jeder mutierende Endpunkt nutzt das.
 */
export function route<T>(
  action: Action,
  handler: (ctx: Ctx, req: Request, params: T) => Promise<Response>,
) {
  return async (req: Request, segment: { params: Promise<T> }) => {
    try {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
      }

      assertCan(session.user.role, action);

      const params = segment?.params ? await segment.params : ({} as T);
      return await handler(
        { userId: session.user.id, role: session.user.role },
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

/** Zod-Fehler in eine 400-Antwort übersetzen. */
export function badRequest(issues: unknown) {
  return NextResponse.json(
    { error: "Validierung fehlgeschlagen", issues },
    { status: 400 },
  );
}
