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
 * Verwaltung der Zeitgeschichte (/admin/history): Administrator legt ein
 * eigenes Ereignis an (Prüfung am Feld), ändert und löscht es, blendet einen
 * mitgelieferten Eintrag aus und wieder ein; Wirkung auf die Zeitreise der
 * Karte; Einträge in der Änderungsübersicht. Nicht-Administratoren kommen
 * weder über die Seite noch über die API hinein. Telefonbreite, dunkles
 * Farbschema, axe.
 *
 * Aufräumen vor und nach der Datei: eigene Einträge „E2E …“ löschen, die
 * hier ausgeblendeten mitgelieferten wieder einblenden — die lesenden Tests
 * (e2e/read/history.spec.ts) erwarten die vollständige Liste.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const TITLE = "E2E Hochwasser";
const CHANGED = "E2E Hochwasser am Fluss";
const BUILTIN = { id: "erster-weltkrieg", title: "Erster Weltkrieg" };

type State = { builtin: { id: string; hidden: boolean }[]; custom: { id: string; title: string }[] };

async function cleanup() {
  const api = await apiAs("admin");
  const res = await api.get("/api/history-events");
  expect(res.status()).toBe(200);
  const state = (await res.json()) as State;
  for (const c of state.custom.filter((c) => c.title.startsWith("E2E "))) {
    expect([200, 404]).toContain((await api.delete(`/api/history-events/${c.id}`)).status());
  }
  if (state.builtin.find((b) => b.id === BUILTIN.id)?.hidden) {
    expect((await api.patch(`/api/history-events/builtin/${BUILTIN.id}`, { data: { hidden: false } })).status()).toBe(200);
  }
  await api.dispose();
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

const custom = (page: Page) => page.getByTestId("history-custom").filter({ hasText: "E2E " });
const builtinRow = (page: Page) => page.getByTestId(`history-builtin-${BUILTIN.id}`);
const addForm = (page: Page) => page.getByRole("form", { name: "Ereignis hinzufügen" });

test("Administrator: über das Menü erreichbar, Ausgangszustand und Barrierefreiheit", async ({ page }) => {
  await page.goto("/people");
  await openAdminMenu(page);
  await mainNav(page).getByRole("link", { name: "Zeitgeschichte", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/history$/);
  await expect(page.getByRole("heading", { level: 1, name: "Zeitgeschichte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Wie funktioniert die Zeitgeschichte?" })).toHaveAttribute(
    "href",
    "/hilfe/einstellungen#zeitgeschichte",
  );
  await expect(builtinRow(page)).toContainText("1914–1918");
  await expect(builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` })).toBeVisible();
  await expect(addForm(page).getByTestId("history-form-hint")).toContainText("keine Namen aus dem Stammbaum");
  await expect(custom(page)).toHaveCount(0);

  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(builtinRow(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "light" });
});

test("anlegen mit Prüfung am Feld; erscheint in der Zeitreise", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(400));
  await page.goto("/admin/history");
  const form = addForm(page);
  await form.getByLabel("Titel").fill(TITLE);
  await form.getByLabel("Jahr von").fill("1916");
  await form.getByLabel(/Jahr bis/).fill("1900");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(form.getByRole("alert")).toContainText("„bis“ darf nicht vor „von“ liegen.");
  await expect(form.getByLabel(/Jahr bis/)).toHaveAttribute("aria-invalid", "true");

  await form.getByLabel(/Jahr bis/).fill("");
  await form.getByLabel("Art").selectOption({ label: "Seuche/Not" });
  await form.getByLabel(/Beschreibung/).fill("Der Fluss trat über die Ufer.");
  await form.getByLabel(/Gilt für Region\/Ort/).fill("Beispieltal");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${TITLE}“ angelegt.`);
  await expect(custom(page)).toHaveCount(1);
  await expect(custom(page).getByTestId("history-custom-title")).toHaveText(TITLE);
  await expect(custom(page).getByTestId("history-custom-years")).toHaveText("1916");
  await expect(custom(page).getByTestId("history-custom-region")).toHaveText("Gilt für: Beispieltal");
  // Formular wieder leer.
  await expect(form.getByLabel("Titel")).toHaveValue("");

  await page.goto("/map?mode=alle&jahr=1916");
  const item = page.getByTestId("map-history").getByTestId("map-history-item").filter({ hasText: TITLE });
  await expect(item).toHaveText(`${TITLE} (1916)`);
  await expect(item).toHaveAttribute("title", "Seuche/Not · gilt für Beispieltal · Der Fluss trat über die Ufer.");
});

test("ändern; Eintrag in der Änderungsübersicht", async ({ page }) => {
  await page.goto("/admin/history");
  await custom(page).getByRole("button", { name: `${TITLE} ändern` }).click();
  const form = page.getByRole("form", { name: `${TITLE} ändern` });
  await expect(form.getByLabel("Jahr von")).toHaveValue("1916");
  await form.getByLabel("Titel").fill(CHANGED);
  await form.getByLabel(/Jahr bis/).fill("1917");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${CHANGED}“ geändert.`);
  await expect(custom(page).getByTestId("history-custom-years")).toHaveText("1916–1917");

  await expectChange(page, `Zeitgeschichte „${CHANGED}“ geändert`);
});

/** Änderungsübersicht: das neueste Paket „Zeitgeschichte geändert“ aufklappen und die Beschreibung finden. */
async function expectChange(page: Page, what: string, nth = 0) {
  await page.goto("/admin/changes");
  await page.getByRole("button", { name: "Einzelheiten zu „Zeitgeschichte geändert“" }).nth(nth).click();
  await expect(page.getByText(what).first()).toBeVisible();
}

test("mitgelieferten Eintrag ausblenden und wieder einblenden — wirkt auf die Karte", async ({ page }) => {
  await page.goto("/admin/history");
  await builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${BUILTIN.title}“ ausgeblendet.`);
  await expect(builtinRow(page).getByTestId("history-builtin-hidden")).toHaveText("ausgeblendet");
  await expect(page.getByTestId("history-builtin-count")).toContainText("davon 1 ausgeblendet");

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).not.toContainText(BUILTIN.title);
  await expect(page.getByTestId("map-history")).toContainText(CHANGED);

  await page.goto("/admin/history");
  await builtinRow(page).getByRole("button", { name: `${BUILTIN.title} einblenden` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${BUILTIN.title}“ wieder eingeblendet.`);
  await expect(builtinRow(page).getByTestId("history-builtin-hidden")).toHaveCount(0);

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).toContainText(BUILTIN.title);

  // Neuestes Paket: wieder eingeblendet, das davor: ausgeblendet.
  await expectChange(page, `Zeitgeschichte „${BUILTIN.title}“ wieder eingeblendet`, 0);
  await expectChange(page, `Zeitgeschichte „${BUILTIN.title}“ ausgeblendet`, 1);
});

test("Telefon (390 px): ohne Seitwärts-Scrollen, Tippflächen mindestens 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/history");
  await expect(custom(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const button of [
    custom(page).getByRole("button", { name: `${CHANGED} ändern` }),
    custom(page).getByRole("button", { name: `${CHANGED} löschen` }),
    builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` }),
    addForm(page).getByRole("button", { name: "Anlegen" }),
  ]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test("löschen", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/admin/history");
  await custom(page).getByRole("button", { name: `${CHANGED} löschen` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${CHANGED}“ gelöscht.`);
  await expect(custom(page)).toHaveCount(0);
  await expect(page.getByTestId("history-custom-empty")).toBeVisible();

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).not.toContainText(CHANGED);
});

test("Nicht-Administratoren: kein Menüpunkt, Seite leitet um, API 403", async ({ loginAs }) => {
  for (const role of ["editor", "viewer"] as const) {
    const { page } = await loginAs(role);
    await page.goto("/people");
    await openAdminMenu(page);
    await expect(mainNav(page).getByRole("link", { name: "Zeitgeschichte", exact: true })).toHaveCount(0);
    await page.goto("/admin/history");
    await expect(page).toHaveURL(/\/tree(\?|$)/);
    await expect(page.getByRole("alert").filter({ hasText: "fehlt dir die Berechtigung" })).toBeVisible();

    const api = await apiAs(role);
    expect((await api.get("/api/history-events")).status(), role).toBe(403);
    expect(
      (await api.post("/api/history-events", { data: { title: "E2E verboten", yearFrom: 1900, kind: "krieg" } })).status(),
      role,
    ).toBe(403);
    expect((await api.patch(`/api/history-events/builtin/${BUILTIN.id}`, { data: { hidden: true } })).status(), role).toBe(403);
    await api.dispose();
  }
});
