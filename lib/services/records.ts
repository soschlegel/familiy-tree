import { prisma } from "../prisma";
import { canViewPerson, type Scope } from "../scope";
import { fuzzyField } from "../dates";
import { computeRecords, type RecordPerson, type RecordRelationship, type RecordsResult } from "../records";
import { lifeSpan } from "../tree-layout";
import { toPersonBrief } from "./dto";
import { familyFilter, type StatisticsFamily } from "./statistics";

/**
 * Seite „Rekorde“ (app/records/page.tsx): lädt den sichtbaren Teil des
 * Stammbaums schlank und rechnet mit lib/records.ts.
 *
 * Laden: eine Abfrage der Personen (nur die Felder der Auswertung, schon in
 * der Datenbank auf sichtbare und ggf. die gewählte Familie beschränkt),
 * eine der Beziehungen (nur Kennungen, Art, Beginn und Ende) — nie eine
 * Abfrage je Person.
 *
 * Rechte: Gezählt und genannt wird nur, wer sichtbar ist (Scope; zusätzlich
 * je Person mit canViewPerson geprüft). Beziehungen zählen nur zwischen
 * gezählten Personen — Kinder, Nachkommen, Partner und Ehen nicht sichtbarer
 * Personen fließen nirgends ein. Familienfilter wie die Statistik
 * (familyFilter): fremde oder unbekannte Kennung = „Alle“.
 */

export type FamilyRecordsDto = RecordsResult & {
  /** Familien, die der Benutzer wählen kann (für den Filter). */
  families: StatisticsFamily[];
  /** Gewählte Familie; null = alle sichtbaren. */
  familyId: string | null;
};

export type RecordsOptions = { familyId?: string | null; now?: Date };

export async function getFamilyRecords(scope: Scope, opts: RecordsOptions = {}): Promise<FamilyRecordsDto> {
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
    // Alle Beziehungen, nur Kennungen und Daten; gefiltert wird im Speicher
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
        endDate: true,
        endDatePrecision: true,
        endDateQualifier: true,
        endDateTo: true,
        endDateToPrecision: true,
      },
    }),
  ]);

  // Zweite Sicherung neben dem Datenbankfilter: nur sichtbare Personen.
  const visibleRows = rows.filter((r) => canViewPerson(scope, r.families.map((f) => f.familyId)));
  const ids = new Set(visibleRows.map((r) => r.id));

  const persons: RecordPerson[] = visibleRows.map((r) => ({
    id: r.id,
    visible: true,
    name: [r.givenName, r.familyName].filter(Boolean).join(" "),
    lifespan: lifeSpan(toPersonBrief(r)),
    givenName: r.givenName,
    gender: r.gender,
    birth: fuzzyField(r, "birthDate"),
    death: fuzzyField(r, "deathDate"),
    deathWithoutDate: !r.deathDate && Boolean(r.deathDatePhrase?.trim() || r.deathPlace?.trim()),
  }));
  const relationships: RecordRelationship[] = [];
  for (const r of relRows) {
    if (!ids.has(r.fromPersonId) || !ids.has(r.toPersonId)) continue;
    const partner = r.type === "PARTNER_OF";
    relationships.push({
      type: r.type,
      subtype: r.subtype,
      from: r.fromPersonId,
      to: r.toPersonId,
      start: partner ? fuzzyField(r, "startDate") : null,
      end: partner ? fuzzyField(r, "endDate") : null,
    });
  }

  const result = computeRecords({ persons, relationships, now: opts.now ?? new Date() });
  return { ...result, families, familyId };
}
