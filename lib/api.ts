import { NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";

import { auth } from "./auth";
import { assertCan, ForbiddenError, type Action } from "./authz";
import { loadScope, type Scope } from "./scope";
import { appChangeSet } from "./change-sets";
import { ServiceError } from "./services/errors";
import { bodyTooLarge, isCrossSiteWrite } from "./request-guard";
import { checkApiRate } from "./rate-limit";

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
  return async (req: Request, segment: { params: Promise<T> }) =>
    privateResponse(await guarded(action, handler, req, segment));
}

async function guarded<T>(
  action: Action | null,
  handler: (ctx: Ctx, req: Request, params: T) => Promise<Response>,
  req: Request,
  segment: { params: Promise<T> },
): Promise<Response> {
  try {
    // Schreibende Anfragen von fremden Webseiten (CSRF) — vor allem anderen,
    // damit eine fremde Seite nicht einmal erfährt, ob jemand angemeldet ist.
    if (isCrossSiteWrite(req)) {
      return NextResponse.json({ error: "Anfrage von fremder Herkunft abgelehnt." }, { status: 403 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
    }

    const pathname = new URL(req.url).pathname;

    // Größe des Anfragekörpers VOR dem Lesen prüfen (lib/request-guard.ts).
    const size = bodyTooLarge(req, pathname);
    if (size === "too-large") {
      return NextResponse.json({ error: "Anfrage zu groß." }, { status: 413 });
    }
    if (size === "length-required") {
      return NextResponse.json({ error: "Anfrage ohne Längenangabe (Content-Length)." }, { status: 411 });
    }

    // Drosselung je Benutzer (lib/rate-limit.ts).
    const rate = checkApiRate(session.user.id, req.method, pathname);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Zu viele Anfragen — bitte kurz warten." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      );
    }

    if (action) assertCan(session.user.role, action);

    // Jede Anfrage bildet ein Changelog-Paket — angelegt erst mit der
    // ersten Änderung (lib/change-sets.ts).
    const scope: Scope = { ...(await loadScope(session.user.id, session.user.role)), changeSet: appChangeSet() };
    const params = segment?.params ? await segment.params : ({} as T);

    return await handler(
      { userId: session.user.id, role: session.user.role, scope },
      req,
      params,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Antworten der API enthalten personenbezogene Daten: nie in einem
 * Zwischenspeicher ablegen (Proxy, Browser-Verlauf), außer die Route legt
 * selbst etwas fest (Bilder: `private, immutable`). `nosniff` verhindert,
 * dass ein Browser eine Antwort als etwas anderes deutet als angegeben.
 */
function privateResponse(res: Response): Response {
  try {
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "private, no-store");
    if (!res.headers.has("X-Content-Type-Options")) res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  } catch {
    // Unveränderliche Kopfzeilen (z.B. Response.redirect): Antwort neu fassen.
    const headers = new Headers(res.headers);
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
    if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
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
