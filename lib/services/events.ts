import type { Event as EventRow, Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { audit, auditActor, fieldChanges } from "../audit";
import {
  canEditPerson,
  canEditRelationshipBetween,
  canViewPerson,
  type Scope,
} from "../scope";
import { eventInput, eventPatch } from "../validation";
import {
  formatDateWithPhrase,
  fuzzyColumns,
  fuzzyField,
  phraseAfterUpdate,
  type DatePrecision,
  type DateQualifier,
} from "../dates";
import { eventIssues, eventTitle, type EventOwner, type EventTypeName } from "../events";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { iso } from "./dto";

/**
 * Lebensereignisse (Taufe, Beerdigung, Beruf, Wohnort, …) an einer Person
 * oder Beziehung. Welche Angabe wo steht: lib/events.ts.
 *
 * Rechte (wie bei Belegen): Ein Ereignis ist sichtbar bzw. änderbar, wenn
 * sein Träger es ist — an einer Person deren Familienrechte, an einer
 * Beziehung: sichtbar, sobald eine Seite sichtbar ist, änderbar nach
 * canEditRelationshipBetween (Bearbeitungsrecht an einer Seite, Sicht auf
 * beide). Unsichtbar = nicht vorhanden (NOT_FOUND).
 */

export type EventDto = {
  id: string;
  personId: string | null;
  relationshipId: string | null;
  type: EventTypeName;
  /** Bezeichnung (Pflicht bei CUSTOM, sonst Präzisierung). */
  label: string | null;
  /** Anzeigename: Bezeichnung bei CUSTOM, sonst die deutsche Art. */
  title: string;
  isAlternative: boolean;
  date: string | null;
  datePrecision: DatePrecision;
  dateQualifier: DateQualifier;
  dateTo: string | null;
  dateToPrecision: DatePrecision;
  datePhrase: string | null;
  /** Deutsche Anzeige samt Wortlaut, z.B. „zwischen 1850 und 1855“. */
  dateText: string;
  place: string | null;
  address: string | null;
  value: string | null;
  cause: string | null;
  age: string | null;
  agency: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

export function toEventDto(e: EventRow, canEdit: boolean): EventDto {
  return {
    id: e.id,
    personId: e.personId,
    relationshipId: e.relationshipId,
    type: e.type,
    label: e.label,
    title: eventTitle(e),
    isAlternative: e.isAlternative,
    date: iso(e.date),
    datePrecision: e.datePrecision,
    dateQualifier: e.dateQualifier,
    dateTo: iso(e.dateTo),
    dateToPrecision: e.dateToPrecision,
    datePhrase: e.datePhrase,
    dateText: formatDateWithPhrase(fuzzyField(e, "date"), e.datePhrase),
    place: e.place,
    address: e.address,
    value: e.value,
    cause: e.cause,
    age: e.age,
    agency: e.agency,
    notes: e.notes,
    sortOrder: e.sortOrder,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    canEdit,
  };
}

/**
 * Reihenfolge: datierte Ereignisse nach Anker (bei Bereichen der Anfang),
 * dann sortOrder; undatierte danach nach sortOrder.
 */
export function compareEvents(
  a: { date: Date | string | null; sortOrder: number; type: string; id: string },
  b: { date: Date | string | null; sortOrder: number; type: string; id: string },
): number {
  const t = (d: Date | string | null) => (d === null ? Infinity : new Date(d).getTime());
  return t(a.date) - t(b.date) || a.sortOrder - b.sortOrder || a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Rechte
// ---------------------------------------------------------------------------

const familiesSelect = { families: { select: { familyId: true } } } as const;
const fam = (p: { families: { familyId: string }[] }) => p.families.map((f) => f.familyId);

type OwnerAccess = { visible: boolean; editable: boolean; owner: EventOwner };

async function personAccess(scope: Scope, personId: string): Promise<OwnerAccess | null> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: familiesSelect });
  if (!p) return null;
  return { visible: canViewPerson(scope, fam(p)), editable: canEditPerson(scope, fam(p)), owner: { kind: "person" } };
}

async function relationshipAccess(scope: Scope, relationshipId: string): Promise<OwnerAccess | null> {
  const r = await prisma.relationship.findUnique({
    where: { id: relationshipId },
    select: { type: true, fromPerson: { select: familiesSelect }, toPerson: { select: familiesSelect } },
  });
  if (!r) return null;
  const from = fam(r.fromPerson);
  const to = fam(r.toPerson);
  return {
    visible: canViewPerson(scope, from) || canViewPerson(scope, to),
    editable: canEditRelationshipBetween(scope, from, to),
    owner: { kind: "relationship", type: r.type },
  };
}

async function ownerAccess(
  scope: Scope,
  target: { personId?: string | null; relationshipId?: string | null },
): Promise<OwnerAccess | null> {
  if (target.personId) return personAccess(scope, target.personId);
  if (target.relationshipId) return relationshipAccess(scope, target.relationshipId);
  return null;
}

async function loadForEdit(scope: Scope, id: string, what: string) {
  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) throw notFoundError("Ereignis");
  const access = await ownerAccess(scope, existing);
  if (!access?.visible) throw notFoundError("Ereignis");
  if (!access.editable) throw forbiddenError(what);
  return { existing, access };
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/** Ereignisse einer sichtbaren Person (ohne die ihrer Beziehungen). null = Person unsichtbar. */
export async function listPersonEvents(scope: Scope, personId: string): Promise<EventDto[] | null> {
  const access = await personAccess(scope, personId);
  if (!access?.visible) return null;
  const rows = await prisma.event.findMany({ where: { personId } });
  return rows.sort(compareEvents).map((e) => toEventDto(e, access.editable));
}

/** Ereignisse einer Beziehung (sichtbar, sobald eine Seite sichtbar ist). null = unsichtbar. */
export async function listRelationshipEvents(scope: Scope, relationshipId: string): Promise<EventDto[] | null> {
  const access = await relationshipAccess(scope, relationshipId);
  if (!access?.visible) return null;
  const rows = await prisma.event.findMany({ where: { relationshipId } });
  return rows.sort(compareEvents).map((e) => toEventDto(e, access.editable));
}

/** Ein Ereignis. null, wenn es fehlt oder sein Träger unsichtbar ist. */
export async function getEvent(scope: Scope, id: string): Promise<EventDto | null> {
  const e = await prisma.event.findUnique({ where: { id } });
  if (!e) return null;
  const access = await ownerAccess(scope, e);
  if (!access?.visible) return null;
  return toEventDto(e, access.editable);
}

/**
 * Ereignisse mehrerer Personen bzw. Beziehungen in einem Rutsch — ohne
 * Rechteprüfung; nur für Dienste, die die Sichtbarkeit selbst geprüft haben.
 */
export async function loadEventsFor(
  where: { personIds?: string[]; relationshipIds?: string[] },
  options: { includeAlternatives?: boolean } = {},
): Promise<EventRow[]> {
  const or: Prisma.EventWhereInput[] = [];
  if (where.personIds?.length) or.push({ personId: { in: where.personIds } });
  if (where.relationshipIds?.length) or.push({ relationshipId: { in: where.relationshipIds } });
  if (or.length === 0) return [];
  const rows = await prisma.event.findMany({
    where: { OR: or, ...(options.includeAlternatives === false ? { isAlternative: false } : {}) },
  });
  return rows.sort(compareEvents);
}

// ---------------------------------------------------------------------------
// Ändern
// ---------------------------------------------------------------------------

function ruleIssuesOrThrow(e: { type: EventTypeName; isAlternative: boolean; label?: string | null }, owner: EventOwner) {
  const issues = eventIssues({ ...e, owner });
  if (issues.length > 0) throw validationError(issues);
}

/**
 * Neues Ereignis an einer Person oder Beziehung. `input` ist bewusst
 * `unknown` — Validierung, Rechte und Fachregeln (lib/events.ts) laufen hier.
 * Datum als Text wie überall (parseFuzzyDate: „um 1850“, „zwischen 1850 und
 * 1855“, …), Unlesbares als `datePhrase`.
 */
export async function createEvent(scope: Scope, input: unknown): Promise<EventDto> {
  const data = parseOrThrow(eventInput.safeParse(input));
  const access = await ownerAccess(scope, data);
  if (!access?.visible) throw notFoundError(data.personId ? "Person" : "Beziehung");
  if (!access.editable) throw forbiddenError("Ereignisse hier zu erfassen");
  ruleIssuesOrThrow(data, access.owner);

  const { date, ...rest } = data;
  const event = await prisma.event.create({
    data: {
      ...rest,
      personId: data.personId ?? null,
      relationshipId: data.relationshipId ?? null,
      ...fuzzyColumns("date", date),
    },
  });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Event",
    entityId: event.id,
    diff: toEventDto(event, true),
  });
  return toEventDto(event, true);
}

/** Teil-Update. Träger bleibt fest. Fehlende Felder bleiben unverändert. */
export async function updateEvent(scope: Scope, id: string, patch: unknown): Promise<EventDto> {
  const { existing, access } = await loadForEdit(scope, id, "dieses Ereignis zu ändern");
  const data = parseOrThrow(eventPatch.safeParse(patch));

  ruleIssuesOrThrow(
    {
      type: data.type ?? existing.type,
      isAlternative: data.isAlternative ?? existing.isAlternative,
      label: data.label !== undefined ? data.label : existing.label,
    },
    access.owner,
  );

  const { date, datePhrase, ...rest } = data;
  const phrase = phraseAfterUpdate(fuzzyField(existing, "date"), date, existing.datePhrase, datePhrase);
  const columns = {
    ...rest,
    ...(date !== undefined ? fuzzyColumns("date", date) : {}),
    ...(phrase !== undefined ? { datePhrase: phrase } : {}),
  };
  const event = await prisma.event.update({ where: { id }, data: columns });

  const changes = fieldChanges(existing, columns);
  if (Object.keys(changes).length > 0) {
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "Event",
      entityId: id,
      diff: { subject: eventTitle(event), changes },
    });
  }
  return toEventDto(event, true);
}

/** Löscht ein Ereignis samt seiner Belege. */
export async function deleteEvent(scope: Scope, id: string): Promise<{ ok: true }> {
  const { existing } = await loadForEdit(scope, id, "dieses Ereignis zu löschen");
  await prisma.event.delete({ where: { id } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Event",
    entityId: id,
    diff: toEventDto(existing, true),
  });
  return { ok: true };
}
