import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

type Params = { id: string };

const patchInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
});

export const PATCH = route<Params>(
  "family:manage",
  async (ctx, req, { id }) => {
    const parsed = patchInput.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.issues);

    const family = await prisma.family.update({
      where: { id },
      data: parsed.data,
    });

    await audit({
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "Family",
      entityId: id,
      diff: parsed.data,
    });

    return NextResponse.json(family);
  },
);

export const DELETE = route<Params>(
  "family:manage",
  async (ctx, req, { id }) => {
    const family = await prisma.family.findUnique({
      where: { id },
      include: { _count: { select: { persons: true, members: true } } },
    });
    if (!family) return notFound();

    // Das Löschen entzieht Zugriffe und kann Personen unsichtbar machen
    // (Personen ohne Familie sieht nur der Admin). Deshalb nur mit
    // ausdrücklicher Bestätigung, wenn noch etwas daran hängt.
    const force = new URL(req.url).searchParams.get("force") === "true";
    const attached = family._count.persons + family._count.members;

    if (attached > 0 && !force) {
      return NextResponse.json(
        {
          error:
            `An dieser Familie hängen ${family._count.persons} Person(en) und ` +
            `${family._count.members} Benutzerzuordnung(en). Zum Löschen ?force=true anhängen.`,
          personCount: family._count.persons,
          memberCount: family._count.members,
        },
        { status: 409 },
      );
    }

    await prisma.family.delete({ where: { id } });

    await audit({
      userId: ctx.userId,
      action: "DELETE",
      entityType: "Family",
      entityId: id,
      diff: { name: family.name, attached },
    });

    return NextResponse.json({ ok: true });
  },
);
