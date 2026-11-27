/**
 * Zeitgeschichte über MCP (gegen die Mock-Datenbank, HTTP-Endpunkt wie
 * tests/places-ai.db.test.ts):
 * - Leseschlüssel: nur list_history_events, mit Filtern.
 * - Schreibschlüssel eines Nicht-Administrators: Werkzeuge vorhanden, aber
 *   klare Ablehnung, nichts gespeichert.
 * - Schreibschlüssel eines Administrators: anlegen mit Pflicht-Begründung
 *   (Herkunft „von KI“, unbestätigt, Protokoll mit Kanal und Schlüssel),
 *   Dublette abgelehnt, ändern (wieder unbestätigt, von Hand angelegte
 *   „von KI geändert“), löschen, mitgelieferte ausblenden. Die KI kann nicht
 *   bestätigen; bestätigt wird in der App (Dienst und Route).
 *
 * Räumt alle Zeitgeschichte-Zeilen, ihr Protokoll und die eigenen
 * Änderungspakete ab (wie tests/history.db.test.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

import { prisma } from "@/lib/prisma";
import {
  confirmHistoryEvents,
  createHistoryEvent,
  historyAdminState,
  listChangeSetEntries,
  listHistoryEvents,
  scopeForEmail,
  updateHistoryEvent,
} from "@/lib/services";
import type { Scope } from "@/lib/scope";
import { INSTRUCTIONS } from "@/mcp/register";
import * as mcpRoute from "@/app/api/mcp/route";
import { POST as confirmPost } from "@/app/api/history-events/confirm/route";
import { resetMcpRateLimit } from "@/mcp/http";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason({ check: async () => (await prisma.apiToken.count()) > 0, missing: "ohne KI-Testschlüssel" });
if (skipReason) console.warn(`\n[tests] Zeitgeschichte-KI-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const secretOf = (key: string) => data.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;
const users = Object.fromEntries(data.users.map((u) => [u.email, u]));

const HISTORY_WRITE_TOOLS = ["add_history_event", "delete_history_event", "set_builtin_history_event_hidden", "update_history_event"];
const REASON = "Ortschronik Beispielstadt (1910), S. 45: Hochwasser im März 1882";
const FLOOD = { title: "Hochwasser an der Beispel", year_from: 1882, kind: "not", region: "Beispieltal", reason: REASON };

const startedAt = new Date();
const changeSets: string[] = [];

async function cleanup() {
  await prisma.historyEvent.deleteMany({});
  await prisma.historyHiddenBuiltin.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { entityType: "HistoryEvent" } });
}

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Zeitgeschichte über MCP (Mock-Datenbank)", () => {
  beforeAll(cleanup);
  beforeEach(cleanup);
  afterEach(() => {
    session.current = null;
  });
  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => {});
    resetMcpRateLimit();
    await cleanup();
    await prisma.changeSet.deleteMany({
      where: {
        OR: [
          { id: { in: changeSets } },
          { createdAt: { gte: startedAt }, entries: { none: {} }, title: { startsWith: "Zeitgeschichte" } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  /** Eigenes Paket je Test — sonst hängt der Server an das jüngste Paket desselben Schlüssels. */
  async function changeSet(s: McpSession, title: string): Promise<string> {
    const r = await s.call("begin_change_set", { title });
    expect(r.isError, r.text).toBe(false);
    changeSets.push(r.data.change_set_id);
    return r.data.change_set_id;
  }

  it("Server-Hinweis: Hintergrund, Quelle, Region, keine Personennamen", () => {
    expect(INSTRUCTIONS).toMatch(/Zeitgeschichte/);
    expect(INSTRUCTIONS).toMatch(/never a statement about a person/);
    expect(INSTRUCTIONS).toMatch(/list_history_events first/);
    expect(INSTRUCTIONS).toMatch(/when in doubt, do not add/);
    expect(INSTRUCTIONS).toMatch(/"region"/);
    expect(INSTRUCTIONS).toMatch(/Never put names of persons/);
  });

  it("Leseschlüssel: nur list_history_events — mit Filtern", async () => {
    const admin = await scope("admin@example.test");
    await createHistoryEvent(admin, { title: "Stadtbrand", yearFrom: "1842", kind: "not", region: "Beispielstadt" });
    const s = await connect(secretOf("editor-read"));
    const tools = await s.tools();
    expect(tools).toContain("list_history_events");
    for (const t of HISTORY_WRITE_TOOLS) expect(tools).not.toContain(t);

    const all = await s.call("list_history_events", {});
    expect(all.isError, all.text).toBe(false);
    expect(all.data.events.some((e: { source: string }) => e.source === "builtin")).toBe(true);
    const own = all.data.events.find((e: { source: string }) => e.source === "custom");
    expect(own).toMatchObject({ title: "Stadtbrand", from: 1842, origin: "MANUAL", region: "Beispielstadt" });
    expect(own.id).toMatch(/^c:/);
    expect(own.unconfirmed).toBeUndefined();

    const y1916 = await s.call("list_history_events", { year: 1916 });
    expect(y1916.data.events.map((e: { id: string }) => e.id)).toContain("erster-weltkrieg");
    expect(y1916.data.events.every((e: { from: number; to: number | null }) => e.from <= 1916 && (e.to ?? e.from) >= 1916)).toBe(true);

    const region = await s.call("list_history_events", { region: "beispiel" });
    expect(region.data.events.map((e: { title: string }) => e.title)).toEqual(["Stadtbrand"]);
    expect((await s.call("list_history_events", { source: "builtin" })).data.events.every((e: { source: string }) => e.source === "builtin")).toBe(true);
    expect((await s.call("list_history_events", { year: 1900, from_year: 1890 })).isError).toBe(true);
  });

  it("Schreibschlüssel eines Nicht-Administrators: Werkzeuge da, aber Ablehnung", async () => {
    const s = await connect(secretOf("editor-write"));
    const tools = await s.tools();
    for (const t of HISTORY_WRITE_TOOLS) expect(tools).toContain(t);
    const add = await s.call("add_history_event", FLOOD);
    expect(add.isError).toBe(true);
    expect(add.text).toMatch(/Berechtigung.*history:manage/);
    const hide = await s.call("set_builtin_history_event_hidden", { builtin_id: "erster-weltkrieg", hidden: true });
    expect(hide.isError).toBe(true);
    expect(hide.text).toMatch(/Berechtigung/);
    expect(await prisma.historyEvent.count()).toBe(0);
    expect(await prisma.historyHiddenBuiltin.count()).toBe(0);
  });

  it("Administrator: anlegen nur mit Begründung — Herkunft „von KI“, unbestätigt, Protokoll", async () => {
    const s = await connect(secretOf("admin-write"));
    const cs = await changeSet(s, "Zeitgeschichte Beispieltal ergänzt");

    const noReason = await s.call("add_history_event", { ...FLOOD, reason: undefined, change_set_id: cs });
    expect(noReason.isError).toBe(true);
    const short = await s.call("add_history_event", { ...FLOOD, reason: "Chronik", change_set_id: cs });
    expect(short.isError).toBe(true);
    expect(short.text).toMatch(/Begründung mit Quelle/);
    const badUrl = await s.call("add_history_event", { ...FLOOD, source_url: "http://example.org", change_set_id: cs });
    expect(badUrl.isError).toBe(true);
    const future = await s.call("add_history_event", { ...FLOOD, year_from: 2999, change_set_id: cs });
    expect(future.isError).toBe(true);
    expect(await prisma.historyEvent.count()).toBe(0);

    const add = await s.call("add_history_event", { ...FLOOD, source_url: "https://example.org/chronik", change_set_id: cs });
    expect(add.isError, add.text).toBe(false);
    expect(add.data.event).toMatchObject({ title: FLOOD.title, yearFrom: 1882, origin: "AI", unconfirmed: true, region: "Beispieltal" });
    const id = add.data.event.id.slice(2);
    const row = await prisma.historyEvent.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ origin: "AI", aiReason: REASON, aiSourceUrl: "https://example.org/chronik", confirmedAt: null });

    // Sofort für alle sichtbar — mit Vermerk.
    expect((await listHistoryEvents()).find((e) => e.id === `c:${id}`)).toMatchObject({ aiUnconfirmed: true });
    // Begründung in der Liste nur für Administratoren.
    const forAdmin = await s.call("list_history_events", { only_unconfirmed: true });
    expect(forAdmin.data.events).toEqual([expect.objectContaining({ id: `c:${id}`, unconfirmed: true, aiReason: REASON })]);
    const forEditor = await (await connect(secretOf("editor-read"))).call("list_history_events", { source: "custom" });
    expect(forEditor.data.events[0].unconfirmed).toBe(true);
    expect(forEditor.data.events[0].aiReason).toBeUndefined();

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "HistoryEvent", entityId: id } });
    expect(audit).toMatchObject({ action: "CREATE", userId: "mock-user-admin", channel: "MCP", apiTokenId: "mock-token-admin-write", changeSetId: cs });
    expect(audit.diff).toMatchObject({ origin: "AI", aiReason: REASON });
    const entry = (await listChangeSetEntries(await scope("admin@example.test"), cs)).items[0];
    expect(entry.what).toBe(`Zeitgeschichte „${FLOOD.title}“ angelegt`);
    expect(entry.fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Herkunft", to: "von KI" })]));
  });

  it("Dublette — mitgeliefert oder eigen — wird abgelehnt", async () => {
    const s = await connect(secretOf("admin-write"));
    const cs = await changeSet(s, "Zeitgeschichte Dubletten geprüft");
    const builtin = await s.call("add_history_event", { title: "Der Erste Weltkrieg", year_from: 1916, kind: "krieg", reason: REASON, change_set_id: cs });
    expect(builtin.isError).toBe(true);
    expect(builtin.text).toMatch(/Erster Weltkrieg.*erster-weltkrieg.*\[CONFLICT\]/);

    expect((await s.call("add_history_event", { ...FLOOD, change_set_id: cs })).isError).toBe(false);
    const again = await s.call("add_history_event", { ...FLOOD, title: "Hochwaser an der Beispel", year_from: 1881, year_to: 1883, change_set_id: cs });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/update_history_event/);
    // Andere Jahre bzw. andere Gegend: kein Duplikat.
    expect((await s.call("add_history_event", { ...FLOOD, year_from: 1909, change_set_id: cs })).isError).toBe(false);
    const elsewhere = await s.call("add_history_event", { ...FLOOD, region: "Nachbarland", change_set_id: cs });
    expect(elsewhere.isError, elsewhere.text).toBe(false);
    await s.call("delete_history_event", { event_id: elsewhere.data.event.id, reason: "Nur für den Test angelegt.", change_set_id: cs });
    expect(await prisma.historyEvent.count()).toBe(2);
    // Ändern auf eine Dublette: ebenfalls abgelehnt.
    const later = await prisma.historyEvent.findFirstOrThrow({ where: { yearFrom: 1909 } });
    const clash = await s.call("update_history_event", { event_id: `c:${later.id}`, year_from: 1882, reason: REASON, change_set_id: cs });
    expect(clash.isError).toBe(true);
    expect(clash.text).toMatch(/CONFLICT/);
  });

  it("ändern: wieder unbestätigt; von Hand angelegte werden „von KI geändert“; KI kann nicht bestätigen", async () => {
    const admin = await scope("admin@example.test");
    const s = await connect(secretOf("admin-write"));
    const cs = await changeSet(s, "Zeitgeschichte Beispieltal überarbeitet");
    const add = await s.call("add_history_event", { ...FLOOD, change_set_id: cs });
    const aiId: string = add.data.event.id;

    // Bestätigen geht nur in der App.
    const tools = await s.tools();
    expect(tools.filter((t) => /confirm|bestaetig/i.test(t))).toEqual([]);
    expect(await confirmHistoryEvents(admin, [aiId])).toEqual({ confirmed: 1 });
    expect(await prisma.historyEvent.findUniqueOrThrow({ where: { id: aiId.slice(2) } })).toMatchObject({ confirmedById: "mock-user-admin" });

    // Unbekannte Felder (confirmed) werden ignoriert; nur Begründung geändert → keine Inhaltsänderung.
    const same = await s.call("update_history_event", { event_id: aiId, reason: REASON, confirmed: true, change_set_id: cs });
    expect(same.isError, same.text).toBe(false);
    expect(same.data).toMatchObject({ changed: [], event: { unconfirmed: false } });

    const upd = await s.call("update_history_event", { event_id: aiId, description: "Der Fluss trat über die Ufer.", reason: "Ortschronik Beispielstadt (1910), S. 46", change_set_id: cs });
    expect(upd.isError, upd.text).toBe(false);
    expect(upd.data).toMatchObject({ changed: ["description"], event: { origin: "AI", unconfirmed: true, aiReason: "Ortschronik Beispielstadt (1910), S. 46" } });
    expect(await prisma.historyEvent.findUniqueOrThrow({ where: { id: aiId.slice(2) } })).toMatchObject({ confirmedAt: null, confirmedById: null });

    // Von Hand angelegt → von KI geändert, unbestätigt; null leert.
    const manual = await createHistoryEvent(admin, { title: "Stadtbrand", yearFrom: "1842", kind: "not", region: "Beispielstadt" });
    const m = await s.call("update_history_event", { event_id: `c:${manual.id}`, region: null, reason: REASON, change_set_id: cs });
    expect(m.isError, m.text).toBe(false);
    expect(m.data.event).toMatchObject({ origin: "AI_EDITED", unconfirmed: true, region: null });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "HistoryEvent", entityId: manual.id, action: "UPDATE" } });
    expect(audit).toMatchObject({ channel: "MCP", apiTokenId: "mock-token-admin-write" });
    expect(audit.diff).toMatchObject({ changes: { region: { from: "Beispielstadt", to: null }, origin: { from: "MANUAL", to: "AI_EDITED" }, confirmed: { from: true, to: false } } });

    // Ein Administrator speichert von Hand → bestätigt (auch ohne Inhaltsänderung).
    const saved = await updateHistoryEvent(admin, manual.id, { title: "Stadtbrand", yearFrom: "1842", kind: "not", region: "" });
    expect(saved).toMatchObject({ origin: "AI_EDITED", unconfirmed: false, confirmedBy: "Ada Admin" });
    expect((await historyAdminState(admin)).custom.find((c) => c.id === manual.id)).toMatchObject({ unconfirmed: false, confirmedAt: expect.any(String) });

    // Mitgelieferte sind fest; unbekannte Kennung.
    expect((await s.call("update_history_event", { event_id: "erster-weltkrieg", title: "X", reason: REASON, change_set_id: cs })).text).toMatch(/fest/);
    expect((await s.call("update_history_event", { event_id: "c:gibt-es-nicht", title: "X", reason: REASON, change_set_id: cs })).text).toMatch(/NOT_FOUND/);
  });

  it("löschen mit Begründung, mitgelieferte aus- und einblenden", async () => {
    const s = await connect(secretOf("admin-write"));
    const cs = await changeSet(s, "Zeitgeschichte aufgeräumt");
    const add = await s.call("add_history_event", { ...FLOOD, change_set_id: cs });
    const id: string = add.data.event.id;

    expect((await s.call("delete_history_event", { event_id: id, reason: "kurz", change_set_id: cs })).isError).toBe(true);
    expect((await s.call("delete_history_event", { event_id: "erster-weltkrieg", reason: "Passt nicht zur Familie hier.", change_set_id: cs })).text).toMatch(
      /ausblenden/,
    );
    const del = await s.call("delete_history_event", { event_id: id, reason: "Doppelt erfasst, siehe Ortschronik.", change_set_id: cs });
    expect(del.isError, del.text).toBe(false);
    expect(del.data).toMatchObject({ deleted: true, title: FLOOD.title });
    expect(await prisma.historyEvent.count()).toBe(0);
    const gone = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "HistoryEvent", entityId: id.slice(2), action: "DELETE" } });
    expect(gone).toMatchObject({ channel: "MCP", changeSetId: cs });
    expect(gone.diff).toMatchObject({ title: FLOOD.title, origin: "AI", reason: "Doppelt erfasst, siehe Ortschronik." });

    const hide = await s.call("set_builtin_history_event_hidden", { builtin_id: "erster-weltkrieg", hidden: true, change_set_id: cs });
    expect(hide.data).toEqual({ id: "erster-weltkrieg", title: "Erster Weltkrieg", hidden: true });
    expect((await listHistoryEvents()).some((e) => e.id === "erster-weltkrieg")).toBe(false);
    const withHidden = await s.call("list_history_events", { year: 1916, include_hidden: true });
    expect(withHidden.data.events.find((e: { id: string }) => e.id === "erster-weltkrieg")).toMatchObject({ hidden: true });
    expect((await s.call("list_history_events", { year: 1916 })).data.events.some((e: { id: string }) => e.id === "erster-weltkrieg")).toBe(false);
    expect((await s.call("set_builtin_history_event_hidden", { builtin_id: "erster-weltkrieg", hidden: false, change_set_id: cs })).data.hidden).toBe(false);
    expect((await s.call("set_builtin_history_event_hidden", { builtin_id: "gibt-es-nicht", hidden: true, change_set_id: cs })).text).toMatch(/NOT_FOUND/);
    const rows = await prisma.auditLog.findMany({ where: { entityType: "HistoryEvent", entityId: "erster-weltkrieg" } });
    expect(rows.map((r) => r.channel)).toEqual(["MCP", "MCP"]);
  });

  it("Bestätigen in der App: Route nur für Administratoren, „alle sichtbaren“ zählt nur offene", async () => {
    const admin = await scope("admin@example.test");
    const s = await connect(secretOf("admin-write"));
    const cs = await changeSet(s, "Zeitgeschichte Beispieltal ergänzt");
    const a = (await s.call("add_history_event", { ...FLOOD, change_set_id: cs })).data.event.id as string;
    const b = (await s.call("add_history_event", { ...FLOOD, title: "Stadtbrand in Beispielstadt", year_from: 1842, change_set_id: cs })).data.event.id as string;
    const manual = await createHistoryEvent(admin, { title: "Markt", yearFrom: "1850", kind: "sonstiges" });

    const req = (body: unknown) =>
      new Request("http://localhost:3999/api/history-events/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const params = { params: Promise.resolve({}) } as never;
    session.current = { user: { id: users["editor@example.test"].id, role: users["editor@example.test"].role } };
    expect((await confirmPost(req({ ids: [a] }), params)).status).toBe(403);
    session.current = { user: { id: users["admin@example.test"].id, role: "ADMIN" } };
    expect((await confirmPost(req({ ids: [] }), params)).status).toBe(400);
    expect((await confirmPost(req({ ids: ["c:gibt-es-nicht"] }), params)).status).toBe(404);
    const ok = await confirmPost(req({ ids: [a, b, manual.id] }), params);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ confirmed: 2 });
    expect((await listHistoryEvents()).some((e) => e.aiUnconfirmed)).toBe(false);
    const rows = await prisma.auditLog.findMany({ where: { entityType: "HistoryEvent", action: "UPDATE", channel: null } });
    expect(rows).toHaveLength(2);
    const entry = (await listChangeSetEntries(admin, rows[0].changeSetId!)).items.find((i) => i.id === rows[0].id)!;
    expect(entry.what).toMatch(/^Zeitgeschichte „.*“ bestätigt$/);
  });
});

// ---------------------------------------------------------------------------
// MCP über den HTTP-Endpunkt (wie tests/places-ai.db.test.ts)
// ---------------------------------------------------------------------------

const URL_MCP = "http://localhost:3100/api/mcp";
const clients: Client[] = [];

async function dispatch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  if (req.method !== "POST") return mcpRoute.GET();
  return mcpRoute.POST(req);
}

type McpSession = {
  // Werkzeugergebnisse sind frei geformtes JSON; im Test bewusst untypisiert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; data: any; text: string }>;
  tools: () => Promise<string[]>;
};

async function connect(secret: string): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: dispatch,
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  const client = new Client({ name: "vitest-history", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return {
    call: async (name, args = {}) => {
      const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const r = (await client.callTool({ name, arguments: clean })) as { isError?: boolean; content: { type: string; text: string }[] };
      const text = r.content[0]?.text ?? "";
      const isError = Boolean(r.isError);
      return { isError, data: isError ? null : JSON.parse(text), text };
    },
    tools: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
  };
}
