import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { canEditPerson, canViewPerson } from "@/lib/scope";
import { PersonForm } from "@/components/PersonForm";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { scope } = await requireScope();
  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    include: { families: { select: { familyId: true } } },
  });
  if (!person) notFound();

  const familyIds = person.families.map((f) => f.familyId);
  if (!canViewPerson(scope, familyIds)) notFound();
  if (!canEditPerson(scope, familyIds)) redirect(`/people/${id}`);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {[person.givenName, person.familyName].filter(Boolean).join(" ")}{" "}
        bearbeiten
      </h1>
      <PersonForm
        initial={{
          id: person.id,
          givenName: person.givenName,
          familyName: person.familyName,
          birthName: person.birthName,
          gender: person.gender,
          birthDate: person.birthDate?.toISOString() ?? null,
          birthPlace: person.birthPlace,
          deathDate: person.deathDate?.toISOString() ?? null,
          deathPlace: person.deathPlace,
          notes: person.notes,
        }}
      />
    </div>
  );
}
