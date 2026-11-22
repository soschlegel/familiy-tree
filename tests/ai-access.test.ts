/**
 * KI-Zugang ohne Datenbank: Schlüsselformat und Hash (lib/ai-tokens.ts),
 * Stufenregel und Eingabeschemas, feste Mock-Schlüssel, Lösch- und
 * Verlaufsregel der Oberfläche (gleich der des Dienstes).
 */
import { describe, expect, it } from "vitest";

import { generateToken, hashToken, tokenMatches, tokenPrefixOf } from "@/lib/ai-tokens";
import { aiLevelSatisfies, apiTokenDeletable, effectiveAiLevel } from "@/lib/services/ai-access";
import { canDeleteToken, deleteTokenQuestion, isHistoryToken, type TokenRow } from "@/components/ai-access-labels";
import { aiAccessInput, apiTokenCreateInput, API_TOKEN_MAX_DAYS } from "@/lib/validation";
import { MOCK_API_TOKEN_KEYS } from "@/prisma/mock-data";
import { mockData } from "./helpers";

describe("Schlüsselformat und Hash", () => {
  it("erzeugt ftk_-Schlüssel mit öffentlichem Präfix und SHA-256-Hash", () => {
    const t = generateToken();
    expect(t.secret).toMatch(/^ftk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(t.prefix).toBe(t.secret.slice(0, 16));
    expect(t.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.secretHash).toBe(hashToken(t.secret));
    expect(t.secretHash).not.toContain(t.secret.slice(17));
  });

  it("jeder Schlüssel ist neu", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateToken().secret));
    expect(secrets.size).toBe(50);
  });

  it("erkennt das Präfix nur bei gültigem Format", () => {
    const t = generateToken();
    expect(tokenPrefixOf(t.secret)).toBe(t.prefix);
    expect(tokenPrefixOf(` ${t.secret} `)).toBe(t.prefix);
    expect(tokenPrefixOf("ftk_123")).toBeNull();
    expect(tokenPrefixOf(t.secret + "x")).toBeNull();
    expect(tokenPrefixOf("Bearer " + t.secret)).toBeNull();
    expect(tokenPrefixOf("")).toBeNull();
  });

  it("vergleicht den Hash, nicht das Geheimnis", () => {
    const t = generateToken();
    expect(tokenMatches(t.secret, t.secretHash)).toBe(true);
    expect(tokenMatches(generateToken().secret, t.secretHash)).toBe(false);
    expect(tokenMatches(t.secret, "kaputt")).toBe(false);
  });
});

describe("wirksame Stufe", () => {
  it("ist das Minimum aus Schlüssel und Benutzerrecht", () => {
    expect(effectiveAiLevel("WRITE", "WRITE")).toBe("WRITE");
    expect(effectiveAiLevel("WRITE", "READ")).toBe("READ");
    expect(effectiveAiLevel("READ", "WRITE")).toBe("READ");
    expect(effectiveAiLevel("READ", "NONE")).toBeNull();
    expect(effectiveAiLevel("WRITE", "NONE")).toBeNull();
  });

  it("WRITE schließt READ ein, nicht umgekehrt", () => {
    expect(aiLevelSatisfies("WRITE", "READ")).toBe(true);
    expect(aiLevelSatisfies("WRITE", "WRITE")).toBe(true);
    expect(aiLevelSatisfies("READ", "READ")).toBe(true);
    expect(aiLevelSatisfies("READ", "WRITE")).toBe(false);
  });
});

describe("Eingabeschemas", () => {
  it("aiAccessInput", () => {
    expect(aiAccessInput.safeParse({ aiAccess: "READ" }).success).toBe(true);
    expect(aiAccessInput.safeParse({ aiAccess: "ADMIN" }).success).toBe(false);
    expect(aiAccessInput.safeParse({}).success).toBe(false);
  });

  it("apiTokenCreateInput", () => {
    expect(apiTokenCreateInput.parse({ name: "  Laptop ", level: "READ" })).toEqual({ name: "Laptop", level: "READ" });
    expect(apiTokenCreateInput.safeParse({ name: "x", level: "NONE" }).success).toBe(false);
    expect(apiTokenCreateInput.safeParse({ name: " ", level: "READ" }).success).toBe(false);
    expect(apiTokenCreateInput.safeParse({ name: "x", level: "READ", expiresInDays: API_TOKEN_MAX_DAYS }).success).toBe(true);
    expect(apiTokenCreateInput.safeParse({ name: "x", level: "READ", expiresInDays: API_TOKEN_MAX_DAYS + 1 }).success).toBe(false);
    expect(apiTokenCreateInput.safeParse({ name: "x", level: "READ", expiresInDays: 1.5 }).success).toBe(false);
  });
});

describe("feste Mock-Schlüssel", () => {
  it("decken alle Fälle ab und haben gültiges Format", () => {
    const tokens = mockData().apiTokens;
    expect(tokens.map((t) => t.id.replace("mock-token-", ""))).toEqual([...MOCK_API_TOKEN_KEYS]);
    for (const t of tokens) {
      expect(tokenPrefixOf(t.secret)).toBe(t.prefix);
      expect(t.secret).toContain("nur-fuer-tests");
    }
    expect(new Set(tokens.map((t) => t.prefix)).size).toBe(tokens.length);
  });

  it("Mock-Benutzer haben alle KI-Stufen", () => {
    const access = Object.fromEntries(mockData().users.map((u) => [u.email, u.aiAccess]));
    expect(access).toEqual({
      "admin@example.test": "WRITE",
      "editor@example.test": "WRITE",
      "viewer@example.test": "READ",
      "nofamily@example.test": "NONE",
      "blocked@example.test": "READ",
    });
  });
});

describe("Löschen und Verlauf in der Oberfläche", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const used = "2026-05-01T00:00:00.000Z";
  const later = "2026-07-01T00:00:00.000Z";
  const row = (status: TokenRow["status"], lastUsedAt: string | null): TokenRow => ({
    id: "t",
    name: "Laptop",
    prefix: "ftk_000000000001",
    level: "READ",
    status,
    createdAt: used,
    lastUsedAt,
    expiresAt: status === "EXPIRED" ? used : later,
    revokedAt: status === "REVOKED" ? used : null,
  });

  it("canDeleteToken entspricht apiTokenDeletable", () => {
    for (const status of ["ACTIVE", "REVOKED", "EXPIRED"] as const) {
      for (const last of [null, used]) {
        const t = row(status, last);
        const server = apiTokenDeletable(
          {
            revokedAt: t.revokedAt ? new Date(t.revokedAt) : null,
            expiresAt: t.expiresAt ? new Date(t.expiresAt) : null,
            lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt) : null,
          },
          now,
        );
        expect(canDeleteToken(t), `${status}/${last}`).toBe(server);
      }
    }
    expect(canDeleteToken(row("ACTIVE", used))).toBe(false);
  });

  it("Verlauf = widerrufen oder abgelaufen", () => {
    expect(isHistoryToken(row("ACTIVE", null))).toBe(false);
    expect(isHistoryToken(row("REVOKED", used))).toBe(true);
    expect(isHistoryToken(row("EXPIRED", null))).toBe(true);
  });

  it("Rückfrage nennt Folgen und Besitzer", () => {
    expect(deleteTokenQuestion(row("ACTIVE", null))).toContain("noch nie benutzt und funktioniert danach sofort nicht mehr");
    const q = deleteTokenQuestion(row("REVOKED", used), "editor@example.test");
    expect(q).toMatch(/^Schlüssel „Laptop“ \(ftk_000000000001…\) von editor@example\.test endgültig löschen\?/);
    expect(q).toContain("nicht rückgängig");
  });
});
