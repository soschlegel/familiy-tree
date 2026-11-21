/**
 * Changelog gegen die Mock-Datenbank: Pakete, Momentaufnahme der Personen
 * und Familien, vorher → nachher, Verlauf je Person mit Rechten und
 * Maskierung, Übersicht für Administratoren, Bündeln über den KI-Zugang.
 * Legt eigene Personen an und räumt sie (samt Audit und Paketen) wieder ab.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { appChangeSet, beginMcpChangeSet, mcpChangeSet } from "@/lib/change-sets";
import {
  applyGenealogyImport,
  createEvent,
  createPerson,
  createRelationship,
  deleteEvent,
  listChangeSetEntries,
  listChangeSets,
  listPersonChanges,
  mergePersons,
  RESTRICTED,
  scopeForEmail,
  ServiceError,
  updateEvent,
  updatePerson,
} from "@/lib/services";

async function mockDbReady(): Promise<string | null> {
  try {
    const admin = await prisma.user.findUnique({ where: { id: "mock-user-admin" } });
    return admin ? null : "Mock-Datenbank ist leer — bitte `npm run mock:setup` ausführen.";
  } catch (err) {
    return `Mock-Datenbank nicht erreichbar (${(err as Error).message.split("\n").pop()})`;
  }
}

const skipReason = await mockDbReady();
if (skipReason) console.warn(`\n[tests] Changelog-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";
const FAMILY_C = "mock-family-c";

/** Scope wie in der Web-API: mit eigenem Paket je „Anfrage“. */
async function request(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return { ...s, changeSet: appChangeSet() };
}

async function expectCode(p: Promise<unknown>, code: ServiceError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === code);
}

describe.skipIf(Boolean(skipReason))("Changelog (Mock-Datenbank)", () => {
  const created: string[] = [];
  const startedAt = new Date();
  let inA = "";
  let inC = "";

  beforeAll(async () => {
    const admin = await request("admin@example.test");
    inA = (await createPerson(admin, { givenName: "E2E Changelog", familyName: "Anna", familyIds: [FAMILY_A] })).id;
    inC = (await createPerson(admin, { givenName: "E2E Changelog", familyName: "Verborgen", familyIds: [FAMILY_C] })).id;
    created.push(inA, inC);
  });

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: created } } });
    const sets = await prisma.auditLog.findMany({
      where: { createdAt: { gte: startedAt }, changeSetId: { not: null } },
      select: { changeSetId: true },
    });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-editor"] } } });
    await prisma.changeSet.deleteMany({
      where: { OR: [{ id: { in: sets.map((s) => s.changeSetId!) } }, { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-editor"] } }] },
    });
    await prisma.$disconnect();
  });

  it("eine Anfrage = ein Paket; Momentaufnahme der Personen und Familien", async () => {
    const admin = await request("admin@example.test");
    await updatePerson(admin, inA, { birthPlace: "Musterstadt" });
    await createRelationship(admin, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: inA, toPersonId: inC });
    const rows = await prisma.auditLog.findMany({
      where: { changeSetId: admin.changeSet!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.entityType)).toEqual(["Person", "Relationship"]);
    const set = await prisma.changeSet.findUniqueOrThrow({ where: { id: admin.changeSet!.id! } });
    expect(set).toMatchObject({ title: "Person geändert", kind: "APP", userId: "mock-user-admin", channel: null });
    expect(rows[1].personIds.sort()).toEqual([inA, inC].sort());
    expect(rows[1].familyIds.sort()).toEqual([FAMILY_A, FAMILY_C].sort());
    expect(rows[0].diff).toEqual({ changes: { birthPlace: { from: null, to: "Musterstadt" } } });
  });

  it("ohne Änderung kein Eintrag", async () => {
    const admin = await request("admin@example.test");
    await updatePerson(admin, inA, { birthPlace: "Musterstadt" });
    expect(admin.changeSet!.id).toBeUndefined();
  });

  it("Verlauf: Ereignisse mit vorher → nachher, Datum in Anzeigeform; gelöschte bleiben sichtbar", async () => {
    const editor = await request("editor@example.test");
    const ev = await createEvent(editor, { personId: inA, type: "BAPTISM", date: "um 1850", place: "Altdorf" });
    const editor2 = await request("editor@example.test");
    await updateEvent(editor2, ev.id, { date: "12.03.1850", place: "Neudorf" });
    const editor3 = await request("editor@example.test");
    await deleteEvent(editor3, ev.id);

    const page = await listPersonChanges(editor, inA);
    const [del, upd, add] = page.items;
    expect(del).toMatchObject({ action: "DELETE", what: "Ereignis „Taufe“ gelöscht", channel: "APP" });
    expect(upd.what).toBe("Ereignis „Taufe“ geändert");
    expect(upd.fields).toEqual(
      expect.arrayContaining([
        { field: "date", label: "Datum", from: "um 1850", to: "12.03.1850" },
        { field: "place", label: "Ort", from: "Altdorf", to: "Neudorf" },
      ]),
    );
    expect(upd.changeSet?.title).toBe("Ereignis geändert");
    expect(add.fields).toEqual(expect.arrayContaining([{ field: "place", label: "Ort", from: null, to: "Altdorf" }]));
    expect(upd.user).toBeTruthy();
  });

  it("Verlauf: Verweise auf nicht sichtbare Personen bleiben verborgen", async () => {
    const editor = await request("editor@example.test");
    const page = await listPersonChanges(editor, inA, { limit: 100 });
    const rel = page.items.find((e) => e.what.startsWith("Beziehung angelegt"))!;
    expect(rel.what).toContain(RESTRICTED);
    expect(rel.what).not.toContain("Verborgen");
    expect(JSON.stringify(page)).not.toContain("Verborgen");
    // Der Admin sieht den Namen.
    const admin = await request("admin@example.test");
    const all = await listPersonChanges(admin, inA, { limit: 100 });
    expect(all.items.find((e) => e.what.startsWith("Beziehung angelegt"))!.what).toContain("E2E Changelog Verborgen");
  });

  it("Verlauf nur für Bearbeiter: Betrachter FORBIDDEN, ohne Familie NOT_FOUND", async () => {
    await expectCode(listPersonChanges(await request("viewer@example.test"), inA), "FORBIDDEN");
    await expectCode(listPersonChanges(await request("nofamily@example.test"), inA), "NOT_FOUND");
    await expectCode(listPersonChanges(await request("editor@example.test"), inC), "NOT_FOUND");
  });

  it("Verlauf seitenweise mit Cursor", async () => {
    const admin = await request("admin@example.test");
    const first = await listPersonChanges(admin, inA, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1].id);
    const second = await listPersonChanges(admin, inA, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((e) => e.id)).not.toContain(first.items[0].id);
    expect(new Date(second.items[0].at).getTime()).toBeLessThanOrEqual(new Date(first.items[1].at).getTime());
  });

  it("Übersicht: nur Administratoren, Filter Familie und Kanal, Zusammenfassung je Paket", async () => {
    await expectCode(listChangeSets(await request("editor@example.test")), "FORBIDDEN");
    const admin = await request("admin@example.test");
    const today = new Date().toISOString().slice(0, 10);
    const inFamilyC = await listChangeSets(admin, { familyId: FAMILY_C, from: today, to: today });
    const rel = inFamilyC.items.find((i) => i.title === "Person geändert")!;
    expect(rel).toBeTruthy();
    // In Familie C liegt nur die Beziehung (die Änderung an der Person aus A nicht).
    expect(rel.summary).toBe("1 Beziehung angelegt");
    const entries = await listChangeSetEntries(admin, rel.key, { familyId: FAMILY_C });
    expect(entries.items).toHaveLength(1);
    const unfiltered = await listChangeSetEntries(admin, rel.key);
    expect(unfiltered.items).toHaveLength(2);
    const mcpOnly = await listChangeSets(admin, { channel: "MCP", from: today });
    expect(mcpOnly.items.every((i) => i.channel === "MCP")).toBe(true);
    await expectCode(listChangeSets(admin, { from: "gestern" }), "VALIDATION");
  });

  it("KI-Zugang: Bündeln je Schlüssel, begin_change_set, fremde Kennung abgelehnt", async () => {
    const token = await prisma.apiToken.findFirstOrThrow({ where: { userId: "mock-user-editor", revokedAt: null } });
    const base = await scopeForEmail("editor@example.test");
    const via = { channel: "MCP" as const, tokenId: token.id, level: "WRITE" as const };
    const call = async (id?: string) => {
      const cs = await mcpChangeSet({ userId: base!.userId, via }, id);
      if (!cs.ok) throw new Error(cs.message);
      return { ...base!, via, changeSet: cs.handle };
    };
    const one = await call();
    await updatePerson(one, inA, { deathPlace: "Ort 1" });
    const two = await call();
    await updatePerson(two, inA, { deathPlace: "Ort 2" });
    expect(two.changeSet.id).toBe(one.changeSet.id);
    const auto = await prisma.changeSet.findUniqueOrThrow({ where: { id: one.changeSet.id! } });
    expect(auto).toMatchObject({ kind: "MCP_AUTO", channel: "MCP", apiTokenId: token.id });
    expect(auto.title).toContain(token.name);

    const opened = await beginMcpChangeSet({ userId: base!.userId, via }, "  Kirchenbuch   ausgewertet ");
    expect(opened.title).toBe("Kirchenbuch ausgewertet");
    const three = await call(opened.id);
    await updatePerson(three, inA, { deathPlace: "Ort 3" });
    // Ohne Kennung: an das zuletzt geöffnete Paket.
    const four = await call();
    await updatePerson(four, inA, { deathPlace: "Ort 4" });
    expect(four.changeSet.id).toBe(opened.id);

    const page = await listPersonChanges(await request("editor@example.test"), inA, { limit: 4 });
    expect(page.items[0]).toMatchObject({ channel: "MCP", tokenName: token.name, changeSet: { id: opened.id, title: "Kirchenbuch ausgewertet" } });
    expect(page.items[0].fields).toEqual([{ field: "deathPlace", label: "Sterbeort", from: "Ort 3", to: "Ort 4" }]);

    const foreign = await mcpChangeSet({ userId: "mock-user-admin", via }, opened.id);
    expect(foreign.ok).toBe(false);
    expect((await mcpChangeSet({ userId: base!.userId, via }, "gibt-es-nicht")).ok).toBe(false);
  });

  it("Import: ein Paket, je Person ein Eintrag mit Ereignissen; Wiederholung zeigt vorher → nachher", async () => {
    const admin = await request("admin@example.test");
    const first = await applyGenealogyImport(admin, {
      familyIds: [FAMILY_A],
      persons: [{ ref: "@I1@", givenName: "E2E Changelog", familyName: "Import", birthPlace: "Altdorf" }],
      events: [
        { ref: "@I1@/BAPM", personRef: "@I1@", type: "BAPTISM", date: { date: "1850" } },
        { ref: "@I1@/OCCU", personRef: "@I1@", type: "OCCUPATION", value: "Müller" },
      ],
    });
    const id = first.ids.persons["@I1@"];
    created.push(id);
    const rows = await prisma.auditLog.findMany({ where: { changeSetId: admin.changeSet!.id } });
    expect(rows.map((r) => `${r.entityType}:${r.action}`).sort()).toEqual(["ImportBatch:CREATE", "Person:CREATE"]);
    const own = rows.find((r) => r.entityType === "Person")!;
    expect(own).toMatchObject({ personIds: [id], familyIds: [FAMILY_A] });

    const again = await request("admin@example.test");
    await applyGenealogyImport(again, {
      persons: [{ ref: "@I1@", action: "update", id, givenName: "E2E Changelog", familyName: "Import", birthPlace: "Neudorf" }],
    });
    const page = await listPersonChanges(admin, id);
    expect(page.items[0]).toMatchObject({
      what: "Beim Import aktualisiert: E2E Changelog Import",
      fields: [{ field: "birthPlace", label: "Geburtsort", from: "Altdorf", to: "Neudorf" }],
    });
    expect(page.items[1]).toMatchObject({ what: "Beim Import angelegt: E2E Changelog Import", note: "angelegt: 2 Ereignisse" });

    const today = new Date().toISOString().slice(0, 10);
    const sets = await listChangeSets(admin, { familyId: FAMILY_A, from: today });
    expect(sets.items.find((s) => s.key === admin.changeSet!.id)!.summary).toBe("1 Person, 2 Ereignisse angelegt");
  });

  it("Zusammenführen: ein Paket, beide Personen und Familien im Eintrag, Verlauf der bleibenden Person", async () => {
    const admin = await request("admin@example.test");
    const keep = (await createPerson(admin, { givenName: "E2E Changelog", familyName: "Doppelt", familyIds: [FAMILY_A] })).id;
    const other = (await createPerson(admin, { givenName: "E2E Changelog", familyName: "Doppelt", birthPlace: "Celle", familyIds: [FAMILY_C] })).id;
    created.push(keep, other);
    const merging = await request("admin@example.test");
    await mergePersons(merging, { keepId: keep, mergeId: other });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "MERGE", entityId: keep } });
    expect(row.personIds).toEqual(expect.arrayContaining([keep, other]));
    expect(row.familyIds.sort()).toEqual([FAMILY_A, FAMILY_C].sort());
    expect((await prisma.changeSet.findUniqueOrThrow({ where: { id: row.changeSetId! } })).title).toBe("Personen zusammengeführt");
    const page = await listPersonChanges(admin, keep, { limit: 1 });
    expect(page.items[0].what).toBe("Zusammengeführt: E2E Changelog Doppelt in E2E Changelog Doppelt");
    expect(page.items[0].fields).toEqual(expect.arrayContaining([{ field: "birthPlace", label: "Geburtsort", from: null, to: "Celle" }]));
    // Der Bearbeiter (ohne Familie C) sieht den Namen der aufgegangenen Person nicht.
    const editorView = await listPersonChanges(await request("editor@example.test"), keep, { limit: 1 });
    expect(editorView.items[0].what).toBe(`Zusammengeführt: ${RESTRICTED} in E2E Changelog Doppelt`);
  });

  it("ältere Einträge ohne Momentaufnahme erscheinen im Verlauf (nur neue Werte)", async () => {
    const legacy = await prisma.auditLog.create({
      data: { userId: "mock-user-admin", action: "UPDATE", entityType: "Person", entityId: inA, diff: { nickname: "Anni" } },
    });
    const page = await listPersonChanges(await request("admin@example.test"), inA, { limit: 1 });
    expect(page.items[0]).toMatchObject({
      id: legacy.id,
      changeSet: null,
      fields: [{ field: "nickname", label: "Rufname", from: null, to: "Anni", onlyNew: true }],
    });
  });
});
