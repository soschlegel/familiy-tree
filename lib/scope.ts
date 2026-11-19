import type { FamilyRole, Role } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * Familienbezogene Rechte. Bewusst eine einzige Stelle: die Frage „darf dieser
 * Benutzer diese Person sehen/ändern?" wird an vielen Punkten gestellt, und
 * jede eigenständige Antwort wäre eine potenzielle Lücke.
 *
 * Regeln:
 * - ADMIN sieht und ändert alles, auch Personen ohne Familie.
 * - Alle anderen sehen eine Person, sobald sie mindestens eine Familie mit ihr
 *   teilen. Bearbeiten dürfen sie, wenn sie in mindestens einer gemeinsamen
 *   Familie die Rolle EDITOR haben.
 * - Personen ohne jede Familienzuordnung sind ausschließlich für ADMIN
 *   sichtbar. Das ist die sichere Grundeinstellung: eine vergessene Zuordnung
 *   gibt nichts frei, statt versehentlich alles.
 */
export type Scope = {
  userId: string;
  isAdmin: boolean;
  /** familyId -> Rolle in dieser Familie */
  families: Map<string, FamilyRole>;
  /**
   * Gesetzt, wenn der Aufruf über den KI-Kanal (MCP) kommt — sonst Web-App.
   * Die Dienste geben ihn an das Audit weiter (lib/audit.ts, auditActor); die
   * Familienrechte oben gelten unverändert zusätzlich.
   */
  via?: ScopeVia;
};

export type ScopeVia = {
  channel: "MCP";
  /** ApiToken.id; null im lokalen Entwicklungsmodus (stdio, ohne Schlüssel). */
  tokenId: string | null;
  /** Wirksame Stufe dieses Aufrufs: min(Schlüssel, Benutzerrecht). */
  level: "READ" | "WRITE";
};

export async function loadScope(
  userId: string,
  role: Role,
): Promise<Scope> {
  const memberships = await prisma.userFamily.findMany({
    where: { userId },
    select: { familyId: true, role: true },
  });

  return {
    userId,
    isAdmin: role === "ADMIN",
    families: new Map(memberships.map((m) => [m.familyId, m.role])),
  };
}

export function viewableFamilyIds(scope: Scope): string[] {
  return [...scope.families.keys()];
}

export function editableFamilyIds(scope: Scope): string[] {
  return [...scope.families.entries()]
    .filter(([, role]) => role === "EDITOR")
    .map(([familyId]) => familyId);
}

export function canViewPerson(scope: Scope, familyIds: string[]): boolean {
  if (scope.isAdmin) return true;
  return familyIds.some((id) => scope.families.has(id));
}

export function canEditPerson(scope: Scope, familyIds: string[]): boolean {
  if (scope.isAdmin) return true;
  return familyIds.some((id) => scope.families.get(id) === "EDITOR");
}

/** Prisma-Filter für Abfragen, die nur sichtbare Personen liefern sollen. */
export function personVisibilityFilter(scope: Scope) {
  if (scope.isAdmin) return {};
  const ids = viewableFamilyIds(scope);
  // Ohne Familienzugehörigkeit ist nichts sichtbar — ein leeres `in` liefert
  // korrekt die leere Menge.
  return { families: { some: { familyId: { in: ids } } } };
}

/** Familien-IDs mehrerer Personen in einem Rutsch. */
export async function familyIdsOf(
  personIds: string[],
): Promise<Map<string, string[]>> {
  const rows = await prisma.personFamily.findMany({
    where: { personId: { in: personIds } },
    select: { personId: true, familyId: true },
  });

  const map = new Map<string, string[]>();
  for (const id of personIds) map.set(id, []);
  for (const row of rows) map.get(row.personId)?.push(row.familyId);
  return map;
}

export async function familyIdsOfPerson(personId: string): Promise<string[]> {
  const rows = await prisma.personFamily.findMany({
    where: { personId },
    select: { familyId: true },
  });
  return rows.map((r) => r.familyId);
}

/**
 * Prüft die Rechte für eine Beziehung zwischen zwei Personen.
 *
 * Verlangt Bearbeitungsrecht an mindestens einer Seite und Sichtbarkeit der
 * anderen. Beidseitiges Bearbeitungsrecht zu fordern würde Ehen zwischen zwei
 * Familien unmöglich machen, sobald jemand nur eine davon pflegt; gar keine
 * Prüfung auf der Gegenseite würde erlauben, beliebige fremde Personen
 * anzuhängen.
 */
export async function canEditRelationship(
  scope: Scope,
  fromPersonId: string,
  toPersonId: string,
): Promise<boolean> {
  if (scope.isAdmin) return true;

  const families = await familyIdsOf([fromPersonId, toPersonId]);
  return canEditRelationshipBetween(
    scope,
    families.get(fromPersonId) ?? [],
    families.get(toPersonId) ?? [],
  );
}

/** Reine Regel hinter canEditRelationship — anhand der Familien beider Seiten. */
export function canEditRelationshipBetween(
  scope: Scope,
  fromFamilyIds: string[],
  toFamilyIds: string[],
): boolean {
  if (scope.isAdmin) return true;

  const editFrom = canEditPerson(scope, fromFamilyIds);
  const editTo = canEditPerson(scope, toFamilyIds);
  if (!editFrom && !editTo) return false;

  return canViewPerson(scope, fromFamilyIds) && canViewPerson(scope, toFamilyIds);
}

/**
 * Familien-IDs einer Person, soweit der Benutzer diese Familien selbst kennt.
 * Fremde Familien bleiben verborgen — schon ihre Existenz ist eine Auskunft
 * über andere (siehe GET /api/families).
 */
export function visibleFamilyIds(scope: Scope, familyIds: string[]): string[] {
  if (scope.isAdmin) return familyIds;
  return familyIds.filter((id) => scope.families.has(id));
}

/** Anonymisierte Darstellung einer Person, die der Benutzer nicht sehen darf. */
export type MaskedPerson = {
  id: string;
  givenName: string;
  familyName: null;
  gender: "UNKNOWN";
  birthDate: null;
  deathDate: null;
  primaryMediaId: null;
  restricted: true;
};

/**
 * Ersetzt sämtliche Angaben durch einen Platzhalter. Es bleibt allein die ID,
 * damit der Baum zusammenhängend bleibt — Name, Daten und Bild fallen weg.
 */
export function maskPerson(id: string): MaskedPerson {
  return {
    id,
    givenName: "Nicht freigegeben",
    familyName: null,
    gender: "UNKNOWN",
    birthDate: null,
    deathDate: null,
    primaryMediaId: null,
    restricted: true,
  };
}
