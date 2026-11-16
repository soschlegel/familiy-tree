import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import {
  canCreateSources,
  getPersonDetail,
  listFamilies,
  listPickablePersons,
  listSourceOptions,
  type PersonCitation,
  type PersonRef,
  type PersonRelation,
} from "@/lib/services";
import { PERSON_FACTS, relationshipFacts } from "@/lib/validation";
import {
  CitationSection,
  type CitationRow,
  type CitationTargetOption,
} from "@/components/CitationSection";
import { lifeSpan, formatDate } from "@/lib/tree-layout";
import { Avatar } from "@/components/Avatar";
import { LockIcon } from "@/components/PersonNode";
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

const ROLE_LABEL: Record<PersonRelation["role"], string> = {
  parent: "Elternteil",
  child: "Kind",
  partner: "Partner",
};

const GENDER_LABEL = {
  MALE: "männlich",
  FEMALE: "weiblich",
  OTHER: "divers",
  UNKNOWN: "unbekannt",
} as const;

const PARENT_NOTE: Record<string, string> = {
  ADOPTIVE: "Adoptivelternteil",
  STEP: "Stiefelternteil",
  FOSTER: "Pflegeelternteil",
};

const CHILD_NOTE: Record<string, string> = {
  ADOPTIVE: "Adoptivkind",
  STEP: "Stiefkind",
  FOSTER: "Pflegekind",
};

/**
 * Je Anfrage nur einmal laden — Titel und Seite brauchen dieselben Daten.
 * Die Rechteprüfung steckt in getPersonDetail (über den Scope).
 */
const loadDetail = cache(async (id: string) => {
  const { scope } = await requireScope();
  return { scope, detail: await getPersonDetail(scope, id) };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  // Kein Name im Titel ohne Rechteprüfung — der Titel ist Teil der Antwort.
  const { id } = await params;
  const { detail } = await loadDetail(id);
  return { title: detail ? name(detail.person) : "Nicht gefunden" };
}

/** Bezug einer Beziehung aus Sicht der Person: „Ehe mit …“, „Abstammung von …“. */
function relationLabel(r: {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  role: "parent" | "child" | "partner";
  other: PersonRef;
}): string {
  const other = r.other.restricted ? "Nicht freigegeben" : name(r.other);
  if (r.type === "PARTNER_OF") return r.subtype === "UNMARRIED" ? `Partnerschaft mit ${other}` : `Ehe mit ${other}`;
  return r.role === "parent" ? `Abstammung von ${other}` : `Kind ${other}`;
}

function partnerDescription(r: PersonRelation): string {
  const start = r.startDate ? formatDate(r.startDate, r.startDatePrecision, r.startDateQualifier) : null;
  const end = r.endDate ? formatDate(r.endDate, r.endDatePrecision, r.endDateQualifier) : null;
  switch (r.subtype) {
    case "MARRIED":
      return start ? `verheiratet seit ${start}` : "verheiratet";
    case "DIVORCED":
      return start && end
        ? `geschieden · ${start} – ${end}`
        : end
          ? `geschieden ${end}`
          : "geschieden";
    default:
      return start ? `Partnerschaft seit ${start}` : "Partnerschaft";
  }
}

function RelativeCard({
  person,
  portrait,
  note,
  children,
}: {
  person: PersonRef;
  portrait: string | null;
  note?: string | null;
  children?: React.ReactNode;
}) {
  if (person.restricted) {
    return (
      <li
        className="flex items-center gap-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700"
        data-testid="relative-restricted"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <LockIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-stone-600 dark:text-stone-400">
            Nicht freigegeben
          </span>
          <span className="block text-xs muted">
            Gehört zu einer Familie ohne Freigabe für dich
          </span>
        </span>
      </li>
    );
  }
  return (
    <li className="card overflow-hidden transition hover:border-accent-300 hover:shadow-lift dark:hover:border-accent-700">
      <Link href={`/people/${person.id}`} className="group flex items-center gap-3 p-3">
        <Avatar person={{ ...person, primaryMediaId: portrait }} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold group-hover:text-accent-800 dark:group-hover:text-accent-200">
            {name(person)}
          </span>
          <span className="block truncate text-sm muted">
            {lifeSpan(person) || "Lebensdaten unbekannt"}
          </span>
          {note && (
            <span className="mt-0.5 block text-xs font-medium text-accent-700 dark:text-accent-300">
              {note}
            </span>
          )}
        </span>
      </Link>
      {children}
    </li>
  );
}

function Group({
  title,
  testId,
  empty,
  children,
}: {
  title: string;
  testId: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section aria-labelledby={`${testId}-h`} data-testid={testId}>
      <h3 id={`${testId}-h`} className="eyebrow mb-2">
        {title}
      </h3>
      {children.length === 0 ? (
        <p className="text-sm muted">{empty}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">{children}</ul>
      )}
    </section>
  );
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rel?: string }>;
}) {
  const { id } = await params;
  const { rel: linkedRelation } = await searchParams;

  // Nicht sichtbar = nicht vorhanden. Ein eigener Hinweis würde bestätigen,
  // dass es diese Person gibt. Verwandte, die der Benutzer nicht sehen darf,
  // liefert der Dienst bereits als Platzhalter.
  const { scope, detail } = await loadDetail(id);
  if (!detail) notFound();

  const { person, canEdit } = detail;

  // Porträts der sichtbaren Verwandten. Platzhalter bekommen bewusst keines.
  const visibleRelativeIds = [
    ...detail.relations.map((r) => r.other),
    ...detail.siblings.map((s) => s.person),
  ]
    .filter((p) => !p.restricted)
    .map((p) => p.id);
  const portraits = new Map(
    (
      await prisma.personMedia.findMany({
        where: { personId: { in: visibleRelativeIds }, isPrimary: true },
        select: { personId: true, mediaId: true },
      })
    ).map((m) => [m.personId, m.mediaId]),
  );
  const portraitOf = (p: PersonRef) => (p.restricted ? null : (portraits.get(p.id) ?? null));

  // Auswahl und Familienliste brauchen nur Bearbeiter. Nur sichtbare Personen
  // anbieten — die Suchhilfe darf keine Namen aus fremden Familien preisgeben.
  const [allPersons, allFamilies, sourceOptions] = canEdit
    ? await Promise.all([
        listPickablePersons(scope, { excludeId: id }),
        listFamilies(scope).then((list) => list.map(({ id, name }) => ({ id, name }))),
        listSourceOptions(scope),
      ])
    : [[], [], []];

  // Belege: je Beziehung gezählt (für die Beziehungsliste) und für den
  // Abschnitt „Quellen“ mit lesbarem Bezug.
  const citationCount = new Map<string, number>();
  for (const c of detail.citations) {
    if (c.relationshipId) citationCount.set(c.relationshipId, (citationCount.get(c.relationshipId) ?? 0) + 1);
  }
  const citationRows: CitationRow[] = detail.citations.map((c: PersonCitation) => ({
    id: c.id,
    fact: c.fact,
    detail: c.detail,
    confidence: c.confidence,
    canEdit: c.canEdit,
    source: c.source,
    relationshipId: c.relationshipId,
    relationLabel: c.relationship ? relationLabel(c.relationship) : null,
  }));
  const citationTargets: CitationTargetOption[] = [
    { value: "person", label: name(person), facts: [...PERSON_FACTS] },
    ...[...detail.partners, ...detail.parents, ...detail.children].map((r) => ({
      value: r.relationshipId,
      label: relationLabel(r),
      facts: [...relationshipFacts(r.type)],
    })),
  ];

  const relations: RelationRow[] = detail.relations
    .map((r) => ({
      id: r.relationshipId,
      label: ROLE_LABEL[r.role],
      subtype: r.subtype,
      startDate: r.startDate,
      endDate: r.endDate,
      startDatePrecision: r.startDatePrecision,
      startDateQualifier: r.startDateQualifier,
      endDatePrecision: r.endDatePrecision,
      endDateQualifier: r.endDateQualifier,
      citationCount: citationCount.get(r.relationshipId) ?? 0,
      otherId: r.other.id,
      otherName: r.other.restricted ? "Nicht freigegeben" : name(r.other),
      otherRestricted: Boolean(r.other.restricted),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const birth = [
    formatDate(person.birthDate, person.birthDatePrecision, person.birthDateQualifier),
    person.birthPlace,
  ]
    .filter(Boolean)
    .join(" in ");
  const death = [
    formatDate(person.deathDate, person.deathDatePrecision, person.deathDateQualifier),
    person.deathPlace,
  ]
    .filter(Boolean)
    .join(" in ");

  return (
    <div className="space-y-8">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/people" className="btn-link text-sm">
          ← Alle Personen
        </Link>
      </nav>

      <header className="card relative overflow-hidden p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent-50 to-transparent dark:from-accent-900/30"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar person={person} size="lg" />
          <div className="min-w-0 flex-1 space-y-2">
            {detail.families.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {detail.families.map((f) => (
                  <span key={f.id} className="badge-accent">
                    {f.name}
                  </span>
                ))}
              </p>
            )}
            <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              {name(person)}
            </h1>
            <p className="muted">
              {lifeSpan(person) || "Lebensdaten unbekannt"}
              {person.birthName && ` · geb. ${person.birthName}`}
              {person.deathDate && " · verstorben"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
            {canEdit && (
              <Link href={`/people/${person.id}/edit`} className="btn-primary">
                Bearbeiten
              </Link>
            )}
            <Link href={`/tree?focus=${person.id}`} className="btn-secondary">
              Im Stammbaum zeigen
            </Link>
          </div>
        </div>

        <dl className="relative mt-6 grid gap-4 border-t border-stone-200 pt-5 text-sm sm:grid-cols-3 dark:border-stone-800">
          <div>
            <dt className="eyebrow">Geboren</dt>
            <dd className="mt-1" data-testid="person-birth">{birth || "—"}</dd>
          </div>
          <div>
            <dt className="eyebrow">Gestorben</dt>
            <dd className="mt-1" data-testid="person-death">{death || "—"}</dd>
          </div>
          <div>
            <dt className="eyebrow">Geschlecht</dt>
            <dd className="mt-1">{GENDER_LABEL[person.gender]}</dd>
          </div>
        </dl>
      </header>

      {person.notes && (
        <section aria-labelledby="notes-h" className="card p-5">
          <h2 id="notes-h" className="section-title mb-2">
            Notizen
          </h2>
          <p className="whitespace-pre-wrap leading-relaxed">{person.notes}</p>
        </section>
      )}

      <section aria-labelledby="family-h" className="space-y-5">
        <h2 id="family-h" className="section-title">
          Familie
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Group title="Eltern" testId="relatives-parents" empty="Keine Eltern erfasst.">
            {detail.parents.map((r) => (
              <RelativeCard
                key={r.relationshipId}
                person={r.other}
                portrait={portraitOf(r.other)}
                note={PARENT_NOTE[r.subtype] ?? null}
              />
            ))}
          </Group>
          <Group title="Geschwister" testId="relatives-siblings" empty="Keine Geschwister erfasst.">
            {detail.siblings.map((s) => (
              <RelativeCard
                key={s.person.id}
                person={s.person}
                portrait={portraitOf(s.person)}
                note={s.kind === "half" ? "Halbgeschwister" : null}
              />
            ))}
          </Group>
          <Group title="Partner" testId="relatives-partners" empty="Keine Partnerschaft erfasst.">
            {detail.partners.map((r) => (
              <RelativeCard
                key={r.relationshipId}
                person={r.other}
                portrait={portraitOf(r.other)}
                note={partnerDescription(r)}
              >
                {/* Hochzeitsbilder direkt an der Ehe. Aus dem Stammbaum
                    verlinkt (?rel=…) ist dieser Abschnitt gleich offen. */}
                {(r.media.length > 0 || canEdit) && (
                  <details
                    open={linkedRelation === r.relationshipId}
                    id={`rel-${r.relationshipId}`}
                    className="border-t border-stone-200 px-3 py-2 dark:border-stone-800"
                  >
                    <summary className="cursor-pointer text-xs font-medium text-accent-700 dark:text-accent-300">
                      {r.media.length > 0
                        ? `${r.media.length} ${r.media.length === 1 ? "Bild" : "Bilder"} zur ${r.subtype === "UNMARRIED" ? "Partnerschaft" : "Ehe"}`
                        : "Bilder zur Ehe hinzufügen"}
                    </summary>
                    <div className="pt-2">
                      <MediaGallery
                        owner={{ kind: "relationship", id: r.relationshipId }}
                        items={r.media}
                        canUpload={canEdit}
                        canDelete={canEdit}
                        title={r.subtype === "UNMARRIED" ? "Bilder zur Partnerschaft" : "Hochzeitsbilder"}
                        compact
                      />
                    </div>
                  </details>
                )}
              </RelativeCard>
            ))}
          </Group>
          <Group title="Kinder" testId="relatives-children" empty="Keine Kinder erfasst.">
            {detail.children.map((r) => (
              <RelativeCard
                key={r.relationshipId}
                person={r.other}
                portrait={portraitOf(r.other)}
                note={CHILD_NOTE[r.subtype] ?? null}
              />
            ))}
          </Group>
        </div>
      </section>

      <CitationSection
        personId={person.id}
        citations={citationRows}
        targets={citationTargets}
        sources={sourceOptions}
        canEdit={canEdit}
        canCreateSource={canCreateSources(scope)}
      />

      <div className="card p-5">
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
      </div>

      {canEdit && (
        <section aria-labelledby="manage-h" className="space-y-6 rounded-2xl border border-stone-200 bg-stone-100/50 p-5 dark:border-stone-800 dark:bg-stone-900/40">
          <div>
            <h2 id="manage-h" className="section-title">
              Verwaltung
            </h2>
            <p className="text-sm muted">
              Beziehungen, Familienzuordnung und Löschen — nur für Bearbeiter sichtbar.
            </p>
          </div>

          <RelationshipEditor
            personId={person.id}
            relations={relations}
            people={allPersons}
            canEdit={canEdit}
          />

          <PersonFamilies
            personId={person.id}
            assigned={detail.families}
            available={allFamilies}
            editableFamilyIds={
              scope.isAdmin ? allFamilies.map((f) => f.id) : editableFamilyIds(scope)
            }
            canEdit={canEdit}
          />

          <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
            <DeletePersonButton personId={person.id} personName={name(person)} />
          </div>
        </section>
      )}
    </div>
  );
}
