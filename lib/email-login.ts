import type { Adapter, VerificationToken } from "next-auth/adapters";

import { isMockDatabase, isMockMediaDir } from "./dev-login";
import { RateLimiter, type RateRule } from "./rate-limit";
import { isCrossSiteWrite } from "./request-guard";

/**
 * Anmeldung per E-Mail-Link (Auth.js, Anbieter „nodemailer“) — die reinen
 * Regeln, ohne next/*, Datenbank oder Mailversand, damit sie direkt testbar
 * sind. Den Anbieter richtet lib/auth.ts ein, den Versand
 * lib/email-login-mail.ts, das Anfordern app/login/actions.ts.
 *
 * Grundsätze:
 * - Nur auf Einladung: Eine Mail geht nur an Adressen aus der Benutzerliste,
 *   die nicht gesperrt sind (`requestEmailLink`, zusätzlich der
 *   signIn-Callback in lib/auth.ts).
 * - Keine Auskunft über Konten: Wer einen Link anfordert, bekommt immer
 *   dieselbe Antwort, frühestens nach `MIN_RESPONSE_MS` (plus Zufall) — egal
 *   ob die Adresse bekannt, gesperrt, gedrosselt oder ungültig ist. Der
 *   eigentliche SMTP-Versand läuft im Hintergrund, damit seine Dauer nichts
 *   verrät.
 * - Der Link in der Mail führt auf eine Bestätigungsseite (/login/email) mit
 *   Knopf „Jetzt anmelden“ (POST). Mail-Programme, die Links vorab abrufen,
 *   verbrauchen ihn so nicht.
 */

/** Umgebungsvariablen (in Tests austauschbar). */
export type Env = Record<string, string | undefined>;

/** Gültigkeit eines Anmeldelinks. */
export const EMAIL_LINK_MAX_AGE_SECONDS = 15 * 60;
export const EMAIL_LINK_MINUTES = EMAIL_LINK_MAX_AGE_SECONDS / 60;

/** Kennung des Auth.js-Anbieters (Pfad /api/auth/callback/<id>). */
export const EMAIL_PROVIDER_ID = "nodemailer";

/** Wohin nach erfolgreicher Anmeldung: die Startseite „Heute in der Familie“. */
export const EMAIL_LOGIN_REDIRECT = "/";

// ---------------------------------------------------------------------------
// Einrichtung
// ---------------------------------------------------------------------------

export type SmtpSettings = {
  host: string;
  port: number;
  /** TLS von Anfang an (Port 465); sonst STARTTLS, sofern der Server es anbietet. */
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

/**
 * SMTP-Zugang aus den Umgebungsvariablen des Stacks — nur vollständig:
 * `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` und `SMTP_FROM` müssen gesetzt
 * sein. `SMTP_PORT` (Standard 587) und `SMTP_SECURE` (Standard: an bei Port
 * 465) sind optional. Unvollständig oder ungültig → `null`, dann gibt es den
 * E-Mail-Link nicht.
 */
export function smtpSettings(env: Env = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD ?? "";
  const from = env.SMTP_FROM?.trim();
  if (!host || !user || !password || !from) return null;
  const rawPort = env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase();
  const secure = rawSecure ? rawSecure === "true" : port === 465;
  return { host, port, secure, user, password, from };
}

/**
 * Darf der Test-Briefkasten (Mail als Datei statt Versand) benutzt werden?
 * Eng begrenzt wie der Dev-Login im Produktions-Build (lib/dev-login.ts),
 * hier sogar unabhängig von NODE_ENV — ALLE drei Bedingungen:
 *   1. `MAIL_TEST_OUTBOX=mock-only` (setzt nur scripts/mock.mjs),
 *   2. Datenbank aus `DATABASE_URL` endet auf `_mock` oder `_test`,
 *   3. Medienordner `MEDIA_DIR` endet auf `-mock` oder `-test`.
 * Der Produktivstack hat weder die Variable noch solche Namen.
 */
export function mailTestOutboxAllowed(env: Env = process.env): boolean {
  if (env.MAIL_TEST_OUTBOX !== "mock-only") return false;
  return isMockDatabase(env.DATABASE_URL) && isMockMediaDir(env.MEDIA_DIR);
}

/**
 * Öffentliche Adresse der App (`AUTH_URL`, nur Schema, Rechner und Port).
 * Darauf baut der Link in der Mail auf — nie auf dem Host-Header der Anfrage.
 */
export function publicBaseUrl(env: Env = process.env): URL | null {
  const raw = env.AUTH_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

export type EmailLoginMode = "smtp" | "outbox";

/**
 * Wie werden Anmeldelinks zugestellt? `null` = E-Mail-Anmeldung aus (kein
 * Feld auf der Anmeldeseite, kein Anbieter). Ist der Test-Briefkasten
 * erlaubt, hat er Vorrang — in der Mock-Umgebung geht nie eine echte Mail
 * hinaus.
 */
export function emailLoginMode(env: Env = process.env): EmailLoginMode | null {
  if (!publicBaseUrl(env)) return null;
  if (mailTestOutboxAllowed(env)) return "outbox";
  if (smtpSettings(env)) return "smtp";
  return null;
}

// ---------------------------------------------------------------------------
// Adresse und Absender
// ---------------------------------------------------------------------------

const ADDRESS_PART = /^[^\s@",;:<>()[\]\\]+$/;

/**
 * Eingegebene Adresse vereinheitlichen: getrimmt, klein geschrieben, genau
 * ein „@“, keine Anführungszeichen, Leerzeichen oder Listen-Trenner (wie die
 * Vorgabe von Auth.js, nur strenger). Ungültig → `null`. Dient auch als
 * `normalizeIdentifier` des Anbieters, damit Anfordern und Einlösen dieselbe
 * Form benutzen.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain || !ADDRESS_PART.test(local) || !ADDRESS_PART.test(domain)) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return email;
}

/**
 * Absender für die Drosselung: der LETZTE Eintrag in X-Forwarded-For — dieselbe
 * Regel wie beim KI-Zugang (`clientAddress` in mcp/http.ts): den hängt der
 * eigene Reverse-Proxy an, alles davor kann der Client selbst mitschicken.
 */
export function clientAddressFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || "unbekannt";
}

// ---------------------------------------------------------------------------
// Drosselung
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

/**
 * Höchstens 3 Anforderungen je Adresse in 15 Minuten und 10 je Absender in
 * der Stunde. Bewusst IMMER aktiv, auch bei `RATE_LIMIT=off` (E2E-Umgebung):
 * Die Grenze schützt fremde Postfächer und den Ruf des eigenen SMTP-Kontos,
 * nicht die Last der App. Gezählt wird jede Anforderung — auch für unbekannte
 * Adressen —, sonst verriete die Drosselung, welche Adressen es gibt.
 */
export const MAIL_RULES = {
  address: { limit: 3, windowMs: 15 * MINUTE },
  ip: { limit: 10, windowMs: 60 * MINUTE },
} as const satisfies Record<string, RateRule>;

const mailLimiter = new RateLimiter();

/** Zählt eine Anforderung; `true`, wenn sie noch erlaubt ist. */
export function checkMailRate(email: string, ip: string, now = Date.now()): boolean {
  const byIp = mailLimiter.hit(`ip:${ip}`, MAIL_RULES.ip, now);
  const byAddress = mailLimiter.hit(`address:${email}`, MAIL_RULES.address, now);
  return byIp.ok && byAddress.ok;
}

/** Nur für Tests. */
export function resetMailRateLimit(): void {
  mailLimiter.reset();
}

// ---------------------------------------------------------------------------
// Link anfordern
// ---------------------------------------------------------------------------

/** Mindestdauer der Antwort auf „Link zusenden“, dazu bis zu `RESPONSE_JITTER_MS` Zufall. */
export const MIN_RESPONSE_MS = 800;
export const RESPONSE_JITTER_MS = 200;

export type LinkRequestDeps = {
  /** Benutzer zur (vereinheitlichten) Adresse, sonst null. */
  findUser: (email: string) => Promise<{ status: string } | null>;
  /** Startet den Auth.js-Ablauf (Token anlegen, Mail zustellen). */
  sendLink: (email: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (message: string) => void;
};

export type LinkRequestOutcome = "sent" | "invalid" | "throttled" | "unknown" | "blocked" | "failed";

/**
 * Bearbeitet „Link zusenden“. Das Ergebnis ist nur für Tests und das
 * Server-Protokoll — der Aufrufer zeigt IMMER dieselbe Antwort.
 */
export async function requestEmailLink(rawEmail: unknown, ip: string, deps: LinkRequestDeps): Promise<LinkRequestOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const started = now();
  let outcome: LinkRequestOutcome;
  try {
    outcome = await decide();
  } catch (error) {
    deps.log?.(`[email-login] Anfordern fehlgeschlagen: ${(error as Error)?.message ?? String(error)}`);
    outcome = "failed";
  }
  const wait = Math.max(0, started + MIN_RESPONSE_MS - now()) + Math.floor(random() * RESPONSE_JITTER_MS);
  if (wait > 0) await sleep(wait);
  return outcome;

  async function decide(): Promise<LinkRequestOutcome> {
    const email = normalizeEmail(rawEmail);
    if (!email) return "invalid";
    if (!checkMailRate(email, ip, now())) return "throttled";
    const user = await deps.findUser(email);
    if (!user) return "unknown";
    if (user.status === "BLOCKED") return "blocked";
    await deps.sendLink(email);
    return "sent";
  }
}

// ---------------------------------------------------------------------------
// Link und Bestätigungsseite
// ---------------------------------------------------------------------------

/** Pfad der Bestätigungsseite, auf die der Link in der Mail zeigt. */
export const CONFIRM_PATH = "/login/email";

/**
 * Link für die Mail: Token und Adresse aus der Auth.js-Adresse übernehmen,
 * aber auf die Bestätigungsseite unter der öffentlichen Adresse zeigen.
 */
export function confirmationUrl(authJsUrl: string, base: URL): string {
  const source = new URL(authJsUrl);
  const url = new URL(CONFIRM_PATH, base);
  url.searchParams.set("token", source.searchParams.get("token") ?? "");
  url.searchParams.set("email", source.searchParams.get("email") ?? "");
  return url.toString();
}

/** Passen Token und Adresse aus dem Link überhaupt zusammen (Form, nicht Gültigkeit)? */
export function plausibleLinkParams(token: unknown, email: unknown): token is string {
  return (
    typeof token === "string" &&
    /^[A-Za-z0-9_-]{16,200}$/.test(token) &&
    typeof email === "string" &&
    normalizeEmail(email) === email
  );
}

/** Ziel des Knopfs „Jetzt anmelden“ (POST an Auth.js, löst den Link ein). */
export function callbackActionPath(token: string, email: string): string {
  const params = new URLSearchParams({ token, email, callbackUrl: EMAIL_LOGIN_REDIRECT });
  return `/api/auth/callback/${EMAIL_PROVIDER_ID}?${params}`;
}

export type AuthRouteDecision =
  | { kind: "pass" }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "confirm"; path: string };

/**
 * Vorprüfung der Auth.js-Route (app/api/auth/[...nextauth]/route.ts) für den
 * E-Mail-Anbieter:
 * - `POST …/signin/nodemailer` von außen: gesperrt. Angefordert wird nur über
 *   die Anmeldeseite (Server-Aktion, ruft Auth.js direkt auf), die Drosselung
 *   und gleiche Antwort sicherstellt.
 * - `GET …/callback/nodemailer` (alte oder abgetippte Links): löst nichts ein,
 *   sondern leitet auf die Bestätigungsseite.
 * - `POST …/callback/nodemailer` von einer fremden Webseite: abgelehnt
 *   (Anmelde-CSRF).
 */
export function authRouteDecision(req: { method: string; headers: Headers }, pathname: string): AuthRouteDecision {
  const method = req.method.toUpperCase();
  const path = pathname.replace(/\/+$/, "");
  if (path.endsWith(`/signin/${EMAIL_PROVIDER_ID}`) && method === "POST") return { kind: "not-found" };
  if (path.endsWith(`/callback/${EMAIL_PROVIDER_ID}`)) {
    if (method === "GET" || method === "HEAD") return { kind: "confirm", path: CONFIRM_PATH };
    if (isCrossSiteWrite(req)) return { kind: "forbidden" };
  }
  return { kind: "pass" };
}

/**
 * Adapter mit Aufräumen der Anmeldelinks: Vor jedem neuen Link werden ältere
 * Links derselben Adresse (es gilt nur der neueste) und alle abgelaufenen
 * gelöscht (`cleanup`). Eingelöste löscht Auth.js selbst
 * (`useVerificationToken`).
 */
export function withTokenCleanup<A extends Adapter>(
  base: A,
  cleanup: (identifier: string, now: Date) => Promise<void>,
): A {
  if (!base.createVerificationToken) return base;
  const create = base.createVerificationToken.bind(base);
  return {
    ...base,
    async createVerificationToken(data: VerificationToken) {
      await cleanup(data.identifier, new Date());
      return create(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Mailtext
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type LoginMail = { subject: string; text: string; html: string };

/** Deutscher Mailtext: Klartext und schlichtes HTML ohne externe Inhalte. */
export function loginMail(url: string, minutes = EMAIL_LINK_MINUTES): LoginMail {
  const subject = "Dein Anmeldelink für den Stammbaum";
  const text = [
    "Hallo,",
    "",
    "mit diesem Link meldest du dich beim Stammbaum an:",
    "",
    url,
    "",
    `Der Link gilt ${minutes} Minuten und nur einmal. Öffne ihn und tippe dann auf „Jetzt anmelden“.`,
    "",
    "Wenn du das nicht warst, ignoriere diese Mail. Ohne den Link kann sich niemand anmelden.",
    "",
  ].join("\n");
  const href = escapeHtml(url);
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#292524;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
<p style="margin:0 0 16px;">Hallo,</p>
<p style="margin:0 0 16px;">mit diesem Link meldest du dich beim Stammbaum an:</p>
<p style="margin:0 0 16px;"><a href="${href}" style="display:inline-block;background:#1f5135;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;">Zur Anmeldung</a></p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all;">Falls der Knopf nicht geht, kopiere diese Adresse in den Browser:<br>${href}</p>
<p style="margin:0 0 16px;">Der Link gilt ${minutes} Minuten und nur einmal. Öffne ihn und tippe dann auf „Jetzt anmelden“.</p>
<p style="margin:0;color:#57534e;">Wenn du das nicht warst, ignoriere diese Mail. Ohne den Link kann sich niemand anmelden.</p>
</div>
</body></html>
`;
  return { subject, text, html };
}
