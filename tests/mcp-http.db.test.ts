/**
 * Integrationstest des MCP-Endpunkts der App (app/api/mcp/route.ts,
 * mcp/http.ts) mit dem HTTP-Client des SDK — gegen die Mock-Datenbank.
 *
 * Der Route-Handler wird direkt aufgerufen: Der Client-Transport bekommt eine
 * fetch-Funktion, die jede Anfrage an die exportierten Methoden der Route
 * weiterreicht. So läuft genau der Code des Endpunkts, ohne Server.
 *
 * Abgedeckt: initialize, tools/list je Stufe, Lese- und Schreibaufruf (Audit
 * mit Kanal MCP und Schlüssel-ID), Herabstufen und Widerruf zwischen zwei
 * Aufrufen, 401/403-Matrix der festen Testschlüssel, Maskierung für
 * Betrachter, Sitzungs-Cookie allein → 401, zu großer Körper, fremder Origin,
 * Methoden, Sperre nach Fehlversuchen.
 *
 * Schreibende Tests legen nur eigene, klar benannte Datensätze an und räumen
 * sie samt Audit-Einträgen ab. Überspringt sich ohne Mock-Datenbank.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encode } from "next-auth/jwt";

import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/ai-tokens";
import * as mcpRoute from "@/app/api/mcp/route";
import { MCP_AUTH_FAILURE_LIMIT, MCP_MAX_BODY_BYTES, mcpWriteBodyLimit, resetMcpRateLimit } from "@/mcp/http";
import type { MockApiTokenKey } from "@/prisma/mock-data";
import { mockData } from "./helpers";

async function mockDbReady(): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    if (!admin) return "Mock-Datenbank ist leer — bitte `npm run mock:setup` ausführen.";
    if ((await prisma.apiToken.count()) === 0) {
      return "Mock-Datenbank ohne KI-Testschlüssel — bitte `npm run mock:setup` ausführen.";
    }
    return null;
  } catch (err) {
    const detail = (err as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    return `Mock-Datenbank nicht erreichbar (${detail}).`;
  }
}

const skipReason = await mockDbReady();
if (skipReason) console.warn(`\n[tests] MCP-HTTP-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const tokenByKey = new Map(data.apiTokens.map((t) => [t.id.replace(/^mock-token-/, "") as MockApiTokenKey, t]));
const secretOf = (key: MockApiTokenKey) => tokenByKey.get(key)!.secret;
const tokenIdOf = (key: MockApiTokenKey) => tokenByKey.get(key)!.id;

const URL_MCP = "http://localhost:3100/api/mcp";

const READ_TOOLS = [
  "check_consistency",
  "find_data_gaps",
  "find_possible_duplicates",
  "get_ancestors",
  "get_descendants",
  "get_kinship",
  "get_person",
  "get_source",
  "get_statistics",
  "get_timeline",
  "list_events",
  "list_families",
  "search_persons",
  "search_sources",
];
const WRITE_TOOLS = [
  "add_event",
  "add_media",
  "add_name_variant",
  "begin_change_set",
  "cite_source",
  "create_person",
  "create_relationship",
  "create_source",
  "delete_event",
  "delete_relationship",
  "set_person_families",
  "update_event",
  "update_person",
  "update_relationship",
  "link_media",
];

type Handler = (req: Request) => Response | Promise<Response>;
const ROUTE: Record<string, Handler> = {
  POST: mcpRoute.POST,
  GET: mcpRoute.GET,
  DELETE: mcpRoute.DELETE,
  PUT: mcpRoute.PUT,
  PATCH: mcpRoute.PATCH,
  OPTIONS: mcpRoute.OPTIONS,
};

/** Reicht eine Anfrage direkt an den Route-Handler weiter (wie Next.js). */
async function dispatch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const handler = ROUTE[req.method];
  if (!handler) throw new Error(`Methode ${req.method} nicht exportiert`);
  return handler(req);
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

/** Rohe JSON-RPC-Anfrage, z.B. für Status und Header. */
function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return dispatch(URL_MCP, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

type Session = {
  client: Client;
  // Werkzeugergebnisse sind frei geformtes JSON; im Test bewusst untypisiert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; data: any; text: string }>;
  tools: () => Promise<string[]>;
};

const clients: Client[] = [];

async function connect(secret: string): Promise<Session> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: dispatch,
    requestInit: { headers: bearer(secret) },
  });
  const client = new Client({ name: "vitest-http", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return {
    client,
    tools: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
    call: async (name, args = {}) => {
      try {
        const r = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };
        const text = r.content[0]?.text ?? "";
        const isError = Boolean(r.isError);
        return { isError, data: isError ? null : JSON.parse(text), text };
      } catch (err) {
        // Unbekanntes Werkzeug: je nach SDK-Version Fehlerergebnis oder Ausnahme.
        return { isError: true, data: null, text: (err as Error).message };
      }
    },
  };
}

/** Alle Objekte mit dieser ID irgendwo im Ergebnis. */
function objectsWithId(value: unknown, id: string, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) value.forEach((v) => objectsWithId(v, id, found));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.id === id) found.push(o);
    Object.values(o).forEach((v) => objectsWithId(v, id, found));
  }
  return found;
}

const createdPersons: string[] = [];
const createdTokens: string[] = [];

/** Eigener Testschlüssel des Bearbeiters — nur für diesen Test. */
async function tempEditorToken(level: "READ" | "WRITE"): Promise<{ id: string; secret: string }> {
  const g = generateToken();
  const row = await prisma.apiToken.create({
    data: {
      userId: "mock-user-editor",
      name: "Vitest MCP-HTTP (temporär)",
      prefix: g.prefix,
      secretHash: g.secretHash,
      level,
      kind: "PERSONAL",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  createdTokens.push(row.id);
  return { id: row.id, secret: g.secret };
}

/** Server-Logs des Endpunkts — mitgeschnitten, um zu prüfen, dass nie ein Geheimnis darin steht. */
const logged: string[] = [];

describe.skipIf(Boolean(skipReason))("MCP-Endpunkt /api/mcp (HTTP, Mock-Datenbank)", () => {
  beforeEach(() => {
    resetMcpRateLimit();
    for (const level of ["warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const c of clients) await c.close().catch(() => {});
    resetMcpRateLimit();
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
    await prisma.apiToken.deleteMany({ where: { id: { in: createdTokens } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...createdPersons, ...createdTokens] } } });
    await prisma.$disconnect();
  });

  it("Admin-Schlüssel (WRITE): initialize, alle Werkzeuge, Lesewerkzeug", async () => {
    const s = await connect(secretOf("admin-write"));
    expect(s.client.getServerVersion()).toMatchObject({ name: "familytree" });
    expect(s.client.getInstructions()).toContain("Family-tree database");
    expect(await s.tools()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());

    const stats = await s.call("get_statistics");
    expect(stats.isError).toBe(false);
    expect(stats.text).toContain("persons");

    const prompts = (await s.client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(["research_person", "review_data_quality"]);
  });

  it("Lese-Schlüssel: Schreibwerkzeuge fehlen und lassen sich nicht aufrufen", async () => {
    for (const key of ["editor-read", "viewer-read", "viewer-write"] as const) {
      const s = await connect(secretOf(key));
      expect(await s.tools(), key).toEqual(READ_TOOLS);
      const r = await s.call("create_person", { given_name: "Darf nicht", family_name: "Vitest-MCP-HTTP" });
      expect(r.isError, key).toBe(true);
      // Auch Ereignisse und Namen lassen sich mit einem Lese-Schlüssel nicht anlegen.
      const ev = await s.call("add_event", { person_id: L.genealogy.eventsPerson, type: "CENSUS", date: "1900" });
      expect(ev.isError, key).toBe(true);
      // Lesen geht: Ereignisse über list_events.
      if (key === "viewer-read") {
        const list = await s.call("list_events", { person_id: L.genealogy.eventsPerson });
        expect(list.isError, list.text).toBe(false);
        expect(list.data.events.map((e: { type: string }) => e.type)).toContain("BAPTISM");
      }
    }
    expect(await prisma.event.count({ where: { personId: L.genealogy.eventsPerson, type: "CENSUS" } })).toBe(0);
    expect(await prisma.person.count({ where: { familyName: "Vitest-MCP-HTTP" } })).toBe(0);
  });

  it("Schreib-Schlüssel des Bearbeiters: Audit mit Kanal MCP und Schlüssel-ID", async () => {
    const s = await connect(secretOf("editor-write"));
    const r = await s.call("create_person", {
      given_name: "HTTP-Testperson",
      family_name: "Vitest-MCP-HTTP",
      birth_date: "um 1901",
    });
    expect(r.isError, r.text).toBe(false);
    const id = r.data.person.id as string;
    createdPersons.push(id);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Person", entityId: id, action: "CREATE" } });
    expect(audit).toMatchObject({ userId: "mock-user-editor", channel: "MCP", apiTokenId: tokenIdOf("editor-write") });
  });

  it("Herabstufen und Widerruf wirken auf den nächsten Aufruf", async () => {
    const token = await tempEditorToken("WRITE");
    const s = await connect(token.secret);
    expect(await s.tools()).toContain("create_person");

    // Stufe des Schlüssels sinkt: das eben gelistete Schreibwerkzeug ist weg.
    await prisma.apiToken.update({ where: { id: token.id }, data: { level: "READ" } });
    const denied = await s.call("create_person", { given_name: "Nach Herabstufung", family_name: "Vitest-MCP-HTTP" });
    expect(denied.isError).toBe(true);
    expect(await s.tools()).toEqual(READ_TOOLS);
    expect(await prisma.person.count({ where: { givenName: "Nach Herabstufung" } })).toBe(0);

    // Widerruf: jede weitere Anfrage → 401.
    await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await expect(s.client.listTools()).rejects.toThrow();
    expect((await post(LIST, bearer(token.secret))).status).toBe(401);
  });

  it("401/403-Matrix: einheitliche Antwort ohne Grund, WWW-Authenticate: Bearer", async () => {
    const unauthorized = [
      {},
      { Authorization: "" },
      { Authorization: "Basic YWRtaW46YWRtaW4=" },
      { Authorization: "Bearer" },
      bearer("kein-schluessel"),
      bearer("ftk_00000000a001_falsches-geheimnis-00000000000000000000000000"),
      bearer(secretOf("editor-revoked")),
      bearer(secretOf("editor-expired")),
      bearer(secretOf("blocked-read")),
    ];
    const bodies = new Set<string>();
    for (const headers of unauthorized) {
      const res = await post(LIST, headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer realm="familytree"/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).not.toMatch(/revoked|expired|blocked|widerrufen|abgelaufen|gesperrt/i);

    const noPermission = await post(LIST, bearer(secretOf("nofamily-read")));
    expect(noPermission.status).toBe(403);
    expect(noPermission.headers.get("www-authenticate")).toContain('error="insufficient_scope"');

    // Schlüssel im Query-String zählt nicht.
    const inQuery = await dispatch(`${URL_MCP}?access_token=${secretOf("admin-write")}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(LIST),
    });
    expect(inQuery.status).toBe(401);

    const ok = await post(LIST, bearer(secretOf("viewer-read")));
    expect(ok.status).toBe(200);
  });

  it("Sitzungs-Cookie der Web-App allein meldet nicht an", async () => {
    const secret = process.env.AUTH_SECRET || "mock-secret-nur-fuer-lokale-tests-0123456789";
    const jwt = await encode({
      token: { sub: "mock-user-admin", role: "ADMIN", email: "admin@example.test" },
      secret,
      salt: "authjs.session-token",
    });
    const res = await post(LIST, { Cookie: `authjs.session-token=${jwt}; __Secure-authjs.session-token=${jwt}` });
    expect(res.status).toBe(401);
  });

  it("Betrachter-Schlüssel: verborgene Personen bleiben verborgen", async () => {
    const s = await connect(secretOf("viewer-read"));
    const hiddenIds = [L.inLawOnlyB, ...L.noFamily];
    const results = [
      await s.call("get_person", { person_id: L.crossMarriedIntoA }),
      await s.call("get_ancestors", { person_id: L.crossMarriedIntoA, generations: 4 }),
      await s.call("search_persons", { limit: 100 }),
      await s.call("search_persons", { limit: 100, offset: 100 }),
      await s.call("find_data_gaps", { limit: 200 }),
      await s.call("get_source", { source_id: L.sources.crossFamily }),
    ];
    for (const r of results) expect(r.isError, r.text).toBe(false);

    const parent = results[0].data.parents.find((p: { id: string }) => p.id === L.inLawOnlyB);
    expect(parent).toMatchObject({ name: "Nicht freigegeben", restricted: true });
    for (const r of results) {
      for (const id of hiddenIds) {
        for (const o of objectsWithId(r.data, id)) {
          expect(o.restricted).toBe(true);
          expect(o.name).toBe("Nicht freigegeben");
        }
      }
    }
    const hiddenNames = hiddenIds
      .map((id) => data.persons.find((p) => p.id === id)!)
      .map((p) => `${p.givenName} ${p.familyName}`);
    const allText = results.map((r) => r.text).join("\n");
    for (const name of hiddenNames) expect(allText).not.toContain(name);

    const direct = await s.call("get_person", { person_id: L.inLawOnlyB });
    expect(direct.isError).toBe(true);
    expect(direct.text).toContain("nicht gefunden");
  });

  it("Härtung: Körpergröße, Origin, Methoden, Sperre nach Fehlversuchen", async () => {
    const admin = bearer(secretOf("admin-write"));

    // Zu großer Körper → 413, bevor etwas geparst wird. Lesende Schlüssel:
    // 1 MiB; Schlüssel mit Schreibstufe: Platz für ein Bild als base64
    // (add_media), aber nicht mehr.
    const big = JSON.stringify({ ...LIST, params: { pad: "x".repeat(MCP_MAX_BODY_BYTES) } });
    expect((await post(big, bearer(secretOf("viewer-read")))).status).toBe(413);
    expect((await post(big, admin)).status).not.toBe(413);
    const huge = JSON.stringify({ ...LIST, params: { pad: "x".repeat(mcpWriteBodyLimit()) } });
    expect((await post(huge, admin)).status).toBe(413);

    // Fremder Origin → 403; eigener (AUTH_URL) und gar keiner sind erlaubt.
    expect((await post(LIST, { ...admin, Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(LIST, { ...admin, Origin: "null" })).status).toBe(403);
    const own = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
    if (own) expect((await post(LIST, { ...admin, Origin: own })).status).toBe(200);
    expect((await post(LIST, admin)).status).toBe(200);

    // Nur POST.
    for (const method of ["GET", "DELETE", "PUT", "PATCH", "OPTIONS"]) {
      const res = await dispatch(URL_MCP, { method, headers: { ...admin, Accept: "text/event-stream" } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }

    // Sperre je Absender (letzter X-Forwarded-For-Eintrag): nach dem Limit
    // 429 — auch mit gültigem Schlüssel —, andere Absender bleiben frei.
    const attacker = { "X-Forwarded-For": "198.51.100.7, 203.0.113.9" };
    for (let i = 0; i < MCP_AUTH_FAILURE_LIMIT; i++) {
      expect((await post(LIST, { ...attacker, ...bearer("falsch") })).status).toBe(401);
    }
    const blocked = await post(LIST, { ...attacker, ...admin });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Vorangestellte, vom Client gefälschte Einträge ändern nichts.
    expect((await post(LIST, { "X-Forwarded-For": "1.2.3.4, 203.0.113.9", ...admin })).status).toBe(429);
    expect((await post(LIST, { "X-Forwarded-For": "203.0.113.10", ...admin })).status).toBe(200);
  });

  it("Logs nennen höchstens den öffentlichen Anfang, nie das Geheimnis", () => {
    expect(logged.some((l) => l.includes("ftk_00000000e003"))).toBe(true);
    for (const t of data.apiTokens) {
      const secretPart = t.secret.slice(t.prefix.length + 1);
      for (const line of logged) expect(line).not.toContain(secretPart);
    }
  });
});

describe(".mcp.json (Projektkonfiguration für Claude Code)", () => {
  it("registriert den HTTP-Endpunkt des Mock-Servers, Schlüssel nur aus der Umgebung", () => {
    const raw = readFileSync(path.resolve(__dirname, "..", ".mcp.json"), "utf8");
    // Öffentliches Repository: kein Schlüssel in der Datei, auch kein Mock-Schlüssel.
    expect(raw).not.toMatch(/ftk_[0-9a-f]{12}_/);
    const config = JSON.parse(raw) as {
      mcpServers: Record<string, { type?: string; url?: string; headers?: Record<string, string>; command?: string }>;
    };
    const entries = Object.values(config.mcpServers);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      type: "http",
      url: "http://localhost:3100/api/mcp",
      headers: { Authorization: "Bearer ${FAMILYTREE_MCP_KEY}" },
    });
  });
});
