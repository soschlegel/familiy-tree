import { NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";

import { auth } from "./auth";
import { assertCan, ForbiddenError, type Action } from "./authz";
import { loadScope, type Scope } from "./scope";
import { ServiceError } from "./services/errors";

export type Ctx = { userId: string; role: Role; scope: Scope };

const STATUS: Record<ServiceError["code"], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  VALIDATION: 400,
};

/**
 * Übersetzt Fehler in eine Antwort. Interne Details (Fehlermeldungen von
 * Prisma, Stacktraces) gehen nur ins Server-Log — nach außen gibt es eine
 * allgemeine Meldung, damit keine Tabellen-, Spalten- oder Pfadnamen
 * durchsickern.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      {
        error: err.message,
        ...(err.issues ? { issues: err.issues } : {}),
        ...(err.details ?? {}),
      },
      { status: STATUS[err.code] },
    );
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2025": // Datensatz für update/delete nicht gefunden
        return notFound();
      case "P2002": // Unique-Constraint
        return NextResponse.json(
          { error: "Eintrag existiert bereits." },
          { status: 409 },
        );
      case "P2003": // Fremdschlüssel zeigt ins Leere
        return NextResponse.json(
          { error: "Verweis auf einen nicht vorhandenen Eintrag." },
          { status: 409 },
        );
    }
  }

  console.error("[api]", err);
  return NextResponse.json(
    { error: "Interner Fehler. Details stehen im Server-Log." },
    { status: 500 },
  );
}

/**
 * Umschließt einen Route-Handler mit Authentifizierung und einheitlicher
 * Fehlerbehandlung.
 *
 * `action` prüft nur GLOBALE Verwaltungsrechte. Inhaltliche Routen übergeben
 * `null` und prüfen selbst über ctx.scope (bzw. die Dienste in lib/services),
 * welche Personen der Benutzer sehen oder ändern darf — pauschal lässt sich
 * das nicht entscheiden, weil es von den Familien der betroffenen Person
 * abhängt.
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
      return errorResponse(err);
    }
  };
}

export function badRequest(issues: unknown) {
  const first =
    Array.isArray(issues) &&
    issues[0] &&
    typeof issues[0] === "object" &&
    "message" in issues[0]
      ? String((issues[0] as { message: unknown }).message)
      : null;
  return NextResponse.json(
    {
      error: first
        ? `Validierung fehlgeschlagen: ${first}`
        : "Validierung fehlgeschlagen",
      issues,
    },
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
