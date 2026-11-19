import { test, expect, authFile, waitForTree } from "../support/fixtures";
import { L, fullName } from "../support/mock";

/**
 * Ungenaue Daten aus den Mock-Daten erscheinen überall gleich: Personenseite,
 * Personenliste und Baumkarte.
 */
test.use({ storageState: authFile("admin") });

const CASES = [
  // Otto Becker: „um 1858“ geboren
  { id: L.impreciseDates.about, birth: /^um 1858( in .+)?$/, span: "um 1858 – 1932" },
  // Margarethe Becker: nur Jahr, gestorben „vor 1955“
  { id: L.impreciseDates.before, birth: /^1862( in .+)?$/, death: /^vor 1955( in .+)?$/, span: "1862 – vor 1955" },
  // Heinrich Hoffmann: nur Monat
  { id: L.impreciseDates.monthOnly, birth: /^September 1857( in .+)?$/, span: "1857 – 1938" },
] as const;

for (const c of CASES) {
  test(`${fullName(c.id)}: Datum auf Personenseite, Liste und Baumkarte`, async ({ page }) => {
    await page.goto(`/people/${c.id}`);
    await expect(page.getByTestId("person-birth")).toHaveText(c.birth);
    if ("death" in c) await expect(page.getByTestId("person-death")).toHaveText(c.death);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header).toContainText(c.span);

    await page.goto(`/people?q=${encodeURIComponent(fullName(c.id))}`);
    const item = page.getByTestId("people-list").getByRole("listitem").filter({ hasText: fullName(c.id) }).first();
    await expect(item).toContainText(c.span);

    await page.goto(`/tree?focus=${c.id}`);
    await waitForTree(page);
    const card = page.locator(`[data-testid="tree-person"][data-person-id="${c.id}"]`);
    await expect(card).toContainText(c.span);
  });
}

test("ungenaue Hochzeit: nur Jahr in der Beziehungsliste", async ({ page }) => {
  await page.goto(`/people/${L.founders.A}`);
  const partners = page.getByTestId("relatives-partners");
  await expect(partners).toContainText(/verheiratet seit (um )?\d{4}(?![.\d])/);
});
