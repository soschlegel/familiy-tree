import { test, expect, authFile } from "../support/fixtures";
import { familyName, mock } from "../support/mock";

/**
 * Familienzuordnung auf der Personenseite: Ein Bearbeiter kann die letzte
 * Familie, in der er bearbeiten darf, nicht abwählen — sonst wäre die Person
 * für ihn danach gesperrt („nicht freigegeben“, nicht mehr zu löschen).
 * Nur lesend: Es wird nichts gespeichert.
 */
const onlyA = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "A")!;

test.describe("als Bearbeiter (Familie A bearbeiten, B lesen)", () => {
  test.use({ storageState: authFile("editor") });

  test("letzte Familie mit Bearbeitungsrecht ist gesperrt und erklärt", async ({ page }) => {
    await page.goto(`/people/${onlyA.id}`);
    const chip = page.getByRole("button", { name: familyName("A"), exact: false }).and(page.locator("[aria-pressed=true]"));
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveAttribute("aria-describedby", "person-families-last");
    await expect(page.getByTestId("person-families-last")).toBeVisible();
  });

  test("Dienst lehnt das Abwählen auch direkt ab (API)", async ({ page }) => {
    await page.goto(`/people/${onlyA.id}`);
    const res = await page.request.put(`/api/persons/${onlyA.id}/families`, { data: { familyIds: [] } });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("Bearbeitungsrechte");
  });
});

test.describe("als Administrator", () => {
  test.use({ storageState: authFile("admin") });

  test("keine Sperre — Administratoren dürfen eine Person ohne Familie lassen", async ({ page }) => {
    await page.goto(`/people/${onlyA.id}`);
    const chip = page.getByRole("button", { name: familyName("A"), exact: false }).and(page.locator("[aria-pressed=true]"));
    await expect(chip).toBeEnabled();
    await expect(page.getByTestId("person-families-last")).toHaveCount(0);
  });
});
