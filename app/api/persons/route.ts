import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { personInput } from "@/lib/validation";

export const GET = route("person:read", async (_ctx, req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();

  const persons = await prisma.person.findMany({
    where: q
      ? {
          OR: [
            { givenName: { contains: q, mode: "insensitive" } },
            { familyName: { contains: q, mode: "insensitive" } },
            { birthName: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    include: {
      media: {
        where: { isPrimary: true },
        take: 1,
        select: { mediaId: true },
      },
    },
  });

  return NextResponse.json(
    persons.map(({ media, ...p }) => ({
      ...p,
      primaryMediaId: media[0]?.mediaId ?? null,
    })),
  );
});

export const POST = route("person:create", async (ctx, req) => {
  const parsed = personInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const person = await prisma.person.create({ data: parsed.data });

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Person",
    entityId: person.id,
    diff: parsed.data,
  });

  return NextResponse.json(person, { status: 201 });
});
