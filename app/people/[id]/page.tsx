import Link from "next/link";
import { PlaceText } from "@/components/PlaceText";
import { placeLinksFor } from "@/lib/services/place-pages";
import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import {
  canCreateSources,
  compareEvents,
  getPersonDetail,
  listDuplicatesOfPerson,
  listFamilies,
  listPickablePersons,
  listSourceOptions,
  resolvePersonRedirect,
  type EventDto,
  type PersonCitation,
  type PersonRef,
  type PersonRelation,
} from "@/lib/services";
import { ALTERNATIVE_ONLY_TYPES } from "@/lib/events";
import {
  partnerCardDescription,
  partnerPlaces,
  isMarriage,
  partnershipNoun,
} from "@/lib/partner-labels";
import { EventSection, type EventOwnerOption, type EventRow } from "@/components/EventSection";
import { NameVariants } from "@/components/NameVariants";
import { PERSON_FACTS, relationshipFacts } from "@/lib/validation";
import {
  CitationSection,
  type CitationRow,
  type CitationTargetOption,
} from "@/components/CitationSection";
import { lifeSpan, formatDateOf } from "@/lib/tree-layout";
import { Avatar } from "@/components/Avatar";
import { LockIcon } from "@/components/PersonNode";
import { MediaGallery } from "@/components/MediaGallery";
import type { InheritedItem, MediaCandidate } from "@/components/AttachedMedia";
import { DeletePersonButton } from "@/components/DeletePersonButton";
import { DuplicateBanner } from "@/components/DuplicateBanner";
import { ReferencePanel } from "@/components/ReferencePanel";
import { MergeDialog } from "@/components/MergeDialog";
import { PersonFamilies } from "@/components/PersonFamilies";
import { PersonChanges } from "@/components/PersonChanges";
import { PersonOrigin } from "@/components/PersonOrigin";
import { getPersonOrigin } from "@/lib/services/origin";
import { getPersonRoots } from "@/lib/services/roots";
import { lifePathEntry } from "@/lib/services/life-path";
import { PersonRoots } from "@/components/PersonRoots";
import { gedcomPersonHref } from "@/lib/export-selection";
import { PersonBiography } from "@/components/PersonBiography";
import { getPersonBiography } from "@/lib/services/biography";
import { getLifetimeHistory } from "@/lib/services/history";
import { HISTORY_COOKIE, historyEnabled } from "@/lib/history/events";
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
  if (r.type === "PARTNER_OF") return `${partnershipNoun(r.subtype)} mit ${other}`;
  return r.role === "parent" ? `Abstammung von ${other}` : `Kind ${other}`;
}

function partnerDescription(r: PersonRelation): string {
  return partnerCardDescription(r.subtype, formatDateOf(r, "startDate") || null, formatDateOf(r, "endDate") || null);
}

/** Abweichende Hauptangabe (zweite Geburt, Heirat …) in einer Zeile: „1859 in Celle“. */
function altText(e: EventDto): string {
  return [e.dateText || "ohne Datum", e.place ? `in ${e.place}` : null].filter(Boolean).join(" ");
}

/** Hinweis auf abweichende Angaben neben der Hauptangabe, verlinkt zur Ereigniszeile. */
function AltFacts({ events, prefix = "" }: { events: EventDto[]; prefix?: string }) {
  if (events.length === 0) return null;
  return (
    <span className="mt-1 block space-y-0.5">
      {events.map((e) => (
        <a
          key={e.id}
          href={`#ereignis-${e.id}`}
          className="flex flex-wrap items-baseline gap-1.5 text-xs text-brass-700 hover:underline dark:text-brass-300"
          data-testid="alternative-fact"
        >
          <span className="badge-alt">abweichende Angabe</span>
          <span>
            {prefix}
            {altText(e)}
          </span>
        </a>
      ))}
    </span>
  );
}

/**
 * Belegbilder: Scans und Fotos an Ereignissen, Belegen und zitierten Quellen
 * — getrennt von den Porträt- und Familienbildern der Galerie. Antippen
 * öffnet das Bild groß (wie in der Galerie).
 */
function DocumentImages({ items }: { items: { mediaId: string; caption: string | null; where: string[] }[] }) {
  return (
    <section aria-labelledby="document-images-h" className="card space-y-3 p-5" data-testid="document-images">
      <div>
        <h2 id="document-images-h" className="section-title">
          Belegbilder{" "}
          <span className="font-sans text-sm font-normal muted">({items.length})</span>
        </h2>
        <p className="text-sm muted">Scans und Fotos zu Ereignissen, Belegen und Quellen.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {items.map((m) => (
          <li key={m.mediaId} data-testid="document-image">
            <figure>
              <a
                href={`/api/media/${m.mediaId}`}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl"
                aria-label={`${m.caption ?? `Belegbild ${m.where[0] ?? ""}`.trim()} in voller Größe öffnen`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${m.mediaId}?variant=thumb`}
                  alt={m.caption ?? `Belegbild: ${m.where[0] ?? ""}`.trim()}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-xl object-cover"
                />
              </a>
              <figcaption className="mt-1 space-y-0.5 text-xs">
                {m.caption && <span className="block truncate font-medium">{m.caption}</span>}
                {m.where.map((w) => (
                  <span key={w} className="block truncate muted" title={w}>
                    {w}
                  </span>
                ))}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RelativeCard({
  person,
  portrait,
  note,
  extra,
  children,
}: {
  person: PersonRef;
  portrait: string | null;
  note?: string | null;
  /** Weitere Zeilen unter der Notiz (Orte, abweichende Angaben). */
  extra?: React.ReactNode;
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
      {extra && <div className="px-3 pb-2 text-xs">{extra}</div>}
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
  searchParams: Promise<{ rel?: string; bezug?: string }>;
}) {
  const { id } = await params;
  const { rel: linkedRelation, bezug } = await searchParams;

  // Nicht sichtbar = nicht vorhanden. Ein eigener Hinweis würde bestätigen,
  // dass es diese Person gibt. Verwandte, die der Benutzer nicht sehen darf,
  // liefert der Dienst bereits als Platzhalter.
  const { scope, detail } = await loadDetail(id);
  if (!detail) {
    // Alte Kennung einer aufgegangenen Person: weiter zur bleibenden — nur,
    // wenn sie für diesen Benutzer sichtbar ist (lib/services/redirects.ts).
    const mergedInto = await resolvePersonRedirect(scope, id);
    if (mergedInto) permanentRedirect(`/people/${mergedInto}`);
    notFound();
  }

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
  // Mögliche Dubletten ebenfalls nur für Bearbeiter; der Dienst prüft das Recht
  // an beiden Einträgen selbst noch einmal.
  const [allPersons, allFamilies, sourceOptions, duplicates] = canEdit
    ? await Promise.all([
        listPickablePersons(scope, { excludeId: id }),
        listFamilies(scope).then((list) => list.map(({ id, name }) => ({ id, name }))),
        listSourceOptions(scope),
        listDuplicatesOfPerson(scope, id),
      ])
    : [[], [], [], null];

  // Herkunft (Importe, Zusammenführungen, Chips an den Einträgen) — nur für
  // Bearbeiter; der Dienst prüft das Recht selbst noch einmal.
  // Wurzeln (Standard: 4. Generation, nach Land) gleich mitliefern; ohne
  // leibliche Eltern entfällt der Abschnitt (components/PersonRoots.tsx).
  // Einstieg „Lebensweg auf der Karte“ nur, wenn der Weg mindestens zwei
  // Punkte hat (eigene Stationen, sonst Vater- bzw. Mutterlinie).
  // Lebenslauf: Text aus den schon geladenen Daten (nur Sichtbares), dazu
  // eine Abfrage der Eltern-Kind-Kanten (lib/services/biography.ts).
  // Zeitgeschichte zur Lebenszeit (lib/history/lifetime.ts) — nur Zusatz unter dem Lebenslauf.
  const [origin, roots, lifePath, biography, lifetimeHistory] = await Promise.all([
    canEdit ? getPersonOrigin(scope, id) : null,
    getPersonRoots(scope, id),
    lifePathEntry(scope, id),
    getPersonBiography(detail),
    getLifetimeHistory(detail),
  ]);

  // Lebensereignisse: die der Person und die ihrer Beziehungen in einer
  // Liste (eine Stelle zum Lesen und Bearbeiten), chronologisch.
  const ownerLabelOf = new Map<string, string>(
    detail.relations.map((r) => [
      r.relationshipId,
      r.type === "PARTNER_OF"
        ? r.other.restricted
          ? `${partnershipNoun(r.subtype)} (Partner nicht freigegeben)`
          : `mit ${name(r.other)}`
        : r.other.restricted
          ? "Eltern-Kind-Beziehung"
          : `${r.role === "parent" ? "Elternteil" : "Kind"} ${name(r.other)}`,
    ]),
  );
  const allEvents: (EventDto & { ownerKey: string })[] = [
    ...detail.events.map((e) => ({ ...e, ownerKey: "person" })),
    ...detail.relations.flatMap((r) => r.events.map((e) => ({ ...e, ownerKey: r.relationshipId }))),
  ].sort(compareEvents);
  const eventLabelOf = new Map(allEvents.map((e) => [e.id, [e.title, e.dateText].filter(Boolean).join(" ")]));
  // Belegbilder (docs/fachlich/bilder-an-eintraegen.md):
  // Bilder an Ereignissen, an Belegen und — nach der Regel in
  // lib/services/attached-media.ts — Bilder der zitierten Quellen.
  const citationWhere = (c: PersonCitation) =>
    [c.source.title, c.detail].filter(Boolean).join(", ");
  const documentImagesOf = (eventId: string, own: Set<string>) => {
    const seen = new Set(own);
    const out: InheritedItem[] = [];
    for (const c of detail.citations.filter((x) => x.eventId === eventId)) {
      for (const m of c.media ?? []) {
        if (seen.has(m.mediaId)) continue;
        seen.add(m.mediaId);
        // Bild am Beleg eines Ereignisses: steht nur hier (nicht zusätzlich im
        // Abschnitt „Quellen“) und lässt sich hier lösen.
        out.push({
          mediaId: m.mediaId,
          caption: m.caption,
          note: `Beleg: ${citationWhere(c)}`,
          unlinkTarget: { kind: "citation", id: c.id },
        });
      }
      for (const m of c.sourceMedia ?? []) {
        if (seen.has(m.mediaId)) continue;
        seen.add(m.mediaId);
        out.push({ mediaId: m.mediaId, caption: m.caption, note: `Quelle: ${c.source.title}` });
      }
    }
    return out;
  };
  const eventRows: EventRow[] = allEvents.map((e) => ({
    ...e,
    ownerLabel: e.ownerKey === "person" ? null : (ownerLabelOf.get(e.ownerKey) ?? null),
    citations: detail.citations
      .filter((c) => c.eventId === e.id)
      .map((c) => ({ id: c.id, sourceId: c.source.id, sourceTitle: c.source.title, detail: c.detail })),
    media: (e.media ?? []).map((m) => ({ mediaId: m.mediaId, caption: m.caption })),
    documentImages: documentImagesOf(e.id, new Set((e.media ?? []).map((m) => m.mediaId))),
  }));

  // Alle Belegbilder der Seite in einer Übersicht, je Bild mit Herkunft.
  const documentImages = new Map<string, { mediaId: string; caption: string | null; where: string[] }>();
  const addDoc = (m: { mediaId: string; caption: string | null }, where: string) => {
    const entry = documentImages.get(m.mediaId) ?? { mediaId: m.mediaId, caption: m.caption, where: [] };
    if (!entry.where.includes(where)) entry.where.push(where);
    documentImages.set(m.mediaId, entry);
  };
  for (const e of allEvents) for (const m of e.media ?? []) addDoc(m, eventLabelOf.get(e.id) ?? e.title);
  for (const c of detail.citations) {
    const about = c.eventId ? (eventLabelOf.get(c.eventId) ?? c.eventTitle) : c.relationship ? relationLabel(c.relationship) : null;
    const where = [about, citationWhere(c)].filter(Boolean).join(" · ");
    for (const m of c.media ?? []) addDoc(m, where);
    for (const m of c.sourceMedia ?? []) addDoc(m, `${about ? `${about} · ` : ""}Quelle ${c.source.title}`);
  }

  // Vorhandene Bilder dieser Seite, die sich an Ereignisse und Belege hängen lassen.
  const candidateMap = new Map<string, MediaCandidate>();
  const addCandidate = (m: { mediaId: string; caption: string | null }, where: string) => {
    if (!candidateMap.has(m.mediaId)) candidateMap.set(m.mediaId, { mediaId: m.mediaId, label: `${m.caption ?? "Bild ohne Beschriftung"} — ${where}` });
  };
  if (canEdit) {
    for (const m of detail.media) addCandidate(m, name(person));
    for (const r of detail.relations) if (!r.other.restricted) for (const m of r.media) addCandidate(m, relationLabel(r));
    for (const d of documentImages.values()) addCandidate(d, d.where[0] ?? "Beleg");
  }
  const mediaCandidates = [...candidateMap.values()];
  const eventOwners: EventOwnerOption[] = [
    { key: "person", label: name(person), owner: { kind: "person" } },
    ...detail.partners
      .filter((r) => canEdit && !r.other.restricted)
      .map((r) => ({
        key: r.relationshipId,
        label: relationLabel(r),
        owner: { kind: "relationship" as const, type: "PARTNER_OF" as const },
      })),
  ];
  const altOf = (events: EventDto[], type: string) =>
    events.filter((e) => e.isAlternative && e.type === type && ALTERNATIVE_ONLY_TYPES.includes(e.type));

  // Belege: je Beziehung gezählt (für die Beziehungsliste) und für den
  // Abschnitt „Quellen“ mit lesbarem Bezug.
  const citationCount = new Map<string, number>();
  for (const c of detail.citations) {
    if (c.relationshipId && !c.eventId) citationCount.set(c.relationshipId, (citationCount.get(c.relationshipId) ?? 0) + 1);
  }
  const citationRows: CitationRow[] = detail.citations.map((c: PersonCitation) => ({
    id: c.id,
    fact: c.fact,
    detail: c.detail,
    url: c.url,
    confidence: c.confidence,
    canEdit: c.canEdit,
    source: c.source,
    relationshipId: c.relationshipId,
    relationLabel: c.relationship ? relationLabel(c.relationship) : null,
    eventId: c.eventId,
    eventLabel: c.eventId ? eventLabelOf.get(c.eventId) ?? c.eventTitle ?? null : null,
    // Entscheidung des Eigentümers: ein Bild nur am Eintrag (+ „Belegbilder“).
    // Belegt der Beleg ein Ereignis, stehen seine Bilder in der Ereigniszeile.
    media: c.eventId ? [] : (c.media ?? []).map((m) => ({ mediaId: m.mediaId, caption: m.caption })),
    sourceMedia: c.eventId ? [] : (c.sourceMedia ?? []).map((m) => ({ mediaId: m.mediaId, caption: m.caption })),
    imagesAtEvent: c.eventId ? (c.media?.length ?? 0) + (c.sourceMedia?.length ?? 0) : 0,
  }));
  const citationTargets: CitationTargetOption[] = [
    { value: "person", label: name(person), facts: [...PERSON_FACTS] },
    ...[...detail.partners, ...detail.parents, ...detail.children].map((r) => ({
      value: r.relationshipId,
      label: relationLabel(r),
      facts: [...relationshipFacts(r.type)],
    })),
    ...allEvents
      .filter((e) => e.canEdit)
      .map((e) => ({ value: `event:${e.id}`, label: eventLabelOf.get(e.id)!, facts: ["EVENT" as const] })),
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
      startDateTo: r.startDateTo,
      startDateToPrecision: r.startDateToPrecision,
      startDatePhrase: r.startDatePhrase,
      startPlace: r.startPlace,
      endDateTo: r.endDateTo,
      endDateToPrecision: r.endDateToPrecision,
      endDatePhrase: r.endDatePhrase,
      endPlace: r.endPlace,
      citationCount: citationCount.get(r.relationshipId) ?? 0,
      otherId: r.other.id,
      otherName: r.other.restricted ? "Nicht freigegeben" : name(r.other),
      otherRestricted: Boolean(r.other.restricted),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Ortsverweise der Seite in einer Abfrage (Freitext → Ortsseite).
  const placeLinks = await placeLinksFor([
    person.birthPlace,
    person.deathPlace,
    ...detail.relations.flatMap((r) => (r.other.restricted ? [] : [r.startPlace, r.endPlace])),
    ...allEvents.map((e) => e.place),
  ]);
  const fact = (key: "birthDate" | "deathDate", place: string | null) => {
    const date = formatDateOf(person, key);
    if (!date && !place) return null;
    return (
      <>
        {date}
        {date && place && " in "}
        <PlaceText text={place} links={placeLinks} />
      </>
    );
  };
  const birth = fact("birthDate", person.birthPlace);
  const death = fact("deathDate", person.deathPlace);
  const deceased = Boolean(person.deathDate || person.deathDatePhrase);

  return (
    <div className="space-y-8">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/people" className="btn-link text-sm">
          ← Alle Personen
        </Link>
      </nav>

      {duplicates && <DuplicateBanner personId={person.id} duplicates={duplicates} />}

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
              {person.namePrefix && (
                <span className="mr-2 text-xl font-normal text-stone-500 sm:text-2xl dark:text-stone-400">
                  {person.namePrefix}
                </span>
              )}
              {person.namePrefix && " "}
              {name(person)}
              {person.nameSuffix && " "}
              {person.nameSuffix && (
                <span className="ml-2 text-xl font-normal text-stone-500 sm:text-2xl dark:text-stone-400">
                  {person.nameSuffix}
                </span>
              )}
            </h1>
            <p className="muted" data-testid="person-subtitle">
              {lifeSpan(person) || "Lebensdaten unbekannt"}
              {person.birthName && ` · geb. ${person.birthName}`}
              {person.nickname && ` · genannt „${person.nickname}“`}
              {deceased && " · verstorben"}
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
            {lifePath && (
              <Link
                href={`/map?person=${person.id}&mode=lebensweg${lifePath === "person" ? "" : `&art=${lifePath === "father" ? "vaterlinie" : "mutterlinie"}`}`}
                className="btn-secondary"
                data-testid="person-lifepath-link"
              >
                Lebensweg auf der Karte
              </Link>
            )}
            {canEdit && <MergeDialog personId={person.id} personName={name(person)} people={allPersons} />}
          </div>
        </div>

        <dl className="relative mt-6 grid gap-4 border-t border-stone-200 pt-5 text-sm sm:grid-cols-3 dark:border-stone-800">
          <div>
            <dt className="eyebrow">Geboren</dt>
            <dd className="mt-1">
              <span data-testid="person-birth">{birth || "—"}</span>
              <AltFacts events={altOf(detail.events, "BIRTH")} />
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Gestorben</dt>
            <dd className="mt-1">
              <span data-testid="person-death">{death || "—"}</span>
              {person.deathCause && (
                <span className="mt-0.5 block text-xs muted" data-testid="person-death-cause">
                  Ursache: {person.deathCause}
                </span>
              )}
              <AltFacts events={altOf(detail.events, "DEATH")} />
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Geschlecht</dt>
            <dd className="mt-1">{GENDER_LABEL[person.gender]}</dd>
          </div>
        </dl>
      </header>

      {biography && (
        <PersonBiography
          biography={biography}
          history={lifetimeHistory}
          initialHistory={historyEnabled((await cookies()).get(HISTORY_COOKIE)?.value)}
        />
      )}

      <ReferencePanel scope={scope} personId={person.id} personName={name(person)} bezug={bezug} />

      {person.notes && (
        <section aria-labelledby="notes-h" className="card p-5">
          <h2 id="notes-h" className="section-title mb-2">
            Notizen
          </h2>
          <p className="whitespace-pre-wrap leading-relaxed">{person.notes}</p>
        </section>
      )}

      <EventSection
        personId={person.id}
        events={eventRows}
        owners={eventOwners}
        canEdit={canEdit}
        mediaCandidates={mediaCandidates}
        placeLinks={placeLinks}
        origin={origin?.chips}
      />

      <NameVariants personId={person.id} names={detail.names} canEdit={canEdit} origin={origin?.chips} />

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
                extra={
                  r.other.restricted ? undefined : (partnerPlaces(r.subtype, r.startPlace, r.endPlace) ||
                    altOf(r.events, "MARRIAGE").length + altOf(r.events, "DIVORCE").length > 0) ? (
                    <>
                      {partnerPlaces(r.subtype, r.startPlace, r.endPlace) && (
                        <span className="block muted" data-testid="partner-places">
                          {r.startPlace && (
                            <>
                              {isMarriage(r.subtype) ? "Hochzeit in " : "Beginn in "}
                              <PlaceText text={r.startPlace} links={placeLinks} />
                            </>
                          )}
                          {r.startPlace && r.endPlace && " · "}
                          {r.endPlace && (
                            <>
                              {r.subtype === "DIVORCED" ? "Scheidung in " : "Ende in "}
                              <PlaceText text={r.endPlace} links={placeLinks} />
                            </>
                          )}
                        </span>
                      )}
                      <AltFacts events={altOf(r.events, "MARRIAGE")} prefix="Heirat " />
                      <AltFacts events={altOf(r.events, "DIVORCE")} prefix="Scheidung " />
                    </>
                  ) : undefined
                }
              >
                {/* Hochzeitsbilder direkt an der Ehe. Aus dem Stammbaum
                    verlinkt (?rel=…) ist dieser Abschnitt gleich offen. */}
                {(r.media.length > 0 || canEdit) && (
                  <details
                    open={linkedRelation === r.relationshipId}
                    id={`rel-${r.relationshipId}`}
                    className="border-t border-stone-200 px-3 py-2 dark:border-stone-800"
                  >
                    <summary className="cursor-pointer text-xs font-medium text-accent-700 max-md:py-3 max-md:text-sm dark:text-accent-300">
                      {r.media.length > 0
                        ? `${r.media.length} ${r.media.length === 1 ? "Bild" : "Bilder"} zur ${partnershipNoun(r.subtype)}`
                        : `Bilder zur ${partnershipNoun(r.subtype)} hinzufügen`}
                    </summary>
                    <div className="pt-2">
                      <MediaGallery
                        owner={{ kind: "relationship", id: r.relationshipId }}
                        items={r.media}
                        canUpload={canEdit}
                        canDelete={canEdit}
                        title={r.subtype === "MARRIED" || r.subtype === "DIVORCED" ? "Hochzeitsbilder" : "Bilder zur Partnerschaft"}
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
        {/* Export „Ab einer Person“ auf /admin/data — dieselben Rechte wie dort
            (jeder Angemeldete exportiert, was er sieht). */}
        <p className="text-sm">
          <Link href={gedcomPersonHref(person.id)} className="btn-link max-md:inline-flex max-md:min-h-11 max-md:items-center" data-testid="person-gedcom-export-link">
            Vorfahren als GEDCOM exportieren …
          </Link>
        </p>
      </section>

      {roots && roots.parentCount > 0 && <PersonRoots personId={person.id} initial={roots} />}

      <CitationSection
        personId={person.id}
        citations={citationRows}
        targets={citationTargets}
        sources={sourceOptions}
        canEdit={canEdit}
        canCreateSource={canCreateSources(scope)}
        mediaCandidates={mediaCandidates}
        origin={origin?.chips}
      />

      {documentImages.size > 0 && <DocumentImages items={[...documentImages.values()]} />}

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

      {/* Herkunft: Inhalt in components/PersonOrigin.tsx */}
      {origin && <PersonOrigin origin={origin} />}

      {/* Changelog: Inhalt in components/PersonChanges.tsx */}
      {canEdit && <PersonChanges personId={person.id} />}

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
            origin={origin?.chips}
            newPersonFamilies={detail.families.filter(
              (f) => scope.isAdmin || editableFamilyIds(scope).includes(f.id),
            )}
          />

          <PersonFamilies
            personId={person.id}
            assigned={detail.families}
            available={allFamilies}
            editableFamilyIds={
              scope.isAdmin ? allFamilies.map((f) => f.id) : editableFamilyIds(scope)
            }
            canEdit={canEdit}
            isAdmin={scope.isAdmin}
          />

          <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
            <DeletePersonButton personId={person.id} personName={name(person)} />
          </div>
        </section>
      )}
    </div>
  );
}
