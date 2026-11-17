import { handleMcpPost, methodNotAllowed } from "@/mcp/http";

/**
 * MCP-Endpunkt (Streamable HTTP, zustandslos) für KI-Assistenten — Anmeldung
 * nur mit persönlichem Schlüssel (`Authorization: Bearer ftk_…`), nie mit
 * dem Sitzungs-Cookie. Einzelheiten in mcp/http.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(req: Request): Promise<Response> {
  return handleMcpPost(req);
}

// Zustandslos: kein SSE-Strom (GET), keine Sitzungen (DELETE). Ausdrücklich
// beantwortet, damit auch OPTIONS kein automatisches 204 mit Allow-Liste
// liefert und es keine CORS-Antwort gibt.
export function GET(): Response {
  return methodNotAllowed();
}
export const DELETE = GET;
export const PUT = GET;
export const PATCH = GET;
export const OPTIONS = GET;
