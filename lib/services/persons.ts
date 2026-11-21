import type { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { audit, auditActor, fieldChanges } from "../audit";
import {
  canEditPerson,
  canEditRelationshipBetween,
  canViewPerson,
  editableFamilyIds,
  familyIdsOfPerson,
  personVisibilityFilter,
  viewableFamilyIds,
  type Scope,
} from "../scope";
import {
  personCreateInput,
  personDateIssues,
  personPatch,
} from "../validation";
import { buildGraphIndex, siblingsOf } from "../graph";
import {
  fuzzyColumns,
  fuzzyField,
  phraseAfterUpdate,
  type DatePrecision,
  type DateQualifier,
  type FuzzyDate,
} from "../dates";
import { loadEventsFor, toEventDto, type EventDto } from "./events";
import { toPersonNameDto, type PersonNameDto } from "./names";
import {
  forbiddenError,
  notFoundError,
  conflictError,
  parseOrThrow,
  validationError,
} from "./errors";
import { listPersonCitations, type PersonCitation } from "./sources";
import { removeOrphanedMedia } from "./media";
import {
  iso,
  toPersonRef,
  toPersonSummary,
  type PersonRef,
  type PersonSummary,
} from "./dto";

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

export type PersonSort = "name" | "birthDate" | "birthDateDesc" | "updatedAt";

export type SearchPersonsOptions = {
  /**
   * Freitext; jedes Wort muss in Vor-, Nach-, Geburts- oder Rufname bzw. in
   * einem weiteren Namen (PersonName) vorkommen.
   */
  q?: string;
  /** Nur Personen dieser Familie (fremde Familien liefern eine leere Liste). */
  familyId?: string;
  /** Ohne Angabe: alle Treffer. Höchstens 1000. */
  limit?: number;
  offset?: number;
  sort?: PersonSort;
  /** Geburtsjahr ab (einschließlich). Personen ohne Geburtsdatum fallen heraus. */
  bornFrom?: number;
  /** Geburtsjahr bis (einschließlich). */
  bornTo?: number;
  /**
   * Teilstring eines Orts der Person (ohne Groß-/Kleinschreibung): Geburts-
   * oder Sterbeort, Ort eines ihrer Ereignisse, Ort einer ihrer Heiraten bzw.
   * Scheidungen oder eines Ereignisses ihrer Beziehungen.
   */
  place?: string;
  gender?: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  /** true: nur mit Sterbedatum, false: nur ohne. */
  deceased?: boolean;
};

export type PersonListItem = PersonSummary & { relationCount: number };

export const MAX_PAGE_SIZE = 1000;

function searchWhere(
  scope: Scope,
  {
    q,
    familyId,
    bornFrom,
    bornTo,
    place,
    gender,
    deceased,
  }: Omit<SearchPersonsOptions, "limit" | "offset" | "sort">,
): Prisma.PersonWhereInput {
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const and: Prisma.PersonWhereInput[] = [personVisibilityFilter(scope)];

  for (const word of words) {
    and.push({
      OR: [
        { givenName: { contains: word, mode: "insensitive" } },
        { familyName: { contains: word, mode: "insensitive" } },
        { birthName: { contains: word, mode: "insensitive" } },
        { nickname: { contains: word, mode: "insensitive" } },
        {
          names: {
            some: {
              OR: [
                { givenName: { contains: word, mode: "insensitive" } },
                { familyName: { contains: word, mode: "insensitive" } },
                { nickname: { contains: word, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  if (familyId) {
    // Eine fremde Familie führt zu einem leeren Ergebnis, nicht zu einem
    // Fehler — sonst ließe sich ihre Existenz abfragen.
    if (!scope.isAdmin && !scope.families.has(familyId)) {
      and.push({ id: { in: [] } });
    } else {
      and.push({ families: { some: { familyId } } });
    }
  }

  const fromYear = Number.isFinite(bornFrom) ? Math.floor(bornFrom!) : undefined;
  const toYear = Number.isFinite(bornTo) ? Math.floor(bornTo!) : undefined;
  if (fromYear !== undefined || toYear !== undefined) {
    and.push({
      birthDate: {
        ...(fromYear !== undefined ? { gte: new Date(Date.UTC(fromYear, 0, 1)) } : {}),
        ...(toYear !== undefined ? { lt: new Date(Date.UTC(toYear + 1, 0, 1)) } : {}),
      },
    });
  }

  const placeText = place?.trim();
  if (placeText) {
    const like = { contains: placeText, mode: "insensitive" as const };
    const relationPlace: Prisma.RelationshipWhereInput = {
      OR: [{ startPlace: like }, { endPlace: like }, { events: { some: { place: like } } }],
    };
    and.push({
      OR: [
        { birthPlace: like },
        { deathPlace: like },
        { events: { some: { place: like } } },
        { relationsFrom: { some: relationPlace } },
        { relationsTo: { some: relationPlace } },
      ],
    });
  }

  if (gender) and.push({ gender });
  if (deceased === true) and.push({ deathDate: { not: null } });
  if (deceased === false) and.push({ deathDate: null });

  return { AND: and };
}

function sortOrder(sort: PersonSort | undefined): Prisma.PersonOrderByWithRelationInput[] {
  switch (sort) {
    case "birthDate":
      return [{ birthDate: { sort: "asc", nulls: "last" } }, { familyName: "asc" }, { givenName: "asc" }, { id: "asc" }];
    case "birthDateDesc":
      return [{ birthDate: { sort: "desc", nulls: "last" } }, { familyName: "asc" }, { givenName: "asc" }, { id: "asc" }];
    case "updatedAt":
      return [{ updatedAt: "desc" }, { id: "asc" }];
    default:
      return [{ familyName: "asc" }, { givenName: "asc" }, { id: "asc" }];
  }
}

/** Sichtbare Personen suchen. Unsichtbare erscheinen hier gar nicht. */
export async function searchPersons(
  scope: Scope,
  options: SearchPersonsOptions = {},
): Promise<{ items: PersonListItem[]; total: number }> {
  const where = searchWhere(scope, options);
  const take =
    options.limit === undefined
      ? undefined
      : Math.max(0, Math.min(MAX_PAGE_SIZE, Math.floor(options.limit)));
  const skip = Math.max(0, Math.floor(options.offset ?? 0));

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: sortOrder(options.sort),
      take,
      skip,
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
        families: { select: { familyId: true } },
        _count: { select: { relationsFrom: true, relationsTo: true } },
      },
    }),
    prisma.person.count({ where }),
  ]);

  return {
    total,
    items: rows.map(({ media, families, _count, ...p }) => ({
      ...toPersonSummary(scope, p, {
        familyIds: families.map((f) => f.familyId),
        primaryMediaId: media[0]?.mediaId ?? null,
      }),
      relationCount: _count.relationsFrom + _count.relationsTo,
    })),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type RelationMedia = {
  mediaId: string;
  caption: string | null;
  isPrimary: boolean;
};

export type PersonRelation = {
  relationshipId: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  /** Rolle der ANDEREN Person aus Sicht dieser Person. */
  role: "parent" | "child" | "partner";
  startDate: string | null;
  startDatePrecision: DatePrecision;
  startDateQualifier: DateQualifier;
  endDate: string | null;
  endDatePrecision: DatePrecision;
  endDateQualifier: DateQualifier;
  startDateTo: string | null;
  startDateToPrecision: DatePrecision;
  startDatePhrase: string | null;
  startPlace: string | null;
  endDateTo: string | null;
  endDateToPrecision: DatePrecision;
  endDatePhrase: string | null;
  endPlace: string | null;
  notes: string | null;
  other: PersonRef;
  /** Bilder zu dieser Beziehung (z.B. Hochzeitsfotos). */
  media: RelationMedia[];
  /** Ereignisse der Beziehung (Verlobung, Aufgebot, abweichende Heiratsangabe …). */
  events: EventDto[];
};

export type PersonSibling = {
  person: PersonRef;
  kind: "full" | "half";
  sharedParentIds: string[];
};

export type PersonDetail = {
  person: PersonSummary;
  canEdit: boolean;
  /** Familien der Person — nur die, die der Benutzer selbst kennt. */
  families: { id: string; name: string }[];
  media: {
    mediaId: string;
    caption: string | null;
    isPrimary: boolean;
    sortOrder: number;
    width: number | null;
    height: number | null;
  }[];
  /** Alle direkten Beziehungen in einer Liste. */
  relations: PersonRelation[];
  parents: PersonRelation[];
  children: PersonRelation[];
  partners: PersonRelation[];
  siblings: PersonSibling[];
  /** Belege zur Person und zu ihren Beziehungen (siehe sources.ts). */
  citations: PersonCitation[];
  /** Lebensereignisse der Person (ohne die ihrer Beziehungen), sortiert. */
  events: EventDto[];
  /** Weitere Namen. */
  names: PersonNameDto[];
};

/**
 * Eine Person samt Beziehungen. Liefert null, wenn es die Person nicht gibt
 * ODER der Benutzer sie nicht sehen darf — beides sieht für den Aufrufer
 * gleich aus. Verwandte, die der Benutzer nicht sehen darf, erscheinen als
 * Platzhalter (maskPerson).
 */
export async function getPersonDetail(
  scope: Scope,
  id: string,
): Promise<PersonDetail | null> {
  const relatedSelect = {
    id: true,
    givenName: true,
    familyName: true,
    birthName: true,
    gender: true,
    birthDate: true,
    birthPlace: true,
    deathDate: true,
    birthDatePrecision: true,
    birthDateQualifier: true,
    deathDatePrecision: true,
    deathDateQualifier: true,
    birthDateTo: true,
    birthDateToPrecision: true,
    deathDateTo: true,
    deathDateToPrecision: true,
    families: { select: { familyId: true } },
  } as const;
  const relMedia = {
    include: { media: { select: { caption: true } } },
    orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
  };

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      relationsFrom: {
        include: { toPerson: { select: relatedSelect }, media: relMedia },
      },
      relationsTo: {
        include: { fromPerson: { select: relatedSelect }, media: relMedia },
      },
      media: {
        include: { media: true },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
      },
      families: { include: { family: { select: { id: true, name: true } } } },
    },
  });

  if (!person) return null;

  const familyIds = person.families.map((f) => f.familyId);
  if (!canViewPerson(scope, familyIds)) return null;

  const ref = (p: { families: { familyId: string }[] } & Parameters<typeof toPersonRef>[1]) =>
    toPersonRef(
      canViewPerson(
        scope,
        p.families.map((f) => f.familyId),
      ),
      p,
    );

  const mediaOf = (
    items: { mediaId: string; isPrimary: boolean; media: { caption: string | null } }[],
  ): RelationMedia[] =>
    items.map((m) => ({
      mediaId: m.mediaId,
      caption: m.media.caption,
      isPrimary: m.isPrimary,
    }));

  const relations: PersonRelation[] = [
    ...person.relationsFrom.map((r) => ({
      relationshipId: r.id,
      type: r.type,
      subtype: r.subtype,
      role: r.type === "PARENT_OF" ? ("child" as const) : ("partner" as const),
      startDate: iso(r.startDate),
      startDatePrecision: r.startDatePrecision,
      startDateQualifier: r.startDateQualifier,
      endDate: iso(r.endDate),
      endDatePrecision: r.endDatePrecision,
      endDateQualifier: r.endDateQualifier,
      startDateTo: iso(r.startDateTo),
      startDateToPrecision: r.startDateToPrecision,
      startDatePhrase: r.startDatePhrase,
      startPlace: r.startPlace,
      endDateTo: iso(r.endDateTo),
      endDateToPrecision: r.endDateToPrecision,
      endDatePhrase: r.endDatePhrase,
      endPlace: r.endPlace,
      notes: r.notes,
      other: ref(r.toPerson),
      media: mediaOf(r.media),
      events: [] as EventDto[],
    })),
    ...person.relationsTo.map((r) => ({
      relationshipId: r.id,
      type: r.type,
      subtype: r.subtype,
      role: r.type === "PARENT_OF" ? ("parent" as const) : ("partner" as const),
      startDate: iso(r.startDate),
      startDatePrecision: r.startDatePrecision,
      startDateQualifier: r.startDateQualifier,
      endDate: iso(r.endDate),
      endDatePrecision: r.endDatePrecision,
      endDateQualifier: r.endDateQualifier,
      startDateTo: iso(r.startDateTo),
      startDateToPrecision: r.startDateToPrecision,
      startDatePhrase: r.startDatePhrase,
      startPlace: r.startPlace,
      endDateTo: iso(r.endDateTo),
      endDateToPrecision: r.endDateToPrecision,
      endDatePhrase: r.endDatePhrase,
      endPlace: r.endPlace,
      notes: r.notes,
      other: ref(r.fromPerson),
      media: mediaOf(r.media),
      events: [] as EventDto[],
    })),
  ];

  const byBirth = (a: PersonRelation, b: PersonRelation) =>
    (a.other.birthDate ?? "9999").localeCompare(b.other.birthDate ?? "9999") ||
    a.other.id.localeCompare(b.other.id);

  // Geschwister über die Eltern ermitteln. Dafür genügt der Ausschnitt um
  // die Eltern herum; der volle Graph wäre hier unnötig teuer.
  const parentIds = person.relationsTo
    .filter((r) => r.type === "PARENT_OF")
    .map((r) => r.fromPersonId);
  const edgeSelect = {
    id: true,
    type: true,
    subtype: true,
    fromPersonId: true,
    toPersonId: true,
  } as const;
  const childEdges =
    parentIds.length === 0
      ? []
      : await prisma.relationship.findMany({
          where: { type: "PARENT_OF", fromPersonId: { in: parentIds } },
          select: edgeSelect,
        });
  // Für die Unterscheidung voll/halb braucht es auch die übrigen Eltern der
  // Geschwister.
  const siblingParentEdges =
    childEdges.length === 0
      ? []
      : await prisma.relationship.findMany({
          where: {
            type: "PARENT_OF",
            toPersonId: { in: [...new Set(childEdges.map((e) => e.toPersonId))] },
          },
          select: edgeSelect,
        });
  const edgeById = new Map(
    [...childEdges, ...siblingParentEdges].map((e) => [e.id, e]),
  );
  const siblingIndex = buildGraphIndex(
    [...edgeById.values()].map((e) => ({
      id: e.id,
      type: e.type,
      subtype: e.subtype,
      from: e.fromPersonId,
      to: e.toPersonId,
    })),
  );
  const siblingInfo = siblingsOf(siblingIndex, id);
  const siblingPersons = await prisma.person.findMany({
    where: { id: { in: siblingInfo.map((s) => s.personId) } },
    select: relatedSelect,
  });
  const siblingById = new Map(siblingPersons.map((p) => [p.id, p]));
  const siblings: PersonSibling[] = siblingInfo
    .filter((s) => siblingById.has(s.personId))
    .map((s) => ({
      person: ref(siblingById.get(s.personId)!),
      kind: s.kind,
      sharedParentIds: s.sharedParentIds,
    }))
    .sort(
      (a, b) =>
        (a.person.birthDate ?? "9999").localeCompare(b.person.birthDate ?? "9999") ||
        a.person.id.localeCompare(b.person.id),
    );

  const primary = person.media.find((m) => m.isPrimary);
  const [citations, eventRows, nameRows] = await Promise.all([
    listPersonCitations(scope, id),
    loadEventsFor({ personIds: [id], relationshipIds: relations.map((r) => r.relationshipId) }),
    prisma.personName.findMany({ where: { personId: id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);
  // Ereignisse an Beziehungen: änderbar wie die Beziehung (eine Seite
  // bearbeitbar, beide sichtbar); die Person selbst ist sichtbar.
  const personEditable = canEditPerson(scope, familyIds);
  const relEditable = new Map<string, boolean>();
  for (const r of person.relationsFrom) {
    relEditable.set(r.id, canEditRelationshipBetween(scope, familyIds, r.toPerson.families.map((f) => f.familyId)));
  }
  for (const r of person.relationsTo) {
    relEditable.set(r.id, canEditRelationshipBetween(scope, r.fromPerson.families.map((f) => f.familyId), familyIds));
  }
  for (const rel of relations) {
    rel.events = eventRows
      .filter((e) => e.relationshipId === rel.relationshipId)
      .map((e) => toEventDto(e, relEditable.get(rel.relationshipId) ?? false));
  }
  const events = eventRows.filter((e) => e.personId === id).map((e) => toEventDto(e, personEditable));

  return {
    person: toPersonSummary(scope, person, {
      familyIds,
      primaryMediaId: primary?.mediaId ?? null,
    }),
    canEdit: canEditPerson(scope, familyIds),
    families: person.families
      .filter((f) => scope.isAdmin || scope.families.has(f.familyId))
      .map((f) => ({ id: f.family.id, name: f.family.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    media: person.media.map((m) => ({
      mediaId: m.mediaId,
      caption: m.media.caption,
      isPrimary: m.isPrimary,
      sortOrder: m.sortOrder,
      width: m.media.width,
      height: m.media.height,
    })),
    relations: [...relations].sort(
      (a, b) => a.role.localeCompare(b.role) || byBirth(a, b),
    ),
    parents: relations.filter((r) => r.role === "parent").sort(byBirth),
    children: relations.filter((r) => r.role === "child").sort(byBirth),
    partners: relations
      .filter((r) => r.role === "partner")
      .sort(
        (a, b) =>
          (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") ||
          a.other.id.localeCompare(b.other.id),
      ),
    siblings,
    citations,
    events,
    names: nameRows.map(toPersonNameDto),
  };
}

/**
 * Sichtbare Personen als Auswahlliste (Suchfeld beim Zuordnen). Liefert nur
 * Personen, die der Benutzer sehen darf — die Suchhilfe darf keine Namen aus
 * fremden Familien preisgeben.
 */
export async function listPickablePersons(
  scope: Scope,
  options: { excludeId?: string } = {},
): Promise<
  {
    id: string;
    givenName: string;
    familyName: string | null;
    birthDate: string | null;
    deathDate: string | null;
    birthDatePrecision: DatePrecision;
    birthDateQualifier: DateQualifier;
    deathDatePrecision: DatePrecision;
    deathDateQualifier: DateQualifier;
    birthDateTo: string | null;
    birthDateToPrecision: DatePrecision;
    deathDateTo: string | null;
    deathDateToPrecision: DatePrecision;
  }[]
> {
  const rows = await prisma.person.findMany({
    where: {
      AND: [
        options.excludeId ? { id: { not: options.excludeId } } : {},
        personVisibilityFilter(scope),
      ],
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      givenName: true,
      familyName: true,
      birthDate: true,
      deathDate: true,
      birthDatePrecision: true,
      birthDateQualifier: true,
      deathDatePrecision: true,
      deathDateQualifier: true,
      birthDateTo: true,
      birthDateToPrecision: true,
      deathDateTo: true,
      deathDateToPrecision: true,
    },
  });
  return rows.map((p) => ({
    ...p,
    birthDate: iso(p.birthDate),
    deathDate: iso(p.deathDate),
    birthDateTo: iso(p.birthDateTo),
    deathDateTo: iso(p.deathDateTo),
  }));
}

// ---------------------------------------------------------------------------
// Mutationen
// ---------------------------------------------------------------------------

/**
 * Validierte Eingabe -> Prisma-Spalten. Ein Datum wird zu Anker, Genauigkeit
 * und Zusatz; fehlende Felder (undefined) bleiben unverändert.
 */
function personColumns<T extends { birthDate?: FuzzyDate | null; deathDate?: FuzzyDate | null }>(data: T) {
  const { birthDate, deathDate, ...rest } = data;
  return {
    ...rest,
    ...(birthDate !== undefined ? fuzzyColumns("birthDate", birthDate) : {}),
    ...(deathDate !== undefined ? fuzzyColumns("deathDate", deathDate) : {}),
  };
}

/**
 * Wortlaut bei einem Teil-Update: ändert sich das Datum ohne neuen Wortlaut,
 * wird der alte gelöscht (er beschriebe sonst ein anderes Datum). Bleibt das
 * Datum gleich (Formular schickt es unverändert mit), bleibt er stehen.
 */
export function phraseColumns(
  existing: object,
  data: Record<string, unknown>,
  keys: readonly ("birthDate" | "deathDate" | "startDate" | "endDate" | "date")[],
): Record<string, string | null> {
  const row = existing as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const key of keys) {
    const next = phraseAfterUpdate(
      fuzzyField(existing, key),
      data[key] as FuzzyDate | null | undefined,
      (row[key + "Phrase"] as string | null | undefined) ?? null,
      data[key + "Phrase"] as string | null | undefined,
    );
    if (next !== undefined) out[key + "Phrase"] = next;
  }
  return out;
}

async function summaryById(scope: Scope, id: string): Promise<PersonSummary> {
  const p = await prisma.person.findUniqueOrThrow({
    where: { id },
    include: {
      media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      families: { select: { familyId: true } },
    },
  });
  return toPersonSummary(scope, p, {
    familyIds: p.families.map((f) => f.familyId),
    primaryMediaId: p.media[0]?.mediaId ?? null,
  });
}

/**
 * Neue Person. Nicht-Admins müssen sie einer Familie zuordnen, in der sie
 * EDITOR sind — eine Person ohne Familie wäre für den Anlegenden im nächsten
 * Moment unsichtbar, weil nur Admins familienlose Personen sehen. Ohne
 * Angabe landet sie in der ersten bearbeitbaren Familie.
 *
 * `input` ist bewusst `unknown`: die Validierung läuft hier, damit jeder
 * Aufrufer (API, MCP) dieselben Regeln bekommt.
 */
export async function createPerson(
  scope: Scope,
  input: unknown,
): Promise<PersonSummary> {
  const { familyIds: requestedRaw, ...data } = parseOrThrow(
    personCreateInput.safeParse(input),
  );
  const requested = [...new Set(requestedRaw ?? [])];

  let familyIds: string[];
  if (scope.isAdmin) {
    familyIds = requested;
  } else {
    const editable = editableFamilyIds(scope);
    if (editable.length === 0) throw forbiddenError("Personen anzulegen");
    if (requested.some((f) => !editable.includes(f))) {
      throw forbiddenError("Familien, in denen du keine Bearbeitungsrechte hast");
    }
    familyIds = requested.length > 0 ? requested : editable.slice(0, 1);
  }

  if (familyIds.length > 0) {
    const existing = await prisma.family.count({ where: { id: { in: familyIds } } });
    if (existing !== familyIds.length) {
      throw validationError([{ path: "familyIds", message: "Unbekannte Familie" }]);
    }
  }

  const columns = personColumns(data);
  const person = await prisma.person.create({
    data: {
      ...columns,
      families: { create: familyIds.map((familyId) => ({ familyId })) },
    },
  });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Person",
    entityId: person.id,
    diff: { ...columns, familyIds },
  });

  return toPersonSummary(scope, person, { familyIds, primaryMediaId: null });
}

/** Teil-Update einer Person. Fehlende Felder bleiben unverändert. */
export async function updatePerson(
  scope: Scope,
  id: string,
  patch: unknown,
): Promise<PersonSummary> {
  const existing = await prisma.person.findUnique({
    where: { id },
    include: { families: { select: { familyId: true } } },
  });
  if (!existing) throw notFoundError("Person");

  const familyIds = existing.families.map((f) => f.familyId);
  if (!canViewPerson(scope, familyIds)) throw notFoundError("Person");
  if (!canEditPerson(scope, familyIds)) throw forbiddenError("diese Person zu ändern");

  const data = parseOrThrow(personPatch.safeParse(patch));

  // Datumsregeln über den zusammengeführten Stand prüfen — sonst ließe sich
  // ein Sterbedatum vor dem Geburtsdatum in zwei Schritten eintragen.
  const merged = {
    birthDate: data.birthDate !== undefined ? data.birthDate : fuzzyField(existing, "birthDate"),
    deathDate: data.deathDate !== undefined ? data.deathDate : fuzzyField(existing, "deathDate"),
  };
  const issues = personDateIssues(merged);
  if (issues.length > 0) throw validationError(issues);

  const { birthDatePhrase: _bp, deathDatePhrase: _dp, ...withoutPhrases } = data;
  const columns = {
    ...personColumns(withoutPhrases),
    ...phraseColumns(existing, data, ["birthDate", "deathDate"]),
  };
  await prisma.person.update({ where: { id }, data: columns });

  const changes = fieldChanges(existing, columns);
  if (Object.keys(changes).length > 0) {
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "Person",
      entityId: id,
      diff: { changes },
    });
  }

  return summaryById(scope, id);
}

/**
 * Löscht eine Person. Hat sie Beziehungen, ist `force` nötig — das Löschen
 * risse per Cascade alle Beziehungen mit, was bei einer verknüpften Person
 * fast nie gewollt ist.
 */
export async function deletePerson(
  scope: Scope,
  id: string,
  options: { force?: boolean } = {},
): Promise<{ ok: true; relationCount: number }> {
  const familyIds = await familyIdsOfPerson(id);
  const existing = await prisma.person.findUnique({ where: { id }, select: { givenName: true, familyName: true } });
  if (!existing || !canViewPerson(scope, familyIds)) throw notFoundError("Person");
  if (!canEditPerson(scope, familyIds)) throw forbiddenError("diese Person zu löschen");

  const relationCount = await prisma.relationship.count({
    where: { OR: [{ fromPersonId: id }, { toPersonId: id }] },
  });

  if (relationCount > 0 && !options.force) {
    throw conflictError(
      `Person hat ${relationCount} Beziehung(en). Zum Löschen ?force=true anhängen.`,
      { relationCount },
    );
  }

  // Bilder der Person und ihrer Beziehungen (Hochzeitsfotos) merken: das
  // Löschen entfernt per Cascade nur die Zuordnungen, nicht die Bilder selbst.
  const mediaIds = (
    await prisma.mediaAsset.findMany({
      where: {
        OR: [
          { persons: { some: { personId: id } } },
          { relationships: { some: { relationship: { OR: [{ fromPersonId: id }, { toPersonId: id }] } } } },
        ],
      },
      select: { id: true },
    })
  ).map((m) => m.id);

  await prisma.person.delete({ where: { id } });

  const removedMedia = await removeOrphanedMedia(mediaIds);

  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Person",
    entityId: id,
    diff: { subject: [existing.givenName, existing.familyName].filter(Boolean).join(" "), relationCount, removedMedia },
    // Die Familienzuordnung ist mit der Person gelöscht — für die Übersicht je Familie.
    familyIds,
  });

  return { ok: true, relationCount };
}

/**
 * Setzt die Familienzugehörigkeit einer Person.
 *
 * Nicht-Admins dürfen nur Familien hinzufügen oder entfernen, in denen sie
 * selbst EDITOR sind. Familien, die sie gar nicht kennen, bleiben in jedem
 * Fall unverändert erhalten — sie bekommen sie ja auch nicht angezeigt und
 * können sie folglich nicht mitschicken. Eine Familie mit ihrem
 * Bearbeitungsrecht muss bleiben (sonst sperrten sie sich selbst aus).
 */
export async function setPersonFamilies(
  scope: Scope,
  id: string,
  requestedFamilyIds: string[],
): Promise<{ ok: true; familyIds: string[] }> {
  const exists = await prisma.person.count({ where: { id } });
  const current = await familyIdsOfPerson(id);
  if (!exists || !canViewPerson(scope, current)) throw notFoundError("Person");
  if (!canEditPerson(scope, current)) throw forbiddenError("diese Person zu ändern");

  let next = [...new Set(requestedFamilyIds)];

  if (!scope.isAdmin) {
    const known = new Set(viewableFamilyIds(scope));
    const editable = new Set(editableFamilyIds(scope));
    const hidden = current.filter((f) => !known.has(f));
    next = [...new Set([...next, ...hidden])];

    const touched = [
      ...next.filter((f) => !current.includes(f)),
      ...current.filter((f) => !next.includes(f)),
    ];
    if (touched.some((f) => !editable.has(f))) {
      throw forbiddenError("Familien zu ändern, in denen du keine Bearbeitungsrechte hast");
    }
    // Nicht selbst aussperren: Ohne eine Familie mit Bearbeitungsrecht könnte
    // der Benutzer die Person danach weder ändern noch löschen (ohne jede
    // Familie sähe er sie gar nicht mehr) — und sie bliebe z.B. als
    // Elternteil eingetragen. Administratoren betrifft das nicht: Sie sehen
    // und bearbeiten jede Person, auch eine ohne Familie.
    if (!canEditPerson(scope, next)) {
      throw validationError([
        {
          path: "familyIds",
          message:
            "Mindestens eine Familie, in der du Bearbeitungsrechte hast, muss zugeordnet bleiben — sonst könntest du die Person nicht mehr bearbeiten.",
        },
      ]);
    }
  }

  if (next.length > 0) {
    const existing = await prisma.family.count({ where: { id: { in: next } } });
    if (existing !== next.length) {
      throw validationError([{ path: "familyIds", message: "Unbekannte Familie" }]);
    }
  }

  await prisma.$transaction([
    prisma.personFamily.deleteMany({ where: { personId: id } }),
    prisma.personFamily.createMany({
      data: next.map((familyId) => ({ personId: id, familyId })),
      skipDuplicates: true,
    }),
  ]);

  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "Person",
    entityId: id,
    diff: { families: next, changes: fieldChanges({ families: [...current].sort() }, { families: [...next].sort() }) },
    // Auch die verlassenen Familien sehen die Änderung in ihrer Übersicht.
    familyIds: [...current, ...next],
  });

  return { ok: true, familyIds: next.filter((f) => scope.isAdmin || scope.families.has(f)) };
}

