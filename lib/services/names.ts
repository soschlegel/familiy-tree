import type { PersonName } from "@prisma/client";

import { prisma } from "../prisma";
import { audit, auditActor, fieldChanges } from "../audit";
import { canEditPerson, canViewPerson, familyIdsOfPerson, type Scope } from "../scope";
import { personNameInput, personNamePatch } from "../validation";
import { PERSON_NAME_TYPE_LABEL, type PersonNameTypeName } from "../events";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";

/**
 * Weitere Namen einer Person (Ehenamen, Schreibvarianten, „auch bekannt als“
 * …). Der Hauptname bleibt in Person (givenName/familyName/birthName sowie
 * nickname/namePrefix/nameSuffix). Rechte = Rechte an der Person.
 */

export type PersonNameDto = {
  id: string;
  personId: string;
  type: PersonNameTypeName;
  typeLabel: string;
  givenName: string | null;
  familyName: string | null;
  prefix: string | null;
  suffix: string | null;
  nickname: string | null;
  label: string | null;
  notes: string | null;
  sortOrder: number;
  /** Ganzer Name zur Anzeige, z.B. „Dr. Anna Maria Schulz jun.“. */
  display: string;
};

export function toPersonNameDto(n: PersonName): PersonNameDto {
  return {
    id: n.id,
    personId: n.personId,
    type: n.type,
    typeLabel: n.type === "OTHER" && n.label ? n.label : PERSON_NAME_TYPE_LABEL[n.type],
    givenName: n.givenName,
    familyName: n.familyName,
    prefix: n.prefix,
    suffix: n.suffix,
    nickname: n.nickname,
    label: n.label,
    notes: n.notes,
    sortOrder: n.sortOrder,
    display:
      [n.prefix, n.givenName, n.nickname ? `„${n.nickname}“` : null, n.familyName, n.suffix].filter(Boolean).join(" "),
  };
}

const byOrder = (a: PersonName, b: PersonName) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

async function personRights(scope: Scope, personId: string) {
  const exists = await prisma.person.count({ where: { id: personId } });
  if (!exists) return null;
  const families = await familyIdsOfPerson(personId);
  return { visible: canViewPerson(scope, families), editable: canEditPerson(scope, families) };
}

/** Namen einer sichtbaren Person; null = Person unsichtbar. */
export async function listPersonNames(scope: Scope, personId: string): Promise<PersonNameDto[] | null> {
  const rights = await personRights(scope, personId);
  if (!rights?.visible) return null;
  const rows = await prisma.personName.findMany({ where: { personId } });
  return rows.sort(byOrder).map(toPersonNameDto);
}

export async function createPersonName(scope: Scope, input: unknown): Promise<PersonNameDto> {
  const data = parseOrThrow(personNameInput.safeParse(input));
  const rights = await personRights(scope, data.personId);
  if (!rights?.visible) throw notFoundError("Person");
  if (!rights.editable) throw forbiddenError("Namen dieser Person zu ändern");
  const row = await prisma.personName.create({ data });
  await audit({ ...auditActor(scope), action: "CREATE", entityType: "PersonName", entityId: row.id, diff: data });
  return toPersonNameDto(row);
}

async function loadForEdit(scope: Scope, id: string, what: string) {
  const existing = await prisma.personName.findUnique({ where: { id } });
  if (!existing) throw notFoundError("Name");
  const rights = await personRights(scope, existing.personId);
  if (!rights?.visible) throw notFoundError("Name");
  if (!rights.editable) throw forbiddenError(what);
  return existing;
}

export async function updatePersonName(scope: Scope, id: string, patch: unknown): Promise<PersonNameDto> {
  const existing = await loadForEdit(scope, id, "diesen Namen zu ändern");
  const data = parseOrThrow(personNamePatch.safeParse(patch));
  const merged = { ...existing, ...data };
  if (!merged.givenName && !merged.familyName && !merged.nickname) {
    throw validationError([{ path: "givenName", message: "Bitte mindestens Vorname, Nachname oder Rufname angeben" }]);
  }
  const row = await prisma.personName.update({ where: { id }, data });
  const changes = fieldChanges(existing, data);
  if (Object.keys(changes).length > 0) {
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "PersonName",
      entityId: id,
      diff: { subject: toPersonNameDto(row).display, changes },
    });
  }
  return toPersonNameDto(row);
}

export async function deletePersonName(scope: Scope, id: string): Promise<{ ok: true }> {
  const existing = await loadForEdit(scope, id, "diesen Namen zu entfernen");
  await prisma.personName.delete({ where: { id } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "PersonName",
    entityId: id,
    diff: toPersonNameDto(existing),
  });
  return { ok: true };
}
