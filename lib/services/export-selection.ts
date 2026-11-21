import { prisma } from "../prisma";
import { viewableFamilyIds, type Scope } from "../scope";
import type { ExportFamilyOverview, ExportSelection } from "../export-selection";
import { forbiddenError, validationError } from "./errors";

/**
 * Familienauswahl für den GEDCOM-Export: Prüfen der Anfrage, Personenfilter
 * und Übersicht für den Dialog. Regeln: lib/export-selection.ts.
 */

/**
 * Auswahl aus den Suchparametern: `families=<id>,<id>` und `withoutFamily=1`.
 * Ohne beide Parameter: keine Auswahl (null) — der Export enthält wie bisher
 * alles Sichtbare. Fremde und unbekannte Familien lehnen wir für
 * Nicht-Administratoren einheitlich ab (403), ohne zu unterscheiden — sonst
 * ließe sich die Existenz fremder Familien abfragen. Administratoren erhalten
 * für unbekannte Kennungen einen Validierungsfehler.
 */
export async function parseExportSelection(scope: Scope, params: URLSearchParams): Promise<ExportSelection | null> {
  const rawFamilies = params.getAll("families");
  const rawWithout = params.get("withoutFamily");
  if (rawFamilies.length === 0 && rawWithout === null) return null;

  const familyIds = [...new Set(rawFamilies.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean))];
  const withoutFamily = rawWithout === "1" || rawWithout === "true";
  if (familyIds.length > 1000) throw validationError([{ path: "families", message: "Zu viele Familien angegeben" }]);

  if (withoutFamily && !scope.isAdmin) throw forbiddenError("Personen ohne Familie");
  if (scope.isAdmin) {
    const known = new Set((await prisma.family.findMany({ where: { id: { in: familyIds } }, select: { id: true } })).map((f) => f.id));
    if (familyIds.some((id) => !known.has(id))) throw validationError([{ path: "families", message: "Unbekannte Familie" }]);
  } else if (familyIds.some((id) => !scope.families.has(id))) {
    throw forbiddenError("diese Familie");
  }
  if (familyIds.length === 0 && !withoutFamily) {
    throw validationError([{ path: "families", message: "Mindestens eine Familie auswählen" }]);
  }
  return { familyIds, withoutFamily };
}

/** Prisma-Filter auf die Personen der Auswahl (zusätzlich zur Sichtbarkeit). */
export function selectionPersonFilter(selection: ExportSelection) {
  const or: object[] = [];
  if (selection.familyIds.length) or.push({ families: { some: { familyId: { in: selection.familyIds } } } });
  if (selection.withoutFamily) or.push({ families: { none: {} } });
  return { OR: or };
}

/** Familien des Benutzers mit Personenzahlen für den Exportdialog. */
export async function exportFamilyOverview(scope: Scope): Promise<ExportFamilyOverview> {
  const visibleIds = scope.isAdmin ? null : viewableFamilyIds(scope);
  const [families, memberships, withoutFamily] = await Promise.all([
    prisma.family.findMany({
      where: visibleIds ? { id: { in: visibleIds } } : undefined,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.personFamily.findMany({
      where: visibleIds ? { familyId: { in: visibleIds } } : undefined,
      select: { personId: true, familyId: true },
    }),
    scope.isAdmin ? prisma.person.count({ where: { families: { none: {} } } }) : Promise.resolve(null),
  ]);
  const ofPerson = new Map<string, string[]>();
  for (const m of memberships) {
    const list = ofPerson.get(m.personId);
    if (list) list.push(m.familyId);
    else ofPerson.set(m.personId, [m.familyId]);
  }
  const counts = new Map<string, number>();
  for (const ids of ofPerson.values()) {
    const key = ids.sort().join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    families,
    groups: [...counts].map(([key, persons]) => ({ familyIds: key.split(","), persons })),
    withoutFamily,
  };
}
