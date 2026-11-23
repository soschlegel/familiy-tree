/**
 * Schutz in `route()` (lib/api.ts) und an einzelnen Routen, aufgerufen wie
 * von Next.js — mit Mock-Datenbank, die Anmeldung (lib/auth.ts) als
 * Attrappe: fremde Herkunft, zu große Körper, Drosselung, Kopfzeilen gegen
 * Zwischenspeichern, Baum ohne freigegebene Familie, Bildauslieferung nur
 * als Bild.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { API_RULES, resetApiRateLimit } from "@/lib/rate-limit";
import { MAX_JSON_BODY_BYTES } from "@/lib/request-guard";
import { addMedia, createPerson, scopeForEmail } from "@/lib/services";
import { removeOrphanedMedia } from "@/lib/services/media";
import { GET as treeGet } from "@/app/api/tree/route";
import { GET as mediaGet } from "@/app/api/media/[id]/route";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const dbReady = !(await mockDbSkipReason());
if (!dbReady) console.warn("\n[tests] Routen-Schutz-Tests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const BASE = "http://localhost:3999";
const users = Object.fromEntries(mockData().users.map((u) => [u.email, u]));
function login(email: string | null) {
  session.current = email ? { user: { id: users[email].id, role: users[email].role } } : null;
}

const echo = route(null, async () => Response.json({ ok: true }));
const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
  echo(new Request(`${BASE}${path}`, { method, headers, body }), { params: Promise.resolve({}) });

const previousRate = process.env.RATE_LIMIT;
beforeEach(() => {
  resetApiRateLimit();
  delete process.env.RATE_LIMIT;
});
afterAll(() => {
  if (previousRate === undefined) delete process.env.RATE_LIMIT;
  else process.env.RATE_LIMIT = previousRate;
});

describe.skipIf(!dbReady)("route(): Schutz vor dem Handler", () => {
  it("schreibende Anfrage einer fremden Seite: 403, noch vor der Anmeldeprüfung", async () => {
    login(null);
    const res = await call("POST", "/api/persons", { origin: "https://boese.example", host: "localhost:3999" }, "{}");
    expect(res.status).toBe(403);
    login("editor@example.test");
    const own = await call("POST", "/api/persons", { origin: BASE, host: "localhost:3999" }, "{}");
    expect(own.status).toBe(200);
  });

  it("zu großer Körper: 413", async () => {
    login("editor@example.test");
    const res = await call("PATCH", "/api/persons/x", { "content-length": String(MAX_JSON_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  it("Drosselung: 429 mit Retry-After", async () => {
    login("editor@example.test");
    for (let i = 0; i < API_RULES.export.limit; i++) expect((await call("GET", "/api/export")).status).toBe(200);
    const res = await call("GET", "/api/export");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("Antworten: nicht zwischenspeichern, nosniff — auch Fehlerantworten", async () => {
    login("editor@example.test");
    const ok = await call("GET", "/api/persons");
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    login(null);
    const anon = await call("GET", "/api/persons");
    expect(anon.status).toBe(401);
    expect(anon.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe.skipIf(!dbReady)("Routen", () => {
  const media: string[] = [];
  const persons: string[] = [];

  beforeAll(async () => {
    const admin = (await scopeForEmail("admin@example.test"))!;
    const famA = mockData().families.find((f) => f.key === "A")!.id;
    const p = await createPerson(admin, { givenName: "Bild", familyName: `Schutz${Date.now().toString(36)}`, familyIds: [famA] });
    persons.push(p.id);
    const png = await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    media.push((await addMedia(admin, { bytes: png, targets: { personIds: [p.id] } })).media.id);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...persons, ...media] } }, { personIds: { hasSome: persons } }] } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await removeOrphanedMedia(media);
  });

  it("/api/tree ohne freigegebene Familie: keine Platzhalter fremder Personen", async () => {
    login("nofamily@example.test");
    const res = await treeGet(new Request(`${BASE}/api/tree`), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ persons: [], relationships: [] });
    login("viewer@example.test");
    const seen = (await (await treeGet(new Request(`${BASE}/api/tree`), { params: Promise.resolve({}) })).json()) as { persons: unknown[] };
    expect(seen.persons.length).toBeGreaterThan(0);
  });

  it("Bildauslieferung: nur Bildarten, sonst neutraler Typ; Sandbox und nosniff", async () => {
    login("admin@example.test");
    const id = media[0];
    const get = () => mediaGet(new Request(`${BASE}/api/media/${id}`), { params: Promise.resolve({ id }) });
    const normal = await get();
    expect(normal.status).toBe(200);
    expect(normal.headers.get("Content-Type")).toMatch(/^image\//);
    expect(normal.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(normal.headers.get("Content-Security-Policy")).toContain("sandbox");
    // Ein Datensatz, der etwas anderes behauptet (z.B. aus einem Import), wird nie als Seite ausgeliefert.
    const before = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    await prisma.mediaAsset.update({ where: { id }, data: { mimeType: "text/html" } });
    try {
      expect((await get()).headers.get("Content-Type")).toBe("application/octet-stream");
      await prisma.mediaAsset.update({ where: { id }, data: { mimeType: "image/svg+xml" } });
      expect((await get()).headers.get("Content-Type")).toBe("application/octet-stream");
    } finally {
      await prisma.mediaAsset.update({ where: { id }, data: { mimeType: before.mimeType } });
    }
  });
});
