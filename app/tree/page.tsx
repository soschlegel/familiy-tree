import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { canViewPerson, editableFamilyIds, maskPerson } from "@/lib/scope";
import type { Scope } from "@/lib/scope";
import { FamilyTree } from "@/components/FamilyTree";
import type { TreeData } from "@/lib/tree-layout";

export const dynamic = "force-dynamic";

async function loadTree(scope: Scope): Promise<TreeData> {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
        families: { select: { familyId: true } },
      },
    }),
    prisma.relationship.findMany({
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
  ]);

  const visible = new Set<string>();

  return {
    persons: persons.map((p) => {
      const familyIds = p.families.map((f) => f.familyId);
      // Gesperrte Personen bleiben als anonymer Platzhalter im Baum, damit er
      // zusammenhängend bleibt — ohne Name, Daten und Bild.
      if (!canViewPerson(scope, familyIds)) return maskPerson(p.id);

      visible.add(p.id);
      return {
        id: p.id,
        givenName: p.givenName,
        familyName: p.familyName,
        gender: p.gender,
        birthDate: p.birthDate?.toISOString() ?? null,
        deathDate: p.deathDate?.toISOString() ?? null,
        primaryMediaId: p.media[0]?.mediaId ?? null,
        restricted: false as const,
        familyIds,
      };
    }),
    relationships: relationships.map((r) => {
      const anyVisible =
        visible.has(r.fromPersonId) || visible.has(r.toPersonId);
      return {
        id: r.id,
        type: r.type,
        subtype: anyVisible ? r.subtype : "BIOLOGICAL",
        fromPersonId: r.fromPersonId,
        toPersonId: r.toPersonId,
        startDate: anyVisible ? (r.startDate?.toISOString() ?? null) : null,
        endDate: anyVisible ? (r.endDate?.toISOString() ?? null) : null,
        primaryMediaId: anyVisible ? (r.media[0]?.mediaId ?? null) : null,
      };
    }),
  };
}

export default async function TreePage() {
  const { scope } = await requireScope();
  const data = await loadTree(scope);
  const canCreate = scope.isAdmin || editableFamilyIds(scope).length > 0;

  // Nur Familien zur Auswahl anbieten, die der Benutzer auch sehen darf.
  const families = await prisma.family.findMany({
    where: scope.isAdmin ? undefined : { id: { in: [...scope.families.keys()] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Stammbaum</h1>
          <p className="text-sm text-stone-500">
            {data.persons.length} Personen · {data.relationships.length} Beziehungen
          </p>
        </div>
        {canCreate && (
          <Link
            href="/people/new"
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
          >
            Person anlegen
          </Link>
        )}
      </div>

      <FamilyTree data={data} families={families} />
    </div>
  );
}
