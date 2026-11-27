import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContextOptions, Page } from "@playwright/test";

import { test, expect, expectNoA11yViolations, expectNoHorizontalOverflow, waitForStartPage, watchPage } from "../support/fixtures";
import { apiAs, uniq } from "../support/api";
import { USERS } from "../support/mock";

/**
 * Anmeldung per E-Mail-Link über den Test-Briefkasten der Mock-Umgebung
 * (scripts/mock.mjs setzt MAIL_TEST_OUTBOX=mock-only; Mails liegen als JSON
 * unter <Mock-Medienordner>/mail-outbox, lib/email-login-mail.ts). Eigene,
 * frisch eingeladene Benutzer; jeder Test mit eigener Absender-Adresse
 * (X-Forwarded-For), weil die Drosselung je Absender auch bei RATE_LIMIT=off
 * gilt.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const OUTBOX = path.join(path.resolve(process.env.MOCK_MEDIA_DIR ?? path.join("data", "media-mock")), "mail-outbox");
const tag = uniq();
const invited = `e2e-link-${tag}@example.test`;
const throttled = `e2e-link-drossel-${tag}@example.test`;
const NEUTRAL = "Wenn diese Adresse freigeschaltet ist, kommt gleich eine E-Mail";

type Mail = { to: string; subject: string; text: string; html: string; url: string };

function mailsTo(email: string): Mail[] {
  let names: string[];
  try {
    names = readdirSync(OUTBOX).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((n) => JSON.parse(readFileSync(path.join(OUTBOX, n), "utf8")) as Mail).filter((m) => m.to === email);
}

let ipCounter = 0;
/** Eigener Kontext mit eigener Absender-Adresse. */
async function freshPage(browser: Browser, consoleGuard: Parameters<typeof watchPage>[1], options: BrowserContextOptions = {}) {
  ipCounter += 1;
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${(Number.parseInt(tag.slice(-2), 36) % 200) + ipCounter}` },
    ...options,
  });
  const page = await context.newPage();
  watchPage(page, consoleGuard, consoleGuard.patterns);
  return { page, context };
}

async function requestLink(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Link zusenden" }).click();
  await expect(page).toHaveURL(/\/login\?link=gesendet$/);
  await expect(page.getByRole("status").filter({ hasText: NEUTRAL })).toBeVisible();
}

test.beforeAll(async () => {
  const api = await apiAs("admin");
  for (const email of [invited, throttled]) {
    const res = await api.post("/api/users", { data: { email, role: "VIEWER" } });
    expect(res.status(), await res.text()).toBe(201);
  }
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  const users = (await (await api.get("/api/users")).json()) as { id: string; email: string }[];
  for (const u of users.filter((x) => x.email === invited || x.email === throttled)) await api.delete(`/api/users/${u.id}`);
  await api.dispose();
});

test("eingeladene Adresse: Link anfordern, bestätigen, angemeldet — der Link gilt nur einmal", async ({ browser, consoleGuard }) => {
  const { page, context } = await freshPage(browser, consoleGuard);
  await requestLink(page, invited.toUpperCase());

  const mails = mailsTo(invited);
  expect(mails).toHaveLength(1);
  const [mail] = mails;
  expect(mail.subject).toBe("Dein Anmeldelink für den Stammbaum");
  expect(mail.text).toContain("15 Minuten");
  expect(mail.text).toContain("Wenn du das nicht warst, ignoriere diese Mail.");
  const link = new URL(mail.url);
  expect(link.pathname).toBe("/login/email");

  // Vorab-Abruf (Mail-Vorschau) verbraucht den Link nicht.
  expect((await context.request.get(mail.url)).status()).toBe(200);
  // Alte Form direkt auf Auth.js: leitet nur auf die Bestätigung.
  const direct = await context.request.get(`/api/auth/callback/nodemailer${link.search}`, { maxRedirects: 0 });
  expect(direct.status()).toBe(303);
  expect(new URL(direct.headers().location).pathname).toBe("/login/email");

  await page.goto(mail.url);
  await expect(page.getByRole("heading", { name: "Mit E-Mail-Link anmelden" })).toBeVisible();
  await expect(page.getByText(invited)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Jetzt anmelden" }).click();
  await waitForStartPage(page);
  await context.close();

  // Derselbe Link ein zweites Mal: abgelehnt, mit Weg zu einem neuen Link.
  const second = await freshPage(browser, consoleGuard);
  await second.page.goto(mail.url);
  await second.page.getByRole("button", { name: "Jetzt anmelden" }).click();
  await expect(second.page).toHaveURL(/\/login\?error=Verification/);
  const alert = second.page.getByRole("alert").filter({ hasText: "Dieser Anmeldelink gilt nicht mehr" });
  await expect(alert).toBeVisible();
  await alert.getByRole("link", { name: "Neuen Link anfordern" }).click();
  await expect(second.page.getByLabel("E-Mail-Adresse", { exact: true })).toBeInViewport();
  await expect(second.page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
  await second.context.close();
});

test("unbekannte und gesperrte Adressen: gleiche Antwort, keine Mail", async ({ browser, consoleGuard }) => {
  const { page, context } = await freshPage(browser, consoleGuard);
  const unknown = `niemand-${tag}@example.test`;
  for (const email of [unknown, USERS.blocked]) {
    await requestLink(page, email);
    expect(mailsTo(email), email).toHaveLength(0);
  }
  await context.close();
});

test("Drosselung: höchstens 3 Links je Adresse in 15 Minuten", async ({ browser, consoleGuard }) => {
  const { page, context } = await freshPage(browser, consoleGuard);
  for (let i = 0; i < 4; i++) await requestLink(page, throttled);
  expect(mailsTo(throttled)).toHaveLength(3);
  await context.close();
});

test("unvollständiger Link: Hinweis und Weg zu einem neuen", async ({ browser, consoleGuard }) => {
  const { page, context } = await freshPage(browser, consoleGuard);
  await page.goto("/login/email?token=kurz");
  await expect(page.getByRole("alert").filter({ hasText: "Dieser Anmeldelink ist unvollständig" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt anmelden" })).toHaveCount(0);
  await page.getByRole("link", { name: "Neuen Link anfordern" }).click();
  await expect(page).toHaveURL(/\/login#link-email$/);
  await context.close();
});

test("Telefon (390 px) im dunklen Farbschema: Anmeldeseite und Bestätigung brauchbar und barrierefrei", async ({ browser, consoleGuard }) => {
  const { page, context } = await freshPage(browser, consoleGuard, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: "dark",
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Link zusenden" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await requestLink(page, invited);
  await expectNoA11yViolations(page);
  const mail = mailsTo(invited).at(-1)!;
  await page.goto(mail.url);
  await expect(page.getByRole("button", { name: "Jetzt anmelden" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
  await context.close();
});
