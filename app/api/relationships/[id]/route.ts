import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { relationshipPatch } from "@/lib/validation";

type Params = { id: string };

/**
 * Korrigiert Art und Datumsangaben. Die verknüpften Personen bleiben fest —
 * eine falsche Zuordnung wird gelöscht und neu angelegt, nicht umgebogen.
 */
export const PATCH = route<Params>(
  "relationship:update",
  async (ctx, req, { id }) => {
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
  },
);

export const DELETE = route<Params>(
  "relationship:delete",
  async (ctx, _req, { id }) => {
    const existing = await prisma.relationship.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
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
  },
);
