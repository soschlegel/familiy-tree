import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { can } from "@/lib/authz";
import { FamilyTree } from "@/components/FamilyTree";
import type { TreeData } from "@/lib/tree-layout";

export const dynamic = "force-dynamic";

async function loadTree(): Promise<TreeData> {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
    prisma.relationship.findMany({
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
  ]);

  return {
    persons: persons.map((p) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: p.birthDate?.toISOString() ?? null,
      deathDate: p.deathDate?.toISOString() ?? null,
      primaryMediaId: p.media[0]?.mediaId ?? null,
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
      startDate: r.startDate?.toISOString() ?? null,
      endDate: r.endDate?.toISOString() ?? null,
      primaryMediaId: r.media[0]?.mediaId ?? null,
    })),
  };
}

export default async function TreePage() {
  const session = await requirePage("person:read");
  const data = await loadTree();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Stammbaum</h1>
          <p className="text-sm text-stone-500">
            {data.persons.length} Personen · {data.relationships.length} Beziehungen
          </p>
        </div>
        {can(session.user.role, "person:create") && (
          <Link
            href="/people/new"
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
          >
            Person anlegen
          </Link>
        )}
      </div>

      <FamilyTree data={data} />
    </div>
  );
}
