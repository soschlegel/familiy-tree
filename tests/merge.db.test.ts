/**
 * Dubletten zusammenführen gegen die Testdatenbank: Rechte, kein stiller
 * Datenverlust (alles an beiden Personen ist danach an der bleibenden, ist
 * in einen gleichwertigen Eintrag aufgegangen oder steht ausdrücklich unter
 * „verworfen“), Blockaden, doppeltes Absenden, erneuter Import beider
 * Quell-Bäume nach dem Zusammenführen (nichts neu, nichts fehlt), Dublette
 * innerhalb eines Baums, GEDCOM-Export danach. Nur erfundene Namen; räumt
 * auf. Überspringt sich ohne Datenbank.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { applyGenealogyImport, createPerson, createRelationship, scopeForEmail, ServiceError } from "@/lib/services";
import { mergePersons, previewPersonMerge } from "@/lib/services/merge";
import { applyGedcomImport, listGedcomPlanItems, startGedcomImport } from "@/lib/services/gedcom-import";
import { buildGedcomExport } from "@/lib/services/gedcom-export";
import { parseGedcom } from "@/lib/gedcom";
import { citationKey, eventKey, personNameKey } from "@/lib/merge-rules";
import { REJECTED_RAW_SUFFIX } from "@/lib/services/import-apply";
import { overlappingPair, randomSurname, treeWithInnerDuplicate, treeWithRejectedFamily } from "./merge-fixtures";

async function dbReady(): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    return admin ? null : "Testdatenbank ist leer — bitte `npm run mock:setup` ausführen.";
  } catch (err) {
    return `Testdatenbank nicht erreichbar (${(err as Error).message.split("\n").pop()}).`;
  }
}
const skipReason = await dbReady();
if (skipReason) console.warn(`\n[tests] Zusammenführen-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";
const FAMILY_B = "mock-family-b";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe(code);
    return err as ServiceError;
  }
  throw new Error(`erwartet: ${code}`);
}

/** Alles, was an einer Person (und ihren Beziehungen) hängt. */
async function attached(personId: string) {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const rels = await prisma.relationship.findMany({ where: { OR: [{ fromPersonId: personId }, { toPersonId: personId }] } });
  const relIds = rels.map((r) => r.id);
  return {
    person,
    families: (await prisma.personFamily.findMany({ where: { personId } })).map((f) => f.familyId),
    names: await prisma.personName.findMany({ where: { personId } }),
    events: await prisma.event.findMany({ where: { OR: [{ personId }, { relationshipId: { in: relIds } }] } }),
    citations: await prisma.citation.findMany({ where: { OR: [{ personId }, { relationshipId: { in: relIds } }] } }),
    media: await prisma.personMedia.findMany({ where: { personId } }),
    externalIds: await prisma.externalId.findMany({ where: { personId } }),
    rawRecords: await prisma.importRawRecord.findMany({ where: { personId } }),
    links: await prisma.importLink.findMany({ where: { personId } }),
    relationships: rels,
  };
}

describe.skipIf(Boolean(skipReason))("Dubletten zusammenführen (Testdatenbank)", () => {
  const persons: string[] = [];
  const sources: string[] = [];
  const families: string[] = [];
  const media: string[] = [];
  const trees: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "merge-test-"));
    process.env.MEDIA_DIR = mediaDir;
    admin = await scope("admin@example.test");
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    const links = await prisma.importLink.findMany({ where: { sourceTreeId: { in: trees } }, select: { personId: true, sourceId: true } });
    await prisma.person.deleteMany({ where: { id: { in: [...persons, ...links.map((l) => l.personId).filter((x): x is string => Boolean(x))] } } });
    await prisma.source.deleteMany({ where: { id: { in: [...sources, ...links.map((l) => l.sourceId).filter((x): x is string => Boolean(x))] } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: media } } });
    const batches = await prisma.importBatch.findMany({ where: { sourceTreeId: { in: trees } }, select: { id: true } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((b) => b.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  });

  /** Zwei „Bäume“ über den Massenimport, mit allem, was an Personen hängen kann. */
  async function fixture() {
    const sn = randomSurname();
    const treeA = `TEST:MERGE-A-${sn}`;
    const treeB = `TEST:MERGE-B-${sn}`;
    trees.push(treeA, treeB);
    const a = await applyGenealogyImport(admin, {
      sourceTreeId: treeA,
      familyIds: [FAMILY_A],
      persons: [
        { ref: "K", externalKey: "UID:K", givenName: "Anna", familyName: sn, gender: "FEMALE", birth: { date: "1801-04-02" }, birthPlace: "Probstadt", notes: "Notiz A" },
        { ref: "P", externalKey: "UID:P", givenName: "Karl", familyName: sn, gender: "MALE", birth: { date: "1770" } },
        { ref: "Q", externalKey: "UID:Q", givenName: "Fritz", familyName: "Wendtner", gender: "MALE", birth: { date: "1798" } },
      ],
      relationships: [
        { ref: "PK", externalKey: "FAM:1/K", type: "PARENT_OF", fromRef: "P", toRef: "K" },
        { ref: "KQ", externalKey: "FAM:2", type: "PARTNER_OF", subtype: "MARRIED", fromRef: "K", toRef: "Q", start: { date: "1825" }, startPlace: "Probstadt" },
      ],
      names: [{ ref: "NK", externalKey: "N:K", personRef: "K", type: "ALIAS", givenName: "Anni" }],
      events: [
        { ref: "EK1", externalKey: "E:K1", personRef: "K", type: "OCCUPATION", value: "Näherin" },
        { ref: "EKQ", externalKey: "E:KQ", relationshipRef: "KQ", type: "ENGAGEMENT", date: { date: "1824" } },
      ],
      sources: [{ ref: "S", externalKey: "S:1", title: `Kirchenbuch ${sn}` }],
      citations: [
        { ref: "CK", externalKey: "C:K", sourceRef: "S", personRef: "K", fact: "BIRTH", detail: "S. 7" },
        { ref: "CE", externalKey: "C:E", sourceRef: "S", eventRef: "EK1", detail: "S. 9" },
      ],
      externalIds: [{ system: "UID", value: `K-${sn}`, personRef: "K" }],
      rawRecords: [{ recordType: "INDI", personRef: "K", content: { tag: "_A" } }],
    });
    const K = a.ids.persons.K;
    const Q = a.ids.persons.Q;
    const S = a.ids.sources.S;
    sources.push(S);
    const b = await applyGenealogyImport(admin, {
      sourceTreeId: treeB,
      familyIds: [FAMILY_B],
      persons: [
        {
          ref: "X",
          externalKey: "UID:X",
          givenName: "Anna",
          familyName: "Wendtner",
          birthName: sn,
          gender: "FEMALE",
          birth: { date: "1801", qualifier: "ABOUT" },
          death: { date: "1870-01-05" },
          deathPlace: "Musterdorf",
          notes: "Notiz B",
        },
        { ref: "M", externalKey: "UID:M", givenName: "Liese", familyName: sn, gender: "FEMALE" },
        { ref: "C", externalKey: "UID:C", givenName: "Paul", familyName: "Wendtner", gender: "MALE", birth: { date: "1830" } },
      ],
      relationships: [
        { ref: "MX", externalKey: "FAM:9/X", type: "PARENT_OF", fromRef: "M", toRef: "X" },
        { ref: "XQ", externalKey: "FAM:8", type: "PARTNER_OF", subtype: "PARTNER_UNKNOWN", fromRef: "X", toId: Q, start: { date: "1826" } },
        { ref: "XC", externalKey: "FAM:8/C", type: "PARENT_OF", fromRef: "X", toRef: "C" },
      ],
      names: [
        { ref: "NX", externalKey: "N:X", personRef: "X", type: "ALIAS", givenName: "Anni" },
        { ref: "NX2", externalKey: "N:X2", personRef: "X", type: "RELIGIOUS", givenName: "Maria Anna" },
      ],
      events: [
        { ref: "EX1", externalKey: "E:X1", personRef: "X", type: "OCCUPATION", value: "Näherin", notes: "aus B" },
        { ref: "EX2", externalKey: "E:X2", personRef: "X", type: "RESIDENCE", place: "Musterdorf" },
        { ref: "EXQ", externalKey: "E:XQ", relationshipRef: "XQ", type: "ENGAGEMENT", date: { date: "1824" } },
      ],
      citations: [
        { ref: "CX", externalKey: "C:X", sourceId: S, personRef: "X", fact: "BIRTH", detail: "S. 7" },
        { ref: "CX2", externalKey: "C:X2", sourceId: S, personRef: "X", fact: "DEATH", detail: "S. 70" },
        { ref: "CXE", externalKey: "C:XE", sourceId: S, eventRef: "EX1", detail: "S. 9" },
        { ref: "CXQ", externalKey: "C:XQ", sourceId: S, relationshipRef: "XQ", fact: "PARTNERSHIP", detail: "S. 30" },
      ],
      externalIds: [
        { system: "UID", value: `X-${sn}`, personRef: "X" },
        { system: "UID", value: `K-${sn}`, personRef: "X" },
      ],
      rawRecords: [{ recordType: "INDI", personRef: "X", content: { tag: "_B" } }],
    });
    const X = b.ids.persons.X;
    persons.push(K, X, Q, a.ids.persons.P, b.ids.persons.M, b.ids.persons.C);
    // Bilder: eines an beiden (je Hauptbild), eines nur an X
    const m1 = await prisma.mediaAsset.create({ data: { storageKey: `merge-test/${sn}-1.webp`, mimeType: "image/webp", sizeBytes: 1 } });
    const m2 = await prisma.mediaAsset.create({ data: { storageKey: `merge-test/${sn}-2.webp`, mimeType: "image/webp", sizeBytes: 1 } });
    media.push(m1.id, m2.id);
    await prisma.personMedia.createMany({
      data: [
        { personId: K, mediaId: m1.id, isPrimary: true },
        { personId: X, mediaId: m1.id, isPrimary: true },
        { personId: X, mediaId: m2.id, isPrimary: false },
      ],
    });
    return { sn, K, X, Q, S, treeA, treeB, C: b.ids.persons.C, M: b.ids.persons.M, P: a.ids.persons.P };
  }

  it("Rechte: Betrachter und Editor ohne Recht an beiden dürfen nicht; Unsichtbares ist „nicht gefunden“", async () => {
    const editor = await scope("editor@example.test");
    const viewer = await scope("viewer@example.test");
    const a1 = await createPerson(editor, { givenName: "Recht", familyName: "Probe", familyIds: [FAMILY_A] });
    const a2 = await createPerson(editor, { givenName: "Recht", familyName: "Probe", familyIds: [FAMILY_A] });
    const b1 = await createPerson(admin, { givenName: "Recht", familyName: "Probe", familyIds: [FAMILY_B] });
    const c1 = await createPerson(admin, { givenName: "Recht", familyName: "Probe", familyIds: ["mock-family-c"] });
    persons.push(a1.id, a2.id, b1.id, c1.id);
    await expectCode(previewPersonMerge(viewer, a1.id, a2.id), "FORBIDDEN");
    await expectCode(mergePersons(viewer, { keepId: a1.id, mergeId: a2.id }), "FORBIDDEN");
    await expectCode(previewPersonMerge(editor, a1.id, b1.id), "FORBIDDEN");
    await expectCode(previewPersonMerge(editor, a1.id, c1.id), "NOT_FOUND");
    await expectCode(mergePersons(editor, { keepId: c1.id, mergeId: a1.id }), "NOT_FOUND");
    const p = await previewPersonMerge(editor, a1.id, a2.id);
    expect(p.canMerge).toBe(true);
    const r = await mergePersons(editor, { keepId: a1.id, mergeId: a2.id, expectedToken: p.token });
    expect(r.alreadyMerged).toBe(false);
    // Doppeltes Absenden: gespeichertes Ergebnis statt Fehler
    const again = await mergePersons(editor, { keepId: a1.id, mergeId: a2.id });
    expect(again.alreadyMerged).toBe(true);
    expect(await prisma.person.findUnique({ where: { id: a2.id } })).toBeNull();
  });

  it("kein stiller Datenverlust: jedes Teil ist danach an der bleibenden Person, aufgegangen oder als verworfen benannt", async () => {
    const f = await fixture();
    const before = { keep: await attached(f.K), other: await attached(f.X) };

    const preview = await previewPersonMerge(admin, f.K, f.X);
    expect(preview.canMerge).toBe(true);
    // Vorgaben: Ehename aus X, Geburtsname gesetzt; genaues Geburtsdatum bleibt; Tod von X
    expect(preview.fields.find((x) => x.field === "familyName")!.choice).toBe("other");
    expect(preview.fields.find((x) => x.field === "birthDate")!.choice).toBe("keep");
    expect(preview.summary.sentences.join(" ")).toContain("Partnerschaft");
    const result = await mergePersons(admin, { keepId: f.K, mergeId: f.X, expectedToken: preview.token });
    const after = await attached(f.K);

    expect(await prisma.person.findUnique({ where: { id: f.X } })).toBeNull();
    // Hauptangaben
    expect(after.person).toMatchObject({ givenName: "Anna", familyName: "Wendtner", birthName: f.sn, birthPlace: "Probstadt", deathPlace: "Musterdorf" });
    expect(after.person.birthDate!.toISOString()).toBe("1801-04-02T00:00:00.000Z");
    expect(after.person.notes).toContain("Notiz A");
    expect(after.person.notes).toContain("Notiz B");
    // keine überflüssige Namensvariante „Anna <Geburtsname>“ bzw. „Anna Wendtner“
    expect(after.names.filter((n) => n.familyName === f.sn || n.familyName === "Wendtner")).toEqual([]);

    // --- jedes Teil beider Seiten -----------------------------------------
    const dropped = result.summary.dropped;
    for (const side of [before.keep, before.other]) {
      for (const fam of side.families) expect(after.families).toContain(fam);
      for (const n of side.names) {
        expect(after.names.some((x) => x.id === n.id || personNameKey(x) === personNameKey(n)), `Name ${n.givenName}`).toBe(true);
      }
      for (const e of side.events) {
        expect(after.events.some((x) => x.id === e.id || eventKey(x) === eventKey(e)), `Ereignis ${e.type}`).toBe(true);
      }
      const evMap = new Map(side.events.map((e) => [e.id, after.events.find((x) => x.id === e.id || eventKey(x) === eventKey(e))!.id]));
      for (const c of side.citations) {
        const target = { ...c, eventId: c.eventId ? evMap.get(c.eventId) : null };
        expect(after.citations.some((x) => x.id === c.id || citationKey(x) === citationKey(target)), `Beleg ${c.detail}`).toBe(true);
      }
      for (const m of side.media) expect(after.media.some((x) => x.mediaId === m.mediaId)).toBe(true);
      for (const x of side.externalIds) expect(after.externalIds.some((y) => y.system === x.system && y.value === x.value)).toBe(true);
      for (const r of side.rawRecords) expect(after.rawRecords.some((y) => y.id === r.id)).toBe(true);
      for (const l of side.links) expect(after.links.some((y) => y.id === l.id)).toBe(true);
      for (const r of side.relationships) {
        const otherEnd = r.fromPersonId === f.K || r.fromPersonId === f.X ? r.toPersonId : r.fromPersonId;
        expect(
          after.relationships.some((y) => y.id === r.id || (y.type === r.type && (y.fromPersonId === otherEnd || y.toPersonId === otherEnd))),
          `Beziehung ${r.type}`,
        ).toBe(true);
      }
      // Hauptangaben: Wert der Seite ist im Ergebnis, eine Zweitangabe, eine Namensvariante oder verworfen
      const p = side.person;
      if (p.deathDate && after.person.deathDate?.getTime() !== p.deathDate.getTime()) {
        expect(after.events.some((e) => e.type === "DEATH" && e.isAlternative && e.date?.getTime() === p.deathDate!.getTime())).toBe(true);
      }
      if (p.birthDate && after.person.birthDate?.getTime() !== p.birthDate.getTime() && p.birthDateQualifier === "EXACT") {
        expect(after.events.some((e) => e.type === "BIRTH" && e.isAlternative)).toBe(true);
      }
      if (p.gender !== after.person.gender && p.gender !== "UNKNOWN") expect(dropped.join(" ")).toContain("Geschlecht");
    }
    // Zusammengefallen: Bild an beiden nur einmal, ein Hauptbild; gleiche Ereignisse/Namen/Belege einmal
    expect(after.media.filter((m) => m.isPrimary)).toHaveLength(1);
    expect(after.media).toHaveLength(2);
    expect(after.events.filter((e) => e.type === "OCCUPATION")).toHaveLength(1);
    expect(after.events.find((e) => e.type === "OCCUPATION")!.notes).toBe("aus B");
    expect(after.names.filter((n) => n.givenName === "Anni")).toHaveLength(1);
    expect(after.citations.filter((c) => c.fact === "BIRTH" && c.detail === "S. 7")).toHaveLength(1);
    expect(after.externalIds.filter((x) => x.value === `K-${f.sn}`)).toHaveLength(1);
    // Partnerschaft mit Fritz: eine, verheiratet, abweichende Heirat 1826 als Zweitangabe, Verlobung einmal
    const partner = after.relationships.filter((r) => r.type === "PARTNER_OF");
    expect(partner).toHaveLength(1);
    expect(partner[0].subtype).toBe("MARRIED");
    const relEvents = after.events.filter((e) => e.relationshipId === partner[0].id);
    expect(relEvents.filter((e) => e.type === "ENGAGEMENT")).toHaveLength(1);
    expect(relEvents.some((e) => e.type === "MARRIAGE" && e.isAlternative && e.date?.getUTCFullYear() === 1826)).toBe(true);
    expect(after.citations.some((c) => c.relationshipId === partner[0].id && c.detail === "S. 30")).toBe(true);
    // Eltern: Karl und Liese; Kind Paul
    expect(after.relationships.filter((r) => r.type === "PARENT_OF" && r.toPersonId === f.K).map((r) => r.fromPersonId).sort()).toEqual([f.P, f.M].sort());
    expect(after.relationships.some((r) => r.type === "PARENT_OF" && r.fromPersonId === f.K && r.toPersonId === f.C)).toBe(true);
    // Herkunft: Links beider Bäume, der übernommene mit Vermerk
    expect(new Set(after.links.map((l) => l.sourceTreeId))).toEqual(new Set([f.treeA, f.treeB]));
    expect(after.links.find((l) => l.sourceTreeId === f.treeB)!.mergedFromId).toBe(f.X);
    // Audit mit beiden IDs, Wahl und Stand der aufgegangenen Person
    const log = await prisma.auditLog.findUniqueOrThrow({ where: { id: result.auditId! } });
    expect(log).toMatchObject({ action: "MERGE", entityType: "Person", entityId: f.K });
    const diff = log.diff as { mergeId: string; choices: Record<string, string>; merged: { person: { givenName: string }; rawRecordIds: string[] } };
    expect(diff.mergeId).toBe(f.X);
    expect(diff.choices.familyName).toBe("other");
    expect(diff.merged.person.givenName).toBe("Anna");
    expect(diff.merged.rawRecordIds).toHaveLength(1);
  });

  it("Blockaden: Beziehung zwischen beiden, verschiedene leibliche Eltern (mit Vorschlag), Zyklus, Tod vor Geburt", async () => {
    const mk = async (given: string, extra: Record<string, unknown> = {}) => {
      const p = await createPerson(admin, { givenName: given, familyName: "Blockprobe", familyIds: [FAMILY_A], ...extra });
      persons.push(p.id);
      return p.id;
    };
    // verwandt
    const a = await mk("Eva");
    const b = await mk("Eva");
    await createRelationship(admin, { type: "PARTNER_OF", fromPersonId: a, toPersonId: b });
    const p1 = await previewPersonMerge(admin, a, b);
    expect(p1.canMerge).toBe(false);
    expect(p1.blockers[0].code).toBe("RELATED");
    await expectCode(mergePersons(admin, { keepId: a, mergeId: b }), "CONFLICT");

    // drei leibliche Eltern
    const [k, x, f1, m1, f2] = [await mk("Ida"), await mk("Ida"), await mk("Otto"), await mk("Olga"), await mk("Otto")];
    for (const [par, ch] of [[f1, k], [m1, k], [f2, x]]) await createRelationship(admin, { type: "PARENT_OF", fromPersonId: par, toPersonId: ch });
    const p2 = await previewPersonMerge(admin, k, x);
    const bio = p2.blockers.find((b2) => b2.code === "BIO_PARENTS")!;
    expect(bio.message).toContain("zuerst diese Eltern zusammenführen");
    expect(bio.suggestPairs).toContainEqual([f1, f2]);
    // Eltern zuerst zusammenführen → dann geht es
    await mergePersons(admin, { keepId: f1, mergeId: f2 });
    expect((await previewPersonMerge(admin, k, x)).canMerge).toBe(true);

    // Zyklus: Großvater und Enkel gleichen Namens
    const [g, s, e] = [await mk("Jakob"), await mk("Jakob"), await mk("Jakob")];
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: g, toPersonId: s });
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: s, toPersonId: e });
    expect((await previewPersonMerge(admin, g, e)).blockers.map((b3) => b3.code)).toContain("CYCLE");

    // Tod vor Geburt durch die Wahl
    const t1 = await mk("Rosa", { birthDate: "1850-01-01" });
    const t2 = await mk("Rosa", { birthDate: "1880-01-01", deathDate: "1940-01-01" });
    const p4 = await previewPersonMerge(admin, t1, t2, { choices: { birthDate: "keep", deathDate: "other" } });
    expect(p4.canMerge).toBe(true);
    const t3 = await mk("Rosa", { deathDate: "1840-01-01" });
    const p5 = await previewPersonMerge(admin, t1, t3);
    expect(p5.blockers.map((b5) => b5.code)).toContain("DATES");
  });

  async function importFile(name: string, text: string, decisions: Record<string, unknown> = {}) {
    const plan = await startGedcomImport(admin, { fileName: `test-merge-${name}.ged`, bytes: Buffer.from(text, "utf8") });
    trees.push(plan.sourceTreeId);
    const result = await applyGedcomImport(admin, plan.batchId, decisions);
    if (result.familyId) families.push(result.familyId);
    return { plan, result };
  }
  const personByUid = async (uid: string) => (await prisma.externalId.findFirstOrThrow({ where: { system: "UID", value: uid, personId: { not: null } } })).personId!;

  it("erneuter Import beider Bäume nach dem Zusammenführen: nichts neu, nichts fehlt; Gewähltes zählt beim unterlegenen Baum als geändert", async () => {
    const sn = randomSurname();
    const { a, b, fileA, fileB } = overlappingPair(sn);
    await importFile(`A-${sn}`, fileA, { family: { mode: "new", name: `Merge A ${sn}` } });
    await importFile(`B-${sn}`, fileB, { family: { mode: "new", name: `Merge B ${sn}` } });
    const hansA = await personByUid(`${a.uid}I1`);
    const mariaA = await personByUid(`${a.uid}I2`);
    const ottoA = await personByUid(`${a.uid}I3`);
    const hansB = await personByUid(`${b.uid}I7`);
    const mariaB = await personByUid(`${b.uid}I8`);
    const ottoB = await personByUid(`${b.uid}I9`);
    const count = await prisma.person.count();

    // Kind vor den Eltern: verschiedene leibliche Eltern → blockiert
    expect((await previewPersonMerge(admin, ottoA, ottoB)).blockers.map((x) => x.code)).toContain("BIO_PARENTS");
    // Eltern zuerst, dann das Kind
    await mergePersons(admin, { keepId: hansA, mergeId: hansB });
    await mergePersons(admin, { keepId: mariaA, mergeId: mariaB });
    await mergePersons(admin, { keepId: ottoA, mergeId: ottoB });
    expect(await prisma.person.count()).toBe(count - 3);
    const hans = await prisma.person.findUniqueOrThrow({ where: { id: hansA } });
    expect(hans.birthDate!.toISOString()).toBe("1850-03-12T00:00:00.000Z");
    const maria = await prisma.person.findUniqueOrThrow({ where: { id: mariaA } });
    expect(maria).toMatchObject({ familyName: sn, birthName: "Muster" });
    expect(maria.deathDate!.getUTCFullYear()).toBe(1920);
    const partner = await prisma.relationship.findMany({ where: { type: "PARTNER_OF", OR: [{ fromPersonId: hansA }, { toPersonId: hansA }] } });
    expect(partner).toHaveLength(1);
    expect(partner[0].subtype).toBe("MARRIED");
    expect(await prisma.relationship.count({ where: { type: "PARENT_OF", toPersonId: ottoA } })).toBe(2);
    const familiesOfHans = await prisma.personFamily.count({ where: { personId: hansA } });
    expect(familiesOfHans).toBe(2);

    // Hans (genaues Datum aus A) und Maria (Geburtsname aus A, Sterbedatum
    // aus B) weichen vom letzten Stand je einer Datei ab — das ist aber nur
    // die Folge des Zusammenführens, die Dateien bringen nichts Neues: still
    // unverändert, keine Liste „in der App geändert“, App-Stand bleibt.
    for (const [label, text, losing] of [
      ["A", fileA, [] as string[]],
      ["B", fileB, [] as string[]],
    ] as const) {
      const plan = await startGedcomImport(admin, { fileName: `test-merge-${label}-${sn}.ged`, bytes: Buffer.from(text, "utf8") });
      trees.push(plan.sourceTreeId);
      expect(plan.isUpdate).toBe(true);
      for (const [kind, c] of Object.entries(plan.counts)) {
        expect(c.new, `${label}: ${kind} neu`).toBe(0);
        expect(c.missing, `${label}: ${kind} fehlt`).toBe(0);
        expect(c.invalid, `${label}: ${kind} ungültig`).toBe(0);
        expect(c.changed, `${label}: ${kind} geändert`).toBe(0);
      }
      const edited = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "edited" })).items.map((i) => i.appId);
      expect(edited.sort(), `${label}: in der App geändert`).toEqual([...losing].sort());
      const r = await applyGedcomImport(admin, plan.batchId, {});
      expect(r.counts.persons.created).toBe(0);
      expect(r.markedMissing).toBe(0);
    }
    expect(await prisma.person.count()).toBe(count - 3);
    // Werte blieben (Vorgabe „App behalten“)
    expect((await prisma.person.findUniqueOrThrow({ where: { id: hansA } })).birthDatePrecision).toBe("DAY");

    // GEDCOM-Export: liest sich, jede zusammengeführte Person genau einmal
    const exp = await buildGedcomExport(admin);
    const doc = parseGedcom(Buffer.from(exp.bytes)).document;
    const hits = (given: string) => doc.persons.filter((p) => p.names.some((n) => n.given === given && (n.surname === sn || n.surname === "Muster")));
    expect(hits("Hans")).toHaveLength(1);
    expect(hits("Maria")).toHaveLength(1);
    expect(hits("Otto")).toHaveLength(1);
    expect(hits("Lena")).toHaveLength(1);
    // _UID: nur die des ursprünglichen Datensatzes (Baum A); die aus B bleibt in der App
    const uids = hits("Hans")[0].externalIds.filter((x) => x.type === "UID").map((x) => x.value);
    expect(uids).toEqual([`${a.uid}I1`]);
    expect(await prisma.externalId.count({ where: { system: "UID", value: `${b.uid}I7`, personId: hansA } })).toBe(1);
  });

  it("Dublette innerhalb eines Baums (Ehe- und Geburtsname): eine Person, erneuter Import legt nichts neu an", async () => {
    const birth = randomSurname();
    const married = randomSurname();
    const { ids, file } = treeWithInnerDuplicate(birth, married);
    await importFile(`inner-${birth}`, file);
    const annaMarried = await personByUid(`${ids.uid}I2`);
    const annaBirth = await personByUid(`${ids.uid}I3`);
    const preview = await previewPersonMerge(admin, annaMarried, annaBirth);
    expect(preview.canMerge).toBe(true);
    expect(preview.summary.newNames).toEqual([]);
    await mergePersons(admin, { keepId: annaMarried, mergeId: annaBirth });
    const anna = await prisma.person.findUniqueOrThrow({ where: { id: annaMarried }, include: { names: true } });
    expect(anna).toMatchObject({ familyName: married, birthName: birth, birthPlace: "Musterdorf" });
    expect(anna.names.filter((n) => n.familyName === birth || n.familyName === married)).toEqual([]);
    expect(await prisma.relationship.count({ where: { type: "PARENT_OF", toPersonId: annaMarried } })).toBe(1);
    expect(await prisma.importLink.count({ where: { personId: annaMarried } })).toBe(2);

    const plan = await startGedcomImport(admin, { fileName: `test-merge-inner-${birth}.ged`, bytes: Buffer.from(file, "utf8") });
    for (const [kind, c] of Object.entries(plan.counts)) {
      expect(c.new, `${kind} neu`).toBe(0);
      expect(c.missing, `${kind} fehlt`).toBe(0);
    }
    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(0);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: annaMarried } })).familyName).toBe(married);
  });

  it("Rohdaten einer beim Import abgelehnten Familie ziehen mit der Person um; erneuter Import legt sie nicht doppelt ab", async () => {
    const sn = randomSurname();
    const { ids, file } = treeWithRejectedFamily(sn);
    await importFile(`rejected-${sn}`, file);
    const carriers = [await personByUid(`${ids.uid}I2`), await personByUid(`${ids.uid}I3`)];
    const rejected = await prisma.importRawRecord.findMany({ where: { personId: { in: carriers }, recordType: { endsWith: REJECTED_RAW_SUFFIX } } });
    expect(rejected).toHaveLength(1);
    const carrier = await prisma.person.findUniqueOrThrow({ where: { id: rejected[0].personId! } });
    // Von Hand erfasste Person bleibt, die importierte (Träger der Rohdaten) geht in ihr auf
    const manual = await createPerson(admin, { givenName: carrier.givenName, familyName: carrier.familyName, familyIds: [FAMILY_A] });
    persons.push(manual.id);
    await mergePersons(admin, { keepId: manual.id, mergeId: carrier.id });
    const moved = await prisma.importRawRecord.findMany({ where: { recordType: { endsWith: REJECTED_RAW_SUFFIX }, id: rejected[0].id } });
    expect(moved[0].personId).toBe(manual.id);
    expect(moved[0].supersededAt).toBeNull();

    const plan = await startGedcomImport(admin, { fileName: `test-merge-rejected-${sn}.ged`, bytes: Buffer.from(file, "utf8") });
    expect(plan.counts.persons.new + plan.counts.persons.missing).toBe(0);
    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(0);
    const after = await prisma.importRawRecord.findMany({ where: { personId: manual.id, recordType: { endsWith: REJECTED_RAW_SUFFIX }, supersededAt: null } });
    expect(after).toHaveLength(1);
  });
});
