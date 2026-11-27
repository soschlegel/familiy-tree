import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { FAMILY, familyName, mock, visibleFor } from "../support/mock";

/**
 * Seite „Statistik“ (app/statistics/page.tsx, lib/services/statistics.ts):
 * Karten, Umschalter Land/Region, Familienfilter in der Adresse, Telefon-
 * breite, beide Farbschemata und Rechte (eingeschränkte Benutzer sehen
 * kleinere Zahlen, ohne Familie nichts). Nur lesend.
 */

const CARDS = [
  "stats-places",
  "stats-gender",
  "stats-surnames",
  "stats-given",
  "stats-births",
  "stats-lifespan",
  "stats-children",
  "stats-marriage",
  "stats-months",
];

const personsFigure = (page: import("@playwright/test").Page) => page.getByTestId("stats-persons").locator("p").nth(1);

test.describe("Statistik als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("alle Karten mit Überschrift und Grundlage, Hilfe-Link, keine Kennungen", async ({ page }) => {
    await page.goto("/statistics");
    await expect(page.getByRole("heading", { level: 1, name: "Statistik" })).toBeVisible();
    await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/statistik");
    await expect(personsFigure(page)).toHaveText(String(mock.persons.length));
    for (const id of CARDS) {
      const card = page.getByTestId(id);
      await expect(card.getByRole("heading", { level: 2 })).toBeVisible();
      await expect(card.getByTestId("stats-basis")).toContainText(/von \d+ Personen|aus allen/);
    }
    await expect(page.getByTestId("stats-places-chart")).toHaveAttribute("aria-label", /Geburtsorte nach Land.*Deutschland/);
    await expect(page.getByTestId("stats-surnames").getByTestId("stats-bar-row").first()).toBeVisible();
    expect(await page.getByTestId("stats-surnames").getByTestId("stats-bar-row").count()).toBeLessThanOrEqual(15);
    const html = await page.content();
    expect(html).not.toMatch(/mock-p-\d+/);
    await expectNoA11yViolations(page);
  });

  test("Umschalter „nach Region“ und Familienfilter stehen in der Adresse", async ({ page }) => {
    await page.goto("/statistics");
    await expect(page.getByTestId("stats-level-country")).toHaveAttribute("aria-current", "true");
    // Ein Klick vor der Hydration ginge im Router verloren.
    await waitForHydration(page, '[data-testid="stats-level-region"]');
    await page.getByTestId("stats-level-region").click();
    await expect(page).toHaveURL(/\/statistics\?level=region$/);
    await expect(page.getByTestId("stats-level-region")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("stats-places-legend").getByRole("row").filter({ hasText: ", Deutschland" }).first()).toBeVisible();

    await waitForHydration(page, "#stats-family");
    await page.locator("#stats-family").selectOption(FAMILY.A);
    await expect(page).toHaveURL(new RegExp(`family=${FAMILY.A}`));
    await expect(page).toHaveURL(/level=region/);
    await expect(personsFigure(page)).toHaveText(String(visibleFor(["A"]).length));
    await expect(page.getByTestId("stats-latest")).toContainText(`nur ${familyName("A")}`);

    // Zurück auf Land: die Familie bleibt.
    await waitForHydration(page, '[data-testid="stats-level-country"]');
    await page.getByTestId("stats-level-country").click();
    await expect(page).toHaveURL(new RegExp(`/statistics\\?family=${FAMILY.A}$`));
  });
});

test.describe("Statistik mit eingeschränkten Rechten", () => {
  test("Betrachter (nur Familie A): kleinere Zahlen, kein Familienfilter", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await page.goto("/statistics");
    const visible = visibleFor(["A"]).length;
    expect(visible).toBeLessThan(mock.persons.length);
    await expect(personsFigure(page)).toHaveText(String(visible));
    await expect(page.getByTestId("stats-filter")).toHaveCount(0);
    // Eine fremde Familie in der Adresse gibt nichts frei.
    await page.goto(`/statistics?family=${FAMILY.D}`);
    await expect(personsFigure(page)).toHaveText(String(visible));
    // Die eigene Adresse steht in den Seitendaten — sichtbar wird die Familie nirgends.
    await expect(page.locator("main")).not.toContainText(familyName("D"));
  });

  test("ohne Familie: Hinweis statt Zahlen", async ({ loginAs }) => {
    const { page } = await loginAs("nofamily");
    await page.goto("/statistics");
    await expect(page.getByTestId("stats-nothing")).toContainText("Noch nichts auszuwerten.");
    await expect(page.getByTestId("stats-key-figures")).toHaveCount(0);
  });
});

test.describe("Statistik auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`kein waagerechtes Scrollen, Umschalten per Tippen (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/statistics");
      await expect(page.getByTestId("stats-places-chart")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await waitForHydration(page, '[data-testid="stats-level-region"]');
      await page.getByTestId("stats-level-region").tap();
      await expect(page).toHaveURL(/level=region/);
      await expect(page.getByTestId("stats-level-region")).toHaveAttribute("aria-current", "true");
      await expectNoHorizontalOverflow(page);
      await expectNoA11yViolations(page);
    });
  }
});
