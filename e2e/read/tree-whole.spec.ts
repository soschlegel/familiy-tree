import type { Locator, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, waitForTree } from "../support/fixtures";
import { L, familyName, fullName, person } from "../support/mock";

/** Gesamtansichten: Generationen und Zeitstrahl. */
test.use({ storageState: authFile("admin") });

const card = (page: Page, id: string) => page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`);

/** Klick auf eine freie Stelle der Baumfläche (keine Karte, keine Legende). */
async function clickEmptyCanvas(page: Page) {
  const box = (await page.getByTestId("family-tree").boundingBox())!;
  for (let fy = 0.1; fy < 0.9; fy += 0.1) {
    for (let fx = 0.3; fx < 0.9; fx += 0.1) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      const free = await page.evaluate(
        ([px, py]) => document.elementFromPoint(px, py)?.classList.contains("react-flow__pane") ?? false,
        [x, y],
      );
      if (free) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error("keine freie Stelle auf der Baumfläche gefunden");
}

async function centreOffset(container: Locator, target: Locator) {
  const c = (await container.boundingBox())!;
  const t = (await target.boundingBox())!;
  return {
    dx: Math.abs(t.x + t.width / 2 - (c.x + c.width / 2)) / c.width,
    dy: Math.abs(t.y + t.height / 2 - (c.y + c.height / 2)) / c.height,
  };
}

test("Wechsel zwischen Generationen und Zeitstrahl", async ({ page }) => {
  await page.goto("/tree?view=generations");
  const tree = await waitForTree(page);
  await expect(tree).toHaveAttribute("data-view", "generations");
  await expect(page.getByTestId("tree-view-generations")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tree-counts")).toHaveText("195 Personen · 302 Beziehungen");
  // Familienfilter ist hier aktiv, Tiefenauswahl gibt es nicht.
  await expect(page.getByTestId("tree-family-filter")).toBeEnabled();
  await expect(page.getByTestId("tree-depth-up")).toHaveCount(0);

  await page.getByTestId("tree-view-timeline").click();
  await expect(tree).toHaveAttribute("data-view", "timeline");
  await expect(page).toHaveURL("/tree?view=timeline");
  await expect(page.getByTestId("tree-view-timeline")).toHaveAttribute("aria-pressed", "true");
  // Hochzeiten als eigene Ereignisse (gezeichnet wird nur, was im Bild ist).
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await expect(page.locator(".react-flow__node-marriage").first()).toBeAttached();
  await expect(page.locator(".react-flow__node-marriage").first()).toContainText(/\d{4}/);

  await page.reload();
  await expect(page.getByTestId("family-tree")).toHaveAttribute("data-view", "timeline");

  await page.getByTestId("tree-view-generations").click();
  await expect(tree).toHaveAttribute("data-view", "generations");
  await expect(page).toHaveURL("/tree?view=generations");
  await expect(page.locator(".react-flow__node-marriage")).toHaveCount(0);
});

for (const view of ["generations", "timeline"] as const) {
  test(`Suche zentriert einen Treffer (${view})`, async ({ page }) => {
    await page.goto(`/tree?view=${view}`);
    const tree = await waitForTree(page);
    const target = L.fosterChild;
    const search = page.locator("#tree-search");
    await search.fill(fullName(target));
    const option = page.getByRole("listbox", { name: "Suchtreffer" }).getByRole("option").first();
    await expect(option).toContainText(fullName(target));
    await option.click();
    const hit = card(page, target);
    await expect(hit).toBeVisible();
    await expect
      .poll(async () => {
        const o = await centreOffset(tree, hit);
        return o.dx < 0.25 && o.dy < 0.25;
      }, { message: "Treffer steht in der Mitte" })
      .toBe(true);
  });
}

test("Familienfilter: Mehrfachauswahl, Beschriftung, Schließen", async ({ page }) => {
  await page.goto("/tree?view=generations");
  await waitForTree(page);
  const trigger = page.getByTestId("tree-family-filter");
  const menu = page.getByRole("menu", { name: "Familien filtern" });
  const A = familyName("A");
  const C = familyName("C");

  await expect(trigger).toHaveText(/Alle Familien/);
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Alle Familien" })).toHaveAttribute("aria-checked", "true");

  // Ankreuzen lässt das Menü offen.
  await menu.getByRole("menuitemcheckbox", { name: A }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: A })).toHaveAttribute("aria-checked", "true");
  await expect(trigger).toHaveText(new RegExp(A.replace(/[()]/g, "\\$&")));
  await menu.getByRole("menuitemcheckbox", { name: C }).click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveText(/2 Familien/);
  await expect(trigger).toHaveAttribute("aria-label", `Familienfilter: ${A}, ${C}`);

  // Escape schließt und gibt den Fokus zurück.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Wirkung: eine Person nur aus Familie D ist nicht mehr zu finden.
  const onlyD = L.founders.D;
  expect(person(onlyD).familyKeys).toEqual(["D"]);
  await page.locator("#tree-search").fill(fullName(onlyD));
  await expect(page.getByText("Kein Treffer")).toBeVisible();
  await page.locator("#tree-search").fill("");

  // Klick auf die Baumfläche schließt.
  await trigger.click();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemcheckbox", { name: C }).click();
  await expect(trigger).toHaveText(new RegExp(A.replace(/[()]/g, "\\$&")));
  await clickEmptyCanvas(page);
  await expect(menu).toBeHidden();

  // „Alle Familien" hebt die Auswahl auf und schließt.
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: "Alle Familien" }).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveText(/Alle Familien/);
  await page.locator("#tree-search").fill(fullName(onlyD));
  await expect(page.getByRole("listbox", { name: "Suchtreffer" }).getByRole("option").first()).toContainText(fullName(onlyD));
});

test("„Ehen zeigen“ trennt Paare auf", async ({ page }) => {
  await page.goto("/tree?view=generations");
  await waitForTree(page);
  // Doppelkarte: zwei Personen in einem Knoten.
  const couples = page.locator('.react-flow__node-person:has([data-testid="tree-person"] ~ [data-testid="tree-person"])');
  await expect(couples.first()).toBeAttached();

  const checkbox = page.getByRole("checkbox", { name: "Ehen zeigen" });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(couples).toHaveCount(0);
  await expect(page.getByTestId("tree-person").first()).toBeAttached();
  await checkbox.check();
  await expect(couples.first()).toBeAttached();
});

test("Legende auf- und zuklappen", async ({ page }) => {
  await page.goto("/tree?view=generations");
  await waitForTree(page);
  const toggle = page.getByRole("button", { name: "Legende" });
  // Auf breiten Bildschirmen im ganzen Baum gleich offen.
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const legend = page.locator("#tree-legend");
  await expect(legend).toContainText("Adoption");
  await expect(legend).toContainText("nicht freigegeben");
  await expect(legend).toContainText("Karte anklicken: Personenseite.");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(legend).toBeHidden();

  // In der Fokus-Ansicht zunächst zu, mit eigenem Hinweis.
  await page.goto(`/tree?focus=${L.crossMarriedPartnerA}`);
  await waitForTree(page);
  await expect(page.getByRole("button", { name: "Legende" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Legende" }).click();
  await expect(page.locator("#tree-legend")).toContainText("Karte anklicken: Person in den Mittelpunkt.");
});

test("Kartenklick öffnet die Personenseite, das Ecksymbol die Fokus-Ansicht", async ({ page }) => {
  const target = L.fosterChild;
  await page.goto(`/tree?view=generations&focus=${target}`);
  await waitForTree(page);
  const hit = card(page, target);
  await expect(hit).toBeVisible();
  await hit.getByTestId("tree-person-main").click();
  await expect(page).toHaveURL(`/people/${target}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(target));

  await page.goBack();
  await waitForTree(page);
  await card(page, target).getByTestId("tree-person-focus").click();
  await expect(page.getByTestId("family-tree")).toHaveAttribute("data-view", "focus");
  await expect(page.getByTestId("family-tree")).toHaveAttribute("data-focus-id", target);
  await expect(page).toHaveURL(`/tree?focus=${target}`);
});

test.describe("Vollbild im ganzen Baum (dunkles Schema)", () => {
  test.use({ colorScheme: "dark" });

  test("Adresse mit vollbild=1 öffnet im Vollbild; Beenden nimmt nur den Parameter weg", async ({ page }) => {
    await page.goto("/tree?view=generations&vollbild=1");
    await waitForTree(page);
    const shell = page.getByTestId("tree-shell");
    const button = page.getByTestId("tree-fullscreen");
    await expect(shell).toHaveAttribute("data-fullscreen", "true");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    // Knopf und Übersichtskarte überlappen nicht.
    const b = (await button.boundingBox())!;
    const m = (await page.locator(".react-flow__minimap").boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(m.y);
    await expectNoA11yViolations(page);
    await button.click();
    await expect(shell).not.toHaveAttribute("data-fullscreen", "true");
    await expect(page).toHaveURL("/tree?view=generations");
    await expect(page.getByRole("toolbar", { name: "Baumansicht" })).toBeVisible();
    // Auf dem Desktop unaufdringlich: kleiner als die Knöpfe der Werkzeugleiste.
    expect((await button.boundingBox())!.height).toBeLessThan(36);
  });
});
