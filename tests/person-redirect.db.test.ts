/**
 * Alte Kennung als Umleitung (PersonRedirect) gegen die Testdatenbank:
 * - Das Zusammenführen legt X → K an und biegt bestehende … → X auf K um
 *   (einzeln, gesammelt, Kette A → B → C, „Importe verbinden“).
 * - Aufgelöst wird nur für Benutzer, die die bleibende Person sehen dürfen;
 *   wird sie gelöscht, gibt es keine Umleitung mehr.
 * - Rückfüllung aus dem Audit: Nach Zusammenführungen OHNE Umleitungstabelle
 *   (Stand des veröffentlichten Codes — die Tabelle wird dazu geleert, das
 *   Audit ist unverändert) entsteht genau, was das Zusammenführen selbst
 *   eingetragen hätte; Wiederholen ändert nichts; kaputte Audit-Einträge
 *   lassen sie nicht scheitern.
 * - KI-Zugang: Werkzeuge lösen alte Kennungen still auf und melden
 *   `resolvedFrom`.
 * Nur erfundene Namen; räumt auf. Überspringt sich ohne Datenbank.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { bulkMerge, createPerson, deletePerson, getPersonDetail, mergePersons, scopeForEmail, ServiceError } from "@/lib/services";
import { applyGedcomImport, startGedcomImport } from "@/lib/services/gedcom-import";
import { startConnectApply, startConnectPreview, startConnectRun, waitForConnectRun } from "@/lib/services/import-linking";
import { backfillPersonRedirects, mergedIntoError, resolvePersonRedirect, resolvePersonRedirects } from "@/lib/services/redirects";
import { createMcpServer } from "@/mcp/register";
import { resolvePersonArgs } from "@/mcp/person-redirects";
import { buildGedcom, newTreeIds, randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Umleitungs-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a"; // Bearbeiter: bearbeiten
const FAMILY_B = "mock-family-b"; // Bearbeiter: lesen
const FAMILY_C = "mock-family-c"; // Bearbeiter und Betrachter: unsichtbar

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Alte Kennung als Umleitung (Testdatenbank)", () => {
  const persons: string[] = [];
  const trees: string[] = [];
  const families: string[] = [];
  const auditIds: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let editor: Scope;
  let viewer: Scope;
  let nofamily: Scope;
  let mediaDir = "";
  let previousMediaDir: string | undefined;

  beforeAll(async () => {
    previousMediaDir = process.env.MEDIA_DIR;
    mediaDir = await mkdtemp(path.join(os.tmpdir(), "redirect-test-"));
    process.env.MEDIA_DIR = mediaDir;
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    nofamily = await scope("nofamily@example.test");
  });

  afterAll(async () => {
    process.env.MEDIA_DIR = previousMediaDir;
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
    if (skipReason) return;
    const links = await prisma.importLink.findMany({ where: { sourceTreeId: { in: trees } }, select: { personId: true, sourceId: true } });
    await prisma.person.deleteMany({ where: { id: { in: [...persons, ...links.map((l) => l.personId).filter((x): x is string => Boolean(x))] } } });
    await prisma.source.deleteMany({ where: { id: { in: links.map((l) => l.sourceId).filter((x): x is string => Boolean(x)) } } });
    const batches = await prisma.importBatch.findMany({ where: { sourceTreeId: { in: trees } }, select: { id: true } });
    await prisma.importRawRecord.deleteMany({ where: { batchId: { in: batches.map((x) => x.id) } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches.map((x) => x.id) } } });
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ id: { in: auditIds } }, { createdAt: { gte: startedAt }, personIds: { hasSome: persons } }, { createdAt: { gte: startedAt }, action: "CONNECT" }] } });
    await prisma.personRedirect.deleteMany({ where: { fromId: { in: persons } } });
    await prisma.$disconnect();
  });

  /** Person mit eigenem Familiennamen; `n` gleichartige Einträge (Dubletten). */
  async function people(n: number, data: Record<string, unknown> = {}, familyIds = [FAMILY_A]) {
    const familyName = (data.familyName as string | undefined) ?? randomSurname();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = await createPerson(admin, { givenName: "Anna", gender: "FEMALE", birthDate: "1801-04-02", deathDate: "1870-01-05", ...data, familyName, familyIds });
      persons.push(p.id);
      out.push(p.id);
    }
    return out;
  }
  const redirect = async (fromId: string) => (await prisma.personRedirect.findUnique({ where: { fromId } }))?.toId ?? null;
  const rowsOf = async (ids: string[]) =>
    (await prisma.personRedirect.findMany({ where: { fromId: { in: ids } }, select: { fromId: true, toId: true }, orderBy: { fromId: "asc" } })).map((r) => `${r.fromId}→${r.toId}`);

  it("Zusammenführen legt X → K an; aufgelöst wird die alte Kennung, nichts sonst", async () => {
    const [k, x, other] = await people(3);
    await mergePersons(admin, { keepId: k, mergeId: x });
    expect(await redirect(x)).toBe(k);
    expect(await resolvePersonRedirect(admin, x)).toBe(k);
    // bleibende und unbeteiligte Person, unbekannte und unbrauchbare Kennungen
    expect(await resolvePersonRedirect(admin, k)).toBeNull();
    expect(await resolvePersonRedirect(admin, other)).toBeNull();
    expect(await resolvePersonRedirect(admin, "gibt-es-nicht")).toBeNull();
    expect(await resolvePersonRedirect(admin, "")).toBeNull();
    expect([...(await resolvePersonRedirects(admin, [x, k, other, 7, null, "gibt-es-nicht"]))]).toEqual([[x, k]]);
  });

  it("Kette A → B → C: beide alten Kennungen zeigen direkt auf C", async () => {
    const [a, b, c] = await people(3);
    await mergePersons(admin, { keepId: b, mergeId: a });
    expect(await redirect(a)).toBe(b);
    await mergePersons(admin, { keepId: c, mergeId: b });
    expect(await redirect(a)).toBe(c);
    expect(await redirect(b)).toBe(c);
    expect(await resolvePersonRedirect(admin, a)).toBe(c);
    // kein Eintrag, der von der bleibenden Person oder auf sich selbst zeigt
    expect(await redirect(c)).toBeNull();
  });

  it("Sichtbarkeit: Wer die bleibende Person nicht sehen darf, erfährt nichts — wie bei einer unbekannten Kennung", async () => {
    const [kC, xC] = await people(2, {}, [FAMILY_C]);
    const [kB, xB] = await people(2, {}, [FAMILY_B]);
    const [kA, xA] = await people(2, {}, [FAMILY_A]);
    for (const [k, x] of [
      [kC, xC],
      [kB, xB],
      [kA, xA],
    ]) {
      await mergePersons(admin, { keepId: k, mergeId: x });
    }
    // Familie C: nur der Administrator
    expect(await resolvePersonRedirect(admin, xC)).toBe(kC);
    for (const s of [editor, viewer, nofamily]) {
      expect(await resolvePersonRedirect(s, xC)).toBeNull();
      expect(await mergedIntoError(s, xC)).toBeNull();
    }
    // Familie B: der Bearbeiter liest sie, der Betrachter nicht
    expect(await resolvePersonRedirect(editor, xB)).toBe(kB);
    expect(await resolvePersonRedirect(viewer, xB)).toBeNull();
    // Familie A: Bearbeiter und Betrachter, nie der Benutzer ohne Familie
    expect(await resolvePersonRedirect(editor, xA)).toBe(kA);
    expect(await resolvePersonRedirect(viewer, xA)).toBe(kA);
    expect(await resolvePersonRedirect(nofamily, xA)).toBeNull();
    // gemischt in einem Aufruf: nur das Sichtbare
    expect([...(await resolvePersonRedirects(viewer, [xA, xB, xC]))]).toEqual([[xA, kA]]);
    // Der Scope wird nur geladen, wenn es eine Umleitung gibt.
    let asked = 0;
    const lazy = async () => (asked++, editor);
    expect(await resolvePersonRedirect(lazy, kA)).toBeNull();
    expect(asked).toBe(0);
    expect(await resolvePersonRedirect(lazy, xA)).toBe(kA);
    expect(asked).toBe(1);
  });

  it("Schreiben auf eine alte Kennung: Konflikt mit mergedInto", async () => {
    const [k, x] = await people(2);
    await mergePersons(admin, { keepId: k, mergeId: x });
    const err = await mergedIntoError(editor, x);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err!.code).toBe("CONFLICT");
    expect(err!.details).toEqual({ mergedInto: k });
    expect(await mergedIntoError(editor, k)).toBeNull();
    expect(await mergedIntoError(editor, "gibt-es-nicht")).toBeNull();
  });

  it("bleibende Person gelöscht: keine Umleitung mehr", async () => {
    const [k, x] = await people(2);
    await mergePersons(admin, { keepId: k, mergeId: x });
    expect(await redirect(x)).toBe(k);
    await deletePerson(admin, k, { force: true });
    expect(await redirect(x)).toBeNull();
    expect(await resolvePersonRedirect(admin, x)).toBeNull();
  });

  it("Rückfüllung aus dem Audit ergibt genau die Einträge des Zusammenführens: einzeln, gesammelt, Kette, verbunden, gelöscht", async () => {
    // einzeln
    const [k1, x1] = await people(2);
    await mergePersons(admin, { keepId: k1, mergeId: x1 });
    // gesammelt (Sammel-Zusammenführen, zwei sichere Paare)
    const [p1, p2] = await people(2, { givenName: "Berta" });
    const [q1, q2] = await people(2, { givenName: "Clara" });
    const bulk = await bulkMerge(admin, { pairs: [{ a: p1, b: p2 }, { a: q1, b: q2 }] });
    expect(bulk.merged).toHaveLength(2);
    // Kette A → B → C
    const [a, b, c] = await people(3, { givenName: "Dora" });
    await mergePersons(admin, { keepId: b, mergeId: a });
    await mergePersons(admin, { keepId: c, mergeId: b });
    // Kette, deren Ende später gelöscht wird, und ein einzelnes Paar mit gelöschter bleibender Person
    const [d, e, f] = await people(3, { givenName: "Emma" });
    await mergePersons(admin, { keepId: e, mergeId: d });
    await mergePersons(admin, { keepId: f, mergeId: e });
    await deletePerson(admin, f, { force: true });
    const [g, h] = await people(2, { givenName: "Frieda" });
    await mergePersons(admin, { keepId: g, mergeId: h });
    await deletePerson(admin, g, { force: true });
    // „Importe verbinden“ (CONNECT-Eintrag und je Paar ein MERGE-Eintrag)
    const sn = randomSurname();
    const [ta, tb] = [newTreeIds(), newTreeIds()];
    const indi = { given: "Hans", surname: sn, sex: "M" as const, birth: "12 MAR 1850", death: "1 JUN 1910" };
    const child = { given: "Otto", surname: sn, sex: "M" as const, birth: "3 MAY 1880", death: "2 FEB 1950" };
    const file = (t: typeof ta) =>
      buildGedcom(t, [{ key: "I1", ...indi, fams: ["F1"] }, { key: "I2", ...child, famc: "F1" }], [{ key: "F1", husb: "I1", children: ["I2"] }]);
    const connectIds: string[] = [];
    const treeIds: string[] = [];
    for (const [name, t] of [
      ["A", ta],
      ["B", tb],
    ] as const) {
      const plan = await startGedcomImport(admin, { fileName: `test-redirect-${name}-${sn}.ged`, bytes: Buffer.from(file(t), "utf8") });
      trees.push(plan.sourceTreeId);
      treeIds.push(plan.sourceTreeId);
      const r = await applyGedcomImport(admin, plan.batchId, { family: { mode: "new", name: `Umleitung ${name} ${sn}` } });
      if (r.familyId) families.push(r.familyId);
    }
    connectIds.push(...(await prisma.importLink.findMany({ where: { sourceTreeId: { in: treeIds }, entityType: "PERSON" }, select: { personId: true } })).map((l) => l.personId!));
    persons.push(...connectIds);
    expect(connectIds).toHaveLength(4);
    const run = await startConnectRun(admin, { groups: treeIds });
    expect((await waitForConnectRun(admin, run.id)).status).toBe("ready");
    await startConnectPreview(admin, run.id);
    expect((await waitForConnectRun(admin, run.id)).status).toBe("previewed");
    await startConnectApply(admin, run.id);
    const done = await waitForConnectRun(admin, run.id);
    expect(done.status).toBe("done");
    expect(done.apply!.merged).toBe(2);
    await waitForConnectRun(admin, done.followUpId!);
    expect(await prisma.auditLog.count({ where: { action: "CONNECT", entityId: run.id } })).toBe(1);

    const mine = [k1, x1, p1, p2, q1, q2, a, b, c, d, e, f, g, h, ...connectIds];
    const live = await rowsOf(mine);
    // einzeln 1 + gesammelt 2 + Kette 2 + verbunden 2; nichts für die gelöschten Enden
    expect(live).toHaveLength(7);
    expect(live).toContain(`${x1}→${k1}`);
    expect(live).toContain(`${a}→${c}`);
    expect(live).toContain(`${b}→${c}`);
    for (const gone of [d, e, f, g, h]) expect(live.some((r) => r.startsWith(`${gone}→`))).toBe(false);

    // Stand des veröffentlichten Codes: dieselben Daten und dasselbe Audit, aber keine Umleitungen.
    await prisma.personRedirect.deleteMany({ where: { fromId: { in: mine } } });
    expect(await rowsOf(mine)).toEqual([]);
    const first = await backfillPersonRedirects();
    expect(first.created).toBeGreaterThanOrEqual(7);
    expect(await rowsOf(mine)).toEqual(live);
    // Wiederholen ändert nichts.
    const second = await backfillPersonRedirects();
    expect(second.created).toBe(0);
    expect(second.resolvable).toBe(first.resolvable);
    expect(await rowsOf(mine)).toEqual(live);

    // Nur die Kette fehlt halb (A → C vorhanden, B → C nicht): ergänzt, ohne das Vorhandene anzufassen.
    await prisma.personRedirect.deleteMany({ where: { fromId: b } });
    expect((await backfillPersonRedirects()).created).toBe(1);
    expect(await rowsOf(mine)).toEqual(live);
  }, 120_000);

  it("Rückfüllung scheitert an keinen Daten: unerwartete Audit-Einträge werden übergangen, Vorhandenes bleibt", async () => {
    const [k, k2, alive] = await people(3, { givenName: "Greta" });
    const ghost = (n: number) => `ghost-${startedAt.getTime()}-${n}`;
    persons.push(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(ghost));
    const row = async (action: string, entityId: string, diff: unknown, entityType = "Person") => {
      const r = await prisma.auditLog.create({ data: { action, entityType, entityId, diff: diff as never, userId: "mock-user-admin" } });
      auditIds.push(r.id);
    };
    // Unbrauchbar: kein diff, falsche Form, falscher Typ, auf sich selbst, anderer Datensatztyp
    await prisma.auditLog.create({ data: { action: "MERGE", entityType: "Person", entityId: k } }).then((r) => auditIds.push(r.id));
    await row("MERGE", k, "nur Text");
    await row("MERGE", k, [ghost(1), ghost(2)]);
    await row("MERGE", k, { mergeId: 42 });
    await row("MERGE", k, { mergeId: { verschachtelt: true } });
    await row("MERGE", k, { mergeId: k });
    await row("MERGE", k, { mergeId: ghost(1) }, "Source");
    // Kreis zwischen zwei Kennungen, die es nicht gibt
    await row("MERGE", ghost(2), { mergeId: ghost(3) });
    await row("MERGE", ghost(3), { mergeId: ghost(2) });
    // Ziel gibt es nicht (bleibende Person längst gelöscht)
    await row("MERGE", ghost(4), { mergeId: ghost(5) });
    // „Alte“ Person gibt es noch (Zusammenführen von Hand zurückgebaut): nie umleiten
    await row("MERGE", k, { mergeId: alive });
    // Brauchbar: über eine Kette (6 → 7 → k)
    await row("MERGE", ghost(7), { mergeId: ghost(6) });
    await row("MERGE", k, { mergeId: ghost(7) });
    // „Importe verbinden“: kaputte Formen, eine fehlgeschlagene und eine brauchbare Gruppe
    await row("CONNECT", "lauf-1", { clusters: "keine Liste" });
    await row("CONNECT", "lauf-2", { clusters: [null, 5, "x", { keep: 7, merge: [ghost(1)] }, { keep: k, merge: "x" }, { keep: k, merge: [null, 3, k] }] });
    await row("CONNECT", "lauf-3", { clusters: [{ keep: k2, merge: [ghost(8)] }], failed: [{ names: k2, reason: "blockiert" }, null, "x"] });
    await row("CONNECT", "lauf-4", { clusters: [{ keep: k2, merge: [ghost(9)] }], failed: "keine Liste" });
    // Vorhandener Eintrag gewinnt gegen das Audit
    await prisma.personRedirect.create({ data: { fromId: ghost(7), toId: k2 } });

    const res = await backfillPersonRedirects();
    expect(res.created).toBeGreaterThanOrEqual(2);
    const ghosts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(ghost);
    expect(await rowsOf([...ghosts, k, k2, alive])).toEqual([`${ghost(6)}→${k}`, `${ghost(7)}→${k2}`, `${ghost(9)}→${k2}`].sort());
    expect((await backfillPersonRedirects()).created).toBe(0);
  });

  it("KI-Zugang: Werkzeuge lösen alte Kennungen still auf und melden resolvedFrom — nur bei sichtbarer Zielperson", async () => {
    const [k, x] = await people(2, { givenName: "Hilde" });
    const [kC, xC] = await people(2, { givenName: "Ida" }, [FAMILY_C]);
    await mergePersons(admin, { keepId: k, mergeId: x });
    await mergePersons(admin, { keepId: kC, mergeId: xC });

    // Eingaben: einzelne Kennungen und Listen; Unbeteiligtes bleibt, wie es ist.
    const r = await resolvePersonArgs(editor, { person_id: x, other_person_id: k, person_ids: [x, k, "fremd"], note: x });
    expect(r.args).toEqual({ person_id: k, other_person_id: k, person_ids: [k, "fremd"], note: x });
    expect(r.resolvedFrom).toEqual({ [x]: k });
    const same = { person_id: k };
    expect(await resolvePersonArgs(editor, same)).toEqual({ args: same, resolvedFrom: null });
    expect((await resolvePersonArgs(editor, { person_id: xC })).resolvedFrom).toBeNull();
    // KI-Vorprüfung: Paar-Kennungen von preview_person_merge und review_duplicate
    const pair = await resolvePersonArgs(editor, { keep_id: k, merge_id: x, person_a_id: x, person_b_id: "fremd" });
    expect(pair.args).toEqual({ keep_id: k, merge_id: k, person_a_id: k, person_b_id: "fremd" });
    expect(pair.resolvedFrom).toEqual({ [x]: k });

    // Über den Server samt Schema-Prüfung des Clients
    const connect = async (s: Scope) => {
      const via = { channel: "MCP" as const, tokenId: null, level: "WRITE" as const };
      const server = createMcpServer({ label: "test", allowWrite: true, authorize: async (need) => ({ ok: true, user: {} as never, scope: { ...s, via }, level: need, keyId: null }) });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "vitest", version: "1.0.0" });
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      await client.listTools(); // danach prüft der Client jedes Ergebnis gegen das Ausgabeschema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> => {
        const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
        return { isError: Boolean(res.isError), data: res.structuredContent, text: res.content[0]?.text ?? "" };
      };
      return { client, call };
    };
    const ed = await connect(editor);
    const got = await ed.call("get_person", { person_id: x });
    expect(got.isError).toBe(false);
    expect(got.data.resolvedFrom).toEqual({ [x]: k });
    expect(JSON.stringify(got.data)).toContain(k);
    // ohne alte Kennung kein Feld
    expect((await ed.call("get_person", { person_id: k })).data.resolvedFrom).toBeUndefined();
    // zwei Kennungen
    const kin = await ed.call("get_kinship", { person_id: x, other_person_id: k });
    expect(kin.isError).toBe(false);
    expect(kin.data.resolvedFrom).toEqual({ [x]: k });
    // Schreiben geht an die bleibende Person
    const upd = await ed.call("update_person", { person_id: x, append_note: "Hinweis über alte Kennung" });
    expect(upd.isError, upd.text).toBe(false);
    expect(upd.data.resolvedFrom).toEqual({ [x]: k });
    expect((await getPersonDetail(admin, k))!.person.notes).toContain("Hinweis über alte Kennung");
    // KI-Vorprüfung: alte Kennung der aufgegangenen Person = dieselbe Person → abgewiesen, nichts gespeichert
    const rev = await ed.call("review_duplicate", { person_a_id: x, person_b_id: k, verdict: "DISPUTED", reason: "Test über eine alte Kennung" });
    expect(rev.isError).toBe(true);
    expect(rev.text).toContain("Zwei verschiedene Personen");
    // verborgene Zielperson: wie unbekannt
    const hidden = await ed.call("get_person", { person_id: xC });
    const unknown = await ed.call("get_person", { person_id: "gibt-es-nicht" });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toBe(unknown.text);
    // Ressource familytree://person/{id}
    const res = await ed.client.readResource({ uri: `familytree://person/${x}` });
    expect(JSON.parse((res.contents[0] as { text: string }).text).resolvedFrom).toEqual({ [x]: k });
    await ed.client.close();
  });
});
