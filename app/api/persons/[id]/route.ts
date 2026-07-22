import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { personInput } from "@/lib/validation";
import {
  canEditPerson,
  canViewPerson,
  familyIdsOfPerson,
} from "@/lib/scope";

type Params = { id: string };

export const GET = route<Params>(null, async (ctx, _req, { id }) => {
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      relationsFrom: { include: { toPerson: true } },
      relationsTo: { include: { fromPerson: true } },
      media: {
        include: { media: true },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
      },
      families: { select: { familyId: true } },
    },
  });

  if (!person) return notFound();

  const familyIds = person.families.map((f) => f.familyId);
  // Bewusst 404 statt 403: ein 403 würde bestätigen, dass es diese Person
  // gibt — bei einem Rechtekonzept ist schon das eine Auskunft.
  if (!canViewPerson(ctx.scope, familyIds)) return notFound();

  return NextResponse.json({ ...person, familyIds });
});

export const PATCH = route<Params>(null, async (ctx, req, { id }) => {
  const familyIds = await familyIdsOfPerson(id);
  if (!canViewPerson(ctx.scope, familyIds)) return notFound();
  if (!canEditPerson(ctx.scope, familyIds)) {
    return forbidden("diese Person zu ändern");
  }

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
});

export const DELETE = route<Params>(null, async (ctx, req, { id }) => {
  const familyIds = await familyIdsOfPerson(id);
  if (!canViewPerson(ctx.scope, familyIds)) return notFound();
  if (!canEditPerson(ctx.scope, familyIds)) {
    return forbidden("diese Person zu löschen");
  }

  const relationCount = await prisma.relationship.count({
    where: { OR: [{ fromPersonId: id }, { toPersonId: id }] },
  });

  // Löschen würde per Cascade auch alle Beziehungen mitreißen. Bei einer
  // verknüpften Person ist das fast nie gewollt — daher explizit bestätigen.
  const force = new URL(req.url).searchParams.get("force") === "true";

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
});
