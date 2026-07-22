import { prisma } from "./prisma";
import {
  canEditPerson,
  canEditRelationship,
  canViewPerson,
  familyIdsOf,
  type Scope,
} from "./scope";

/**
 * Rechte an einem Bild ergeben sich aus dem, woran es hängt: an einer Person
 * über deren Familien, an einer Beziehung über deren beide Personen.
 *
 * Ein Bild ohne jede Zuordnung ist verwaist und bleibt Admins vorbehalten —
 * andernfalls wäre ein Upload ohne Zuordnung ein Weg, Bilder an der
 * Rechteprüfung vorbei sichtbar zu machen.
 */
async function ownersOf(mediaId: string) {
  const [personLinks, relationLinks] = await Promise.all([
    prisma.personMedia.findMany({
      where: { mediaId },
      select: { personId: true },
    }),
    prisma.relationshipMedia.findMany({
      where: { mediaId },
      select: { relationship: { select: { fromPersonId: true, toPersonId: true } } },
    }),
  ]);

  return {
    personIds: personLinks.map((l) => l.personId),
    relationships: relationLinks.map((l) => l.relationship),
  };
}

export async function canViewMedia(
  scope: Scope,
  mediaId: string,
): Promise<boolean> {
  if (scope.isAdmin) return true;

  const { personIds, relationships } = await ownersOf(mediaId);
  const allPersons = [
    ...personIds,
    ...relationships.flatMap((r) => [r.fromPersonId, r.toPersonId]),
  ];
  if (allPersons.length === 0) return false;

  const families = await familyIdsOf(allPersons);
  return allPersons.some((id) => canViewPerson(scope, families.get(id) ?? []));
}

export async function canDeleteMedia(
  scope: Scope,
  mediaId: string,
): Promise<boolean> {
  if (scope.isAdmin) return true;

  const { personIds, relationships } = await ownersOf(mediaId);
  if (personIds.length === 0 && relationships.length === 0) return false;

  const families = await familyIdsOf(personIds);
  const viaPerson = personIds.some((id) =>
    canEditPerson(scope, families.get(id) ?? []),
  );
  if (viaPerson) return true;

  for (const rel of relationships) {
    if (await canEditRelationship(scope, rel.fromPersonId, rel.toPersonId)) {
      return true;
    }
  }
  return false;
}

export async function canUploadForPerson(
  scope: Scope,
  personId: string,
): Promise<boolean> {
  if (scope.isAdmin) return true;
  const families = await familyIdsOf([personId]);
  return canEditPerson(scope, families.get(personId) ?? []);
}

export async function canUploadForRelationship(
  scope: Scope,
  relationshipId: string,
): Promise<boolean> {
  if (scope.isAdmin) return true;
  const rel = await prisma.relationship.findUnique({
    where: { id: relationshipId },
    select: { fromPersonId: true, toPersonId: true },
  });
  if (!rel) return false;
  return canEditRelationship(scope, rel.fromPersonId, rel.toPersonId);
}
