import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";

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
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      diff: { familyId, role },
    });

    return NextResponse.json({ ok: true });
  },
);
