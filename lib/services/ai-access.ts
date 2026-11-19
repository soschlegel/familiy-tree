import type { AiAccess, ApiTokenKind, ApiTokenLevel, Role } from "@prisma/client";

import { prisma } from "../prisma";
import { audit, auditActor } from "../audit";
import { generateToken, tokenMatches, tokenPrefixOf } from "../ai-tokens";
import { loadScope, type Scope } from "../scope";
import {
  aiAccessInput,
  apiTokenCreateInput,
  API_TOKEN_DEFAULT_DAYS,
  API_TOKEN_MAX_DAYS,
  MAX_ACTIVE_API_TOKENS,
} from "../validation";
import { conflictError, forbiddenError, notFoundError, parseOrThrow, ServiceError } from "./errors";
import { iso } from "./dto";

/**
 * KI-Zugang (MCP): Benutzerrecht, persönliche Schlüssel und die Prüfung pro
 * Werkzeugaufruf.
 *
 * Zwei Ebenen, die beide gelten müssen:
 * 1. KI-Stufe — User.aiAccess (NONE/READ/WRITE, nur vom Admin vergeben; auch
 *    die Rolle ADMIN schließt sie NICHT ein) und die Stufe des Schlüssels.
 *    Wirksam ist das Minimum, bei JEDER Prüfung neu berechnet: Herabsetzen
 *    oder Entziehen wirkt sofort auf alle vorhandenen Schlüssel.
 * 2. Familienrechte — der Scope aus lib/scope.ts, unverändert. Ein
 *    Schlüssel mit WRITE erlaubt also nie das Schreiben in einer Familie, in
 *    der der Benutzer nur Betrachter ist.
 *
 * Schlüssel verwalten (anlegen, widerrufen, Rechte setzen) geht nur über die
 * Web-App, nie über den KI-Kanal selbst.
 */

export type AiLevel = "READ" | "WRITE";

/** Zeitspanne, innerhalb der lastUsedAt nicht erneut geschrieben wird. */
export const API_TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const RANK: Record<AiAccess | ApiTokenLevel, number> = { NONE: 0, READ: 1, WRITE: 2 };

/** Wirksame Stufe: min(Schlüssel, Benutzerrecht); null = kein Zugang. */
export function effectiveAiLevel(
  tokenLevel: ApiTokenLevel | AiAccess,
  userAccess: AiAccess,
): AiLevel | null {
  const rank = Math.min(RANK[tokenLevel], RANK[userAccess]);
  return rank === 2 ? "WRITE" : rank === 1 ? "READ" : null;
}

export function aiLevelSatisfies(level: AiLevel, need: AiLevel): boolean {
  return RANK[level] >= RANK[need];
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ApiTokenStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

/** Schlüssel ohne Geheimnis — für Listen. */
export type ApiTokenDto = {
  id: string;
  userId: string;
  name: string;
  /** Öffentlicher Anfang, z.B. "ftk_3fa9c1d2e4b5" — zum Wiedererkennen. */
  prefix: string;
  level: ApiTokenLevel;
  kind: ApiTokenKind;
  status: ApiTokenStatus;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** Für die Admin-Übersicht zusätzlich der Besitzer. */
export type ApiTokenAdminDto = ApiTokenDto & {
  user: { id: string; email: string; name: string | null; aiAccess: AiAccess };
};

export type CreatedApiToken = {
  token: ApiTokenDto;
  /** Vollständiger Schlüssel — nur in dieser Antwort, danach nie wieder. */
  secret: string;
};

export type AiAccessInfo = {
  aiAccess: AiAccess;
  activeTokens: number;
  maxActiveTokens: number;
  defaultExpiryDays: number;
  maxExpiryDays: number;
};

const TOKEN_SELECT = {
  id: true,
  userId: true,
  name: true,
  prefix: true,
  level: true,
  kind: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

type TokenRow = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  level: ApiTokenLevel;
  kind: ApiTokenKind;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

function tokenStatus(t: Pick<TokenRow, "revokedAt" | "expiresAt">, now = new Date()): ApiTokenStatus {
  if (t.revokedAt) return "REVOKED";
  if (t.expiresAt && t.expiresAt <= now) return "EXPIRED";
  return "ACTIVE";
}

function toTokenDto(t: TokenRow, now = new Date()): ApiTokenDto {
  return {
    id: t.id,
    userId: t.userId,
    name: t.name,
    prefix: t.prefix,
    level: t.level,
    kind: t.kind,
    status: tokenStatus(t, now),
    createdAt: iso(t.createdAt)!,
    lastUsedAt: iso(t.lastUsedAt),
    expiresAt: iso(t.expiresAt),
    revokedAt: iso(t.revokedAt),
  };
}

/** Aktiv = nicht widerrufen und (ohne Ablauf oder) noch nicht abgelaufen. */
function activeWhere(now: Date) {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/** Verwaltung nur über die Web-App — nie über den KI-Kanal selbst. */
function assertWebChannel(scope: Scope): void {
  if (scope.via) throw forbiddenError("KI-Zugang über den KI-Kanal zu verwalten");
}

function assertAdmin(scope: Scope, what: string): void {
  assertWebChannel(scope);
  if (!scope.isAdmin) throw forbiddenError(what);
}

// ---------------------------------------------------------------------------
// Benutzer: eigenes Recht und eigene Schlüssel
// ---------------------------------------------------------------------------

/** Eigenes KI-Recht samt Grenzen — für die Schlüsselverwaltung. */
export async function getAiAccessInfo(scope: Scope): Promise<AiAccessInfo> {
  const now = new Date();
  const [user, activeTokens] = await Promise.all([
    prisma.user.findUnique({ where: { id: scope.userId }, select: { aiAccess: true } }),
    prisma.apiToken.count({ where: { userId: scope.userId, ...activeWhere(now) } }),
  ]);
  if (!user) throw notFoundError("Benutzer");
  return {
    aiAccess: user.aiAccess,
    activeTokens,
    maxActiveTokens: MAX_ACTIVE_API_TOKENS,
    defaultExpiryDays: API_TOKEN_DEFAULT_DAYS,
    maxExpiryDays: API_TOKEN_MAX_DAYS,
  };
}

/**
 * Neuer Schlüssel für den angemeldeten Benutzer. Die Stufe darf das eigene
 * KI-Recht nicht übersteigen; ohne Angabe läuft er nach
 * API_TOKEN_DEFAULT_DAYS Tagen ab, höchstens nach API_TOKEN_MAX_DAYS.
 * Das Geheimnis steht nur im Ergebnis dieses Aufrufs.
 */
export async function createApiToken(scope: Scope, input: unknown): Promise<CreatedApiToken> {
  assertWebChannel(scope);
  const data = parseOrThrow(apiTokenCreateInput.safeParse(input));

  const user = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: { aiAccess: true, status: true },
  });
  if (!user || user.status === "BLOCKED") throw notFoundError("Benutzer");
  if (user.aiAccess === "NONE") throw forbiddenError("KI-Zugang (nicht freigeschaltet)");
  if (RANK[data.level] > RANK[user.aiAccess]) {
    throw forbiddenError("einen Schlüssel mit Schreibrecht (eigenes KI-Recht: nur lesen)");
  }

  const now = new Date();
  const active = await prisma.apiToken.count({ where: { userId: scope.userId, ...activeWhere(now) } });
  if (active >= MAX_ACTIVE_API_TOKENS) {
    throw conflictError(
      `Höchstens ${MAX_ACTIVE_API_TOKENS} aktive Schlüssel — bitte zuerst einen nicht mehr benötigten widerrufen.`,
      { maxActiveTokens: MAX_ACTIVE_API_TOKENS },
    );
  }

  const days = data.expiresInDays ?? API_TOKEN_DEFAULT_DAYS;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const generated = generateToken();

  const row = await prisma.apiToken.create({
    data: {
      userId: scope.userId,
      name: data.name,
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      level: data.level,
      kind: "PERSONAL",
      expiresAt,
    },
    select: TOKEN_SELECT,
  });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "ApiToken",
    entityId: row.id,
    diff: { name: row.name, prefix: row.prefix, level: row.level, expiresAt: iso(row.expiresAt) },
  });

  return { token: toTokenDto(row, now), secret: generated.secret };
}

/** Eigene Schlüssel, neueste zuerst — ohne Geheimnis und ohne Hash. */
export async function listApiTokens(scope: Scope): Promise<ApiTokenDto[]> {
  const rows = await prisma.apiToken.findMany({
    where: { userId: scope.userId },
    select: TOKEN_SELECT,
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return rows.map((r) => toTokenDto(r, now));
}

/**
 * Widerruft einen Schlüssel: eigene immer, fremde nur als Admin. Fremde
 * Schlüssel erscheinen für Nicht-Admins als NOT_FOUND. Wiederholtes Widerrufen
 * ist unschädlich und ändert nichts.
 */
export async function revokeApiToken(scope: Scope, tokenId: string): Promise<ApiTokenDto> {
  assertWebChannel(scope);
  const row = await prisma.apiToken.findUnique({ where: { id: tokenId }, select: TOKEN_SELECT });
  if (!row || (row.userId !== scope.userId && !scope.isAdmin)) throw notFoundError("Schlüssel");
  if (row.revokedAt) return toTokenDto(row);

  const updated = await prisma.apiToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
    select: TOKEN_SELECT,
  });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "ApiToken",
    entityId: tokenId,
    diff: {
      revoked: true,
      prefix: row.prefix,
      ...(row.userId !== scope.userId ? { ownerId: row.userId } : {}),
    },
  });
  return toTokenDto(updated);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * Setzt das KI-Recht eines Benutzers (auch des eigenen — ein Admin muss es
 * sich ausdrücklich selbst geben). Vorhandene Schlüssel bleiben unverändert;
 * ihre wirksame Stufe wird bei jeder Prüfung auf das neue Recht begrenzt.
 */
export async function setUserAiAccess(
  scope: Scope,
  userId: string,
  input: unknown,
): Promise<{ id: string; aiAccess: AiAccess }> {
  assertAdmin(scope, "KI-Zugang zu vergeben");
  const { aiAccess } = parseOrThrow(aiAccessInput.safeParse(input));

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { aiAccess: true } });
  if (!target) throw notFoundError("Benutzer");
  if (target.aiAccess === aiAccess) return { id: userId, aiAccess };

  const user = await prisma.user.update({
    where: { id: userId },
    data: { aiAccess },
    select: { id: true, aiAccess: true },
  });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "User",
    entityId: userId,
    diff: { aiAccess: { from: target.aiAccess, to: aiAccess } },
  });
  return user;
}

/** Alle Schlüssel (optional eines Benutzers) — nur für Admins. */
export async function listAllApiTokens(
  scope: Scope,
  filter: { userId?: string } = {},
): Promise<ApiTokenAdminDto[]> {
  assertAdmin(scope, "Schlüssel anderer Benutzer einzusehen");
  const rows = await prisma.apiToken.findMany({
    where: filter.userId ? { userId: filter.userId } : {},
    select: { ...TOKEN_SELECT, user: { select: { id: true, email: true, name: true, aiAccess: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
  const now = new Date();
  return rows.map(({ user, ...r }) => ({ ...toTokenDto(r, now), user }));
}

// ---------------------------------------------------------------------------
// Prüfung für den MCP-Endpunkt
// ---------------------------------------------------------------------------

export type AiAuthFailureReason =
  /** Kein Schlüssel im erwarteten Format (ftk_…). */
  | "MALFORMED"
  /** Format stimmt, aber kein solcher Schlüssel (oder Geheimnis falsch). */
  | "UNKNOWN"
  | "REVOKED"
  | "EXPIRED"
  /** Benutzer existiert nicht (mehr). */
  | "USER_UNKNOWN"
  | "USER_BLOCKED"
  /** Benutzer hat (inzwischen) kein KI-Recht. */
  | "NO_PERMISSION"
  /** Zugang gültig, aber die wirksame Stufe reicht für diesen Aufruf nicht. */
  | "INSUFFICIENT_LEVEL";

/** Deutsche Meldungen zu den Gründen — für Fehlerantworten und Logs. */
export const AI_AUTH_FAILURE_MESSAGE: Record<AiAuthFailureReason, string> = {
  MALFORMED: "Kein gültiger Zugangsschlüssel angegeben.",
  UNKNOWN: "Zugangsschlüssel unbekannt.",
  REVOKED: "Zugangsschlüssel wurde widerrufen.",
  EXPIRED: "Zugangsschlüssel ist abgelaufen.",
  USER_UNKNOWN: "Der Benutzer zu diesem Zugang existiert nicht.",
  USER_BLOCKED: "Der Benutzer zu diesem Zugang ist gesperrt.",
  NO_PERMISSION: "Für diesen Benutzer ist kein KI-Zugang freigeschaltet.",
  INSUFFICIENT_LEVEL: "Dieser Zugang erlaubt nur Lesen — Schreibwerkzeuge sind gesperrt.",
};

export type AiAuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  aiAccess: AiAccess;
};

export type AiAuthSuccess = {
  ok: true;
  user: AiAuthUser;
  /** Scope wie in der Web-App, plus `via` (Kanal, Schlüssel, Stufe) fürs Audit. */
  scope: Scope & { via: NonNullable<Scope["via"]> };
  /** Wirksame Stufe = min(Schlüssel, aktuelles Benutzerrecht). */
  level: AiLevel;
  /** ApiToken.id; null im lokalen Entwicklungsmodus ohne Schlüssel. */
  keyId: string | null;
};

export type AiAuthFailure = { ok: false; reason: AiAuthFailureReason; message: string };

export type AiAuthResult = AiAuthSuccess | AiAuthFailure;

function failure(reason: AiAuthFailureReason): AiAuthFailure {
  return { ok: false, reason, message: AI_AUTH_FAILURE_MESSAGE[reason] };
}

const USER_SELECT = { id: true, email: true, name: true, role: true, status: true, aiAccess: true } as const;

async function success(
  user: AiAuthUser,
  level: AiLevel,
  keyId: string | null,
): Promise<AiAuthSuccess> {
  const base = await loadScope(user.id, user.role);
  const scope = { ...base, via: { channel: "MCP" as const, tokenId: keyId, level } };
  return { ok: true, user, scope, level, keyId };
}

/**
 * Prüft einen vorgelegten Schlüssel. Reihenfolge der Gründe: Format →
 * unbekannt → widerrufen → abgelaufen → Benutzer → KI-Recht. Gesperrt
 * schlägt jedes Recht.
 *
 * lastUsedAt wird höchstens alle API_TOKEN_TOUCH_INTERVAL_MS geschrieben,
 * damit nicht jeder lesende Aufruf zum Schreibzugriff wird.
 */
export async function verifyApiToken(secret: string, now = new Date()): Promise<AiAuthResult> {
  const prefix = tokenPrefixOf(secret ?? "");
  if (!prefix) return failure("MALFORMED");

  const row = await prisma.apiToken.findUnique({
    where: { prefix },
    select: {
      id: true,
      secretHash: true,
      level: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: USER_SELECT },
    },
  });
  // Geheimnis in konstanter Zeit vergleichen; ein falsches Geheimnis zu
  // einem existierenden Präfix ist dasselbe wie ein unbekannter Schlüssel.
  if (!row || !tokenMatches(secret, row.secretHash)) return failure("UNKNOWN");
  if (row.revokedAt) return failure("REVOKED");
  if (row.expiresAt && row.expiresAt <= now) return failure("EXPIRED");

  const { status, ...user } = row.user;
  if (status === "BLOCKED") return failure("USER_BLOCKED");

  const level = effectiveAiLevel(row.level, user.aiAccess);
  if (!level) return failure("NO_PERMISSION");

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= API_TOKEN_TOUCH_INTERVAL_MS) {
    // Bedingt, damit parallele Aufrufe nicht mehrfach schreiben; Fehler hier
    // dürfen den Aufruf nicht scheitern lassen.
    await prisma.apiToken
      .updateMany({
        where: {
          id: row.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - API_TOKEN_TOUCH_INTERVAL_MS) } }],
        },
        data: { lastUsedAt: now },
      })
      .catch((err) => console.error("[ai-access] lastUsedAt nicht aktualisiert:", err));
  }

  return success(user, level, row.id);
}

/**
 * Zugangsdaten eines MCP-Aufrufers:
 * - token: Schlüssel aus dem Authorization-Header (HTTP-Endpunkt).
 * - dev:   lokaler stdio-Modus (nur Mock-/Testdatenbanken, mcp/server.ts) —
 *          Benutzer per E-Mail, zusätzlich begrenzt durch MCP_ALLOW_WRITE.
 */
export type AiCredential =
  | { kind: "token"; secret: string }
  | { kind: "dev"; email: string; allowWrite: boolean };

async function resolveDev(email: string, allowWrite: boolean): Promise<AiAuthResult> {
  const row = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: USER_SELECT,
  });
  if (!row) return failure("USER_UNKNOWN");
  const { status, ...user } = row;
  if (status === "BLOCKED") return failure("USER_BLOCKED");
  const level = effectiveAiLevel(allowWrite ? "WRITE" : "READ", user.aiAccess);
  if (!level) return failure("NO_PERMISSION");
  return success(user, level, null);
}

/**
 * Wächter für JEDEN Werkzeugaufruf: Zugang frisch prüfen (Widerruf,
 * Sperre und Rechteänderung wirken sofort) und die nötige Stufe verlangen —
 * lesende Werkzeuge READ, schreibende WRITE. Liefert bei Erfolg den Scope,
 * mit dem das Werkzeug die Dienste aufruft.
 */
export async function authorizeAiCall(credential: AiCredential, need: AiLevel): Promise<AiAuthResult> {
  const result =
    credential.kind === "token"
      ? await verifyApiToken(credential.secret)
      : await resolveDev(credential.email, credential.allowWrite);
  if (!result.ok) return result;
  if (!aiLevelSatisfies(result.level, need)) return failure("INSUFFICIENT_LEVEL");
  return result;
}

/** Wie authorizeAiCall, aber wirft einen ServiceError (FORBIDDEN) statt eines Ergebnisses. */
export async function requireAiCall(credential: AiCredential, need: AiLevel): Promise<AiAuthSuccess> {
  const result = await authorizeAiCall(credential, need);
  if (!result.ok) {
    throw new ServiceError("FORBIDDEN", result.message, { details: { reason: result.reason } });
  }
  return result;
}
