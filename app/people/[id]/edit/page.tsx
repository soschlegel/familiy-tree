import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { PersonForm } from "@/components/PersonForm";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("person:update");
  const { id } = await params;

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) notFound();

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
