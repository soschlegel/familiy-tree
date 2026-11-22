import { prisma } from "./prisma";
import {
  canEditPerson,
  canEditRelationship,
  canEditRelationshipBetween,
  canViewPerson,
  familyIdsOf,
  type Scope,
} from "./scope";

/**
 * Rechte an einem Bild ergeben sich aus dem, woran es hängt:
 * - an einer Person über deren Familien,
 * - an einer Beziehung über deren beide Personen (sichtbar, sobald eine Seite
 *   sichtbar ist; änderbar nach canEditRelationshipBetween),
 * - an einem Ereignis bzw. Beleg wie dessen Träger (Person oder Beziehung),
 * - an einer Quelle (Hauptscan Source.mediaId oder SourceMedia) wie die
 *   Quelle: sichtbar für Admins, den Ersteller und jeden, der einen ihrer
 *   Belege sieht; änderbar für Admins, den Ersteller und jeden, der einen
 *   ihrer Belege bearbeiten darf (lib/services/sources.ts).
 *
 * Ein Bild ohne jede Zuordnung ist verwaist und bleibt Admins vorbehalten —
 * andernfalls wäre ein Upload ohne Zuordnung ein Weg, Bilder an der
 * Rechteprüfung vorbei sichtbar zu machen.
 */

export type MediaOwnerKind = "person" | "relationship" | "event" | "citation" | "source";
export type MediaOwnerRights = { kind: MediaOwnerKind; id: string; visible: boolean; editable: boolean };

type Fam = { families: { familyId: string }[] };
const famSel = { families: { select: { familyId: true } } } as const;
const fam = (p: Fam) => p.families.map((f) => f.familyId);

/** Rechte an einem Träger (Person bzw. Beziehung), wie überall in der App. */
function carrierRights(
  scope: Scope,
  c: { person: Fam | null; relationship: { fromPerson: Fam; toPerson: Fam } | null },
): { visible: boolean; editable: boolean } {
  if (c.person) return { visible: canViewPerson(scope, fam(c.person)), editable: canEditPerson(scope, fam(c.person)) };
  if (c.relationship) {
    const from = fam(c.relationship.fromPerson);
    const to = fam(c.relationship.toPerson);
    return {
      visible: canViewPerson(scope, from) || canViewPerson(scope, to),
      editable: canEditRelationshipBetween(scope, from, to),
    };
  }
  return { visible: scope.isAdmin, editable: scope.isAdmin };
}

const carrierSel = {
  person: { select: famSel },
  relationship: { select: { fromPerson: { select: famSel }, toPerson: { select: famSel } } },
} as const;

/** Rechte an einer Quelle (dieselbe Regel wie loadSourceAccess in lib/services/sources.ts). */
export async function sourceRights(scope: Scope, sourceId: string): Promise<{ visible: boolean; editable: boolean } | null> {
  const s = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { createdById: true, citations: { select: carrierSel } },
  });
  if (!s) return null;
  if (scope.isAdmin) return { visible: true, editable: true };
  const isCreator = s.createdById !== null && s.createdById === scope.userId;
  const rated = s.citations.map((c) => carrierRights(scope, c));
  return {
    visible: isCreator || rated.some((r) => r.visible),
    editable: isCreator || rated.some((r) => r.visible && r.editable),
  };
}

/** Rechte an einem Ereignis (wie sein Träger). null = gibt es nicht. */
export async function eventRights(scope: Scope, eventId: string) {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: carrierSel });
  return e ? carrierRights(scope, e) : null;
}

/** Rechte an einem Beleg (wie sein Träger). null = gibt es nicht. */
export async function citationRights(scope: Scope, citationId: string) {
  const c = await prisma.citation.findUnique({ where: { id: citationId }, select: carrierSel });
  return c ? carrierRights(scope, c) : null;
}

/** Alle Zuordnungen eines Bildes mit den Rechten des Benutzers daran. */
export async function mediaOwners(scope: Scope, mediaId: string): Promise<MediaOwnerRights[]> {
  const [persons, rels, events, citations, sourceLinks, mainScans] = await Promise.all([
    prisma.personMedia.findMany({ where: { mediaId }, select: { personId: true, person: { select: famSel } } }),
    prisma.relationshipMedia.findMany({
      where: { mediaId },
      select: { relationshipId: true, relationship: { select: { fromPerson: { select: famSel }, toPerson: { select: famSel } } } },
    }),
    prisma.eventMedia.findMany({ where: { mediaId }, select: { eventId: true, event: { select: carrierSel } } }),
    prisma.citationMedia.findMany({ where: { mediaId }, select: { citationId: true, citation: { select: carrierSel } } }),
    prisma.sourceMedia.findMany({ where: { mediaId }, select: { sourceId: true } }),
    prisma.source.findMany({ where: { mediaId }, select: { id: true } }),
  ]);
  const out: MediaOwnerRights[] = [
    ...persons.map((p) => ({ kind: "person" as const, id: p.personId, ...carrierRights(scope, { person: p.person, relationship: null }) })),
    ...rels.map((r) => ({ kind: "relationship" as const, id: r.relationshipId, ...carrierRights(scope, { person: null, relationship: r.relationship }) })),
    ...events.map((e) => ({ kind: "event" as const, id: e.eventId, ...carrierRights(scope, e.event) })),
    ...citations.map((c) => ({ kind: "citation" as const, id: c.citationId, ...carrierRights(scope, c.citation) })),
  ];
  const sourceIds = [...new Set([...sourceLinks.map((s) => s.sourceId), ...mainScans.map((s) => s.id)])];
  for (const id of sourceIds) {
    const r = await sourceRights(scope, id);
    if (r) out.push({ kind: "source", id, ...r });
  }
  return out;
}

export async function canViewMedia(scope: Scope, mediaId: string): Promise<boolean> {
  if (scope.isAdmin) return true;
  return (await mediaOwners(scope, mediaId)).some((o) => o.visible);
}

/**
 * Ein Bild ganz löschen (aus allen Zuordnungen): wie bisher, wenn der
 * Benutzer eine der Personen bzw. Beziehungen bearbeiten darf, an denen es
 * hängt — hängt es zusätzlich an Ereignissen, Belegen oder Quellen, muss er
 * auch jede dieser Zuordnungen bearbeiten dürfen (sonst nähme das Löschen
 * anderen ein Belegbild weg, das sie nicht ändern dürften). Ein Bild nur an
 * Ereignissen, Belegen oder Quellen: alle Zuordnungen bearbeitbar.
 */
export async function canDeleteMedia(scope: Scope, mediaId: string): Promise<boolean> {
  if (scope.isAdmin) return true;
  const owners = await mediaOwners(scope, mediaId);
  if (owners.length === 0) return false;
  const classic = owners.filter((o) => o.kind === "person" || o.kind === "relationship");
  const extra = owners.filter((o) => o.kind !== "person" && o.kind !== "relationship");
  if (extra.some((o) => !o.editable)) return false;
  return classic.length === 0 ? true : classic.some((o) => o.editable);
}

export async function canUploadForPerson(scope: Scope, personId: string): Promise<boolean> {
  if (scope.isAdmin) return true;
  const families = await familyIdsOf([personId]);
  return canEditPerson(scope, families.get(personId) ?? []);
}

export async function canUploadForRelationship(scope: Scope, relationshipId: string): Promise<boolean> {
  if (scope.isAdmin) return true;
  const rel = await prisma.relationship.findUnique({
    where: { id: relationshipId },
    select: { fromPersonId: true, toPersonId: true },
  });
  if (!rel) return false;
  return canEditRelationship(scope, rel.fromPersonId, rel.toPersonId);
}
