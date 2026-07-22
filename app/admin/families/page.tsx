import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { FamilyAdmin } from "@/components/FamilyAdmin";

export const dynamic = "force-dynamic";

export default async function FamiliesPage() {
  await requirePage("family:manage");

  const [families, users, unassignedPersons] = await Promise.all([
    prisma.family.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { persons: true, members: true } } },
    }),
    prisma.user.findMany({
      orderBy: { email: "asc" },
      include: { families: { select: { familyId: true, role: true } } },
    }),
    prisma.person.count({ where: { families: { none: {} } } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Familien und Zugriffe</h1>
        <p className="text-sm text-stone-500">
          Personen gehören zu Familien; über die Familie entscheidet sich, wer
          sie sehen und bearbeiten darf.
        </p>
      </div>

      <FamilyAdmin
        families={families.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          personCount: f._count.persons,
          memberCount: f._count.members,
        }))}
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          isAdmin: u.role === "ADMIN",
          roles: Object.fromEntries(
            u.families.map((f) => [f.familyId, f.role]),
          ) as Record<string, "EDITOR" | "VIEWER">,
        }))}
        unassignedPersons={unassignedPersons}
      />
    </div>
  );
}
