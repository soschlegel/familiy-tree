import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { userInput } from "@/lib/validation";

export const GET = route("user:read", async () => {
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
    },
  });
  return NextResponse.json(users);
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

  const user = await prisma.user.create({
    data: { ...parsed.data, status: "INVITED" },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "User",
    entityId: user.id,
    diff: { email: user.email, role: user.role },
  });

  return NextResponse.json(user, { status: 201 });
});
