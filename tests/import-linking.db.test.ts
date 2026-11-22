/**
 * Importe verbinden gegen die Testdatenbank: zwei Importe derselben Familie
 * (je mit eigenen Verwandten) → Abgleich, gemeinsame Vorschau, Zusammenführen
 * im Hintergrund, Verwandtschaftsweg und Fokusansicht über die frühere
 * Grenze, erneuter Import beider Dateien still, Fortsetzen nach
 * Unterbrechung ohne Doppeltes. Erfundene Namen; räumt auf.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { findRelationshipPath, getKinship, scopeForEmail } from "@/lib/services";
import { loadFocusTree } from "@/lib/services/tree";
import { applyGedcomImport, startGedcomImport } from "@/lib/services/gedcom-import";
import {
  decideConnectPairs,
  getConnectRun,
  startConnectApply,
  startConnectPreview,
  startConnectRun,
  waitForConnectRun,
} from "@/lib/services/import-linking";
import { putObject } from "@/lib/storage";
import { buildGedcom, newTreeIds, randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();

/** Import A: Großeltern → Hans; Import B: Hans und Maria → Otto → Enkel Paul. Hans/Maria mit gleichen genauen Daten in beiden. */
function files(sn: string) {
  const a = newTreeIds();
  const b = newTreeIds();
  const fileA = buildGedcom(
    a,
    [
      { key: "I1", given: "Gottlieb", surname: sn, sex: "M", birth: "4 JAN 1820", death: "9 SEP 1880", fams: ["F1"] },
      { key: "I2", given: "Hans", surname: sn, sex: "M", birth: "12 MAR 1850", death: "1 JUN 1910", famc: "F1", fams: ["F2"] },
      { key: "I3", given: "Maria", surname: "Musterin", marriedName: sn, sex: "F", birth: "3 MAY 1855", death: "2 FEB 1920", fams: ["F2"] },
    ],
    [
      { key: "F1", husb: "I1", children: ["I2"] },
      { key: "F2", husb: "I2", wife: "I3", children: [], marr: "1878" },
    ],
  );
  const fileB = buildGedcom(
    b,
    [
      { key: "I7", given: "Hans", surname: sn, sex: "M", birth: "12 MAR 1850", death: "1 JUN 1910", fams: ["F4"] },
      { key: "I8", given: "Maria", surname: sn, sex: "F", birth: "3 MAY 1855", death: "2 FEB 1920", fams: ["F4"] },
      { key: "I9", given: "Otto", surname: sn, sex: "M", birth: "1880", famc: "F4", fams: ["F5"] },
      { key: "I10", given: "Paul", surname: sn, sex: "M", birth: "1910", famc: "F5" },
    ],
    [
      { key: "F4", husb: "I7", wife: "I8", children: ["I9"] },
      { key: "F5", husb: "I9", children: ["I10"] },
    ],
  );
  return { a, b, fileA, fileB };
}

describe.skipIf(Boolean(skipReason))("Importe verbinden (Testdatenbank)", () => {
  const trees: string[] = [];
  const families: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "connect-test-"));
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
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((x) => x.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((x) => x.id) } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, userId: "mock-user-admin" } });
    await prisma.$disconnect();
  });

  async function importFile(name: string, text: string, family: string) {
    const plan = await startGedcomImport(admin, { fileName: `test-connect-${name}.ged`, bytes: Buffer.from(text, "utf8") });
    trees.push(plan.sourceTreeId);
    const r = await applyGedcomImport(admin, plan.batchId, { family: { mode: "new", name: family } });
    if (r.familyId) families.push(r.familyId);
    return plan.sourceTreeId;
  }
  const uid = async (v: string) => (await prisma.externalId.findFirstOrThrow({ where: { system: "UID", value: v, personId: { not: null } } })).personId!;

  it("abgleichen, Vorschau, zusammenführen, über die Grenze verwandt, Re-Import still, Fortsetzen ohne Doppeltes", async () => {
    const sn = randomSurname();
    const { a, b, fileA, fileB } = files(sn);
    const treeA = await importFile(`A-${sn}`, fileA, `Verbinden A ${sn}`);
    const treeB = await importFile(`B-${sn}`, fileB, `Verbinden B ${sn}`);
    const gottlieb = await uid(`${a.uid}I1`);
    const hansA = await uid(`${a.uid}I2`);
    const hansB = await uid(`${b.uid}I7`);
    const paul = await uid(`${b.uid}I10`);
    expect((await findRelationshipPath(admin, gottlieb, paul))?.found).toBe(false);

    const editor = (await scopeForEmail("editor@example.test"))!;
    await expect(startConnectRun(editor, {})).rejects.toThrow(/Berechtigung/);

    const run = await startConnectRun(admin, { groups: [treeA, treeB] });
    const ready = await waitForConnectRun(admin, run.id);
    expect(ready.status).toBe("ready");
    const view = await getConnectRun(admin, run.id, { limit: 200 });
    const pairHans = view.pairs!.find((p) => [p.a.id, p.b.id].sort().join() === [hansA, hansB].sort().join());
    expect(pairHans).toMatchObject({ confidence: "high", decision: "accept" });
    expect(view.components!.afterSure).toBeLessThan(view.components!.before);
    expect(view.bridges!.length).toBeGreaterThan(0);

    await startConnectPreview(admin, run.id);
    const previewed = await waitForConnectRun(admin, run.id);
    expect(previewed.status).toBe("previewed");
    expect(previewed.preview!.persons).toBeGreaterThanOrEqual(2);
    expect(previewed.preview!.widerVisibility).toBeGreaterThanOrEqual(1);
    expect(previewed.preview!.blocked).toEqual([]);

    await startConnectApply(admin, run.id);
    const done = await waitForConnectRun(admin, run.id);
    expect(done.status).toBe("done");
    expect(done.apply!.merged).toBeGreaterThanOrEqual(2);
    expect(done.followUpId).toBeTruthy();
    const keptHans = (await prisma.person.findUnique({ where: { id: hansA } })) ? hansA : hansB;
    // über die frühere Grenze verwandt
    const pathGP = await findRelationshipPath(admin, gottlieb, paul);
    expect(pathGP?.found).toBe(true);
    expect((await getKinship(admin, gottlieb, paul))?.summary).toMatch(/Urenkel/);
    // Fokusansicht der Verbindungsperson zeigt Verwandte aus beiden Importen
    const focus = await loadFocusTree(admin, { focusId: keptHans, up: 2, down: 2 });
    const ids = new Set(focus.tree!.persons.map((p) => p.id));
    expect(ids.has(gottlieb)).toBe(true);
    expect(ids.has(paul)).toBe(true);

    // Re-Import beider Dateien: still
    for (const [name, text] of [
      [`A-${sn}`, fileA],
      [`B-${sn}`, fileB],
    ]) {
      const plan = await startGedcomImport(admin, { fileName: `test-connect-${name}.ged`, bytes: Buffer.from(text, "utf8") });
      for (const c of Object.values(plan.counts)) {
        expect(c.new + c.missing + c.invalid + c.changed + c.edited).toBe(0);
      }
      await applyGedcomImport(admin, plan.batchId, {});
    }

    // Unterbrechung simulieren: Lauf steht auf „applying“, nichts erledigt → Fortsetzen ist idempotent
    const count = await prisma.person.count();
    await putObject(`connect/${run.id}.json`, Buffer.from(JSON.stringify({ ...done, status: "applying", apply: { ...done.apply!, done: 0 }, followUpId: undefined }), "utf8"));
    const again = await getConnectRun(admin, run.id);
    expect(again.interrupted).toBe(true);
    await startConnectApply(admin, run.id);
    const resumed = await waitForConnectRun(admin, run.id);
    expect(resumed.status).toBe("done");
    expect(resumed.apply!.failed).toEqual([]);
    expect(await prisma.person.count()).toBe(count);
    await waitForConnectRun(admin, resumed.followUpId!);
  }, 120_000);

  it("Entscheidungen: verwerfen und „kein Duplikat“", async () => {
    const run = await startConnectRun(admin, {});
    await waitForConnectRun(admin, run.id);
    const v = await getConnectRun(admin, run.id, { limit: 5 });
    if (!v.pairs!.length) return;
    const key = v.pairs![0].key;
    const r = await decideConnectPairs(admin, run.id, { reject: [key] });
    expect(r.accepted).toBe(v.accepted - (v.pairs![0].decision === "accept" ? 1 : 0));
  });
});
