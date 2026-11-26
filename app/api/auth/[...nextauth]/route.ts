import type { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { authRouteDecision, publicBaseUrl } from "@/lib/email-login";

/**
 * Auth.js-Routen mit Vorprüfung für den E-Mail-Link (authRouteDecision in
 * lib/email-login.ts): Anfordern nur über die Anmeldeseite, Einlösen nur per
 * POST von der Bestätigungsseite.
 */
function guard(req: NextRequest): Response | null {
  const decision = authRouteDecision(req, req.nextUrl.pathname);
  switch (decision.kind) {
    case "pass":
      return null;
    case "not-found":
      return new Response("Nicht gefunden", { status: 404 });
    case "forbidden":
      return new Response("Anfrage von fremder Seite abgelehnt", { status: 403 });
    case "confirm": {
      const target = new URL(decision.path, publicBaseUrl() ?? req.nextUrl.origin);
      for (const key of ["token", "email"]) {
        const value = req.nextUrl.searchParams.get(key);
        if (value) target.searchParams.set(key, value);
      }
      return Response.redirect(target, 303);
    }
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return guard(req) ?? handlers.GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return guard(req) ?? handlers.POST(req);
}
