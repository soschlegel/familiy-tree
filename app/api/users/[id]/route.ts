import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { userPatch } from "@/lib/validation";

type Params = { id: string };

/**
 * Verhindert, dass sich die Instanz aussperrt: der letzte aktive Admin darf
 * weder herabgestuft noch gesperrt noch gelöscht werden. Als "aktiv" zählt
 * hier nur, wer sich schon einmal angemeldet hat — ein eingeladener Admin mit
 * vertippter Adresse würde sonst als Rettungsanker zählen, obwohl er sich nie
 * anmelden kann.
 */
async function isLastActiveAdmin(userId: string): Promise<boolean> {
  const otherAdmins = await prisma.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } },
  });
  return otherAdmins === 0;
}

export const PATCH = route<Params>("user:manage", async (ctx, req, { id }) => {
  const parsed = userPatch.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true, status: true },
  });
  if (!target) return notFound();

  const losesAdmin =
    target.role === "ADMIN" &&
    ((parsed.data.role !== undefined && parsed.data.role !== "ADMIN") ||
      parsed.data.status === "BLOCKED");

  // Sich selbst herabstufen oder sperren endet sofort mit dem Verlust der
  // Verwaltungsrechte — das muss ein anderer Admin tun. Unabhängig davon, ob
  // es noch weitere Admins gibt: die könnten ebenfalls nur eingeladen sein.
  if (id === ctx.userId) {
    const changesStatus =
      parsed.data.status !== undefined && parsed.data.status !== target.status;
    if (losesAdmin || changesStatus) {
      return NextResponse.json(
        {
          error:
            "Die eigene Rolle oder den eigenen Status kann nur ein anderer Admin ändern.",
        },
        { status: 409 },
      );
    }
  }

  if (losesAdmin && (await isLastActiveAdmin(id))) {
    return NextResponse.json(
      { error: "Der letzte aktive Admin kann nicht herabgestuft oder gesperrt werden." },
      { status: 409 },
    );
  }

  const user = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  await audit({
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "User",
    entityId: id,
    diff: parsed.data,
  });

  return NextResponse.json(user);
});

export const DELETE = route<Params>(
  "user:manage",
  async (ctx, _req, { id }) => {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target) return notFound();

    if (id === ctx.userId) {
      return NextResponse.json(
        { error: "Der eigene Zugang kann nicht gelöscht werden." },
        { status: 409 },
      );
    }
    if (target.role === "ADMIN" && (await isLastActiveAdmin(id))) {
      return NextResponse.json(
        { error: "Der letzte aktive Admin kann nicht gelöscht werden." },
        { status: 409 },
      );
    }

    await prisma.user.delete({ where: { id } });

    await audit({
      userId: ctx.userId,
      action: "DELETE",
      entityType: "User",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  },
);
