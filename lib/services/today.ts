import { prisma } from "../prisma";
import { canViewPerson, personVisibilityFilter, type Scope } from "../scope";
import { fuzzyField } from "../dates";
import { eventTitle, type EventTypeName } from "../events";
import {
  ANNIVERSARY_EVENT_TYPES,
  ANNIVERSARY_PARTNER_SUBTYPES,
  calendarDayIn,
  computeToday,
  type CalendarDay,
  type TodayEvent,
  type TodayPartnership,
  type TodayPerson,
  type TodayResult,
} from "../today";

/**
 * Startseite „Heute in der Familie“ (app/page.tsx): lädt die Kandidaten für
 * Jahrestage schlank und rechnet mit lib/today.ts.
 *
 * Laden — drei Abfragen, nie eine je Person, schon in der Datenbank auf
 * sichtbare Personen und tagesgenaue, sichere Daten eingegrenzt:
 * - Personen mit tagesgenauem Geburts- oder Sterbedatum (nur Name, Daten,
 *   Sterbeangabe, Familien);
 * - Partnerschaften mit tagesgenauem Beginn samt Name und Familien beider
 *   Partner (ein Partner ohne genaues eigenes Datum fehlt sonst);
 * - Lebensereignisse der gezählten Arten mit tagesgenauem Datum, keine
 *   Zweitangaben, samt Name und Familien der Person.
 *
 * Rechte: Jede Person wird zusätzlich mit canViewPerson geprüft; eine
 * Partnerschaft zählt nur, wenn beide Partner sichtbar sind. Nicht sichtbare
 * Personen erscheinen nirgends, auch nicht als Zahl.
 */

const PRECISE = { precision: "DAY", qualifier: "EXACT" } as const;

const PERSON_BRIEF = {
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
  deathDatePhrase: true,
  deathPlace: true,
  families: { select: { familyId: true } },
} as const;

type PersonRow = {
  id: string;
  givenName: string;
  familyName: string | null;
  deathDate: Date | null;
  deathDatePhrase: string | null;
  deathPlace: string | null;
  families: { familyId: string }[];
};

export type TodayOptions = {
  /** Gewählter Tag (Adresse `?datum=`); ohne: heute nach Europe/Berlin. */
  day?: CalendarDay | null;
  /** Jetzt — für Tests. */
  now?: Date;
};

export async function getToday(scope: Scope, opts: TodayOptions = {}): Promise<TodayResult> {
  const realToday = calendarDayIn(opts.now ?? new Date());
  const day = opts.day ?? realToday;
  const visibility = personVisibilityFilter(scope);

  const [personRows, relRows, eventRows] = await Promise.all([
    prisma.person.findMany({
      where: {
        AND: [
          visibility,
          {
            OR: [
              { birthDate: { not: null }, birthDatePrecision: PRECISE.precision, birthDateQualifier: PRECISE.qualifier },
              { deathDate: { not: null }, deathDatePrecision: PRECISE.precision, deathDateQualifier: PRECISE.qualifier },
            ],
          },
        ],
      },
      select: PERSON_BRIEF,
    }),
    prisma.relationship.findMany({
      where: {
        type: "PARTNER_OF",
        subtype: { in: [...ANNIVERSARY_PARTNER_SUBTYPES] },
        startDate: { not: null },
        startDatePrecision: PRECISE.precision,
        startDateQualifier: PRECISE.qualifier,
        fromPerson: visibility,
        toPerson: visibility,
      },
      select: {
        id: true,
        subtype: true,
        startDate: true,
        startDatePrecision: true,
        startDateQualifier: true,
        startDateTo: true,
        startDateToPrecision: true,
        fromPerson: { select: PERSON_BRIEF },
        toPerson: { select: PERSON_BRIEF },
      },
    }),
    prisma.event.findMany({
      where: {
        personId: { not: null },
        isAlternative: false,
        type: { in: [...ANNIVERSARY_EVENT_TYPES] },
        date: { not: null },
        datePrecision: PRECISE.precision,
        dateQualifier: PRECISE.qualifier,
        person: visibility,
      },
      select: {
        id: true,
        type: true,
        label: true,
        isAlternative: true,
        date: true,
        datePrecision: true,
        dateQualifier: true,
        dateTo: true,
        dateToPrecision: true,
        person: { select: PERSON_BRIEF },
      },
    }),
  ]);

  // Alle vorkommenden Personen einmal, je mit zweiter Rechteprüfung.
  const persons = new Map<string, TodayPerson>();
  const add = (r: PersonRow | null) => {
    if (!r || persons.has(r.id)) return;
    persons.set(r.id, {
      id: r.id,
      name: [r.givenName, r.familyName].filter(Boolean).join(" "),
      visible: canViewPerson(scope, r.families.map((f) => f.familyId)),
      birth: fuzzyField(r, "birthDate"),
      death: fuzzyField(r, "deathDate"),
      deathWithoutDate: !r.deathDate && Boolean(r.deathDatePhrase?.trim() || r.deathPlace?.trim()),
    });
  };
  for (const r of personRows) add(r);
  for (const r of relRows) {
    add(r.fromPerson);
    add(r.toPerson);
  }
  for (const e of eventRows) add(e.person);

  const partnerships: TodayPartnership[] = relRows.map((r) => ({
    id: r.id,
    subtype: r.subtype,
    partners: [r.fromPerson.id, r.toPerson.id],
    start: fuzzyField(r, "startDate"),
  }));
  const events: TodayEvent[] = eventRows
    .filter((e) => e.person)
    .map((e) => ({
      id: e.id,
      personId: e.person!.id,
      type: e.type,
      title: eventTitle({ type: e.type as EventTypeName, label: e.label }),
      isAlternative: e.isAlternative,
      date: fuzzyField(e, "date"),
    }));

  return computeToday({ day, realToday, persons: [...persons.values()], partnerships, events });
}
