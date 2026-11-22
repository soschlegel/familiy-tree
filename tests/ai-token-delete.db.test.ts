/**
 * KI-Schlüssel endgültig löschen (lib/services/ai-access.ts, deleteApiToken)
 * gegen die Mock-Datenbank: Löschregeln (widerrufen, abgelaufen, nie benutzt
 * ja — aktiv und benutzt nein), Rechte (eigene, fremde nur als Admin, nie
 * über den KI-Kanal), Protokoll mit Paket und die Änderungsgeschichte nach
 * dem Löschen („Schlüssel „…“ (gelöscht)“).
 *
 * Legt eigene Schlüssel und eine Person an und räumt alles (samt Audit und
 * Paketen) wieder ab; die festen Mock-Schlüssel bleiben unberührt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { generateToken } from "@/lib/ai-tokens";
import { appChangeSet, mcpChangeSet } from "@/lib/change-sets";
import {
  apiTokenDeletable,
  createApiToken,
  createPerson,
  deleteApiToken,
  listAllApiTokens,
  listApiTokens,
  listChangeSets,
  listPersonChanges,
  revokeApiToken,
  scopeForEmail,
  ServiceError,
  updatePerson,
  verifyApiToken,
} from "@/lib/services";

async function mockDbReady(): Promise<string | null> {
  try {
    const admin = await prisma.user.findUnique({ where: { id: "mock-user-admin" } });
    if (!admin) return "Mock-Datenbank ist leer — bitte `npm run mock:setup` ausführen.";
    if ((await prisma.apiToken.count()) === 0) return "Mock-Datenbank ohne KI-Testschlüssel — `npm run mock:setup`.";
    return null;
  } catch (err) {
    return `Mock-Datenbank nicht erreichbar (${(err as Error).message.split("\n").pop()})`;
  }
}

const skipReason = await mockDbReady();
if (skipReason) console.warn(`\n[tests] Schlüssel-Löschen-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";

/** Scope wie in der Web-API: mit eigenem Paket je „Anfrage“. */
async function request(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return { ...s, changeSet: appChangeSet() };
}

async function expectCode(p: Promise<unknown>, code: ServiceError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === code);
}

describe.skipIf(Boolean(skipReason))("KI-Schlüssel löschen (Mock-Datenbank)", () => {
  const tokens: string[] = [];
  const persons: string[] = [];

  /** Schlüssel über den Dienst anlegen (mit CREATE-Protokoll). */
  async function newToken(email: string, name: string) {
    const created = await createApiToken(await request(email), { name, level: "READ" });
    tokens.push(created.token.id);
    return created;
  }

  /** Schlüssel direkt in der Datenbank — z.B. bereits abgelaufen, ohne Protokoll. */
  async function rawToken(userId: string, name: string, extra: { expiresAt?: Date; lastUsedAt?: Date } = {}) {
    const g = generateToken();
    const row = await prisma.apiToken.create({
      data: { userId, name, prefix: g.prefix, secretHash: g.secretHash, level: "WRITE", ...extra },
    });
    tokens.push(row.id);
    return { id: row.id, secret: g.secret };
  }

  beforeAll(async () => {
    const admin = await request("admin@example.test");
    persons.push((await createPerson(admin, { givenName: "E2E Schlüssel", familyName: "Löschen", familyIds: [FAMILY_A] })).id);
  });

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.apiToken.deleteMany({ where: { id: { in: tokens } } });
    const sets = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: { in: [...tokens, ...persons] } }, { apiTokenId: { in: tokens } }], changeSetId: { not: null } },
      select: { changeSetId: true },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...tokens, ...persons] } }, { apiTokenId: { in: tokens } }] },
    });
    await prisma.changeSet.deleteMany({
      where: { OR: [{ id: { in: sets.map((s) => s.changeSetId!) } }, { apiTokenId: { in: tokens } }] },
    });
    await prisma.$disconnect();
  });

  it("Regel: widerrufen, abgelaufen oder nie benutzt — sonst nicht", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const used = new Date("2026-05-01T00:00:00Z");
    const later = new Date("2026-07-01T00:00:00Z");
    expect(apiTokenDeletable({ revokedAt: used, expiresAt: later, lastUsedAt: used }, now)).toBe(true);
    expect(apiTokenDeletable({ revokedAt: null, expiresAt: used, lastUsedAt: used }, now)).toBe(true);
    expect(apiTokenDeletable({ revokedAt: null, expiresAt: later, lastUsedAt: null }, now)).toBe(true);
    expect(apiTokenDeletable({ revokedAt: null, expiresAt: null, lastUsedAt: null }, now)).toBe(true);
    expect(apiTokenDeletable({ revokedAt: null, expiresAt: later, lastUsedAt: used }, now)).toBe(false);
    expect(apiTokenDeletable({ revokedAt: null, expiresAt: null, lastUsedAt: used }, now)).toBe(false);
  });

  it("nie benutzt: Löschen ist zugleich Widerruf; Protokoll mit Paket", async () => {
    const created = await newToken("editor@example.test", "Nie benutzt");
    const scope = await request("editor@example.test");
    const gone = await deleteApiToken(scope, created.token.id);
    expect(gone).toMatchObject({ id: created.token.id, status: "ACTIVE", lastUsedAt: null });
    expect(await prisma.apiToken.findUnique({ where: { id: created.token.id } })).toBeNull();
    expect(await verifyApiToken(created.secret)).toMatchObject({ ok: false, reason: "UNKNOWN" });
    expect((await listApiTokens(scope)).map((t) => t.id)).not.toContain(created.token.id);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ApiToken", entityId: created.token.id, action: "DELETE" },
      include: { changeSet: true },
    });
    expect(audit).toMatchObject({ userId: "mock-user-editor", channel: null, apiTokenId: null });
    expect(audit.diff).toMatchObject({ name: "Nie benutzt", prefix: created.token.prefix, status: "ACTIVE", revokedByDelete: true });
    expect(audit.diff).not.toHaveProperty("ownerId");
    expect(JSON.stringify(audit.diff)).not.toContain(created.secret.slice(17));
    expect(audit.changeSet).toMatchObject({ title: "KI-Schlüssel „Nie benutzt“ gelöscht", kind: "APP", userId: "mock-user-editor" });

    // Ein zweites Mal: nicht mehr da.
    await expectCode(deleteApiToken(scope, created.token.id), "NOT_FOUND");
  });

  it("aktiv und schon benutzt: abgelehnt, erst widerrufen — dann löschbar", async () => {
    const created = await newToken("editor@example.test", "Benutzt");
    expect(await verifyApiToken(created.secret)).toMatchObject({ ok: true }); // setzt lastUsedAt
    const scope = await request("editor@example.test");
    await expectCode(deleteApiToken(scope, created.token.id), "CONFLICT");
    expect(await prisma.apiToken.findUnique({ where: { id: created.token.id } })).not.toBeNull();
    expect(await verifyApiToken(created.secret)).toMatchObject({ ok: true });
    expect(await prisma.auditLog.count({ where: { entityId: created.token.id, action: "DELETE" } })).toBe(0);

    await revokeApiToken(scope, created.token.id);
    const gone = await deleteApiToken(await request("editor@example.test"), created.token.id);
    expect(gone.status).toBe("REVOKED");
    expect(await prisma.apiToken.findUnique({ where: { id: created.token.id } })).toBeNull();
  });

  it("abgelaufen (auch benutzt): löschbar", async () => {
    const t = await rawToken("mock-user-editor", "Abgelaufen", {
      expiresAt: new Date("2026-01-01T00:00:00Z"),
      lastUsedAt: new Date("2025-12-01T00:00:00Z"),
    });
    const gone = await deleteApiToken(await request("editor@example.test"), t.id);
    expect(gone.status).toBe("EXPIRED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "DELETE" } });
    expect(audit.diff).toMatchObject({ name: "Abgelaufen", status: "EXPIRED" });
    expect(audit.diff).not.toHaveProperty("revokedByDelete");
  });

  it("Rechte: fremde nur als Admin (sonst unsichtbar), nie über den KI-Kanal", async () => {
    const own = await newToken("viewer@example.test", "Fremd");
    await expectCode(deleteApiToken(await request("editor@example.test"), own.token.id), "NOT_FOUND");
    expect(await prisma.apiToken.findUnique({ where: { id: own.token.id } })).not.toBeNull();

    // Über den KI-Kanal: auch der eigene nicht.
    const mcp = await verifyApiToken(own.secret);
    if (!mcp.ok) throw new Error(mcp.reason);
    await expectCode(deleteApiToken(mcp.scope, own.token.id), "FORBIDDEN");

    // Jetzt benutzt → auch der Admin muss erst widerrufen.
    const admin = await request("admin@example.test");
    await expectCode(deleteApiToken(admin, own.token.id), "CONFLICT");
    await revokeApiToken(admin, own.token.id);
    await deleteApiToken(await request("admin@example.test"), own.token.id);
    expect((await listAllApiTokens(admin, { userId: "mock-user-viewer" })).map((t) => t.id)).not.toContain(own.token.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: own.token.id, action: "DELETE" } });
    expect(audit).toMatchObject({ userId: "mock-user-admin" });
    expect(audit.diff).toMatchObject({ ownerId: "mock-user-viewer", status: "REVOKED" });

    // Unbekannte Kennung.
    await expectCode(deleteApiToken(admin, "gibt-es-nicht"), "NOT_FOUND");
  });

  it("Änderungsgeschichte bleibt lesbar: Name aus dem Protokoll, Kennzeichen „gelöscht“", async () => {
    const [person] = persons;
    const created = await newToken("editor@example.test", "Laptop KI");
    // Schreibrecht für den Schlüssel: direkt auf WRITE setzen (Recht des Editors: WRITE).
    await prisma.apiToken.update({ where: { id: created.token.id }, data: { level: "WRITE" } });
    const auth = await verifyApiToken(created.secret);
    if (!auth.ok) throw new Error(auth.reason);
    const cs = await mcpChangeSet({ userId: auth.user.id, via: auth.scope.via }, undefined);
    if (!cs.ok) throw new Error(cs.message);
    await updatePerson({ ...auth.scope, changeSet: cs.handle }, person, { deathPlace: "Über KI" });
    // Ohne Paket: ältere Form, Einzeleintrag in der Übersicht.
    await updatePerson(auth.scope, person, { deathPlace: "Über KI 2" });

    const before = await listPersonChanges(await request("editor@example.test"), person, { limit: 5 });
    expect(before.items[0]).toMatchObject({ channel: "MCP", tokenName: "Laptop KI", tokenDeleted: false });

    const editor = await request("editor@example.test");
    await revokeApiToken(editor, created.token.id);
    // Widerrufen: Name bleibt, nicht gelöscht.
    const revoked = await listPersonChanges(await request("editor@example.test"), person, { limit: 5 });
    expect(revoked.items[0]).toMatchObject({ tokenName: "Laptop KI", tokenDeleted: false });

    await deleteApiToken(await request("editor@example.test"), created.token.id);
    const after = await listPersonChanges(await request("editor@example.test"), person, { limit: 5 });
    const mcpEntries = after.items.filter((i) => i.channel === "MCP");
    expect(mcpEntries).toHaveLength(2);
    for (const e of mcpEntries) expect(e).toMatchObject({ tokenName: "Laptop KI", tokenDeleted: true });
    expect(mcpEntries.map((e) => e.fields[0]?.to).sort()).toEqual(["Über KI", "Über KI 2"]);
    // Das Paket bleibt mit seinem Titel erhalten.
    expect(mcpEntries.find((e) => e.changeSet)?.changeSet?.title).toBe("KI-Änderungen über „Laptop KI“");

    const admin = await request("admin@example.test");
    const overview = await listChangeSets(admin, { channel: "MCP" }, { limit: 50 });
    expect(overview.items.find((i) => i.key === cs.handle.id)).toMatchObject({
      channel: "MCP",
      tokenName: "Laptop KI",
      tokenDeleted: true,
    });
    const single = await prisma.auditLog.findFirstOrThrow({ where: { apiTokenId: created.token.id, changeSetId: null } });
    expect(overview.items.find((i) => i.key === `e:${single.id}`)).toMatchObject({ tokenName: "Laptop KI", tokenDeleted: true });

    // Ohne jeden Protokolleintrag mit Namen: nur „gelöscht“.
    await prisma.auditLog.deleteMany({ where: { entityType: "ApiToken", entityId: created.token.id } });
    const bare = await listPersonChanges(await request("editor@example.test"), person, { limit: 5 });
    expect(bare.items.find((i) => i.channel === "MCP")).toMatchObject({ tokenName: null, tokenDeleted: true });
  });

  it("App-Einträge und vorhandene Schlüssel: tokenDeleted ist false", async () => {
    const [person] = persons;
    await updatePerson(await request("admin@example.test"), person, { birthPlace: "Musterort" });
    const page = await listPersonChanges(await request("editor@example.test"), person, { limit: 1 });
    expect(page.items[0]).toMatchObject({ channel: "APP", tokenName: null, tokenDeleted: false });
  });
});
