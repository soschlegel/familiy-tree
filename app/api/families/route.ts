import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listFamilies } from "@/lib/services";

const familyInput = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

/**
 * Listet Familien. Nicht-Admins sehen nur die, denen sie zugeordnet sind —
 * schon die Namen fremder Familien sind eine Information über andere.
 */
export const GET = route(null, async (ctx) => {
  return NextResponse.json(await listFamilies(ctx.scope));
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
