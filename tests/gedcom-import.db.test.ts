/**
 * GEDCOM-Import gegen die Testdatenbank: Vorschau (schreibt nichts außer
 * Lauf und Plan), Import, erneuter Import (unverändert, in der Datei
 * geändert, in der App geändert, fehlend, neu, umnummeriert), zwei Bäume
 * nebeneinander, doppeltes Absenden, Familienzuordnung, Rechte, Vorschläge,
 * ungültige Beziehungen. Jeder Test benutzt einen eigenen Quell-Baum
 * (eigene _PROJECT_GUID und _UID) und räumt am Ende alles ab.
 * Nur erfundene Namen. Überspringt sich ohne Datenbank.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { createPerson, scopeForEmail, ServiceError, updatePerson } from "@/lib/services";
import {
  applyGedcomImport,
  getGedcomPlan,
  listGedcomPlanItems,
  listImportHistory,
  recomputeGedcomPreview,
  startGedcomImport,
  type GedcomPlanSummary,
} from "@/lib/services/gedcom-import";
import { buildGedcomExport } from "@/lib/services/gedcom-export";
import { parseGedcom } from "@/lib/gedcom";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] GEDCOM-Import-Tests übersprungen: ${skipReason}\n`);

type Variant = {
  guid: string;
  uid: string;
  /** Xref-Versatz (Umnummerierung). */
  offset?: number;
  hansBirth?: string;
  withLena?: boolean;
  withPaul?: boolean;
  sourceXref?: string;
  /** Dritter leiblicher Elternteil für Otto (ungültig). */
  thirdParent?: boolean;
};

/** Kleiner Baum im MyHeritage-Stil. */
function gedcom(v: Variant): string {
  const o = v.offset ?? 0;
  const x = (n: number) => `@I${n + o}@`;
  const s = v.sourceXref ?? "S1";
  const lines = [
    "0 HEAD",
    "1 GEDC",
    "2 VERS 5.5.1",
    "1 CHAR UTF-8",
    "1 SOUR MYHERITAGE",
    "2 NAME MyHeritage Family Tree Builder",
    `1 _PROJECT_GUID ${v.guid}`,
    `0 ${x(1)} INDI`,
    `1 _UID ${v.uid}01`,
    "1 NAME Hans /Probe/",
    "1 SEX M",
    "1 BIRT",
    `2 DATE ${v.hansBirth ?? "12 MAR 1850"}`,
    "2 PLAC Probstadt",
    `2 SOUR @${s}@`,
    "3 PAGE S. 12",
    "3 QUAY 3",
    "1 OCCU Schmied",
    "1 _MYTAG Zusatz",
    "1 FAMS @F1@",
    `0 ${x(2)} INDI`,
    `1 _UID ${v.uid}02`,
    "1 NAME Maria /Muster/",
    "2 _MARNM Probe",
    "1 SEX F",
    "1 BIRT",
    "2 DATE 1855",
    "1 FAMS @F1@",
    `0 ${x(3)} INDI`,
    `1 _UID ${v.uid}03`,
    "1 NAME Otto /Probe/",
    "1 SEX M",
    "1 BIRT",
    "2 DATE 1880",
    "1 FAMC @F1@",
  ];
  if (v.withLena !== false) {
    lines.push(`0 ${x(4)} INDI`, `1 _UID ${v.uid}04`, "1 NAME Lena /Probe/", "1 SEX F", "1 BIRT", "2 DATE 1882", "1 FAMC @F1@");
  }
  if (v.withPaul) lines.push(`0 ${x(5)} INDI`, `1 _UID ${v.uid}05`, "1 NAME Paul /Probe/", "1 SEX M", "1 BIRT", "2 DATE 1885", "1 FAMC @F1@");
  if (v.thirdParent) lines.push(`0 ${x(6)} INDI`, `1 _UID ${v.uid}06`, "1 NAME Fritz /Fremd/", "1 SEX M", "1 FAMS @F2@");
  lines.push("0 @F1@ FAM", `1 _UID ${v.uid}F1`, `1 HUSB ${x(1)}`, `1 WIFE ${x(2)}`, `1 CHIL ${x(3)}`);
  if (v.withLena !== false) lines.push(`1 CHIL ${x(4)}`);
  if (v.withPaul) lines.push(`1 CHIL ${x(5)}`);
  lines.push("1 MARR", "2 DATE 1878");
  if (v.thirdParent) lines.push("0 @F2@ FAM", `1 HUSB ${x(6)}`, `1 CHIL ${x(3)}`);
  lines.push(`0 @${s}@ SOUR`, "1 TITL Kirchenbuch Probstadt", "1 AUTH Pfarramt", "0 TRLR", "");
  return lines.join("\r\n");
}

const CRLF = "\r\n";

const newVariant = (): Variant => {
  const id = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return { guid: `TEST-${id}`, uid: `T${id}` };
};

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}
const bytes = (v: Variant) => Buffer.from(gedcom(v), "utf8");
const persons = (p: GedcomPlanSummary) => p.counts.persons;

describe.skipIf(Boolean(skipReason))("GEDCOM-Import (Testdatenbank)", () => {
  const trees: string[] = [];
  const families: string[] = [];
  const manualPersons: string[] = [];
  const startedAt = new Date();
  let mediaDir = "";
  let previousMediaDir: string | undefined;
  let admin: Scope;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "gedcom-import-test-"));
    process.env.MEDIA_DIR = mediaDir;
    admin = await scope("admin@example.test");
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    const batches = await prisma.importBatch.findMany({ where: { createdAt: { gte: startedAt }, fileName: { startsWith: "test-" } }, select: { id: true, sourceTreeId: true } });
    const treeIds = [...new Set([...trees, ...batches.map((b) => b.sourceTreeId).filter((x): x is string => Boolean(x))])];
    const links = await prisma.importLink.findMany({ where: { sourceTreeId: { in: treeIds } }, select: { personId: true, sourceId: true } });
    await prisma.person.deleteMany({ where: { id: { in: [...links.map((l) => l.personId).filter((x): x is string => Boolean(x)), ...manualPersons] } } });
    await prisma.source.deleteMany({ where: { id: { in: links.map((l) => l.sourceId).filter((x): x is string => Boolean(x)) } } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((b) => b.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, userId: { in: ["mock-user-admin", "mock-user-viewer"] } } });
    await prisma.$disconnect();
  });

  async function importFile(v: Variant, decisions: Record<string, unknown> = {}, choice?: Parameters<typeof startGedcomImport>[2]) {
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes(v) }, choice);
    trees.push(plan.sourceTreeId);
    const result = await applyGedcomImport(admin, plan.batchId, decisions);
    return { plan, result };
  }
  const personByUid = async (uid: string) => {
    const x = await prisma.externalId.findFirst({ where: { system: "UID", value: uid, personId: { not: null } }, include: { person: true } });
    return x!.person!;
  };

  it("Erstimport: Vorschau schreibt nichts, Import legt alles an", async () => {
    const v = newVariant();
    const before = await prisma.person.count();
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes(v) });
    trees.push(plan.sourceTreeId);
    expect(await prisma.person.count()).toBe(before);
    expect(plan.treeMode).toBe("detected");
    expect(plan.isUpdate).toBe(false);
    expect(persons(plan).new).toBe(4);
    expect(plan.counts.relationships.new).toBe(5); // 1 Paar + 4 Eltern-Kind
    expect(plan.lossless.lost).toBe(0);
    const items = await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "new", limit: 2 });
    expect(items.total).toBe(4);
    expect(items.items).toHaveLength(2);

    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(4);
    expect(r.counts.events.created).toBe(1);
    expect(r.counts.citations.created).toBe(1);
    const maria = await personByUid(`${v.uid}02`);
    expect(maria).toMatchObject({ givenName: "Maria", familyName: "Probe", birthName: "Muster" });
    const raw = await prisma.importRawRecord.findMany({ where: { personId: (await personByUid(`${v.uid}01`)).id } });
    expect(JSON.stringify(raw.map((x) => x.content))).toContain("_MYTAG");
    const rel = await prisma.relationship.findFirst({ where: { type: "PARTNER_OF", fromPersonId: { in: [maria.id] } } });
    const rel2 = rel ?? (await prisma.relationship.findFirst({ where: { type: "PARTNER_OF", toPersonId: maria.id } }));
    expect(rel2?.subtype).toBe("MARRIED");
  });

  it("zweiter Import derselben Datei: alles unverändert, keine doppelten Kennungen/Rohdaten", async () => {
    const v = newVariant();
    await importFile(v);
    const { plan, result } = await importFile(v);
    expect(plan.isUpdate).toBe(true);
    for (const k of Object.values(plan.counts)) {
      expect(k.new + k.changed + k.edited + k.missing + k.invalid).toBe(0);
    }
    expect(result.externalIds).toBe(0);
    expect(result.rawRecords).toBe(0);
    expect(result.counts.persons.unchanged).toBe(4);
  });

  it("in der Datei geändert → aktualisiert; in der App geändert → behalten; auf Wunsch Dateiversion", async () => {
    const v = newVariant();
    await importFile(v);
    const hans = await personByUid(`${v.uid}01`);
    const otto = await personByUid(`${v.uid}03`);
    await updatePerson(admin, otto.id, { birthPlace: "In der App korrigiert" });

    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, hansBirth: "13 MAR 1850" }) });
    expect(persons(plan).changed).toBe(1);
    expect(persons(plan).edited).toBe(1);
    const changed = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "changed" })).items[0];
    expect(changed.appId).toBe(hans.id);
    expect(changed.fields).toContain("birthDate");
    const edited = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "edited" })).items[0];
    expect(edited).toMatchObject({ appId: otto.id, conflict: false });

    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.updated).toBe(1);
    expect(r.counts.persons.skippedEdited).toBe(1);
    expect((await prisma.person.findUnique({ where: { id: hans.id } }))!.birthDate!.toISOString()).toBe("1850-03-13T00:00:00.000Z");
    expect((await prisma.person.findUnique({ where: { id: otto.id } }))!.birthPlace).toBe("In der App korrigiert");

    // Nächster Lauf: Otto weiter „in der App geändert“, ohne Konflikt; jetzt Dateiversion übernehmen
    const again = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, hansBirth: "13 MAR 1850" }) });
    expect(persons(again).edited).toBe(1);
    expect(persons(again).changed).toBe(0);
    const r2 = await applyGedcomImport(admin, again.batchId, { edited: { default: "keep", overrides: { [`UID:${v.uid}03`]: "file" } } });
    expect(r2.counts.persons.updated).toBe(1);
    expect((await prisma.person.findUnique({ where: { id: otto.id } }))!.birthPlace).toBeNull();
  });

  it("beide geändert: Konflikt wird angezeigt", async () => {
    const v = newVariant();
    await importFile(v);
    const hans = await personByUid(`${v.uid}01`);
    await updatePerson(admin, hans.id, { birthPlace: "App" });
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, hansBirth: "1849" }) });
    const edited = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "edited" })).items[0];
    expect(edited).toMatchObject({ appId: hans.id, conflict: true });
    expect(edited.fields).toEqual(expect.arrayContaining(["birthDate", "birthPlace"]));
  });

  it("fehlt in der Quelle: behalten und markieren, löschen nur auf Wunsch", async () => {
    const v = newVariant();
    await importFile(v);
    const lena = await personByUid(`${v.uid}04`);
    const { plan, result } = await importFile({ ...v, withLena: false });
    expect(persons(plan).missing).toBe(1);
    expect(result.markedMissing).toBeGreaterThanOrEqual(1);
    const link = await prisma.importLink.findFirst({ where: { personId: lena.id } });
    expect(link?.missingSinceBatchId).toBe(plan.batchId);
    // Beziehungen der fehlenden Person werden nicht einzeln gelistet
    expect(plan.counts.relationships.missing).toBe(0);

    const p2 = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, withLena: false }) });
    const missing = (await listGedcomPlanItems(admin, p2.batchId, { kind: "persons", group: "missing" })).items;
    expect(missing).toHaveLength(1);
    const r = await applyGedcomImport(admin, p2.batchId, { missing: { delete: [missing[0].ref] } });
    expect(r.deleted).toEqual([{ kind: "persons", count: 1 }]);
    expect(await prisma.person.findUnique({ where: { id: lena.id } })).toBeNull();
  });

  it("neue Personen im bestehenden Baum; umnummerierte Xrefs mit stabiler _UID; umnummerierte Quelle", async () => {
    const v = newVariant();
    await importFile(v);
    const { plan, result } = await importFile({ ...v, offset: 100, withPaul: true, sourceXref: "S7" });
    expect(persons(plan)).toMatchObject({ new: 1, unchanged: 4, missing: 0 });
    expect(plan.counts.sources).toMatchObject({ unchanged: 1, new: 0, missing: 0 });
    expect(plan.counts.citations.missing + plan.counts.citations.new).toBe(0);
    expect(result.counts.persons.created).toBe(1);
  });

  it("zwei unabhängige Bäume nebeneinander; gleiche _UID in einem „neuen“ Baum wird nicht zusammengeführt", async () => {
    const a = newVariant();
    const b = newVariant();
    await importFile(a);
    const { plan } = await importFile(b);
    expect(persons(plan).new).toBe(4);
    const again = await startGedcomImport(admin, { fileName: `test-${a.guid}.ged`, bytes: bytes(a) }, { mode: "new" });
    trees.push(again.sourceTreeId);
    expect(again.treeMode).toBe("new");
    expect(persons(again).new).toBe(4);
    expect(again.otherTreeHits).toBe(4);
    // Wahl umstellen: Aktualisierung des ersten Baums
    const switched = await recomputeGedcomPreview(admin, again.batchId, { mode: "existing", sourceTreeId: `MYHERITAGE:PROJECT:${a.guid}` });
    expect(persons(switched).unchanged).toBe(4);
  });

  it("doppeltes Absenden: nur ein Lauf schreibt", async () => {
    const v = newVariant();
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes(v) });
    trees.push(plan.sourceTreeId);
    const [x, y] = await Promise.all([applyGedcomImport(admin, plan.batchId, {}), applyGedcomImport(admin, plan.batchId, {})]);
    expect([x.alreadyApplied, y.alreadyApplied].sort()).toEqual([false, true]);
    const n = await prisma.importLink.count({ where: { sourceTreeId: plan.sourceTreeId, entityType: "PERSON" } });
    expect(n).toBe(4);
    expect((await getGedcomPlan(admin, plan.batchId)).status).toBe("COMPLETED");
  });

  it("Familienzuordnung: neue Familie für neue Personen, Bestand bleibt; Privatsphäre-Personen ohne Familie", async () => {
    const v = newVariant();
    const name = `Testfamilie ${v.guid}`;
    const { result } = await importFile(v, { family: { mode: "new", name } });
    families.push(result.familyId!);
    const hans = await personByUid(`${v.uid}01`);
    expect((await prisma.personFamily.findMany({ where: { personId: hans.id } })).map((f) => f.familyId)).toEqual([result.familyId]);
    // Re-Import mit anderer Familie: bestehende Personen behalten ihre Familie, neue bekommen die gewählte
    const other = await prisma.family.findFirstOrThrow({ where: { id: { not: result.familyId! } } });
    await importFile({ ...v, withPaul: true }, { family: { mode: "existing", familyIds: [other.id] } });
    expect((await prisma.personFamily.findMany({ where: { personId: hans.id } })).map((f) => f.familyId)).toEqual([result.familyId]);
    const paul = await personByUid(`${v.uid}05`);
    expect((await prisma.personFamily.findMany({ where: { personId: paul.id } })).map((f) => f.familyId)).toEqual([other.id]);
    await expect(importFile(newVariant(), { family: { mode: "new", name } })).rejects.toThrow(/gibt es schon/);
  });

  it("Privatsphäre-Markierung: Anzahl in der Vorschau, auf Wunsch ohne Familie", async () => {
    const v = newVariant();
    const text = gedcom(v).replace("1 NAME Lena /Probe/", "1 NAME Lena /Probe/\r\n1 RESN privacy");
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    trees.push(plan.sourceTreeId);
    expect(plan.privacy.marked).toBe(1);
    const fam = await prisma.family.findFirstOrThrow();
    await applyGedcomImport(admin, plan.batchId, { family: { mode: "existing", familyIds: [fam.id] }, privacyUnassigned: true });
    expect(await prisma.personFamily.count({ where: { personId: (await personByUid(`${v.uid}04`)).id } })).toBe(0);
    expect(await prisma.personFamily.count({ where: { personId: (await personByUid(`${v.uid}01`)).id } })).toBe(1);
  });

  it("ungültige Beziehung (dritter leiblicher Elternteil) erscheint in der Vorschau, Rest wird importiert", async () => {
    const v = newVariant();
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, thirdParent: true }) });
    trees.push(plan.sourceTreeId);
    expect(plan.counts.relationships.invalid).toBe(1);
    const inv = (await listGedcomPlanItems(admin, plan.batchId, { group: "invalid" })).items[0];
    expect(inv.reason).toMatch(/leibliche/);
    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.persons.created).toBe(5);
    expect(r.counts.relationships.invalid).toBe(1);
  });

  it("abgelehnte Partnerschaft (Kind ⚭ Mutter): Abstammung bleibt, Original samt Ereignissen bei einer Person, Export enthält die Familie", async () => {
    const v = newVariant();
    // F2: Otto (Kind aus F1) als Partner seiner Mutter Maria, mit Heirat und Wohnort-Ereignis.
    const text = gedcom(v).replace(
      "0 @S1@ SOUR",
      ["0 @F2@ FAM", `1 _UID ${v.uid}F2`, "1 HUSB @I3@", "1 WIFE @I2@", "1 MARR", "2 DATE 1905", "2 PLAC Fernstadt", "1 RESI", "2 PLAC Fernstadt", "2 SOUR @S1@", "3 PAGE S. 99", "0 @S1@ SOUR"].join(CRLF),
    );
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    trees.push(plan.sourceTreeId);
    expect(plan.counts.relationships.invalid).toBe(1);
    const inv = (await listGedcomPlanItems(admin, plan.batchId, { kind: "relationships", group: "invalid" })).items[0];
    expect(inv.label).toMatch(/Otto.*⚭.*Maria|Maria.*⚭.*Otto/);
    expect(inv.reason).toMatch(/Eltern und Kind können nicht als Partner verbunden werden — nicht übernehmbar, Original bleibt bei .+ erhalten$/);
    const invEvents = (await listGedcomPlanItems(admin, plan.batchId, { kind: "events", group: "invalid" })).items;
    expect(invEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of invEvents) expect(e.reason).toMatch(/Original bleibt bei .+ erhalten/);

    const r = await applyGedcomImport(admin, plan.batchId, {});
    expect(r.counts.relationships.invalid).toBe(1);
    const otto = await personByUid(`${v.uid}03`);
    const maria = await personByUid(`${v.uid}02`);
    // Die Abstammung (Maria → Otto) blieb, die widersprüchliche Partnerschaft nicht.
    expect(await prisma.relationship.count({ where: { type: "PARENT_OF", fromPersonId: maria.id, toPersonId: otto.id } })).toBe(1);
    expect(await prisma.relationship.count({ where: { type: "PARTNER_OF", OR: [{ fromPersonId: otto.id }, { toPersonId: otto.id }] } })).toBe(0);
    // Original der Familie F2 liegt aktiv bei einer der beiden Personen, mit Vermerk.
    const kept = await prisma.importRawRecord.findMany({ where: { personId: { in: [otto.id, maria.id] }, recordType: "GEDCOM_FAM:ABGELEHNT", xref: "F2", supersededAt: null } });
    expect(kept).toHaveLength(1);
    expect(kept[0].reason).toMatch(/^Partnerschaft nicht übernehmbar \(Eltern und Kind können nicht als Partner verbunden werden\) — Original bleibt bei dieser Person erhalten$/);
    expect(JSON.stringify(kept[0].content)).toContain("Fernstadt");
    expect((kept[0].content as { rejected?: { type: string } }).rejected?.type).toBe("PARTNER_OF");

    // Erneuter Import derselben Datei legt das Original nicht doppelt ab.
    const plan2 = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    await applyGedcomImport(admin, plan2.batchId, {});
    expect(await prisma.importRawRecord.count({ where: { personId: { in: [otto.id, maria.id] }, recordType: "GEDCOM_FAM:ABGELEHNT", xref: "F2", supersededAt: null } })).toBe(1);

    // Export: die Familie steht wieder drin — beide Partner, Heirat 1905 in Fernstadt, Wohnort mit Beleg; ohne Kinder.
    const doc = parseGedcom((await buildGedcomExport(admin)).bytes).document;
    const uidOf = (p: { externalIds: { type: string; value: string }[] }) => p.externalIds.find((x) => x.type === "UID")?.value;
    const ottoOut = doc.persons.find((p) => uidOf(p) === `${v.uid}03`)!;
    const mariaOut = doc.persons.find((p) => uidOf(p) === `${v.uid}02`)!;
    const fam = doc.families.find((f) => f.partners.includes(ottoOut.id) && f.partners.includes(mariaOut.id));
    expect(fam).toBeTruthy();
    expect(fam!.children).toHaveLength(0);
    const marr = fam!.events.find((e) => e.type === "MARRIAGE");
    expect(marr?.date?.original).toBe("1905");
    expect(marr?.place?.name).toBe("Fernstadt");
    const resi = fam!.events.find((e) => e.type === "RESIDENCE");
    expect(resi?.citations[0]?.sourceId).toBeTruthy();
    expect(doc.sources.some((s) => s.id === resi!.citations[0].sourceId)).toBe(true);
    // Otto bleibt Kind von Maria (FAMC der eigentlichen Familie).
    expect(doc.families.some((f) => f.partners.includes(mariaOut.id) && f.children.some((c) => c.childId === ottoOut.id))).toBe(true);
  });

  it("Vorschlag für von Hand angelegte Person; nur nach Bestätigung zugeordnet", async () => {
    const v = newVariant();
    const surname = `Vorschlag${v.uid.slice(1, 7)}`;
    const manual = await createPerson(admin, { givenName: "Hans", familyName: surname, gender: "MALE", birthDate: "1850-03-12" });
    manualPersons.push(manual.id);
    const text = gedcom(v).replace("1 NAME Hans /Probe/", `1 NAME Hans /${surname}/`);
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    trees.push(plan.sourceTreeId);
    expect(plan.suggestions).toBeGreaterThanOrEqual(1);
    const item = (await listGedcomPlanItems(admin, plan.batchId, { kind: "persons", group: "new", q: surname })).items[0];
    expect(item.suggestions?.[0].personId).toBe(manual.id);
    const r = await applyGedcomImport(admin, plan.batchId, { suggestions: { [item.ref]: { personId: manual.id, mode: "link" } } });
    expect(r.counts.persons.created).toBe(3);
    const link = await prisma.importLink.findFirst({ where: { personId: manual.id } });
    expect(link?.sourceTreeId).toBe(plan.sourceTreeId);
    // App-Werte behalten (Geburtsort war leer, Datei hat einen)
    expect((await prisma.person.findUnique({ where: { id: manual.id } }))!.birthPlace).toBeNull();
    expect(await prisma.event.count({ where: { personId: manual.id, type: "OCCUPATION" } })).toBe(1);
  });

  it("Export: Roundtrip (Fakten, fremde Tags) und Sichtbarkeit (verborgene Person samt Verweisen fehlt)", async () => {
    const v = newVariant();
    const viewer = await scope("viewer@example.test");
    const famId = [...viewer.families.keys()][0];
    const text = gedcom(v).replace("1 NAME Lena /Probe/", "1 NAME Lena /Probe/\r\n1 RESN privacy");
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    trees.push(plan.sourceTreeId);
    await applyGedcomImport(admin, plan.batchId, { family: { mode: "existing", familyIds: [famId] }, privacyUnassigned: true });

    const uidOf = (p: { externalIds: { type: string; value: string }[] }) => p.externalIds.find((x) => x.type === "UID")?.value;
    const asAdmin = parseGedcom((await buildGedcomExport(admin)).bytes);
    const mine = asAdmin.document.persons.filter((p) => uidOf(p)?.startsWith(v.uid));
    expect(mine).toHaveLength(4);
    const maria = mine.find((p) => uidOf(p) === `${v.uid}02`)!;
    expect(maria.names[0]).toMatchObject({ given: "Maria", surname: "Muster", marriedSurnames: ["Probe"] });
    const hans = mine.find((p) => uidOf(p) === `${v.uid}01`)!;
    const birth = hans.events.find((e) => e.type === "BIRTH")!;
    expect(birth.date?.original).toBe("12 MAR 1850");
    expect(birth.citations[0]).toMatchObject({ page: "S. 12", quality: 3 });
    expect(hans.events.some((e) => e.type === "OCCUPATION" && e.value === "Schmied")).toBe(true);
    expect(hans.extensions.some((e) => e.node.tag === "_MYTAG")).toBe(true);
    const lena = mine.find((p) => uidOf(p) === `${v.uid}04`)!;
    expect(lena.privacy.restrictions).toEqual(["privacy"]);
    const couple = asAdmin.document.families.find((f) => f.partners.includes(hans.id) && f.partners.length === 2)!;
    expect(couple.status).toBe("MARRIED");
    expect(couple.children).toHaveLength(2);
    expect(couple.externalIds.some((x) => x.type === "UID" && x.value === `${v.uid}F1`)).toBe(true);

    const asViewer = parseGedcom((await buildGedcomExport(viewer)).bytes);
    const seen = asViewer.document.persons.filter((p) => uidOf(p)?.startsWith(v.uid));
    expect(seen).toHaveLength(3);
    expect(asViewer.warnings.filter((w) => w.code === "DANGLING_POINTER")).toHaveLength(0);
    const vCouple = asViewer.document.families.find((f) => f.children.length && seen.some((p) => f.partners.includes(p.id)))!;
    expect(vCouple.children).toHaveLength(1);
  });

  it("Fotos: nur auf Wunsch, über den SSRF-Schutz, verarbeitet, Hauptbild, kein zweites Mal", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#884422" } }).png().toBuffer();
    const v = newVariant();
    const text = gedcom(v)
      .replace("1 NAME Otto /Probe/", ["1 NAME Otto /Probe/", "1 OBJE", "2 FORM jpg", "2 FILE https://bilder.example.test/otto.jpg", "2 _PRIM Y", "2 _PHOTO_RIN MH:P1"].join(CRLF))
      .replace("1 NAME Lena /Probe/", ["1 NAME Lena /Probe/", "1 OBJE", "2 FILE https://intern.example.test/lena.jpg", "1 OBJE", "2 FILE C:/Bilder/lena.jpg"].join(CRLF));
    const requested: string[] = [];
    const photoFetch = {
      resolver: async (host: string) => [{ address: host.startsWith("intern") ? "192.168.0.10" : "93.184.216.34", family: 4 as const }],
      transport: async (req: { url: URL }) => {
        requested.push(req.url.toString());
        return { status: 200, headers: { "content-type": "image/png" }, body: (await import("node:stream")).Readable.from([png]), destroy: () => {} };
      },
    };
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    trees.push(plan.sourceTreeId);
    expect(plan.photos).toMatchObject({ total: 2, localPaths: 1 });
    expect(requested).toHaveLength(0); // Vorschau holt nie etwas
    const r = await applyGedcomImport(admin, plan.batchId, { downloadPhotos: true }, { photoFetch });
    expect(r.photos).toMatchObject({ requested: 2, stored: 1 });
    expect(r.photos!.failed[0].message).toMatch(/internen Netz/);
    expect(requested).toEqual(["https://bilder.example.test/otto.jpg"]);
    const otto = await personByUid(`${v.uid}03`);
    const pm = await prisma.personMedia.findMany({ where: { personId: otto.id }, include: { media: true } });
    expect(pm).toHaveLength(1);
    expect(pm[0]).toMatchObject({ isPrimary: true, media: { mimeType: "image/webp", width: 40, height: 30 } });
    expect(await prisma.importLink.count({ where: { mediaId: pm[0].mediaId, externalKey: "PHOTO:MH:P1" } })).toBe(1);
    const batch = await prisma.importBatch.findUnique({ where: { id: plan.batchId } });
    expect(JSON.stringify(batch?.counts)).toContain("bilder.example.test/otto.jpg"); // jede Adresse im Lauf protokolliert
    // Export: Bild als Dateiverweis, nicht mehr als fremde Adresse
    const out = parseGedcom((await buildGedcomExport(admin)).bytes).document.persons.find((p) => p.externalIds.some((x) => x.value === `${v.uid}03`))!;
    expect(out.media.map((m) => m.inline?.files[0].location)).toEqual([expect.stringMatching(/^media\/.+\.webp$/)]);
    // Erneuter Import: schon gespeichert → nicht erneut geholt
    const p2 = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: Buffer.from(text) });
    const r2 = await applyGedcomImport(admin, p2.batchId, { downloadPhotos: true }, { photoFetch });
    expect(r2.photos).toMatchObject({ stored: 0, skipped: 1 });
    expect(requested).toHaveLength(1);
    await prisma.mediaAsset.deleteMany({ where: { id: pm[0].mediaId } });
  });

  it("Vorschauen: verwerfen (Lauf, Plan, Datei), gleiche Datei ersetzt alte Vorschau, alte verfallen, Ausgeführtes bleibt", async () => {
    const { discardGedcomPreview, discardStalePreviews } = await import("@/lib/services/gedcom-import");
    const { getObjectBuffer } = await import("@/lib/storage");
    const v = newVariant();
    const applied = await importFile(v);
    const appliedBatch = (await prisma.importBatch.findUnique({ where: { id: applied.plan.batchId } }))!;
    await expect(discardGedcomPreview(admin, appliedBatch.id)).rejects.toThrow(/ausgeführter Import/);

    const first = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, withPaul: true }) });
    const firstKey = (await prisma.importBatch.findUnique({ where: { id: first.batchId } }))!.storageKey!;
    expect(await getObjectBuffer(firstKey)).not.toBeNull();
    // dieselbe Datei erneut hochgeladen: die alte Vorschau verschwindet samt Datei und Plan
    const second = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, withPaul: true }) });
    expect(await prisma.importBatch.findUnique({ where: { id: first.batchId } })).toBeNull();
    expect(await getObjectBuffer(firstKey)).toBeNull();
    expect(await getObjectBuffer(`imports/${first.batchId}.plan.json`)).toBeNull();
    // ausdrücklich verwerfen
    const secondKey = (await prisma.importBatch.findUnique({ where: { id: second.batchId } }))!.storageKey!;
    await discardGedcomPreview(admin, second.batchId);
    expect(await prisma.importBatch.findUnique({ where: { id: second.batchId } })).toBeNull();
    expect(await getObjectBuffer(secondKey)).toBeNull();
    // alt: nach 7 Tagen verworfen
    const old = await startGedcomImport(admin, { fileName: `test-${v.guid}.ged`, bytes: bytes({ ...v, withPaul: true, hansBirth: "1851" }) });
    await prisma.importBatch.update({ where: { id: old.batchId }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await discardStalePreviews(admin, {})).toBeGreaterThanOrEqual(1);
    expect(await prisma.importBatch.findUnique({ where: { id: old.batchId } })).toBeNull();
    // der ausgeführte Lauf und seine Originaldatei bleiben unberührt
    expect(await prisma.importBatch.findUnique({ where: { id: appliedBatch.id } })).not.toBeNull();
    expect(await getObjectBuffer(appliedBatch.storageKey!)).not.toBeNull();
    // Rechte
    const viewer = await scope("viewer@example.test");
    await expect(discardGedcomPreview(viewer, appliedBatch.id)).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === "FORBIDDEN");
  });

  it("Rechte: nur Administratoren", async () => {
    const viewer = await scope("viewer@example.test");
    const v = newVariant();
    await expect(startGedcomImport(viewer, { fileName: "test-x.ged", bytes: bytes(v) })).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === "FORBIDDEN",
    );
    await expect(applyGedcomImport(viewer, "irgendwas", {})).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === "FORBIDDEN");
    await expect(listImportHistory(viewer)).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === "FORBIDDEN");
    await expect(listGedcomPlanItems(viewer, "x", {})).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === "FORBIDDEN");
  });

  it("ZIP mit einer .ged wird gelesen; Verlauf listet die Läufe", async () => {
    const JSZip = (await import("jszip")).default;
    const v = newVariant();
    const zip = new JSZip();
    zip.file("export/baum.ged", gedcom(v));
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const plan = await startGedcomImport(admin, { fileName: `test-${v.guid}.zip`, bytes: buf });
    trees.push(plan.sourceTreeId);
    expect(persons(plan).new).toBe(4);
    await applyGedcomImport(admin, plan.batchId, {});
    const history = await listImportHistory(admin, 200);
    const entry = history.find((h) => h.id === plan.batchId)!;
    expect(entry).toMatchObject({ status: "COMPLETED", hasFile: true, format: "GEDCOM" });
    expect(entry.summary?.created).toBeGreaterThan(0);
  });
});
