/**
 * Startseite „Heute in der Familie“ gegen die Mock-Datenbank
 * (lib/services/today.ts): Das Laden liefert dasselbe wie die reine Rechnung
 * über den Mock-Datensatz — je Rolle nur über die sichtbaren Familien; ohne
 * Familie nichts. Fester Tag, unabhängig vom echten Datum. Nur lesend;
 * überspringt sich ohne Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { FuzzyDate } from "@/lib/dates";
import { eventTitle, type EventTypeName } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { getToday } from "@/lib/services/today";
import { computeToday, type CalendarDay, type TodayResult } from "@/lib/today";
import type { FamilyKey, MockData } from "@/prisma/mock-data";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Startseiten-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const NOW = new Date("2026-11-27T10:00:00Z");
const REAL_TODAY: CalendarDay = { year: 2026, month: 11, day: 27 };

const fuzzy = (date: Date | null, precision: string, qualifier: string): FuzzyDate | null =>
  date ? ({ date, precision, qualifier } as FuzzyDate) : null;

/** Reine Rechnung über den Mock-Datensatz, beschränkt auf Familien (null = Admin, alle). */
function expected(d: MockData, keys: FamilyKey[] | null, day: CalendarDay): TodayResult {
  const visible = (familyKeys: FamilyKey[]) => keys === null || familyKeys.some((k) => keys.includes(k));
  return computeToday({
    day,
    realToday: REAL_TODAY,
    persons: d.persons.map((p) => ({
      id: p.id,
      name: [p.givenName, p.familyName].filter(Boolean).join(" "),
      visible: visible(p.familyKeys),
      birth: fuzzy(p.birthDate, p.birthDatePrecision, p.birthDateQualifier),
      death: fuzzy(p.deathDate, p.deathDatePrecision, p.deathDateQualifier),
      deathWithoutDate: !p.deathDate && Boolean(p.deathPlace?.trim()),
    })),
    partnerships: d.relationships
      .filter((r) => r.type === "PARTNER_OF")
      .map((r) => ({
        id: r.id,
        subtype: r.subtype,
        partners: [r.fromPersonId, r.toPersonId] as [string, string],
        start: fuzzy(r.startDate, r.startDatePrecision, r.startDateQualifier),
      })),
    events: d.events
      .filter((e) => e.personId && !e.dateTo)
      .map((e) => ({
        id: e.id,
        personId: e.personId!,
        type: e.type,
        title: eventTitle({ type: e.type as EventTypeName, label: e.label }),
        isAlternative: e.isAlternative,
        date: fuzzy(e.date, e.datePrecision, e.dateQualifier),
      })),
  });
}

/** Vergleichbare Form: Schlüssel, Jahre, Tage — ohne Reihenfolge-Zufall. */
const shape = (r: TodayResult) => ({
  today: r.today.map((a) => `${a.key}:${a.years}`),
  birthdays: r.birthdays.map((a) => `${a.key}:${a.years}:${a.daysAway}`),
  upcoming: r.upcoming.map((a) => `${a.key}:${a.years}:${a.daysAway}`),
  next: r.next ? `${r.next.key}:${r.next.daysAway}` : null,
});

/** Der Tag des Jahres 2026 mit den meisten Jahrestagen für den Admin. */
function busiestDay(): CalendarDay {
  let best: CalendarDay = REAL_TODAY;
  let max = -1;
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      const day = { year: 2026, month: m, day: d };
      const n = expected(data, null, day).today.length;
      if (n > max) [best, max] = [day, n];
    }
  }
  return best;
}

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Startseite „Heute“ (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const day = busiestDay();

  it("Admin: dieselben Jahrestage wie die Rechnung über den Datensatz", async () => {
    const admin = await scope("admin@example.test");
    const got = await getToday(admin, { day, now: NOW });
    expect(got.today.length).toBeGreaterThan(0);
    expect(shape(got)).toEqual(shape(expected(data, null, day)));
    expect(got.isRealToday).toBe(false);
  });

  it("Betrachter und Bearbeiter: nur sichtbare Familien, nichts darüber hinaus", async () => {
    for (const [email, keys] of [
      ["viewer@example.test", ["A"]],
      ["editor@example.test", ["A", "B"]],
    ] as const) {
      const s = await scope(email);
      const got = await getToday(s, { day, now: NOW });
      expect(shape(got), email).toEqual(shape(expected(data, [...keys], day)));
      const allowed = new Set(data.persons.filter((p) => p.familyKeys.some((k) => (keys as readonly string[]).includes(k))).map((p) => p.id));
      for (const a of [...got.today, ...got.birthdays, ...got.upcoming, ...(got.next ? [got.next] : [])]) {
        for (const p of a.persons) expect(allowed.has(p.id), `${email}: ${a.key}`).toBe(true);
      }
    }
    // Über das ganze Jahr: der Betrachter sieht nie mehr als der Admin.
    const [admin, viewer] = await Promise.all([scope("admin@example.test"), scope("viewer@example.test")]);
    const a = await getToday(admin, { day: REAL_TODAY, now: NOW });
    const v = await getToday(viewer, { day: REAL_TODAY, now: NOW });
    expect(v.birthdays.length).toBeLessThanOrEqual(a.birthdays.length);
    expect(v.upcoming.length).toBeLessThanOrEqual(a.upcoming.length);
  });

  it("ohne Familie: nichts, auch kein nächster Jahrestag", async () => {
    const nofamily = await scope("nofamily@example.test");
    const got = await getToday(nofamily, { day, now: NOW });
    expect(got.today).toEqual([]);
    expect(got.birthdays).toEqual([]);
    expect(got.upcoming).toEqual([]);
    expect(got.next).toBeNull();
  });

  it("ohne gewählten Tag gilt heute nach Europe/Berlin", async () => {
    const admin = await scope("admin@example.test");
    // 23:30 UTC am 31.12. ist in Berlin schon der 1. Januar.
    const got = await getToday(admin, { now: new Date("2026-12-31T23:30:00Z") });
    expect(got.day).toEqual({ year: 2027, month: 1, day: 1 });
    expect(got.isRealToday).toBe(true);
  });
});
