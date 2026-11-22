/**
 * Dienst-Tests für Lebensereignisse, Namen, Orte, Ehestand unbekannt und den
 * Massenimport gegen die Mock-Datenbank. Schreibende Tests legen eigene
 * Datensätze an und räumen sie (samt Audit-Einträgen und Importdateien)
 * wieder ab. Überspringt sich ohne Mock-Datenbank.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import {
  applyGenealogyImport,
  createCitation,
  createEvent,
  createImportBatch,
  createPerson,
  createPersonName,
  deleteEvent,
  deletePersonName,
  findDataGaps,
  findExternalIds,
  findInconsistencies,
  getEvent,
  getFamilyTimeline,
  getPersonDetail,
  getPersonTimeline,
  listImportBatches,
  listImportLinks,
  listPersonEvents,
  listRawRecords,
  listRelationshipEvents,
  MAX_IMPORT_FILE_BYTES,
  markMissingInSource,
  pruneRawRecords,
  readImportBatchFile,
  scopeForEmail,
  searchPersons,
  ServiceError,
  updateEvent,
  updatePerson,
  updatePersonName,
  updateRelationship,
} from "@/lib/services";
import { mockData } from "./helpers";

async function mockDbReady(): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    if (!admin) return "Mock-Datenbank ist leer — bitte `npm run mock:setup` ausführen.";
    if ((await prisma.event.count()) === 0) return "Mock-Datenbank ohne Ereignisse — bitte `npm run db:mock` ausführen.";
    return null;
  } catch (err) {
    const detail = (err as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    return `Mock-Datenbank nicht erreichbar (${detail}).`;
  }
}

const skipReason = await mockDbReady();
if (skipReason) console.warn(`\n[tests] Genealogie-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const G = L.genealogy;
const personById = new Map(data.persons.map((p) => [p.id, p]));
const inFamily = (id: string, key: "A" | "B" | "C" | "D") => personById.get(id)?.familyKeys.includes(key) ?? false;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}
async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof ServiceError && err.code === code);
}

describe.skipIf(Boolean(skipReason))("Genealogie-Erweiterung (Mock-Datenbank)", () => {
  const createdPersons: string[] = [];
  const createdBatches: string[] = [];
  const createdSources: string[] = [];
  const startedAt = new Date();
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "genealogy-media-test-"));
    process.env.MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
    await prisma.source.deleteMany({ where: { id: { in: createdSources } } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: createdBatches } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: createdBatches } } });
    await prisma.event.deleteMany({ where: { createdAt: { gte: startedAt }, id: { notIn: data.events.map((e) => e.id) } } });
    await prisma.personName.deleteMany({ where: { createdAt: { gte: startedAt }, id: { notIn: data.personNames.map((n) => n.id) } } });
    await prisma.auditLog.deleteMany({
      where: { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-editor", "mock-user-viewer"] } },
    });
    await prisma.$disconnect();
  });

  describe("Lesen und Sichtbarkeit", () => {
    it("Personendetail: Ereignisse sortiert, Namen, Orte und Beziehungsereignisse", async () => {
      const admin = await scope("admin@example.test");
      const d = (await getPersonDetail(admin, G.eventsPerson))!;
      const types = d.events.map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(["BAPTISM", "OCCUPATION"]));
      expect(d.events.find((e) => e.type === "OCCUPATION")!.value).toBe("Bäckermeister");
      expect(d.person.nickname).toBe("Hein");
      const marriage = d.partners.find((r) => r.relationshipId === L.citedMarriage)!;
      expect(marriage.events.map((e) => e.id)).toContain(G.relationshipEvent);

      const withNames = (await getPersonDetail(admin, G.namesPerson))!;
      expect(withNames.names[0]).toMatchObject({ type: "VARIANT", familyName: "Wagener" });

      const range = (await getEvent(admin, G.rangeEvent))!;
      expect(range.dateQualifier).toBe("BETWEEN");
      expect(range.dateText).toMatch(/^zwischen \d{4} und \d{4}$/);
      const phrase = (await getEvent(admin, G.phraseEvent))!;
      expect(phrase.date).toBeNull();
      expect(phrase.dateText).toBe("Palmsonntag, Jahr unbekannt");
    });

    it("Unsichtbare Träger: Ereignisse und Rohdaten gelten als nicht vorhanden", async () => {
      const viewer = await scope("viewer@example.test");
      const onlyD = data.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
      expect(await listPersonEvents(viewer, L.founders.D)).toBeNull();
      expect(await listRawRecords(viewer, { personId: onlyD.id })).toBeNull();
      const dEvent = data.events.find((e) => e.personId === L.founders.D)!;
      expect(await getEvent(viewer, dEvent.id)).toBeNull();
      const nobody = await scope("nofamily@example.test");
      expect(await listPersonEvents(nobody, G.eventsPerson)).toBeNull();
      // Batch-Rohdaten nur für Admins.
      expect(await listRawRecords(viewer, { batchId: "egal" })).toBeNull();
    });

    it("Zeitleisten enthalten Ereignisse (ohne Alternativen) und Heiratsorte", async () => {
      const admin = await scope("admin@example.test");
      const t = (await getPersonTimeline(admin, G.eventsPerson))!;
      const stored = t.events.filter((e) => e.kind === "event");
      expect(stored.map((e) => e.eventType)).toContain("BAPTISM");
      expect(stored.map((e) => e.eventId)).toContain(G.relationshipEvent);
      const dates = t.events.map((e) => e.date);
      expect([...dates].sort()).toEqual(dates);

      const alt = (await getPersonTimeline(admin, L.impreciseDates.about))!;
      expect(alt.events.some((e) => e.eventId === G.alternativeBirth)).toBe(false);

      const fam = (await getFamilyTimeline(admin, "mock-family-a", { limit: 1000 }))!;
      expect(fam.events.some((e) => e.kind === "event" && e.dateTo)).toBe(true);
      const withPlace = data.relationships.find((r) => r.id === G.marriageWithPlace)!;
      const famOfMarriage = personById.get(withPlace.fromPersonId)!.familyKeys[0];
      const famTl = (await getFamilyTimeline(admin, `mock-family-${famOfMarriage.toLowerCase()}`, { limit: 1000 }))!;
      expect(famTl.events.find((e) => e.relationshipId === withPlace.id && e.kind === "marriage")?.place).toBe(withPlace.startPlace);
    });

    it("Suche findet Personen über Ereignis- und Heiratsorte sowie weitere Namen", async () => {
      const admin = await scope("admin@example.test");
      const residence = data.events.find((e) => e.type === "RESIDENCE")!;
      const byEvent = await searchPersons(admin, { place: "Lister Meile" });
      expect(byEvent.items.map((p) => p.id)).toEqual([residence.personId]);

      const marriage = data.relationships.find((r) => r.id === G.marriageWithPlace)!;
      const atPlace = await searchPersons(admin, { place: marriage.startPlace! });
      expect(atPlace.items.map((p) => p.id)).toEqual(expect.arrayContaining([marriage.fromPersonId, marriage.toPersonId]));

      expect((await searchPersons(admin, { q: "Wagener" })).items.map((p) => p.id)).toEqual([G.namesPerson]);
      expect((await searchPersons(admin, { q: "Hein" })).items.map((p) => p.id)).toContain(G.eventsPerson);
      // Sichtbarkeit bleibt: Betrachter A findet die Person aus C nicht über ihren Namen.
      const viewer = await scope("viewer@example.test");
      if (!inFamily(G.namesPerson, "A")) expect((await searchPersons(viewer, { q: "Wagener" })).total).toBe(0);
    });

    it("Datenlücken an Beziehungen: Ehe ohne Ort, Ehestand unbekannt", async () => {
      const admin = await scope("admin@example.test");
      const gaps = await findDataGaps(admin, { limit: 1000 });
      const noPlace = gaps.relationshipGaps.items.marriageWithoutPlace.map((i) => i.relationshipId);
      expect(noPlace).toContain(G.marriageWithoutPlace);
      expect(noPlace).not.toContain(G.marriageWithPlace);
      expect(G.unknownStatus.length).toBeGreaterThan(0);
      expect(gaps.relationshipGaps.items.partnershipUnknownStatus.map((i) => i.relationshipId).sort()).toEqual([...G.unknownStatus].sort());
      // Bisherige Lückenarten unverändert.
      expect(Object.keys(gaps.counts)).toHaveLength(10);

      const viewer = await scope("viewer@example.test");
      const vg = await findDataGaps(viewer, { limit: 1000 });
      for (const item of [...vg.relationshipGaps.items.marriageWithoutPlace, ...vg.relationshipGaps.items.partnershipUnknownStatus]) {
        expect(item.persons.some((p) => !p.restricted)).toBe(true);
        for (const p of item.persons) if (!p.restricted) expect(inFamily(p.id, "A")).toBe(true);
      }
    });

    it("Mock-Ereignisse lösen keine Plausibilitätsmeldung aus", async () => {
      const admin = await scope("admin@example.test");
      const r = await findInconsistencies(admin, { kinds: ["burialBeforeDeath", "eventBeforeBirth", "eventAfterDeath"], limit: 100 });
      expect(r.total).toBe(0);
    });
  });

  describe("Ereignisse, Namen, Orte ändern", () => {
    it("Ereignis an Person: anlegen, ändern, Beleg, löschen; Rechte", async () => {
      const editor = await scope("editor@example.test");
      const viewer = await scope("viewer@example.test");
      const p = await createPerson(editor, { givenName: "Gen-Test", familyName: "Ereignis", birthDate: "12.03.1900", deathDate: "01.02.1970" });
      createdPersons.push(p.id);

      await expectServiceError(createEvent(viewer, { personId: p.id, type: "BAPTISM" }), "FORBIDDEN");
      await expectServiceError(createEvent(editor, { personId: p.id, type: "ENGAGEMENT" }), "VALIDATION");
      await expectServiceError(createEvent(editor, { personId: p.id, type: "BIRTH" }), "VALIDATION");
      await expectServiceError(createEvent(editor, { personId: p.id, type: "CUSTOM" }), "VALIDATION");
      await expectServiceError(createEvent(editor, { personId: "gibt-es-nicht", type: "BAPTISM" }), "NOT_FOUND");

      const e = await createEvent(editor, { personId: p.id, type: "RESIDENCE", date: "von 1920 bis 1930", place: "Celle", datePhrase: "laut Adressbuch" });
      expect(e).toMatchObject({ dateQualifier: "PERIOD", place: "Celle", canEdit: true, datePhrase: "laut Adressbuch" });
      // Datum unverändert mitgeschickt: Wortlaut bleibt; geändert: Wortlaut weg.
      expect((await updateEvent(editor, e.id, { date: "von 1920 bis 1930", value: "Hauptstr. 1" })).datePhrase).toBe("laut Adressbuch");
      expect((await updateEvent(editor, e.id, { date: "ab 1921" })).datePhrase).toBeNull();
      await expectServiceError(updateEvent(viewer, e.id, { place: "X" }), "FORBIDDEN");

      // Alternative Geburt erlaubt, CUSTOM mit Bezeichnung.
      await createEvent(editor, { personId: p.id, type: "BIRTH", isAlternative: true, date: "1901" });
      await createEvent(editor, { personId: p.id, type: "CUSTOM", label: "Goldene Konfirmation", date: "1964" });

      // Beerdigung vor dem Tod → Plausibilitätsmeldung an genau diesem Ereignis.
      const burial = await createEvent(editor, { personId: p.id, type: "BURIAL", date: "01.01.1970" });
      const issues = await findInconsistencies(editor, { personId: p.id });
      expect(issues.items.find((i) => i.kind === "burialBeforeDeath")?.eventIds).toEqual([burial.id]);

      // Beleg an einem Ereignis: Träger wird übernommen, Fakt EVENT.
      const src = await prisma.source.create({ data: { title: "Gen-Test Adressbuch", createdById: "mock-user-editor" } });
      createdSources.push(src.id);
      const c = await createCitation(editor, { sourceId: src.id, eventId: e.id, detail: "S. 12", text: "Abschrift" });
      expect(c).toMatchObject({ eventId: e.id, personId: p.id, relationshipId: null, fact: "EVENT", text: "Abschrift" });
      await expectServiceError(createCitation(editor, { sourceId: src.id, eventId: e.id, fact: "BIRTH" }), "VALIDATION");
      await expectServiceError(createCitation(viewer, { sourceId: src.id, eventId: e.id }), "FORBIDDEN");

      const detail = (await getPersonDetail(viewer, p.id))!;
      expect(detail.events.every((x) => !x.canEdit)).toBe(true);
      expect(detail.citations.find((x) => x.id === c.id)?.eventId).toBe(e.id);

      await deleteEvent(editor, e.id);
      expect(await prisma.citation.count({ where: { id: c.id } })).toBe(0);
      const audit = await prisma.auditLog.findMany({ where: { entityType: "Event", entityId: e.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(["CREATE", "DELETE", "UPDATE", "UPDATE"]);
    });

    it("Ereignisse an Beziehungen: familienübergreifend und gesperrte Seite", async () => {
      const editor = await scope("editor@example.test");
      const viewer = await scope("viewer@example.test");

      // Ehe A–(A,B): Editor bearbeitet A → darf.
      const cross = data.relationships.find(
        (r) => r.type === "PARTNER_OF" && [r.fromPersonId, r.toPersonId].includes(L.crossMarriedIntoA) && [r.fromPersonId, r.toPersonId].includes(L.crossMarriedPartnerA),
      )!;
      const e = await createEvent(editor, { relationshipId: cross.id, type: "MARRIAGE_BANNS", date: "1930" });
      await expectServiceError(createEvent(viewer, { relationshipId: cross.id, type: "MARRIAGE_BANNS" }), "FORBIDDEN");
      expect((await listRelationshipEvents(viewer, cross.id))!.map((x) => x.id)).toContain(e.id);

      // Eltern-Kind-Beziehung über die Familiengrenze (Elternteil nur B, Editor liest B): erlaubt.
      const inLaw = data.relationships.find((r) => r.type === "PARENT_OF" && r.fromPersonId === L.inLawOnlyB && r.toPersonId === L.crossMarriedIntoA)!;
      const custom = await createEvent(editor, { relationshipId: inLaw.id, type: "CUSTOM", label: "Patenschaft" });
      await expectServiceError(createEvent(editor, { relationshipId: inLaw.id, type: "ENGAGEMENT" }), "VALIDATION");
      // Betrachter A sieht die Beziehung (eine Seite sichtbar), aber nicht zum Ändern.
      expect((await listRelationshipEvents(viewer, inLaw.id))!.find((x) => x.id === custom.id)?.canEdit).toBe(false);

      // Adoptivkind mit leiblicher Mutter ohne Familie: sichtbar, aber nicht änderbar.
      const bio = data.relationships.find((r) => r.type === "PARENT_OF" && r.fromPersonId === L.biologicalMotherNoFamily)!;
      if (inFamily(bio.toPersonId, "A")) {
        await expectServiceError(createEvent(editor, { relationshipId: bio.id, type: "CUSTOM", label: "x" }), "FORBIDDEN");
      }
      // Beziehung nur in D: für den Editor nicht vorhanden.
      const onlyD = data.relationships.find(
        (r) => [r.fromPersonId, r.toPersonId].every((id) => personById.get(id)!.familyKeys.join() === "D"),
      )!;
      await expectServiceError(createEvent(editor, { relationshipId: onlyD.id, type: "CUSTOM", label: "x" }), "NOT_FOUND");
      expect(await listRelationshipEvents(editor, onlyD.id)).toBeNull();

      await deleteEvent(editor, e.id);
      await deleteEvent(editor, custom.id);
    });

    it("Heiratsort, Wortlaut, Todesursache, Ehestand unbekannt, Namensvarianten", async () => {
      const editor = await scope("editor@example.test");
      const a = await createPerson(editor, { givenName: "Gen-Test", familyName: "Ort", deathDate: "1990", deathCause: "Unfall", birthDatePhrase: "Weihnachten" });
      const b = await createPerson(editor, { givenName: "Gen-Test", familyName: "Ort2" });
      createdPersons.push(a.id, b.id);
      expect(a).toMatchObject({ deathCause: "Unfall", birthDatePhrase: "Weihnachten", birthDate: null });

      const { createRelationship } = await import("@/lib/services");
      const r = await createRelationship(editor, {
        type: "PARTNER_OF",
        subtype: "PARTNER_UNKNOWN",
        fromPersonId: a.id,
        toPersonId: b.id,
        startDate: "zwischen 1950 und 1952",
        startPlace: "Celle",
      });
      expect(r).toMatchObject({ subtype: "PARTNER_UNKNOWN", startPlace: "Celle", startDateQualifier: "BETWEEN" });
      expect(r.startDateTo).toBe("1952-01-01T00:00:00.000Z");
      const u = await updateRelationship(editor, r.id, { subtype: "MARRIED", endPlace: "Hannover" });
      expect(u).toMatchObject({ subtype: "MARRIED", startPlace: "Celle", endPlace: "Hannover" });

      const tl = (await getPersonTimeline(editor, a.id))!;
      expect(tl.events.find((e) => e.kind === "marriage")?.dateText).toBe("zwischen 1950 und 1952");

      // Wortlaut bleibt bei unverändertem Datum, fällt bei Änderung.
      expect((await updatePerson(editor, a.id, { birthDate: "" })).birthDatePhrase).toBe("Weihnachten");
      expect((await updatePerson(editor, a.id, { birthDate: "1920" })).birthDatePhrase).toBeNull();

      const viewer = await scope("viewer@example.test");
      await expectServiceError(createPersonName(viewer, { personId: a.id, familyName: "X" }), "FORBIDDEN");
      await expectServiceError(createPersonName(editor, { personId: a.id }), "VALIDATION");
      const n = await createPersonName(editor, { personId: a.id, type: "MARRIED", familyName: "Ortmann" });
      expect((await updatePersonName(editor, n.id, { prefix: "Dr." })).display).toBe("Dr. Ortmann");
      expect((await getPersonDetail(viewer, a.id))!.names.map((x) => x.id)).toEqual([n.id]);
      await deletePersonName(editor, n.id);
    });
  });

  describe("Massenimport", () => {
    it("nur Administratoren; Lauf mit Originaldatei", async () => {
      const editor = await scope("editor@example.test");
      await expectServiceError(applyGenealogyImport(editor, { persons: [] }), "FORBIDDEN");
      await expectServiceError(createImportBatch(editor, { format: "GEDCOM", fileName: "x.ged" }, Buffer.from("0 HEAD")), "FORBIDDEN");

      const admin = await scope("admin@example.test");
      // Zu große Datei: Eingabefehler, keine Rechtefrage (ohne 200 MB anzulegen —
      // geprüft wird nur die Länge, bevor irgendetwas gelesen wird).
      const huge = { byteLength: MAX_IMPORT_FILE_BYTES + 1 } as Uint8Array;
      await expectServiceError(createImportBatch(admin, { format: "GEDCOM", fileName: "riesig.ged" }, huge), "VALIDATION");

      const content = Buffer.from("0 HEAD\n1 SOUR TEST\n0 TRLR\n");
      const batch = await createImportBatch(admin, { format: "GEDCOM", fileName: "stand1.ged", sourceTreeId: "gen-test-tree", sourceSystem: "TEST" }, content);
      createdBatches.push(batch.id);
      expect(batch).toMatchObject({ status: "PENDING", hasFile: true, fileSizeBytes: content.length });
      expect((await readImportBatchFile(admin, batch.id))!.equals(content)).toBe(true);
      expect(await readdir(path.join(mediaDir, "imports"))).toEqual([`${batch.id}.ged`]);
      expect((await listImportBatches(admin, { fileSha256: batch.fileSha256 })).map((b) => b.id)).toEqual([batch.id]);
    });

    it("anlegen, wiedererkennen, nur Unverändertes aktualisieren, Rohdaten ersetzen", async () => {
      const admin = await scope("admin@example.test");
      const b1 = await createImportBatch(admin, { format: "GEDCOM", fileName: "stand1.ged", sourceTreeId: "gen-test-tree-2" }, Buffer.from("eins"));
      createdBatches.push(b1.id);

      const first = await applyGenealogyImport(admin, {
        batchId: b1.id,
        familyIds: ["mock-family-a"],
        persons: [
          { ref: "@I1@", givenName: "Gen-Import", familyName: "Vater", gender: "MALE", birth: { date: "1850", qualifier: "BETWEEN", to: "1852" }, externalKey: "UID:1" },
          { ref: "@I2@", givenName: "Gen-Import", familyName: "Mutter", gender: "FEMALE", birth: { phrase: "Lichtmess 1855" }, externalKey: "UID:2" },
          { ref: "@I3@", givenName: "Gen-Import", familyName: "Kind", birth: { date: "1880-05-01" }, externalKey: "UID:3" },
        ],
        names: [{ ref: "@I2@/NAME2", personRef: "@I2@", type: "MARRIED", familyName: "Gen-Importfrau" }],
        relationships: [
          { ref: "@F1@", type: "PARTNER_OF", subtype: "PARTNER_UNKNOWN", fromRef: "@I2@", toRef: "@I1@", startPlace: "Celle" },
          { ref: "@F1@/@I3@/1", type: "PARENT_OF", fromRef: "@I1@", toRef: "@I3@" },
          { ref: "@F1@/@I3@/2", type: "PARENT_OF", fromRef: "@I2@", toRef: "@I3@" },
        ],
        events: [
          { ref: "@I1@/OCCU", personRef: "@I1@", type: "OCCUPATION", value: "Müller", date: { date: "1880" } },
          { ref: "@I1@/BIRT#2", personRef: "@I1@", type: "BIRTH", isAlternative: true, date: { date: "1849" } },
          { ref: "@F1@/ENGA", relationshipRef: "@F1@", type: "ENGAGEMENT", date: { date: "1874" } },
          { ref: "@I3@/EVEN", personRef: "@I3@", type: "CUSTOM", label: "Auswanderung nach Brasilien (geplant)" },
        ],
        sources: [{ ref: "@S1@", title: "Gen-Import Kirchenbuch", kind: "CHURCH_BOOK" }],
        citations: [{ ref: "@I1@/OCCU/SOUR", sourceRef: "@S1@", eventRef: "@I1@/OCCU", detail: "S. 3" }],
        externalIds: [
          { system: "UID", value: "gen-test-uid-1", personRef: "@I1@" },
          { system: "GEDCOM_XREF", value: "@F1@", relationshipRef: "@F1@" },
        ],
        rawRecords: [{ recordType: "INDI._MYTAG", personRef: "@I1@", content: { tag: "_MYTAG", value: "unbekannt" }, reason: "unbekannter Tag" }],
      });
      const I1 = first.ids.persons["@I1@"];
      const I3 = first.ids.persons["@I3@"];
      createdPersons.push(...Object.values(first.ids.persons));
      createdSources.push(...Object.values(first.ids.sources));
      expect(first.counts.persons.created).toBe(3);
      expect(first.counts.relationships.created).toBe(3);
      expect(first.counts.events.created).toBe(4);
      expect(first.counts).toMatchObject({ externalIds: 2, rawRecords: 1, supersededRawRecords: 0 });
      const vater = await prisma.person.findUniqueOrThrow({ where: { id: I1 }, include: { families: true } });
      expect(vater).toMatchObject({ birthDateQualifier: "BETWEEN", birthDatePrecision: "YEAR" });
      expect(vater.families.map((f) => f.familyId)).toEqual(["mock-family-a"]);
      const cit = await prisma.citation.findUniqueOrThrow({ where: { id: first.ids.citations["@I1@/OCCU/SOUR"] } });
      expect(cit).toMatchObject({ personId: I1, fact: "EVENT", eventId: first.ids.events["@I1@/OCCU"] });
      expect((await findExternalIds(admin, { system: "UID", values: ["gen-test-uid-1"] }))[0]).toMatchObject({ entityType: "PERSON", entityId: I1 });

      // Rohdaten folgen der Sichtbarkeit der Person (Familie A).
      const viewer = await scope("viewer@example.test");
      expect((await listRawRecords(viewer, { personId: I1 }))!.map((r) => r.recordType)).toEqual(["INDI._MYTAG"]);

      // Herkunft: alles unverändert.
      const links = await listImportLinks(admin, { sourceTreeId: "gen-test-tree-2" });
      expect(links.length).toBe(3 + 1 + 3 + 4 + 1 + 1);
      expect(links.every((l) => !l.editedSinceImport)).toBe(true);

      // In der App ändern: Kind bekommt einen anderen Vornamen.
      const editor = await scope("editor@example.test");
      await updatePerson(editor, I3, { givenName: "Gen-Import-geändert" });
      const after = await listImportLinks(admin, { sourceTreeId: "gen-test-tree-2", entityTypes: ["PERSON"] });
      expect(after.filter((l) => l.editedSinceImport).map((l) => l.entityId)).toEqual([I3]);

      // Zweiter Stand: Vater geändert in der Quelle, Kind auch — nur Unverändertes wird übernommen.
      const b2 = await createImportBatch(admin, { format: "GEDCOM", fileName: "stand2.ged", sourceTreeId: "gen-test-tree-2" }, Buffer.from("zwei"));
      createdBatches.push(b2.id);
      const second = await applyGenealogyImport(admin, {
        batchId: b2.id,
        persons: [
          { ref: "@I1@", action: "updateIfUnchanged", id: I1, givenName: "Gen-Import", familyName: "Vater", gender: "MALE", birth: { date: "1851" } },
          { ref: "@I2@", action: "updateIfUnchanged", id: first.ids.persons["@I2@"], givenName: "Gen-Import", familyName: "Mutter", gender: "FEMALE", birth: { phrase: "Lichtmess 1855" } },
          { ref: "@I3@", action: "updateIfUnchanged", id: I3, givenName: "Gen-Import", familyName: "Kind-neu", birth: { date: "1880-05-01" } },
        ],
        events: [{ ref: "@I3@/RESI", personRef: "@I3@", type: "RESIDENCE", place: "Gen-Import-Ort" }],
        rawRecords: [{ recordType: "INDI._MYTAG", personRef: "@I1@", content: { tag: "_MYTAG", value: "neu" } }],
      });
      expect(second.outcomes.persons).toEqual({ "@I1@": "updated", "@I2@": "unchanged", "@I3@": "skippedEdited" });
      expect(second.ids.persons["@I3@"]).toBe(I3);
      expect(second.counts.events.created).toBe(1);
      expect(second.counts.supersededRawRecords).toBe(1);
      expect((await prisma.person.findUniqueOrThrow({ where: { id: I1 } })).birthDatePrecision).toBe("YEAR");
      expect((await prisma.person.findUniqueOrThrow({ where: { id: I3 } })).givenName).toBe("Gen-Import-geändert");
      const raw = (await listRawRecords(admin, { personId: I1 }, { includeSuperseded: true }))!;
      expect(raw.map((r) => [r.superseded, (r.content as { value: string }).value]).sort()).toEqual([
        [false, "neu"],
        [true, "unbekannt"],
      ]);
      const vaterLink = (await listImportLinks(admin, { batchId: b2.id, entityTypes: ["PERSON"] })).find((l) => l.entityId === I1)!;
      expect(vaterLink).toMatchObject({ firstBatchId: b1.id, lastBatchId: b2.id, editedSinceImport: false });

      // In der Quelle entfernt: nur vermerken, nie löschen.
      const kindLink = after.find((l) => l.entityId === I3)!;
      expect((await markMissingInSource(admin, b2.id, [kindLink.linkId])).count).toBe(1);
      expect(await prisma.person.count({ where: { id: I3 } })).toBe(1);

      // Überholte Rohdaten bewusst entfernen.
      expect((await pruneRawRecords(admin, { supersededOnly: true, batchId: b1.id })).count).toBe(1);
    });

    it("ungültige Einträge: werfen bzw. samt Abhängigen überspringen", async () => {
      const admin = await scope("admin@example.test");
      const input = {
        familyIds: ["mock-family-a"],
        persons: [
          { ref: "ok", givenName: "Gen-Import-OK" },
          { ref: "bad", givenName: "Gen-Import-Bad", birth: { date: "1900" }, death: { date: "1850" } },
        ],
        relationships: [
          { ref: "r1", type: "PARENT_OF", fromRef: "bad", toRef: "ok" },
          { ref: "r2", type: "PARTNER_OF", subtype: "BIOLOGICAL", fromRef: "ok", toId: L.founders.A },
          { ref: "r3", type: "PARENT_OF", fromId: L.founders.A, toRef: "ok" },
        ],
        events: [{ ref: "e1", personRef: "bad", type: "BAPTISM" }],
        rawRecords: [{ recordType: "X", personRef: "ok", content: "x".repeat(300 * 1024) }],
      };
      await expectServiceError(applyGenealogyImport(admin, input), "VALIDATION");
      expect(await prisma.person.count({ where: { givenName: { startsWith: "Gen-Import-" }, familyName: null } })).toBe(0);

      const r = await applyGenealogyImport(admin, input, { onInvalid: "skip" });
      createdPersons.push(...Object.values(r.ids.persons));
      expect(r.outcomes.persons).toEqual({ ok: "created", bad: "invalid" });
      expect(r.outcomes.relationships).toEqual({ r1: "invalid", r2: "invalid", r3: "created" });
      expect(r.outcomes.events).toEqual({ e1: "invalid" });
      expect(r.invalid.some((i) => i.section === "rawRecords")).toBe(true);
      expect(r.counts.rawRecords).toBe(0);
    });

    it("Leistung: 500 Personen mit Beziehungen und Ereignissen in wenigen Sekunden", async () => {
      const admin = await scope("admin@example.test");
      const n = 500;
      const persons = Array.from({ length: n }, (_, i) => ({ ref: `p${i}`, givenName: `Gen-Last-${i}`, birth: { date: String(1700 + (i % 200)) } }));
      const relationships = Array.from({ length: n - 1 }, (_, i) => ({ ref: `r${i}`, type: "PARENT_OF" as const, fromRef: `p${i}`, toRef: `p${i + 1}` }));
      const events = persons.map((p, i) => ({ ref: `e${i}`, personRef: p.ref, type: "OCCUPATION" as const, value: "Bauer" }));
      const t0 = Date.now();
      const r = await applyGenealogyImport(admin, { persons, relationships: relationships.slice(0, 50), events });
      const ms = Date.now() - t0;
      createdPersons.push(...Object.values(r.ids.persons));
      expect(r.counts.persons.created).toBe(n);
      expect(r.counts.events.created).toBe(n);
      expect(ms).toBeLessThan(15_000);
      console.log(`[tests] Massenimport ${n} Personen + ${n} Ereignisse + 50 Beziehungen: ${ms} ms`);
    });
  });
});
