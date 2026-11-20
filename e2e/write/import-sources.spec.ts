import { test, expect, authFile, expectNoA11yViolations } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, deleteSource, uniq } from "../support/api";

/**
 * Quellen aus Importen: Online-Stammbaum mit Anbieter und Beleg-Link auf der
 * Quellenseite (gruppiert) und auf der Personenseite; nur http/https-Adressen.
 * Datensätze heißen „E2E …“ und werden entfernt.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
let personId = "";
let sourceId = "";
const url = `https://www.myheritage.de/research/collection-1/e2e?itemId=${tag}&action=showRecord`;

test.beforeAll(async () => {
  const api = await apiAs("admin");
  personId = (await createPerson(api, { givenName: `E2E Quelle${tag}`, familyName: "Testfall", familyIds: ["mock-family-a"] })).id;
  const s = await api.post("/api/sources", { data: { title: `E2E Stammbäume ${tag}`, kind: "ONLINE_TREE", provider: "MyHeritage", url: "https://www.myheritage.de" } });
  expect(s.status(), await s.text()).toBe(201);
  sourceId = (await s.json()).id;
  const bad = await api.post("/api/citations", { data: { sourceId, personId, fact: "OTHER", url: "javascript:alert(1)" } });
  expect(bad.status()).toBe(400);
  const c = await api.post("/api/citations", { data: { sourceId, personId, fact: "OTHER", url } });
  expect(c.status(), await c.text()).toBe(201);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  await deletePerson(api, personId);
  await deleteSource(api, sourceId);
  await api.dispose();
});

test("Quellenseite: Art, Anbieter, Hinweis, Belege je Person mit Link", async ({ page }) => {
  await page.goto(`/sources/${sourceId}`);
  await expect(page.getByTestId("source-badges")).toContainText("Online-Stammbaum");
  await expect(page.getByTestId("source-badges")).toContainText("MyHeritage");
  await expect(page.getByTestId("source-derived-hint")).toContainText("keine unabhängige Quelle");
  const group = page.getByTestId("source-citation-group").filter({ hasText: `E2E Quelle${tag}` });
  await expect(group).toHaveCount(1);
  const link = group.getByTestId("citation-link");
  await expect(link).toHaveAttribute("href", url);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toContainText("www.myheritage.de");
  await expect(group).toContainText("Allgemein");
  await expect(group).toContainText("nicht bewertet");
  await expectNoA11yViolations(page);
});

test("Personenseite: Beleg mit Link und Hinweis statt Verlässlichkeit", async ({ page }) => {
  await page.goto(`/people/${personId}`);
  const row = page.getByTestId("citation-row").filter({ hasText: `E2E Stammbäume ${tag}` });
  await expect(row.getByTestId("citation-link")).toHaveAttribute("href", url);
  await expect(row).toContainText("aus einem Online-Stammbaum — keine unabhängige Quelle");
});
