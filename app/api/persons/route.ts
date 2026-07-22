import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden } from "@/lib/api";
import { audit } from "@/lib/audit";
import { personInput } from "@/lib/validation";
import { editableFamilyIds, personVisibilityFilter } from "@/lib/scope";

export const GET = route(null, async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();

  const persons = await prisma.person.findMany({
    where: {
      AND: [
        personVisibilityFilter(ctx.scope),
        q
          ? {
              OR: [
                { givenName: { contains: q, mode: "insensitive" as const } },
                { familyName: { contains: q, mode: "insensitive" as const } },
                { birthName: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    include: {
      media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      families: { select: { familyId: true } },
    },
  });

  return NextResponse.json(
    persons.map(({ media, families, ...p }) => ({
      ...p,
      primaryMediaId: media[0]?.mediaId ?? null,
      familyIds: families.map((f) => f.familyId),
    })),
  );
});

/**
 * Neue Person. Nicht-Admins müssen sie einer Familie zuordnen, in der sie
 * EDITOR sind — eine Person ohne Familie wäre für den Anlegenden im nächsten
 * Moment unsichtbar, weil nur Admins familienlose Personen sehen.
 */
export const POST = route(null, async (ctx, req) => {
  const body = await req.json();
  const parsed = personInput.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues);

  const editable = editableFamilyIds(ctx.scope);
  const requested: string[] = Array.isArray(body?.familyIds)
    ? body.familyIds
    : [];

  let familyIds: string[];

  if (ctx.scope.isAdmin) {
    familyIds = requested;
  } else {
    if (editable.length === 0) {
      return forbidden("Personen anzulegen");
    }
    const illegal = requested.filter((f) => !editable.includes(f));
    if (illegal.length > 0) {
      return forbidden("Familien, in denen du keine Bearbeitungsrechte hast");
    }
    // Ohne Angabe in die einzige bearbeitbare Familie legen; gibt es mehrere,
    // muss der Aufrufer sich festlegen.
    familyIds = requested.length > 0 ? requested : editable.slice(0, 1);
  }

  const person = await prisma.person.create({
    data: {
      ...parsed.data,
      families: { create: familyIds.map((familyId) => ({ familyId })) },
    },
  });

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Person",
    entityId: person.id,
    diff: { ...parsed.data, familyIds },
  });

  return NextResponse.json({ ...person, familyIds }, { status: 201 });
});
