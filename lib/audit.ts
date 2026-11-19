import { prisma } from "./prisma";
import type { Scope } from "./scope";

type AuditInput = {
  userId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType:
    | "Person"
    | "Relationship"
    | "MediaAsset"
    | "User"
    | "Family"
    | "Source"
    | "Citation"
    | "ApiToken"
    | "Event"
    | "PersonName"
    | "ImportBatch"
    | "ImportRawRecord";
  entityId: string;
  diff?: unknown;
  /** Kanal der Änderung; ohne Angabe Web-App. */
  channel?: "MCP" | null;
  /** Schlüssel, mit dem die Änderung kam (ApiToken.id, nie das Geheimnis). */
  apiTokenId?: string | null;
};

/**
 * Wer hat geändert, und über welchen Kanal? Für alle Dienste, die einen Scope
 * haben: `audit({ ...auditActor(scope), action, … })`. So ist jede Änderung
 * über den KI-Zugang samt Schlüssel nachvollziehbar, ohne dass die Dienste
 * den Kanal selbst kennen müssen.
 */
export function auditActor(
  scope: Pick<Scope, "userId" | "via">,
): Pick<AuditInput, "userId" | "channel" | "apiTokenId"> {
  return {
    userId: scope.userId,
    channel: scope.via?.channel ?? null,
    apiTokenId: scope.via?.tokenId ?? null,
  };
}

/**
 * Schreibt einen Audit-Eintrag. Bewusst fehlertolerant: ein kaputtes Audit
 * darf die eigentliche Mutation nicht zurückrollen.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        diff: (input.diff ?? undefined) as never,
        channel: input.channel ?? null,
        apiTokenId: input.apiTokenId ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] Eintrag fehlgeschlagen:", err);
  }
}
