/**
 * KI-Vorprüfung möglicher Dubletten (gegen die Mock-Datenbank), über den
 * HTTP-Endpunkt des MCP-Servers und die Dienstschicht:
 * - list_duplicate_candidates: nur Paare, deren BEIDE Personen der Benutzer
 *   sieht; Einschätzungen nur für Bearbeiter beider; Filter und Seiten.
 * - preview_person_merge: Trockenlauf — Rechte wie in der App, ändert nichts.
 * - review_duplicate: nur mit Schreibstufe und Bearbeitungsrecht an beiden;
 *   speichert NUR die Einschätzung (kein Zusammenführen, kein Ausblenden,
 *   Klasse unverändert), Protokoll mit Kanal, Schlüssel und Paket.
 * - „veraltet“, sobald sich eine der Personen ändert; neue Einschätzung
 *   ersetzt die alte; „kein Duplikat“ eines Menschen geht vor; Löschen einer
 *   Person entfernt die Einschätzung.
 *
 * Nur erfundene Namen; legt eigene Personen an und räumt samt Protokoll ab.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { createEvent, createPerson, createRelationship, deletePerson, scopeForEmail, updatePerson } from "@/lib/services";
import { dismissDuplicate, listDuplicateCandidates, listDuplicatesOfPerson, reviewDuplicate, undismissDuplicate } from "@/lib/services/duplicates";
import { listPersonChanges } from "@/lib/services/changes";
import * as mcpRoute from "@/app/api/mcp/route";
import { resetMcpRateLimit } from "@/mcp/http";
import { INSTRUCTIONS } from "@/mcp/register";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";
import { randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason({ check: async () => (await prisma.apiToken.count()) > 0, missing: "ohne KI-Testschlüssel" });
if (skipReason) console.warn(`\n[tests] KI-Vorprüfung-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const secretOf = (key: string) => data.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;

const FAMILY_A = "mock-family-a"; // Bearbeiter: bearbeiten
const FAMILY_B = "mock-family-b"; // Bearbeiter: nur lesen
const FAMILY_C = "mock-family-c"; // Bearbeiter: unsichtbar
const REASON = "Gleicher Name, gleiches tagesgenaues Geburtsdatum, gleiche Eltern; kein Widerspruch in der Vorschau.";

const URL_MCP = "http://localhost:3100/api/mcp";
const clients: Client[] = [];

async function dispatch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  if (req.method !== "POST") return mcpRoute.GET();
  return mcpRoute.POST(req);
}

type McpSession = {
  tools: () => Promise<string[]>;
  prompts: () => Promise<string[]>;
  prompt: (name: string, args?: Record<string, string>) => Promise<string>;
  // Werkzeugergebnisse sind frei geformtes JSON; im Test bewusst untypisiert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; data: any; text: string }>;
};

async function connect(key: string): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: dispatch,
    requestInit: { headers: { Authorization: `Bearer ${secretOf(key)}` } },
  });
  const client = new Client({ name: "vitest-duplicate-review", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return {
    tools: async () => (await client.listTools()).tools.map((t) => t.name),
    prompts: async () => (await client.listPrompts()).prompts.map((p) => p.name),
    prompt: async (name, args = {}) => {
      const r = await client.getPrompt({ name, arguments: args });
      return r.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("\n");
    },
    call: async (name, args = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
      const text = r.content[0]?.text ?? "";
      const isError = Boolean(r.isError);
      return { isError, data: isError ? null : JSON.parse(text), text };
    },
  };
}

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("KI-Vorprüfung möglicher Dubletten (Mock-Datenbank)", () => {
  const persons: string[] = [];
  let admin: Scope;
  let editor: Scope;
  let viewer: Scope;
  // Paare: A (Bearbeiter darf beide bearbeiten), B (nur lesen), C (unsichtbar).
  let a1: string, a2: string, b1: string, b2: string, c1: string, c2: string;

  async function person(input: Record<string, unknown>, familyIds: string[]) {
    const p = await createPerson(admin, { gender: "FEMALE", ...input, familyIds });
    persons.push(p.id);
    return p.id;
  }
  /** Paar mit eigenem Familiennamen: gleicher Name und Geburtstag, kein Sterbedatum. */
  async function pair(given: string, familyIds: string[]): Promise<[string, string]> {
    const same = { givenName: given, familyName: randomSurname(), birthDate: "1850-03-12" };
    return [await person(same, familyIds), await person({ ...same, birthPlace: "Musterdorf" }, familyIds)];
  }
  const sameIds = (x: string, y: string) => (d: { a: { id: string }; b: { id: string } }) =>
    (d.a.id === x && d.b.id === y) || (d.a.id === y && d.b.id === x);
  const listed = async (s: Scope, x: string, y: string, options: Parameters<typeof listDuplicateCandidates>[1] = {}) =>
    (await listDuplicateCandidates(s, { limit: 500, ...options })).items.find(sameIds(x, y));
  /** Zustand, den ein Trockenlauf bzw. eine Einschätzung nicht anfassen darf. */
  async function snapshot(ids: string[]) {
    const [people, rels, events, names, dismissals] = await Promise.all([
      prisma.person.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }),
      prisma.relationship.findMany({ where: { OR: [{ fromPersonId: { in: ids } }, { toPersonId: { in: ids } }] }, orderBy: { id: "asc" } }),
      prisma.event.findMany({ where: { personId: { in: ids } }, orderBy: { id: "asc" } }),
      prisma.personName.findMany({ where: { personId: { in: ids } }, orderBy: { id: "asc" } }),
      prisma.duplicateDismissal.findMany({ where: { OR: [{ personAId: { in: ids } }, { personBId: { in: ids } }] } }),
    ]);
    return JSON.stringify({ people, rels, events, names, dismissals });
  }

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    [a1, a2] = await pair("Wilhelmine", [FAMILY_A]);
    [b1, b2] = await pair("Albertine", [FAMILY_B]);
    [c1, c2] = await pair("Leopoldine", [FAMILY_C]);
  });

  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => {});
    resetMcpRateLimit();
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: persons } }, { personIds: { hasSome: persons } }] } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.changeSet.deleteMany({
      where: { entries: { none: {} }, title: { in: ["Vitest: Dubletten vorgeprüft", "Mögliche Dubletten vorgeprüft (KI)", "Person angelegt", "Person geändert", "Person gelöscht"] } },
    });
    await prisma.$disconnect();
  });

  it("Werkzeuge und Prompt je Stufe; der Server-Hinweis sagt: kein merge_persons", async () => {
    const read = await connect("editor-read");
    const write = await connect("editor-write");
    const readTools = await read.tools();
    expect(readTools).toEqual(expect.arrayContaining(["list_duplicate_candidates", "preview_person_merge", "find_possible_duplicates"]));
    expect(readTools).not.toContain("review_duplicate");
    const writeTools = await write.tools();
    expect(writeTools).toEqual(expect.arrayContaining(["list_duplicate_candidates", "preview_person_merge", "review_duplicate"]));
    // Es gibt kein Werkzeug, das zusammenführt — auf keiner Stufe.
    for (const t of [...readTools, ...writeTools]) expect(t).not.toMatch(/^merge|merge_person/);
    expect(await read.prompts()).toContain("review_duplicates");
    const text = await write.prompt("review_duplicates", { confidence: "medium", limit: "5" });
    expect(text).toMatch(/list_duplicate_candidates\(review: "unreviewed", confidence: "medium"\)/);
    expect(text).toMatch(/get_person für BEIDE/);
    expect(text).toMatch(/preview_person_merge/);
    expect(text).toMatch(/Nie raten/);
    expect(text).toMatch(/Du führst NICHTS zusammen/);
    expect(await read.prompt("review_duplicates")).toMatch(/schreibgeschützt/);
    // Eigener Absatz im Server-Hinweis.
    const paragraph = INSTRUCTIONS.split("\n\n").find((p) => p.includes("merge_persons"));
    expect(paragraph).toBeTruthy();
    expect(paragraph).toMatch(/^Duplicates — there is NO merge_persons tool/);
    expect(paragraph).toMatch(/only by a human in the web app/);
    expect(INSTRUCTIONS).toContain("find_possible_duplicates");
  });

  it("list_duplicate_candidates: nur Paare, deren beide Personen der Benutzer sieht", async () => {
    const asEditor = await connect("editor-read");
    const all = await asEditor.call("list_duplicate_candidates", { limit: 50 });
    expect(all.isError, all.text).toBe(false);
    const find = (list: { candidates: { a: { id: string }; b: { id: string } }[] }, x: string, y: string) => list.candidates.find(sameIds(x, y));
    // Paar in A: sichtbar und einschätzbar; Paar in B: sichtbar, nicht einschätzbar; Paar in C: gar nicht.
    const pa = find(all.data, a1, a2) as Record<string, unknown>;
    expect(pa).toMatchObject({ canReview: true, confidence: expect.stringMatching(/^(high|medium|low)$/), reasons: expect.any(Array), conflicts: expect.any(Array) });
    expect(pa.review).toBeUndefined();
    expect(find(all.data, b1, b2)).toMatchObject({ canReview: false });
    expect(find(all.data, c1, c2)).toBeUndefined();
    expect(all.text).not.toContain(c1);
    expect(all.text).not.toContain(c2);
    expect(all.text).not.toContain("Nicht freigegeben");
    expect(all.data.total).toBeGreaterThanOrEqual(all.data.candidates.length);
    expect(all.data.counts.high + all.data.counts.medium + all.data.counts.low).toBe(all.data.total);

    // Betrachter von A: Paar in A sichtbar, aber nicht einschätzbar; B und C nicht.
    const asViewer = await connect("viewer-read");
    const v = await asViewer.call("list_duplicate_candidates", { limit: 50 });
    expect(find(v.data, a1, a2)).toMatchObject({ canReview: false });
    expect(find(v.data, b1, b2)).toBeUndefined();
    expect(find(v.data, c1, c2)).toBeUndefined();

    // Seitenweise: zwei Seiten zu je einem Paar überschneiden sich nicht.
    const p1 = await asEditor.call("list_duplicate_candidates", { limit: 1 });
    const p2 = await asEditor.call("list_duplicate_candidates", { limit: 1, offset: 1 });
    expect(p1.data.candidates).toHaveLength(1);
    expect(p1.data.hasMore).toBe(true);
    expect(p2.data.offset).toBe(1);
    expect([p2.data.candidates[0].a.id, p2.data.candidates[0].b.id]).not.toEqual([p1.data.candidates[0].a.id, p1.data.candidates[0].b.id]);
    // Klassenfilter: nur diese Klasse.
    const klass = pa.confidence as string;
    const only = await asEditor.call("list_duplicate_candidates", { confidence: klass, limit: 50 });
    expect(only.data.candidates.every((c: { confidence: string }) => c.confidence === klass)).toBe(true);
    expect(find(only.data, a1, a2)).toBeTruthy();
  });

  it("preview_person_merge: Trockenlauf mit Rechten wie in der App — ändert nichts", async () => {
    // Zweites Paar für die Blocker: Elternteil und Kind gleichen Namens.
    const sn = randomSurname();
    const parent = await person({ givenName: "Henriette", familyName: sn, birthDate: "1820-01-01" }, [FAMILY_A]);
    const child = await person({ givenName: "Henriette", familyName: sn, birthDate: "1845-01-01" }, [FAMILY_A]);
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: parent, toPersonId: child });

    const before = await snapshot(persons);
    const audits = await prisma.auditLog.count();
    const changeSets = await prisma.changeSet.count();
    const s = await connect("editor-read"); // Lesestufe genügt: es wird nichts geschrieben
    const r = await s.call("preview_person_merge", { keep_id: a1, merge_id: a2 });
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ dryRun: true, canMerge: true, blockers: [], keep: { id: a1 }, other: { id: a2 } });
    expect(r.data.sentences.length).toBeGreaterThan(0);
    expect(r.data.fields.find((f: { field: string }) => f.field === "birthPlace")).toMatchObject({ keep: "", other: "Musterdorf", choice: "other" });
    expect(r.data.note).toMatch(/nichts wurde geändert/);

    // Blocker erscheinen wie in der Oberfläche: Elternteil und Kind lassen sich nicht zusammenführen.
    const blocked = await s.call("preview_person_merge", { keep_id: parent, merge_id: child });
    expect(blocked.isError, blocked.text).toBe(false);
    expect(blocked.data.canMerge).toBe(false);
    expect(blocked.data.blockers.length).toBeGreaterThan(0);
    expect(blocked.data.sentences.join(" ")).toMatch(/Blockiert/);

    // Rechte: nur lesbare Familie → verweigert; unsichtbare → nicht gefunden; Betrachter → verweigert.
    const forbidden = await s.call("preview_person_merge", { keep_id: b1, merge_id: b2 });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.text).toMatch(/FORBIDDEN/);
    const hidden = await s.call("preview_person_merge", { keep_id: c1, merge_id: c2 });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toMatch(/NOT_FOUND/);
    const asViewer = await connect("viewer-read");
    expect((await asViewer.call("preview_person_merge", { keep_id: a1, merge_id: a2 })).text).toMatch(/FORBIDDEN/);
    // Auch mit Schreibstufe bleibt es ein Trockenlauf.
    const write = await connect("editor-write");
    expect((await write.call("preview_person_merge", { keep_id: a2, merge_id: a1 })).data).toMatchObject({ dryRun: true, keep: { id: a2 } });

    // Nichts geändert: Personen (samt updatedAt), Beziehungen, Ereignisse, Namen, Markierungen,
    // Protokoll, Pakete, Einschätzungen.
    expect(await snapshot(persons)).toBe(before);
    expect(await prisma.person.count({ where: { id: { in: [a1, a2, parent, child] } } })).toBe(4);
    expect(await prisma.duplicateReview.count({ where: { OR: [{ personAId: { in: persons } }, { personBId: { in: persons } }] } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(await prisma.changeSet.count()).toBe(changeSets);
  });

  it("review_duplicate: Rechte — Schreibstufe und Bearbeitungsrecht an beiden Personen", async () => {
    const write = await connect("editor-write");
    const forbidden = await write.call("review_duplicate", { person_a_id: b1, person_b_id: b2, verdict: "MERGE", reason: REASON });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.text).toMatch(/FORBIDDEN/);
    const hidden = await write.call("review_duplicate", { person_a_id: c1, person_b_id: c2, verdict: "MERGE", reason: REASON });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toMatch(/NOT_FOUND/);
    // Eine Person bearbeitbar, die andere nur lesbar: verweigert.
    expect((await write.call("review_duplicate", { person_a_id: a1, person_b_id: b1, verdict: "DISPUTED", reason: REASON })).text).toMatch(/FORBIDDEN/);
    // Eingaben: Begründung Pflicht, Vorschlag nur eine der beiden und nur mit MERGE, zwei verschiedene Personen.
    for (const bad of [
      { person_a_id: a1, person_b_id: a2, verdict: "MERGE", reason: "kurz" },
      { person_a_id: a1, person_b_id: a2, verdict: "MERGE", reason: REASON, suggested_keep_id: b1 },
      { person_a_id: a1, person_b_id: a2, verdict: "DISPUTED", reason: REASON, suggested_keep_id: a1 },
      { person_a_id: a1, person_b_id: a1, verdict: "MERGE", reason: REASON },
      { person_a_id: a1, person_b_id: a2, verdict: "SURE", reason: REASON },
    ]) {
      const r = await write.call("review_duplicate", bad);
      expect(r.isError, JSON.stringify(bad)).toBe(true);
    }
    // Der Dienst selbst verweigert einem Betrachter (unabhängig von der KI-Stufe).
    await expect(reviewDuplicate(viewer, { personAId: a1, personBId: a2, verdict: "MERGE", reason: REASON })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.duplicateReview.count({ where: { OR: [{ personAId: { in: persons } }, { personBId: { in: persons } }] } })).toBe(0);
  });

  it("review_duplicate speichert nur die Einschätzung: nichts zusammengeführt, nichts ausgeblendet, Klasse unverändert, protokolliert", async () => {
    const before = await listed(editor, a1, a2);
    expect(before).toBeTruthy();
    expect(before!.review).toBeUndefined();
    const state = await snapshot([a1, a2]);
    const write = await connect("editor-write");
    const cs = await write.call("begin_change_set", { title: "Vitest: Dubletten vorgeprüft" });
    const r = await write.call("review_duplicate", {
      person_a_id: a2,
      person_b_id: a1,
      verdict: "MERGE",
      reason: REASON,
      suggested_keep_id: a1,
      change_set_id: cs.data.change_set_id,
    });
    expect(r.isError, r.text).toBe(false);
    const [lo, hi] = a1 < a2 ? [a1, a2] : [a2, a1];
    expect(r.data).toMatchObject({ personAId: lo, personBId: hi, verdict: "MERGE", suggestedKeepId: a1, merged: false, replacedVerdict: null });

    // Beide Personen unverändert vorhanden, keine „kein Duplikat“-Markierung.
    expect(await snapshot([a1, a2])).toBe(state);
    // Das Paar steht weiter in der Liste — mit derselben Klasse und Bewertung; ein KI-„MERGE“ macht nichts „sicher“.
    const after = await listed(editor, a1, a2);
    expect(after).toMatchObject({ confidence: before!.confidence, score: before!.score, reasons: before!.reasons, conflicts: before!.conflicts, canMerge: true });
    expect(before!.confidence).not.toBe("high");
    expect(after!.review).toMatchObject({ verdict: "MERGE", reason: REASON, suggestedKeepId: a1, stale: false, tokenName: expect.any(String) });
    // Die Reihenfolge der Liste bleibt, wie sie ohne Einschätzung wäre.
    const order = (await listDuplicateCandidates(admin, { limit: 500 })).items.map((d) => `${d.a.id}|${d.b.id}`);
    await prisma.duplicateReview.updateMany({ where: { personAId: lo, personBId: hi }, data: { verdict: "NOT_DUPLICATE", suggestedKeepId: null } });
    expect((await listDuplicateCandidates(admin, { limit: 500 })).items.map((d) => `${d.a.id}|${d.b.id}`)).toEqual(order);
    // Auch ein KI-„kein Duplikat“ blendet das Paar nicht aus.
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ verdict: "NOT_DUPLICATE" });
    await prisma.duplicateReview.updateMany({ where: { personAId: lo, personBId: hi }, data: { verdict: "MERGE", suggestedKeepId: a1 } });

    // Wer nicht beide bearbeiten darf, sieht das Paar, aber nicht die Einschätzung.
    const forViewer = await listed(viewer, a1, a2);
    expect(forViewer).toBeTruthy();
    expect(forViewer!.review).toBeUndefined();
    const asViewer = await connect("viewer-read");
    const viewerList = await asViewer.call("list_duplicate_candidates", { limit: 50 });
    expect(viewerList.text).not.toContain(REASON);
    expect((await asViewer.call("list_duplicate_candidates", { review: "MERGE" })).data.total).toBe(0);

    // MCP zeigt die Einschätzung dem Bearbeiter; Filter nach Urteil.
    const merge = await write.call("list_duplicate_candidates", { review: "MERGE", limit: 50 });
    expect(merge.data.candidates.find(sameIds(a1, a2)).review).toMatchObject({ verdict: "MERGE", reason: REASON, stale: false });
    const open = await write.call("list_duplicate_candidates", { review: "unreviewed", limit: 50 });
    expect(open.data.candidates.find(sameIds(a1, a2))).toBeUndefined();
    expect((await write.call("list_duplicate_candidates", { review: "DISPUTED", limit: 50 })).data.candidates.find(sameIds(a1, a2))).toBeUndefined();

    // Zahlen für den Filter der Oberfläche.
    const counts = (await listDuplicateCandidates(editor, { limit: 500 })).reviewCounts;
    expect(counts.MERGE).toBeGreaterThanOrEqual(1);
    expect(counts.any).toBe(counts.MERGE + counts.DISPUTED + counts.NOT_DUPLICATE);
    expect((await listDuplicateCandidates(editor, { limit: 500, review: "none" })).items.find(sameIds(a1, a2))).toBeUndefined();
    expect((await listDuplicateCandidates(editor, { limit: 500, review: "any" })).items.find(sameIds(a1, a2))).toBeTruthy();

    // Hinweis auf der Personenseite: nur Urteil und „veraltet“.
    const banner = (await listDuplicatesOfPerson(editor, a1, { limit: 50 })).items.find((d) => d.person.id === a2);
    expect(banner?.review).toEqual({ verdict: "MERGE", stale: false });
    expect(banner?.confidence).toBe(before!.confidence);

    // Protokoll: Kanal MCP, Schlüssel, Paket, beide Personen betroffen.
    const audit = await prisma.auditLog.findMany({ where: { entityId: lo, action: "UPDATE", diff: { path: ["duplicateReview", "with"], equals: hi } } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ channel: "MCP", apiTokenId: "mock-token-editor-write", userId: "mock-user-editor", changeSetId: cs.data.change_set_id });
    expect(audit[0].personIds.sort()).toEqual([lo, hi].sort());
    expect(audit[0].diff).toMatchObject({ duplicateReview: { verdict: "MERGE", reason: REASON, suggestedKeepId: a1 } });
    // Im Verlauf der Person lesbar.
    const history = await listPersonChanges(editor, a2);
    expect(JSON.stringify(history)).toMatch(/Mögliche Dublette vorgeprüft \(„zusammenführen“\)/);
  });

  it("„veraltet“, sobald sich eine der Personen ändert; eine neue Einschätzung ersetzt die alte", async () => {
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ verdict: "MERGE", stale: false });
    // Änderung an den Stammdaten der einen Person.
    await updatePerson(admin, a2, { birthPlace: "Musterdorf bei Beispielstadt" });
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ verdict: "MERGE", stale: true });
    expect((await listDuplicatesOfPerson(editor, a1, { limit: 50 })).items.find((d) => d.person.id === a2)?.review).toEqual({ verdict: "MERGE", stale: true });

    const write = await connect("editor-write");
    // Für die KI wieder offen; in der Oberfläche weiter unter ihrem Urteil.
    const open = await write.call("list_duplicate_candidates", { review: "unreviewed", limit: 50 });
    expect(open.data.candidates.find(sameIds(a1, a2)).review).toMatchObject({ verdict: "MERGE", stale: true });
    expect(await listed(editor, a1, a2, { review: "MERGE" })).toBeTruthy();
    expect((await listDuplicateCandidates(editor, { limit: 500 })).reviewCounts.stale).toBeGreaterThanOrEqual(1);

    const again = await write.call("review_duplicate", { person_a_id: a1, person_b_id: a2, verdict: "DISPUTED", reason: `${REASON} Geburtsort jetzt abweichend.` });
    expect(again.isError, again.text).toBe(false);
    expect(again.data).toMatchObject({ verdict: "DISPUTED", replacedVerdict: "MERGE", suggestedKeepId: null });
    expect(await prisma.duplicateReview.count({ where: { OR: [{ personAId: a1 }, { personBId: a1 }] } })).toBe(1);
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ verdict: "DISPUTED", stale: false, suggestedKeepId: null });

    // Auch ein neues Ereignis oder eine neue Beziehung macht die Einschätzung veraltet.
    await createEvent(admin, { personId: a1, type: "BAPTISM", date: "1850-03-20" });
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ stale: true });
    await write.call("review_duplicate", { person_a_id: a1, person_b_id: a2, verdict: "DISPUTED", reason: REASON });
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ stale: false });
    const mother = await person({ givenName: "Friederike", familyName: randomSurname(), birthDate: "1825-05-05" }, [FAMILY_A]);
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: mother, toPersonId: a2 });
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ stale: true });
  });

  it("„Kein Duplikat“ eines Menschen geht vor; Löschen einer Person entfernt die Einschätzung", async () => {
    const write = await connect("editor-write");
    await dismissDuplicate(editor, a1, a2);
    expect(await listed(editor, a1, a2)).toBeUndefined();
    const r = await write.call("review_duplicate", { person_a_id: a1, person_b_id: a2, verdict: "MERGE", reason: REASON });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/kein Duplikat/);
    expect(r.text).toMatch(/CONFLICT/);
    await undismissDuplicate(editor, a1, a2);
    expect((await listed(editor, a1, a2))!.review).toMatchObject({ verdict: "DISPUTED" });

    // Eigenes Paar: Einschätzung, dann eine der Personen löschen.
    const [x, y] = await pair("Ernestine", [FAMILY_A]);
    await reviewDuplicate(editor, { personAId: x, personBId: y, verdict: "NOT_DUPLICATE", reason: REASON });
    expect(await prisma.duplicateReview.count({ where: { OR: [{ personAId: x }, { personBId: x }] } })).toBe(1);
    await deletePerson(admin, y);
    expect(await prisma.duplicateReview.count({ where: { OR: [{ personAId: x }, { personBId: x }] } })).toBe(0);
    expect(await prisma.person.count({ where: { id: x } })).toBe(1);
  });
});
