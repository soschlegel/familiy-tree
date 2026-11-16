import { test, expect, authFile } from "../support/fixtures";
import { L, fullName, mock, visibleFor } from "../support/mock";

test.describe("Recherche als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Statistik", async ({ page }) => {
    const parentChild = mock.relationships.filter((r) => r.type === "PARENT_OF").length;
    const partners = mock.relationships.length - parentChild;
    await page.goto("/research");
    const stats = page.getByTestId("research-stats");
    await expect(stats).toContainText(`Personen${mock.persons.length}`);
    await expect(stats).toContainText(`${parentChild} Eltern-Kind · ${partners} Partnerschaften`);
    await expect(stats).toContainText(String(mock.relationships.length));
    await expect(stats).toContainText(/Zeitraum\s*\d{4} – \d{4}/);
    await expect(page.getByRole("heading", { name: "Personen je Familie" })).toBeVisible();
  });

  test("Datenlücken einschließlich „Angaben ohne Beleg“", async ({ page }) => {
    await page.goto("/research");
    const gaps = page.getByTestId("research-gaps");
    for (const title of ["Ohne Geburtsdatum", "Ohne Familie", "Angaben ohne Beleg", "Vermutlich verstorben, ohne Sterbedatum"]) {
      await expect(gaps.getByText(title, { exact: true })).toBeVisible();
    }
    const group = (title: string) => gaps.locator("details").filter({ has: page.getByText(title, { exact: true }) });

    // Ohne Familie: genau die drei Personen ohne Zuordnung.
    await expect(group("Ohne Familie").locator(".badge-accent")).toHaveText(String(L.noFamily.length));
    await group("Ohne Familie").locator("summary").click();
    for (const id of L.noFamily) {
      await expect(group("Ohne Familie").getByRole("link", { name: new RegExp(fullName(id)) })).toBeVisible();
    }

    await group("Ohne Geburtsdatum").locator("summary").click();
    for (const id of L.missingBirthDate) {
      await expect(group("Ohne Geburtsdatum").getByRole("link", { name: new RegExp(fullName(id)) })).toBeVisible();
    }

    // Angaben ohne Beleg: eine Person mit belegter Geburt fehlt dort.
    const unsourced = group("Angaben ohne Beleg");
    await unsourced.locator("summary").click();
    await expect(unsourced.getByRole("link").first()).toBeVisible();
    const count = Number(await unsourced.locator(".badge-accent").innerText());
    expect(count).toBeGreaterThan(10);
    await unsourced.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/people\/mock-p-\d{3}$/);
  });

  test("mögliche Dubletten", async ({ page }) => {
    await page.goto("/research");
    const dup = page.getByTestId("research-duplicates");
    for (const [a, b] of L.duplicates) {
      const pair = dup.getByRole("listitem").filter({ has: page.locator(`a[href="/people/${a}"]`) }).filter({
        has: page.locator(`a[href="/people/${b}"]`),
      });
      await expect(pair, `${fullName(a)} / ${fullName(b)}`).toHaveCount(1);
      await expect(pair).toContainText("%");
    }
  });
});

test.describe("Recherche als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("zählt nur die eigene Familie", async ({ page }) => {
    await page.goto("/research");
    await expect(page.getByTestId("research-stats")).toContainText(`Personen${visibleFor(["A"]).length}`);
    await expect(page.getByTestId("research-gaps").getByText("Ohne Familie", { exact: true })).toHaveCount(0);
    // Dubletten nur innerhalb des Sichtbaren.
    const dup = page.getByTestId("research-duplicates");
    for (const id of L.noFamily) await expect(dup.locator(`a[href="/people/${id}"]`)).toHaveCount(0);
  });
});
