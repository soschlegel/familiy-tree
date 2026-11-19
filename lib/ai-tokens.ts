import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Format und Hash der KI-Zugangsschlüssel (ApiToken). Bewusst ohne Prisma und
 * ohne next/* — auch der Mock-Seed nutzt diese Funktionen.
 *
 * Format: ftk_<12 Hex-Zeichen>_<43 Zeichen base64url>
 *   - "ftk_" macht durchgesickerte Schlüssel per grep/Secret-Scanner auffindbar.
 *   - Die 12 Hex-Zeichen sind die öffentliche Kennung (gespeichert als
 *     `prefix` samt "ftk_"): sie erscheint in Listen und dient zum Nachschlagen.
 *   - Der Rest sind 32 Zufallsbytes (256 Bit) — das eigentliche Geheimnis.
 *
 * Hash: SHA-256 über den vollständigen Schlüssel. Ein langsamer Passwort-KDF
 * (bcrypt, scrypt, Argon2) schützt niedrig-entropische Passwörter gegen
 * Wörterbuchangriffe nach einem Datenbankleck. Bei 256 Bit Zufall gibt es kein
 * Wörterbuch; Durchprobieren ist mit jedem Hash aussichtslos. Ein KDF kostete
 * dagegen bei JEDEM MCP-Aufruf ~100 ms Rechenzeit und wäre eine bequeme
 * Hebelstelle für Lastangriffe. Der Vergleich läuft trotzdem in konstanter
 * Zeit (timingSafeEqual).
 */
export const TOKEN_PREFIX = "ftk_";

const TOKEN_PATTERN = /^ftk_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export type GeneratedToken = {
  /** Vollständiger Schlüssel — wird genau einmal angezeigt, nie gespeichert. */
  secret: string;
  /** Öffentlicher Anfang, z.B. "ftk_3fa9c1d2e4b5". */
  prefix: string;
  /** SHA-256 (hex) des vollständigen Schlüssels. */
  secretHash: string;
};

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Prüft das Format und liefert den öffentlichen Anfang (oder null). */
export function tokenPrefixOf(secret: string): string | null {
  const m = TOKEN_PATTERN.exec(secret.trim());
  return m ? `${TOKEN_PREFIX}${m[1]}` : null;
}

export function generateToken(): GeneratedToken {
  const id = randomBytes(6).toString("hex");
  const secret = `${TOKEN_PREFIX}${id}_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: `${TOKEN_PREFIX}${id}`, secretHash: hashToken(secret) };
}

/** Vergleicht den Hash eines vorgelegten Schlüssels in konstanter Zeit. */
export function tokenMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(secret.trim()), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
