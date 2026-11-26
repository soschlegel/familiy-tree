/**
 * Einstellungen mit Mock-Datenbank (lib/services/settings.ts und
 * /api/settings): Vorrang App vor Umgebungsvariable, Rückfall nach dem
 * Entfernen, Prüfung auf dem Server, nur Administratoren, Protokoll
 * vorher → nachher und Beschreibung in der Änderungsübersicht.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

import { prisma } from "@/lib/prisma";
import {
  createSetting,
  deleteSetting,
  getSetting,
  listChangeSetEntries,
  listSettings,
  scopeForEmail,
  updateSetting,
} from "@/lib/services";
import type { Scope } from "@/lib/scope";
import { GET as listGet, POST as createPost } from "@/app/api/settings/route";
import { PATCH as settingPatch, DELETE as settingDelete } from "@/app/api/settings/[key]/route";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const dbReady = !(await mockDbSkipReason());
if (!dbReady) console.warn("\n[tests] Einstellungs-Tests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const KEY = "mcpConnectorUrl";
const ENV = "MCP_CONNECTOR_URL";
const previousEnv = process.env[ENV];

async function cleanup() {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
  await prisma.auditLog.deleteMany({ where: { entityType: "Setting" } });
}

beforeEach(async () => {
  if (!dbReady) return;
  delete process.env[ENV];
  await cleanup();
});

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = previousEnv;
  if (dbReady) await cleanup();
});

describe.skipIf(!dbReady)("Dienst: Vorrang und Rückfall", () => {
  let admin: Scope;
  let editor: Scope;

  beforeEach(async () => {
    admin = (await scopeForEmail("admin@example.test"))!;
    editor = (await scopeForEmail("editor@example.test"))!;
  });

  it("ohne Eintrag gilt die Umgebungsvariable, mit Eintrag der Wert aus der App, nach dem Entfernen wieder die Umgebung", async () => {
    expect(await getSetting(KEY)).toBeNull();
    expect((await listSettings(admin)).find((s) => s.key === KEY)).toMatchObject({ source: "none", effective: null });

    process.env[ENV] = "https://env.example.de/mcp";
    expect(await getSetting(KEY)).toBe("https://env.example.de/mcp");
    expect((await listSettings(admin)).find((s) => s.key === KEY)).toMatchObject({
      source: "env",
      effective: "https://env.example.de/mcp",
      appValue: null,
      envValue: "https://env.example.de/mcp",
    });

    const created = await createSetting(admin, KEY, "  https://app.example.de/mcp ");
    expect(created).toMatchObject({ source: "app", appValue: "https://app.example.de/mcp", effective: "https://app.example.de/mcp" });
    expect(await getSetting(KEY)).toBe("https://app.example.de/mcp");

    const updated = await updateSetting(admin, KEY, "https://neu.example.de/mcp");
    expect(updated.effective).toBe("https://neu.example.de/mcp");

    const removed = await deleteSetting(admin, KEY);
    expect(removed).toMatchObject({ source: "env", effective: "https://env.example.de/mcp" });
    expect(await getSetting(KEY)).toBe("https://env.example.de/mcp");
  });

  it("ungültiger gespeicherter Wert gilt nicht — Rückfall auf die Umgebung", async () => {
    process.env[ENV] = "https://env.example.de/mcp";
    await prisma.appSetting.create({ data: { key: KEY, value: "javascript:alert(1)" } });
    expect(await getSetting(KEY)).toBe("https://env.example.de/mcp");
    expect((await listSettings(admin)).find((s) => s.key === KEY)).toMatchObject({ source: "env", appValue: null });
  });

  it("Prüfung: unbekannter Schlüssel, ungültiger Wert, doppelt anlegen, Ändern ohne Eintrag", async () => {
    await expect(createSetting(admin, "gibtEsNicht", "https://x.example.de/")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createSetting(admin, KEY, "ftp://x.example.de/")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createSetting(admin, KEY, "https://a:b@x.example.de/")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateSetting(admin, KEY, "https://x.example.de/")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteSetting(admin, KEY)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await createSetting(admin, KEY, "https://x.example.de/");
    await expect(createSetting(admin, KEY, "https://y.example.de/")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateSetting(admin, KEY, "kein-link")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await getSetting(KEY)).toBe("https://x.example.de/");
  });

  it("nur Administratoren", async () => {
    await expect(listSettings(editor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSetting(editor, KEY, "https://x.example.de/")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.appSetting.count({ where: { key: KEY } })).toBe(0);
  });

  it("Protokoll: Benutzer und vorher → nachher, lesbar in der Änderungsübersicht", async () => {
    await createSetting(admin, KEY, "https://alt.example.de/");
    await updateSetting(admin, KEY, "https://alt.example.de/"); // unverändert: kein Eintrag
    await updateSetting(admin, KEY, "https://neu.example.de/");
    await deleteSetting(admin, KEY);
    const rows = await prisma.auditLog.findMany({ where: { entityType: "Setting", entityId: KEY }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    expect(rows.every((r) => r.userId === admin.userId)).toBe(true);
    expect(rows[1].diff).toMatchObject({ changes: { value: { from: "https://alt.example.de/", to: "https://neu.example.de/" } } });

    const entries = await Promise.all(rows.map((r) => listChangeSetEntries(admin, r.changeSetId ?? `e:${r.id}`)));
    const [created, changed, removed] = entries.map((p) => p.items.find((i) => rows.some((r) => r.id === i.id))!);
    expect(created.what).toBe("Einstellung „Adresse des KI-Connectors“ gesetzt");
    expect(created.fields).toEqual([expect.objectContaining({ label: "Wert", from: null, to: "https://alt.example.de/" })]);
    expect(changed.what).toBe("Einstellung „Adresse des KI-Connectors“ geändert");
    expect(changed.fields).toEqual([expect.objectContaining({ label: "Wert", from: "https://alt.example.de/", to: "https://neu.example.de/" })]);
    expect(removed.what).toBe("Einstellung „Adresse des KI-Connectors“ entfernt");
  });
});

describe.skipIf(!dbReady)("API /api/settings", () => {
  const BASE = "http://localhost:3999";
  const users = Object.fromEntries(mockData().users.map((u) => [u.email, u]));
  const login = (email: string) => {
    session.current = { user: { id: users[email].id, role: users[email].role } };
  };
  const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = (key?: string) => ({ params: Promise.resolve(key ? { key } : {}) }) as never;

  it("Administrator: anlegen, ändern, entfernen; Fehlercodes", async () => {
    login("admin@example.test");
    const created = await createPost(json("POST", "/api/settings", { key: KEY, value: "https://api.example.de/" }), params());
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ key: KEY, source: "app", effective: "https://api.example.de/" });

    expect((await createPost(json("POST", "/api/settings", { key: KEY, value: "https://x.example.de/" }), params())).status).toBe(409);
    expect((await createPost(json("POST", "/api/settings", { key: "gibtEsNicht", value: "https://x.example.de/" }), params())).status).toBe(400);

    const bad = await settingPatch(json("PATCH", `/api/settings/${KEY}`, { value: "kein-link" }), params(KEY));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toEqual(["value"]);

    const patched = await settingPatch(json("PATCH", `/api/settings/${KEY}`, { value: "https://neu.example.de/" }), params(KEY));
    expect(patched.status).toBe(200);

    const list = await listGet(json("GET", "/api/settings"), params());
    expect((await list.json()).find((s: { key: string }) => s.key === KEY).effective).toBe("https://neu.example.de/");

    expect((await settingDelete(json("DELETE", `/api/settings/${KEY}`), params(KEY))).status).toBe(200);
    expect((await settingDelete(json("DELETE", `/api/settings/${KEY}`), params(KEY))).status).toBe(404);
  });

  it("Nicht-Administratoren: 403; fremde Herkunft: 403", async () => {
    login("editor@example.test");
    expect((await listGet(json("GET", "/api/settings"), params())).status).toBe(403);
    expect((await createPost(json("POST", "/api/settings", { key: KEY, value: "https://x.example.de/" }), params())).status).toBe(403);
    login("admin@example.test");
    const foreign = await createPost(
      json("POST", "/api/settings", { key: KEY, value: "https://x.example.de/" }, { origin: "https://boese.example", host: "localhost:3999" }),
      params(),
    );
    expect(foreign.status).toBe(403);
    expect(await prisma.appSetting.count({ where: { key: KEY } })).toBe(0);
  });
});
