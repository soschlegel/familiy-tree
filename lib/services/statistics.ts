import type { AreaLevel } from "../places/area";
import { placeKey } from "../places/normalize";
import { prisma } from "../prisma";
import { canViewPerson, personVisibilityFilter, type Scope } from "../scope";
import { fuzzyField } from "../dates";
import { computeStatistics, type StatisticsResult, type StatPerson, type StatRelationship } from "../statistics";
import { listFamilies } from "./families";
import { placeAreasFor } from "./place-areas";

/**
 * Seite „Statistik“ (app/statistics/page.tsx): lädt den sichtbaren Teil des
 * Stammbaums schlank und rechnet mit lib/statistics.ts.
 *
 * Laden: eine Abfrage der Personen (nur die Felder der Auswertung, schon in
 * der Datenbank auf sichtbare und ggf. die gewählte Familie beschränkt),
 * eine der Beziehungen (nur Kennungen, Art und Beginn), eine der Taufen mit
 * Ort, eine der Ortszuordnungen — nie eine Abfrage je Person.
 *
 * Rechte: Gezählt wird nur, wer sichtbar ist (Scope; zusätzlich je Person
 * mit canViewPerson geprüft). Beziehungen zählen nur zwischen gezählten
 * Personen. Der Familienfilter nimmt nur Familien an, die der Benutzer
 * sehen darf (listFamilies); eine fremde oder unbekannte Kennung gilt als
 * „Alle“. Die Antwort enthält nur Summen, Namen und Gebiete.
 */

/** Ereignisse, deren Ort ersatzweise für den Geburtsort zählt (wie „Wurzeln“). */
const BAPTISM_TYPES = ["BAPTISM", "CHRISTENING"] as const;

export type StatisticsFamily = { id: string; name: string };

export type FamilyStatisticsDto = StatisticsResult & {
  /** Familien, die der Benutzer wählen kann (für den Filter). */
  families: StatisticsFamily[];
  /** Gewählte Familie; null = alle sichtbaren. */
  familyId: string | null;
};

export type StatisticsOptions = { familyId?: string | null; level?: string | null; now?: Date };

/**
 * Familienfilter der Auswertungsseiten (Statistik, Rekorde): wählbare
 * Familien, die wirksame Auswahl (fremde oder unbekannte Kennung = „Alle“)
 * und die Personenbedingung für Prisma (sichtbar und ggf. in der Familie).
 */
export async function familyFilter(scope: Scope, familyIdRaw: string | null | undefined) {
  const families: StatisticsFamily[] = (await listFamilies(scope)).map(({ id, name }) => ({ id, name }));
  const familyId = families.some((f) => f.id === familyIdRaw) ? familyIdRaw! : null;
  const visibility = personVisibilityFilter(scope);
  const where = familyId ? { AND: [visibility, { families: { some: { familyId } } }] } : visibility;
  return { families, familyId, where };
}

export async function getFamilyStatistics(scope: Scope, opts: StatisticsOptions = {}): Promise<FamilyStatisticsDto> {
  const level: AreaLevel = opts.level === "region" ? "region" : "country";
  const { families, familyId, where } = await familyFilter(scope, opts.familyId);

  const [rows, relRows] = await Promise.all([
    prisma.person.findMany({
      where,
      select: {
        id: true,
        givenName: true,
        familyName: true,
        birthName: true,
        gender: true,
        birthDate: true,
        birthDatePrecision: true,
        birthDateQualifier: true,
        birthDateTo: true,
        birthDateToPrecision: true,
        birthPlace: true,
        deathDate: true,
        deathDatePrecision: true,
        deathDateQualifier: true,
        deathDateTo: true,
        deathDateToPrecision: true,
        deathDatePhrase: true,
        deathPlace: true,
        families: { select: { familyId: true } },
      },
    }),
    // Alle Beziehungen, nur Kennungen und Beginn; gefiltert wird im Speicher
    // (eine `in`-Liste mit tausenden Kennungen wäre langsamer und begrenzt).
    prisma.relationship.findMany({
      select: {
        type: true,
        subtype: true,
        fromPersonId: true,
        toPersonId: true,
        startDate: true,
        startDatePrecision: true,
        startDateQualifier: true,
        startDateTo: true,
        startDateToPrecision: true,
      },
    }),
  ]);

  // Zweite Sicherung neben dem Datenbankfilter: nur sichtbare Personen.
  const visibleRows = rows.filter((r) => canViewPerson(scope, r.families.map((f) => f.familyId)));
  const ids = new Set(visibleRows.map((r) => r.id));

  // Ort: Geburtsort, sonst Ort der Taufe (erste nach Datum; keine Zweitangaben).
  const placeOf = new Map<string, string>();
  const withoutBirthPlace = new Set<string>();
  for (const r of visibleRows) {
    const text = r.birthPlace?.trim();
    if (text) placeOf.set(r.id, text);
    else withoutBirthPlace.add(r.id);
  }
  if (withoutBirthPlace.size) {
    const baptisms = await prisma.event.findMany({
      where: { type: { in: [...BAPTISM_TYPES] }, isAlternative: false, place: { not: null }, personId: { not: null } },
      orderBy: [{ date: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { personId: true, place: true },
    });
    for (const e of baptisms) {
      const text = e.place?.trim();
      if (e.personId && text && withoutBirthPlace.has(e.personId) && !placeOf.has(e.personId)) placeOf.set(e.personId, text);
    }
  }
  const areas = await placeAreasFor(placeOf.values(), level);

  const persons: StatPerson[] = visibleRows.map((r) => ({
    id: r.id,
    visible: true,
    givenName: r.givenName,
    familyName: r.familyName,
    birthName: r.birthName,
    gender: r.gender,
    birth: fuzzyField(r, "birthDate"),
    death: fuzzyField(r, "deathDate"),
    deathWithoutDate: !r.deathDate && Boolean(r.deathDatePhrase?.trim() || r.deathPlace?.trim()),
    place: placeOf.get(r.id) ?? null,
  }));
  const relationships: StatRelationship[] = [];
  for (const r of relRows) {
    if (!ids.has(r.fromPersonId) || !ids.has(r.toPersonId)) continue;
    relationships.push({
      type: r.type,
      subtype: r.subtype,
      from: r.fromPersonId,
      to: r.toPersonId,
      start: r.type === "PARTNER_OF" ? fuzzyField(r, "startDate") : null,
    });
  }

  const result = computeStatistics({
    persons,
    relationships,
    now: opts.now ?? new Date(),
    level,
    areaOf: (text) => areas.get(placeKey(text)),
  });
  return { ...result, families, familyId };
}
