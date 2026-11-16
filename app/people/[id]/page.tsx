import Link from "next/link";
import { notFound } from "next/navigation";

import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import {
  getPersonDetail,
  listFamilies,
  listPickablePersons,
  type PersonRelation,
} from "@/lib/services";
import { lifeSpan, formatDate } from "@/lib/tree-layout";
import { MediaGallery } from "@/components/MediaGallery";
import { DeletePersonButton } from "@/components/DeletePersonButton";
import { PersonFamilies } from "@/components/PersonFamilies";
import {
  RelationshipEditor,
  type RelationRow,
} from "@/components/RelationshipEditor";

export const dynamic = "force-dynamic";

const name = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

const LABEL: Record<PersonRelation["role"], string> = {
  parent: "Elternteil",
  child: "Kind",
  partner: "Partner",
};

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { scope } = await requireScope();
  const { id } = await params;

  // Nicht sichtbar = nicht vorhanden. Ein eigener Hinweis würde bestätigen,
  // dass es diese Person gibt. Verwandte, die der Benutzer nicht sehen darf,
  // liefert der Dienst bereits als Platzhalter.
  const detail = await getPersonDetail(scope, id);
  if (!detail) notFound();

  const { person, canEdit } = detail;

  // Nur sichtbare Personen zur Auswahl anbieten — die Suchhilfe darf keine
  // Namen aus fremden Familien preisgeben.
  const [allPersons, allFamilies] = await Promise.all([
    listPickablePersons(scope, { excludeId: id }),
    listFamilies(scope).then((list) => list.map(({ id, name }) => ({ id, name }))),
  ]);

  // Beide Beziehungsrichtungen in eine flache, lesbare Liste bringen.
  const relations: RelationRow[] = detail.relations
    .map((r) => ({
      id: r.relationshipId,
      label: LABEL[r.role],
      subtype: r.subtype,
      startDate: r.startDate,
      endDate: r.endDate,
      otherId: r.other.id,
      otherName: name(r.other),
      media: r.media,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const fmt = (d: string | null) => formatDate(d) || "—";

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{name(person)}</h1>
          <p className="text-stone-500">
            {lifeSpan(person)}
            {person.birthName && ` · geb. ${person.birthName}`}
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/people/${person.id}/edit`}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Bearbeiten
          </Link>
        )}
      </header>

      <PersonFamilies
        personId={person.id}
        assigned={detail.families}
        available={allFamilies}
        editableFamilyIds={
          scope.isAdmin ? allFamilies.map((f) => f.id) : editableFamilyIds(scope)
        }
        canEdit={canEdit}
      />

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-stone-500">Geboren</dt>
          <dd>{fmt(person.birthDate)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Geburtsort</dt>
          <dd>{person.birthPlace ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Gestorben</dt>
          <dd>{fmt(person.deathDate)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Sterbeort</dt>
          <dd>{person.deathPlace ?? "—"}</dd>
        </div>
      </dl>

      {person.notes && (
        <section>
          <h2 className="mb-1 font-medium">Notizen</h2>
          <p className="whitespace-pre-wrap text-sm">{person.notes}</p>
        </section>
      )}

      <RelationshipEditor
        personId={person.id}
        relations={relations}
        people={allPersons}
        canEdit={canEdit}
        canUploadMedia={canEdit}
        canDeleteMedia={canEdit}
      />

      <MediaGallery
        owner={{ kind: "person", id: person.id }}
        items={detail.media.map((m) => ({
          mediaId: m.mediaId,
          caption: m.caption,
          isPrimary: m.isPrimary,
        }))}
        canUpload={canEdit}
        canDelete={canEdit}
      />

      {canEdit && (
        <DeletePersonButton personId={person.id} personName={name(person)} />
      )}
    </div>
  );
}
