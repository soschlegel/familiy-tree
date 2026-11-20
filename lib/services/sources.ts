import type { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { safeHttpUrl } from "../source-classify";
import { audit, auditActor } from "../audit";
import { canViewMedia } from "../media-scope";
import {
  canEditPerson,
  canEditRelationshipBetween,
  canViewPerson,
  editableFamilyIds,
  personVisibilityFilter,
  type Scope,
} from "../scope";
import {
  citationInput,
  citationPatch,
  PERSON_FACTS,
  relationshipFacts,
  sourceInput,
  sourcePatch,
  type CitationConfidenceName,
  type CitationFactName,
  type SourceKindName,
} from "../validation";
import { fuzzyColumns, type DatePrecision, type DateQualifier, type FuzzyDate } from "../dates";
import { phraseColumns } from "./persons";
import { eventTitle } from "../events";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { iso, toPersonRef, type PersonRef } from "./dto";

/**
 * Quellen und Belege.
 *
 * Rechte (verbindlich hier, nicht in der Oberfläche):
 * - Ein Beleg ist sichtbar, wenn die Person bzw. Beziehung sichtbar ist, an
 *   der er hängt (Beziehung: mindestens eine Seite sichtbar — wie im Baum).
 *   Ändern/Löschen darf, wer die Person bzw. Beziehung bearbeiten darf.
 * - Eine Quelle ist sichtbar für Administratoren, für den, der sie angelegt
 *   hat, und für jeden, der mindestens einen ihrer Belege sieht. Belege an
 *   Personen, die der Benutzer nicht sieht, erscheinen nie mit Namen — die
 *   Detailansicht nennt nur ihre Anzahl.
 * - Ändern darf eine Quelle, wer sie angelegt hat, wer einen ihrer Belege
 *   bearbeiten darf, und der Administrator. Löschen (samt aller Belege) nur,
 *   wer jeden ihrer Belege bearbeiten darf.
 * - Unsichtbar = nicht vorhanden (NOT_FOUND), wie bei Personen.
 */

export type SourceKind = SourceKindName;
export type CitationFact = CitationFactName;
export type CitationConfidence = CitationConfidenceName;

export type SourceBrief = { id: string; title: string; kind: SourceKind };

export type SourceDto = SourceBrief & {
  /** Freie Art, wenn die Quelle eine eigene Kategorie mitbringt. */
  kindLabel: string | null;
  /** Anbieter, über den die Quelle zugänglich ist (MyHeritage, Ancestry …). */
  provider: string | null;
  author: string | null;
  repository: string | null;
  callNumber: string | null;
  url: string | null;
  date: string | null;
  datePrecision: DatePrecision;
  dateQualifier: DateQualifier;
  dateTo: string | null;
  dateToPrecision: DatePrecision;
  datePhrase: string | null;
  notes: string | null;
  /** Scan — nur, wenn der Benutzer das Bild sehen darf. */
  mediaId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceListItem = SourceDto & {
  /** Nur Belege, die der Benutzer sieht. */
  citationCount: number;
};

export type CitationTarget =
  | { kind: "person"; person: PersonRef }
  | {
      kind: "relationship";
      relationshipId: string;
      type: "PARENT_OF" | "PARTNER_OF";
      subtype: string;
      from: PersonRef;
      to: PersonRef;
    };

export type CitationDto = {
  id: string;
  sourceId: string;
  personId: string | null;
  relationshipId: string | null;
  /** Beleg für ein Ereignis (personId/relationshipId = dessen Träger). */
  eventId: string | null;
  fact: CitationFact;
  detail: string | null;
  /** Internetadresse des Eintrags (geprüft: nur http/https). */
  url: string | null;
  confidence: CitationConfidence | null;
  /** Abschrift bzw. Notiz zum Beleg. */
  text: string | null;
  createdAt: string;
  canEdit: boolean;
  /** Nur bei Belegen für ein Ereignis: dessen Anzeigename, z.B. „Taufe“. */
  eventTitle?: string;
};

export type SourceDetail = {
  source: SourceDto;
  canEdit: boolean;
  canDelete: boolean;
  /** Sichtbare Belege mit ihrem Bezug. */
  citations: (CitationDto & { target: CitationTarget })[];
  /** Belege an Personen/Beziehungen, die der Benutzer nicht sieht — nur die Zahl. */
  hiddenCitationCount: number;
};

/** Beleg aus Sicht einer Person (Personenseite, MCP get_person). */
export type PersonCitation = CitationDto & {
  source: SourceBrief;
  /** Nur bei Belegen an einer Beziehung dieser Person. */
  relationship: {
    type: "PARENT_OF" | "PARTNER_OF";
    subtype: string;
    /** Rolle der ANDEREN Person aus Sicht dieser Person. */
    role: "parent" | "child" | "partner";
    other: PersonRef;
  } | null;
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const personSelect = {
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
  families: { select: { familyId: true } },
} as const;

type SelectedPerson = Prisma.PersonGetPayload<{ select: typeof personSelect }>;

const citationInclude = {
  person: { select: personSelect },
  relationship: {
    select: {
      id: true,
      type: true,
      subtype: true,
      fromPerson: { select: personSelect },
      toPerson: { select: personSelect },
    },
  },
  event: { select: { type: true, label: true } },
} as const;

type LoadedCitation = Prisma.CitationGetPayload<{ include: typeof citationInclude }>;

const familiesOf = (p: SelectedPerson) => p.families.map((f) => f.familyId);

/** Sichtbarkeit und Bearbeitbarkeit eines Belegs — genau nach lib/scope.ts. */
function citationAccess(scope: Scope, c: LoadedCitation): { visible: boolean; editable: boolean } {
  if (c.person) {
    const fam = familiesOf(c.person);
    return { visible: canViewPerson(scope, fam), editable: canEditPerson(scope, fam) };
  }
  if (c.relationship) {
    const from = familiesOf(c.relationship.fromPerson);
    const to = familiesOf(c.relationship.toPerson);
    return {
      visible: canViewPerson(scope, from) || canViewPerson(scope, to),
      editable: canEditRelationshipBetween(scope, from, to),
    };
  }
  // Ohne Bezug (sollte nicht vorkommen): nur Administratoren.
  return { visible: scope.isAdmin, editable: scope.isAdmin };
}

const refOf = (scope: Scope, p: SelectedPerson): PersonRef =>
  toPersonRef(canViewPerson(scope, familiesOf(p)), p);

function toCitationDto(c: LoadedCitation | Prisma.CitationGetPayload<object>, canEdit: boolean): CitationDto {
  return {
    id: c.id,
    sourceId: c.sourceId,
    personId: c.personId,
    relationshipId: c.relationshipId,
    eventId: c.eventId,
    fact: c.fact,
    detail: c.detail,
    url: safeHttpUrl(c.url),
    confidence: c.confidence,
    text: c.text,
    createdAt: c.createdAt.toISOString(),
    canEdit,
    ...("event" in c && c.event ? { eventTitle: eventTitle(c.event) } : {}),
  };
}

function targetOf(scope: Scope, c: LoadedCitation): CitationTarget {
  if (c.person) return { kind: "person", person: refOf(scope, c.person) };
  const r = c.relationship!;
  const fromVisible = canViewPerson(scope, familiesOf(r.fromPerson));
  const toVisible = canViewPerson(scope, familiesOf(r.toPerson));
  return {
    kind: "relationship",
    relationshipId: r.id,
    type: r.type,
    // Wie im Baum: die Art nur, wenn eine Seite sichtbar ist.
    subtype: fromVisible || toVisible ? r.subtype : r.type === "PARENT_OF" ? "BIOLOGICAL" : "UNMARRIED",
    from: refOf(scope, r.fromPerson),
    to: refOf(scope, r.toPerson),
  };
}

/** Prisma-Filter: Belege, die der Benutzer sieht. */
function citationVisibilityWhere(scope: Scope): Prisma.CitationWhereInput {
  if (scope.isAdmin) return {};
  const visible = personVisibilityFilter(scope);
  return {
    OR: [
      { person: visible },
      { relationship: { OR: [{ fromPerson: visible }, { toPerson: visible }] } },
    ],
  };
}

/** Prisma-Filter: Quellen, die der Benutzer sieht. */
function sourceVisibilityWhere(scope: Scope): Prisma.SourceWhereInput {
  if (scope.isAdmin) return {};
  return {
    OR: [{ createdById: scope.userId }, { citations: { some: citationVisibilityWhere(scope) } }],
  };
}

type SourceRow = Prisma.SourceGetPayload<object>;

async function toSourceDto(scope: Scope, s: SourceRow, mediaVisible?: boolean): Promise<SourceDto> {
  const showMedia = s.mediaId
    ? (mediaVisible ?? (await canViewMedia(scope, s.mediaId)))
    : false;
  return {
    id: s.id,
    title: s.title,
    kind: s.kind,
    kindLabel: s.kindLabel,
    provider: s.provider,
    author: s.author,
    repository: s.repository,
    callNumber: s.callNumber,
    url: safeHttpUrl(s.url),
    date: iso(s.date),
    datePrecision: s.datePrecision,
    dateQualifier: s.dateQualifier,
    dateTo: iso(s.dateTo),
    dateToPrecision: s.dateToPrecision,
    datePhrase: s.datePhrase,
    notes: s.notes,
    mediaId: showMedia ? s.mediaId : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Lädt eine Quelle samt Belegen und bewertet die Rechte. null = unsichtbar. */
async function loadSourceAccess(scope: Scope, id: string) {
  const source = await prisma.source.findUnique({
    where: { id },
    include: { citations: { include: citationInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!source) return null;

  const rated = source.citations.map((c) => ({ c, ...citationAccess(scope, c) }));
  const visible = rated.filter((r) => r.visible);
  const isCreator = source.createdById !== null && source.createdById === scope.userId;

  if (!scope.isAdmin && !isCreator && visible.length === 0) return null;

  const anyEditable = visible.some((r) => r.editable);
  const allEditable = rated.every((r) => r.editable);
  const canEdit = scope.isAdmin || isCreator || anyEditable;
  // Löschen nimmt alle Belege mit — nur, wer jeden davon ändern dürfte.
  const canDelete = scope.isAdmin || (canEdit && allEditable && (rated.length > 0 || isCreator));

  return { source, rated, visible, canEdit, canDelete };
}

/** Darf der Benutzer überhaupt Quellen anlegen? (Bearbeitungsrecht in einer Familie) */
export function canCreateSources(scope: Scope): boolean {
  return scope.isAdmin || editableFamilyIds(scope).length > 0;
}

async function assertMediaUsable(scope: Scope, mediaId: string | null | undefined): Promise<void> {
  if (!mediaId) return;
  const exists = await prisma.mediaAsset.count({ where: { id: mediaId } });
  if (!exists || !(await canViewMedia(scope, mediaId))) {
    throw validationError([{ path: "mediaId", message: "Bild nicht gefunden" }]);
  }
}

function sourceColumns<T extends { date?: FuzzyDate | null }>(data: T) {
  const { date, ...rest } = data;
  return { ...rest, ...(date !== undefined ? fuzzyColumns("date", date) : {}) };
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export type ListSourcesOptions = {
  /** Jedes Wort muss in Titel, Verfasser, Archiv oder Signatur vorkommen. */
  q?: string;
  kind?: SourceKind;
  limit?: number;
  offset?: number;
};

/** Sichtbare Quellen, nach Titel sortiert, mit Zahl der sichtbaren Belege. */
export async function listSources(
  scope: Scope,
  options: ListSourcesOptions = {},
): Promise<{ items: SourceListItem[]; total: number }> {
  const words = (options.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const where: Prisma.SourceWhereInput = {
    AND: [
      sourceVisibilityWhere(scope),
      ...words.map((w) => ({
        OR: [
          { title: { contains: w, mode: "insensitive" as const } },
          { author: { contains: w, mode: "insensitive" as const } },
          { repository: { contains: w, mode: "insensitive" as const } },
          { callNumber: { contains: w, mode: "insensitive" as const } },
        ],
      })),
      options.kind ? { kind: options.kind } : {},
    ],
  };
  const take =
    options.limit === undefined ? undefined : Math.max(0, Math.min(1000, Math.floor(options.limit)));
  const skip = Math.max(0, Math.floor(options.offset ?? 0));

  const [rows, total] = await Promise.all([
    prisma.source.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      take,
      skip,
      include: { _count: { select: { citations: { where: citationVisibilityWhere(scope) } } } },
    }),
    prisma.source.count({ where }),
  ]);

  const items: SourceListItem[] = [];
  for (const { _count, ...s } of rows) {
    items.push({ ...(await toSourceDto(scope, s)), citationCount: _count.citations });
  }
  return { items, total };
}

/** Kurzliste aller sichtbaren Quellen (Auswahl beim Belegen). */
export async function listSourceOptions(scope: Scope): Promise<SourceBrief[]> {
  return prisma.source.findMany({
    where: sourceVisibilityWhere(scope),
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: 1000,
    select: { id: true, title: true, kind: true },
  });
}

/**
 * Eine Quelle mit allem, wofür sie zitiert wird. null, wenn es sie nicht gibt
 * oder der Benutzer sie nicht sehen darf.
 */
export async function getSource(scope: Scope, id: string): Promise<SourceDetail | null> {
  const access = await loadSourceAccess(scope, id);
  if (!access) return null;
  const { source, rated, visible, canEdit, canDelete } = access;

  return {
    source: await toSourceDto(scope, source),
    canEdit,
    canDelete,
    citations: visible.map((r) => ({ ...toCitationDto(r.c, r.editable), target: targetOf(scope, r.c) })),
    hiddenCitationCount: rated.length - visible.length,
  };
}

/**
 * Bilder, die als Scan einer Quelle in Frage kommen: Bilder der Personen und
 * Beziehungen, für die sie (sichtbar) zitiert wird.
 */
export async function listScanCandidates(
  scope: Scope,
  sourceId: string,
): Promise<{ mediaId: string; caption: string | null; owner: string }[]> {
  const access = await loadSourceAccess(scope, sourceId);
  if (!access) return [];
  const personIds = access.visible
    .map((r) => r.c.person)
    .filter((p): p is SelectedPerson => Boolean(p) && canViewPerson(scope, familiesOf(p!)));
  const relationships = access.visible.map((r) => r.c.relationship).filter((r) => r !== null);

  const [personMedia, relMedia] = await Promise.all([
    prisma.personMedia.findMany({
      where: { personId: { in: personIds.map((p) => p.id) } },
      include: { media: { select: { caption: true } } },
    }),
    prisma.relationshipMedia.findMany({
      where: { relationshipId: { in: relationships.map((r) => r!.id) } },
      include: { media: { select: { caption: true } } },
    }),
  ]);
  const name = (p: { givenName: string; familyName: string | null }) =>
    [p.givenName, p.familyName].filter(Boolean).join(" ");
  const personName = new Map(personIds.map((p) => [p.id, name(p)]));
  const relName = new Map(
    relationships.map((r) => {
      const a = canViewPerson(scope, familiesOf(r!.fromPerson)) ? name(r!.fromPerson) : "Nicht freigegeben";
      const b = canViewPerson(scope, familiesOf(r!.toPerson)) ? name(r!.toPerson) : "Nicht freigegeben";
      return [r!.id, `${a} & ${b}`];
    }),
  );

  const seen = new Set<string>();
  const out: { mediaId: string; caption: string | null; owner: string }[] = [];
  for (const m of personMedia) {
    if (seen.has(m.mediaId)) continue;
    seen.add(m.mediaId);
    out.push({ mediaId: m.mediaId, caption: m.media.caption, owner: personName.get(m.personId) ?? "" });
  }
  for (const m of relMedia) {
    if (seen.has(m.mediaId)) continue;
    seen.add(m.mediaId);
    out.push({ mediaId: m.mediaId, caption: m.media.caption, owner: relName.get(m.relationshipId) ?? "" });
  }
  return out;
}

/**
 * Belege einer Person und ihrer Beziehungen. Der Aufrufer hat die
 * Sichtbarkeit der Person bereits geprüft; Beziehungen einer sichtbaren
 * Person sind damit ebenfalls sichtbar (eine Seite ist sie selbst).
 */
export async function listPersonCitations(scope: Scope, personId: string): Promise<PersonCitation[]> {
  const rows = await prisma.citation.findMany({
    where: {
      OR: [
        { personId },
        { relationship: { OR: [{ fromPersonId: personId }, { toPersonId: personId }] } },
      ],
    },
    include: { ...citationInclude, source: { select: { id: true, title: true, kind: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const out: PersonCitation[] = [];
  for (const c of rows) {
    const access = citationAccess(scope, c);
    if (!access.visible) continue;
    let relationship: PersonCitation["relationship"] = null;
    if (c.relationship) {
      const r = c.relationship;
      const self = r.fromPerson.id === personId;
      const other = self ? r.toPerson : r.fromPerson;
      relationship = {
        type: r.type,
        subtype: r.subtype,
        role: r.type === "PARTNER_OF" ? "partner" : self ? "child" : "parent",
        other: refOf(scope, other),
      };
    }
    out.push({ ...toCitationDto(c, access.editable), source: c.source, relationship });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quellen ändern
// ---------------------------------------------------------------------------

/** Neue Quelle. Darf anlegen, wer in mindestens einer Familie bearbeitet. */
export async function createSource(scope: Scope, input: unknown): Promise<SourceDto> {
  if (!canCreateSources(scope)) throw forbiddenError("Quellen anzulegen");
  const data = parseOrThrow(sourceInput.safeParse(input));
  await assertMediaUsable(scope, data.mediaId);

  const columns = sourceColumns(data);
  const source = await prisma.source.create({ data: { ...columns, createdById: scope.userId } });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Source",
    entityId: source.id,
    diff: columns,
  });
  return toSourceDto(scope, source);
}

/** Teil-Update einer Quelle. Fehlende Felder bleiben unverändert. */
export async function updateSource(scope: Scope, id: string, patch: unknown): Promise<SourceDto> {
  const access = await loadSourceAccess(scope, id);
  if (!access) throw notFoundError("Quelle");
  if (!access.canEdit) throw forbiddenError("diese Quelle zu ändern");

  const data = parseOrThrow(sourcePatch.safeParse(patch));
  if (data.mediaId !== undefined && data.mediaId !== access.source.mediaId) {
    await assertMediaUsable(scope, data.mediaId);
  }

  const { datePhrase: _dp, ...withoutPhrase } = data;
  const columns = { ...sourceColumns(withoutPhrase), ...phraseColumns(access.source, data, ["date"]) };
  const source = await prisma.source.update({ where: { id }, data: columns });

  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "Source",
    entityId: id,
    diff: columns,
  });
  return toSourceDto(scope, source);
}

/** Löscht eine Quelle samt aller Belege. */
export async function deleteSource(
  scope: Scope,
  id: string,
): Promise<{ ok: true; citationCount: number }> {
  const access = await loadSourceAccess(scope, id);
  if (!access) throw notFoundError("Quelle");
  if (!access.canDelete) {
    throw forbiddenError(
      "diese Quelle zu löschen — sie belegt Angaben, die du nicht bearbeiten darfst. Entferne stattdessen deine Belege",
    );
  }

  await prisma.source.delete({ where: { id } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Source",
    entityId: id,
    diff: { title: access.source.title, kind: access.source.kind, citationCount: access.rated.length },
  });
  return { ok: true, citationCount: access.rated.length };
}

// ---------------------------------------------------------------------------
// Belege ändern
// ---------------------------------------------------------------------------

/** Prüft Bezug und Rechte für einen neuen Beleg; liefert die erlaubten Angaben. */
async function assertCitationTarget(
  scope: Scope,
  target: { personId?: string | null; relationshipId?: string | null },
): Promise<readonly CitationFact[]> {
  if (!target.personId && !target.relationshipId) throw notFoundError("Ereignis");
  if (target.personId) {
    const person = await prisma.person.findUnique({
      where: { id: target.personId },
      select: { families: { select: { familyId: true } } },
    });
    const fam = person?.families.map((f) => f.familyId) ?? [];
    if (!person || !canViewPerson(scope, fam)) throw notFoundError("Person");
    if (!canEditPerson(scope, fam)) throw forbiddenError("Belege für diese Person zu erfassen");
    return PERSON_FACTS;
  }
  const rel = await prisma.relationship.findUnique({
    where: { id: target.relationshipId! },
    select: {
      type: true,
      fromPerson: { select: { families: { select: { familyId: true } } } },
      toPerson: { select: { families: { select: { familyId: true } } } },
    },
  });
  if (!rel) throw notFoundError("Beziehung");
  const from = rel.fromPerson.families.map((f) => f.familyId);
  const to = rel.toPerson.families.map((f) => f.familyId);
  if (!canViewPerson(scope, from) && !canViewPerson(scope, to)) throw notFoundError("Beziehung");
  if (!canEditRelationshipBetween(scope, from, to)) {
    throw forbiddenError("Belege für diese Beziehung zu erfassen");
  }
  return relationshipFacts(rel.type);
}

const FACT_LABEL: Record<CitationFact, string> = {
  NAME: "Name",
  BIRTH: "Geburt",
  DEATH: "Tod",
  PARTNERSHIP: "Heirat/Partnerschaft",
  PARENTAGE: "Abstammung",
  OTHER: "Sonstiges",
  EVENT: "Ereignis",
};

function assertFact(fact: CitationFact, allowed: readonly CitationFact[]) {
  if (!allowed.includes(fact)) {
    throw validationError([
      {
        path: "fact",
        message: `„${FACT_LABEL[fact]}“ passt hier nicht (möglich: ${allowed.map((f) => FACT_LABEL[f]).join(", ")})`,
      },
    ]);
  }
}

/**
 * Beleg anlegen: Quelle (sichtbar) für eine Angabe einer Person oder einer
 * Beziehung (bearbeitbar).
 */
export async function createCitation(scope: Scope, input: unknown): Promise<CitationDto> {
  const data = parseOrThrow(citationInput.safeParse(input));

  const access = await loadSourceAccess(scope, data.sourceId);
  if (!access) throw notFoundError("Quelle");

  // Beleg an einem Ereignis: Träger des Ereignisses übernehmen — Rechte,
  // Export und Löschen laufen dann über Person bzw. Beziehung wie gewohnt.
  let target: { personId: string | null; relationshipId: string | null; eventId: string | null } = {
    personId: data.personId ?? null,
    relationshipId: data.relationshipId ?? null,
    eventId: null,
  };
  let fact = data.fact;
  if (data.eventId) {
    const event = await prisma.event.findUnique({
      where: { id: data.eventId },
      select: { id: true, personId: true, relationshipId: true },
    });
    if (!event) throw notFoundError("Ereignis");
    target = { personId: event.personId, relationshipId: event.relationshipId, eventId: event.id };
    // „Sonstiges“ ist der Standard des Eingabeschemas — an einem Ereignis heißt das EVENT.
    if (fact === "OTHER") fact = "EVENT";
    if (fact !== "EVENT") {
      throw validationError([{ path: "fact", message: "Ein Beleg an einem Ereignis hat die Angabe „Ereignis“" }]);
    }
    await assertCitationTarget(scope, target);
  } else {
    const allowed = await assertCitationTarget(scope, target);
    assertFact(fact, allowed);
  }

  const citation = await prisma.citation.create({
    data: {
      sourceId: data.sourceId,
      ...target,
      fact,
      detail: data.detail,
      url: data.url,
      confidence: data.confidence,
      text: data.text,
    },
  });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Citation",
    entityId: citation.id,
    diff: {
      sourceId: citation.sourceId,
      personId: citation.personId,
      relationshipId: citation.relationshipId,
      eventId: citation.eventId,
      fact: citation.fact,
      detail: citation.detail,
      confidence: citation.confidence,
      text: citation.text,
    },
  });
  return toCitationDto(citation, true);
}

async function loadCitationForEdit(scope: Scope, id: string, what: string) {
  const c = await prisma.citation.findUnique({ where: { id }, include: citationInclude });
  if (!c) throw notFoundError("Beleg");
  const access = citationAccess(scope, c);
  if (!access.visible) throw notFoundError("Beleg");
  if (!access.editable) throw forbiddenError(what);
  return c;
}

/** Angabe, Fundstelle und Verlässlichkeit eines Belegs ändern. */
export async function updateCitation(scope: Scope, id: string, patch: unknown): Promise<CitationDto> {
  const existing = await loadCitationForEdit(scope, id, "diesen Beleg zu ändern");
  const data = parseOrThrow(citationPatch.safeParse(patch));
  if (data.fact !== undefined) {
    assertFact(
      data.fact,
      existing.eventId
        ? ["EVENT"]
        : existing.relationship
          ? relationshipFacts(existing.relationship.type)
          : PERSON_FACTS,
    );
  }

  const citation = await prisma.citation.update({ where: { id }, data });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "Citation",
    entityId: id,
    diff: data,
  });
  return toCitationDto(citation, true);
}

export async function deleteCitation(scope: Scope, id: string): Promise<{ ok: true }> {
  const existing = await loadCitationForEdit(scope, id, "diesen Beleg zu entfernen");
  await prisma.citation.delete({ where: { id } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Citation",
    entityId: id,
    diff: {
      sourceId: existing.sourceId,
      personId: existing.personId,
      relationshipId: existing.relationshipId,
      fact: existing.fact,
      detail: existing.detail,
    },
  });
  return { ok: true };
}
