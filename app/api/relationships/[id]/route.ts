import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { relationshipPatch } from "@/lib/validation";
import { canEditRelationship } from "@/lib/scope";

type Params = { id: string };

/**
 * Korrigiert Art und Datumsangaben. Die verknüpften Personen bleiben fest —
 * eine falsche Zuordnung wird gelöscht und neu angelegt, nicht umgebogen.
 */
export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  const existing = await prisma.relationship.findUnique({ where: { id } });
  if (!existing) return notFound();

  if (
    !(await canEditRelationship(
      ctx.scope,
      existing.fromPersonId,
      existing.toPersonId,
    ))
  ) {
    return forbidden("diese Beziehung zu ändern");
  }

  const parsed = relationshipPatch.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const relationship = await prisma.relationship.update({
    where: { id },
    data: parsed.data,
  });

  await audit({
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "Relationship",
    entityId: id,
    diff: parsed.data,
  });

  return NextResponse.json(relationship);
});

export const DELETE = route<Params>(null, async (ctx, _req, { id }) => {
  const existing = await prisma.relationship.findUnique({ where: { id } });
  if (!existing) return notFound();

  if (
    !(await canEditRelationship(
      ctx.scope,
      existing.fromPersonId,
      existing.toPersonId,
    ))
  ) {
    return forbidden("diese Beziehung zu löschen");
  }

  await prisma.relationship.delete({ where: { id } });

  await audit({
    userId: ctx.userId,
    action: "DELETE",
    entityType: "Relationship",
    entityId: id,
    diff: existing,
  });

  return NextResponse.json({ ok: true });
});
