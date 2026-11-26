import type { Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  acceptDialogs,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  httpError,
} from "../support/fixtures";
import { apiAs } from "../support/api";
import { mainNav, openAdminMenu } from "../support/nav";

/**
 * Einstellungen (/admin/settings): Administrator legt die Adresse des
 * KI-Connectors an (Schlüssel aus dem Drop-down, Prüfung am Feld), die Seite
 * „KI-Zugang“ zeigt sie, Ändern wirkt dort ebenso, Entfernen stellt den
 * Rückfall (Server-Konfiguration bzw. „nicht gesetzt“) wieder her; Eintrag in
 * der Änderungsübersicht. Nicht-Administratoren kommen weder über die Seite
 * noch über die API hinein. Telefonbreite, dunkles Farbschema, axe.
 *
 * Der Eintrag wird vor und nach der Datei entfernt — andere Tests (u.a.
 * e2e/read/mobile.spec.ts, Anleitung ohne Adresse) erwarten keinen.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const KEY = "mcpConnectorUrl";
const LABEL = "Adresse des KI-Connectors";
const FIRST = "https://mcp.example.de/e2e-stammbaum";
const SECOND = "https://mcp.example.de/e2e-geaendert";

/** Wert aus der Server-Konfiguration (Rückfall), wie ihn der Server sieht. */
let fallback: string | null = null;

async function removeSetting() {
  const api = await apiAs("admin");
  expect([200, 404]).toContain((await api.delete(`/api/settings/${KEY}`)).status());
  await api.dispose();
}

test.beforeAll(async () => {
  await removeSetting();
  const api = await apiAs("admin");
  const res = await api.get("/api/settings");
  expect(res.status()).toBe(200);
  const list = (await res.json()) as { key: string; envValue: string | null; source: string }[];
  const entry = list.find((s) => s.key === KEY)!;
  expect(entry.source).not.toBe("app");
  fallback = entry.envValue;
  await api.dispose();
});

test.afterAll(removeSetting);

const card = (page: Page) => page.getByTestId(`setting-${KEY}`);
const fallbackSource = () => (fallback ? "aus der Server-Konfiguration" : "nicht gesetzt");

async function expectGuideShows(page: Page, url: string | null) {
  await page.goto("/ai-access");
  if (url) {
    await expect(page.getByTestId("ai-connector-url")).toHaveText(url);
    await expect(page.getByTestId("ai-connector-url-missing")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("ai-connector-url-missing")).toBeVisible();
    await expect(page.getByTestId("ai-connector-url")).toHaveCount(0);
  }
}

test("Administrator: über das Menü erreichbar, Ausgangszustand und Barrierefreiheit", async ({ page }) => {
  await page.goto("/people");
  await openAdminMenu(page);
  await mainNav(page).getByRole("link", { name: "Einstellungen", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();

  await expect(card(page).getByRole("heading", { name: LABEL })).toBeVisible();
  await expect(card(page).getByTestId("setting-source")).toHaveText(fallbackSource());
  await expect(card(page).getByTestId("setting-effective")).toHaveText(fallback ?? "—");
  // Nicht in der App gesetzt: kein Ändern/Entfernen, aber im Drop-down wählbar.
  await expect(card(page).getByRole("button", { name: `${LABEL} entfernen` })).toHaveCount(0);
  const select = page.getByLabel("Einstellung", { exact: true });
  await expect(select.locator("option")).toContainText([LABEL]);
  await expect(page.getByRole("link", { name: "Wie funktionieren die Einstellungen?" })).toHaveAttribute("href", "/hilfe/einstellungen");

  await expectNoA11yViolations(page);
  // Dunkles Farbschema mit frisch geladener Seite — sonst misst axe Knöpfe
  // mitten im Farbübergang (`transition` an .btn).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "light" });
});

test("anlegen mit Prüfung am Feld; „KI-Zugang“ zeigt die Adresse", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(400));
  await page.goto("/admin/settings");
  await page.getByLabel("Einstellung", { exact: true }).selectOption({ label: LABEL });
  await expect(page.getByTestId("setting-new-description")).toContainText("KI-Zugang");

  const value = page.getByLabel("Wert", { exact: true });
  await value.fill("kein-link");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator("#setting-new-error")).toContainText("Keine gültige Adresse");
  await expect(value).toHaveAttribute("aria-invalid", "true");

  await value.fill(FIRST);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${LABEL}“ gesetzt.`);
  await expect(card(page).getByTestId("setting-source")).toHaveText("in der App gesetzt");
  await expect(card(page).getByTestId("setting-effective")).toHaveText(FIRST);
  // Das Drop-down bietet nur noch nicht gesetzte Schlüssel an — hier keinen mehr.
  await expect(page.getByTestId("settings-all-set")).toBeVisible();
  await expect(page.getByLabel("Einstellung", { exact: true })).toHaveCount(0);

  await expectGuideShows(page, FIRST);
});

test("ändern wirkt auf „KI-Zugang“; Eintrag in der Änderungsübersicht", async ({ page }) => {
  await page.goto("/admin/settings");
  await card(page).getByRole("button", { name: `${LABEL} ändern` }).click();
  const input = card(page).getByLabel("Neuer Wert");
  await expect(input).toHaveValue(FIRST);
  await input.fill(SECOND);
  await card(page).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${LABEL}“ geändert.`);
  await expect(card(page).getByTestId("setting-effective")).toHaveText(SECOND);

  await expectGuideShows(page, SECOND);

  await page.goto("/admin/changes");
  await expect(page.getByText("Einstellung geändert").first()).toBeVisible();
});

test("Telefon (390 px): ohne Seitwärts-Scrollen, Tippflächen mindestens 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/settings");
  await expect(card(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const name of [`${LABEL} ändern`, `${LABEL} entfernen`]) {
    const box = (await card(page).getByRole("button", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
});

test("entfernen stellt den Rückfall her", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/admin/settings");
  await card(page).getByRole("button", { name: `${LABEL} entfernen` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${LABEL}“ entfernt.`);
  await expect(card(page).getByTestId("setting-source")).toHaveText(fallbackSource());
  await expect(card(page).getByTestId("setting-effective")).toHaveText(fallback ?? "—");
  await expect(page.getByLabel("Einstellung", { exact: true })).toBeVisible();

  await expectGuideShows(page, fallback);
});

test("Nicht-Administratoren: kein Menüpunkt, Seite leitet um, API 403", async ({ loginAs }) => {
  for (const role of ["editor", "viewer"] as const) {
    const { page } = await loginAs(role);
    await page.goto("/people");
    await openAdminMenu(page);
    await expect(mainNav(page).getByRole("link", { name: "Einstellungen", exact: true })).toHaveCount(0);
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/tree(\?|$)/);
    await expect(page.getByRole("alert").filter({ hasText: "fehlt dir die Berechtigung" })).toBeVisible();

    const api = await apiAs(role);
    expect((await api.get("/api/settings")).status(), role).toBe(403);
    expect((await api.post("/api/settings", { data: { key: KEY, value: FIRST } })).status(), role).toBe(403);
    expect((await api.delete(`/api/settings/${KEY}`)).status(), role).toBe(403);
    await api.dispose();
  }
});
