/**
 * Vorschläge schon beim GEDCOM-Import (lib/services/import-suggestions.ts,
 * gedcom-import.ts) gegen die Testdatenbank: neue Personen einer Datei gegen
 * Personen eines ANDEREN Imports; Standard „neu anlegen“; Verknüpfen reichert
 * an (Leeres füllen, Widersprüchliches als Zweitangabe), Herkunft und
 * Änderungsgeschichte; erneuter Import still; Nachprüfung beim Ausführen
 * (geändertes Ziel, doppeltes Ziel, nicht vorgeschlagen, fehlendes Recht);
 * keine Vorschläge für Unsichtbares; bei Abweichung bleibt alles, wie es war.
 * Erfundene Namen; räumt auf.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { appChangeSet } from "@/lib/change-sets";
import { parseGedcom } from "@/lib/gedcom";
import { mapGedcomDocument } from "@/lib/gedcom-import/mapping";
import {
  applyGedcomImport,
  checkGedcomDecisions,
  getGedcomPlan,
  listGedcomPlanItems,
  startGedcomImport,
  verifyImportLinks,
  type GedcomPlan,
} from "@/lib/services/gedcom-import";
import { suggestImportLinks } from "@/lib/services/import-suggestions";
import { ServiceError } from "@/lib/services/errors";
import { buildGedcom, newTreeIds, randomSurname, type TreeIds } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();

/** A: Gottlieb → Hans ⚭ Maria (genaue Daten). */
function fileA(ids: TreeIds, sn: string) {
  return buildGedcom(
    ids,
    [
      { key: "I1", given: "Gottlieb", surname: sn, sex: "M", birth: "4 JAN 1820", death: "9 SEP 1880", fams: ["F1"] },
      { key: "I2", given: "Hans", surname: sn, sex: "M", birth: "12 MAR 1850", death: "1 JUN 1910", occupation: "Schmied", famc: "F1", fams: ["F2"] },
      { key: "I3", given: "Maria", surname: "Musterin", marriedName: sn, sex: "F", birth: "3 MAY 1855", death: "2 FEB 1920", fams: ["F2"] },
    ],
    [
      { key: "F1", husb: "I1", children: ["I2"] },
      { key: "F2", husb: "I2", wife: "I3", children: [], marr: "1878" },
    ],
  );
}

/** B: Hans ⚭ Maria (gleiche genaue Daten; Hans mit Geburtsort, Maria mit abweichendem Tod) → Otto → Paul. */
function fileB(ids: TreeIds, sn: string) {
  return buildGedcom(
    ids,
    [
      { key: "I7", given: "Hans", surname: sn, sex: "M", birth: "12 MAR 1850", birthPlace: "Probstadt", death: "1 JUN 1910", occupation: "Schmied", fams: ["F4"] },
      { key: "I8", given: "Maria", surname: sn, sex: "F", birth: "3 MAY 1855", death: "2 FEB 1921", fams: ["F4"] },
      { key: "I9", given: "Otto", surname: sn, sex: "M", birth: "1880", famc: "F4", fams: ["F5"] },
      { key: "I10", given: "Paul", surname: sn, sex: "M", birth: "1910", famc: "F5" },
    ],
    [
      { key: "F4", husb: "I7", wife: "I8", children: ["I9"] },
      { key: "F5", husb: "I9", children: ["I10"] },
    ],
  );
}

describe.skipIf(Boolean(skipReason))("Vorschläge beim GEDCOM-Import (Testdatenbank)", () => {
  const trees: string[] = [];
  const families: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "importvorschlag-test-"));
    process.env.MEDIA_DIR = mediaDir;
    admin = (await scopeForEmail("admin@example.test"))!;
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    const batches = await prisma.importBatch.findMany({ where: { createdAt: { gte: startedAt }, fileName: { startsWith: "test-vorschlag-" } }, select: { id: true, sourceTreeId: true } });
    const allTrees = [...new Set([...trees, ...batches.map((b) => b.sourceTreeId).filter((x): x is string => Boolean(x))])];
    const links = await prisma.importLink.findMany({ where: { sourceTreeId: { in: allTrees } }, select: { personId: true, sourceId: true } });
    await prisma.person.deleteMany({ where: { id: { in: links.map((l) => l.personId).filter((x): x is string => Boolean(x)) } } });
    await prisma.source.deleteMany({ where: { id: { in: links.map((l) => l.sourceId).filter((x): x is string => Boolean(x)) } } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((x) => x.id) } } });
    await prisma.externalId.deleteMany({ where: { batchId: { in: batches.map((x) => x.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((x) => x.id) } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    const sets = await prisma.auditLog.findMany({ where: { createdAt: { gte: startedAt }, userId: "mock-user-admin", changeSetId: { not: null } }, select: { changeSetId: true } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, userId: "mock-user-admin" } });
    await prisma.changeSet.deleteMany({ where: { id: { in: sets.map((s) => s.changeSetId!) } } });
    await prisma.$disconnect();
  });

  async function importA(sn: string) {
    const ids = newTreeIds();
    const plan = await startGedcomImport(admin, { fileName: `test-vorschlag-A-${sn}.ged`, bytes: Buffer.from(fileA(ids, sn), "utf8") });
    trees.push(plan.sourceTreeId);
    const r = await applyGedcomImport(admin, plan.batchId, { family: { mode: "new", name: `Vorschlag A ${sn}` } });
    if (r.familyId) families.push(r.familyId);
    const uid = async (k: string) => (await prisma.externalId.findFirstOrThrow({ where: { system: "UID", value: `${ids.uid}${k}`, personId: { not: null } } })).personId!;
    return { tree: plan.sourceTreeId, gottlieb: await uid("I1"), hans: await uid("I2"), maria: await uid("I3") };
  }

  async function previewB(sn: string, ids = newTreeIds()) {
    const plan = await startGedcomImport(admin, { fileName: `test-vorschlag-B-${sn}.ged`, bytes: Buffer.from(fileB(ids, sn), "utf8") });
    trees.push(plan.sourceTreeId);
    const items = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "new", limit: 500 })).items;
    const byName = (given: string) => items.find((i) => i.label.startsWith(given))!;
    return { ids, plan, items, byName };
  }

  const linkIssues = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe("CONFLICT");
      return (err as ServiceError).details?.linkIssues as { ref: string; reason: string }[];
    }
    throw new Error("Konflikt erwartet");
  };

  it("schlägt Personen eines anderen Imports vor; Standard bleibt „neu anlegen“", async () => {
    const sn = randomSurname();
    const a = await importA(sn);
    const { plan, byName } = await previewB(sn);
    // Hans: gleicher Name, gleiche genaue Daten → „sicher“. Maria: Tod ein Jahr
    // abweichend → nicht „sicher“, aber „sehr wahrscheinlich“ (Geburtsdatum + Partner).
    expect(plan.links.persons.high).toBeGreaterThanOrEqual(1);
    expect(plan.links.persons.veryLikely).toBeGreaterThanOrEqual(1);
    expect(plan.suggestions).toBeGreaterThanOrEqual(2);
    const hans = byName("Hans");
    expect(hans.suggestions?.[0]).toMatchObject({ personId: a.hans, cls: "high", confidence: "high" });
    expect(hans.suggestions?.[0].origin).toMatch(/^Import /);
    expect(hans.suggestions?.[0].sentence).toMatch(/Geburtsdatum/);
    expect(hans.suggestions?.[0].differences.join(" ")).toMatch(/Geburtsort nur in der Datei/);
    const maria = byName("Maria");
    expect(maria.suggestions?.[0]).toMatchObject({ personId: a.maria, cls: "veryLikely" });
    expect(maria.suggestions?.[0].differences.join(" ")).toMatch(/Tod: Datei/);
    // Wiederkennung hat Vorrang: A-Personen sind nicht „neu“, Paul hat keinen Kandidaten.
    expect(byName("Paul").suggestions ?? []).toEqual([]);

    // Ohne Auswahl: alles neu angelegt, nichts verknüpft.
    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(4);
    expect(r.counts.persons.linked).toBe(0);
    expect(await prisma.importLink.count({ where: { personId: a.hans, entityType: "PERSON" } })).toBe(1);
  });

  it("verknüpft nur das ausdrücklich Gewählte: anreichern, Herkunft, Änderungsgeschichte, erneuter Import still", async () => {
    const sn = randomSurname();
    const a = await importA(sn);
    const { ids, plan, byName } = await previewB(sn);
    const hans = byName("Hans");
    const maria = byName("Maria");
    const before = await prisma.person.findUniqueOrThrow({ where: { id: a.maria } });

    // Wie in der Web-API: ein Paket je Anfrage (lib/api.ts).
    const r = await applyGedcomImport({ ...admin, changeSet: appChangeSet() }, plan.batchId, {
      suggestions: { [hans.ref]: { personId: a.hans }, [maria.ref]: { personId: a.maria } },
      family: { mode: "new", name: `Vorschlag B ${sn}` },
    });
    if (r.familyId) families.push(r.familyId);
    expect(r.counts.persons).toMatchObject({ linked: 2, created: 2 });

    // Leeres gefüllt, App-Wert bleibt, Widersprüchliches als Zweitangabe.
    const hansAfter = await prisma.person.findUniqueOrThrow({ where: { id: a.hans } });
    expect(hansAfter.birthPlace).toBe("Probstadt");
    const mariaAfter = await prisma.person.findUniqueOrThrow({ where: { id: a.maria } });
    expect(mariaAfter.deathDate?.toISOString()).toBe(before.deathDate?.toISOString());
    const alt = await prisma.event.findMany({ where: { personId: a.maria, type: "DEATH", isAlternative: true } });
    expect(alt).toHaveLength(1);
    expect(alt[0].date?.getUTCFullYear()).toBe(1921);
    // Familien der vorhandenen Personen bleiben unverändert.
    expect((await prisma.personFamily.findMany({ where: { personId: a.hans } })).map((f) => f.familyId)).not.toContain(r.familyId);

    // Herkunft: zweiter Vermerk aus Import B (mit mergedAt), der erste bleibt.
    const links = await prisma.importLink.findMany({ where: { personId: a.hans, entityType: "PERSON" }, orderBy: { createdAt: "asc" } });
    expect(links.map((l) => l.sourceTreeId)).toEqual([a.tree, plan.sourceTreeId]);
    expect(links[1].mergedAt).not.toBeNull();
    // Gleicher Beruf: einmal, mit zwei Herkunftsvermerken.
    const occ = await prisma.event.findMany({ where: { personId: a.hans, type: "OCCUPATION" }, include: { importLinks: true } });
    expect(occ).toHaveLength(1);
    expect(occ[0].importLinks.map((l) => l.sourceTreeId).sort()).toEqual([a.tree, plan.sourceTreeId].sort());
    // Partnerschaft Hans–Maria gibt es schon: nicht doppelt; Otto hängt an den vorhandenen Eltern.
    expect(await prisma.relationship.count({ where: { type: "PARTNER_OF", OR: [{ fromPersonId: a.hans, toPersonId: a.maria }, { fromPersonId: a.maria, toPersonId: a.hans }] } })).toBe(1);
    const otto = (await prisma.externalId.findFirstOrThrow({ where: { system: "UID", value: `${ids.uid}I9` } })).personId!;
    expect(await prisma.relationship.count({ where: { type: "PARENT_OF", fromPersonId: a.hans, toPersonId: otto } })).toBe(1);
    // Rohdaten aus A bleiben gültig neben denen aus B.
    const raws = await prisma.importRawRecord.findMany({ where: { personId: a.hans, supersededAt: null, recordType: { startsWith: "GEDCOM" } } });
    expect(new Set(raws.map((x) => x.batchId)).size).toBeGreaterThanOrEqual(2);

    // Änderungsgeschichte: je verknüpfter Person EIN Eintrag im Paket des Imports, vorher → nachher.
    const entries = await prisma.auditLog.findMany({ where: { entityType: "Person", entityId: { in: [a.hans, a.maria] }, createdAt: { gte: startedAt } } });
    const linkedEntries = entries.filter((e) => (e.diff as { import?: string }).import === plan.batchId);
    expect(linkedEntries).toHaveLength(2);
    const hansEntry = linkedEntries.find((e) => e.entityId === a.hans)!;
    expect(hansEntry.action).toBe("UPDATE");
    expect(hansEntry.diff).toMatchObject({ person: "linked", changes: { birthPlace: { from: null, to: "Probstadt" } }, linked: { sourceTreeId: plan.sourceTreeId } });
    const ottoEntry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Person", entityId: otto } });
    expect(hansEntry.changeSetId).toBeTruthy();
    expect(hansEntry.changeSetId).toBe(ottoEntry.changeSetId);
    const mariaEntry = linkedEntries.find((e) => e.entityId === a.maria)!;
    expect(mariaEntry.diff).toMatchObject({ person: "linked", created: { events: 1 } });

    // Erneuter Import derselben Datei: still — nichts neu, nichts „in der App geändert“.
    const again = await startGedcomImport(admin, { fileName: `test-vorschlag-B-${sn}-2.ged`, bytes: Buffer.from(fileB(ids, sn), "utf8") });
    expect(again.sourceTreeId).toBe(plan.sourceTreeId);
    expect(again.counts.persons.new).toBe(0);
    expect(again.counts.persons.edited).toBe(0);
    expect(again.counts.events.new).toBe(0);
  });

  it("prüft beim Ausführen nach: nicht vorgeschlagen, doppeltes Ziel, geändertes Ziel — dann wird nichts importiert", async () => {
    const sn = randomSurname();
    const a = await importA(sn);
    const { plan, byName } = await previewB(sn);
    const hans = byName("Hans");
    const maria = byName("Maria");
    const otto = byName("Otto");
    const persons = await prisma.person.count();

    // Nicht vorgeschlagen (Otto ↔ Gottlieb) und doppeltes Ziel.
    let issues = await linkIssues(checkGedcomDecisions(admin, plan.batchId, { suggestions: { [otto.ref]: { personId: a.gottlieb } } }));
    expect(issues[0].reason).toMatch(/nicht vorgeschlagen/);
    issues = await linkIssues(
      applyGedcomImport(admin, plan.batchId, { suggestions: { [hans.ref]: { personId: a.hans }, [maria.ref]: { personId: a.hans } } }),
    );
    expect(issues.some((i) => /mehrere Personen/.test(i.reason))).toBe(true);

    // Ziel seit der Vorschau geändert: Sterbedatum widerspricht jetzt → Paar passt nicht mehr bzw. schlechter.
    await prisma.person.update({ where: { id: a.hans }, data: { deathDate: new Date("1890-01-01T00:00:00Z"), deathDatePrecision: "DAY" } });
    issues = await linkIssues(applyGedcomImport(admin, plan.batchId, { suggestions: { [hans.ref]: { personId: a.hans } } }));
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toMatch(/passt nach den heutigen Daten nicht mehr|Einstufung jetzt/);

    // Nichts geschrieben, Lauf weiter offen — neu entscheiden geht.
    expect(await prisma.person.count()).toBe(persons);
    expect((await getGedcomPlan(admin, plan.batchId)).status).toBe("PENDING");
    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(4);
  });

  it("ein Fehler in der Transaktion rollt den ganzen Import samt Verknüpfungen zurück", async () => {
    const sn = randomSurname();
    const a = await importA(sn);
    const { plan, byName } = await previewB(sn);
    const hans = byName("Hans");
    const maria = byName("Maria");
    const before = { persons: await prisma.person.count(), events: await prisma.event.count({ where: { personId: a.maria } }), hans: await prisma.person.findUniqueOrThrow({ where: { id: a.hans } }) };
    // Letzter Schritt in der Transaktion (Lauf abschließen) scheitert.
    const original = prisma.$transaction.bind(prisma);
    // Eigene Eigenschaft über den Prisma-Client legen und danach wieder entfernen
    // (vi.spyOn ließe nach mockRestore keinen $transaction zurück).
    Object.defineProperty(prisma, "$transaction", { configurable: true, writable: true, value: ((fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
      original(
        ((tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get: (t, k) =>
                k === "importBatch"
                  ? new Proxy(t.importBatch as object, { get: (d, m) => (m === "update" ? () => Promise.reject(new Error("Testfehler")) : Reflect.get(d, m)) })
                  : Reflect.get(t, k),
            }),
          )) as never,
        opts as never,
      )) });
    try {
      await expect(applyGedcomImport(admin, plan.batchId, { suggestions: { [hans.ref]: { personId: a.hans }, [maria.ref]: { personId: a.maria } } })).rejects.toThrow("Testfehler");
    } finally {
      delete (prisma as unknown as Record<string, unknown>).$transaction;
    }
    expect(typeof prisma.$transaction).toBe("function");
    expect(await prisma.person.count()).toBe(before.persons);
    expect(await prisma.event.count({ where: { personId: a.maria } })).toBe(before.events);
    expect(await prisma.importLink.count({ where: { personId: a.hans, entityType: "PERSON" } })).toBe(1);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: a.hans } })).birthPlace).toBe(before.hans.birthPlace);
    expect(await prisma.auditLog.count({ where: { entityType: "Person", entityId: a.hans, createdAt: { gte: startedAt }, action: "UPDATE" } })).toBe(0);
    expect((await getGedcomPlan(admin, plan.batchId)).status).toBe("PENDING");
  });

  it("Rechte: Unsichtbares wird nicht vorgeschlagen; ohne Bearbeitungsrecht keine Verknüpfung", async () => {
    const sn = randomSurname();
    const a = await importA(sn);
    const { ids, plan, byName } = await previewB(sn);
    const editor = (await scopeForEmail("editor@example.test"))!;
    const viewer = (await scopeForEmail("viewer@example.test"))!;
    const bytes = Buffer.from(fileB(ids, sn), "utf8");
    const mapped = mapGedcomDocument(parseGedcom(bytes).document);
    const newRefs = mapped.persons.map((p) => p.ref);
    // Familie „Vorschlag A …“ sieht der Bearbeiter nicht: keine Vorschläge, auch keine Zahl.
    const asEditor = await suggestImportLinks(editor, { mapped, newRefs, matched: new Map(), sourceTreeId: plan.sourceTreeId });
    expect([...asEditor.byRef.values()].flat().some((s) => [a.hans, a.maria, a.gottlieb].includes(s.personId))).toBe(false);
    expect(asEditor.summary.compared.existing).toBeLessThan((await suggestImportLinks(admin, { mapped, newRefs, matched: new Map(), sourceTreeId: plan.sourceTreeId })).summary.compared.existing);

    // Sichtbar, aber nicht bearbeitbar (Betrachter von Familie A): kein Vorschlag, und die Nachprüfung lehnt ab.
    const familyA = families[families.length - 1];
    await prisma.personFamily.create({ data: { personId: a.hans, familyId: "mock-family-a" } });
    try {
      const asViewer = await suggestImportLinks(viewer, { mapped, newRefs, matched: new Map(), sourceTreeId: plan.sourceTreeId });
      expect([...asViewer.byRef.values()].flat().map((s) => s.personId)).not.toContain(a.hans);
      const hans = byName("Hans");
      const fullPlan = { version: 2, sourceTreeId: plan.sourceTreeId, items: [hans] } as unknown as GedcomPlan;
      const plain = { ids: { persons: new Map(), names: new Map(), relationships: new Map(), events: new Map(), sources: new Map(), citations: new Map() } };
      const issues = await linkIssues(
        verifyImportLinks(viewer, fullPlan, mapped, plain as never, { [hans.ref]: { personId: a.hans } }, plan.sourceTreeId),
      );
      expect(issues[0].reason).toMatch(/keine Berechtigung/);
      // Unsichtbares Ziel: neutrale Meldung, kein Name.
      const hidden = await linkIssues(
        verifyImportLinks(viewer, { ...fullPlan, items: [{ ...hans, suggestions: [{ ...hans.suggestions![0], personId: a.maria, label: "x" }] }] } as GedcomPlan, mapped, plain as never, { [hans.ref]: { personId: a.maria } }, plan.sourceTreeId),
      );
      expect(hidden[0].reason).toMatch(/nicht mehr|nicht sichtbar/);
    } finally {
      await prisma.personFamily.deleteMany({ where: { personId: a.hans, familyId: "mock-family-a" } });
    }
    expect(familyA).toBeTruthy();
  });
});

