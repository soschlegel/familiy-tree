import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { apiAs } from "../support/api";
import { L, forbiddenNamesFor, mock } from "../support/mock";

/**
 * Abschnitt „Wurzeln“ der Personenseite (components/PersonRoots.tsx,
 * lib/services/roots.ts). Nur lesend; die Ortszuordnung kommt aus dem
 * Mock-Seed. Die eigene Person des Bearbeiters hat alle vier Großeltern,
 * die mütterlichen gehören nur zu Familie D und sind für ihn gesperrt.
 */

type RootsApi = {
  generations: number;
  level: string;
  slots: number;
  filledSlots: number;
  parentCount: number;
  slices: { key: string; kind: string; label: string; percent: number }[];
};

const legendRow = (page: import("@playwright/test").Page, label: string) =>
  page.getByTestId("roots-legend").getByRole("row").filter({ hasText: label });

/** Eine Person ohne leibliche Eltern (Stammvater/-mutter) in Familie A. */
const withBioParents = new Set(
  mock.relationships.filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL").map((r) => r.toPersonId),
);
const founder = mock.persons.find((p) => p.familyKeys.includes("A") && !withBioParents.has(p.id))!;

test.describe("Wurzeln als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Ring mit Legende, gesperrte Vorfahren als „Nicht freigegeben“, umschalten", async ({ page }) => {
    await page.goto(`/people/${L.selfEditor}`);
    const section = page.getByTestId("person-roots");
    await expect(section.getByRole("heading", { level: 2, name: /Wurzeln/ })).toBeVisible();
    await expect(section.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/karte#wurzeln-auf-der-personenseite");
    await expect(page.getByTestId("roots-chart")).toHaveAttribute("aria-label", /Wurzeln nach Land.*Deutschland: 25/);

    await expect(legendRow(page, "Deutschland")).toContainText("25 %");
    await expect(legendRow(page, "Nicht freigegeben")).toContainText("50 %");
    await expect(legendRow(page, "Unbekannt")).toContainText("25 %");
    await expect(page.getByTestId("roots-summary")).toContainText("bis zur 4. Generation (Ururgroßeltern); 4 von 16 Linien reichen");

    // Nichts von gesperrten Personen im Abschnitt.
    const text = (await section.textContent()) ?? "";
    for (const name of forbiddenNamesFor(["A", "B"])) expect(text).not.toContain(name);

    await waitForHydration(page, '[data-testid="roots-level-region"]');
    await page.getByTestId("roots-level-region").click();
    await expect(page.getByTestId("roots-level-region")).toHaveAttribute("aria-pressed", "true");
    await expect(legendRow(page, "Niedersachsen, Deutschland")).toBeVisible();
    await expect(page.getByTestId("roots-chart")).toHaveAttribute("aria-label", /Wurzeln nach Region/);

    await page.getByTestId("roots-generations").selectOption("2");
    await expect(page.getByTestId("roots-summary")).toContainText("bis zur 2. Generation (Großeltern); 2 von 4 Linien reichen");
    await expect(legendRow(page, "Nicht freigegeben")).toContainText("50 %");

    await expectNoA11yViolations(page);
  });

  test("Person ohne leibliche Eltern: kein Abschnitt", async ({ page }) => {
    await page.goto(`/people/${founder.id}`);
    await expect(page.getByTestId("relatives-parents")).toBeVisible();
    await expect(page.getByTestId("person-roots")).toHaveCount(0);
  });

  test("Schnittstelle: nur Gebiete und Anteile, Rechte und Eingaben geprüft", async () => {
    const editor = await apiAs("editor");
    const res = await editor.get(`/api/persons/${L.selfEditor}/roots?generations=3&level=region`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as RootsApi;
    expect(body).toMatchObject({ generations: 3, level: "region", slots: 8, parentCount: 2 });
    expect(body.slices.reduce((s, x) => s + x.percent, 0)).toBe(100);
    const raw = JSON.stringify(body);
    expect(raw.match(/mock-p-\d+/g) ?? []).toEqual([L.selfEditor]);

    expect((await editor.get(`/api/persons/${L.selfEditor}/roots?generations=12`)).status()).toBe(400);
    expect((await editor.get(`/api/persons/${L.selfEditor}/roots?level=stadt`)).status()).toBe(400);
    await editor.dispose();

    const nofamily = await apiAs("nofamily");
    expect((await nofamily.get(`/api/persons/${L.selfEditor}/roots`)).status()).toBe(404);
    await nofamily.dispose();
  });
});

test.describe("Wurzeln auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("kein waagerechtes Scrollen, Umschalten per Tippen", async ({ page }) => {
    await page.goto(`/people/${L.selfEditor}`);
    const section = page.getByTestId("person-roots");
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("roots-chart")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await waitForHydration(page, '[data-testid="roots-level-region"]');
    await page.getByTestId("roots-level-region").tap();
    await expect(legendRow(page, "Niedersachsen, Deutschland")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
