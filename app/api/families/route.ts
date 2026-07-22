import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { viewableFamilyIds } from "@/lib/scope";

const familyInput = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

/**
 * Listet Familien. Nicht-Admins sehen nur die, denen sie zugeordnet sind —
 * schon die Namen fremder Familien sind eine Information über andere.
 */
export const GET = route(null, async (ctx) => {
  const families = await prisma.family.findMany({
    where: ctx.scope.isAdmin
      ? undefined
      : { id: { in: viewableFamilyIds(ctx.scope) } },
    orderBy: { name: "asc" },
    include: { _count: { select: { persons: true, members: true } } },
  });

  return NextResponse.json(
    families.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      personCount: f._count.persons,
      memberCount: f._count.members,
      myRole: ctx.scope.families.get(f.id) ?? (ctx.scope.isAdmin ? "ADMIN" : null),
    })),
  );
});

export const POST = route("family:manage", async (ctx, req) => {
  const parsed = familyInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const existing = await prisma.family.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Eine Familie mit diesem Namen existiert bereits." },
      { status: 409 },
    );
  }

  const family = await prisma.family.create({ data: parsed.data });

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Family",
    entityId: family.id,
    diff: parsed.data,
  });

  return NextResponse.json(family, { status: 201 });
});
