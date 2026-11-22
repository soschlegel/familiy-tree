/**
 * Neuigkeiten gegen die Mock-Datenbank: „Gelesen“ merkt das Release nur
 * beim angemeldeten Benutzer selbst (markReleaseSeen), unbekannte Kennungen
 * werden abgelehnt; die Mock-Benutzer haben das neueste Release nach dem
 * Seed schon gesehen (sonst stünde „Was ist neu?“ in jedem E2E-Test im Weg).
 *
 * Legt einen eigenen Benutzer an und löscht ihn wieder.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { parseReleaseNotes } from "@/lib/release-notes";
import { latestReleaseId, releaseNotes } from "@/lib/release-notes-data";
import { markReleaseSeen, ServiceError } from "@/lib/services";
import { mockDbSkipReason } from "./db-ready";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Neuigkeiten-Tests übersprungen: ${skipReason}\n`);

describe.skipIf(Boolean(skipReason))("Neuigkeiten (Testdatenbank)", () => {
  const tag = randomUUID().slice(0, 8);
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `neuigkeiten-${tag}@example.test`, role: "VIEWER", status: "ACTIVE" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("neuer Datensatz ohne Angabe: noch nichts gesehen", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lastSeenReleaseId).toBeNull();
  });

  it("merkt eine bekannte Kennung — nur beim eigenen Benutzer", async () => {
    const releases = releaseNotes();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: "mock-user-viewer" } });
    const oldest = releases[releases.length - 1].id;
    expect(await markReleaseSeen({ userId }, oldest, releases)).toEqual({ lastSeenReleaseId: oldest });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).lastSeenReleaseId).toBe(oldest);
    // Auch zurück auf ein älteres ist erlaubt (es ist nur eine Lesemarke).
    await markReleaseSeen({ userId }, releases[0].id, releases);
    await markReleaseSeen({ userId }, oldest, releases);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).lastSeenReleaseId).toBe(oldest);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: "mock-user-viewer" } });
    expect(after.lastSeenReleaseId).toBe(before.lastSeenReleaseId);
  });

  it("lehnt unbekannte Kennungen ab, ohne etwas zu ändern", async () => {
    const releases = releaseNotes();
    for (const bad of ["2000-01-01.1", "abc1234", ""]) {
      await expect(markReleaseSeen({ userId }, bad, releases)).rejects.toThrow(ServiceError);
    }
    const err = await markReleaseSeen({ userId }, "2000-01-01.1", releases).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).lastSeenReleaseId).toBe(
      releases[releases.length - 1].id,
    );
    // Nur Kennungen aus der übergebenen Liste zählen.
    const other = parseReleaseNotes("## 2000-01-01.1 — Test\n- x").releases;
    await markReleaseSeen({ userId }, "2000-01-01.1", other);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).lastSeenReleaseId).toBe("2000-01-01.1");
  });

  it("Mock-Benutzer haben das neueste Release schon gesehen (prisma/seed-mock.ts)", async () => {
    const users = await prisma.user.findMany({ where: { id: { startsWith: "mock-user-" } } });
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(u.lastSeenReleaseId, u.email).toBe(latestReleaseId());
  });
});
