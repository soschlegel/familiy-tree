import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden } from "@/lib/api";
import { audit } from "@/lib/audit";
import { relationshipInput } from "@/lib/validation";
import { canEditRelationship } from "@/lib/scope";

/**
 * Prüft, ob `candidateAncestorId` bereits ein Nachfahre von `personId` ist.
 * Verhindert Zyklen wie "A ist Elternteil von B" + "B ist Elternteil von A",
 * die sonst jedes Baum-Layout in eine Endlosschleife schicken.
 */
async function wouldCreateCycle(
  parentId: string,
  childId: string,
): Promise<boolean> {
  if (parentId === childId) return true;

  // Von childId aus nach unten laufen: taucht parentId auf, gäbe es einen Zyklus.
  const visited = new Set<string>([childId]);
  let frontier = [childId];

  while (frontier.length > 0) {
    const edges = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", fromPersonId: { in: frontier } },
      select: { toPersonId: true },
    });

    const next: string[] = [];
    for (const { toPersonId } of edges) {
      if (toPersonId === parentId) return true;
      if (!visited.has(toPersonId)) {
        visited.add(toPersonId);
        next.push(toPersonId);
      }
    }
    frontier = next;
  }

  return false;
}

export const POST = route(null, async (ctx, req) => {
  const parsed = relationshipInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  let { type, subtype, fromPersonId, toPersonId, startDate, endDate } =
    parsed.data;

  if (!(await canEditRelationship(ctx.scope, fromPersonId, toPersonId))) {
    return forbidden("diese Beziehung anzulegen");
  }

  // PARTNER_OF ist ungerichtet — kanonisch sortiert speichern, damit die
  // Unique-Constraint doppelte Ehen in beiden Richtungen verhindert.
  if (type === "PARTNER_OF" && fromPersonId > toPersonId) {
    [fromPersonId, toPersonId] = [toPersonId, fromPersonId];
  }

  if (type === "PARENT_OF" && (await wouldCreateCycle(fromPersonId, toPersonId))) {
    return NextResponse.json(
      { error: "Diese Eltern-Kind-Beziehung würde einen Zyklus erzeugen." },
      { status: 409 },
    );
  }

  if (type === "PARENT_OF") {
    const parentCount = await prisma.relationship.count({
      where: { type: "PARENT_OF", toPersonId },
    });
    if (parentCount >= 2) {
      return NextResponse.json(
        { error: "Diese Person hat bereits zwei Elternteile." },
        { status: 409 },
      );
    }
  }

  const existing = await prisma.relationship.findUnique({
    where: {
      type_fromPersonId_toPersonId: { type, fromPersonId, toPersonId },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Diese Beziehung existiert bereits." },
      { status: 409 },
    );
  }

  const relationship = await prisma.relationship.create({
    data: { type, subtype, fromPersonId, toPersonId, startDate, endDate },
  });

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Relationship",
    entityId: relationship.id,
    diff: relationship,
  });

  return NextResponse.json(relationship, { status: 201 });
});
