import { test, expect, authFile } from "../support/fixtures";
import { mock } from "../support/mock";

/** Quellenliste: Seitenzahl jenseits des Endes. */
test.use({ storageState: authFile("admin") });

const PAGE = 40;

test("Seite jenseits des Endes zeigt die letzte Seite mit Einträgen", async ({ page }) => {
  const total = mock.sources.length;
  expect(total).toBeGreaterThan(0);
  const onLast = total - (Math.ceil(total / PAGE) - 1) * PAGE;

  await page.goto("/sources?page=99");
  await expect(page.getByTestId("sources-count")).toHaveText(`${total} Quellen`);
  await expect(page.getByTestId("sources-list").getByRole("listitem")).toHaveCount(onLast);
  await expect(page.getByText("Keine Quelle gefunden.")).toHaveCount(0);
});
