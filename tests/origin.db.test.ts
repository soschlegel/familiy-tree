/**
 * Herkunft sichtbar machen (lib/services/origin.ts) gegen die Testdatenbank:
 * Buchstaben und Farben stabil, Anzeigename (Dateiname nur für
 * Administratoren), Rechte (nur bearbeitbare Personen, Zahlen ohne die
 * übrigen), Herkunft je Person samt Zusammenführung und Chips an den
 * Einträgen, Übersicht, Umbenennen. Nur erfundene Namen; räumt auf.
 * Überspringt sich ohne Datenbank.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { createPerson, loadGraph, scopeForEmail, ServiceError } from "@/lib/services";
import { listDuplicatesOfPerson } from "@/lib/services/duplicates";
import { mergePersons, previewPersonMerge } from "@/lib/services/merge";
import {
  canSeeOrigin,
  getPersonOrigin,
  listImportSources,
  loadImportDirectory,
  loadTreeOrigin,
  originOverview,
  renameImportSource,
} from "@/lib/services/origin";
import { mockDbSkipReason } from "./db-ready";
import { randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Herkunft-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a"; // Bearbeiter: EDITOR
const FAMILY_B = "mock-family-b"; // Bearbeiter: VIEWER
const FAMILY_D = "mock-family-d"; // Bearbeiter: kein Zugriff

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof ServiceError ? err.code : String(err);
  }
};

describe.skipIf(Boolean(skipReason))("Herkunft (Testdatenbank)", () => {
  const sn = randomSurname();
  // Zwei Importe, älter als alles andere in der Datenbank → sie tragen A und B.
  const T1 = `TEST-HERKUNFT-1:${sn}`;
  const T2 = `TEST-HERKUNFT-2:${sn}`;
  const FILE1 = `geheim-${sn}-eins.ged`;
  const persons: string[] = [];
  const batches: string[] = [];
  let admin: Scope;
  let editor: Scope;
  let viewer: Scope;
  let nofamily: Scope;
  let pA: string, pB: string, pAB: string, pH: string, pViewOnly: string, pHidden: string;
  let eventImported: string, eventManual: string, relVisible: string, relHidden: string, nameImported: string;

  async function person(given: string, familyIds: string[], extra: Record<string, unknown> = {}) {
    const p = await createPerson(admin, { givenName: given, familyName: sn, gender: "FEMALE", ...extra, familyIds });
    persons.push(p.id);
    return p.id;
  }
  async function batch(tree: string, fileName: string, createdAt: string) {
    const b = await prisma.importBatch.create({
      data: { format: "GEDCOM", fileName, fileSizeBytes: 1, fileSha256: `${fileName}-${createdAt}`, sourceTreeId: tree, status: "COMPLETED", createdAt: new Date(createdAt) },
    });
    batches.push(b.id);
    return b.id;
  }
  const link = (tree: string, batchId: string, target: Record<string, string>, entityType = "PERSON") =>
    prisma.importLink.create({
      data: { entityType, ...target, sourceTreeId: tree, externalKey: `K:${Object.values(target)[0]}`, importHash: "x", firstBatchId: batchId, lastBatchId: batchId },
    });

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    nofamily = await scope("nofamily@example.test");

    const b1 = await batch(T1, FILE1, "1990-01-01T12:00:00Z");
    const b2 = await batch(T2, `geheim-${sn}-zwei.ged`, "1991-06-15T12:00:00Z");
    pA = await person("Adele", [FAMILY_A]);
    pB = await person("Berta", [FAMILY_A]);
    pAB = await person("Cäcilie", [FAMILY_A]);
    pH = await person("Dorothea", [FAMILY_A]);
    pViewOnly = await person("Elfriede", [FAMILY_B]);
    pHidden = await person("Frieda", [FAMILY_D]);
    await link(T1, b1, { personId: pA });
    await link(T2, b2, { personId: pB });
    await link(T1, b1, { personId: pAB });
    await link(T2, b2, { personId: pAB });
    await link(T1, b1, { personId: pViewOnly });
    await link(T2, b2, { personId: pHidden });

    // Einträge an pA: ein importiertes und ein in der App erfasstes Ereignis,
    // ein importierter Name, eine Beziehung zu einer sichtbaren und eine zu
    // einer für den Bearbeiter unsichtbaren Person.
    eventImported = (await prisma.event.create({ data: { personId: pA, type: "BAPTISM" } })).id;
    eventManual = (await prisma.event.create({ data: { personId: pA, type: "OCCUPATION", value: "Weberin" } })).id;
    nameImported = (await prisma.personName.create({ data: { personId: pA, type: "MARRIED", givenName: "Adele", familyName: `${sn}-Ehename` } })).id;
    relVisible = (await prisma.relationship.create({ data: { type: "PARENT_OF", subtype: "BIOLOGICAL", fromPersonId: pA, toPersonId: pB } })).id;
    relHidden = (await prisma.relationship.create({ data: { type: "PARENT_OF", subtype: "BIOLOGICAL", fromPersonId: pA, toPersonId: pHidden } })).id;
    await link(T1, b1, { eventId: eventImported }, "EVENT");
    await link(T1, b1, { personNameId: nameImported }, "PERSON_NAME");
    await link(T1, b1, { relationshipId: relVisible }, "RELATIONSHIP");
    await link(T2, b2, { relationshipId: relHidden }, "RELATIONSHIP");
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches } } });
    await prisma.importSource.deleteMany({ where: { sourceTreeId: { in: [T1, T2] } } });
  });

  it("Buchstaben nach dem ersten Import, Farben aus der Palette — ein neuer Stand desselben Baums ändert nichts", async () => {
    const before = await loadImportDirectory();
    expect(before.get(T1)).toMatchObject({ letter: "A", index: 0, batches: 1 });
    expect(before.get(T2)).toMatchObject({ letter: "B", index: 1 });
    expect(before.entry(admin, T1)).toMatchObject({ key: "A", letter: "A", color: "#E69F00", fg: "#000000", manual: false });
    expect(before.entry(admin, T2)).toMatchObject({ key: "B", color: "#56B4E9" });

    // Zweiter Lauf desselben Baums, viel später: bleibt A; B bleibt B.
    await batch(T1, `geheim-${sn}-eins-neu.ged`, "2020-03-03T12:00:00Z");
    const after = await loadImportDirectory();
    expect(after.get(T1)).toMatchObject({ letter: "A", index: 0, batches: 2 });
    expect(after.get(T2)).toMatchObject({ letter: "B", index: 1 });
    expect(after.get(T1)!.fileName).toBe(`geheim-${sn}-eins-neu.ged`);
  });

  it("Name: Dateiname nur für Administratoren, sonst „Import vom <Datum des ersten Imports>“", async () => {
    const dir = await loadImportDirectory();
    expect(dir.name(admin, T1)).toMatch(new RegExp(`^„geheim-${sn}-eins-neu\\.ged“ \\(\\d{1,2}\\.\\d{1,2}\\.2020\\)$`));
    expect(dir.name(editor, T1)).toBe("Import vom 1.1.1990");
    expect(dir.label(editor, T1)).toBe("A · Import vom 1.1.1990");
    expect(dir.label(editor, T2)).toBe("B · Import vom 15.6.1991");
    expect(dir.label(editor, null)).toBe("importiert");
    expect(JSON.stringify([dir.entry(editor, T1), dir.label(editor, T1)])).not.toContain("geheim");
  });

  it("Quell-Baum ohne abgeschlossenen Lauf bekommt trotzdem einen festen Buchstaben (nach den übrigen)", async () => {
    const orphan = `TEST-HERKUNFT-OHNE-LAUF:${sn}`;
    const l = await prisma.importLink.create({ data: { entityType: "PERSON", personId: pH, sourceTreeId: orphan, externalKey: "X", importHash: "x" } });
    try {
      expect((await loadImportDirectory()).get(orphan)).toBeUndefined();
      const dir = await loadImportDirectory([orphan]);
      const info = dir.get(orphan)!;
      expect(info.index).toBeGreaterThan(dir.get(T2)!.index);
      expect(dir.get(T1)!.letter).toBe("A");
      expect((await loadImportDirectory([orphan])).get(orphan)!.letter).toBe(info.letter);
    } finally {
      await prisma.importLink.delete({ where: { id: l.id } });
    }
  });

  it("wer darf: Administratoren und Bearbeiter, nicht Betrachter und nicht ohne Familie", async () => {
    expect([admin, editor, viewer, nofamily].map(canSeeOrigin)).toEqual([true, true, false, false]);
    const graph = await loadGraph(viewer);
    expect(await loadTreeOrigin(viewer, graph)).toBeNull();
    expect(await loadTreeOrigin(nofamily, await loadGraph(nofamily))).toBeNull();
    expect(await code(originOverview(viewer))).toBe("FORBIDDEN");
  });

  it("Baum: Importe je Person, „H“ ohne Import, Verbindungspersonen, Zahlen", async () => {
    const graph = await loadGraph(admin);
    const mine = [pA, pB, pAB, pH, pViewOnly, pHidden];
    const o = (await loadTreeOrigin(admin, graph, mine))!;
    expect(o.byPerson).toEqual({ [pA]: ["A"], [pB]: ["B"], [pAB]: ["A", "B"], [pH]: ["H"], [pViewOnly]: ["A"], [pHidden]: ["B"] });
    expect(o.connecting).toBe(1);
    expect(o.entries.map((e) => [e.key, e.persons, e.manual])).toEqual([
      ["A", 3, false],
      ["B", 3, false],
      ["H", 1, true],
    ]);
    // Ohne Ausschnitt: alle Personen des Graphen; die Mock-Personen sind von Hand erfasst.
    const all = (await loadTreeOrigin(admin, graph))!;
    expect(Object.keys(all.byPerson)).toHaveLength(graph.persons.size);
    expect(all.byPerson[pAB]).toEqual(["A", "B"]);
    expect(all.entries.find((e) => e.key === "H")!.persons).toBeGreaterThan(100);
  });

  it("Baum als Bearbeiter: nur bearbeitbare Personen, Zahlen ohne die übrigen, kein Dateiname", async () => {
    const graph = await loadGraph(editor);
    const o = (await loadTreeOrigin(editor, graph, [pA, pB, pAB, pH, pViewOnly, pHidden]))!;
    // Familie B darf der Bearbeiter nur sehen, Familie D gar nicht.
    expect(Object.keys(o.byPerson).sort()).toEqual([pA, pB, pAB, pH].sort());
    expect(o.entries.map((e) => [e.key, e.persons])).toEqual([
      ["A", 2],
      ["B", 2],
      ["H", 1],
    ]);
    expect(o.entries[0].name).toBe("Import vom 1.1.1990");
    expect(JSON.stringify(o)).not.toContain("geheim");
    expect(JSON.stringify(o)).not.toContain("TEST-HERKUNFT");
  });

  it("Person: Importe, Chips nur an importierten Einträgen, nichts über unsichtbare Verwandte", async () => {
    const forAdmin = (await getPersonOrigin(admin, pA))!;
    expect(forAdmin.manual).toBe(false);
    expect(forAdmin.imports.map((i) => [i.letter, i.records, i.viaMerge])).toEqual([["A", 1, false]]);
    expect(forAdmin.merged).toBeNull();
    expect(forAdmin.chips.events).toEqual({ [eventImported]: ["A"] });
    expect(forAdmin.chips.events[eventManual]).toBeUndefined();
    expect(forAdmin.chips.names).toEqual({ [nameImported]: ["A"] });
    expect(forAdmin.chips.relationships).toEqual({ [relVisible]: ["A"], [relHidden]: ["B"] });

    const forEditor = (await getPersonOrigin(editor, pA))!;
    expect(forEditor.chips.relationships).toEqual({ [relVisible]: ["A"] });
    expect(Object.keys(forEditor.chips.entries)).toEqual(["A"]);
    expect(JSON.stringify(forEditor)).not.toContain("geheim");

    const both = (await getPersonOrigin(editor, pAB))!;
    expect(both.imports.map((i) => i.letter)).toEqual(["A", "B"]);
    const manual = (await getPersonOrigin(editor, pH))!;
    expect(manual).toMatchObject({ manual: true, imports: [], merged: null });
    expect(manual.chips.entries.H).toMatchObject({ letter: "H", manual: true });
  });

  it("Person: nur wer sie bearbeiten darf", async () => {
    expect(await getPersonOrigin(editor, pViewOnly)).toBeNull(); // nur Leserecht
    expect(await getPersonOrigin(editor, pHidden)).toBeNull();
    expect(await getPersonOrigin(viewer, pA)).toBeNull();
    expect(await getPersonOrigin(nofamily, pA)).toBeNull();
    expect(await getPersonOrigin(admin, "gibt-es-nicht")).toBeNull();
  });

  it("„zusammengeführt am … aus N Einträgen“ aus dem MERGE-Eintrag, auch über eine Kette", async () => {
    const same = { birthDate: "1840-02-02", deathDate: "1900-03-03" };
    const k = await person("Gesine", [FAMILY_A], same);
    const x = await person("Gesine", [FAMILY_A], same);
    const y = await person("Gesine", [FAMILY_A], same);
    const b = await batch(T2, `geheim-${sn}-drei.ged`, "1992-01-01T12:00:00Z");
    await link(T2, b, { personId: x });
    await mergePersons(admin, { keepId: x, mergeId: y });
    await mergePersons(admin, { keepId: k, mergeId: x });
    const o = (await getPersonOrigin(editor, k))!;
    expect(o.merged?.entries).toBe(3);
    expect(new Date(o.merged!.lastAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Der Import kam erst durch das Zusammenführen dazu.
    expect(o.imports.map((i) => [i.letter, i.viaMerge])).toEqual([["B", true]]);
    expect(o.manual).toBe(false);
  });

  it("Übersicht: Personen je Import und Verbindungspersonen je Paar — für den Bearbeiter ohne die übrigen", async () => {
    const a = await originOverview(admin);
    const node = (o: typeof a, key: string) => o.nodes.find((n) => n.key === key)!;
    expect(node(a, "A").persons).toBe(3); // pA, pAB, pViewOnly
    expect(a.edges.find((e) => e.a === "A" && e.b === "B")).toEqual({ a: "A", b: "B", persons: 1 });
    expect(a.connecting).toBeGreaterThanOrEqual(1);
    expect(a.total).toBe(await prisma.person.count());

    const e = await originOverview(editor);
    expect(node(e, "A").persons).toBe(2);
    expect(e.edges.find((x) => x.a === "A" && x.b === "B")?.persons).toBe(1);
    expect(e.total).toBe(await prisma.person.count({ where: { families: { some: { familyId: FAMILY_A } } } }));
    expect(JSON.stringify(e)).not.toContain("geheim");
  });

  it("Umbenennen: nur Administratoren; der Name gilt überall, auch für Bearbeiter", async () => {
    expect(await code(renameImportSource(editor, { sourceTreeId: T1, displayName: "Darf ich nicht" }))).toBe("FORBIDDEN");
    expect(await code(listImportSources(editor))).toBe("FORBIDDEN");
    expect(await code(renameImportSource(admin, { sourceTreeId: "gibt-es-nicht", displayName: "X" }))).toBe("NOT_FOUND");
    expect(await code(renameImportSource(admin, { sourceTreeId: T1, displayName: "x".repeat(61) }))).toBe("VALIDATION");

    const dto = await renameImportSource(admin, { sourceTreeId: T1, displayName: "  Stammbaum   Tante Erika " });
    expect(dto).toMatchObject({ letter: "A", displayName: "Stammbaum Tante Erika", name: "Stammbaum Tante Erika", defaultName: "Import vom 1.1.1990" });
    expect(dto.persons).toBe(3);
    expect(await code(renameImportSource(admin, { sourceTreeId: T2, displayName: "stammbaum tante erika" }))).toBe("VALIDATION");

    const dir = await loadImportDirectory();
    expect(dir.label(editor, T1)).toBe("A · Stammbaum Tante Erika");
    expect(dir.label(admin, T1)).toBe("A · Stammbaum Tante Erika");
    expect(dir.get(T1)!.letter).toBe("A");
    expect((await getPersonOrigin(editor, pA))!.imports[0].name).toBe("Stammbaum Tante Erika");

    // Protokoll: vorher → nachher
    const log = await prisma.auditLog.findFirst({ where: { action: "UPDATE", entityType: "ImportBatch", diff: { path: ["renamed"], equals: true } }, orderBy: { createdAt: "desc" } });
    expect(log?.diff).toMatchObject({ letter: "A", changes: { displayName: { from: null, to: "Stammbaum Tante Erika" } } });

    // Importverwaltung: Liste mit Buchstabe, Namen und Datei
    const list = await listImportSources(admin);
    expect(list.find((s) => s.sourceTreeId === T1)).toMatchObject({ letter: "A", displayName: "Stammbaum Tante Erika", batches: 2 });
    expect(list.find((s) => s.sourceTreeId === T2)).toMatchObject({ letter: "B", displayName: null });

    // Leer = wieder der Standardname
    const reset = await renameImportSource(admin, { sourceTreeId: T1, displayName: " " });
    expect(reset.displayName).toBeNull();
    expect((await loadImportDirectory()).label(editor, T1)).toBe("A · Import vom 1.1.1990");
    expect(await prisma.importSource.count({ where: { sourceTreeId: T1 } })).toBe(0);
  });

  it("derselbe Name im Dubletten-Hinweis und auf der Vergleichsseite", async () => {
    await renameImportSource(admin, { sourceTreeId: T2, displayName: "Ahnentafel Onkel Fritz" });
    const same = { birthDate: "1833-06-21", deathDate: "1901-12-05" };
    const a = await person("Hermine", [FAMILY_A], same);
    const b = await person("Hermine", [FAMILY_A], same);
    const bt = await batch(T2, `geheim-${sn}-vier.ged`, "1993-01-01T12:00:00Z");
    await link(T2, bt, { personId: b });
    expect((await listDuplicatesOfPerson(editor, a)).items[0].origin).toEqual(["B · Ahnentafel Onkel Fritz"]);
    const preview = await previewPersonMerge(editor, a, b);
    expect(preview.other.imports).toEqual(["B · Ahnentafel Onkel Fritz"]);
    expect(preview.keep.imports).toEqual([]);
  });
});
