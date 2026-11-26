/**
 * Content-Security-Policy (docs/sicherheit.md, Abschnitt „Content-Security-Policy“).
 *
 * Rein (kein next/*, keine Datenbank), damit die Richtlinie direkt testbar ist
 * (tests/csp.test.ts). Angewendet:
 * - Seiten: `middleware.ts` erzeugt je Anfrage eine Nonce und setzt
 *   `pagePolicy()` als Kopfzeile — auf der Antwort für den Browser und auf
 *   der Anfrage, damit Next.js die Nonce beim Rendern an seine eigenen
 *   Skripte hängt.
 * - API: `API_POLICY` fest über `next.config.mjs`. Diese Kopfzeile ersetzt
 *   die gleichnamige eines Route-Handlers (am Build geprüft) — deshalb steht
 *   `sandbox` der Bildroute hier mit drin.
 *
 * Not-Schalter `CSP_MODE` (stack.env.example): `enforce` (Standard),
 * `report-only` (nur Meldungen in der Browser-Konsole, nichts wird blockiert)
 * oder `off` (keine Seiten-Richtlinie). Er wirkt nur auf die Seiten; die
 * API-Richtlinie steht fest im Build (next.config.mjs wird beim Build
 * ausgewertet) und kann keine Seite brechen.
 */

export type CspMode = "enforce" | "report-only" | "off";

/** Liest den Not-Schalter. Unbekannte Werte gelten als `enforce` (sicherer Fall). */
export function cspMode(value: string | undefined = process.env.CSP_MODE): CspMode {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "report-only" || v === "off") return v;
  return "enforce";
}

/** Name der Kopfzeile für den Modus (null bei `off`). */
export function cspHeaderName(mode: CspMode): string | null {
  if (mode === "off") return null;
  return mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/**
 * Ziele der Anmeldung über OAuth. Die Anmelde-Knöpfe sind Formulare mit
 * Server-Action (app/login/page.tsx); die Antwort leitet zum Anbieter weiter.
 * Mit JavaScript ist das eine gewöhnliche Navigation (kein `form-action`).
 * Wird das Formular aber vor der Hydration oder ohne JavaScript abgeschickt,
 * ist es ein echter Formular-POST mit 303 zum Anbieter — und Chromium prüft
 * auch die Ziele von Weiterleitungen gegen `form-action`. Deshalb stehen die
 * Anbieter hier (GitHub: `https://github.com/login/oauth/authorize`, Google:
 * `https://accounts.google.com/o/oauth2/v2/auth`, laut @auth/core).
 */
export const OAUTH_FORM_TARGETS = ["https://github.com", "https://accounts.google.com"] as const;

export type PagePolicyOptions = {
  /** Nonce dieser Anfrage (base64). */
  nonce: string;
  /** Entwicklungsserver (`next dev`): eval für Fehlerhilfen, WebSocket für HMR. */
  dev?: boolean;
  /** Öffentliche Adresse ist https (AUTH_URL): http-Unterressourcen hochstufen. */
  https?: boolean;
  /** Report-Only kennt `upgrade-insecure-requests` nicht (Browser warnt nur). */
  reportOnly?: boolean;
};

/**
 * Richtlinie für HTML-Seiten. Begründung je Direktive in docs/sicherheit.md.
 *
 * - Skripte nur mit Nonce dieser Antwort; was ein solches Skript nachlädt
 *   (Next.js-Chunks), erbt das Vertrauen (`'strict-dynamic'`). `'self'` ist
 *   nur Rückfall für Browser ohne `'strict-dynamic'` — moderne Browser
 *   ignorieren es dann. Kein `'unsafe-inline'`, kein `'unsafe-eval'`
 *   (außer im Dev-Server).
 * - Stile mit `'unsafe-inline'`: React gibt `style`-Attribute serverseitig
 *   als HTML aus (Baum, Karte, Balken), React Flow setzt viele Stile. Bewusst
 *   ohne Nonce in `style-src` — eine Nonce würde `'unsafe-inline'` dort
 *   wirkungslos machen.
 */
export function pagePolicy({ nonce, dev = false, https = false, reportOnly = false }: PagePolicyOptions): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(dev ? ["ws:", "wss:"] : [])]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["worker-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'", ...OAUTH_FORM_TARGETS]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https && !dev && !reportOnly) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/**
 * Richtlinie für alle Antworten unter /api: JSON, Downloads, Bilder — nichts
 * davon ist eine Seite, die Skripte, Stile oder Einbettung braucht. Sollte
 * ein Browser eine Antwort doch als Dokument anzeigen, darf sie nichts laden
 * und nicht eingebettet werden; `sandbox` behandelt sie zusätzlich als
 * fremde, skriptlose Herkunft (vorher nur an der Bildroute, die ihre eigene
 * Kopfzeile behält). `form-action 'self'` schadet nicht und hält die
 * Richtlinie gleich lesbar wie die der Seiten.
 */
export const API_POLICY = "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; sandbox";

/** Zufällige Nonce (128 Bit, base64) — Web-Crypto, läuft in Node und Edge. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Ist die öffentliche Adresse https? */
export function isHttpsUrl(url: string | undefined = process.env.AUTH_URL): boolean {
  return typeof url === "string" && /^https:\/\//i.test(url.trim());
}
