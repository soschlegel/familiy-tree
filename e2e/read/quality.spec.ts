import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForTree,
} from "../support/fixtures";
import { L, mock } from "../support/mock";

/**
 * Querschnitt: Barrierefreiheit (axe), keine waagerechte Scrollleiste auf
 * dem Telefon und — über die Fixture in support/fixtures.ts — keine
 * Konsolen- oder Seitenfehler auf allen besuchten Seiten.
 */
test.use({ storageState: authFile("admin") });

const PAGES = [
  "/tree",
  "/tree?view=generations",
  "/tree?view=timeline",
  "/people",
  `/people/${L.founders.A}`,
  `/people/${L.founders.A}/edit`,
  `/people/${L.genealogy.namesPerson}`,
  `/people/${mock.events.find((e) => e.id === L.genealogy.rangeEvent)!.personId}`,
  "/people?q=Wagener&place=Bremen",
  "/people/new",
  "/sources",
  `/sources/${L.sources.churchBookA}`,
  `/sources/${L.sources.crossFamily}/edit`,
  "/sources/new",
  "/research",
  "/admin/data",
  "/ai-access",
  "/admin/users",
  "/admin/families",
  "/admin/changes",
];

async function settle(page: import("@playwright/test").Page, url: string) {
  await page.goto(url);
  if (url.startsWith("/tree")) await waitForTree(page);
  else await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("Barrierefreiheit (Desktop)", () => {
  for (const url of PAGES) {
    test(`axe: ${url}`, async ({ page }) => {
      await settle(page, url);
      await expectNoA11yViolations(page);
    });
  }

  test("axe: /login", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/login?error=AccessDenied");
    await expectNoA11yViolations(page);
    await context.close();
  });

  test("axe: offene Formulare für Ereignis, Namen und Beziehung", async ({ page }) => {
    await settle(page, `/people/${L.founders.A}`);
    await page.getByTestId("person-events").getByRole("button", { name: "Ereignis hinzufügen" }).click();
    await page.getByTestId("event-form").getByLabel("Datum").fill("Palmsonntag");
    await expect(page.getByTestId("date-as-phrase")).toBeVisible();
    await page.getByTestId("person-names").getByRole("button", { name: "Namen hinzufügen" }).click();
    await page.getByTestId("relation-row").filter({ hasText: "Partner" }).first().getByRole("button", { name: "ändern" }).click();
    await expectNoA11yViolations(page);
  });

  test("axe: Betrachter auf Personenseite mit Platzhaltern", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await settle(page, `/people/${L.crossMarriedIntoA}`);
    await expectNoA11yViolations(page);
  });
});

test.describe("Telefon (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const url of PAGES) {
    test(`keine waagerechte Scrollleiste: ${url}`, async ({ page }) => {
      await settle(page, url);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("axe: Personenseite und Baum auf dem Telefon", async ({ page }) => {
    await settle(page, `/people/${L.founders.A}`);
    await expectNoA11yViolations(page);
    // Offenes Ereignisformular passt auf den Bildschirm.
    await page.getByTestId("person-events").getByRole("button", { name: "Ereignis hinzufügen" }).click();
    await expect(page.getByTestId("event-form")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
    await settle(page, "/tree");
    await expectNoA11yViolations(page);
  });

  test("Baum: Werkzeugleiste lässt die Fläche im sichtbaren Bereich", async ({ page }) => {
    for (const url of ["/tree", "/tree?view=generations"]) {
      await settle(page, url);
      const box = (await page.getByTestId("family-tree").boundingBox())!;
      const viewport = page.viewportSize()!;
      // Die Baumfläche beginnt in der oberen Bildschirmhälfte und endet
      // innerhalb des Bildschirms — sonst muss man erst die Seite scrollen,
      // um den Baum zu sehen bzw. zu verschieben.
      expect(box.y, `${url}: Oberkante der Baumfläche`).toBeLessThan(viewport.height * 0.4);
      expect(box.y + box.height, `${url}: Unterkante der Baumfläche`).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.height, `${url}: Höhe der Baumfläche`).toBeGreaterThan(viewport.height * 0.55);
    }
  });
});
