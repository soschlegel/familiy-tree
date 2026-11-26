import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit, auditActor } from "@/lib/audit";
import { userInput } from "@/lib/validation";
import { latestReleaseId } from "@/lib/release-notes-data";

/**
 * Alle Benutzer — samt KI-Recht (aiAccess) und Zahl der aktiven
 * KI-Schlüssel (activeTokens: nicht widerrufen, nicht abgelaufen).
 */
export const GET = route("user:read", async () => {
  const now = new Date();
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      aiAccess: true,
      _count: {
        select: {
          apiTokens: {
            where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          },
        },
      },
    },
  });
  return NextResponse.json(
    users.map(({ _count, ...u }) => ({ ...u, activeTokens: _count.apiTokens })),
  );
});

/**
 * Legt einen Benutzer an — das ist der Einladungsvorgang. Ohne Eintrag hier
 * wird jeder OAuth-Login abgelehnt (siehe signIn-Callback in lib/auth.ts).
 */
export const POST = route("user:manage", async (ctx, req) => {
  const parsed = userInput.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Diese E-Mail ist bereits eingeladen." },
      { status: 409 },
    );
  }

  // Neue Benutzer kennen noch keine frühere Version — „Was ist neu?“ beginnt
  // für sie erst mit dem nächsten Release (docs/entwicklung/neuigkeiten.md).
  const user = await prisma.user.create({
    data: { ...parsed.data, status: "INVITED", lastSeenReleaseId: latestReleaseId() },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  await audit({
    ...auditActor(ctx.scope),
    action: "CREATE",
    entityType: "User",
    entityId: user.id,
    diff: { email: user.email, role: user.role },
  });

  return NextResponse.json(user, { status: 201 });
});
