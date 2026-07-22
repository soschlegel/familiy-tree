import { prisma } from "./prisma";

type AuditInput = {
  userId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType: "Person" | "Relationship" | "MediaAsset" | "User" | "Family";
  entityId: string;
  diff?: unknown;
};

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
      },
    });
  } catch (err) {
    console.error("[audit] Eintrag fehlgeschlagen:", err);
  }
}
