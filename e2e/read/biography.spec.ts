import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { L, forbiddenNamesFor, fullName, mock } from "../support/mock";

/**
 * Abschnitt „Lebenslauf“ der Personenseite (components/PersonBiography.tsx,
 * lib/biography.ts). Nur lesend. Der Bearbeiter sieht die Familien A und B,
 * der Betrachter nur A.
 */

const founder = L.founders.A;

/** Für den Betrachter sichtbare Person, deren leibliche Eltern beide gesperrt sind. */
const parentsOf = (id: string) =>
  mock.relationships.filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.toPersonId === id).map((r) => r.fromPersonId);
const byId = new Map(mock.persons.map((p) => [p.id, p]));
const withHiddenParents = mock.persons.find(
  (p) =>
    p.familyKeys.includes("A") &&
    p.birthDate &&
    parentsOf(p.id).length === 2 &&
    parentsOf(p.id).every((id) => !byId.get(id)!.familyKeys.includes("A")),
)!;

test.describe("Lebenslauf als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Abschnitt nach dem Kopf, Namen als Links, Hinweis mit Kontexthilfe", async ({ page }) => {
    await page.goto(`/people/${founder}`);
    const section = page.getByTestId("person-biography");
    await expect(section.getByRole("heading", { level: 2, name: "Lebenslauf" })).toBeVisible();
    const text = page.getByTestId("biography-text");
    await expect(text).toContainText(`${fullName(founder)}, genannt „Hein“, wurde`);
    await expect(text).toContainText("Als Todesursache ist „Lungenentzündung“ vermerkt.");
    await expect(page.getByTestId("biography-note")).toContainText("Automatisch aus den erfassten Daten erstellt.");
    await expect(page.getByTestId("biography-note").getByTestId("help-link")).toHaveAttribute("href", "/hilfe/personen#lebenslauf");

    // Lage: nach dem Kopf (Name), vor den Lebensereignissen und der Familie.
    const top = async (loc: import("@playwright/test").Locator) => (await loc.boundingBox())!.y;
    expect(await top(section)).toBeGreaterThan(await top(page.getByRole("heading", { level: 1 })));
    expect(await top(section)).toBeLessThan(await top(page.getByRole("heading", { level: 2, name: "Familie", exact: true })));

    // Partner und Kinder als Links auf ihre Seiten.
    const links = page.getByTestId("biography-person-link");
    expect(await links.count()).toBeGreaterThanOrEqual(2);
    const first = links.first();
    const href = await first.getAttribute("href");
    expect(href).toMatch(/^\/people\/[\w-]+$/);
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    await page.goto(`/people/${founder}`);
    await expectNoA11yViolations(page);
  });

  test("„Text kopieren“ legt den reinen Text in die Zwischenablage", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/people/${founder}`);
    await waitForHydration(page, '[data-testid="biography-copy"]');
    await page.getByTestId("biography-copy").click();
    await expect(page.getByTestId("person-biography").getByRole("status")).toHaveText("Text kopiert.");
    // Windows liefert Zeilenenden als \r\n zurück.
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    const paragraphs = await page.getByTestId("biography-text").locator("p").allTextContents();
    expect(copied).toBe(paragraphs.join("\n\n"));
    expect(copied).not.toContain("<");
  });
});

test.describe("Lebenslauf als eingeschränkter Benutzer", () => {
  test.use({ storageState: authFile("viewer") });

  test("gesperrte Eltern werden weder genannt noch gezählt — auch nicht im Seitenquelltext", async ({ page }) => {
    expect(withHiddenParents, "Mock-Daten: sichtbare Person mit gesperrten Eltern").toBeTruthy();
    await page.goto(`/people/${withHiddenParents.id}`);
    const text = page.getByTestId("biography-text");
    await expect(text).toContainText(`${fullName(withHiddenParents.id)}`);
    await expect(text).not.toContainText(/(Sohn|Tochter|Kind) von/);
    await expect(text).not.toContainText(/von \S+ Kindern/);
    const html = await page.content();
    for (const name of forbiddenNamesFor(["A"])) expect(html, name).not.toContain(name);
    // Links nur auf sichtbare Personen.
    for (const href of await page.getByTestId("biography-person-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
      const id = href!.replace("/people/", "");
      expect(byId.get(id)!.familyKeys).toContain("A");
    }
  });
});

test.describe("Lebenslauf auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("390 px: kein waagerechtes Scrollen, Knopf erreichbar", async ({ page }) => {
    await page.goto(`/people/${founder}`);
    const section = page.getByTestId("person-biography");
    await expect(section).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const box = (await page.getByTestId("biography-copy").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(36);
  });
});
