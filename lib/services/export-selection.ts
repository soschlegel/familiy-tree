import { prisma } from "../prisma";
import { personVisibilityFilter, viewableFamilyIds, type Scope } from "../scope";
import {
  isPersonSelection,
  parseLineageOptions,
  type AnyExportSelection,
  type ExportFamilyOverview,
  type ExportPersonCard,
  type ExportSelection,
} from "../export-selection";
import { collectLineage, type LineageCounts, type LineageOptions } from "../export-lineage";
import { lifeSpan } from "../tree-layout";
import { forbiddenError, notFoundError, validationError } from "./errors";
import { resolvePersonRedirect } from "./redirects";

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

/**
 * Auswahl einer Export-Anfrage, beide Arten: `person=<id>` (mit den
 * Schaltern aus lib/export-selection.ts, `parseLineageOptions`) für „Ab einer
 * Person“, sonst die Familienauswahl wie oben. Beides zugleich ist ein
 * Eingabefehler. Die Personenmenge berechnet der Server (`loadLineage`) —
 * Kennungen weiterer Personen nimmt die Anfrage nicht an.
 */
export async function parseExportRequest(scope: Scope, params: URLSearchParams): Promise<AnyExportSelection | null> {
  if (!params.has("person")) return parseExportSelection(scope, params);
  if (params.has("families") || params.has("withoutFamily")) {
    throw validationError([{ path: "person", message: "Entweder Familien oder eine Person auswählen, nicht beides" }]);
  }
  const options = parseLineageOptions(params);
  if (options === "invalid") throw validationError([{ path: "generations", message: "Generationen: eine ganze Zahl ab 1" }]);
  const personId = await visibleStartPerson(scope, params.get("person") ?? "");
  const { ids, counts } = await loadLineage(scope, personId, options);
  return { kind: "person", personId, options, personIds: [...ids], counts };
}

/**
 * Kennung der gewählten Person — nur, wenn der Benutzer sie sehen darf;
 * alte Kennungen zusammengeführter Personen werden aufgelöst. Unbekannt und
 * gesperrt melden wir gleich (404), damit sich nichts erraten lässt.
 */
async function visibleStartPerson(scope: Scope, raw: string): Promise<string> {
  const id = raw.trim();
  if (!id || id.length > 200) throw validationError([{ path: "person", message: "Person auswählen" }]);
  const found = await prisma.person.findFirst({ where: { AND: [{ id }, personVisibilityFilter(scope)] }, select: { id: true } });
  if (found) return found.id;
  const redirected = await resolvePersonRedirect(scope, id);
  if (redirected) return redirected;
  throw notFoundError("Person");
}

/**
 * Personen der Auswahl „Ab einer Person“ samt Zahlen je Gruppe — gerechnet
 * nur über sichtbare Personen und Beziehungen zwischen ihnen
 * (lib/export-lineage.ts). Eine schlanke Abfrage: Kennungen und Kanten.
 */
export async function loadLineage(scope: Scope, personId: string, options: LineageOptions) {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({ where: personVisibilityFilter(scope), select: { id: true } }),
    prisma.relationship.findMany({ select: { type: true, subtype: true, fromPersonId: true, toPersonId: true } }),
  ]);
  const visible = new Set(persons.map((p) => p.id));
  return collectLineage(
    visible,
    relationships.map((r) => ({ type: r.type, subtype: r.subtype, from: r.fromPersonId, to: r.toPersonId })),
    personId,
    options,
  );
}

/** Zahlen für den Dialog (GET /api/export/count) — keine Personenkennungen. */
export async function exportLineageCount(scope: Scope, params: URLSearchParams): Promise<LineageCounts> {
  const sel = await parseExportRequest(scope, params);
  if (!isPersonSelection(sel)) throw validationError([{ path: "person", message: "Person auswählen" }]);
  return sel.counts;
}

/**
 * Vorbelegung des Dialogs: Name und Lebensdaten einer sichtbaren Person
 * (eigene Person „Das bin ich“ bzw. Einstieg von der Personenseite) — sonst null.
 */
export async function exportStartPersonCard(scope: Scope, id: string | null | undefined): Promise<ExportPersonCard | null> {
  if (!id) return null;
  const p = await prisma.person.findFirst({
    where: { AND: [{ id }, personVisibilityFilter(scope)] },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      birthDate: true,
      birthDatePrecision: true,
      birthDateQualifier: true,
      birthDateTo: true,
      birthDateToPrecision: true,
      deathDate: true,
      deathDatePrecision: true,
      deathDateQualifier: true,
      deathDateTo: true,
      deathDateToPrecision: true,
    },
  });
  if (!p) return null;
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const lifespan = lifeSpan({
    ...p,
    birthDate: iso(p.birthDate),
    birthDateTo: iso(p.birthDateTo),
    deathDate: iso(p.deathDate),
    deathDateTo: iso(p.deathDateTo),
  });
  return { id: p.id, name: [p.givenName, p.familyName].filter(Boolean).join(" "), lifespan };
}

/** Prisma-Filter auf die Personen der Auswahl (zusätzlich zur Sichtbarkeit). */
export function selectionPersonFilter(selection: AnyExportSelection) {
  if (isPersonSelection(selection)) return { id: { in: selection.personIds } };
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
