/**
 * Anfragebegrenzung (lib/rate-limit.ts): festes Zeitfenster je Schlüssel,
 * Zuordnung der Web-API-Pfade zu Regeln, Drosselung des KI-Zugangs je
 * Schlüssel, Abschalten über RATE_LIMIT=off.
 */
import { afterEach, describe, expect, it } from "vitest";

import { API_RULES, apiBucket, checkApiRate, checkMcpRate, MCP_RULE, RateLimiter, resetApiRateLimit } from "@/lib/rate-limit";

const previous = process.env.RATE_LIMIT;
afterEach(() => {
  resetApiRateLimit();
  if (previous === undefined) delete process.env.RATE_LIMIT;
  else process.env.RATE_LIMIT = previous;
});

describe("RateLimiter", () => {
  it("erlaubt bis zur Grenze, dann 429-Ergebnis mit Wartezeit; neues Fenster beginnt frisch", () => {
    const l = new RateLimiter();
    const rule = { limit: 3, windowMs: 10_000 };
    for (let i = 0; i < 3; i++) expect(l.hit("k", rule, 1000)).toEqual({ ok: true });
    expect(l.hit("k", rule, 4000)).toEqual({ ok: false, retryAfter: 7 });
    expect(l.hit("anderer", rule, 4000)).toEqual({ ok: true });
    expect(l.hit("k", rule, 11_000)).toEqual({ ok: true });
  });
});

describe("apiBucket", () => {
  it("ordnet Pfade den Regeln zu", () => {
    expect(apiBucket("GET", "/api/export")).toBe("export");
    expect(apiBucket("POST", "/api/media")).toBe("upload");
    expect(apiBucket("GET", "/api/media")).toBe("read");
    expect(apiBucket("POST", "/api/import/gedcom")).toBe("upload");
    expect(apiBucket("GET", "/api/tree")).toBe("heavy");
    expect(apiBucket("GET", "/api/duplicates")).toBe("heavy");
    expect(apiBucket("POST", "/api/duplicates/dismiss")).toBe("write");
    expect(apiBucket("GET", "/api/persons/abc/duplicates")).toBe("heavy");
    expect(apiBucket("GET", "/api/persons/merge/followups")).toBe("heavy");
    expect(apiBucket("GET", "/api/origin/overview")).toBe("heavy");
    expect(apiBucket("GET", "/api/persons/abc")).toBe("read");
    expect(apiBucket("PATCH", "/api/persons/abc")).toBe("write");
    // Kein Präfix-Fehlgriff: /api/treeX ist nicht /api/tree.
    expect(apiBucket("GET", "/api/treeX")).toBe("read");
  });
});

describe("checkApiRate / checkMcpRate", () => {
  it("drosselt je Benutzer und Regel", () => {
    const now = 5_000_000;
    for (let i = 0; i < API_RULES.export.limit; i++) expect(checkApiRate("u1", "GET", "/api/export", now).ok).toBe(true);
    expect(checkApiRate("u1", "GET", "/api/export", now).ok).toBe(false);
    // Anderer Benutzer und andere Regel bleiben frei.
    expect(checkApiRate("u2", "GET", "/api/export", now).ok).toBe(true);
    expect(checkApiRate("u1", "GET", "/api/persons", now).ok).toBe(true);
  });

  it("KI-Zugang je Schlüssel", () => {
    const now = 7_000_000;
    for (let i = 0; i < MCP_RULE.limit; i++) expect(checkMcpRate("key-a", now).ok).toBe(true);
    expect(checkMcpRate("key-a", now)).toMatchObject({ ok: false });
    expect(checkMcpRate("key-b", now).ok).toBe(true);
  });

  it("RATE_LIMIT=off schaltet ab", () => {
    process.env.RATE_LIMIT = "off";
    for (let i = 0; i < API_RULES.export.limit + 5; i++) expect(checkApiRate("u3", "GET", "/api/export").ok).toBe(true);
    for (let i = 0; i < MCP_RULE.limit + 5; i++) expect(checkMcpRate("key-c").ok).toBe(true);
  });
});
