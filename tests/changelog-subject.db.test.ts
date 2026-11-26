/**
 * Änderungsgeschichte zu Personen, die es nicht mehr gibt (gelöscht oder
 * aufgegangen): Das Leserecht hängt an den im Eintrag gespeicherten Familien
 * der Person zum Zeitpunkt des Eintrags (`subjectFamilyIds`, lib/audit.ts;
 * Auswertung in lib/services/changes.ts). Fälle: Bearbeiter mit und ohne
 * passende Familie, Administrator, Person ohne Familie, Altbestand ohne
 * gespeicherte Familien, später gelöschte Familie, zusammengeführte Person.
 *
 * Grundmuster: R (Verwandter, bleibt) ist Elternteil von X; X geht in K auf.
 * Der Eintrag „Zusammengeführt: X in K“ steht damit auch im Verlauf von R und
 * zeigt Feldwerte von K (Geburtsort vorher → nachher). Danach verschwindet K.
 * Legt eigene Personen und Familien an und räumt sie (samt Audit) wieder ab.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { appChangeSet } from "@/lib/change-sets";
import {
  createPerson,
  createRelationship,
  deletePerson,
  listPersonChanges,
  mergePersons,
  RESTRICTED,
  scopeForEmail,
  setPersonFamilies,
  type ChangeEntryDto,
} from "@/lib/services";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Tests zur Geschichte gelöschter Personen übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a"; // Bearbeiter: EDITOR
const FAMILY_C = "mock-family-c"; // Bearbeiter: kein Zugang

async function request(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return { ...s, changeSet: appChangeSet() };
}

const admin = () => request("admin@example.test");
const editor = () => request("editor@example.test");

describe.skipIf(Boolean(skipReason))("Verlauf gelöschter und aufgegangener Personen (Mock-Datenbank)", () => {
  const persons: string[] = [];
  const families: string[] = [];
  const startedAt = new Date();

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    const sets = await prisma.auditLog.findMany({
      where: { createdAt: { gte: startedAt }, changeSetId: { not: null } },
      select: { changeSetId: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-editor"] } },
          { entityId: { in: persons } },
        ],
      },
    });
    await prisma.changeSet.deleteMany({ where: { id: { in: sets.map((s) => s.changeSetId!) }, entries: { none: {} } } });
    await prisma.$disconnect();
  });

  async function person(familyIds: string[], extra: Record<string, unknown> = {}): Promise<string> {
    const id = (await createPerson(await admin(), { givenName: "E2E Verlauf", familyName: "Geloescht", familyIds, ...extra })).id;
    persons.push(id);
    return id;
  }

  /** R (in `rFamilies`) ← Eltern von X; X geht in K auf. Liefert die Kennungen und den MERGE-Eintrag. */
  async function mergedScenario(rFamilies: string[], kFamilies: string[]) {
    const r = await person(rFamilies);
    const k = await person(kFamilies);
    const x = await person(kFamilies, { birthPlace: "Musterstadt" });
    await createRelationship(await admin(), { type: "PARENT_OF", subtype: "BIOLOGICAL", fromPersonId: r, toPersonId: x });
    const merged = await mergePersons(await admin(), { keepId: k, mergeId: x });
    if (!merged.auditId) throw new Error("Zusammenführen ohne Audit-Eintrag");
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: merged.auditId } });
    return { r, k, x, row };
  }

  async function mergeEntryIn(scope: Scope, historyOf: string, auditId: string): Promise<ChangeEntryDto> {
    const page = await listPersonChanges(scope, historyOf, { limit: 100 });
    const entry = page.items.find((e) => e.id === auditId);
    if (!entry) throw new Error("MERGE-Eintrag fehlt im Verlauf");
    return entry;
  }

  const BIRTHPLACE = { field: "birthPlace", label: "Geburtsort", from: null, to: "Musterstadt" };

  it("speichert die Familien der Person im Eintrag (Ändern, Zusammenführen, Löschen)", async () => {
    const p = await person([FAMILY_A]);
    const created = await prisma.auditLog.findFirstOrThrow({ where: { entityId: p, action: "CREATE" } });
    expect(created).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [FAMILY_A] });

    const { r, k, row } = await mergedScenario([FAMILY_A], [FAMILY_C]);
    expect(row).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [FAMILY_C] });
    // Andere Arten erfassen nichts (hier: die Beziehung R → X).
    const rel = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Relationship", action: "CREATE", personIds: { has: r } } });
    expect(rel).toMatchObject({ subjectFamiliesKnown: false, subjectFamilyIds: [] });

    // Nach dem Löschen: der letzte Stand vor dem Löschen.
    await setPersonFamilies(await admin(), k, [FAMILY_A, FAMILY_C]);
    await deletePerson(await admin(), k, { force: true });
    const del = await prisma.auditLog.findFirstOrThrow({ where: { entityId: k, action: "DELETE" } });
    expect(del.subjectFamiliesKnown).toBe(true);
    expect([...del.subjectFamilyIds].sort()).toEqual([FAMILY_A, FAMILY_C].sort());

    // Ohne Familie: erfasst, aber leer (= nur Admins).
    const none = await person([]);
    const noneRow = await prisma.auditLog.findFirstOrThrow({ where: { entityId: none, action: "CREATE" } });
    expect(noneRow).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [] });
  });

  it("gelöschte Person: Bearbeiter mit passender Familie sieht die Feldwerte, Administrator auch", async () => {
    const { r, k, row } = await mergedScenario([FAMILY_A], [FAMILY_A]);
    await deletePerson(await admin(), k, { force: true });
    expect(await prisma.person.count({ where: { id: k } })).toBe(0);

    const seen = await mergeEntryIn(await editor(), r, row.id);
    expect(seen.fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
    expect(seen.what).toBe("Zusammengeführt: E2E Verlauf Geloescht in gelöschte Person");

    const all = await mergeEntryIn(await admin(), r, row.id);
    expect(all.fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
  });

  it("gelöschte Person: Bearbeiter ohne passende Familie sieht keine Feldwerte", async () => {
    const { r, k, row } = await mergedScenario([FAMILY_A], [FAMILY_C]);
    await deletePerson(await admin(), k, { force: true });

    const hidden = await mergeEntryIn(await editor(), r, row.id);
    expect(hidden.fields).toEqual([]);
    expect(hidden.note).toBeNull();
    expect(hidden.what).toBe(`Zusammengeführt: ${RESTRICTED} in gelöschte Person`);
    expect(JSON.stringify(hidden)).not.toContain("Musterstadt");

    const all = await mergeEntryIn(await admin(), r, row.id);
    expect(all.fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
  });

  it("Person ohne Familie: auch nach dem Löschen nur für Administratoren", async () => {
    const { r, k, row } = await mergedScenario([FAMILY_A], []);
    await deletePerson(await admin(), k, { force: true });
    expect((await mergeEntryIn(await editor(), r, row.id)).fields).toEqual([]);
    expect((await mergeEntryIn(await admin(), r, row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
  });

  it("Altbestand ohne gespeicherte Familien bleibt für Nicht-Admins verborgen", async () => {
    const { r, k, row } = await mergedScenario([FAMILY_A], [FAMILY_A]);
    // Wie ein Eintrag aus der Zeit vor der Erfassung.
    await prisma.auditLog.update({ where: { id: row.id }, data: { subjectFamiliesKnown: false, subjectFamilyIds: [] } });
    // Solange es die Person gibt: heutige Familien.
    expect((await mergeEntryIn(await editor(), r, row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
    await deletePerson(await admin(), k, { force: true });
    expect((await mergeEntryIn(await editor(), r, row.id)).fields).toEqual([]);
    expect((await mergeEntryIn(await admin(), r, row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
  });

  it("später gelöschte Familie gibt nichts frei — sie nimmt dem Bearbeiter das Leserecht", async () => {
    const family = await prisma.family.create({ data: { name: "E2E Verlauf Familie" } });
    families.push(family.id);
    await prisma.userFamily.create({ data: { userId: "mock-user-editor", familyId: family.id, role: "EDITOR" } });
    const { r, k, row } = await mergedScenario([FAMILY_A], [family.id]);
    await deletePerson(await admin(), k, { force: true });
    expect((await mergeEntryIn(await editor(), r, row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));

    await prisma.family.delete({ where: { id: family.id } });
    const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.subjectFamilyIds).toEqual([family.id]);
    expect((await mergeEntryIn(await editor(), r, row.id)).fields).toEqual([]);
    // Andere Benutzer gewinnen nichts: der Betrachter sieht den Verlauf ohnehin nicht.
    await expect(listPersonChanges(await request("viewer@example.test"), r)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("aufgegangene Person: gespeicherte Familien gelten, nicht die der bleibenden Person", async () => {
    // K in A: der Bearbeiter durfte K sehen. K geht später in K2 (Familie C) auf.
    const seen = await mergedScenario([FAMILY_A], [FAMILY_A]);
    const k2 = await person([FAMILY_C]);
    await mergePersons(await admin(), { keepId: k2, mergeId: seen.k });
    expect(await prisma.person.count({ where: { id: seen.k } })).toBe(0);
    expect((await mergeEntryIn(await editor(), seen.r, seen.row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));

    // K in C (für den Bearbeiter unsichtbar), später nach A verschoben und dann in
    // K2 aufgegangen: Es zählt der Stand des Eintrags (C), nicht spätere
    // Familien — auch nicht die der bleibenden Person über die Umleitung.
    const hidden = await mergedScenario([FAMILY_A], [FAMILY_C]);
    await setPersonFamilies(await admin(), hidden.k, [FAMILY_A]);
    // Solange K lebt, entscheiden die heutigen Familien.
    expect((await mergeEntryIn(await editor(), hidden.r, hidden.row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
    const k3 = await person([FAMILY_A]);
    await mergePersons(await admin(), { keepId: k3, mergeId: hidden.k });
    expect(await prisma.personRedirect.findUnique({ where: { fromId: hidden.k } })).toMatchObject({ toId: k3 });
    expect((await mergeEntryIn(await editor(), hidden.r, hidden.row.id)).fields).toEqual([]);
    expect((await mergeEntryIn(await admin(), hidden.r, hidden.row.id)).fields).toEqual(expect.arrayContaining([BIRTHPLACE]));
  });
});
