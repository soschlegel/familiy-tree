/**
 * Familien der Person(en) auch in Einträgen zu Namen, Ereignissen, Belegen,
 * Bildern und Beziehungen (`subjectFamilyIds`, lib/audit.ts) und ihre
 * Auswertung im Verlauf der bleibenden Person (`subjectVisible`,
 * lib/services/changes.ts): Wer die aufgegangene Person bzw. bei mehreren
 * Personen eine von ihnen damals sehen durfte, sieht die Werte — wie heute
 * bei vorhandenen Datensätzen („sichtbar, sobald eine Seite sichtbar ist“).
 *
 * Familien im Mock: A (Bearbeiter: EDITOR), B (Bearbeiter: VIEWER),
 * C (Bearbeiter: kein Zugang). Legt eigene Personen, eine Quelle und Bilder an
 * und räumt sie samt Audit wieder ab.
 */
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { appChangeSet } from "@/lib/change-sets";
import { audit, auditRefs } from "@/lib/audit";
import {
  addMedia,
  createCitation,
  createEvent,
  createPerson,
  createPersonName,
  createRelationship,
  createSource,
  deleteEvent,
  deletePerson,
  listPersonChanges,
  mergePersons,
  scopeForEmail,
  updateEvent,
  type ChangeEntryDto,
} from "@/lib/services";
import { removeOrphanedMedia } from "@/lib/services/media";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Tests zu Familien in Untereinträgen übersprungen: ${skipReason}\n`);

const A = "mock-family-a";
const B = "mock-family-b";
const C = "mock-family-c";

async function request(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return { ...s, changeSet: appChangeSet() };
}
const admin = () => request("admin@example.test");
const editor = () => request("editor@example.test");

const png = (r: number) =>
  sharp({ create: { width: 10, height: 8, channels: 3, background: { r, g: 90, b: 160 } } }).png().toBuffer();

describe.skipIf(Boolean(skipReason))("Familien in Einträgen zu Namen, Ereignissen, Belegen, Bildern, Beziehungen", () => {
  const persons: string[] = [];
  const sources: string[] = [];
  const media: string[] = [];
  const startedAt = new Date();

  afterAll(async () => {
    if (skipReason) return;
    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-editor"] } },
          { personIds: { hasSome: persons } },
          { entityId: { in: [...persons, ...sources, ...media] } },
        ],
      },
      select: { id: true, changeSetId: true },
    });
    await prisma.auditLog.deleteMany({ where: { id: { in: logs.map((l) => l.id) } } });
    const sets = [...new Set(logs.map((l) => l.changeSetId).filter((x): x is string => Boolean(x)))];
    await prisma.changeSet.deleteMany({ where: { id: { in: sets }, entries: { none: {} } } });
    await prisma.personRedirect.deleteMany({ where: { OR: [{ fromId: { in: persons } }, { toId: { in: persons } }] } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.source.deleteMany({ where: { id: { in: sources } } });
    await removeOrphanedMedia(media);
    await prisma.$disconnect();
  });

  async function person(familyIds: string[], givenName = "E2E Unter"): Promise<string> {
    const id = (await createPerson(await admin(), { givenName, familyName: "Eintrag", familyIds })).id;
    persons.push(id);
    return id;
  }

  async function source(): Promise<string> {
    const id = (await createSource(await admin(), { title: "E2E Untereintrag-Quelle", kind: "CHURCH_BOOK" })).id;
    sources.push(id);
    return id;
  }

  async function image(targets: Record<string, string[]>, r = 1): Promise<string> {
    const id = (await addMedia(await admin(), { bytes: await png(r), fileName: "e2e-unter.png", targets })).media.id;
    media.push(id);
    return id;
  }

  const row = (entityType: string, entityId: string, action = "CREATE") =>
    prisma.auditLog.findFirstOrThrow({
      where: { entityType, entityId, action },
      orderBy: { createdAt: "desc" },
      select: { id: true, subjectFamilyIds: true, subjectFamiliesKnown: true },
    });

  async function history(scope: Scope, id: string): Promise<ChangeEntryDto[]> {
    return (await listPersonChanges(scope, id, { limit: 100 })).items;
  }
  const byId = (items: ChangeEntryDto[], id: string) => items.find((e) => e.id === id)!;

  it("speichert beim Schreiben die Familien je Eintragsart (bei mehreren Personen die Vereinigung)", async () => {
    const x = await person([A]);
    const q = await person([B, C]);
    const src = await source();

    const ev = (await createEvent(await admin(), { personId: x, type: "BAPTISM", place: "Ahausen" })).id;
    const name = (await createPersonName(await admin(), { personId: x, type: "MARRIED", familyName: "Ehename" })).id;
    const rel = (await createRelationship(await admin(), { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: x, toPersonId: q })).id;
    const coupleEv = (await createEvent(await admin(), { relationshipId: rel, type: "MARRIAGE_BANNS", date: "1900" })).id;
    const citP = (await createCitation(await admin(), { sourceId: src, personId: x, fact: "BIRTH", detail: "S. 1" })).id;
    const citR = (await createCitation(await admin(), { sourceId: src, relationshipId: rel, fact: "PARTNERSHIP", detail: "S. 2" })).id;
    const citE = (await createCitation(await admin(), { sourceId: src, eventId: ev, detail: "S. 3" })).id;
    const imgP = await image({ personIds: [x] }, 2);
    const imgR = await image({ relationshipIds: [rel] }, 3);
    const imgE = await image({ eventIds: [coupleEv] }, 4);
    const imgS = await image({ sourceIds: [src] }, 5);

    const only = (ids: string[]) => ({ subjectFamiliesKnown: true, subjectFamilyIds: expect.arrayContaining(ids) });
    expect(await row("Event", ev)).toMatchObject({ ...only([A]), subjectFamilyIds: [A] });
    expect(await row("PersonName", name)).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [A] });
    expect(await row("Citation", citP)).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [A] });
    expect(await row("Citation", citE)).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [A] });
    expect(await row("MediaAsset", imgP)).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [A] });
    for (const [type, id] of [["Relationship", rel], ["Event", coupleEv], ["Citation", citR], ["MediaAsset", imgR], ["MediaAsset", imgE]] as const) {
      const r = await row(type, id);
      expect(r, `${type} ${id}`).toMatchObject(only([A, B, C]));
      expect(r.subjectFamilyIds).toHaveLength(3);
    }
    // Bild an einer Quelle: Ersteller und Belege entscheiden, nicht Familien → nicht erfasst.
    expect(await row("MediaAsset", imgS)).toMatchObject({ subjectFamiliesKnown: false, subjectFamilyIds: [] });

    // Ändern und Löschen: Stand zum Zeitpunkt des Eintrags (Träger noch vorhanden).
    await updateEvent(await admin(), ev, { place: "Bhausen" });
    expect(await row("Event", ev, "UPDATE")).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [A] });
    await deleteEvent(await admin(), coupleEv);
    expect(await row("Event", coupleEv, "DELETE")).toMatchObject(only([A, B, C]));
  });

  it("nicht auffindbare Träger bleiben „nicht erfasst“; ausdrückliche Angaben gelten", async () => {
    const gone = await person([A]);
    await deletePerson(await admin(), gone);
    // Eintrag über ein Ereignis einer schon gelöschten Person: nie raten.
    expect(await auditRefs({ action: "DELETE", entityType: "Event", entityId: "e2e-weg", diff: { personId: gone } })).toMatchObject({
      subjectFamiliesKnown: false,
      subjectFamilyIds: [],
    });
    // Beziehung mit nur einer bekannten Seite: nicht eindeutig.
    const x = await person([A]);
    expect(await auditRefs({ action: "DELETE", entityType: "Relationship", entityId: "e2e-weg", diff: { fromPersonId: x } })).toMatchObject({
      subjectFamiliesKnown: false,
    });
    expect(await auditRefs({ action: "DELETE", entityType: "Relationship", entityId: "e2e-weg", diff: { fromPersonId: x, toPersonId: gone } })).toMatchObject({
      subjectFamiliesKnown: false,
    });
    // Vorher ermittelte refs (Bild löschen) samt „nicht erfasst“ werden übernommen.
    expect(await auditRefs({ action: "DELETE", entityType: "MediaAsset", entityId: "e2e-weg", subjectFamilyIds: [], subjectFamiliesKnown: false })).toMatchObject({
      subjectFamiliesKnown: false,
    });
    expect(await auditRefs({ action: "DELETE", entityType: "MediaAsset", entityId: "e2e-weg", subjectFamilyIds: [B] })).toMatchObject({
      subjectFamiliesKnown: true,
      subjectFamilyIds: [B],
    });
    // Quelle und Familie bleiben wie bisher ohne Angabe.
    expect(await auditRefs({ action: "UPDATE", entityType: "Source", entityId: "e2e-weg" })).toMatchObject({ subjectFamiliesKnown: false });
  });

  /** X mit Name, Ereignis, Beleg und Bild; danach in K aufgegangen. */
  async function mergedX(xFamilies: string[], marker: string) {
    const k = await person([A], "E2E Bleibend");
    const x = await person(xFamilies, `E2E ${marker}`);
    const src = await source();
    const ev = (await createEvent(await admin(), { personId: x, type: "BAPTISM", place: `${marker}kirche` })).id;
    const name = (await createPersonName(await admin(), { personId: x, type: "MARRIED", familyName: `${marker}name` })).id;
    const cit = (await createCitation(await admin(), { sourceId: src, personId: x, fact: "BIRTH", detail: `${marker}seite` })).id;
    const img = await image({ personIds: [x] }, 7);
    const ids = {
      ev: (await row("Event", ev)).id,
      name: (await row("PersonName", name)).id,
      cit: (await row("Citation", cit)).id,
      img: (await row("MediaAsset", img)).id,
    };
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    return { k, ids };
  }

  it("aufgegangene Person: Bearbeiter mit passender Familie sieht die Werte", async () => {
    const { k, ids } = await mergedX([A], "Passend");
    const items = await history(await editor(), k);
    expect(byId(items, ids.ev)).toMatchObject({ fromMerged: true, what: "Ereignis „Taufe“ angelegt" });
    expect(byId(items, ids.ev).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Passendkirche" })]));
    expect(byId(items, ids.name).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Passendname" })]));
    expect(byId(items, ids.cit).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Passendseite" })]));
    expect(byId(items, ids.img).what).toContain("e2e-unter.png");
  });

  it("aufgegangene Person: Bearbeiter ohne passende Familie sieht nur Art und Aktion; Administrator alles", async () => {
    // X war nur in C; nach dem Zusammenführen hat K auch C — zählt nicht.
    const { k, ids } = await mergedX([C], "Fremd");
    const items = await history(await editor(), k);
    for (const id of Object.values(ids)) {
      const e = byId(items, id);
      expect(e, id).toMatchObject({ fromMerged: true, fields: [], note: null });
      expect(JSON.stringify(e)).not.toMatch(/Fremd|e2e-unter/);
    }
    expect(byId(items, ids.ev).what).toBe("Ereignis angelegt");
    const all = await history(await admin(), k);
    expect(byId(all, ids.ev).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Fremdkirche" })]));
    expect(byId(all, ids.name).fields.length).toBeGreaterThan(0);
  });

  it("Mehr-Personen-Einträge: sichtbar, wenn der Bearbeiter damals eine der Personen sehen durfte — sonst verborgen", async () => {
    const k = await person([A], "E2E Bleibend");
    const x = await person([C], "E2E Partner");
    const qKnown = await person([B], "E2E Bekannt"); // Bearbeiter: nur sehen
    const qHidden = await person([C], "E2E Verborgen");
    const src = await source();
    const relKnown = (await createRelationship(await admin(), { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: x, toPersonId: qKnown, startPlace: "Bekanntort" })).id;
    const relHidden = (await createRelationship(await admin(), { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: x, toPersonId: qHidden, startPlace: "Verborgenort" })).id;
    const evKnown = (await createEvent(await admin(), { relationshipId: relKnown, type: "MARRIAGE_BANNS", place: "Bekanntkirche" })).id;
    const evHidden = (await createEvent(await admin(), { relationshipId: relHidden, type: "MARRIAGE_BANNS", place: "Verborgenkirche" })).id;
    const citHidden = (await createCitation(await admin(), { sourceId: src, relationshipId: relHidden, fact: "PARTNERSHIP", detail: "Verborgenseite" })).id;
    const ids = {
      relKnown: (await row("Relationship", relKnown)).id,
      relHidden: (await row("Relationship", relHidden)).id,
      evKnown: (await row("Event", evKnown)).id,
      evHidden: (await row("Event", evHidden)).id,
      citHidden: (await row("Citation", citHidden)).id,
    };
    await mergePersons(await admin(), { keepId: k, mergeId: x });

    const items = await history(await editor(), k);
    // X (C) unsichtbar, Q (B) sichtbar: wie heute an Q's Seite — Werte sichtbar.
    expect(byId(items, ids.relKnown)).toMatchObject({ fromMerged: true });
    expect(byId(items, ids.relKnown).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Bekanntort" })]));
    expect(byId(items, ids.evKnown).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Bekanntkirche" })]));
    // Beide Seiten unsichtbar: verborgen, auch die Beschreibung.
    for (const id of [ids.relHidden, ids.evHidden, ids.citHidden]) {
      const e = byId(items, id);
      expect(e, id).toMatchObject({ fromMerged: true, fields: [], note: null });
      expect(JSON.stringify(e)).not.toMatch(/Verborgen/);
    }
    // Administrator sieht alles.
    const all = await history(await admin(), k);
    expect(byId(all, ids.citHidden).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Verborgenseite" })]));
  });

  it("später gelöschte Person: gespeicherter Stand gilt weiter, spätere Änderungen geben nichts frei", async () => {
    const k = await person([A], "E2E Bleibend");
    const x = await person([C], "E2E Partner");
    const q = await person([B], "E2E Spaeter");
    const rel = (await createRelationship(await admin(), { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: x, toPersonId: q, startPlace: "Spaeterort" })).id;
    const relRow = await row("Relationship", rel);
    // Q wird gelöscht (samt Beziehung), X geht in K auf.
    await deletePerson(await admin(), q, { force: true });
    expect(await row("Relationship", rel)).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: expect.arrayContaining([B, C]) });
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    const items = await history(await editor(), k);
    expect(byId(items, relRow.id).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Spaeterort" })]));

    // Eine Familie, die später dazukommt (K hat nach dem Zusammenführen A), zählt nicht:
    // ein Ereignis von X2 nur in C bleibt verborgen.
    const x2 = await person([C], "E2E Spaeter2");
    const ev = (await createEvent(await admin(), { personId: x2, type: "BAPTISM", place: "Spaeterkirche" })).id;
    const evRow = await row("Event", ev);
    await prisma.personFamily.create({ data: { personId: x2, familyId: A } });
    await mergePersons(await admin(), { keepId: k, mergeId: x2 });
    expect(byId(await history(await editor(), k), evRow.id)).toMatchObject({ fromMerged: true, fields: [] });
  });

  it("Altbestand ohne gespeicherte Familien bleibt verborgen; Administrator sieht Werte", async () => {
    const k = await person([A], "E2E Bleibend");
    const x = await person([A], "E2E Altbestand");
    const ev = (await createEvent(await admin(), { personId: x, type: "BAPTISM", place: "Altkirche" })).id;
    const evRow = await row("Event", ev);
    await prisma.auditLog.update({ where: { id: evRow.id }, data: { subjectFamiliesKnown: false, subjectFamilyIds: [] } });
    // Ganz alter Eintrag ohne Momentaufnahme mit Personenbezug (über personIds der Person).
    const legacy = await prisma.auditLog.create({
      data: { action: "CREATE", entityType: "Event", entityId: "e2e-alt-ereignis", personIds: [x], diff: { type: "BURIAL", place: "Altfriedhof" } },
    });
    await mergePersons(await admin(), { keepId: k, mergeId: x });
    const items = await history(await editor(), k);
    expect(byId(items, evRow.id)).toMatchObject({ fromMerged: true, fields: [], what: "Ereignis angelegt" });
    expect(byId(items, legacy.id)).toMatchObject({ fromMerged: true, fields: [] });
    const all = await history(await admin(), k);
    expect(byId(all, evRow.id).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Altkirche" })]));
    expect(byId(all, legacy.id).fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Altfriedhof" })]));
  });

  it("vorhandene Person: eigene Einträge unverändert (Beziehung zu einer unsichtbaren Person mit Werten)", async () => {
    const k = await person([A], "E2E Eigen");
    const hidden = await person([C], "E2E Fremdpartner");
    const rel = (await createRelationship(await admin(), { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: k, toPersonId: hidden, startPlace: "Eigenort" })).id;
    const relRow = await row("Relationship", rel);
    const e = byId(await history(await editor(), k), relRow.id);
    expect(e).toMatchObject({ fromMerged: false });
    expect(e.fields).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Eigenort" })]));
    expect(e.what).toContain("nicht freigegeben");
  });

  it("audit() schreibt die Familien mit (fehlertoleranter Weg)", async () => {
    const x = await person([B]);
    await audit({ userId: "mock-user-admin", action: "UPDATE", entityType: "PersonName", entityId: "e2e-name-weg", diff: { personId: x } });
    expect(await row("PersonName", "e2e-name-weg", "UPDATE")).toMatchObject({ subjectFamiliesKnown: true, subjectFamilyIds: [B] });
    await prisma.auditLog.deleteMany({ where: { entityId: "e2e-name-weg" } });
  });
});
