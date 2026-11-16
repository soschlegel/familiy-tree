import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { canEditPerson, canViewPerson } from "@/lib/scope";
import { PersonForm } from "@/components/PersonForm";
import { fuzzyField, toDateInput } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person bearbeiten" };

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
    <div className="space-y-5">
      <Link href={`/people/${person.id}`} className="btn-link text-sm">
        ← Zurück zur Person
      </Link>
      <div>
        <p className="eyebrow">Bearbeiten</p>
        <h1 className="page-title">
          {[person.givenName, person.familyName].filter(Boolean).join(" ")}
        </h1>
      </div>
      <PersonForm
        initial={{
          id: person.id,
          givenName: person.givenName,
          familyName: person.familyName,
          birthName: person.birthName,
          gender: person.gender,
          // Als Eingabetext in der gespeicherten Genauigkeit, z.B. „um 1850“ —
          // unverändert abgeschickt ergibt er wieder genau dasselbe Datum.
          birthDate: toDateInput(fuzzyField(person, "birthDate")),
          birthPlace: person.birthPlace,
          deathDate: toDateInput(fuzzyField(person, "deathDate")),
          deathPlace: person.deathPlace,
          notes: person.notes,
        }}
      />
    </div>
  );
}
