import type { Role } from "@prisma/client";

/**
 * Zentrale Rollen-Policy. Jede serverseitige Mutation MUSS hier durch.
 * Die UI blendet zusätzlich aus — das ist Komfort, nicht Sicherheit.
 */

export type Action =
  | "person:read"
  | "person:create"
  | "person:update"
  | "person:delete"
  | "relationship:create"
  | "relationship:update"
  | "relationship:delete"
  | "media:read"
  | "media:upload"
  | "media:delete"
  | "user:read"
  | "user:manage"
  | "audit:read"
  | "data:import";

const VIEWER: Action[] = ["person:read", "media:read"];

const EDITOR: Action[] = [
  ...VIEWER,
  "person:create",
  "person:update",
  "relationship:create",
  "relationship:update",
  "relationship:delete",
  "media:upload",
];

// Admin darf alles — inklusive Löschen von Personen und Benutzerverwaltung.
const ADMIN: Action[] = [
  ...EDITOR,
  "person:delete",
  "media:delete",
  "user:read",
  "user:manage",
  "audit:read",
  // Import bleibt bewusst Admins vorbehalten: er kann in einem Zug den
  // gesamten Bestand verändern.
  "data:import",
];

const PERMISSIONS: Record<Role, Action[]> = {
  VIEWER,
  EDITOR,
  ADMIN,
};

export function can(role: Role | undefined | null, action: Action): boolean {
  if (!role) return false;
  return PERMISSIONS[role].includes(action);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Keine Berechtigung für: ${action}`);
    this.name = "ForbiddenError";
  }
}

/** Wirft ForbiddenError, wenn die Rolle die Aktion nicht abdeckt. */
export function assertCan(role: Role | undefined | null, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}
