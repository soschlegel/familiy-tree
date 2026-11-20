/**
 * Quellen aus dem Import sauber übernehmen: MyHeritage-artige Quellen werden
 * eingeordnet (Online-Stammbaum, Anbieter, Adresse), HTML wird Text,
 * Adressen in Fundstellen werden Links, Belege auf Online-Stammbäume sind
 * „nicht bewertet“, doppelte Belege fallen zusammen, allgemeine Belege mit
 * EVEN gehen an ihren Fakt. Ein erneuter Import korrigiert Daten aus der Zeit
 * vor dieser Zuordnung in place (außer in der App Geändertem), und „aus der
 * aufbewahrten Datei neu einlesen“ läuft über die normale Vorschau.
 * Erfundene Daten. Überspringt sich ohne Datenbank.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { importFingerprint } from "@/lib/import-fingerprint";
import {
  applyGedcomImport,
  discardGedcomPreview,
  listGedcomPlanItems,
  rereadGedcomBatch,
  startGedcomImport,
} from "@/lib/services/gedcom-import";
import { readImportBatchFile } from "@/lib/services/imports";
import { newTreeIds, randomSurname } from "./merge-fixtures";

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
if (skipReason) console.warn(`\n[tests] Import-Quellen-Tests übersprungen: ${skipReason}\n`);

function file(sn: string) {
  const ids = newTreeIds();
  const rec = "https://www.myheritage.de/research/collection-1/musterland-stammbaeume?itemId=4711&amp;action=showRecord";
  const text = [
    "0 HEAD",
    "1 GEDC",
    "2 VERS 5.5.1",
    "1 CHAR UTF-8",
    "1 SOUR MYHERITAGE",
    "2 NAME MyHeritage Family Tree Builder",
    `1 _PROJECT_GUID ${ids.guid}`,
    "0 @I1@ INDI",
    `1 _UID ${ids.uid}I1`,
    `1 NAME Wilhelm /${sn}/`,
    "1 SEX M",
    "1 BIRT",
    "2 DATE 3 MAY 1850",
    "1 SOUR @S1@",
    `2 PAGE ${rec}`,
    "2 QUAY 3",
    "1 SOUR @S1@",
    `2 PAGE ${rec}`,
    "2 QUAY 3",
    "1 SOUR @S1@",
    "2 PAGE Geburtseintrag",
    "2 EVEN BIRT",
    "1 SOUR @S2@",
    "2 PAGE S. 12",
    "2 QUAY 3",
    "0 @S1@ SOUR",
    "1 TITL Musterland Stammbäume",
    "1 _TYPE Stammbaum",
    "1 _MEDI Online",
    '1 TEXT <a id="" href="https://www.myheritage.de" class="green" target="_blank" rel="noopener">www.myheritage.de</a> Diese Sammlung gehört MyHeritage.',
    "0 @S2@ SOUR",
    "1 TITL Kirchenbuch Musterdorf, Taufen",
    "0 TRLR",
    "",
  ].join("\r\n");
  return { ids, text };
}

describe.skipIf(Boolean(skipReason))("Quellen aus dem Import (Testdatenbank)", () => {
  const trees: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "import-sources-test-"));
    process.env.MEDIA_DIR = mediaDir;
    admin = (await scopeForEmail("admin@example.test"))!;
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    const links = await prisma.importLink.findMany({ where: { sourceTreeId: { in: trees } }, select: { personId: true, sourceId: true } });
    await prisma.person.deleteMany({ where: { id: { in: links.map((l) => l.personId).filter((x): x is string => Boolean(x)) } } });
    await prisma.source.deleteMany({ where: { id: { in: links.map((l) => l.sourceId).filter((x): x is string => Boolean(x)) } } });
    const batches = await prisma.importBatch.findMany({ where: { sourceTreeId: { in: trees } }, select: { id: true } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((b) => b.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, userId: "mock-user-admin" } });
    await prisma.$disconnect();
  });

  async function importText(name: string, text: string) {
    const plan = await startGedcomImport(admin, { fileName: `test-src-${name}.ged`, bytes: Buffer.from(text, "utf8") });
    trees.push(plan.sourceTreeId);
    const result = await applyGedcomImport(admin, plan.batchId, {});
    return { plan, result };
  }
  const load = async (uid: string) => {
    const personId = (await prisma.externalId.findFirstOrThrow({ where: { system: "UID", value: uid, personId: { not: null } } })).personId!;
    const citations = await prisma.citation.findMany({ where: { personId }, include: { source: true }, orderBy: { createdAt: "asc" } });
    return { personId, citations };
  };

  it("Einordnung, HTML, Adressen, Verlässlichkeit, Doppelte, EVEN", async () => {
    const sn = randomSurname();
    const { ids, text } = file(sn);
    await importText(sn, text);
    const { citations } = await load(`${ids.uid}I1`);
    const tree = citations.filter((c) => c.source.title === "Musterland Stammbäume");
    const church = citations.filter((c) => c.source.title.startsWith("Kirchenbuch"));
    const src = tree[0].source;
    expect(src).toMatchObject({ kind: "ONLINE_TREE", provider: "MyHeritage", url: "https://www.myheritage.de/" });
    expect(src.notes).not.toMatch(/<a|class=/);
    expect(src.notes).toContain("Diese Sammlung gehört MyHeritage.");
    // zwei gleiche Belege → einer; Adresse als Link, ohne Fundstellen-Text; nicht bewertet
    const linked = tree.filter((c) => c.url);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ detail: null, confidence: null, fact: "OTHER" });
    expect(linked[0].url).toBe("https://www.myheritage.de/research/collection-1/musterland-stammbaeume?itemId=4711&action=showRecord");
    // EVEN BIRT → Geburt
    expect(tree.find((c) => c.detail === "Geburtseintrag")?.fact).toBe("BIRTH");
    // Kirchenbuch behält die Verlässlichkeit der Datei
    expect(church[0]).toMatchObject({ confidence: "HIGH", url: null, detail: "S. 12" });
    expect(church[0].source.kind).toBe("CHURCH_BOOK");
  });

  it("Re-Import korrigiert Altbestand in place; in der App Geändertes bleibt", async () => {
    const sn = randomSurname();
    const { ids, text } = file(sn);
    await importText(`alt-${sn}`, text);
    const { citations } = await load(`${ids.uid}I1`);
    const linked = citations.find((c) => c.url)!;
    const evenCit = citations.find((c) => c.detail === "Geburtseintrag")!;
    const src = linked.source;
    // So hätte der frühere Import geschrieben (und sich gemerkt):
    const oldSource = { ...src, kind: "OTHER" as const, provider: null, url: null, notes: '<a id="" href="https://www.myheritage.de">www.myheritage.de</a> Diese Sammlung gehört MyHeritage.' };
    await prisma.source.update({ where: { id: src.id }, data: { kind: oldSource.kind, provider: null, url: null, notes: oldSource.notes } });
    await prisma.importLink.updateMany({ where: { sourceId: src.id }, data: { importHash: importFingerprint("SOURCE", oldSource) } });
    const oldCit = { ...linked, detail: "https://www.myheritage.de/research/collection-1/musterland-stammbaeume?itemId=4711&action=showRecord", url: null, confidence: "HIGH" as const };
    await prisma.citation.update({ where: { id: linked.id }, data: { detail: oldCit.detail, url: null, confidence: "HIGH" } });
    await prisma.importLink.updateMany({ where: { citationId: linked.id }, data: { importHash: importFingerprint("CITATION", oldCit) } });
    // … und dieser Beleg wurde danach in der App von Hand bewertet:
    const oldEven = { ...evenCit, fact: "OTHER" as const, confidence: null };
    await prisma.importLink.updateMany({ where: { citationId: evenCit.id }, data: { importHash: importFingerprint("CITATION", oldEven) } });
    await prisma.citation.update({ where: { id: evenCit.id }, data: { fact: "OTHER", confidence: "MEDIUM" } });

    const plan = await startGedcomImport(admin, { fileName: `test-src-alt-${sn}.ged`, bytes: Buffer.from(text, "utf8") });
    expect(plan.counts.sources.changed).toBe(1);
    expect(plan.counts.citations.changed).toBe(1);
    expect(plan.counts.citations.edited).toBe(1);
    const changed = (await listGedcomPlanItems(admin, plan.batchId, { kind: "citations", group: "changed" })).items[0];
    expect(changed.fields).toEqual(expect.arrayContaining(["detail", "confidence", "url"]));
    await applyGedcomImport(admin, plan.batchId, {});
    expect(await prisma.source.findUniqueOrThrow({ where: { id: src.id } })).toMatchObject({ kind: "ONLINE_TREE", provider: "MyHeritage", url: "https://www.myheritage.de/" });
    expect(await prisma.citation.findUniqueOrThrow({ where: { id: linked.id } })).toMatchObject({ detail: null, confidence: null, url: oldCit.detail });
    // von Hand Bewertetes bleibt
    expect(await prisma.citation.findUniqueOrThrow({ where: { id: evenCit.id } })).toMatchObject({ fact: "OTHER", confidence: "MEDIUM" });
  });

  it("aus der aufbewahrten Datei neu einlesen: neue Vorschau, Original des alten Laufs bleibt auch nach dem Verwerfen", async () => {
    const sn = randomSurname();
    const { text } = file(sn);
    const { plan } = await importText(`neu-${sn}`, text);
    const again = await rereadGedcomBatch(admin, plan.batchId);
    expect(again.batchId).not.toBe(plan.batchId);
    expect(again.isUpdate).toBe(true);
    expect(again.counts.persons.new).toBe(0);
    await expect(rereadGedcomBatch(admin, again.batchId)).rejects.toThrow(/Nur ausgeführte/);
    await discardGedcomPreview(admin, again.batchId);
    expect(await readImportBatchFile(admin, plan.batchId)).not.toBeNull();
    const editor = (await scopeForEmail("editor@example.test"))!;
    await expect(rereadGedcomBatch(editor, plan.batchId)).rejects.toThrow(/Berechtigung/);
  });
});
