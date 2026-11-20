import { test, expect, authFile, expectNoA11yViolations } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, uniq, type CreatedPerson } from "../support/api";

/**
 * Hinweis „mögliche Dubletten“ auf der Personenseite mit eigenen Datensätzen
 * (als Bearbeiter): mehrere Kandidaten werden begrenzt, „kein Duplikat“ nimmt
 * ein Paar heraus, der Hinweis führt nie selbst zusammen. Alle Datensätze
 * heißen „E2E …“ und werden entfernt.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const surname = `Bannertest${uniq().replace(/[^a-z]/g, "")}`;
const created: string[] = [];

async function person(data: Record<string, unknown>): Promise<CreatedPerson> {
  const api = await apiAs("editor");
  const p = await createPerson(api, { familyName: surname, gender: "FEMALE", ...data });
  await api.dispose();
  created.push(p.id);
  return p;
}

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  await api.dispose();
});

test("ein sicheres Paar: Hinweis, Vergleich; „kein Duplikat“ lässt ihn verschwinden", async ({ page }) => {
  const same = { givenName: "E2E Selma", birthDate: "1850-03-12", deathDate: "1920-07-01" };
  const a = await person(same);
  const b = await person(same);

  await page.goto(`/people/${a.id}`);
  const banner = page.getByTestId("duplicate-banner");
  await expect(banner).toContainText("1 mögliche Dublette");
  const item = banner.getByTestId("duplicate-banner-item");
  await expect(item).toHaveAttribute("data-confidence", "high");
  await expect(item).toContainText(`E2E Selma ${surname} (1850 – 1920, von Hand erfasst)`);
  await expect(item).toContainText("sicher");

  await item.getByTestId("duplicate-banner-compare").click();
  await expect(page).toHaveURL(new RegExp(`/people/merge\\?keep=${a.id}&other=${b.id}$`));
  await expect(page.getByTestId("merge-view")).toBeVisible();
  // Nur der Vergleich ist offen — beide Einträge gibt es noch.
  expect((await page.request.get(`/api/persons/${b.id}`)).status()).toBe(200);

  const res = await page.request.post("/api/duplicates/dismiss", { data: { a: a.id, b: b.id } });
  expect(res.status()).toBe(200);
  for (const id of [a.id, b.id]) {
    await page.goto(`/people/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Selma");
    await expect(page.getByTestId("duplicate-banner")).toHaveCount(0);
  }
});

test("viele Kandidaten: die ersten drei, dann Verweis auf die Dublettenliste", async ({ page }) => {
  const same = { givenName: "E2E Thea", birthDate: "1861-05-04", deathDate: "1930-02-11" };
  const a = await person(same);
  for (let i = 0; i < 4; i++) await person(same);

  await page.goto(`/people/${a.id}`);
  const banner = page.getByTestId("duplicate-banner");
  await expect(banner).toContainText("4 mögliche Dubletten");
  await expect(banner.getByTestId("duplicate-banner-item")).toHaveCount(3);
  await expect(banner).toContainText("und 1 weitere");
  await expectNoA11yViolations(page);
  await banner.getByRole("link", { name: "Mögliche Dubletten" }).click();
  await expect(page).toHaveURL(/\/research\/duplicates$/);
  await expect(page.getByRole("heading", { level: 1, name: "Mögliche Dubletten" })).toBeVisible();
});
