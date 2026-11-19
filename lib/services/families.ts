import { prisma } from "../prisma";
import { viewableFamilyIds, type Scope } from "../scope";

export type FamilyListItem = {
  id: string;
  name: string;
  description: string | null;
  personCount: number;
  memberCount: number;
  /** Eigene Rolle in dieser Familie; "ADMIN" für Administratoren ohne Zuordnung. */
  myRole: "EDITOR" | "VIEWER" | "ADMIN" | null;
};

/**
 * Familien, die der Benutzer kennt. Nicht-Admins sehen nur die, denen sie
 * zugeordnet sind — schon die Namen fremder Familien sind eine Information
 * über andere.
 */
export async function listFamilies(scope: Scope): Promise<FamilyListItem[]> {
  const families = await prisma.family.findMany({
    where: scope.isAdmin ? undefined : { id: { in: viewableFamilyIds(scope) } },
    orderBy: { name: "asc" },
    include: { _count: { select: { persons: true, members: true } } },
  });

  return families.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    personCount: f._count.persons,
    memberCount: f._count.members,
    myRole: scope.families.get(f.id) ?? (scope.isAdmin ? "ADMIN" : null),
  }));
}
