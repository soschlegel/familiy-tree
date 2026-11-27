import type { Role } from "@prisma/client";

/**
 * GLOBALE Rechte — Verwaltungsaufgaben, die nicht an einer einzelnen Familie
 * hängen. Alles Inhaltliche (Personen, Beziehungen, Bilder) wird NICHT hier
 * entschieden, sondern in lib/scope.ts anhand der Familienzugehörigkeit.
 *
 * Diese Trennung ist beabsichtigt: eine Person gehört zu Familien, und ob
 * jemand sie sehen oder ändern darf, ergibt sich aus der Rolle in genau diesen
 * Familien — nicht aus einer pauschalen Rolle. Eine globale Rolle EDITOR wäre
 * neben den Familienrollen eine zweite, widersprüchliche Quelle.
 */
export type Action =
  | "user:read"
  | "user:manage"
  | "audit:read"
  | "data:import"
  | "family:manage"
  | "place:manage"
  | "setting:manage"
  | "history:manage";

const ADMIN_ONLY: Action[] = [
  "user:read",
  "user:manage",
  "audit:read",
  // Import kann in einem Zug den gesamten Bestand verändern.
  "data:import",
  // Familien anlegen und Zugriffe vergeben ist Rechtevergabe.
  "family:manage",
  // Ortszuordnung: sieht alle Ortstexte, auch die gesperrter Personen.
  "place:manage",
  // Einstellungen der Installation (/admin/settings) gelten für alle.
  "setting:manage",
  // Zeitgeschichte (/admin/history): eigene Ereignisse und ausgeblendete
  // mitgelieferte gelten für alle Benutzer.
  "history:manage",
];

const PERMISSIONS: Record<Role, Action[]> = {
  VIEWER: [],
  EDITOR: [],
  ADMIN: ADMIN_ONLY,
};

export function can(role: Role | undefined | null, action: Action): boolean {
  if (!role) return false;
  return PERMISSIONS[role].includes(action);
}

export class ForbiddenError extends Error {
  constructor(what: string) {
    super(`Keine Berechtigung für: ${what}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | undefined | null, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}
