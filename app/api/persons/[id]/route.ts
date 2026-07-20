import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { personInput } from "@/lib/validation";

type Params = { id: string };

export const GET = route<Params>("person:read", async (_ctx, _req, { id }) => {
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      relationsFrom: { include: { toPerson: true } },
      relationsTo: { include: { fromPerson: true } },
      media: {
        include: { media: true },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
      },
    },
  });

  if (!person) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(person);
});

export const PATCH = route<Params>(
  "person:update",
  async (ctx, req, { id }) => {
    const parsed = personInput.partial().safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.issues);

    const person = await prisma.person.update({
      where: { id },
      data: parsed.data,
    });

    await audit({
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "Person",
      entityId: id,
      diff: parsed.data,
    });

    return NextResponse.json(person);
  },
);

export const DELETE = route<Params>(
  "person:delete",
  async (ctx, _req, { id }) => {
    const relationCount = await prisma.relationship.count({
      where: { OR: [{ fromPersonId: id }, { toPersonId: id }] },
    });

    // Löschen würde per Cascade auch alle Beziehungen mitreißen. Bei einer
    // verknüpften Person ist das fast nie gewollt — daher explizit bestätigen.
    const force =
      new URL(_req.url).searchParams.get("force") === "true";

    if (relationCount > 0 && !force) {
      return NextResponse.json(
        {
          error: `Person hat ${relationCount} Beziehung(en). Zum Löschen ?force=true anhängen.`,
          relationCount,
        },
        { status: 409 },
      );
    }

    await prisma.person.delete({ where: { id } });

    await audit({
      userId: ctx.userId,
      action: "DELETE",
      entityType: "Person",
      entityId: id,
      diff: { relationCount },
    });

    return NextResponse.json({ ok: true });
  },
);
