import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { listPickablePersons } from "@/lib/services";
import { requirePage } from "@/lib/session";
import { UserAdmin } from "@/components/UserAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Benutzer" };

export default async function UsersPage() {
  const session = await requirePage("user:manage");

  const now = new Date();
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
      aiAccess: true,
      // Eigene Person („das bin ich“, README „Bezugsperson“).
      person: { select: { id: true, givenName: true, familyName: true } },
      // Aktive KI-Schlüssel: nicht widerrufen, nicht abgelaufen.
      _count: {
        select: {
          // Verknüpfte Anmeldekonten (Google/GitHub) und Familienzuordnungen —
          // für „E-Mail korrigieren“ bzw. die Rückfrage beim Löschen.
          accounts: true,
          families: true,
          apiTokens: {
            where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          },
        },
      },
    },
  });

  // Auswahl für „Person zuordnen“ — Administratoren sehen alle Personen.
  const people = await listPickablePersons(await loadScope(session.user.id, session.user.role));

  // Wie in app/api/users/[id]/route.ts: zählt nur, wer sich schon angemeldet hat.
  const activeAdmins = users.filter((u) => u.role === "ADMIN" && u.status === "ACTIVE").length;

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
        people={people}
        users={users.map(({ _count, person, ...u }) => ({
          ...u,
          person: person ? { id: person.id, name: [person.givenName, person.familyName].filter(Boolean).join(" ") } : null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          activeTokens: _count.apiTokens,
          familyCount: _count.families,
          neverSignedIn: u.status === "INVITED" && !u.lastLoginAt && _count.accounts === 0,
          lastAdmin: u.role === "ADMIN" && u.status === "ACTIVE" && activeAdmins <= 1,
        }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
