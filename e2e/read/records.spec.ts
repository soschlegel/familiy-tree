import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { FAMILY, familyName, forbiddenNamesFor, mock, visibleFor } from "../support/mock";

/**
 * Seite „Rekorde“ (app/records/page.tsx, lib/services/records.ts): Karten
 * mit verlinkten Personen, Verweise von Statistik und Startseite,
 * Familienfilter in der Adresse, eingeschränkte Benutzer (nur sichtbare
 * Personen), Telefonbreite in beiden Farbschemata. Nur lesend.
 */

const CARDS = [
  "oldestDeceased",
  "oldestLiving",
  "youngest",
  "earliest",
  "longestPartnership",
  "mostChildren",
  "mostDescendants",
  "longestLine",
  "largestSiblingGroup",
  "youngestParent",
  "oldestParent",
  "partnerAgeGap",
  "youngestCouple",
  "oldestCouple",
];

const visibleIds = (keys: string[]) => new Set(visibleFor(keys).map((p) => p.id));

/** Kennungen aller verlinkten Personen der Seite. */
async function linkedIds(page: import("@playwright/test").Page): Promise<string[]> {
  const hrefs = await page.getByTestId("records-person").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((h) => h.replace(/^\/people\//, ""));
}

test.describe("Rekorde als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Einstieg von der Startseite, Karten mit Zählregel und verlinkten Personen", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-records").click();
    await expect(page).toHaveURL(/\/records$/);
    await expect(page.getByRole("heading", { level: 1, name: "Rekorde" })).toBeVisible();
    await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/statistik#rekorde");

    for (const key of CARDS) {
      const card = page.getByTestId(`records-${key}`);
      await expect(card.getByRole("heading", { level: 2 })).toBeVisible();
      await expect(card.getByTestId("stats-basis")).toContainText("Grundlage:");
    }
    // Die Mock-Daten füllen die wichtigsten Karten mit Bestwert und Namen.
    for (const key of ["oldestDeceased", "youngest", "earliest", "mostChildren", "mostDescendants", "longestLine"]) {
      const card = page.getByTestId(`records-${key}`);
      await expect(card.getByTestId("records-best-value")).toBeVisible();
      await expect(card.getByTestId("records-best").getByTestId("records-person").first()).toBeVisible();
    }
    await expect(page.getByTestId("records-oldestDeceased").getByTestId("records-best-value")).toHaveText(/^(etwa )?\d+ Jahre?$/);
    await expect(page.getByTestId("records-longestLine").getByTestId("records-best-value")).toHaveText(/^\d+ Generationen$/);
    await expect(page.getByTestId("records-names-table").getByTestId("records-names-row").first()).toBeVisible();

    // Jeder Name führt zur Personenseite einer bekannten Person.
    const all = new Set(mock.persons.map((p) => p.id));
    const ids = await linkedIds(page);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(all.has(id), id).toBe(true);
    const first = page.getByTestId("records-mostDescendants").getByTestId("records-person").first();
    const href = await first.getAttribute("href");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    await page.goto("/records");
    await expectNoA11yViolations(page);
  });

  test("Verweise zwischen Statistik und Rekorden behalten die Familie; Filter in der Adresse", async ({ page }) => {
    await page.goto(`/statistics?family=${FAMILY.A}`);
    await page.getByTestId("stats-to-records").click();
    await expect(page).toHaveURL(new RegExp(`/records\\?family=${FAMILY.A}$`));
    await expect(page.locator("#records-family")).toHaveValue(FAMILY.A);
    const inA = visibleIds(["A"]);
    for (const id of await linkedIds(page)) expect(inA.has(id), id).toBe(true);

    await waitForHydration(page, "#records-family");
    await page.locator("#records-family").selectOption("");
    await expect(page).toHaveURL(/\/records\?family=$|\/records$/);
    await page.getByTestId("records-to-statistics").click();
    await expect(page).toHaveURL(/\/statistics$/);
  });
});

test.describe("Rekorde mit eingeschränkten Rechten", () => {
  test("Betrachter (nur Familie A): nur sichtbare Personen, kein Filter, fremde Familie gibt nichts frei", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await page.goto(`/records?family=${FAMILY.D}`);
    await expect(page.getByRole("heading", { level: 1, name: "Rekorde" })).toBeVisible();
    await expect(page.getByTestId("records-filter")).toHaveCount(0);
    const visible = visibleIds(["A"]);
    const ids = await linkedIds(page);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(visible.has(id), id).toBe(true);
    const text = await page.locator("main").innerText();
    for (const name of forbiddenNamesFor(["A"])) expect(text, name).not.toContain(name);
    await expect(page.locator("main")).not.toContainText(familyName("D"));
  });

  test("ohne Familie: Hinweis statt Rekorden", async ({ loginAs }) => {
    const { page } = await loginAs("nofamily");
    await page.goto("/records");
    await expect(page.getByTestId("records-nothing")).toContainText("Noch keine Rekorde.");
    await expect(page.getByTestId("records-person")).toHaveCount(0);
  });
});

test.describe("Rekorde auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`kein waagerechtes Scrollen, Tippflächen, Barrierefreiheit (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/records");
      await expect(page.getByTestId("records-oldestDeceased")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const link = page.getByTestId("records-person").first();
      await link.scrollIntoViewIfNeeded();
      expect((await link.boundingBox())!.height, "Tippfläche eines Namens").toBeGreaterThanOrEqual(44);
      expect((await page.getByTestId("records-to-statistics").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoA11yViolations(page);
    });
  }
});
