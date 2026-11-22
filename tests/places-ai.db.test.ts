/**
 * Orte ohne Knopfdruck und mit KI (gegen die Mock-Datenbank):
 * - Vorschlag am Eingabefeld (GET /api/places/suggest, placeHint): Rechte,
 *   historischer Name, mehrdeutig, nicht gefunden, eigene Orte.
 * - Automatische Zuordnung nach dem Speichern bzw. nach Importen im
 *   Hintergrund: nur Texte ohne Zuordnung, MANUAL und KI bleiben, Protokoll
 *   im Paket „Orte automatisch zugeordnet“, Fehler lassen das Speichern nie
 *   scheitern.
 * - MCP-Werkzeuge suggest_place, list_places, assign_place über den
 *   HTTP-Endpunkt: Rechte, Kennzeichnung „von KI“, Liste, eigener Ort,
 *   Protokoll mit Kanal und Schlüssel; Admin bestätigt (→ MANUAL).
 *
 * Legt nur eigene Personen und Ortszuordnungen an (Ortstexte aus Schlesien,
 * die die Mock-Daten nicht enthalten) und räumt sie samt Protokoll ab.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { createEvent, createPerson, createRelationship, scopeForEmail, updatePerson } from "@/lib/services";
import {
  assignPlace,
  autoAssignPlaces,
  listPlaces,
  placeAutoAssignIdle,
  placeHint,
  queuePlaceAutoAssign,
} from "@/lib/services/places";
import { placeKey } from "@/lib/places/normalize";
import * as mcpRoute from "@/app/api/mcp/route";
import { resetMcpRateLimit } from "@/mcp/http";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

// Anmeldung der Web-API für den Routen-Test: wer gerade „angemeldet“ ist.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const skipReason = await mockDbSkipReason({ check: async () => (await prisma.apiToken.count()) > 0, missing: "ohne KI-Testschlüssel" });
if (skipReason) console.warn(`\n[tests] Orte-KI-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const secretOf = (key: string) => data.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;
const tokenIdOf = (key: string) => `mock-token-${key}`;

// Ortstexte nur dieses Tests (kommen in den Mock-Daten nicht vor).
const T = {
  manual: "Liegnitz, Schlesien",
  ai: "Oppeln, Schlesien",
  birth: "Glogau, Schlesien",
  event: "Brieg, Schlesien",
  marriage: "Neisse, Schlesien",
  imported: "Ratibor, Schlesien",
  mcpDirectory: "Glatz, Schlesien",
  mcpOwn: "Hof Lindenau bei Vöhrum",
  mcpOwnLater: "Hof Lindenau, Amt Peine",
  failing: "Schweidnitz, Schlesien",
};
const KEYS = Object.values(T).map(placeKey);
const FAMILY = "mock-family-a";

const createdPersons: string[] = [];

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function cleanup() {
  const places = await prisma.place.findMany({ where: { key: { in: KEYS } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityType: "Place", entityId: { in: places.map((p) => p.id) } } });
  await prisma.place.deleteMany({ where: { key: { in: KEYS } } });
  if (createdPersons.length) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdPersons } } });
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
  }
  await prisma.changeSet.deleteMany({
    where: { entries: { none: {} }, title: { in: ["Orte automatisch zugeordnet", "Orte zugeordnet (KI)", "Person angelegt", "Person geändert"] } },
  });
}

const prevEnv = process.env.PLACE_AUTO_ASSIGN;

describe.skipIf(Boolean(skipReason))("Orte: Vorschlag, Automatik nach dem Speichern, KI (Mock-Datenbank)", () => {
  beforeAll(async () => {
    process.env.PLACE_AUTO_ASSIGN = "on";
    await cleanup();
  });
  afterEach(() => {
    session.current = null;
  });
  afterAll(async () => {
    process.env.PLACE_AUTO_ASSIGN = prevEnv;
    await placeAutoAssignIdle();
    vi.restoreAllMocks();
    for (const c of clients) await c.close().catch(() => {});
    resetMcpRateLimit();
    await cleanup();
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Vorschlag am Eingabefeld
  // -------------------------------------------------------------------------

  it("Vorschlag: historischer Name, mehrdeutig, nicht gefunden", async () => {
    const editor = await scope("editor@example.test");
    const t0 = performance.now();
    const breslau = await placeHint(editor, "Breslau");
    const first = performance.now() - t0;
    expect(breslau).toMatchObject({
      status: "found",
      own: false,
      label: "Wrocław (Breslau), Polen",
      precision: "PLACE",
      formerName: "Breslau",
    });
    const t1 = performance.now();
    const danzig = await placeHint(editor, "Danzig, Westpreußen");
    const warm = performance.now() - t1;
    expect(danzig).toMatchObject({ status: "found", label: "Gdańsk (Danzig), Polen", formerName: "Danzig" });
    // Heutiger Name in anderer Schreibweise ist kein „früherer Name“.
    expect(await placeHint(editor, "Wroclaw")).toMatchObject({ status: "found", formerName: null });
    // Hatzfeld gibt es in Hessen und (als deutscher Name von Jimbolia) im Banat.
    expect((await placeHint(editor, "Hatzfeld")).status).toBe("ambiguous");
    expect((await placeHint(editor, "Qxzvwy Nirgendwo")).status).toBe("none");
    expect((await placeHint(editor, "B")).status).toBe("none");
    console.info(`[places-ai] Vorschlag: erster Aufruf ${first.toFixed(0)} ms (Verzeichnis laden), danach ${warm.toFixed(1)} ms`);
    expect(warm).toBeLessThan(500);
  });

  it("Vorschlag: Rechte — Bearbeiter und Admin ja, Betrachter und ohne Familie nein", async () => {
    await expect(placeHint(await scope("viewer@example.test"), "Breslau")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(placeHint(await scope("nofamily@example.test"), "Breslau")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await placeHint(await scope("admin@example.test"), "Breslau")).status).toBe("found");
  });

  it("GET /api/places/suggest: 401 ohne Anmeldung, 403 für Betrachter, Ergebnis für Bearbeiter", async () => {
    const { GET } = await import("@/app/api/places/suggest/route");
    const call = (q: string | null) =>
      GET(new Request(`http://localhost/api/places/suggest${q === null ? "" : `?q=${encodeURIComponent(q)}`}`), {
        params: Promise.resolve({}),
      });
    expect((await call("Breslau")).status).toBe(401);
    session.current = { user: { id: "mock-user-viewer", role: "VIEWER" } };
    expect((await call("Breslau")).status).toBe(403);
    session.current = { user: { id: "mock-user-editor", role: "EDITOR" } };
    const res = await call("Königsberg, Ostpreußen");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "found", label: "Kaliningrad (Königsberg), Russland", formerName: "Königsberg" });
    // Nur Verzeichnisdaten: keine Personen, keine Zählungen.
    expect(Object.keys(body).sort()).toEqual(
      ["ambiguous", "formerName", "label", "matchedPart", "otherName", "own", "precision", "status"].sort(),
    );
    // Ohne q: Vorwärmen.
    expect(await (await call(null)).json()).toEqual({ warming: true });
  });

  // -------------------------------------------------------------------------
  // Automatik nach dem Speichern
  // -------------------------------------------------------------------------

  it("nach dem Speichern: neue Texte AUTO, MANUAL und KI bleiben, Paket „Orte automatisch zugeordnet“", async () => {
    const admin = await scope("admin@example.test");
    const editor = await scope("editor@example.test");
    await prisma.place.create({
      data: { key: placeKey(T.manual), text: T.manual, source: "MANUAL", precision: "PLACE", latitude: 1, longitude: 2, label: "Von Hand" },
    });
    await prisma.place.create({
      data: { key: placeKey(T.ai), text: T.ai, source: "AI", precision: "PLACE", latitude: 3, longitude: 4, label: "Von KI", note: "Test" },
    });

    const started = Date.now();
    const p = await createPerson(editor, { givenName: "Ortstest", familyName: "Vitest-Orte", birthPlace: T.birth, deathPlace: T.manual, familyIds: [FAMILY] });
    createdPersons.push(p.id);
    // Das Speichern wartet nicht auf die Zuordnung.
    expect(Date.now() - started).toBeLessThan(2000);
    await updatePerson(editor, p.id, { deathPlace: T.ai });
    await createEvent(editor, { personId: p.id, type: "RESIDENCE", date: "1890", place: T.event });
    const partner = await createPerson(admin, { givenName: "Partner", familyName: "Vitest-Orte", familyIds: [FAMILY] });
    createdPersons.push(partner.id);
    await createRelationship(editor, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: p.id, toPersonId: partner.id, startPlace: T.marriage });
    await placeAutoAssignIdle();

    const rows = new Map((await prisma.place.findMany({ where: { key: { in: KEYS } } })).map((r) => [r.key, r]));
    expect(rows.get(placeKey(T.birth))).toMatchObject({ source: "AUTO", label: expect.stringMatching(/^Głogów \(Glogau\), Polen$/) });
    expect(rows.get(placeKey(T.event))).toMatchObject({ source: "AUTO", label: expect.stringMatching(/Polen$/) });
    expect(rows.get(placeKey(T.marriage))).toMatchObject({ source: "AUTO", label: expect.stringMatching(/Polen$/) });
    expect(rows.get(placeKey(T.manual))).toMatchObject({ source: "MANUAL", latitude: 1, longitude: 2, label: "Von Hand" });
    expect(rows.get(placeKey(T.ai))).toMatchObject({ source: "AI", latitude: 3, longitude: 4, label: "Von KI", note: "Test" });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Place", entityId: rows.get(placeKey(T.birth))!.id },
      include: { changeSet: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "CREATE", userId: "mock-user-editor", channel: null });
    expect(audit[0].changeSet?.title).toBe("Orte automatisch zugeordnet");

    // Der Knopf „Automatisch zuordnen“ lässt KI-Zuordnungen ebenfalls stehen.
    const r = await autoAssignPlaces(admin);
    expect(r.ai).toBeGreaterThanOrEqual(1);
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.ai) } })).toMatchObject({ source: "AI", latitude: 3 });
  });

  it("nach einem Import: alle offenen Texte; ein Fehler dabei lässt das Speichern nicht scheitern", async () => {
    const editor = await scope("editor@example.test");
    // Wie ein Import: Text direkt in der Datenbank, dann ohne Textliste anstoßen.
    const imp = await prisma.person.create({ data: { givenName: "Import", familyName: "Vitest-Orte", birthPlace: T.imported } });
    createdPersons.push(imp.id);
    queuePlaceAutoAssign(editor);
    await placeAutoAssignIdle();
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.imported) } })).toMatchObject({ source: "AUTO" });

    // Datenbankfehler in der Zuordnung: Speichern klappt, Fehler nur im Log.
    const spy = vi.spyOn(prisma.place, "createMany").mockRejectedValueOnce(new Error("kaputt"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = await createPerson(editor, { givenName: "Fehlertest", familyName: "Vitest-Orte", birthPlace: T.failing, familyIds: [FAMILY] });
    createdPersons.push(p.id);
    await placeAutoAssignIdle();
    expect(spy).toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).includes("[places]"))).toBe(true);
    expect(await prisma.person.findUnique({ where: { id: p.id } })).toMatchObject({ birthPlace: T.failing });
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.failing) } })).toBeNull();
    spy.mockRestore();
    log.mockRestore();
    // Abgeschaltet (wie in den übrigen Tests): nichts passiert.
    process.env.PLACE_AUTO_ASSIGN = "off";
    queuePlaceAutoAssign(editor, [T.failing]);
    await placeAutoAssignIdle();
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.failing) } })).toBeNull();
    process.env.PLACE_AUTO_ASSIGN = "on";
  });

  // -------------------------------------------------------------------------
  // MCP
  // -------------------------------------------------------------------------

  it("MCP: suggest_place für jeden Lesezugang, list_places nur für Admins", async () => {
    const viewer = await connect(secretOf("viewer-read"));
    const s = await viewer.call("suggest_place", { text: "Breslau, Schlesien, Preußen" });
    expect(s.isError, s.text).toBe(false);
    expect(s.data.recommended).toMatchObject({
      source: "directory",
      label: "Wrocław (Breslau), Polen",
      matchedName: "Breslau",
      nameKind: "historic",
      kind: "Ort",
      recommended: true,
    });
    expect(s.data.recommended.population).toBeGreaterThan(100_000);
    expect(s.data.current).toBeUndefined(); // vorhandene Zuordnung nur für Admins

    const amb = await viewer.call("suggest_place", { text: "Hatzfeld" });
    expect(amb.data.ambiguous).toBeGreaterThan(0);
    expect(amb.data.candidates.length).toBeGreaterThan(1);
    expect(amb.data.candidates.some((c: { label: string }) => /Jimbolia \(Hatzfeld\)/.test(c.label))).toBe(true);

    const denied = await viewer.call("list_places", { status: "offen" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Berechtigung/);
    const editorKey = await connect(secretOf("editor-write"));
    expect((await editorKey.call("list_places", {})).isError).toBe(true);
    const r = await editorKey.call("assign_place", { text: T.mcpDirectory, unresolvable: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Berechtigung/);
  });

  it("MCP: Admin arbeitet offene Texte ab — Liste mit Kontext, Stapel, eigener Ort, KI-Kennzeichnung, Protokoll", async () => {
    const admin = await scope("admin@example.test");
    const p = await prisma.person.create({
      data: {
        givenName: "KI-Orte",
        familyName: "Vitest-Orte",
        birthPlace: T.mcpDirectory,
        birthDate: new Date(Date.UTC(1871, 0, 1)),
        birthDatePrecision: "YEAR",
        deathPlace: T.mcpOwn,
        families: { create: [{ familyId: FAMILY }] },
      },
    });
    createdPersons.push(p.id);
    const s = await connect(secretOf("admin-write"));

    const list = await s.call("list_places", { status: "offen", query: "Glatz" });
    expect(list.isError, list.text).toBe(false);
    const row = list.data.places.find((x: { text: string }) => x.text === T.mcpDirectory);
    expect(row).toMatchObject({ status: "open", count: 1, context: { fields: { birth: 1 }, fromYear: 1871, toYear: 1871 } });
    expect(JSON.stringify(list.data)).not.toContain("KI-Orte"); // keine Personennamen

    const sug = await s.call("suggest_place", { text: T.mcpDirectory });
    const glatz = sug.data.recommended;
    expect(glatz.label).toMatch(/^Kłodzko \(Glatz\), Polen$/);

    const res = await s.call("assign_place", {
      assignments: [
        { text: T.mcpDirectory, gazetteer_id: glatz.gazetteerId, note: "Grafschaft Glatz, einziger Ort dieses Namens in Schlesien" },
        {
          text: T.mcpOwn,
          latitude: 52.35,
          longitude: 10.2,
          label: "Hof Lindenau (Wüstung), Niedersachsen, Deutschland",
          uncertain: true,
          note: "Nicht im Verzeichnis; Lage nach alter Karte",
        },
        { text: "Gibt es nicht, Nirgendwo", unresolvable: true },
        { text: T.manual, unresolvable: true },
      ],
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.data).toMatchObject({ assigned: 2, failed: 2 });
    expect(res.data.results[2]).toMatchObject({ ok: false, error: expect.stringMatching(/kommt in den Daten nicht vor/) });
    expect(res.data.results[3]).toMatchObject({ ok: false, error: expect.stringMatching(/Von Hand bestätigt/) });
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.manual) } })).toMatchObject({ source: "MANUAL", latitude: 1 });

    const dir = await prisma.place.findUnique({ where: { key: placeKey(T.mcpDirectory) } });
    expect(dir).toMatchObject({ source: "AI", gazetteerId: glatz.gazetteerId, uncertain: false, note: expect.stringContaining("Grafschaft") });
    const own = await prisma.place.findUnique({ where: { key: placeKey(T.mcpOwn) } });
    expect(own).toMatchObject({ source: "AI", gazetteerId: null, latitude: 52.35, longitude: 10.2, uncertain: true, precision: "PLACE" });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Place", entityId: own!.id }, include: { changeSet: true } });
    expect(audit).toMatchObject({ action: "CREATE", userId: "mock-user-admin", channel: "MCP", apiTokenId: tokenIdOf("admin-write") });
    expect(audit!.changeSet?.title).toBe("Orte zugeordnet (KI)");

    // Eigener Ort erscheint bei späteren Texten als Kandidat — in suggest_place und am Eingabefeld.
    const later = await s.call("suggest_place", { text: T.mcpOwnLater });
    expect(later.data.candidates.some((c: { source: string; label: string }) => c.source === "own" && /Hof Lindenau/.test(c.label))).toBe(true);
    expect(await placeHint(await scope("editor@example.test"), T.mcpOwnLater)).toMatchObject({ own: true, label: expect.stringMatching(/^Hof Lindenau/) });
    const current = await s.call("suggest_place", { text: T.mcpOwn });
    expect(current.data.current).toMatchObject({ source: "AI", status: "ai", uncertain: true });

    // Einzelaufruf überschreibt eine KI-Zuordnung.
    const single = await s.call("assign_place", { text: T.mcpOwn, latitude: 52.36, longitude: 10.21, label: "Hof Lindenau, Niedersachsen, Deutschland" });
    expect(single.data.results[0]).toMatchObject({ ok: true, replaced: "AI", status: "ai" });
    // Beides zugleich bzw. nichts: Validierungsfehler.
    expect((await s.call("assign_place", { text: T.mcpOwn, unresolvable: true, gazetteer_id: "1" })).isError).toBe(true);
    expect((await s.call("assign_place", {})).isError).toBe(true);

    // Admin-Seite: Filter „von KI“, Bestätigen → MANUAL; die Karte nutzt KI-Zuordnungen sofort.
    const ai = await listPlaces(admin, { status: "ai", q: "lindenau" });
    expect(ai.rows.map((r) => r.text)).toContain(T.mcpOwn);
    expect(ai.rows.find((r) => r.text === T.mcpOwn)!.assignment).toMatchObject({ source: "AI", note: null }); // neue Wahl ohne Begründung ersetzt die alte
    const confirmed = await assignPlace(admin, { action: "confirm", text: T.mcpOwn });
    expect(confirmed).toMatchObject({ source: "MANUAL", latitude: 52.36, uncertain: false });
    expect((await listPlaces(admin, { status: "manual", q: "lindenau" })).rows.map((r) => r.text)).toContain(T.mcpOwn);
  });
});

// ---------------------------------------------------------------------------
// MCP über den HTTP-Endpunkt (wie tests/mcp-http.db.test.ts)
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
};

async function connect(secret: string): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: dispatch,
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  const client = new Client({ name: "vitest-places", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return {
    call: async (name, args = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
      const text = r.content[0]?.text ?? "";
      const isError = Boolean(r.isError);
      return { isError, data: isError ? null : JSON.parse(text), text };
    },
  };
}
