import { readFileSync } from "node:fs";
import { test, expect, type APIRequestContext } from "@playwright/test";

import { authFile } from "../support/fixtures";
import { mock } from "../support/mock";

/**
 * MCP-Endpunkt /api/mcp gegen den laufenden Mock-Dev-Server (Port 3100) —
 * nur über HTTP, ohne Browser, nur lesend.
 *
 * - 401/403/200 für die festen Testschlüssel aus prisma/mock-data.ts
 * - tools/list je Stufe und ein Lesewerkzeug
 * - das Sitzungs-Cookie der Web-App allein meldet NICHT an
 *
 * Die abgelehnten Anfragen tragen eine zufällige Absenderadresse
 * (X-Forwarded-For aus dem Dokumentationsbereich 192.0.2.0/24). Sonst zählten
 * wiederholte Läufe gegen denselben Dev-Server in die Sperre nach
 * Fehlversuchen (mcp/http.ts) und endeten nach einigen Durchläufen in 429.
 * Dass das ohne Proxy geht, ist die dort beschriebene Grenze der Sperre.
 */

const secretOf = (key: string) => {
  const t = mock.apiTokens.find((x) => x.id === `mock-token-${key}`);
  if (!t) throw new Error(`Testschlüssel ${key} fehlt in den Mock-Daten`);
  return t.secret;
};

const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const randomSender = () => ({ "X-Forwarded-For": `192.0.2.${1 + Math.floor(Math.random() * 254)}` });

let nextId = 1;
function rpc(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) };
}

async function mcp(request: APIRequestContext, body: unknown, headers: Record<string, string> = {}) {
  return request.post("/api/mcp", { headers: { ...HEADERS, ...headers }, data: body });
}

const bearer = (key: string) => ({ Authorization: `Bearer ${secretOf(key)}` });

async function toolNames(request: APIRequestContext, key: string): Promise<string[]> {
  const res = await mcp(request, rpc("tools/list"), bearer(key));
  expect(res.status(), key).toBe(200);
  const json = await res.json();
  return (json.result.tools as { name: string }[]).map((t) => t.name);
}

test.describe("MCP-Endpunkt /api/mcp", () => {
  test("Schlüssel-Matrix: 401 ohne Grund, 403 ohne KI-Recht, 200 mit gültigem Schlüssel", async ({ request }) => {
    for (const headers of [{}, bearer("editor-revoked"), bearer("editor-expired"), bearer("blocked-read")]) {
      const res = await mcp(request, rpc("tools/list"), { ...headers, ...randomSender() });
      expect(res.status()).toBe(401);
      expect(res.headers()["www-authenticate"]).toMatch(/^Bearer realm="familytree"/);
      expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
      expect(await res.text()).not.toMatch(/widerrufen|abgelaufen|gesperrt|revoked|expired|blocked/i);
    }

    const noPermission = await mcp(request, rpc("tools/list"), { ...bearer("nofamily-read"), ...randomSender() });
    expect(noPermission.status()).toBe(403);

    for (const key of ["admin-write", "editor-read", "viewer-read"]) {
      expect((await mcp(request, rpc("tools/list"), bearer(key))).status(), key).toBe(200);
    }

    const get = await request.get("/api/mcp", { headers: { ...bearer("admin-write"), Accept: "text/event-stream" } });
    expect(get.status()).toBe(405);
    expect(get.headers()["allow"]).toBe("POST");
  });

  test("tools/list nach Stufe und ein Lesewerkzeug", async ({ request }) => {
    const init = await mcp(
      request,
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "playwright", version: "1" },
      }),
      bearer("viewer-read"),
    );
    expect(init.status()).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("familytree");

    const read = await toolNames(request, "viewer-read");
    expect(read).toContain("search_persons");
    expect(read).not.toContain("create_person");
    // Zeitgeschichte: lesen mit jedem Schlüssel, pflegen nur mit Schreibstufe.
    expect(read).toContain("list_history_events");
    expect(read).toContain("list_history_areas");
    expect(read).not.toContain("add_history_event");
    // Schlüssel WRITE, Benutzer nur READ: wirksam ist READ.
    expect(await toolNames(request, "viewer-write")).toEqual(read);
    const write = await toolNames(request, "admin-write");
    expect(write).toContain("create_person");
    expect(write).toContain("search_persons");
    expect(write).toContain("add_history_event");

    const res = await mcp(request, rpc("tools/call", { name: "list_families", arguments: {} }), bearer("viewer-read"));
    expect(res.status()).toBe(200);
    const result = (await res.json()).result;
    expect(result.isError).toBeFalsy();
    const families = JSON.parse(result.content[0].text).families.map((f: { id: string }) => f.id);
    expect(families).toEqual(["mock-family-a"]);
  });

  test("Sitzungs-Cookie der Web-App allein meldet nicht an", async ({ playwright, baseURL }) => {
    // Angemeldeter Admin aus dem Setup — im Browser hätte er vollen Zugriff.
    const state = JSON.parse(readFileSync(authFile("admin"), "utf8")) as { cookies: { name: string }[] };
    expect(state.cookies.some((c) => c.name.includes("session-token"))).toBe(true);
    const asAdmin = await playwright.request.newContext({ baseURL, storageState: authFile("admin") });
    try {
      // Gegenprobe: das Cookie gilt für die Web-API ...
      expect((await asAdmin.get("/api/families")).status()).toBe(200);
      // ... aber nicht für den MCP-Endpunkt.
      const res = await mcp(asAdmin, rpc("tools/list"), randomSender());
      expect(res.status()).toBe(401);
    } finally {
      await asAdmin.dispose();
    }
  });
});
