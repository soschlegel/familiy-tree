/**
 * Prüfungen vor jedem Route-Handler (lib/request-guard.ts): Herkunft
 * schreibender Anfragen (CSRF) und Größe des Anfragekörpers.
 */
import { describe, expect, it } from "vitest";

import { bodyLimitFor, bodyTooLarge, isCrossSiteWrite, MAX_IMPORT_BODY_BYTES, MAX_JSON_BODY_BYTES } from "@/lib/request-guard";

const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers) });
const AUTH = "https://stammbaum.example";

describe("isCrossSiteWrite", () => {
  it("lesende Methoden werden nie geprüft", () => {
    expect(isCrossSiteWrite(req("GET", { "sec-fetch-site": "cross-site", origin: "https://boese.example" }), AUTH)).toBe(false);
    expect(isCrossSiteWrite(req("HEAD", { origin: "https://boese.example" }), AUTH)).toBe(false);
  });

  it("Sec-Fetch-Site: cross-site wird abgelehnt", () => {
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site", host: "stammbaum.example" }), AUTH)).toBe(true);
  });

  it("fremder Origin wird abgelehnt, auch bei gleichem Pfad", () => {
    expect(isCrossSiteWrite(req("DELETE", { origin: "https://boese.example", host: "stammbaum.example" }), AUTH)).toBe(true);
    expect(isCrossSiteWrite(req("PATCH", { origin: "https://stammbaum.example.boese.example", host: "stammbaum.example" }), AUTH)).toBe(true);
  });

  it("Origin „null“ oder Unsinn wird abgelehnt", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "null", host: "stammbaum.example" }), AUTH)).toBe(true);
  });

  it("eigener Origin: über Host, X-Forwarded-Host (Liste) oder AUTH_URL — Schema egal (TLS am Proxy)", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "http://localhost:3105", host: "localhost:3105" }), undefined)).toBe(false);
    expect(
      isCrossSiteWrite(req("POST", { origin: "https://stammbaum.example", host: "app:3000", "x-forwarded-host": "stammbaum.example, intern" }), undefined),
    ).toBe(false);
    expect(isCrossSiteWrite(req("POST", { origin: "https://stammbaum.example", host: "app:3000" }), AUTH)).toBe(false);
    expect(isCrossSiteWrite(req("POST", { origin: "https://stammbaum.example", host: "app:3000" }), undefined)).toBe(true);
  });

  it("ohne Origin und Sec-Fetch-Site (kein Browser) erlaubt", () => {
    expect(isCrossSiteWrite(req("POST", { host: "stammbaum.example" }), AUTH)).toBe(false);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin", host: "stammbaum.example" }), AUTH)).toBe(false);
  });
});

describe("Kopfzeilen für alle Antworten (next.config.mjs)", () => {
  it("nicht einbettbar, kein Referrer nach außen, nosniff, ohne X-Powered-By", async () => {
    const path = "../next.config.mjs";
    const { default: cfg } = (await import(/* @vite-ignore */ path)) as {
      default: { poweredByHeader?: boolean; headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    };
    expect(cfg.poweredByHeader).toBe(false);
    const all = (await cfg.headers()).find((h) => h.source === "/:path*");
    const map = Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
    expect(map).toMatchObject({ "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff" });
  });
});

describe("bodyTooLarge", () => {
  it("Grenzen je Pfad", () => {
    expect(bodyLimitFor("/api/persons")).toBe(MAX_JSON_BODY_BYTES);
    expect(bodyLimitFor("/api/import/gedcom")).toBe(MAX_IMPORT_BODY_BYTES);
    expect(bodyLimitFor("/api/media")).toBeGreaterThan(MAX_JSON_BODY_BYTES);
  });

  it("zu großer JSON-Körper wird vor dem Lesen abgelehnt", () => {
    expect(bodyTooLarge(req("POST", { "content-length": String(MAX_JSON_BODY_BYTES + 1) }), "/api/persons")).toBe("too-large");
    expect(bodyTooLarge(req("POST", { "content-length": String(MAX_JSON_BODY_BYTES) }), "/api/persons")).toBeNull();
    // Derselbe Umfang ist beim Import erlaubt.
    expect(bodyTooLarge(req("POST", { "content-length": String(MAX_JSON_BODY_BYTES + 1) }), "/api/import")).toBeNull();
  });

  it("ohne Längenangabe (chunked) oder mit Unsinn: Länge verlangt", () => {
    expect(bodyTooLarge(req("POST", { "transfer-encoding": "chunked" }), "/api/persons")).toBe("length-required");
    expect(bodyTooLarge(req("PATCH", { "content-length": "viel" }), "/api/persons")).toBe("length-required");
    expect(bodyTooLarge(req("DELETE", {}), "/api/persons")).toBeNull();
    expect(bodyTooLarge(req("GET", { "transfer-encoding": "chunked" }), "/api/persons")).toBeNull();
  });
});
