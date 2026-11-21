import type { Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForTree,
} from "../support/fixtures";
import { L, fullName, mock, person, visibleFor } from "../support/mock";

/**
 * Bezugsperson und Ahnenlinien (README, „Bezugsperson“). Nur lesend: der
 * Bearbeiter hat in den Mock-Daten eine eigene Person (L.selfEditor);
 * vorübergehende Bezugspersonen und der Linien-Schalter leben nur in Cookies
 * des jeweiligen Testkontexts.
 */
const SELF = L.selfEditor;

const bioParents = (id: string) =>
  mock.relationships
    .filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.toPersonId === id)
    .map((r) => r.fromPersonId);
const parentBySex = (id: string, sex: "MALE" | "FEMALE") => bioParents(id).find((p) => person(p).gender === sex)!;

const FATHER = parentBySex(SELF, "MALE");
const MOTHER = parentBySex(SELF, "FEMALE");
const GRANDFATHER = parentBySex(FATHER, "MALE");
/** Bruder des Vaters (gleiche leibliche Eltern). */
const UNCLE = mock.persons.find(
  (p) =>
    p.id !== FATHER &&
    p.gender === "MALE" &&
    bioParents(p.id).length === 2 &&
    bioParents(p.id).every((x) => bioParents(FATHER).includes(x)),
)!.id;

const card = (page: Page, id: string) => page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`);

test.describe("Bezugsperson des Bearbeiters", () => {
  test.use({ storageState: authFile("editor") });

  test("eigene Person in der Mitte, Verwandtschaftsgrad an den Karten, Platzhalter ohne Angabe", async ({ page }) => {
    await page.goto(`/tree?focus=${SELF}&up=4`);
    await waitForTree(page);
    await expect(card(page, SELF)).toHaveAttribute("data-reference", "true");
    await expect(card(page, SELF).getByTestId("tree-kinship")).toHaveText("ich · Bezugsperson");
    await expect(card(page, FATHER)).toHaveAttribute("data-kinship", "Vater");
    await expect(card(page, MOTHER)).toHaveAttribute("data-kinship", "Mutter");
    await expect(card(page, GRANDFATHER)).toHaveAttribute("data-kinship", "Großvater väterlicherseits");
    await expect(card(page, GRANDFATHER).getByTestId("tree-kinship")).toHaveText("Großvater väterlicherseits");
    // Screenreader erfahren es ebenfalls.
    await expect(card(page, GRANDFATHER).getByTestId("tree-person-main")).toContainText(
      `für ${fullName(SELF)}: Großvater väterlicherseits`,
    );

    // Die Großeltern mütterlicherseits gehören nur zu Familie D: Platzhalter,
    // ohne jede Angabe zur Verwandtschaft.
    const restricted = page.locator('[data-testid="tree-person"][data-restricted="true"]');
    expect(await restricted.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-restricted="true"] [data-testid="tree-kinship"]')).toHaveCount(0);
    await expect(page.locator('[data-restricted="true"][data-kinship]')).toHaveCount(0);

    const chip = page.getByTestId("reference-chip");
    await expect(chip).toHaveAttribute("data-source", "self");
    await expect(chip).toContainText(fullName(SELF));
  });

  test("Linien: Kurzzeichen und Tönung, Legende mit den Großeltern, gesperrte Linie „nicht erfasst“", async ({ page }) => {
    await page.goto(`/tree?focus=${SELF}&up=4`);
    await waitForTree(page);
    await expect(page.getByTestId("tree-line-codes")).toHaveCount(0);

    await page.getByTestId("tree-lines-toggle").check();
    await expect(card(page, FATHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "FF FM");
    await expect(card(page, FATHER).getByTestId("tree-line-codes")).toHaveText("VVVM");
    await expect(card(page, GRANDFATHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "FF");
    await expect(card(page, MOTHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "MF MM");
    // Außerhalb der Ahnenlinien (die Bezugsperson selbst, Geschwister …) neutral.
    await expect(card(page, SELF).getByTestId("tree-line-codes")).toHaveCount(0);
    await expect(page.locator('[data-restricted="true"] [data-testid="tree-line-codes"]')).toHaveCount(0);

    const legend = page.getByTestId("tree-line-legend");
    await expect(legend).toBeVisible();
    await expect(legend.locator('[data-line="FF"]')).toContainText(fullName(GRANDFATHER));
    await expect(legend.locator('[data-line="MF"]')).toContainText("nicht erfasst");
    await expect(legend.locator('[data-line="MM"]')).toContainText("nicht erfasst");

    await expectNoA11yViolations(page);
    // Getönte Karten auch im dunklen Farbschema lesbar.
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light" });

    // Der Schalter bleibt beim Neuladen (Cookie).
    await page.reload();
    await waitForTree(page);
    await expect(page.getByTestId("tree-lines-toggle")).toBeChecked();
    await expect(card(page, FATHER).getByTestId("tree-line-codes")).toBeVisible();
  });

  test("vorübergehende Bezugsperson: „Sicht von“, bleibt beim Weiterklicken, „zurück zu mir“", async ({ page }) => {
    await page.goto(`/tree?bezug=${UNCLE}`);
    await waitForTree(page);
    const chip = page.getByTestId("reference-chip");
    await expect(chip).toHaveAttribute("data-source", "param");
    await expect(page.getByTestId("reference-chip-name")).toHaveText(fullName(UNCLE));
    // Ohne `focus` steht die Bezugsperson im Mittelpunkt.
    await expect(page.getByTestId("family-tree")).toHaveAttribute("data-focus-id", UNCLE);
    await expect(card(page, UNCLE)).toHaveAttribute("data-reference", "true");
    await expect(card(page, FATHER)).toHaveAttribute("data-kinship", "Bruder");

    // Gemerkt: die Personenseite ohne `bezug` bleibt bei dieser Sicht.
    await page.goto(`/people/${GRANDFATHER}`);
    await expect(page.getByTestId("person-reference-term")).toContainText(`Für ${fullName(UNCLE)}`);
    await expect(page.getByTestId("person-reference-kinship")).toHaveText("Vater");
    await expect(page.getByTestId("reference-chip")).toHaveAttribute("data-source", "cookie");

    await page.getByTestId("reference-chip-reset").click();
    await expect(page.getByTestId("person-reference-term")).toContainText(`dich (${fullName(SELF)})`);
    await expect(page.getByTestId("person-reference-kinship")).toHaveText("Großvater väterlicherseits");
    await expect(page.getByTestId("reference-chip")).toHaveCount(0);

    await page.goto("/tree");
    await waitForTree(page);
    await expect(page.getByTestId("reference-chip")).toHaveAttribute("data-source", "self");
  });

  test("Personenseite: Verwandtschaft, „Baum aus dieser Sicht“, „Das bin ich“ nur angeboten", async ({ page }) => {
    await page.goto(`/people/${SELF}`);
    await expect(page.getByTestId("person-reference-self")).toContainText("das bist du");
    await expect(page.getByTestId("self-person-clear")).toBeVisible();
    await expect(page.getByTestId("person-reference-view")).toHaveCount(0);

    await page.goto(`/people/${GRANDFATHER}`);
    await expect(page.getByTestId("person-reference-kinship")).toHaveText("Großvater väterlicherseits");
    await expect(page.getByTestId("self-person-set")).toBeVisible();
    await page.getByTestId("person-reference-view").click();
    await waitForTree(page);
    await expect(page.getByTestId("family-tree")).toHaveAttribute("data-focus-id", GRANDFATHER);
    await expect(page.getByTestId("reference-chip-name")).toHaveText(fullName(GRANDFATHER));
    await expect(card(page, FATHER)).toHaveAttribute("data-kinship", "Sohn");
  });

  test("Generationen und Zeitstrahl: Linien im ganzen Baum", async ({ page }) => {
    // Der ganze Baum zeichnet nur, was im Bild ist — auf den Großvater zentrieren.
    await page.goto(`/tree?view=generations&focus=${GRANDFATHER}`);
    await waitForTree(page);
    await page.getByTestId("tree-lines-toggle").setChecked(true);
    await expect(card(page, GRANDFATHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "FF");
    await expect(page.getByTestId("tree-line-legend")).toBeVisible();

    await page.getByTestId("tree-view-timeline").click();
    await expect(page.getByTestId("family-tree")).toHaveAttribute("data-view", "timeline");
    await expect(card(page, GRANDFATHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "FF");
    await expect(card(page, GRANDFATHER)).toHaveAttribute("data-kinship", "Großvater väterlicherseits");
  });
});

test.describe("Bezugsperson: keine Durchsickerung (Betrachter Familie A)", () => {
  test.use({ storageState: authFile("viewer") });

  test("eine gesperrte Person lässt sich nicht als Bezugsperson setzen", async ({ page }) => {
    const hidden = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!.id;
    await page.goto(`/tree?bezug=${hidden}`);
    await waitForTree(page);
    await expect(page.getByTestId("reference-chip")).toHaveCount(0);
    await expect(page.getByTestId("tree-kinship")).toHaveCount(0);
    await expect(page.getByTestId("tree-lines-toggle")).toHaveCount(0);
  });

  test("Verwandtschaft und Linien nur über sichtbare Personen", async ({ page }) => {
    const visible = new Set(visibleFor(["A"]).map((p) => p.id));
    expect(visible.has(SELF)).toBe(true);
    await page.goto(`/tree?focus=${SELF}&up=4&bezug=${SELF}`);
    await waitForTree(page);
    await page.getByTestId("tree-lines-toggle").check();

    const withKinship = await page.locator("[data-testid=tree-person][data-kinship]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-person-id")!),
    );
    expect(withKinship.length).toBeGreaterThan(3);
    for (const id of withKinship) expect(visible.has(id), `${id} ist für den Betrachter sichtbar`).toBe(true);
    await expect(page.locator('[data-restricted="true"] [data-testid="tree-line-codes"]')).toHaveCount(0);
    const legend = page.getByTestId("tree-line-legend");
    await expect(legend.locator('[data-line="MF"]')).toContainText("nicht erfasst");
  });
});

test.describe("Bezugsperson auf dem Telefon (390 px)", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("„zurück zu mir“ groß genug, Linien ohne waagerechtes Scrollen", async ({ page }) => {
    await page.goto(`/tree?bezug=${UNCLE}`);
    await waitForTree(page);
    const reset = page.getByTestId("reference-chip-reset");
    await expect(reset).toBeInViewport();
    const box = (await reset.boundingBox())!;
    expect(box.height, "Höhe von „zurück zu mir“").toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    const toggle = page.getByTestId("tree-lines-toggle");
    const label = page.locator("label").filter({ has: toggle });
    expect((await label.boundingBox())!.height, "Höhe des Schalters „Linien“").toBeGreaterThanOrEqual(44);
    await toggle.check();
    // Aus Sicht des Onkels: sein Vater (der Großvater der eigenen Person) steht in beiden väterlichen Linien.
    await expect(card(page, GRANDFATHER).getByTestId("tree-line-codes")).toHaveAttribute("data-lines", "FF FM");
    await expectNoHorizontalOverflow(page);
  });
});
