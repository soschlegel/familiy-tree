import type { TreeData } from "@/lib/tree-layout";
import type { GraphEdge } from "@/lib/graph";
import { generateMockData, type MockData } from "@/prisma/mock-data";

let cached: MockData | null = null;
export function mockData(): MockData {
  cached ??= generateMockData();
  return cached;
}

/** Mock-Daten in der Form, die die Baumansicht bekommt (Admin-Sicht). */
export function mockTreeData(): TreeData {
  const d = mockData();
  return {
    persons: d.persons.map((p) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: p.birthDate?.toISOString() ?? null,
      deathDate: p.deathDate?.toISOString() ?? null,
      primaryMediaId: null,
      restricted: false,
      familyIds: p.familyKeys,
    })),
    relationships: d.relationships.map((r) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
      startDate: r.startDate?.toISOString() ?? null,
      endDate: r.endDate?.toISOString() ?? null,
      primaryMediaId: null,
    })),
  };
}

export function mockEdges(): GraphEdge[] {
  return mockData().relationships.map((r) => ({
    id: r.id,
    type: r.type,
    subtype: r.subtype,
    from: r.fromPersonId,
    to: r.toPersonId,
  }));
}
