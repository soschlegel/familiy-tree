/**
 * KI-Zugang ohne Datenbank: Schlüsselformat und Hash (lib/ai-tokens.ts),
 * Stufenregel und Eingabeschemas, feste Mock-Schlüssel.
 */
import { describe, expect, it } from "vitest";

import { generateToken, hashToken, tokenMatches, tokenPrefixOf } from "@/lib/ai-tokens";
import { aiLevelSatisfies, effectiveAiLevel } from "@/lib/services/ai-access";
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
