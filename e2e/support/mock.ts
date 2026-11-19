import { generateMockData, type MockPerson } from "../../prisma/mock-data";

/**
 * Derselbe deterministische Datensatz, den `npm run db:mock` einspielt. Die
 * Tests lesen IDs und Namen von hier statt sie abzuschreiben — ändert sich
 * der Generator, ziehen die Tests mit.
 */
export const mock = generateMockData();
export const L = mock.landmarks;

const byId = new Map(mock.persons.map((p) => [p.id, p]));

export function person(id: string): MockPerson {
  const p = byId.get(id);
  if (!p) throw new Error(`Mock-Person ${id} gibt es nicht`);
  return p;
}

export const fullName = (id: string) => {
  const p = person(id);
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
};

export const FAMILY = {
  A: "mock-family-a",
  B: "mock-family-b",
  C: "mock-family-c",
  D: "mock-family-d",
} as const;

export function familyName(key: keyof typeof FAMILY): string {
  return mock.families.find((f) => f.id === FAMILY[key])!.name;
}

/** Personen, die ein Benutzer mit diesen Familien sehen darf. */
export function visibleFor(keys: string[]): MockPerson[] {
  return mock.persons.filter((p) => p.familyKeys.some((k) => keys.includes(k)));
}

/**
 * Vollständige Namen, die für einen Benutzer mit diesen Familien nirgends
 * auftauchen dürfen: Personen außerhalb seiner Familien, deren Name nicht
 * zufällig auch eine sichtbare Person trägt.
 */
export function forbiddenNamesFor(keys: string[]): string[] {
  const visibleNames = new Set(visibleFor(keys).map((p) => fullName(p.id)));
  return mock.persons
    .filter((p) => !p.familyKeys.some((k) => keys.includes(k)))
    .map((p) => fullName(p.id))
    .filter((n) => !visibleNames.has(n));
}

export const USERS = {
  admin: "admin@example.test",
  editor: "editor@example.test",
  viewer: "viewer@example.test",
  nofamily: "nofamily@example.test",
  blocked: "blocked@example.test",
} as const;

export type Role = Exclude<keyof typeof USERS, "blocked">;
