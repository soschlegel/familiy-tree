import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { UserAdmin } from "@/components/UserAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Benutzer" };

export default async function UsersPage() {
  const session = await requirePage("user:manage");

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Verwaltung</p>
        <h1 className="page-title">Benutzer</h1>
        <p className="mt-1 text-sm muted">
          Nur hier eingetragene E-Mail-Adressen können sich anmelden — ein
          gültiges Google- oder GitHub-Konto allein genügt nicht.
        </p>
      </div>

      <UserAdmin
        users={users.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
