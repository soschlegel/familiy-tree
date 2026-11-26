/**
 * Verlauf einer Person mit den älteren Einträgen der Personen, die in ihr
 * aufgegangen sind (Zusammenführen, auch über mehrere Stufen). Quelle der
 * Vorgänger: die Umleitungen alter Kennungen (`PersonRedirect`,
 * lib/services/redirects.ts). Leserecht für diese Einträge: dieselbe Regel
 * wie für Personen, die es nicht mehr gibt (`subjectVisible` in
 * lib/services/changes.ts) — nie die heutigen Familien der bleibenden Person.
 *
 * Familien im Mock: A (Bearbeiter: EDITOR), C (Bearbeiter: kein Zugang).
 * Legt eigene Personen an und räumt sie (samt Audit) wieder ab.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { appChangeSet } from "@/lib/change-sets";
import {
  createEvent,
  createPerson,
  listPersonChanges,
  mergePersons,
  scopeForEmail,
  updatePerson,
  type ChangeEntryDto,
} from "@/lib/services";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Tests zum Verlauf zusammengeführter Personen übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";
const FAMILY_C = "mock-family-c";

async function request(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return { ...s, changeSet: appChangeSet() };
}

const admin = () => request("admin@example.test");
const editor = () => request("editor@example.test");

describe.skipIf(Boolean(skipReason))("Verlauf mit Einträgen aufgegangener Personen (Mock-Datenbank)", () => {
  const persons: string[] = [];
  const startedAt = new Date();

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
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
    const id = (await createPerson(await admin(), { givenName: "E2E Vorgaenger", familyName: "Verlauf", familyIds, ...extra })).id;
    persons.push(id);
    return id;
  }

  async function history(scope: Scope, id: string): Promise<ChangeEntryDto[]> {
    return (await listPersonChanges(scope, id, { limit: 100 })).items;
  }

  /** Einträge zu X (Anlegen, Ändern, Ereignis) vor dem Zusammenführen; liefert deren Kennungen. */
  async function xWithHistory(families: string[], marker: string) {
    const x = await person(families, { givenName: `E2E ${marker}`, birthPlace: `${marker}stadt` });
    await updatePerson(await admin(), x, { deathPlace: `${marker}dorf` });
    await createEvent(await admin(), { personId: x, type: "BAPTISM", place: `${marker}kirche` });
    const rows = await prisma.auditLog.findMany({
      where: { personIds: { has: x } },
      select: { id: true, entityType: true, action: true },
    });
    const of = (entityType: string, action: string) => rows.find((r) => r.entityType === entityType && r.action === action)!.id;
    return { x, created: of("Person", "CREATE"), updated: of("Person", "UPDATE"), event: of("Event", "CREATE") };
  }

  const byId = (items: ChangeEntryDto[], id: string) => items.find((e) => e.id === id);

  it("Einträge der aufgegangenen Person erscheinen bei der bleibenden, gekennzeichnet und zeitlich einsortiert", async () => {
    const k = await person([FAMILY_A]);
    const { x, created, updated } = await xWithHistory([FAMILY_A], "Sichtbar");
    const merged = await mergePersons(await admin(), { keepId: k, mergeId: x });

    const items = await history(await editor(), k);
    const ids = items.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([created, updated, merged.auditId]));
    // Neueste zuerst, die Einträge von X mittendrin nach Zeit.
    const times = items.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);

    expect(byId(items, created)).toMatchObject({ fromMerged: true, what: expect.stringMatching(/^Person angelegt: /) });
    expect(byId(items, created)!.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: "birthPlace", to: "Sichtbarstadt" })]));
    expect(byId(items, updated)!.fields).toEqual([expect.objectContaining({ field: "deathPlace", to: "Sichtbardorf" })]);
    // Eigene Einträge von K (Anlegen, Zusammenführen) sind nicht gekennzeichnet.
    expect(byId(items, merged.auditId!)).toMatchObject({ fromMerged: false });
    expect(items.find((e) => e.action === "CREATE" && !e.fromMerged)).toBeDefined();
  });

  it("über mehrere Stufen: X in Y, Y in K — alle Einträge erscheinen bei K", async () => {
    const k = await person([FAMILY_A]);
    const y = await person([FAMILY_A], { givenName: "E2E Stufe" });
    const { x, created } = await xWithHistory([FAMILY_A], "Stufe");
    const first = await mergePersons(await admin(), { keepId: y, mergeId: x });
    await mergePersons(await admin(), { keepId: k, mergeId: y });
    const yCreated = (await prisma.auditLog.findFirstOrThrow({ where: { entityId: y, action: "CREATE" } })).id;

    const items = await history(await editor(), k);
    for (const id of [created, yCreated, first.auditId!]) {
      expect(byId(items, id), id).toMatchObject({ fromMerged: true });
    }
    // Der frühere Zusammenführen-Eintrag nennt die heutige Person statt „gelöschte Person“.
    expect(byId(items, first.auditId!)!.what).not.toContain("gelöschte Person");
  });

  it("Bearbeiter: gespeicherte Familie entscheidet, nicht die heutige der bleibenden Person", async () => {
    // X war in C (für den Bearbeiter unsichtbar), K ist in A. Nach dem
    // Zusammenführen hat K beide Familien — die Einträge von X bleiben verborgen.
    const k = await person([FAMILY_A]);
    const { x, created, updated, event } = await xWithHistory([FAMILY_C], "Verdeckt");
    await mergePersons(await admin(), { keepId: k, mergeId: x });

    const items = await history(await editor(), k);
    for (const id of [created, updated, event]) {
      const e = byId(items, id)!;
      expect(e, id).toMatchObject({ fromMerged: true, fields: [], note: null });
      expect(JSON.stringify(e)).not.toMatch(/Verdeckt/);
    }
    expect(byId(items, created)!.what).toBe("Person angelegt");
    expect(byId(items, event)!.what).toBe("Ereignis angelegt");

    // Administrator sieht alles.
    const all = await history(await admin(), k);
    expect(byId(all, created)!.fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Verdecktstadt" })]));
    expect(byId(all, event)!.what).toContain("Taufe");
    expect(byId(all, event)!.fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Verdecktkirche" })]));
  });

  it("Bearbeiter mit passender Familie: Personeneinträge mit Werten, andere Arten nur für Administratoren", async () => {
    const k = await person([FAMILY_A]);
    const { x, created, event } = await xWithHistory([FAMILY_A], "Passend");
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    const items = await history(await editor(), k);
    expect(byId(items, created)!.fields.length).toBeGreaterThan(0);
    // Ereignisse speichern keine Familien der Person → im Zweifel verborgen.
    expect(byId(items, event)).toMatchObject({ fromMerged: true, what: "Ereignis angelegt", fields: [] });
  });

  it("Altbestand ohne gespeicherte Familien: nur Administratoren sehen Werte", async () => {
    const k = await person([FAMILY_A]);
    const { x, created } = await xWithHistory([FAMILY_A], "Alt");
    await prisma.auditLog.update({ where: { id: created }, data: { subjectFamiliesKnown: false, subjectFamilyIds: [] } });
    // Ganz alter Eintrag ohne Momentaufnahme (nur über die Kennung zu finden).
    const legacy = await prisma.auditLog.create({
      data: { action: "UPDATE", entityType: "Person", entityId: x, diff: { givenName: "E2E Altwert" }, createdAt: new Date(Date.now() - 60_000) },
    });
    await mergePersons(await admin(), { keepId: k, mergeId: x });

    const items = await history(await editor(), k);
    expect(byId(items, created)).toMatchObject({ fromMerged: true, fields: [], what: "Person angelegt" });
    expect(byId(items, legacy.id)).toMatchObject({ fromMerged: true, fields: [] });
    const all = await history(await admin(), k);
    expect(byId(all, created)!.fields.length).toBeGreaterThan(0);
    expect(byId(all, legacy.id)!.fields).toEqual([expect.objectContaining({ to: "E2E Altwert", onlyNew: true })]);
  });

  it("wer die bleibende Person nicht sehen oder bearbeiten darf, sieht weiterhin nichts", async () => {
    const k = await person([FAMILY_C]);
    const { x } = await xWithHistory([FAMILY_A], "Fremd");
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    // Nach dem Zusammenführen ist K in A und C; der Betrachter (A: VIEWER) darf nicht bearbeiten.
    await expect(listPersonChanges(await request("viewer@example.test"), k)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listPersonChanges(await request("nofamily@example.test"), k)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("seitenweises Laden über eigene und übernommene Einträge; Umleitung einer lebenden Person zählt nicht", async () => {
    const k = await person([FAMILY_A]);
    const { x } = await xWithHistory([FAMILY_A], "Seite");
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    // Fehlerhafte Daten: eine Umleitung von einer Person, die es noch gibt.
    const alive = await person([FAMILY_A], { givenName: "E2E Lebend" });
    await prisma.personRedirect.create({ data: { fromId: alive, toId: k } });

    const all = await history(await admin(), k);
    expect(all.some((e) => e.what.includes("E2E Lebend"))).toBe(false);
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listPersonChanges(await admin(), k, { limit: 2, cursor });
      paged.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(all.map((e) => e.id));
    expect(all.filter((e) => e.fromMerged).length).toBeGreaterThanOrEqual(3);
  });
});
