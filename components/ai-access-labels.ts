/**
 * Deutsche Bezeichnungen rund um den KI-Zugang — gemeinsam für die
 * Benutzerverwaltung und die Seite „KI-Zugang“. Nur Darstellung; die Regeln
 * stehen in lib/services/ai-access.ts.
 */

export type AiAccessLevel = "NONE" | "READ" | "WRITE";
export type ApiTokenLevelName = "READ" | "WRITE";
export type ApiTokenStatusName = "ACTIVE" | "REVOKED" | "EXPIRED";

/** Wie die Liste der Schlüssel sie braucht (ApiTokenDto ohne Besitzer). */
export type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  level: ApiTokenLevelName;
  status: ApiTokenStatusName;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export const AI_ACCESS_LABEL: Record<AiAccessLevel, string> = {
  NONE: "kein Zugang",
  READ: "lesen",
  WRITE: "lesen und schreiben",
};

export const TOKEN_LEVEL_LABEL: Record<ApiTokenLevelName, string> = {
  READ: "lesen",
  WRITE: "lesen und schreiben",
};

export const TOKEN_STATUS_LABEL: Record<ApiTokenStatusName, string> = {
  ACTIVE: "aktiv",
  REVOKED: "widerrufen",
  EXPIRED: "abgelaufen",
};

export const TOKEN_STATUS_CLASS: Record<ApiTokenStatusName, string> = {
  ACTIVE: "badge-accent",
  REVOKED:
    "badge border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  EXPIRED: "badge",
};

const RANK: Record<AiAccessLevel, number> = { NONE: 0, READ: 1, WRITE: 2 };

export function aiRank(level: AiAccessLevel): number {
  return RANK[level];
}

/** Wirksame Stufe eines Schlüssels: min(Schlüssel, Benutzerrecht). */
export function effectiveLevel(token: ApiTokenLevelName, user: AiAccessLevel): AiAccessLevel {
  return RANK[token] <= RANK[user] ? token : user;
}

export function formatDay(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-DE") : "—";
}

export function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "nie";
}

export function countKeys(n: number, adjective = "aktive"): string {
  return n === 1 ? `1 ${adjective.replace(/e$/, "er")} Schlüssel` : `${n} ${adjective} Schlüssel`;
}
