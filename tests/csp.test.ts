/**
 * Content-Security-Policy (lib/csp.ts, middleware.ts, next.config.mjs):
 * Richtlinie je Direktive, Ziele der OAuth-Anmeldung, Not-Schalter CSP_MODE.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  API_POLICY,
  createNonce,
  cspHeaderName,
  cspMode,
  isHttpsUrl,
  OAUTH_FORM_TARGETS,
  pagePolicy,
} from "@/lib/csp";
import { config as middlewareConfig, middleware } from "@/middleware";

/** Richtlinie in { direktive: [werte] } zerlegen. */
function parse(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    expect(out[name], `Direktive ${name} doppelt`).toBeUndefined();
    out[name] = values;
  }
  return out;
}

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

describe("pagePolicy (Produktion)", () => {
  const p = parse(pagePolicy({ nonce: NONCE, https: true }));

  it("Skripte nur mit Nonce, ohne unsafe-inline und unsafe-eval", () => {
    expect(p["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(p["script-src"].join(" ")).not.toMatch(/unsafe/);
  });

  it("Stile ohne Nonce (sonst wäre 'unsafe-inline' für style-Attribute wirkungslos)", () => {
    expect(p["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("alles andere nur von der eigenen Adresse, Einbetten und Plugins aus", () => {
    expect(p["default-src"]).toEqual(["'self'"]);
    expect(p["img-src"]).toEqual(["'self'"]);
    expect(p["font-src"]).toEqual(["'self'"]);
    expect(p["connect-src"]).toEqual(["'self'"]);
    expect(p["object-src"]).toEqual(["'none'"]);
    expect(p["frame-src"]).toEqual(["'none'"]);
    expect(p["worker-src"]).toEqual(["'none'"]);
    expect(p["base-uri"]).toEqual(["'none'"]);
    expect(p["frame-ancestors"]).toEqual(["'none'"]);
    expect(p["upgrade-insecure-requests"]).toEqual([]);
  });

  it("Anmeldung: Formulare dürfen zur App, zu GitHub und zu Google", () => {
    // Die Anmelde-Knöpfe (app/login/page.tsx) sind Formulare; ohne
    // JavaScript (oder vor der Hydration) leitet der Formular-POST mit 303
    // zum Anbieter weiter, und Chromium prüft auch Weiterleitungsziele gegen
    // form-action. Ziele laut @auth/core: github.com/login/oauth/authorize,
    // accounts.google.com/o/oauth2/v2/auth.
    expect(p["form-action"]).toEqual(["'self'", "https://github.com", "https://accounts.google.com"]);
    const allowed = (url: string) => {
      const u = new URL(url);
      return p["form-action"].some((v) => v !== "'self'" && new URL(v).origin === u.origin);
    };
    expect(allowed("https://github.com/login/oauth/authorize?client_id=x")).toBe(true);
    expect(allowed("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")).toBe(true);
    expect(allowed("https://boese.example/")).toBe(false);
    expect(OAUTH_FORM_TARGETS).toEqual(["https://github.com", "https://accounts.google.com"]);
  });

  it("die OAuth-Ziele entsprechen den Anbietern von Auth.js", async () => {
    const GitHub = (await import("next-auth/providers/github")).default;
    const Google = (await import("next-auth/providers/google")).default;
    const gh = GitHub({ clientId: "x", clientSecret: "y" }) as { authorization?: { url?: string } | string };
    const ghUrl = typeof gh.authorization === "string" ? gh.authorization : gh.authorization?.url;
    expect(new URL(String(ghUrl)).origin).toBe("https://github.com");
    const go = Google({ clientId: "x", clientSecret: "y" }) as { issuer?: string };
    expect(new URL(String(go.issuer)).origin).toBe("https://accounts.google.com");
  });
});

describe("pagePolicy (Sonderfälle)", () => {
  it("http-Adresse: kein upgrade-insecure-requests (Mock-Umgebung auf localhost)", () => {
    expect(pagePolicy({ nonce: NONCE })).not.toMatch(/upgrade-insecure-requests/);
  });

  it("Report-Only: kein upgrade-insecure-requests (dort nicht erlaubt)", () => {
    expect(pagePolicy({ nonce: NONCE, https: true, reportOnly: true })).not.toMatch(/upgrade-insecure-requests/);
  });

  it("Dev-Server: eval und WebSocket für HMR — nur dort", () => {
    const p = parse(pagePolicy({ nonce: NONCE, dev: true, https: true }));
    expect(p["script-src"]).toContain("'unsafe-eval'");
    expect(p["connect-src"]).toEqual(["'self'", "ws:", "wss:"]);
    expect(p["upgrade-insecure-requests"]).toBeUndefined();
  });
});

describe("Nonce", () => {
  it("128 Bit, base64, jedes Mal neu", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("Not-Schalter CSP_MODE", () => {
  it("Standard und Unbekanntes = enforce", () => {
    expect(cspMode(undefined)).toBe("enforce");
    expect(cspMode("")).toBe("enforce");
    expect(cspMode("Enforce")).toBe("enforce");
    expect(cspMode("aus")).toBe("enforce");
    expect(cspMode(" Report-Only ")).toBe("report-only");
    expect(cspMode("off")).toBe("off");
  });

  it("Kopfzeile je Modus", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName("off")).toBeNull();
  });

  it("https nur bei https-Adresse", () => {
    expect(isHttpsUrl("https://stammbaum.example")).toBe(true);
    expect(isHttpsUrl("http://localhost:3100")).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
  });
});

describe("middleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  const call = () => middleware(new NextRequest("http://localhost:3100/tree", { headers: { "content-security-policy": "script-src 'nonce-fremd'" } }));
  /** Vom Middleware an die Seite durchgereichte Anfrage-Kopfzeilen. */
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("enforce: Richtlinie auf Antwort und Anfrage, gleiche Nonce, fremde ersetzt", () => {
    vi.stubEnv("CSP_MODE", "");
    const res = call();
    const policy = res.headers.get("content-security-policy");
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(forwarded(res, "content-security-policy")).toBe(policy);
    const nonce = forwarded(res, "x-nonce");
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).not.toContain("fremd");
    expect(call().headers.get("content-security-policy")).not.toBe(policy);
  });

  it("report-only: nur melden", () => {
    vi.stubEnv("CSP_MODE", "report-only");
    const res = call();
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toMatch(/'nonce-/);
    expect(forwarded(res, "content-security-policy")).toBeNull();
  });

  it("off: keine Richtlinie", () => {
    vi.stubEnv("CSP_MODE", "off");
    const res = call();
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("läuft in Node.js (CSP_MODE zur Laufzeit) und nicht für API, Build-Dateien, Geodaten", () => {
    expect(middlewareConfig.runtime).toBe("nodejs");
    const re = new RegExp(`^${middlewareConfig.matcher[0].source}$`);
    for (const p of ["/", "/tree", "/login", "/people/abc", "/hilfe/01-start", "/apifoo"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/api", "/api/media/x", "/api/auth/callback/github", "/_next/static/chunks/a.js", "/favicon.ico", "/icon.svg", "/geo/countries.json"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});

describe("next.config.mjs", () => {
  it("API-Antworten bekommen API_POLICY (gleich wie in lib/csp.ts)", async () => {
    const cfg = (await import("../next.config.mjs")).default as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> };
    const rules = await cfg.headers();
    const api = rules.find((r) => r.source === "/api/:path*");
    expect(api?.headers).toContainEqual({ key: "Content-Security-Policy", value: API_POLICY });
    const p = parse(API_POLICY);
    expect(p["default-src"]).toEqual(["'none'"]);
    expect(p["frame-ancestors"]).toEqual(["'none'"]);
    // Ersetzt die Kopfzeile der Bildroute — deren sandbox muss mit drin sein.
    expect(p["sandbox"]).toEqual([]);
    // Seiten bekommen ihre Richtlinie aus der Middleware, nicht statisch.
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers.some((h) => h.key === "Content-Security-Policy")).toBe(false);
  });
});
