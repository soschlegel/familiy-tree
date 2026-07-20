import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { can } from "@/lib/authz";
import { lifeSpan, formatDate } from "@/lib/tree-layout";
import { MediaGallery } from "@/components/MediaGallery";
import { DeletePersonButton } from "@/components/DeletePersonButton";
import {
  RelationshipEditor,
  type RelationRow,
} from "@/components/RelationshipEditor";

export const dynamic = "force-dynamic";

const name = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePage("person:read");
  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      relationsFrom: {
        include: {
          toPerson: true,
          media: { include: { media: true }, orderBy: { isPrimary: "desc" } },
        },
      },
      relationsTo: {
        include: {
          fromPerson: true,
          media: { include: { media: true }, orderBy: { isPrimary: "desc" } },
        },
      },
      media: {
        include: { media: true },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
      },
    },
  });

  if (!person) notFound();

  const allPersons = await prisma.person.findMany({
    where: { id: { not: id } },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    select: {
      id: true,
      givenName: true,
      familyName: true,
      birthDate: true,
      deathDate: true,
    },
  });

  // Beide Beziehungsrichtungen in eine flache, lesbare Liste bringen.
  const relations: RelationRow[] = [
    ...person.relationsFrom.map((r) => ({
      id: r.id,
      label: r.type === "PARENT_OF" ? "Kind" : "Partner",
      subtype: r.subtype,
      startDate: r.startDate?.toISOString() ?? null,
      endDate: r.endDate?.toISOString() ?? null,
      otherId: r.toPerson.id,
      otherName: name(r.toPerson),
      media: r.media.map((m) => ({
        mediaId: m.mediaId,
        caption: m.media.caption,
        isPrimary: m.isPrimary,
      })),
    })),
    ...person.relationsTo.map((r) => ({
      id: r.id,
      label: r.type === "PARENT_OF" ? "Elternteil" : "Partner",
      subtype: r.subtype,
      startDate: r.startDate?.toISOString() ?? null,
      endDate: r.endDate?.toISOString() ?? null,
      otherId: r.fromPerson.id,
      otherName: name(r.fromPerson),
      media: r.media.map((m) => ({
        mediaId: m.mediaId,
        caption: m.media.caption,
        isPrimary: m.isPrimary,
      })),
    })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const canEdit = can(session.user.role, "person:update");
  const fmt = (d: Date | null) => formatDate(d) || "—";

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{name(person)}</h1>
          <p className="text-stone-500">
            {lifeSpan({
              birthDate: person.birthDate?.toISOString() ?? null,
              deathDate: person.deathDate?.toISOString() ?? null,
            })}
            {person.birthName && ` · geb. ${person.birthName}`}
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/people/${person.id}/edit`}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Bearbeiten
          </Link>
        )}
      </header>

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
        people={allPersons.map((p) => ({
          id: p.id,
          givenName: p.givenName,
          familyName: p.familyName,
          birthDate: p.birthDate?.toISOString() ?? null,
          deathDate: p.deathDate?.toISOString() ?? null,
        }))}
        canEdit={can(session.user.role, "relationship:create")}
        canUploadMedia={can(session.user.role, "media:upload")}
        canDeleteMedia={can(session.user.role, "media:delete")}
      />

      <MediaGallery
        owner={{ kind: "person", id: person.id }}
        items={person.media.map((m) => ({
          mediaId: m.mediaId,
          caption: m.media.caption,
          isPrimary: m.isPrimary,
        }))}
        canUpload={can(session.user.role, "media:upload")}
        canDelete={can(session.user.role, "media:delete")}
      />

      {can(session.user.role, "person:delete") && (
        <DeletePersonButton
          personId={person.id}
          personName={name(person)}
        />
      )}
    </div>
  );
}
