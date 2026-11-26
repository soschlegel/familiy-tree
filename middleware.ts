import { NextResponse, type NextRequest } from "next/server";

import { createNonce, cspHeaderName, cspMode, isHttpsUrl, pagePolicy } from "@/lib/csp";

/**
 * Content-Security-Policy der Seiten (lib/csp.ts, docs/sicherheit.md).
 *
 * Je Anfrage eine neue Nonce. Die Richtlinie geht zweimal mit: auf der
 * Anfrage — Next.js liest daraus beim Rendern die Nonce und hängt sie an
 * seine eigenen Skripte (Hydration, RSC-Daten) — und auf der Antwort für den
 * Browser. Kostet kein statisches Rendern: Alle Seiten sind ohnehin dynamisch
 * (das Wurzel-Layout liest die Sitzung).
 *
 * Not-Schalter CSP_MODE (enforce | report-only | off) wirkt zur Laufzeit —
 * deshalb läuft die Middleware in Node.js, nicht in der Edge-Laufzeit.
 */
export function middleware(request: NextRequest) {
  const mode = cspMode();
  const header = cspHeaderName(mode);
  if (!header) return NextResponse.next();

  const nonce = createNonce();
  const policy = pagePolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    https: isHttpsUrl(),
    reportOnly: mode === "report-only",
  });

  const requestHeaders = new Headers(request.headers);
  // Nie eine vom Client mitgeschickte Richtlinie übernehmen.
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set(header, policy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: [
    {
      // Alles außer API (eigene, feste Richtlinie in next.config.mjs; große
      // Uploads sollen nicht durch die Middleware), Build-Dateien, Icons und
      // mitgelieferte Geodaten.
      source: "/((?!api(?:/|$)|_next/static/|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|geo/).*)",
      // Vorabladen über next/link liefert kein HTML — keine Nonce nötig.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
