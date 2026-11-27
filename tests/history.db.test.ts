/**
 * Zeitgeschichte mit Mock-Datenbank (lib/services/history.ts und
 * /api/history-events): eigene Ereignisse anlegen, ändern, löschen,
 * mitgelieferte aus- und einblenden, Wirkung auf die Anzeigeliste, nur
 * Administratoren, Protokoll mit Beschreibung in der Änderungsübersicht.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

import { prisma } from "@/lib/prisma";
import {
  createHistoryEvent,
  deleteHistoryEvent,
  historyAdminState,
  listChangeSetEntries,
  listHistoryEvents,
  scopeForEmail,
  setBuiltinHidden,
  updateHistoryEvent,
} from "@/lib/services";
import type { Scope } from "@/lib/scope";
import { BUILTIN_HISTORY } from "@/lib/history/builtin";
import { GET as listGet, POST as createPost } from "@/app/api/history-events/route";
import { PATCH as eventPatch, DELETE as eventDelete } from "@/app/api/history-events/[id]/route";
import { PATCH as builtinPatch } from "@/app/api/history-events/builtin/[id]/route";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const dbReady = !(await mockDbSkipReason());
if (!dbReady) console.warn("\n[tests] Zeitgeschichte-Tests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const BUILTIN = "erster-weltkrieg";
const EVENT = { title: "Test-Hochwasser", yearFrom: "1882", yearTo: "", kind: "not", description: "Der Fluss trat über die Ufer.", region: "Beispieltal" };

async function cleanup() {
  await prisma.historyEvent.deleteMany({});
  await prisma.historyHiddenBuiltin.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { entityType: "HistoryEvent" } });
}

beforeEach(async () => {
  if (dbReady) await cleanup();
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe.skipIf(!dbReady)("Dienst", () => {
  let admin: Scope;
  let editor: Scope;
  let viewer: Scope;

  beforeEach(async () => {
    admin = (await scopeForEmail("admin@example.test"))!;
    editor = (await scopeForEmail("editor@example.test"))!;
    viewer = (await scopeForEmail("viewer@example.test"))!;
  });

  it("ohne Einträge: die mitgelieferte Liste vollständig", async () => {
    const list = await listHistoryEvents();
    expect(list).toHaveLength(BUILTIN_HISTORY.length);
    expect(list.every((e) => e.source === "builtin")).toBe(true);
  });

  it("anlegen, ändern, löschen — mit Wirkung auf die Anzeigeliste", async () => {
    const created = await createHistoryEvent(admin, EVENT);
    expect(created).toMatchObject({ title: "Test-Hochwasser", yearFrom: 1882, yearTo: null, kind: "not", region: "Beispieltal" });
    expect((await listHistoryEvents()).find((e) => e.id === `c:${created.id}`)).toMatchObject({ source: "custom", from: 1882 });

    const updated = await updateHistoryEvent(admin, created.id, { ...EVENT, yearTo: "1883", region: "" });
    expect(updated).toMatchObject({ yearTo: 1883, region: null });

    await deleteHistoryEvent(admin, created.id);
    expect((await listHistoryEvents()).some((e) => e.source === "custom")).toBe(false);
    await expect(deleteHistoryEvent(admin, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateHistoryEvent(admin, created.id, EVENT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Prüfung auf dem Server", async () => {
    await expect(createHistoryEvent(admin, { ...EVENT, title: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createHistoryEvent(admin, { ...EVENT, yearTo: "1800" })).rejects.toMatchObject({
      code: "VALIDATION",
      issues: [expect.objectContaining({ path: ["yearTo"] })],
    });
    expect(await prisma.historyEvent.count()).toBe(0);
  });

  it("mitgelieferte aus- und wieder einblenden; unbekannte Kennung", async () => {
    expect((await setBuiltinHidden(admin, BUILTIN, true)).hidden).toBe(true);
    expect((await listHistoryEvents()).some((e) => e.id === BUILTIN)).toBe(false);
    expect((await historyAdminState(admin)).builtin.find((b) => b.id === BUILTIN)?.hidden).toBe(true);
    // Schon ausgeblendet: nichts zu tun.
    await setBuiltinHidden(admin, BUILTIN, true);
    expect(await prisma.historyHiddenBuiltin.count()).toBe(1);

    expect((await setBuiltinHidden(admin, BUILTIN, false)).hidden).toBe(false);
    expect((await listHistoryEvents()).some((e) => e.id === BUILTIN)).toBe(true);
    await expect(setBuiltinHidden(admin, "gibt-es-nicht", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("nur Administratoren pflegen; lesen dürfen alle", async () => {
    for (const s of [editor, viewer]) {
      await expect(historyAdminState(s)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createHistoryEvent(s, EVENT)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setBuiltinHidden(s, BUILTIN, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const own = await createHistoryEvent(admin, EVENT);
    await expect(updateHistoryEvent(editor, own.id, EVENT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteHistoryEvent(viewer, own.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.historyHiddenBuiltin.count()).toBe(0);
    expect(await prisma.historyEvent.count()).toBe(1);
  });

  it("Protokoll: Benutzer, vorher → nachher, lesbar in der Änderungsübersicht", async () => {
    const own = await createHistoryEvent(admin, EVENT);
    await updateHistoryEvent(admin, own.id, EVENT); // unverändert: kein Eintrag
    await updateHistoryEvent(admin, own.id, { ...EVENT, yearFrom: "1881" });
    await setBuiltinHidden(admin, BUILTIN, true);
    await setBuiltinHidden(admin, BUILTIN, false);
    await deleteHistoryEvent(admin, own.id);

    const rows = await prisma.auditLog.findMany({ where: { entityType: "HistoryEvent" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["CREATE", "UPDATE", "UPDATE", "UPDATE", "DELETE"]);
    expect(rows.every((r) => r.userId === admin.userId)).toBe(true);
    expect(rows[1].diff).toMatchObject({ changes: { yearFrom: { from: 1882, to: 1881 } } });

    const entries = await Promise.all(rows.map((r) => listChangeSetEntries(admin, r.changeSetId ?? `e:${r.id}`)));
    const [created, changed, hidden, shown, removed] = entries.map((p, i) => p.items.find((it) => it.id === rows[i].id)!);
    expect(created.what).toBe("Zeitgeschichte „Test-Hochwasser“ angelegt");
    expect(created.fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Art", to: "Seuche/Not" })]));
    expect(changed.what).toBe("Zeitgeschichte „Test-Hochwasser“ geändert");
    expect(changed.fields).toEqual([expect.objectContaining({ label: "Jahr von", from: "1882", to: "1881" })]);
    expect(hidden.what).toBe("Zeitgeschichte „Erster Weltkrieg“ ausgeblendet");
    expect(shown.what).toBe("Zeitgeschichte „Erster Weltkrieg“ wieder eingeblendet");
    expect(removed.what).toBe("Zeitgeschichte „Test-Hochwasser“ gelöscht");
  });
});

describe.skipIf(!dbReady)("API /api/history-events", () => {
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
  const params = (id?: string) => ({ params: Promise.resolve(id ? { id } : {}) }) as never;

  it("Administrator: anlegen, ändern, ausblenden, löschen; Fehlercodes", async () => {
    login("admin@example.test");
    const created = await createPost(json("POST", "/api/history-events", EVENT), params());
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const bad = await createPost(json("POST", "/api/history-events", { ...EVENT, yearFrom: "abc" }), params());
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toEqual(["yearFrom"]);

    expect((await eventPatch(json("PATCH", `/api/history-events/${id}`, { ...EVENT, title: "Neu" }), params(id))).status).toBe(200);
    expect((await builtinPatch(json("PATCH", `/api/history-events/builtin/${BUILTIN}`, { hidden: true }), params(BUILTIN))).status).toBe(200);
    expect((await builtinPatch(json("PATCH", "/api/history-events/builtin/x", { hidden: true }), params("x"))).status).toBe(404);
    expect((await builtinPatch(json("PATCH", `/api/history-events/builtin/${BUILTIN}`, { hidden: "ja" }), params(BUILTIN))).status).toBe(400);

    const state = await (await listGet(json("GET", "/api/history-events"), params())).json();
    expect(state.custom).toEqual([expect.objectContaining({ id, title: "Neu" })]);
    expect(state.builtin.find((b: { id: string }) => b.id === BUILTIN).hidden).toBe(true);

    expect((await eventDelete(json("DELETE", `/api/history-events/${id}`), params(id))).status).toBe(200);
    expect((await eventDelete(json("DELETE", `/api/history-events/${id}`), params(id))).status).toBe(404);
  });

  it("Nicht-Administratoren: 403; fremde Herkunft: 403", async () => {
    for (const email of ["editor@example.test", "viewer@example.test"]) {
      login(email);
      expect((await listGet(json("GET", "/api/history-events"), params())).status).toBe(403);
      expect((await createPost(json("POST", "/api/history-events", EVENT), params())).status).toBe(403);
      expect((await builtinPatch(json("PATCH", `/api/history-events/builtin/${BUILTIN}`, { hidden: true }), params(BUILTIN))).status).toBe(403);
    }
    login("admin@example.test");
    const foreign = await createPost(
      json("POST", "/api/history-events", EVENT, { origin: "https://boese.example", host: "localhost:3999" }),
      params(),
    );
    expect(foreign.status).toBe(403);
    expect(await prisma.historyEvent.count()).toBe(0);
    expect(await prisma.historyHiddenBuiltin.count()).toBe(0);
  });
});
