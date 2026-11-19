import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { canEditPerson, canViewPerson } from "@/lib/scope";
import { PersonForm } from "@/components/PersonForm";
import { dateFieldFrom } from "@/lib/date-fields";
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

  // Als Eingabetext in der gespeicherten Genauigkeit, z.B. „um 1850“ —
  // unverändert abgeschickt ergibt er wieder genau dasselbe Datum. Ein
  // Wortlaut ohne Datum (z.B. aus einem Import) steht als Text im Feld.
  const birth = dateFieldFrom(toDateInput(fuzzyField(person, "birthDate")), person.birthDatePhrase);
  const death = dateFieldFrom(toDateInput(fuzzyField(person, "deathDate")), person.deathDatePhrase);

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
          birthDate: birth.text,
          birthDateAsPhrase: birth.asPhrase,
          birthDatePhrase: person.birthDatePhrase,
          birthPlace: person.birthPlace,
          deathDate: death.text,
          deathDateAsPhrase: death.asPhrase,
          deathDatePhrase: person.deathDatePhrase,
          deathPlace: person.deathPlace,
          deathCause: person.deathCause,
          nickname: person.nickname,
          namePrefix: person.namePrefix,
          nameSuffix: person.nameSuffix,
          notes: person.notes,
        }}
      />
    </div>
  );
}
