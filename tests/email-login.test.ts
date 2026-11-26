import { Auth, skipCSRFCheck, type AuthConfig } from "@auth/core";
import type { Adapter, AdapterUser, VerificationToken } from "@auth/core/adapters";
import Nodemailer from "@auth/core/providers/nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMAIL_LINK_MAX_AGE_SECONDS,
  MAIL_RULES,
  MIN_RESPONSE_MS,
  RESPONSE_JITTER_MS,
  authRouteDecision,
  callbackActionPath,
  checkMailRate,
  clientAddressFromHeaders,
  confirmationUrl,
  emailLoginMode,
  loginMail,
  mailTestOutboxAllowed,
  normalizeEmail,
  plausibleLinkParams,
  publicBaseUrl,
  requestEmailLink,
  resetMailRateLimit,
  smtpSettings,
  withTokenCleanup,
  type Env,
  type LinkRequestDeps,
} from "@/lib/email-login";

const SMTP: Env = {
  AUTH_URL: "https://stammbaum.example.org",
  SMTP_HOST: "smtp.example.org",
  SMTP_USER: "postfach@example.org",
  SMTP_PASSWORD: "geheim",
  SMTP_FROM: "Stammbaum <postfach@example.org>",
};

const MOCK: Env = {
  AUTH_URL: "http://localhost:3190",
  MAIL_TEST_OUTBOX: "mock-only",
  DATABASE_URL: "postgresql://u:p@localhost:5432/familytree_maillink_mock",
  MEDIA_DIR: "C:\\Dev\\familiy-tree\\data\\media-mock",
};

describe("Einrichtung", () => {
  it("SMTP nur vollständig: Host, Benutzer, Passwort, Absender", () => {
    expect(smtpSettings(SMTP)).toEqual({
      host: "smtp.example.org",
      port: 587,
      secure: false,
      user: "postfach@example.org",
      password: "geheim",
      from: "Stammbaum <postfach@example.org>",
    });
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]) {
      expect(smtpSettings({ ...SMTP, [key]: "" }), key).toBeNull();
      expect(smtpSettings({ ...SMTP, [key]: undefined }), key).toBeNull();
    }
  });

  it("Port 465 heißt TLS von Anfang an; SMTP_SECURE übersteuert; ungültiger Port → aus", () => {
    expect(smtpSettings({ ...SMTP, SMTP_PORT: "465" })?.secure).toBe(true);
    expect(smtpSettings({ ...SMTP, SMTP_PORT: "465", SMTP_SECURE: "false" })?.secure).toBe(false);
    expect(smtpSettings({ ...SMTP, SMTP_PORT: "2525", SMTP_SECURE: "true" })).toMatchObject({ port: 2525, secure: true });
    expect(smtpSettings({ ...SMTP, SMTP_PORT: "abc" })).toBeNull();
    expect(smtpSettings({ ...SMTP, SMTP_PORT: "70000" })).toBeNull();
  });

  it("ohne SMTP-Angaben gibt es keinen E-Mail-Link", () => {
    expect(emailLoginMode({ AUTH_URL: SMTP.AUTH_URL })).toBeNull();
    expect(emailLoginMode({})).toBeNull();
    expect(emailLoginMode(SMTP)).toBe("smtp");
  });

  it("ohne gültige öffentliche Adresse (AUTH_URL) ebenfalls nicht", () => {
    expect(emailLoginMode({ ...SMTP, AUTH_URL: undefined })).toBeNull();
    expect(emailLoginMode({ ...SMTP, AUTH_URL: "kein-url" })).toBeNull();
    expect(emailLoginMode({ ...SMTP, AUTH_URL: "ftp://example.org" })).toBeNull();
    expect(publicBaseUrl({ AUTH_URL: "https://stammbaum.example.org/api/auth" })?.toString()).toBe("https://stammbaum.example.org/");
  });

  it("Test-Briefkasten nur mit Freigabe, Mock-Datenbank und Mock-Medienordner", () => {
    expect(mailTestOutboxAllowed(MOCK)).toBe(true);
    expect(mailTestOutboxAllowed({ ...MOCK, NODE_ENV: "production" })).toBe(true);
    expect(mailTestOutboxAllowed({ ...MOCK, MAIL_TEST_OUTBOX: "true" })).toBe(false);
    expect(mailTestOutboxAllowed({ ...MOCK, MAIL_TEST_OUTBOX: undefined })).toBe(false);
    expect(mailTestOutboxAllowed({ ...MOCK, DATABASE_URL: "postgresql://u:p@db:5432/familytree" })).toBe(false);
    expect(mailTestOutboxAllowed({ ...MOCK, MEDIA_DIR: "/data/media" })).toBe(false);
  });

  it("Test-Briefkasten hat in der Mock-Umgebung Vorrang vor SMTP — nie echter Versand", () => {
    expect(emailLoginMode({ ...SMTP, ...MOCK })).toBe("outbox");
    // Im Stack (ohne Mock-Namen) hilft die Freigabe allein nichts.
    expect(emailLoginMode({ ...SMTP, MAIL_TEST_OUTBOX: "mock-only", DATABASE_URL: "postgresql://u:p@db:5432/familytree", MEDIA_DIR: "/data/media" })).toBe("smtp");
    expect(emailLoginMode({ AUTH_URL: SMTP.AUTH_URL, MAIL_TEST_OUTBOX: "mock-only" })).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("vereinheitlicht und lehnt Unsinn ab", () => {
    expect(normalizeEmail("  Ada@Example.TEST ")).toBe("ada@example.test");
    for (const bad of ["", "ada", "a@b@c.de", "\"a\"@b.de", "a b@c.de", "a@b.de,c@d.de", "a@b.de;c@d.de", "a@.de", "a@de.", "<a@b.de>", 42, null]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
    expect(normalizeEmail(`${"a".repeat(250)}@b.de`)).toBeNull();
  });
});

describe("Link anfordern (requestEmailLink)", () => {
  const users: Record<string, { status: string }> = {
    "ada@example.test": { status: "ACTIVE" },
    "neu@example.test": { status: "INVITED" },
    "gesperrt@example.test": { status: "BLOCKED" },
  };

  function deps(clock = { t: 1_000_000 }) {
    const sent: string[] = [];
    const waits: number[] = [];
    const d: LinkRequestDeps = {
      findUser: async (email) => users[email] ?? null,
      sendLink: async (email) => {
        clock.t += 300; // Auth.js + Datenbank brauchen etwas
        sent.push(email);
      },
      now: () => clock.t,
      sleep: async (ms) => {
        waits.push(ms);
        clock.t += ms;
      },
      random: () => 0.5,
    };
    return { d, sent, waits, clock };
  }

  beforeEach(() => resetMailRateLimit());

  it("nur eingeladene, nicht gesperrte Adressen bekommen eine Mail", async () => {
    const { d, sent } = deps();
    expect(await requestEmailLink("Ada@Example.test", "1.1.1.1", d)).toBe("sent");
    expect(await requestEmailLink("neu@example.test", "1.1.1.2", d)).toBe("sent");
    expect(await requestEmailLink("gesperrt@example.test", "1.1.1.3", d)).toBe("blocked");
    expect(await requestEmailLink("fremd@example.test", "1.1.1.4", d)).toBe("unknown");
    expect(await requestEmailLink("kaputt", "1.1.1.5", d)).toBe("invalid");
    expect(sent).toEqual(["ada@example.test", "neu@example.test"]);
  });

  it("antwortet in jedem Fall frühestens nach der Mindestdauer", async () => {
    for (const email of ["ada@example.test", "gesperrt@example.test", "fremd@example.test", "kaputt"]) {
      const clock = { t: 5_000_000 };
      const { d } = deps(clock);
      await requestEmailLink(email, `2.2.2.${email.length}`, d);
      expect(clock.t - 5_000_000, email).toBe(MIN_RESPONSE_MS + Math.floor(0.5 * RESPONSE_JITTER_MS));
    }
  });

  it("Fehler beim Versand ändern die Antwort nicht", async () => {
    const { d, clock } = deps();
    const start = clock.t;
    const log = vi.fn();
    const outcome = await requestEmailLink("ada@example.test", "3.3.3.3", {
      ...d,
      sendLink: async () => {
        throw new Error("SMTP kaputt");
      },
      log,
    });
    expect(outcome).toBe("failed");
    expect(log).toHaveBeenCalledOnce();
    expect(clock.t - start).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
  });

  it("drosselt je Adresse: 3 in 15 Minuten, auch über verschiedene Absender", async () => {
    const { d, sent, clock } = deps();
    for (let i = 0; i < 5; i++) await requestEmailLink("ada@example.test", `4.4.4.${i}`, d);
    expect(sent).toHaveLength(MAIL_RULES.address.limit);
    clock.t += MAIL_RULES.address.windowMs;
    expect(await requestEmailLink("ada@example.test", "4.4.4.9", d)).toBe("sent");
  });

  it("drosselt je Absender: 10 je Stunde, auch über verschiedene Adressen", async () => {
    const results: string[] = [];
    const { d } = deps();
    for (let i = 0; i < 12; i++) results.push(await requestEmailLink(`x${i}@example.test`, "5.5.5.5", d));
    expect(results.slice(0, 10).every((r) => r === "unknown")).toBe(true);
    expect(results.slice(10)).toEqual(["throttled", "throttled"]);
    // Danach auch für eine eingeladene Adresse keine Mail.
    expect(await requestEmailLink("neu@example.test", "5.5.5.5", d)).toBe("throttled");
  });

  it("die Drosselung gilt auch bei RATE_LIMIT=off (E2E-Umgebung)", () => {
    vi.stubEnv("RATE_LIMIT", "off");
    try {
      const results = Array.from({ length: 4 }, () => checkMailRate("ada@example.test", "6.6.6.6"));
      expect(results).toEqual([true, true, true, false]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Absender ist der letzte Eintrag in X-Forwarded-For", () => {
    expect(clientAddressFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientAddressFromHeaders(new Headers())).toBe("unbekannt");
  });
});

describe("Link, Bestätigungsseite und Route", () => {
  it("Link in der Mail zeigt auf die Bestätigungsseite unter der öffentlichen Adresse", () => {
    const authJs = "http://evil.example.net/api/auth/callback/nodemailer?callbackUrl=%2Ftree&token=abc123def456abc789&email=ada%40example.test";
    const url = new URL(confirmationUrl(authJs, new URL("https://stammbaum.example.org")));
    expect(url.origin).toBe("https://stammbaum.example.org");
    expect(url.pathname).toBe("/login/email");
    expect(url.searchParams.get("token")).toBe("abc123def456abc789");
    expect(url.searchParams.get("email")).toBe("ada@example.test");
    expect(url.searchParams.has("callbackUrl")).toBe(false);
  });

  it("prüft die Form der Link-Angaben", () => {
    const token = "a".repeat(64);
    expect(plausibleLinkParams(token, "ada@example.test")).toBe(true);
    expect(plausibleLinkParams(token, "Ada@example.test")).toBe(false);
    expect(plausibleLinkParams("kurz", "ada@example.test")).toBe(false);
    expect(plausibleLinkParams(`${token}<`, "ada@example.test")).toBe(false);
    expect(plausibleLinkParams([token], "ada@example.test")).toBe(false);
    expect(callbackActionPath(token, "ada@example.test")).toBe(
      `/api/auth/callback/nodemailer?token=${token}&email=ada%40example.test&callbackUrl=%2Ftree`,
    );
  });

  it("sperrt das Anfordern von außen, leitet GET-Einlösen auf die Bestätigung, wehrt fremde Seiten ab", () => {
    const h = (init: Record<string, string> = {}) => new Headers(init);
    expect(authRouteDecision({ method: "POST", headers: h() }, "/api/auth/signin/nodemailer")).toEqual({ kind: "not-found" });
    expect(authRouteDecision({ method: "GET", headers: h() }, "/api/auth/callback/nodemailer")).toEqual({ kind: "confirm", path: "/login/email" });
    expect(
      authRouteDecision({ method: "POST", headers: h({ "sec-fetch-site": "cross-site" }) }, "/api/auth/callback/nodemailer"),
    ).toEqual({ kind: "forbidden" });
    expect(
      authRouteDecision({ method: "POST", headers: h({ origin: "http://localhost:3190", host: "localhost:3190" }) }, "/api/auth/callback/nodemailer"),
    ).toEqual({ kind: "pass" });
    // Andere Anbieter bleiben unberührt.
    expect(authRouteDecision({ method: "POST", headers: h() }, "/api/auth/signin/github")).toEqual({ kind: "pass" });
    expect(authRouteDecision({ method: "GET", headers: h() }, "/api/auth/callback/google")).toEqual({ kind: "pass" });
  });

  it("Mailtext: deutsch, Gültigkeit, Hinweis, keine externen Inhalte, Link maskiert", () => {
    const url = "https://stammbaum.example.org/login/email?token=abc&email=a%40b.de";
    const mail = loginMail(url);
    expect(mail.subject).toBe("Dein Anmeldelink für den Stammbaum");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("15 Minuten");
      expect(body).toContain("Wenn du das nicht warst, ignoriere diese Mail.");
    }
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(url.replace(/&/g, "&amp;"));
    expect(mail.html).not.toMatch(/<img|<script|src=|url\(|<link/i);
    expect(loginMail('https://x.example/"><script>').html).not.toContain("<script>");
  });
});

/**
 * Der eigentliche Ablauf mit der eingebauten Auth.js-Version: Anbieter
 * Nodemailer, JWT-Sitzung, Adapter im Speicher mit unserem Aufräumen und
 * derselben Einladungsregel wie im signIn-Callback (lib/auth.ts).
 */
describe("Auth.js-Ablauf (Token gehasht, einmalig, befristet, kein neues Konto)", () => {
  type U = AdapterUser & { status: string };
  let users: Map<string, U>;
  let tokens: VerificationToken[];
  let mails: { to: string; url: string }[];
  let created: number;

  beforeEach(() => {
    users = new Map(
      [
        { id: "u1", email: "ada@example.test", emailVerified: null, status: "ACTIVE" },
        { id: "u2", email: "gesperrt@example.test", emailVerified: null, status: "BLOCKED" },
      ].map((u) => [u.email, u]),
    );
    tokens = [];
    mails = [];
    created = 0;
  });

  afterEach(() => vi.useRealTimers());

  function config(): AuthConfig {
    const base: Adapter = {
      async createUser(u) {
        created += 1;
        return { ...u, id: "neu" } as AdapterUser;
      },
      async getUser(id) {
        return [...users.values()].find((u) => u.id === id) ?? null;
      },
      async getUserByEmail(email) {
        return users.get(email) ?? null;
      },
      async updateUser(u) {
        const found = [...users.values()].find((x) => x.id === u.id)!;
        Object.assign(found, u);
        return found;
      },
      async createVerificationToken(t) {
        tokens.push(t);
        return t;
      },
      async useVerificationToken({ identifier, token }) {
        const i = tokens.findIndex((t) => t.identifier === identifier && t.token === token);
        return i < 0 ? null : tokens.splice(i, 1)[0];
      },
    };
    return {
      secret: "test-secret-0123456789-0123456789",
      trustHost: true,
      basePath: "/api/auth",
      session: { strategy: "jwt" },
      skipCSRFCheck,
      // Abgelehnte Anmeldungen sind hier gewollt — nicht ins Protokoll.
      logger: { error: () => {} },
      pages: { error: "/login" },
      adapter: withTokenCleanup(base, async (identifier, now) => {
        tokens = tokens.filter((t) => t.identifier !== identifier && t.expires >= now);
      }),
      providers: [
        Nodemailer({
          server: { jsonTransport: true },
          maxAge: EMAIL_LINK_MAX_AGE_SECONDS,
          normalizeIdentifier: (id) => normalizeEmail(id) ?? "",
          async sendVerificationRequest({ identifier, url }) {
            mails.push({ to: identifier, url });
          },
        }),
      ],
      callbacks: {
        async signIn({ user }) {
          const known = user.email ? users.get(user.email) : undefined;
          return Boolean(known && known.status !== "BLOCKED");
        },
      },
    };
  }

  async function requestLink(email: string): Promise<Response> {
    return Auth(
      new Request("http://localhost/api/auth/signin/nodemailer", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, callbackUrl: "/tree" }),
      }),
      config(),
    );
  }

  async function redeem(url: string): Promise<Response> {
    const u = new URL(url);
    return Auth(new Request(`http://localhost/api/auth/callback/nodemailer${u.search}`, { method: "POST" }), config());
  }

  const sessionCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("authjs.session-token="));

  it("speichert das Token nur gehasht und löst es genau einmal ein", async () => {
    await requestLink("ada@example.test");
    expect(mails).toHaveLength(1);
    const raw = new URL(mails[0].url).searchParams.get("token")!;
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).not.toBe(raw);
    expect(tokens[0].token).toMatch(/^[0-9a-f]{64}$/);
    const ttl = tokens[0].expires.getTime() - Date.now();
    expect(ttl).toBeGreaterThan((EMAIL_LINK_MAX_AGE_SECONDS - 5) * 1000);
    expect(ttl).toBeLessThanOrEqual(EMAIL_LINK_MAX_AGE_SECONDS * 1000);

    const first = await redeem(mails[0].url);
    expect(first.headers.get("location")).toBe("http://localhost/tree");
    expect(sessionCookie(first)).toBeTruthy();
    expect(tokens).toHaveLength(0);

    const second = await redeem(mails[0].url);
    expect(second.headers.get("location")).toContain("/login?error=Verification");
    expect(sessionCookie(second)).toBeFalsy();
    expect(created).toBe(0);
  });

  it("ein abgelaufener Link meldet nicht an", async () => {
    await requestLink("ada@example.test");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (EMAIL_LINK_MAX_AGE_SECONDS + 1) * 1000);
    const res = await redeem(mails[0].url);
    expect(res.headers.get("location")).toContain("/login?error=Verification");
    expect(sessionCookie(res)).toBeFalsy();
  });

  it("ein neuer Link ersetzt den älteren; abgelaufene werden aufgeräumt", async () => {
    tokens.push({ identifier: "alt@example.test", token: "x", expires: new Date(Date.now() - 1000) });
    await requestLink("ada@example.test");
    await requestLink("ada@example.test");
    expect(tokens).toHaveLength(1);
    expect((await redeem(mails[0].url)).headers.get("location")).toContain("error=Verification");
    expect((await redeem(mails[1].url)).headers.get("location")).toBe("http://localhost/tree");
  });

  it("unbekannte und gesperrte Adressen: kein Token, keine Mail, kein neues Konto", async () => {
    await requestLink("fremd@example.test");
    await requestLink("gesperrt@example.test");
    expect(mails).toHaveLength(0);
    expect(tokens).toHaveLength(0);
    expect(created).toBe(0);
  });

  it("wer nach dem Anfordern gesperrt wird, kommt mit dem Link nicht hinein", async () => {
    await requestLink("ada@example.test");
    users.get("ada@example.test")!.status = "BLOCKED";
    const res = await redeem(mails[0].url);
    expect(res.headers.get("location")).toContain("/login?error=AccessDenied");
    expect(sessionCookie(res)).toBeFalsy();
  });
});
