/**
 * MCP über HTTP (Streamable HTTP, zustandslos) — der reguläre KI-Zugang der
 * App, eingebunden als Route-Handler unter /api/mcp (app/api/mcp/route.ts).
 *
 * Ablauf pro Anfrage:
 *   Methode → Origin → Sperre nach Fehlversuchen → Schlüssel → MCP
 *
 * - Zustandslos: Für jede POST-Anfrage entstehen ein neuer McpServer und ein
 *   neuer Transport (WebStandardStreamableHTTPServerTransport ohne
 *   sessionIdGenerator, JSON-Antworten statt SSE). Es gibt keine
 *   Sitzungsdaten im Speicher — der Endpunkt funktioniert hinter jedem
 *   Reverse-Proxy und über Neustarts hinweg. GET (SSE-Strom für
 *   Server-Nachrichten) und DELETE (Sitzung beenden) braucht es dafür nicht;
 *   sie werden wie alle anderen Methoden mit 405 beantwortet, was die
 *   Spezifikation ausdrücklich vorsieht.
 * - Anmeldung NUR per `Authorization: Bearer <Schlüssel>`. Das
 *   Sitzungs-Cookie der Web-App wird nicht gelesen: der Endpunkt ist ein
 *   Maschinenkanal, und ohne Cookie-Anmeldung gibt es auch kein CSRF.
 *   Schlüssel in der URL (Query-String) werden nicht angenommen.
 * - 401 (einheitlich, ohne Grund): Schlüssel fehlt, Format falsch, unbekannt,
 *   widerrufen, abgelaufen, Benutzer unbekannt oder gesperrt.
 *   403: Schlüssel gültig, aber der Benutzer hat (inzwischen) kein KI-Recht.
 * - Werkzeuge nach Stufe: Mit wirksamer Stufe READ werden die
 *   Schreibwerkzeuge gar nicht registriert (tools/list zeigt sie nicht).
 *   Zusätzlich prüft jedes Werkzeug bei JEDEM Aufruf neu (authorizeAiCall) —
 *   Widerruf und Rechteänderungen wirken sofort.
 * - Geloggt wird nie der Schlüssel, höchstens sein öffentlicher Anfang
 *   (ftk_<12 Hex>).
 *
 * Bewusst ohne next/* — so lässt sich der Handler auch direkt in Tests
 * aufrufen. Und ohne mcp/bootstrap.ts: dessen stdout-Umleitung gehört allein
 * zum stdio-Modus.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { tokenPrefixOf } from "../lib/ai-tokens";
import { authorizeAiCall, type AiAuthFailureReason, type AiCredential } from "../lib/services";
import { createMcpServer } from "./register";

/**
 * Obergrenze für den Anfragekörper. Das größte reguläre Feld ist eine
 * Quellen-Abschrift mit 50 000 Zeichen (lib/validation.ts) — selbst
 * vollständig als \uXXXX maskiert sind das rund 300 KB.
 */
export const MCP_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Obergrenze für Schlüssel mit Schreibrecht: ein Bild als base64 (add_media)
 * darf so groß sein wie ein Upload (MAX_UPLOAD_BYTES, base64 ist 4/3 so groß)
 * plus Rest der Anfrage. Gilt erst NACH der Prüfung des Schlüssels — ohne
 * gültigen Schlüssel mit Schreibstufe bleibt es bei 1 MiB.
 */
export function mcpWriteBodyLimit(): number {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
  const upload = Number.isFinite(max) && max > 0 ? max : 15 * 1024 * 1024;
  return Math.max(MCP_MAX_BODY_BYTES, Math.ceil(upload / 3) * 4 + MCP_MAX_BODY_BYTES);
}

/** Fehlversuche (401) je Absender und Zeitfenster, danach 429 bis Fensterende. */
export const MCP_AUTH_FAILURE_LIMIT = 20;
export const MCP_AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** Obergrenze der gemerkten Absender, damit die Tabelle nicht unbegrenzt wächst. */
const MAX_TRACKED_CLIENTS = 10_000;

const REALM = "familytree";

/** Gründe, die nach außen alle gleich als 401 erscheinen. */
const UNAUTHENTICATED: ReadonlySet<AiAuthFailureReason> = new Set([
  "MALFORMED",
  "UNKNOWN",
  "REVOKED",
  "EXPIRED",
  "USER_UNKNOWN",
  "USER_BLOCKED",
]);

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

function jsonError(status: number, message: string, headers: Record<string, string> = {}): Response {
  // JSON-RPC-Fehlerform wie beim Transport des SDK; id ist unbekannt.
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json", ...headers },
  });
}

/** 405 für alles außer POST — zustandsloser Betrieb ohne SSE-Strom und Sitzungen. */
export function methodNotAllowed(): Response {
  return jsonError(405, "Method not allowed — this endpoint accepts POST only.", { Allow: "POST" });
}

function unauthorized(credentialSent: boolean): Response {
  // Bewusst ohne Grund: ob ein Schlüssel unbekannt, widerrufen oder
  // abgelaufen ist, verrät die Antwort nicht.
  const challenge = credentialSent
    ? `Bearer realm="${REALM}", error="invalid_token"`
    : `Bearer realm="${REALM}"`;
  return jsonError(401, "Unauthorized: a valid personal access key is required (Authorization: Bearer …).", {
    "WWW-Authenticate": challenge,
  });
}

function forbidden(): Response {
  return jsonError(403, "Forbidden: AI access is not enabled for this user.", {
    "WWW-Authenticate": `Bearer realm="${REALM}", error="insufficient_scope"`,
  });
}

function withBaseHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ---------------------------------------------------------------------------
// Absender, Origin und Sperre nach Fehlversuchen
// ---------------------------------------------------------------------------

/**
 * Adresse des Absenders für die Sperre nach Fehlversuchen: der LETZTE
 * Eintrag in X-Forwarded-For.
 *
 * - Hinter dem Reverse-Proxy der NAS (Synology, Nginx Proxy Manager, Caddy)
 *   hängt der Proxy die Adresse an, von der er die Verbindung bekommen hat.
 *   Der letzte Eintrag stammt also vom eigenen Proxy und ist nicht fälschbar;
 *   alles davor kann der Client selbst mitschicken.
 * - Ohne Proxy setzt Next.js X-Forwarded-For selbst auf die Socket-Adresse,
 *   sofern der Header fehlt. Ein Client, der die App DIREKT erreicht, kann den
 *   Header aber selbst setzen und so die Sperre umgehen — deshalb lauscht die
 *   App im Stack nur auf 127.0.0.1 bzw. der LAN-IP für den Proxy.
 * - Bei zwei Proxys hintereinander wäre der letzte Eintrag der vordere Proxy;
 *   alle Clients teilten sich dann eine Sperre. Für den Heimbetrieb hinnehmbar.
 */
export function clientAddress(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || "unbekannt";
}

/**
 * Erlaubte Origins. Die Spezifikation verlangt, dass HTTP-Server Origin
 * prüfen (Schutz gegen DNS-Rebinding aus dem Browser). MCP-Clients wie
 * Claude Code sind keine Browser und schicken KEINEN Origin — Anfragen ohne
 * Origin sind deshalb erlaubt. Schickt eine Anfrage einen Origin, muss er
 * der eigenen Adresse der App (AUTH_URL) oder einem Eintrag in
 * MCP_ALLOWED_ORIGINS (kommagetrennt) entsprechen; sonst 403. CORS-Header
 * gibt es keine — fremde Webseiten können den Endpunkt also ohnehin nicht
 * auslesen.
 */
function allowedOrigins(): Set<string> {
  const list = new Set<string>();
  for (const raw of [process.env.AUTH_URL, ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",")]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      list.add(new URL(value).origin);
    } catch {
      // ungültige Einträge ignorieren
    }
  }
  return list;
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  return allowedOrigins().has(origin);
}

type FailureEntry = { count: number; resetAt: number };

/**
 * Einfache Sperre nach Fehlversuchen, im Speicher des Prozesses. Grenzen:
 * gilt nur für diesen einen Prozess, ist nach einem Neustart leer und hängt
 * an der Absenderadresse (siehe clientAddress). Gegen das Erraten von
 * Schlüsseln braucht es sie nicht (256 Bit Zufall) — sie begrenzt Last und
 * Log-Rauschen durch fehlerhaft eingerichtete oder böswillige Clients.
 */
const failures = new Map<string, FailureEntry>();

function prune(now: number): void {
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  // Notbremse: älteste Einträge zuerst verwerfen (Map behält die Einfügereihenfolge).
  while (failures.size >= MAX_TRACKED_CLIENTS) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

/** Sekunden bis zum Ende der Sperre, oder 0, wenn nicht gesperrt. */
function blockedFor(client: string, now: number): number {
  const entry = failures.get(client);
  if (!entry) return 0;
  if (entry.resetAt <= now) {
    failures.delete(client);
    return 0;
  }
  return entry.count >= MCP_AUTH_FAILURE_LIMIT ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

function recordFailure(client: string, now: number): void {
  const entry = failures.get(client);
  if (entry && entry.resetAt > now) {
    entry.count += 1;
    return;
  }
  if (failures.size >= MAX_TRACKED_CLIENTS) prune(now);
  failures.set(client, { count: 1, resetAt: now + MCP_AUTH_FAILURE_WINDOW_MS });
}

/** Nur für Tests: Sperren zurücksetzen. */
export function resetMcpRateLimit(): void {
  failures.clear();
}

// ---------------------------------------------------------------------------
// Schlüssel
// ---------------------------------------------------------------------------

/** Schlüssel aus `Authorization: Bearer …` — sonst null. Cookies zählen nicht. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return m ? m[1] : "";
}

/** Für Logs: öffentlicher Anfang des Schlüssels, nie das Geheimnis. */
function keyLabel(secret: string | null): string {
  if (!secret) return "kein Schlüssel";
  return tokenPrefixOf(secret) ?? "ungültiges Format";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleMcpPost(req: Request): Promise<Response> {
  if (!originAllowed(req)) {
    console.warn(`[mcp-http] 403 fremder Origin ${JSON.stringify(req.headers.get("origin"))}`);
    return jsonError(403, "Forbidden: origin not allowed.");
  }

  const client = clientAddress(req);
  const now = Date.now();
  const retryAfter = blockedFor(client, now);
  if (retryAfter > 0) {
    return jsonError(429, "Too many failed authentication attempts — try again later.", {
      "Retry-After": String(retryAfter),
    });
  }

  const secret = bearerToken(req);
  if (!secret) {
    recordFailure(client, now);
    return unauthorized(secret !== null);
  }

  const credential: AiCredential = { kind: "token", secret };
  let auth;
  try {
    auth = await authorizeAiCall(credential, "READ");
  } catch (err) {
    console.error(`[mcp-http] Prüfung fehlgeschlagen (${keyLabel(secret)}):`, (err as Error).message);
    return jsonError(503, "Service unavailable.");
  }
  if (!auth.ok) {
    if (UNAUTHENTICATED.has(auth.reason)) {
      recordFailure(client, now);
      console.warn(`[mcp-http] 401 ${auth.reason} (${keyLabel(secret)}, Absender ${client})`);
      return unauthorized(true);
    }
    console.warn(`[mcp-http] 403 ${auth.reason} (${keyLabel(secret)}, Absender ${client})`);
    return forbidden();
  }

  const label = keyLabel(secret);
  const server = createMcpServer({
    label,
    allowWrite: auth.level === "WRITE",
    authorize: (need) => authorizeAiCall(credential, need),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: auth.level === "WRITE" ? mcpWriteBodyLimit() : MCP_MAX_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    return withBaseHeaders(res);
  } catch (err) {
    console.error(`[mcp-http] Fehler (${label}):`, err);
    return jsonError(500, "Internal error.");
  } finally {
    // JSON-Modus: die Antwort ist vollständig, der Server wird nicht mehr gebraucht.
    await server.close().catch(() => {});
  }
}
