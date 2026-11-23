import { prisma } from "../prisma";
import { audit, auditActor, fieldChanges } from "../audit";
import { canEditRelationshipBetween, canViewPerson, familyIdsOf, type Scope } from "../scope";
import {
  MAX_BIOLOGICAL_PARENTS,
  relationshipInput,
  relationshipIssues,
  relationshipPatch,
} from "../validation";
import {
  conflictError,
  forbiddenError,
  notFoundError,
  parseOrThrow,
  validationError,
} from "./errors";
import { toRelationshipDto, type RelationshipDto } from "./dto";
import { assertNoMediaLossViaAi, mediaAttachedTo, removeOrphanedMedia } from "./media";
import { queuePlaceAutoAssign } from "./places";
import { phraseColumns } from "./persons";
import { fuzzyColumns, fuzzyField, type FuzzyDate } from "../dates";

/** Validierte Eingabe -> Prisma-Spalten (Anker, Genauigkeit, Zusatz). */
function relationshipColumns<T extends { startDate?: FuzzyDate | null; endDate?: FuzzyDate | null }>(data: T) {
  const { startDate, endDate, ...rest } = data;
  return {
    ...rest,
    ...(startDate !== undefined ? fuzzyColumns("startDate", startDate) : {}),
    ...(endDate !== undefined ? fuzzyColumns("endDate", endDate) : {}),
  };
}

/**
 * Prüft, ob `parentId` bereits Nachfahre von `childId` ist. Verhindert Zyklen
 * wie "A ist Elternteil von B" + "B ist Elternteil von A", die jede
 * Abstammungsauswertung unsinnig machen. Läuft ebenenweise nach unten und
 * merkt sich besuchte Personen.
 */
export async function wouldCreateCycle(
  parentId: string,
  childId: string,
): Promise<boolean> {
  if (parentId === childId) return true;

  const visited = new Set<string>([childId]);
  let frontier = [childId];

  while (frontier.length > 0) {
    const edges = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", fromPersonId: { in: frontier } },
      select: { toPersonId: true },
    });

    const next: string[] = [];
    for (const { toPersonId } of edges) {
      if (toPersonId === parentId) return true;
      if (!visited.has(toPersonId)) {
        visited.add(toPersonId);
        next.push(toPersonId);
      }
    }
    frontier = next;
  }

  return false;
}

/**
 * Rechte an einer Beziehung: Bearbeitungsrecht an mindestens einer Seite und
 * Sichtbarkeit beider Seiten (siehe canEditRelationshipBetween). Ist keine der
 * beiden Personen sichtbar, gilt die Beziehung als nicht vorhanden.
 */
async function assertCanEdit(
  scope: Scope,
  fromPersonId: string,
  toPersonId: string,
  what: string,
): Promise<void> {
  if (scope.isAdmin) return;
  const families = await familyIdsOf([fromPersonId, toPersonId]);
  const from = families.get(fromPersonId) ?? [];
  const to = families.get(toPersonId) ?? [];
  if (!canViewPerson(scope, from) && !canViewPerson(scope, to)) {
    throw notFoundError("Beziehung");
  }
  if (!canEditRelationshipBetween(scope, from, to)) throw forbiddenError(what);
}

async function assertBiologicalParentLimit(
  childId: string,
  ignoreRelationshipId?: string,
): Promise<void> {
  const count = await prisma.relationship.count({
    where: {
      type: "PARENT_OF",
      subtype: "BIOLOGICAL",
      toPersonId: childId,
      ...(ignoreRelationshipId ? { id: { not: ignoreRelationshipId } } : {}),
    },
  });
  if (count >= MAX_BIOLOGICAL_PARENTS) {
    throw conflictError(
      `Diese Person hat bereits ${MAX_BIOLOGICAL_PARENTS} leibliche Elternteile. ` +
        "Weitere Eltern bitte als Adoptiv-, Stief- oder Pflegeelternteil eintragen.",
    );
  }
}

/**
 * Legt eine Beziehung an — mit allen Regeln: Art passt zum Typ, plausible
 * Daten, keine Zyklen, höchstens zwei leibliche Eltern, keine Dubletten.
 * Partnerschaften werden kanonisch (fromId < toId) gespeichert.
 */
export async function createRelationship(
  scope: Scope,
  input: unknown,
): Promise<RelationshipDto> {
  const parsed = parseOrThrow(relationshipInput.safeParse(input));
  const { type, subtype, startDate, endDate, notes, startPlace, endPlace, startDatePhrase, endDatePhrase } = parsed;
  let { fromPersonId, toPersonId } = parsed;

  const found = await prisma.person.count({
    where: { id: { in: [fromPersonId, toPersonId] } },
  });
  if (found !== 2) throw notFoundError("Person");

  // Eine nicht freigegebene Person gilt wie eine nicht vorhandene (dieselbe
  // Antwort) — sonst verriete 403 statt 404, dass es sie gibt.
  if (!scope.isAdmin) {
    const families = await familyIdsOf([fromPersonId, toPersonId]);
    for (const pid of [fromPersonId, toPersonId]) {
      if (!canViewPerson(scope, families.get(pid) ?? [])) throw notFoundError("Person");
    }
  }

  await assertCanEdit(scope, fromPersonId, toPersonId, "diese Beziehung anzulegen");

  // PARTNER_OF ist ungerichtet — kanonisch sortiert speichern, damit die
  // Unique-Constraint doppelte Partnerschaften in beiden Richtungen verhindert.
  if (type === "PARTNER_OF" && fromPersonId > toPersonId) {
    [fromPersonId, toPersonId] = [toPersonId, fromPersonId];
  }

  if (type === "PARENT_OF") {
    if (await wouldCreateCycle(fromPersonId, toPersonId)) {
      throw conflictError("Diese Eltern-Kind-Beziehung würde einen Zyklus erzeugen.");
    }
    // Eine Person kann nicht zugleich Partner und Elternteil derselben Person sein.
    const [a, b] =
      fromPersonId < toPersonId ? [fromPersonId, toPersonId] : [toPersonId, fromPersonId];
    const partner = await prisma.relationship.count({
      where: { type: "PARTNER_OF", fromPersonId: a, toPersonId: b },
    });
    if (partner > 0) {
      throw conflictError("Diese beiden Personen sind bereits als Partner verbunden.");
    }
    if (subtype === "BIOLOGICAL") await assertBiologicalParentLimit(toPersonId);
  } else {
    const parentLink = await prisma.relationship.count({
      where: {
        type: "PARENT_OF",
        OR: [
          { fromPersonId, toPersonId },
          { fromPersonId: toPersonId, toPersonId: fromPersonId },
        ],
      },
    });
    if (parentLink > 0) {
      throw conflictError("Eltern und Kind können nicht als Partner verbunden werden.");
    }
  }

  const existing = await prisma.relationship.findFirst({
    where: {
      type,
      OR: [
        { fromPersonId, toPersonId },
        { fromPersonId: toPersonId, toPersonId: fromPersonId },
      ],
    },
  });
  if (existing) throw conflictError("Diese Beziehung existiert bereits.");

  const relationship = await prisma.relationship.create({
    data: {
      type,
      subtype,
      fromPersonId,
      toPersonId,
      notes,
      startPlace,
      endPlace,
      startDatePhrase,
      endDatePhrase,
      ...relationshipColumns({ startDate, endDate }),
    },
  });

  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Relationship",
    entityId: relationship.id,
    diff: toRelationshipDto(relationship),
  });
  await queuePlaceAutoAssign(scope, [relationship.startPlace, relationship.endPlace]);

  return toRelationshipDto(relationship);
}

/**
 * Korrigiert Art, Zeitraum und Notiz. Die verknüpften Personen bleiben fest —
 * eine falsche Zuordnung wird gelöscht und neu angelegt, nicht umgebogen.
 */
export async function updateRelationship(
  scope: Scope,
  id: string,
  patch: unknown,
): Promise<RelationshipDto> {
  const existing = await prisma.relationship.findUnique({ where: { id } });
  if (!existing) throw notFoundError("Beziehung");

  await assertCanEdit(
    scope,
    existing.fromPersonId,
    existing.toPersonId,
    "diese Beziehung zu ändern",
  );

  const data = parseOrThrow(relationshipPatch.safeParse(patch));

  const merged = {
    type: existing.type,
    subtype: data.subtype ?? existing.subtype,
    startDate: data.startDate !== undefined ? data.startDate : fuzzyField(existing, "startDate"),
    endDate: data.endDate !== undefined ? data.endDate : fuzzyField(existing, "endDate"),
  };
  const issues = relationshipIssues(merged);
  if (issues.length > 0) throw validationError(issues);

  if (
    existing.type === "PARENT_OF" &&
    merged.subtype === "BIOLOGICAL" &&
    existing.subtype !== "BIOLOGICAL"
  ) {
    await assertBiologicalParentLimit(existing.toPersonId, existing.id);
  }

  const { startDatePhrase: _sp, endDatePhrase: _ep, ...withoutPhrases } = data;
  const columns = {
    ...relationshipColumns(withoutPhrases),
    ...phraseColumns(existing, data, ["startDate", "endDate"]),
  };
  const relationship = await prisma.relationship.update({
    where: { id },
    data: columns,
  });

  const changes = fieldChanges(existing, columns);
  if (Object.keys(changes).length > 0) {
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "Relationship",
      entityId: id,
      diff: { changes },
    });
  }
  if (changes.startPlace || changes.endPlace) {
    await queuePlaceAutoAssign(scope, [changes.startPlace?.to as string | null, changes.endPlace?.to as string | null]);
  }

  return toRelationshipDto(relationship);
}

export async function deleteRelationship(
  scope: Scope,
  id: string,
): Promise<{ ok: true }> {
  const existing = await prisma.relationship.findUnique({ where: { id } });
  if (!existing) throw notFoundError("Beziehung");

  await assertCanEdit(
    scope,
    existing.fromPersonId,
    existing.toPersonId,
    "diese Beziehung zu löschen",
  );

  // Hochzeitsbilder hängen nur an der Beziehung — ohne sie wären sie verwaist.
  // Mit der Beziehung gehen (Cascade) auch ihre Ereignisse und Belege; deren
  // Bilder zählen deshalb mit.
  const [events, citations, own] = await Promise.all([
    prisma.event.findMany({ where: { relationshipId: id }, select: { id: true } }),
    prisma.citation.findMany({
      where: { OR: [{ relationshipId: id }, { event: { relationshipId: id } }] },
      select: { id: true },
    }),
    prisma.relationshipMedia.findMany({ where: { relationshipId: id }, select: { mediaId: true } }),
  ]);
  const eventIds = events.map((e) => e.id);
  const citationIds = citations.map((c) => c.id);
  const mediaIds = [
    ...new Set([...own.map((m) => m.mediaId), ...(await mediaAttachedTo({ eventIds, citationIds }))]),
  ];

  // Über den KI-Zugang wird nie ein Bild gelöscht (wie bei link_media).
  await assertNoMediaLossViaAi(scope, mediaIds, { relationshipIds: [id], eventIds, citationIds });

  await prisma.relationship.delete({ where: { id } });

  const removedMedia = await removeOrphanedMedia(mediaIds);

  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Relationship",
    entityId: id,
    diff: { ...toRelationshipDto(existing), removedMedia },
  });

  return { ok: true };
}
