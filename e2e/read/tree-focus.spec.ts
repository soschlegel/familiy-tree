import type { Page } from "@playwright/test";

import { test, expect, authFile, waitForTree } from "../support/fixtures";
import { L, fullName, mock } from "../support/mock";

/**
 * Fokus-Ansicht (Standard auf /tree). Ausgangspunkt ist eine feste Person,
 * damit die Tests nicht von der automatisch gewählten Startperson abhängen —
 * die prüft ein eigener Test.
 */
test.use({ storageState: authFile("admin") });

const START = L.crossMarriedPartnerA; // Herbert Becker, Familie A

const card = (page: Page, id: string) => page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`);

async function expectFocus(page: Page, id: string) {
  const tree = page.getByTestId("family-tree");
  await expect(tree).toHaveAttribute("data-focus-id", id);
  await expect(tree).toHaveAttribute("aria-busy", "false");
  await expect(card(page, id)).toHaveAttribute("data-focus", "true");
  await expect(page).toHaveURL(new RegExp(`focus=${id}(&|$)`));
  await expect(page.getByTestId("tree-focus-trail").locator('[aria-current="page"]')).toHaveText(fullName(id));
}

test("ohne Angabe beginnt die Ansicht bei einer Startperson und schreibt sie in die Adresse", async ({ page }) => {
  await page.goto("/tree");
  const tree = await waitForTree(page);
  await expect(tree).toHaveAttribute("data-view", "focus");
  const focusId = await tree.getAttribute("data-focus-id");
  expect(focusId).toMatch(/^mock-p-\d{3}$/);
  await expect(page).toHaveURL(new RegExp(`/tree\\?focus=${focusId}$`));
  await expect(page.getByTestId("tree-view-focus")).toHaveAttribute("aria-pressed", "true");
  // Der Familienfilter ist hier abgeschaltet.
  await expect(page.getByTestId("tree-family-filter")).toBeDisabled();
  await expect(page.getByTestId("tree-family-filter")).toHaveText(/Alle Familien/);
});

test("Klick auf eine Karte stellt die Person in den Mittelpunkt", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  await expectFocus(page, START);

  // Ein Elternteil der Startperson.
  const parentId = firstParentId(START);
  await card(page, parentId).getByTestId("tree-person-main").click();
  await expectFocus(page, parentId);

  // Die vorherige Person steht im Verlauf und führt zurück.
  const trail = page.getByTestId("tree-focus-trail");
  await trail.getByRole("link", { name: fullName(START) }).click();
  await expectFocus(page, START);
});

test("Ecksymbol öffnet die Personenseite, die Fokuskarte selbst auch", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  const partner = L.crossMarriedIntoA;
  await card(page, partner).getByTestId("tree-person-open").click();
  await expect(page).toHaveURL(`/people/${partner}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(partner));

  await page.goBack();
  await waitForTree(page);
  // Die Fokuskarte hat kein Ecksymbol — sie führt selbst zur Personenseite.
  await expect(card(page, START).getByTestId("tree-person-open")).toHaveCount(0);
  await card(page, START).getByTestId("tree-person-main").click();
  await expect(page).toHaveURL(`/people/${START}`);
});

test("Randhinweise: weitere Vorfahren und Kinder, Klick holt sie in den Ausschnitt", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  // Die eingeheiratete Partnerin hat Eltern außerhalb des Ausschnitts.
  const partner = card(page, L.crossMarriedIntoA);
  await expect(partner.getByTestId("tree-more-ancestors")).toBeVisible();
  await expect(page.getByTestId("tree-more-descendants").first()).toBeVisible();
  await expect(partner.getByTestId("tree-person-main")).toContainText("weitere Vorfahren");

  await partner.getByTestId("tree-person-main").click();
  await expectFocus(page, L.crossMarriedIntoA);
  // Jetzt sind ihre Eltern im Ausschnitt (Admin sieht auch Familie B).
  await expect(card(page, L.inLawOnlyB)).toBeVisible();
  await expect(card(page, L.crossMarriedIntoA).getByTestId("tree-more-ancestors")).toHaveCount(0);
});

test("Tiefe der Vorfahren und Nachkommen über die Auswahlfelder", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  const before = await page.getByTestId("tree-person").count();

  await page.getByTestId("tree-depth-up").selectOption("1");
  await expect(page).toHaveURL(new RegExp(`focus=${START}&up=1$`));
  await waitForTree(page);
  await expect(page.getByTestId("tree-depth-up")).toHaveValue("1");
  await expect.poll(() => page.getByTestId("tree-person").count()).toBeLessThan(before);
  // Großeltern fallen weg.
  await expect(card(page, L.founders.A)).toHaveCount(0);

  await page.getByTestId("tree-depth-down").selectOption("4");
  await expect(page).toHaveURL(new RegExp(`focus=${START}&up=1&down=4$`));
  await waitForTree(page);
  await expect(page.getByTestId("tree-depth-down")).toHaveValue("4");

  // Neu laden behält Fokus und Tiefe.
  await page.reload();
  await waitForTree(page);
  await expect(page.getByTestId("tree-depth-up")).toHaveValue("1");
  await expect(page.getByTestId("tree-depth-down")).toHaveValue("4");
  await expect(page.getByTestId("family-tree")).toHaveAttribute("data-focus-id", START);
});

test("Zurück und Vor im Browser wandern durch die Fokus-Personen", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  const parentId = firstParentId(START);
  await card(page, parentId).getByTestId("tree-person-main").click();
  await expectFocus(page, parentId);

  await page.goBack();
  await expectFocus(page, START);
  await page.goForward();
  await expectFocus(page, parentId);
  await page.reload();
  await expectFocus(page, parentId);

  // Die zuletzt fokussierte Person ist beim nächsten Öffnen der Einstieg.
  await page.goto("/tree");
  await expectFocus(page, parentId);
});

test("Suche springt zu einer Person außerhalb des Ausschnitts", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  const target = L.adoptee;
  await expect(card(page, target)).toHaveCount(0);

  const search = page.locator("#tree-search");
  await search.fill(fullName(target));
  const list = page.getByRole("listbox", { name: "Suchtreffer" });
  await expect(list.getByRole("option").first()).toContainText(fullName(target));
  await search.press("Enter");
  await expectFocus(page, target);
  await expect(search).toHaveValue("");
});

test("unbekannte focus-ID zeigt einen Hinweis statt eines leeren Baums", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/404/);
  await page.goto("/tree?focus=mock-p-999");
  const missing = page.getByTestId("tree-focus-missing");
  await expect(missing).toBeVisible();
  await expect(missing.getByRole("heading", { name: "Person nicht gefunden" })).toBeVisible();
  await expect(page.getByTestId("family-tree")).toHaveCount(0);
  await missing.getByRole("link", { name: "Ganzen Baum zeigen" }).click();
  await expect(page.getByTestId("family-tree")).toHaveAttribute("data-view", "generations");
});

test("„Im Stammbaum zeigen“ auf der Personenseite öffnet die Fokus-Ansicht", async ({ page }) => {
  await page.goto(`/people/${L.adoptee}`);
  await page.getByRole("link", { name: "Im Stammbaum zeigen" }).click();
  await expect(page).toHaveURL(`/tree?focus=${L.adoptee}`);
  await expectFocus(page, L.adoptee);
  // Adoptiveltern und leibliche Mutter (ohne Familie, für Admin sichtbar).
  for (const id of [...L.adoptiveParents, L.biologicalMotherNoFamily]) {
    await expect(card(page, id)).toBeAttached();
  }
});

test("Wechsel in den ganzen Baum behält die Person", async ({ page }) => {
  await page.goto(`/tree?focus=${START}`);
  await waitForTree(page);
  await page.getByTestId("tree-whole").click();
  await expect(page).toHaveURL(`/tree?view=generations&focus=${START}`);
  const tree = page.getByTestId("family-tree");
  await expect(tree).toHaveAttribute("data-view", "generations");
  await page.getByTestId("tree-view-focus").click();
  await expect(page).toHaveURL(new RegExp(`/tree\\?focus=${START}$`));
  await expectFocus(page, START);
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("gesperrte focus-ID ergibt denselben Hinweis wie eine unbekannte", async ({ page }) => {
    await page.goto(`/tree?focus=${L.inLawOnlyB}`);
    await expect(page.getByTestId("tree-focus-missing")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(fullName(L.inLawOnlyB));
  });

  test("gesperrte Eltern erscheinen als Platzhalter ohne Randhinweis und ohne Fokus-Klick", async ({ page }) => {
    await page.goto(`/tree?focus=${L.crossMarriedIntoA}`);
    await waitForTree(page);
    const restricted = page.locator('[data-testid="tree-person"][data-restricted="true"]');
    await expect(restricted.first()).toBeVisible();
    await expect(restricted.first()).toContainText("Nicht freigegeben");
    await expect(restricted.getByRole("link")).toHaveCount(0);
    await expect(restricted.getByTestId("tree-more-ancestors")).toHaveCount(0);
  });
});

/** ID eines Elternteils aus der Mock-Datenbasis (leiblich, sichtbar). */
function firstParentId(childId: string): string {
  const rel = mock.relationships.find((r) => r.type === "PARENT_OF" && r.toPersonId === childId);
  if (!rel) throw new Error(`keine Eltern für ${childId}`);
  return rel.fromPersonId;
}

