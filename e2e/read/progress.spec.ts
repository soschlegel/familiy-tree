import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { L, forbiddenNamesFor, fullName, mock, person } from "../support/mock";

/**
 * Seite „Forschungs-Fortschritt“ (app/progress/page.tsx,
 * lib/services/research-progress.ts): Einstiege von Recherche und
 * Startseite, Hinweis ohne Ausgangsperson, Balken mit Zahlen je Generation
 * und Linie, Vorschläge verlinken auf Personenseiten, Tiefe und Person
 * wählbar, eingeschränkter Benutzer, Telefonbreite in beiden Farbschemata.
 * Nur lesend.
 */

const allIds = new Set(mock.persons.map((p) => p.id));

async function suggestionIds(page: import("@playwright/test").Page): Promise<string[]> {
  const hrefs = await page.getByTestId("progress-suggestion").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((h) => h.replace(/^\/people\//, ""));
}

test.describe("Forschungs-Fortschritt als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Einstiege von Startseite und Recherche; ohne eigene Person ein Hinweis", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-progress").click();
    await expect(page).toHaveURL(/\/progress$/);
    await expect(page.getByRole("heading", { level: 1, name: "Forschungs-Fortschritt" })).toBeVisible();
    await expect(page.getByTestId("help-link").first()).toHaveAttribute("href", "/hilfe/statistik#forschungs-fortschritt");
    // Der Admin hat keine eigene Person: freundlicher Hinweis mit Auswahl.
    await expect(page.getByTestId("progress-no-root")).toContainText("Das bin ich");
    await expect(page.getByTestId("progress-choose-person")).toHaveText("Person wählen …");
    await expect(page.getByTestId("progress-generation-row")).toHaveCount(0);

    await page.goto("/research");
    await page.getByTestId("research-progress-link").click();
    await expect(page).toHaveURL(/\/progress$/);
    await page.getByTestId("progress-to-research").click();
    await expect(page).toHaveURL(/\/research$/);
  });

  test("Balken mit Zahlen, Linien, Vorschläge verlinken; Tiefe und Person wählbar", async ({ page }) => {
    await page.goto(`/progress?person=${L.selfEditor}`);
    await expect(page.getByTestId("progress-person")).toHaveText(fullName(L.selfEditor));
    const rows = page.getByTestId("progress-generation-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText("Eltern");
    await expect(rows.first().getByTestId("progress-found")).toHaveText("2 von 2");
    await expect(rows.nth(1).getByTestId("progress-found")).toHaveText("4 von 4");
    await expect(rows.nth(2).getByTestId("progress-found")).toHaveText(/^\d+ von 8$/);
    await expect(rows.first().getByTestId("progress-quality")).toContainText("Daten vollständig:");
    await expect(page.getByTestId("progress-total")).toContainText(/\d+ von 126/);
    await expect(page.getByTestId("progress-line-row")).toHaveCount(4);
    await expect(page.getByTestId("progress-line-row").first()).toContainText("Großvater väterlicherseits");
    await expect(page.getByTestId("progress-depth-6")).toHaveAttribute("aria-current", "true");

    // Vorschläge führen nur zu bekannten Personen; ein Klick öffnet die Personenseite.
    const ids = await suggestionIds(page);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(allIds.has(id), id).toBe(true);
    expect(await page.locator('[data-testid="progress-suggestions"] > ol > li').count()).toBeLessThanOrEqual(20);
    const first = page.getByTestId("progress-suggestion").first();
    const href = await first.getAttribute("href");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // Tiefe: 8 Generationen, Person bleibt in der Adresse.
    await page.goto(`/progress?person=${L.selfEditor}`);
    await page.getByTestId("progress-depth-8").click();
    await expect(page).toHaveURL(new RegExp(`/progress\\?person=${L.selfEditor}&generationen=8$`));
    await expect(rows).toHaveCount(8);
    await expect(page.getByTestId("progress-depth-8")).toHaveAttribute("aria-current", "true");

    // Andere Person über die Suche; die Tiefe bleibt erhalten.
    const target = person(L.founders.A);
    await waitForHydration(page, '[data-testid="progress-choose-person"]');
    await page.getByTestId("progress-choose-person").click();
    await page.getByPlaceholder("Name eingeben…").fill(`${target.givenName} ${target.familyName}`);
    await page.getByRole("button", { name: new RegExp(`^${target.givenName} ${target.familyName}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/progress\\?generationen=8&person=${L.founders.A}$`));
    await expect(page.getByTestId("progress-person")).toHaveText(fullName(L.founders.A));
    await expect(rows).toHaveCount(8);
    await page.getByTestId("progress-back").click();
    await expect(page).toHaveURL(/\/progress\?generationen=8$/);
    await expect(page.getByTestId("progress-no-root")).toBeVisible();

    await page.goto(`/progress?person=${L.selfEditor}`);
    await expectNoA11yViolations(page);
  });

  test("unbekannte Person in der Adresse: Hinweis", async ({ page }) => {
    await page.goto("/progress?person=gibt-es-nicht");
    await expect(page.getByTestId("progress-notfound")).toBeVisible();
    await expect(page.getByTestId("progress-no-root")).toBeVisible();
  });
});

test.describe("Forschungs-Fortschritt mit eingeschränkten Rechten", () => {
  test("Bearbeiter: eigene Person, gesperrte Großeltern nur „nicht freigegeben“, keine fremden Namen", async ({ loginAs }) => {
    const { page } = await loginAs("editor");
    await page.goto("/progress");
    await expect(page.getByTestId("progress-person")).toHaveText(fullName(L.selfEditor));
    await expect(page.getByTestId("progress-controls")).toContainText("ich");
    await expect(page.getByTestId("progress-restricted")).toContainText("dort wird nicht weitergezählt");
    const grandparents = page.getByTestId("progress-generation-row").nth(1);
    await expect(grandparents.getByTestId("progress-found")).toHaveText("2 von 4");
    await expect(grandparents.getByTestId("progress-counts-extra")).toContainText("2 nicht freigegeben");
    for (const line of ["MF", "MM"]) {
      await expect(page.locator(`[data-testid="progress-line-row"][data-line="${line}"]`).getByTestId("progress-line-grandparent")).toHaveText(
        "nicht freigegeben",
      );
    }
    const text = await page.locator("main").innerText();
    for (const name of forbiddenNamesFor(["A", "B"])) expect(text, name).not.toContain(name);
    const html = await page.content();
    for (const name of forbiddenNamesFor(["A", "B"])) expect(html, name).not.toContain(name);
  });
});

test.describe("Forschungs-Fortschritt auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`kein waagerechtes Scrollen, Tippflächen, Barrierefreiheit (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/progress");
      await expect(page.getByTestId("progress-generation-row").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      for (const id of ["progress-depth-4", "progress-depth-10", "progress-choose-person", "progress-to-research"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.height, id).toBeGreaterThanOrEqual(44);
        expect(box.width, id).toBeGreaterThanOrEqual(44);
      }
      const link = page.getByTestId("progress-suggestion").first();
      await link.scrollIntoViewIfNeeded();
      expect((await link.boundingBox())!.height, "Tippfläche eines Vorschlags").toBeGreaterThanOrEqual(44);
      await expectNoA11yViolations(page);
    });
  }
});
