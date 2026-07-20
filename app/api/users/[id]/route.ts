import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { userPatch } from "@/lib/validation";

type Params = { id: string };

/**
 * Verhindert, dass sich die Instanz aussperrt: der letzte aktive Admin darf
 * weder herabgestuft noch gesperrt noch gelöscht werden.
 */
async function isLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (target?.role !== "ADMIN") return false;

  const otherAdmins = await prisma.user.count({
    where: { role: "ADMIN", status: { not: "BLOCKED" }, id: { not: userId } },
  });
  return otherAdmins === 0;
}

export const PATCH = route<Params>("user:manage", async (ctx, req, { id }) => {
  const parsed = userPatch.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const losesAdmin =
    (parsed.data.role && parsed.data.role !== "ADMIN") ||
    parsed.data.status === "BLOCKED";

  if (losesAdmin && (await isLastAdmin(id))) {
    return NextResponse.json(
      { error: "Der letzte Admin kann nicht herabgestuft oder gesperrt werden." },
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
    if (id === ctx.userId) {
      return NextResponse.json(
        { error: "Der eigene Zugang kann nicht gelöscht werden." },
        { status: 409 },
      );
    }
    if (await isLastAdmin(id)) {
      return NextResponse.json(
        { error: "Der letzte Admin kann nicht gelöscht werden." },
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
