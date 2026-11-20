import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { L, fullName, person } from "../support/mock";

/**
 * Hinweis „mögliche Dubletten“ auf der Personenseite: nur für Benutzer, die
 * beide Einträge bearbeiten dürfen; „Vergleichen“ führt zur Vergleichsseite
 * für genau dieses Paar. Die Mock-Daten haben je ein Paar in Familie A, B, C.
 */
const pairIn = (key: "A" | "B") => L.duplicates.find(([a]) => person(a).familyKeys.includes(key))!;
const [a1, a2] = pairIn("A");
const [b1] = pairIn("B");

test.describe("als Administrator", () => {
  test.use({ storageState: authFile("admin") });

  test("Hinweis mit Name, Lebensdaten und Herkunft; „Vergleichen“ öffnet den Vergleich des Paares", async ({ page }) => {
    await page.goto(`/people/${a1}`);
    const banner = page.getByTestId("duplicate-banner");
    await expect(banner).toContainText("1 mögliche Dublette");
    const item = banner.getByTestId("duplicate-banner-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(fullName(a2));
    await expect(item).toContainText(`* ${person(a2).birthDate!.getUTCFullYear()}`);
    await expect(item).toContainText("von Hand erfasst");
    await expectNoA11yViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    await item.getByRole("link", { name: `Vergleichen mit ${fullName(a2)}` }).click();
    await expect(page).toHaveURL(new RegExp(`/people/merge\\?keep=${a1}&other=${a2}$`));
    await expect(page.getByTestId("merge-view")).toBeVisible();
    await expect(page.getByTestId("merge-keep")).toContainText(fullName(a1));
  });

  test("auch von der anderen Seite des Paares; ohne Kandidaten kein Hinweis", async ({ page }) => {
    await page.goto(`/people/${a2}`);
    await expect(page.getByTestId("duplicate-banner").locator(`a[href="/people/merge?keep=${a2}&other=${a1}"]`)).toHaveCount(1);
    await page.goto(`/people/${L.founders.A}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("duplicate-banner")).toHaveCount(0);
  });
});

test.describe("als Bearbeiter (A bearbeiten, B lesen)", () => {
  test.use({ storageState: authFile("editor") });

  test("Hinweis nur, wo beide Einträge bearbeitbar sind", async ({ page }) => {
    await page.goto(`/people/${a1}`);
    await expect(page.getByTestId("duplicate-banner")).toContainText(fullName(a2));
    // Familie B ist nur lesbar: Seite ja, Hinweis nein.
    await page.goto(`/people/${b1}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(b1));
    await expect(page.getByTestId("duplicate-banner")).toHaveCount(0);
  });
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("kein Hinweis und kein Link zum Vergleich", async ({ page }) => {
    await page.goto(`/people/${a1}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(a1));
    await expect(page.getByTestId("duplicate-banner")).toHaveCount(0);
    expect(await page.content()).not.toContain("/people/merge?keep=");
  });
});
