/**
 * Healthcheck: knapp "ok"/"error", schlägt aber auch fehl, wenn der
 * Medienordner nicht beschreibbar ist. Datenbank als Attrappe.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => {
      if (!db.ok) throw new Error("Verbindung abgelehnt");
      return [{ "?column?": 1 }];
    }),
  },
}));

import { GET } from "@/app/api/health/route";

let base: string;
const previous = process.env.MEDIA_DIR;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "familytree-health-"));
});
afterAll(async () => {
  if (previous === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = previous;
  await rm(base, { recursive: true, force: true });
});
beforeEach(() => {
  db.ok = true;
  process.env.MEDIA_DIR = path.join(base, "media");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(console.error).mockClear();
});

/**
 * Genau eine einzeilige Log-Meldung je Fehlschlag: Ordner und Fehlercode
 * (z.B. EEXIST, ENOTDIR), kein Stack, kein Fehlerobjekt als zweites Argument.
 */
function healthLogLine(): string {
  const calls = vi.mocked(console.error).mock.calls.filter((c) => String(c[0]).startsWith("[health]"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toHaveLength(1);
  const line = String(calls[0][0]);
  expect(line).not.toContain("\n");
  expect(line).toMatch(/\(E[A-Z]+\)/);
  return line;
}

describe("GET /api/health", () => {
  it("200 ok, wenn Datenbank und Medienordner in Ordnung sind", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("503 error, wenn der Medienordner nicht beschreibbar ist — Grund nur im Log", async () => {
    const file = path.join(base, "keinordner");
    await writeFile(file, "x");
    process.env.MEDIA_DIR = file;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
    const line = healthLogLine();
    expect(line).toContain("Medienordner");
    expect(line).toContain(file);
  });

  it("503 error, wenn nur ein Unterordner (thumbs/) nicht beschreibbar ist — Log nennt ihn", async () => {
    // Wurzel beschreibbar, thumbs/ blockiert — wie nach einer Wiederherstellung
    // mit root-eigenen Unterordnern. Datei statt Ordner: wirkt auch unter Windows.
    const dir = path.join(base, "media-unterordner");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "thumbs"), "x");
    process.env.MEDIA_DIR = dir;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
    const line = healthLogLine();
    expect(line).toContain("Medienordner");
    expect(line).toContain(path.join(dir, "thumbs"));
  });

  it("503 error, wenn die Datenbank nicht erreichbar ist", async () => {
    db.ok = false;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
  });
});
