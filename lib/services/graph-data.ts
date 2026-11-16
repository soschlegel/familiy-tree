import type { Gender } from "@prisma/client";

import { prisma } from "../prisma";
import { canViewPerson, type Scope } from "../scope";
import { buildGraphIndex, type GraphEdge, type GraphIndex } from "../graph";

/**
 * Lädt den kompletten Graphen samt Sichtbarkeit je Person.
 *
 * Die Struktur (wer mit wem verbunden ist) wird wie in der Baumansicht nicht
 * verborgen — unsichtbare Personen erscheinen später als Platzhalter. Alle
 * Angaben einer Person dürfen das Ergebnis aber nur verlassen, wenn
 * `visible` gesetzt ist; dafür sorgen die aufrufenden Dienste.
 *
 * Bewusst ein einziger Ladevorgang statt vieler Einzelabfragen: bei der
 * Größenordnung eines Familienstammbaums (bis ~1000 Personen) ist das schneller
 * und vor allem einfacher korrekt zu halten.
 */
export type GraphPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birthDate: Date | null;
  birthPlace: string | null;
  deathDate: Date | null;
  deathPlace: string | null;
  hasNotes: boolean;
  familyIds: string[];
  primaryMediaId: string | null;
  visible: boolean;
};

export type GraphRelationship = GraphEdge & {
  startDate: Date | null;
  endDate: Date | null;
  primaryMediaId: string | null;
};

export type LoadedGraph = {
  persons: Map<string, GraphPerson>;
  relationships: GraphRelationship[];
  index: GraphIndex;
};

export async function loadGraph(scope: Scope): Promise<LoadedGraph> {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        birthName: true,
        gender: true,
        birthDate: true,
        birthPlace: true,
        deathDate: true,
        deathPlace: true,
        notes: true,
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
        families: { select: { familyId: true } },
      },
    }),
    prisma.relationship.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        subtype: true,
        fromPersonId: true,
        toPersonId: true,
        startDate: true,
        endDate: true,
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
  ]);

  const map = new Map<string, GraphPerson>();
  for (const p of persons) {
    const familyIds = p.families.map((f) => f.familyId);
    map.set(p.id, {
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      gender: p.gender,
      birthDate: p.birthDate,
      birthPlace: p.birthPlace,
      deathDate: p.deathDate,
      deathPlace: p.deathPlace,
      hasNotes: Boolean(p.notes),
      familyIds,
      primaryMediaId: p.media[0]?.mediaId ?? null,
      visible: canViewPerson(scope, familyIds),
    });
  }

  const rels: GraphRelationship[] = relationships.map((r) => ({
    id: r.id,
    type: r.type,
    subtype: r.subtype,
    from: r.fromPersonId,
    to: r.toPersonId,
    startDate: r.startDate,
    endDate: r.endDate,
    primaryMediaId: r.media[0]?.mediaId ?? null,
  }));

  return { persons: map, relationships: rels, index: buildGraphIndex(rels) };
}
