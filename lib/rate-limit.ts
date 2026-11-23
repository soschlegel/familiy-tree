/**
 * Einfache Drosselung im Speicher des Prozesses (festes Zeitfenster je
 * Schlüssel). Bewusst ohne Datenbank oder Redis: die App läuft als EIN
 * Container. Grenzen: gilt nur für diesen Prozess und ist nach einem Neustart
 * leer. Sie schützt vor versehentlichen Schleifen und einfachem Missbrauch
 * durch angemeldete Benutzer bzw. gültige KI-Schlüssel — die Abwehr von
 * Massenanfragen Unbekannter gehört in den Reverse-Proxy.
 *
 * Rein (kein next/*, keine Datenbank), damit sie direkt testbar ist.
 */

export type RateRule = { limit: number; windowMs: number };
export type RateResult = { ok: true } | { ok: false; retryAfter: number };

type Entry = { count: number; resetAt: number };

/** Obergrenze der gemerkten Schlüssel, damit die Tabelle nicht unbegrenzt wächst. */
const MAX_TRACKED = 20_000;

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();

  /** Zählt einen Zugriff. Liefert, ob er noch erlaubt ist. */
  hit(key: string, rule: RateRule, now = Date.now()): RateResult {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.entries.size >= MAX_TRACKED) this.prune(now);
      this.entries.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { ok: true };
    }
    entry.count += 1;
    if (entry.count > rule.limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
    // Notbremse: älteste zuerst (Map behält die Einfügereihenfolge).
    while (this.entries.size >= MAX_TRACKED) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Nur für Tests. */
  reset(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Abschalten (z.B. für Lasttests) mit RATE_LIMIT=off; Standard: an. */
export function rateLimitEnabled(): boolean {
  return (process.env.RATE_LIMIT ?? "").trim().toLowerCase() !== "off";
}

const MINUTE = 60_000;

/**
 * Regeln der Web-API je angemeldetem Benutzer. Großzügig bemessen: normale
 * Bedienung (auch mehrere Fenster) erreicht sie nicht.
 *
 * - `export`: baut den ganzen sichtbaren Bestand (bei ZIP samt Bildern) im
 *   Speicher.
 * - `heavy`: lädt den ganzen Graphen bzw. rechnet über alle Personen
 *   (Dubletten, Baum, Karte, Importe verbinden, Sammel-Zusammenführen).
 * - `upload`: Bild-Uploads und Importdateien.
 * - `write`: alle übrigen schreibenden Anfragen.
 * - `read`: alle übrigen lesenden Anfragen (u.a. Ortsvorschlag beim Tippen,
 *   Bilder einer Seite).
 */
export const API_RULES = {
  export: { limit: 10, windowMs: MINUTE },
  heavy: { limit: 90, windowMs: MINUTE },
  upload: { limit: 120, windowMs: MINUTE },
  write: { limit: 600, windowMs: MINUTE },
  read: { limit: 3000, windowMs: MINUTE },
} as const satisfies Record<string, RateRule>;

export type ApiBucket = keyof typeof API_RULES;

const HEAVY_PATHS = [
  "/api/duplicates",
  "/api/tree",
  "/api/map",
  "/api/connect",
  "/api/persons/merge",
  "/api/places/auto",
  "/api/origin",
];

/** Ordnet eine Anfrage einer Regel zu. */
export function apiBucket(method: string, pathname: string): ApiBucket {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  if (pathname === "/api/export") return "export";
  if (!read && (pathname === "/api/media" || pathname === "/api/import" || pathname === "/api/import/gedcom")) return "upload";
  // Dubletten einer Person: vergleicht mit allen bearbeitbaren Personen.
  if (/^\/api\/persons\/[^/]+\/duplicates$/.test(pathname)) return "heavy";
  if (HEAVY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // „kein Duplikat“ ist ein gewöhnlicher Schreibvorgang.
    if (pathname === "/api/duplicates/dismiss") return "write";
    return "heavy";
  }
  return read ? "read" : "write";
}

const apiLimiter = new RateLimiter();

/** Zählt eine Anfrage der Web-API für einen Benutzer. */
export function checkApiRate(userId: string, method: string, pathname: string, now = Date.now()): RateResult {
  if (!rateLimitEnabled()) return { ok: true };
  const bucket = apiBucket(method, pathname);
  return apiLimiter.hit(`${bucket}:${userId}`, API_RULES[bucket], now);
}

/**
 * KI-Zugang (MCP über HTTP): Anfragen je Schlüssel, gezählt nach erfolgreicher
 * Anmeldung (Fehlversuche begrenzt mcp/http.ts getrennt je Absender). Eine
 * Anfrage ist ein Werkzeugaufruf oder eine Liste; ein Assistent braucht im
 * Gespräch selten mehr als einige Dutzend je Minute.
 */
export const MCP_RULE: RateRule = { limit: 300, windowMs: MINUTE };

const mcpLimiter = new RateLimiter();

/** Zählt eine angemeldete MCP-Anfrage für einen Schlüssel (bzw. Benutzer). */
export function checkMcpRate(key: string, now = Date.now()): RateResult {
  if (!rateLimitEnabled()) return { ok: true };
  return mcpLimiter.hit(`mcp:${key}`, MCP_RULE, now);
}

/** Nur für Tests. */
export function resetApiRateLimit(): void {
  apiLimiter.reset();
  mcpLimiter.reset();
}
