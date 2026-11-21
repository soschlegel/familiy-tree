import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest, notFound } from "@/lib/api";
import { audit, auditActor } from "@/lib/audit";

type Params = { id: string };

const input = z.object({
  userId: z.string().min(1),
  // null entfernt die Zuordnung wieder.
  role: z.enum(["EDITOR", "VIEWER"]).nullable(),
});

/** Ordnet einem Benutzer diese Familie zu oder entzieht sie ihm wieder. */
export const POST = route<Params>(
  "family:manage",
  async (ctx, req, { id: familyId }) => {
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.issues);

    const { userId, role } = parsed.data;

    const [family, user] = await Promise.all([
      prisma.family.findUnique({ where: { id: familyId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!family || !user) return notFound();
    const before = await prisma.userFamily.findUnique({
      where: { userId_familyId: { userId, familyId } },
      select: { role: true },
    });

    if (role === null) {
      await prisma.userFamily.deleteMany({ where: { userId, familyId } });
    } else {
      await prisma.userFamily.upsert({
        where: { userId_familyId: { userId, familyId } },
        update: { role },
        create: { userId, familyId, role },
      });
    }

    await audit({
      ...auditActor(ctx.scope),
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      diff: { familyId, role, changes: { role: { from: before?.role ?? null, to: role } } },
    });

    return NextResponse.json({ ok: true });
  },
);
