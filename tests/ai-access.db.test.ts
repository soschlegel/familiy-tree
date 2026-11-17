/**
 * KI-Zugang (lib/services/ai-access.ts) gegen die Mock-Datenbank: Rechte,
 * Schlüssel, Prüfung pro Aufruf und Audit über den KI-Kanal.
 *
 * Nutzt die festen Testschlüssel aus prisma/mock-data.ts. Schreibende Tests
 * legen eigene Schlüssel/Personen an und räumen sie samt Audit-Einträgen
 * wieder ab; geänderte KI-Rechte der Mock-Benutzer werden zurückgesetzt.
 * Überspringt sich ohne Mock-Datenbank.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { hashToken } from "@/lib/ai-tokens";
import {
  API_TOKEN_TOUCH_INTERVAL_MS,
  authorizeAiCall,
  createApiToken,
  createPerson,
  getAiAccessInfo,
  listAllApiTokens,
  listApiTokens,
  revokeApiToken,
  scopeForEmail,
  ServiceError,
  setUserAiAccess,
  updatePerson,
  verifyApiToken,
  type AiAuthSuccess,
} from "@/lib/services";
import { API_TOKEN_DEFAULT_DAYS, MAX_ACTIVE_API_TOKENS } from "@/lib/validation";
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
if (skipReason) console.warn(`\n[tests] KI-Zugang-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const tokenByKey = new Map(data.apiTokens.map((t) => [t.id.replace(/^mock-token-/, "") as MockApiTokenKey, t]));
const secretOf = (key: MockApiTokenKey) => tokenByKey.get(key)!.secret;
const tokenIdOf = (key: MockApiTokenKey) => tokenByKey.get(key)!.id;
const familyA = data.families.find((f) => f.key === "A")!.id;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof ServiceError && err.code === code);
}

async function verifyOk(key: MockApiTokenKey): Promise<AiAuthSuccess> {
  const r = await verifyApiToken(secretOf(key));
  if (!r.ok) throw new Error(`${key}: ${r.reason}`);
  return r;
}

const STARTED = new Date();
const createdTokens: string[] = [];
const createdPersons: string[] = [];
const ORIGINAL_ACCESS = new Map(data.users.map((u) => [u.id, u.aiAccess]));

async function restoreAccess() {
  for (const [id, aiAccess] of ORIGINAL_ACCESS) {
    await prisma.user.update({ where: { id }, data: { aiAccess } });
  }
}

describe.skipIf(Boolean(skipReason))("KI-Zugang (Mock-Datenbank)", () => {
  afterEach(restoreAccess);

  afterAll(async () => {
    if (skipReason) return;
    await restoreAccess();
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
    await prisma.apiToken.deleteMany({ where: { id: { in: createdTokens } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: [...createdTokens, ...createdPersons] } },
          // Rechteänderungen an den Mock-Benutzern während dieses Laufs.
          { entityType: "User", entityId: { in: [...ORIGINAL_ACCESS.keys()] }, createdAt: { gte: STARTED } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  describe("verifyApiToken mit den festen Testschlüsseln", () => {
    it("liefert Benutzer, Scope mit KI-Kanal und wirksame Stufe", async () => {
      const admin = await verifyOk("admin-write");
      expect(admin.level).toBe("WRITE");
      expect(admin.keyId).toBe(tokenIdOf("admin-write"));
      expect(admin.user).toMatchObject({ id: "mock-user-admin", role: "ADMIN", aiAccess: "WRITE" });
      expect(admin.scope.isAdmin).toBe(true);
      expect(admin.scope.via).toEqual({ channel: "MCP", tokenId: tokenIdOf("admin-write"), level: "WRITE" });

      const editor = await verifyOk("editor-write");
      expect(editor.level).toBe("WRITE");
      expect(editor.scope.families.get(familyA)).toBe("EDITOR");

      expect((await verifyOk("editor-read")).level).toBe("READ");
      expect((await verifyOk("viewer-read")).level).toBe("READ");
    });

    it("deckelt die Stufe des Schlüssels auf das Benutzerrecht", async () => {
      // Schlüssel WRITE, Benutzer nur READ.
      const r = await verifyOk("viewer-write");
      expect(r.level).toBe("READ");
      expect(r.scope.via.level).toBe("READ");
      const w = await authorizeAiCall({ kind: "token", secret: secretOf("viewer-write") }, "WRITE");
      expect(w).toMatchObject({ ok: false, reason: "INSUFFICIENT_LEVEL" });
    });

    it("lehnt widerrufene, abgelaufene, unbekannte und fehlerhafte Schlüssel ab", async () => {
      expect(await verifyApiToken(secretOf("editor-revoked"))).toMatchObject({ ok: false, reason: "REVOKED" });
      expect(await verifyApiToken(secretOf("editor-expired"))).toMatchObject({ ok: false, reason: "EXPIRED" });
      expect(await verifyApiToken("kein-schluessel")).toMatchObject({ ok: false, reason: "MALFORMED" });
      expect(await verifyApiToken("")).toMatchObject({ ok: false, reason: "MALFORMED" });
      // Unbekanntes Präfix.
      expect(await verifyApiToken(`ftk_ffffffffffff_${"A".repeat(43)}`)).toMatchObject({ ok: false, reason: "UNKNOWN" });
      // Bekanntes Präfix, falsches Geheimnis — nicht von „unbekannt" unterscheidbar.
      const wrong = `${tokenByKey.get("admin-write")!.prefix}_${"B".repeat(43)}`;
      expect(await verifyApiToken(wrong)).toMatchObject({ ok: false, reason: "UNKNOWN" });
    });

    it("gesperrter Benutzer schlägt jedes Recht, ohne KI-Recht kein Zugang", async () => {
      expect(await verifyApiToken(secretOf("blocked-read"))).toMatchObject({ ok: false, reason: "USER_BLOCKED" });
      expect(await verifyApiToken(secretOf("nofamily-read"))).toMatchObject({ ok: false, reason: "NO_PERMISSION" });
    });

    it("aktualisiert lastUsedAt höchstens alle paar Minuten", async () => {
      const id = tokenIdOf("editor-read");
      await prisma.apiToken.update({ where: { id }, data: { lastUsedAt: null } });
      await verifyOk("editor-read");
      const first = (await prisma.apiToken.findUnique({ where: { id } }))!.lastUsedAt;
      expect(first).toBeInstanceOf(Date);

      await verifyOk("editor-read");
      expect((await prisma.apiToken.findUnique({ where: { id } }))!.lastUsedAt).toEqual(first);

      const old = new Date(Date.now() - API_TOKEN_TOUCH_INTERVAL_MS - 1000);
      await prisma.apiToken.update({ where: { id }, data: { lastUsedAt: old } });
      await verifyOk("editor-read");
      const after = (await prisma.apiToken.findUnique({ where: { id } }))!.lastUsedAt!;
      expect(after.getTime()).toBeGreaterThan(old.getTime());
    });
  });

  describe("Rechteänderungen wirken sofort", () => {
    it("Recht herabgesetzt → vorhandener Schreibschlüssel nur noch lesend; entzogen → abgelehnt", async () => {
      const admin = await scope("admin@example.test");
      const cred = { kind: "token", secret: secretOf("editor-write") } as const;
      expect(await authorizeAiCall(cred, "WRITE")).toMatchObject({ ok: true, level: "WRITE" });

      expect(await setUserAiAccess(admin, "mock-user-editor", { aiAccess: "READ" })).toEqual({
        id: "mock-user-editor",
        aiAccess: "READ",
      });
      expect(await authorizeAiCall(cred, "READ")).toMatchObject({ ok: true, level: "READ" });
      expect(await authorizeAiCall(cred, "WRITE")).toMatchObject({ ok: false, reason: "INSUFFICIENT_LEVEL" });
      // Der Schlüssel selbst bleibt unverändert.
      expect((await prisma.apiToken.findUnique({ where: { id: tokenIdOf("editor-write") } }))!.level).toBe("WRITE");

      await setUserAiAccess(admin, "mock-user-editor", { aiAccess: "NONE" });
      expect(await authorizeAiCall(cred, "READ")).toMatchObject({ ok: false, reason: "NO_PERMISSION" });

      const audits = await prisma.auditLog.findMany({
        where: { entityType: "User", entityId: "mock-user-editor", userId: "mock-user-admin" },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((a) => a.diff)).toEqual(
        expect.arrayContaining([
          { aiAccess: { from: "WRITE", to: "READ" } },
          { aiAccess: { from: "READ", to: "NONE" } },
        ]),
      );
      expect(audits.every((a) => a.channel === null && a.apiTokenId === null)).toBe(true);
    });

    it("die Rolle ADMIN schließt den KI-Zugang nicht ein", async () => {
      const admin = await scope("admin@example.test");
      await setUserAiAccess(admin, "mock-user-admin", { aiAccess: "NONE" });
      expect(await verifyApiToken(secretOf("admin-write"))).toMatchObject({ ok: false, reason: "NO_PERMISSION" });
      await expectServiceError(createApiToken(admin, { name: "x", level: "READ" }), "FORBIDDEN");
      expect((await getAiAccessInfo(admin)).aiAccess).toBe("NONE");
    });

    it("nur Admins setzen KI-Rechte, und nie über den KI-Kanal", async () => {
      const editor = await scope("editor@example.test");
      await expectServiceError(setUserAiAccess(editor, "mock-user-editor", { aiAccess: "WRITE" }), "FORBIDDEN");
      const viaMcp = (await verifyOk("admin-write")).scope;
      await expectServiceError(setUserAiAccess(viaMcp, "mock-user-viewer", { aiAccess: "WRITE" }), "FORBIDDEN");
      const admin = await scope("admin@example.test");
      await expectServiceError(setUserAiAccess(admin, "mock-user-viewer", { aiAccess: "ALL" }), "VALIDATION");
      await expectServiceError(setUserAiAccess(admin, "gibt-es-nicht", { aiAccess: "READ" }), "NOT_FOUND");
    });
  });

  describe("Schlüssel anlegen, auflisten, widerrufen", () => {
    it("gibt das Geheimnis genau einmal zurück und speichert nur den Hash", async () => {
      const editor = await scope("editor@example.test");
      const created = await createApiToken(editor, { name: "Claude Desktop", level: "WRITE" });
      createdTokens.push(created.token.id);

      expect(created.secret).toMatch(/^ftk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
      expect(created.secret.startsWith(created.token.prefix + "_")).toBe(true);
      expect(created.token).toMatchObject({ name: "Claude Desktop", level: "WRITE", kind: "PERSONAL", status: "ACTIVE" });
      expect(JSON.stringify(created.token)).not.toContain(created.secret.slice(17));

      // Standardablauf.
      const days = (Date.parse(created.token.expiresAt!) - Date.parse(created.token.createdAt)) / 86_400_000;
      expect(Math.round(days)).toBe(API_TOKEN_DEFAULT_DAYS);

      // In der Datenbank steht kein Teil des Geheimnisses außer dem Präfix.
      const row = await prisma.apiToken.findUnique({ where: { id: created.token.id } });
      expect(row!.secretHash).toBe(hashToken(created.secret));
      expect(JSON.stringify(row)).not.toContain(created.secret.slice(17));

      // Listen enthalten weder Geheimnis noch Hash.
      const list = await listApiTokens(editor);
      const listed = list.find((t) => t.id === created.token.id)!;
      expect(listed).toBeDefined();
      expect(Object.keys(listed)).not.toContain("secretHash");
      expect(Object.keys(listed)).not.toContain("secret");
      expect(JSON.stringify(list)).not.toContain(created.secret.slice(17));
      expect(list.every((t) => t.userId === "mock-user-editor")).toBe(true);
      expect(list.find((t) => t.id === tokenIdOf("editor-revoked"))!.status).toBe("REVOKED");
      expect(list.find((t) => t.id === tokenIdOf("editor-expired"))!.status).toBe("EXPIRED");

      // Der neue Schlüssel funktioniert sofort.
      expect(await verifyApiToken(created.secret)).toMatchObject({ ok: true, level: "WRITE", keyId: created.token.id });

      // Audit: CREATE ohne Geheimnis.
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "ApiToken", entityId: created.token.id } });
      expect(audit).toMatchObject({ action: "CREATE", userId: "mock-user-editor" });
      expect(JSON.stringify(audit!.diff)).not.toContain(created.secret.slice(17));
    });

    it("Stufe höchstens das eigene Recht; ohne Recht kein Schlüssel", async () => {
      const viewer = await scope("viewer@example.test");
      await expectServiceError(createApiToken(viewer, { name: "zu viel", level: "WRITE" }), "FORBIDDEN");
      const nofamily = await scope("nofamily@example.test");
      await expectServiceError(createApiToken(nofamily, { name: "nichts", level: "READ" }), "FORBIDDEN");

      const ok = await createApiToken(viewer, { name: "lesen", level: "READ", expiresInDays: 7 });
      createdTokens.push(ok.token.id);
      const days = (Date.parse(ok.token.expiresAt!) - Date.parse(ok.token.createdAt)) / 86_400_000;
      expect(Math.round(days)).toBe(7);
    });

    it("prüft Eingaben und die Höchstzahl aktiver Schlüssel", async () => {
      const editor = await scope("editor@example.test");
      await expectServiceError(createApiToken(editor, { name: "", level: "READ" }), "VALIDATION");
      await expectServiceError(createApiToken(editor, { name: "x", level: "ADMIN" }), "VALIDATION");
      await expectServiceError(createApiToken(editor, { name: "x", level: "READ", expiresInDays: 400 }), "VALIDATION");
      await expectServiceError(createApiToken(editor, { name: "x", level: "READ", expiresInDays: 0 }), "VALIDATION");

      const info = await getAiAccessInfo(editor);
      expect(info.maxActiveTokens).toBe(MAX_ACTIVE_API_TOKENS);
      for (let i = info.activeTokens; i < MAX_ACTIVE_API_TOKENS; i++) {
        createdTokens.push((await createApiToken(editor, { name: `Füllung ${i}`, level: "READ" })).token.id);
      }
      expect((await getAiAccessInfo(editor)).activeTokens).toBe(MAX_ACTIVE_API_TOKENS);
      await expectServiceError(createApiToken(editor, { name: "zu viele", level: "READ" }), "CONFLICT");

      // Widerrufen gibt einen Platz frei.
      await revokeApiToken(editor, createdTokens[createdTokens.length - 1]);
      createdTokens.push((await createApiToken(editor, { name: "wieder Platz", level: "READ" })).token.id);
    });

    it("widerrufen: eigene ja, fremde nur als Admin; danach sofort abgelehnt", async () => {
      const editor = await scope("editor@example.test");
      const viewer = await scope("viewer@example.test");
      const admin = await scope("admin@example.test");

      const own = await createApiToken(viewer, { name: "eigener", level: "READ" });
      createdTokens.push(own.token.id);
      await expectServiceError(revokeApiToken(editor, own.token.id), "NOT_FOUND");
      expect(await verifyApiToken(own.secret)).toMatchObject({ ok: true });

      const revoked = await revokeApiToken(viewer, own.token.id);
      expect(revoked.status).toBe("REVOKED");
      expect(await verifyApiToken(own.secret)).toMatchObject({ ok: false, reason: "REVOKED" });
      // Wiederholt: unschädlich, kein zweiter Audit-Eintrag.
      await revokeApiToken(viewer, own.token.id);

      const other = await createApiToken(viewer, { name: "vom Admin widerrufen", level: "READ" });
      createdTokens.push(other.token.id);
      expect((await revokeApiToken(admin, other.token.id)).status).toBe("REVOKED");
      expect(await verifyApiToken(other.secret)).toMatchObject({ ok: false, reason: "REVOKED" });

      const audits = await prisma.auditLog.findMany({
        where: { entityType: "ApiToken", entityId: { in: [own.token.id, other.token.id] }, action: "UPDATE" },
      });
      expect(audits).toHaveLength(2);
      expect(audits.find((a) => a.entityId === other.token.id)).toMatchObject({
        userId: "mock-user-admin",
        diff: expect.objectContaining({ revoked: true, ownerId: "mock-user-viewer" }),
      });
    });

    it("über den KI-Kanal lassen sich keine Schlüssel verwalten", async () => {
      const viaMcp = (await verifyOk("editor-write")).scope;
      await expectServiceError(createApiToken(viaMcp, { name: "selbst", level: "READ" }), "FORBIDDEN");
      await expectServiceError(revokeApiToken(viaMcp, tokenIdOf("editor-read")), "FORBIDDEN");
      await expectServiceError(listAllApiTokens(viaMcp), "FORBIDDEN");
    });

    it("Admin-Übersicht: alle Schlüssel samt Besitzer, nur für Admins", async () => {
      await expectServiceError(listAllApiTokens(await scope("editor@example.test")), "FORBIDDEN");
      const admin = await scope("admin@example.test");
      const all = await listAllApiTokens(admin);
      for (const t of data.apiTokens) expect(all.map((a) => a.id)).toContain(t.id);
      expect(JSON.stringify(all)).not.toMatch(/secretHash|nur-fuer-tests/);
      const viewerOnly = await listAllApiTokens(admin, { userId: "mock-user-viewer" });
      expect(viewerOnly.length).toBeGreaterThan(0);
      expect(viewerOnly.every((t) => t.user.email === "viewer@example.test")).toBe(true);
    });
  });

  describe("Mutationen über den KI-Kanal", () => {
    it("Audit-Einträge tragen Kanal und Schlüssel-ID", async () => {
      const { scope: s } = await verifyOk("editor-write");
      const person = await createPerson(s, { givenName: "KI-Testperson", familyIds: [familyA] });
      createdPersons.push(person.id);
      await updatePerson(s, person.id, { notes: "über MCP geändert" });

      const rows = await prisma.auditLog.findMany({ where: { entityType: "Person", entityId: person.id } });
      expect(rows.map((r) => r.action).sort()).toEqual(["CREATE", "UPDATE"]);
      for (const r of rows) {
        expect(r).toMatchObject({ userId: "mock-user-editor", channel: "MCP", apiTokenId: tokenIdOf("editor-write") });
      }

      // Web-Kanal: ohne Kanal und Schlüssel.
      await updatePerson(await scope("editor@example.test"), person.id, { notes: "über die Web-App" });
      const web = await prisma.auditLog.findFirst({
        where: { entityType: "Person", entityId: person.id },
        orderBy: { createdAt: "desc" },
      });
      expect(web).toMatchObject({ channel: null, apiTokenId: null });
    });

    it("Familienrechte begrenzen auch einen Schreibschlüssel", async () => {
      // Editor: Familie A bearbeiten, Familie B nur ansehen.
      const { scope: s, level } = await verifyOk("editor-write");
      expect(level).toBe("WRITE");
      await expectServiceError(updatePerson(s, L.inLawOnlyB, { notes: "darf nicht" }), "FORBIDDEN");
      // Personen ohne Familie sind für Nicht-Admins unsichtbar.
      await expectServiceError(updatePerson(s, L.noFamily[0], { notes: "darf nicht" }), "NOT_FOUND");
    });
  });
});
