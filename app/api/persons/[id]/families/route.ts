import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canEditPerson, familyIdsOfPerson } from "@/lib/scope";

type Params = { id: string };

const input = z.object({ familyIds: z.array(z.string().min(1)) });

/**
 * Setzt die Familienzugehörigkeit einer Person.
 *
 * Nicht-Admins dürfen nur Familien zuweisen, in denen sie selbst EDITOR sind —
 * sonst könnte jemand eine Person in eine fremde Familie schieben und ihr so
 * Einblick verschaffen oder entziehen.
 */
export const PUT = route<Params>(null, async (ctx, req, { id }) => {
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) return notFound();

  const current = await familyIdsOfPerson(id);
  if (!canEditPerson(ctx.scope, current)) {
    return forbidden("diese Person zu ändern");
  }

  const next = [...new Set(parsed.data.familyIds)];

  if (!ctx.scope.isAdmin) {
    const editable = new Set(
      [...ctx.scope.families.entries()]
        .filter(([, r]) => r === "EDITOR")
        .map(([f]) => f),
    );
    // Zuordnungen, die der Benutzer nicht verwalten darf, müssen unverändert
    // bleiben — weder hinzugefügt noch entfernt.
    const touched = [
      ...next.filter((f) => !current.includes(f)),
      ...current.filter((f) => !next.includes(f)),
    ];
    const illegal = touched.filter((f) => !editable.has(f));
    if (illegal.length > 0) {
      return forbidden(
        "Familien zu ändern, in denen du keine Bearbeitungsrechte hast",
      );
    }
  }

  await prisma.$transaction([
    prisma.personFamily.deleteMany({ where: { personId: id } }),
    prisma.personFamily.createMany({
      data: next.map((familyId) => ({ personId: id, familyId })),
      skipDuplicates: true,
    }),
  ]);

  await audit({
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "Person",
    entityId: id,
    diff: { families: next },
  });

  return NextResponse.json({ ok: true, familyIds: next });
});
