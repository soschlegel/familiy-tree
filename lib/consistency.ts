/**
 * Plausibilitätsprüfung über Lebens- und Beziehungsdaten — reine Funktion
 * ohne Datenbank. Ergänzt findDataGaps (fehlende Angaben) um Widersprüche
 * zwischen vorhandenen Angaben.
 *
 * Geprüft wird nur, was die Daten tatsächlich hergeben: fehlt ein Datum,
 * gibt es keine Meldung. Ungenaue Daten (nur Jahr, „um“, „vor“, „nach“, siehe
 * lib/dates.ts) zählen mit ihrem ganzen Zeitraum — gemeldet wird nur, was für
 * jede mögliche Lesart widersprüchlich ist. Ein Jahr allein ist also kein
 * Grund für eine Meldung, nur weil es intern als 1. Januar gespeichert ist.
 * Bereiche („zwischen 1850 und 1855“) zählen mit ihrem ganzen Zeitraum.
 *
 * Lebensereignisse (Event) einer Person werden gegen Geburt und Tod geprüft;
 * abweichende Zweitangaben (isAlternative) bleiben außen vor.
 */
import { EVENT_TYPE_LABEL, POSTHUMOUS_EVENT_TYPES, eventTitle, type EventTypeName } from "./events";
import {
  dateBounds,
  formatFuzzyDate,
  isPreciseDate,
  toFuzzyDate,
  yearsBetween,
  type DatePrecision,
  type DateQualifier,
  type FuzzyDate,
} from "./dates";

export const MIN_PARENT_AGE = 12;
export const MAX_FATHER_AGE = 70;
export const MAX_MOTHER_AGE = 50;
export const MAX_LIFESPAN = 110;
export const MIN_PARTNERSHIP_AGE = 14;
/** Ein Kind kann bis etwa zehn Monate nach dem Tod des Vaters geboren werden. */
const POSTHUMOUS_BIRTH_DAYS = 300;

const DAY = 24 * 60 * 60 * 1000;

export type ConsistencyKind =
  | "deathBeforeBirth"
  | "parentTooYoung"
  | "parentTooOld"
  | "bornAfterParentDeath"
  | "lifespanOver110"
  | "partnershipTooYoung"
  | "partnershipAfterDeath"
  | "overlappingMarriages"
  | "burialBeforeDeath"
  | "eventBeforeBirth"
  | "eventAfterDeath";

export const CONSISTENCY_KINDS: ConsistencyKind[] = [
  "deathBeforeBirth",
  "parentTooYoung",
  "parentTooOld",
  "bornAfterParentDeath",
  "lifespanOver110",
  "partnershipTooYoung",
  "partnershipAfterDeath",
  "overlappingMarriages",
  "burialBeforeDeath",
  "eventBeforeBirth",
  "eventAfterDeath",
];

export type ConsistencySeverity = "error" | "warning";

export type ConsistencyPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birthDate: Date | null;
  deathDate: Date | null;
  /** Fehlend = tagesgenau. */
  birthDatePrecision?: DatePrecision;
  birthDateQualifier?: DateQualifier;
  deathDatePrecision?: DatePrecision;
  deathDateQualifier?: DateQualifier;
  birthDateTo?: Date | null;
  birthDateToPrecision?: DatePrecision;
  deathDateTo?: Date | null;
  deathDateToPrecision?: DatePrecision;
  /** Lebensereignisse der Person (ohne Angabe: keine Prüfung). */
  events?: ConsistencyEvent[];
};

export type ConsistencyEvent = {
  id: string;
  type: EventTypeName;
  label?: string | null;
  isAlternative: boolean;
  date: Date | null;
  datePrecision?: DatePrecision;
  dateQualifier?: DateQualifier;
  dateTo?: Date | null;
  dateToPrecision?: DatePrecision;
};

export type ConsistencyEdge = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  from: string;
  to: string;
  startDate: Date | null;
  endDate: Date | null;
  startDatePrecision?: DatePrecision;
  startDateQualifier?: DateQualifier;
  endDatePrecision?: DatePrecision;
  endDateQualifier?: DateQualifier;
  startDateTo?: Date | null;
  startDateToPrecision?: DatePrecision;
  endDateTo?: Date | null;
  endDateToPrecision?: DatePrecision;
};

export type ConsistencyIssue = {
  kind: ConsistencyKind;
  severity: ConsistencySeverity;
  /** Betroffene Personen; die erste ist die, bei der die Meldung "hängt". */
  personIds: string[];
  relationshipIds: string[];
  /** Betroffene Ereignisse (Event.id), sonst leer. */
  eventIds?: string[];
  message: string;
};

const name = (p: ConsistencyPerson) => [p.givenName, p.familyName].filter(Boolean).join(" ");
const day = (f: FuzzyDate) => formatFuzzyDate(f);
const fmtAge = (y: number) => `${Math.floor(y)}`;

/** Alter bzw. Spanne als Text: exakt „11“, sonst „höchstens 11“ / „mindestens 52“. */
function ageText(range: { min: number; max: number; exact: boolean }, bound: "min" | "max"): string {
  if (range.exact) return fmtAge(range.min);
  return bound === "max" ? `höchstens ${fmtAge(Math.max(0, range.max))}` : `mindestens ${fmtAge(range.min)}`;
}

type Dated = { birth: FuzzyDate | null; death: FuzzyDate | null };

/**
 * Prüft die übergebenen Personen und Beziehungen. Der Aufrufer reicht nur
 * sichtbare Personen und Beziehungen zwischen sichtbaren Personen herein.
 */
export function findConsistencyIssues(
  persons: ConsistencyPerson[],
  edges: ConsistencyEdge[],
  now: Date = new Date(),
): ConsistencyIssue[] {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const dated = new Map<string, Dated>(
    persons.map((p) => [
      p.id,
      {
        birth: toFuzzyDate(p.birthDate, p.birthDatePrecision, p.birthDateQualifier, p.birthDateTo, p.birthDateToPrecision),
        death: toFuzzyDate(p.deathDate, p.deathDatePrecision, p.deathDateQualifier, p.deathDateTo, p.deathDateToPrecision),
      },
    ]),
  );
  const issues: ConsistencyIssue[] = [];

  for (const p of persons) {
    const { birth, death } = dated.get(p.id)!;
    if (birth && death && dateBounds(death).end <= dateBounds(birth).start) {
      issues.push({
        kind: "deathBeforeBirth",
        severity: "error",
        personIds: [p.id],
        relationshipIds: [],
        message: `${name(p)}: Sterbedatum ${day(death)} liegt vor dem Geburtsdatum ${day(birth)}`,
      });
    }
    if (birth) {
      const age = death ? yearsBetween(birth, death) : yearsBetween(birth, now);
      if (age.min > MAX_LIFESPAN) {
        issues.push({
          kind: "lifespanOver110",
          severity: death ? "error" : "warning",
          personIds: [p.id],
          relationshipIds: [],
          message: death
            ? `${name(p)}: Lebensdauer von ${ageText(age, "min")} Jahren`
            : `${name(p)}: ohne Sterbedatum heute ${ageText(age, "min")} Jahre alt — vermutlich fehlt das Sterbedatum`,
        });
      }
    }

    // Lebensereignisse gegen Geburt und Tod.
    for (const ev of p.events ?? []) {
      if (ev.isAlternative) continue;
      const when = toFuzzyDate(ev.date, ev.datePrecision, ev.dateQualifier, ev.dateTo, ev.dateToPrecision);
      if (!when) continue;
      const title = eventTitle(ev);
      const base = { personIds: [p.id], relationshipIds: [], eventIds: [ev.id] };
      if (ev.type === "BURIAL" || ev.type === "CREMATION") {
        if (death && dateBounds(when).end <= dateBounds(death).start) {
          issues.push({
            ...base,
            kind: "burialBeforeDeath",
            severity: "error",
            message: `${name(p)}: ${EVENT_TYPE_LABEL[ev.type]} ${day(when)} liegt vor dem Tod ${day(death)}`,
          });
          continue;
        }
      }
      if (birth && dateBounds(when).end <= dateBounds(birth).start) {
        issues.push({
          ...base,
          kind: "eventBeforeBirth",
          severity: "error",
          message: `${name(p)}: ${title} ${day(when)} liegt vor der Geburt ${day(birth)}`,
        });
      }
      if (death && !POSTHUMOUS_EVENT_TYPES.includes(ev.type) && dateBounds(when).start >= dateBounds(death).end) {
        issues.push({
          ...base,
          kind: "eventAfterDeath",
          severity: "warning",
          message: `${name(p)}: ${title} ${day(when)} liegt nach dem Tod ${day(death)}`,
        });
      }
    }
  }

  // Ehen je Person für die Überschneidungsprüfung.
  const marriages = new Map<string, ConsistencyEdge[]>();

  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;

    if (e.type === "PARENT_OF") {
      // Nur leibliche Elternschaft hat eine biologische Altersgrenze.
      const childBirth = dated.get(to.id)!.birth;
      if (e.subtype !== "BIOLOGICAL" || !childBirth) continue;
      const parent = from;
      const child = to;
      const parentDates = dated.get(parent.id)!;

      if (parentDates.birth) {
        const age = yearsBetween(parentDates.birth, childBirth);
        if (age.max < MIN_PARENT_AGE) {
          issues.push({
            kind: "parentTooYoung",
            severity: age.max < 0 ? "error" : "warning",
            personIds: [child.id, parent.id],
            relationshipIds: [e.id],
            message:
              age.max < 0
                ? `${name(child)} ist vor dem eigenen Elternteil ${name(parent)} geboren`
                : `${name(parent)} war bei der Geburt von ${name(child)} erst ${ageText(age, "max")} Jahre alt`,
          });
        }
        const max = parent.gender === "FEMALE" ? MAX_MOTHER_AGE : MAX_FATHER_AGE;
        if (age.min > max) {
          issues.push({
            kind: "parentTooOld",
            severity: "warning",
            personIds: [child.id, parent.id],
            relationshipIds: [e.id],
            message: `${name(parent)} war bei der Geburt von ${name(child)} bereits ${ageText(age, "min")} Jahre alt`,
          });
        }
      }

      if (parentDates.death) {
        // Mütter: Geburt nach dem Tod ist unmöglich. Väter: bis ~10 Monate.
        // Ohne Geschlechtsangabe gilt die großzügigere Grenze.
        const tolerance = parent.gender === "FEMALE" ? 0 : POSTHUMOUS_BIRTH_DAYS * DAY;
        if (dateBounds(childBirth).start >= dateBounds(parentDates.death).end + tolerance) {
          issues.push({
            kind: "bornAfterParentDeath",
            severity: "error",
            personIds: [child.id, parent.id],
            relationshipIds: [e.id],
            message: `${name(child)} (geb. ${day(childBirth)}) ist nach dem Tod von ${name(parent)} (gest. ${day(parentDates.death)}) geboren`,
          });
        }
      }
      continue;
    }

    // PARTNER_OF
    const start = toFuzzyDate(e.startDate, e.startDatePrecision, e.startDateQualifier, e.startDateTo, e.startDateToPrecision);
    if (start) {
      for (const p of [from, to]) {
        const other = p === from ? to : from;
        const { birth, death } = dated.get(p.id)!;
        if (birth) {
          const age = yearsBetween(birth, start);
          if (age.max < MIN_PARTNERSHIP_AGE) {
            issues.push({
              kind: "partnershipTooYoung",
              severity: age.max < 0 ? "error" : "warning",
              personIds: [p.id, other.id],
              relationshipIds: [e.id],
              message: `${name(p)} war zu Beginn der Partnerschaft mit ${name(other)} (${day(start)}) erst ${ageText(age, "max")} Jahre alt`,
            });
          }
        }
        if (death && dateBounds(start).start >= dateBounds(death).end) {
          issues.push({
            kind: "partnershipAfterDeath",
            severity: "error",
            personIds: [p.id, other.id],
            relationshipIds: [e.id],
            message: `Partnerschaft von ${name(from)} und ${name(to)} beginnt ${day(start)}, nach dem Tod von ${name(p)} (${day(death)})`,
          });
        }
      }
    }

    // Nur Ehen: unverheiratete Partnerschaften und solche mit unbekanntem
    // Ehestand (PARTNER_UNKNOWN) zählen nicht als Ehe — eine Überschneidung
    // wäre bei ihnen kein Widerspruch. Altersgrenze und „nach dem Tod“ gelten
    // für jede Partnerschaft (oben).
    if (e.subtype === "MARRIED" || e.subtype === "DIVORCED") {
      for (const id of [e.from, e.to]) {
        const list = marriages.get(id) ?? [];
        list.push(e);
        marriages.set(id, list);
      }
    }
  }

  // Überschneidende Ehen: beide mit Beginn; Ende = Scheidung bzw. Tod eines
  // Partners. Eine Scheidung ohne Datum hat ein unbekanntes Ende und wird
  // nicht gemeldet. Bei ungenauen Daten zählt der späteste mögliche Beginn
  // der zweiten Ehe gegen das früheste mögliche Ende der ersten.
  const reported = new Set<string>();
  for (const [personId, list] of marriages) {
    const intervals = list
      .map((e) => ({ e, start: toFuzzyDate(e.startDate, e.startDatePrecision, e.startDateQualifier, e.startDateTo, e.startDateToPrecision) }))
      .filter((x): x is { e: ConsistencyEdge; start: FuzzyDate } => x.start !== null)
      .map(({ e, start }) => {
        const deaths = [dated.get(e.from)!.death, dated.get(e.to)!.death].filter(
          (d): d is FuzzyDate => d !== null,
        );
        const endDate = toFuzzyDate(e.endDate, e.endDatePrecision, e.endDateQualifier, e.endDateTo, e.endDateToPrecision);
        let end: number | null;
        if (endDate) end = dateBounds(endDate).start;
        else if (e.subtype === "DIVORCED") end = null;
        else end = deaths.length ? Math.min(...deaths.map((d) => dateBounds(d).start)) : Infinity;
        return { e, start, startLatest: dateBounds(start).end, anchor: start.date.getTime(), end };
      })
      .sort((x, y) => x.anchor - y.anchor);

    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const first = intervals[i];
        const second = intervals[j];
        if (first.end === null) continue;
        // Exakte Daten: zweite Ehe beginnt vor dem Ende der ersten.
        const overlaps =
          isPreciseDate(second.start) ? second.anchor < first.end : second.startLatest <= first.end;
        if (!overlaps) continue;
        const key = [first.e.id, second.e.id].sort().join("|");
        if (reported.has(key)) continue;
        reported.add(key);
        const p = byId.get(personId)!;
        const other = (e: ConsistencyEdge) => byId.get(e.from === personId ? e.to : e.from)!;
        issues.push({
          kind: "overlappingMarriages",
          severity: "warning",
          personIds: [personId, other(first.e).id, other(second.e).id],
          relationshipIds: [first.e.id, second.e.id],
          message: `${name(p)}: Ehe mit ${name(other(second.e))} (ab ${day(second.start)}) beginnt vor dem Ende der Ehe mit ${name(other(first.e))} (ab ${day(first.start)})`,
        });
      }
    }
  }

  const severityRank = { error: 0, warning: 1 };
  return issues.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      CONSISTENCY_KINDS.indexOf(a.kind) - CONSISTENCY_KINDS.indexOf(b.kind) ||
      a.message.localeCompare(b.message),
  );
}
