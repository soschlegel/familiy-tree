import type { Locator, Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
} from "../support/fixtures";
import { L, forbiddenNamesFor, mock } from "../support/mock";

/**
 * Ansicht „Ringe“ der Stammbaum-Seite (components/AncestorRings.tsx,
 * lib/services/ancestor-rings.ts). Nur lesend. Die eigene Person des
 * Bearbeiters hat alle vier Großeltern; die mütterlichen gehören nur zu
 * Familie D und sind für ihn gesperrt.
 */

const ringsUrl = (q = "") => `/tree?view=rings&focus=${L.selfEditor}${q}`;

/** Wartet, bis der Kreis gezeichnet, hydriert und keine Navigation unterwegs ist. */
async function waitForRings(page: Page) {
  const area = page.getByTestId("ancestor-rings");
  await expect(page.getByTestId("rings-chart")).toBeVisible();
  await expect(area).toHaveAttribute("aria-busy", "false");
  await waitForHydration(page, '[data-testid="rings-root"]');
  return area;
}

/** Klick bzw. Tipp genau in die Mitte einer Fläche (bei Halbringen läge die Mitte des Rahmens in der Mitte des Kreises). */
async function hit(page: Page, slot: Locator, tap = false) {
  const box = (await page.getByTestId("rings-chart").boundingBox())!;
  const x = box.x + (Number(await slot.getAttribute("data-x")) / 1000) * box.width;
  const y = box.y + (Number(await slot.getAttribute("data-y")) / 1000) * box.height;
  if (tap) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const slot = (page: Page, g: number, i: number) => page.locator(`[data-testid="rings-slot"][data-slot="${g}:${i}"]`);

/** Eine Person nur aus Familie D — für den Bearbeiter gesperrt. */
const hiddenForEditor = mock.persons.find((p) => p.familyKeys.length > 0 && p.familyKeys.every((k) => k === "D"))!;

test.describe("Ringe als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Ansicht wählbar, Flächen mit Namen, Auswahl mit beiden Wegen, Tiefe und Färbung", async ({ page }) => {
    await page.goto(`/tree?focus=${L.selfEditor}`);
    await waitForHydration(page, '[data-testid="tree-view-rings"]');
    await page.getByTestId("tree-view-rings").click();
    await expect(page).toHaveURL(new RegExp(`view=rings&focus=${L.selfEditor}`));
    const area = await waitForRings(page);
    await expect(page.getByTestId("tree-view-rings")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/stammbaum#ringe");

    // Mitte und Eltern mit zugänglichem Namen samt Verwandtschaftsstufe.
    await expect(page.getByTestId("rings-root")).toHaveAttribute("aria-label", /^Ausgangsperson: /);
    await expect(slot(page, 1, 0)).toHaveAttribute("aria-label", /, Vater$/);
    await expect(slot(page, 1, 1)).toHaveAttribute("aria-label", /, Mutter$/);
    await expect(slot(page, 2, 0)).toHaveAttribute("aria-label", /Großvater väterlicherseits$/);
    await expect(page.getByTestId("rings-summary")).toHaveText(
      /^\d+ von 62 Vorfahren bis zur 5\. Generation bekannt, davon 2 nicht freigegeben$/,
    );

    // Gesperrte Großeltern mütterlicherseits: grau, ohne Namen, ohne Wege.
    await expect(slot(page, 2, 2)).toHaveAttribute("data-kind", "restricted");
    await expect(slot(page, 2, 3)).toHaveAttribute("aria-label", "Nicht freigegeben, Großelternteil mütterlicherseits");
    // Über die gesperrten Plätze hinaus nichts: keine Fläche hinter den Großeltern MV und MM.
    const beyond = await page.locator('[data-testid="rings-slot"]').evaluateAll((els) =>
      els.filter((e) => {
        const [g, i] = e.getAttribute("data-slot")!.split(":").map(Number);
        return g >= 3 && i >> (g - 2) >= 2;
      }).length,
    );
    expect(beyond).toBe(0);
    await hit(page, slot(page, 2, 3));
    const info = page.getByTestId("rings-info");
    await expect(info).toContainText("Nicht freigegeben");
    await expect(info.getByTestId("rings-open")).toHaveCount(0);

    // Auswahl einer Person: Angaben und die Wege „Zur Person“ / „In die Mitte“.
    const grandfather = slot(page, 2, 0);
    await hit(page, grandfather);
    await expect(grandfather).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(2, 2);
    await expect(info).toContainText("Großvater väterlicherseits von");
    const open = info.getByTestId("rings-open");
    await expect(open).toHaveAttribute("href", /^\/people\/mock-p-\d+$/);
    const grandfatherId = (await open.getAttribute("href"))!.split("/").pop()!;
    await info.getByTestId("rings-center").click();
    await expect(page).toHaveURL(new RegExp(`focus=${grandfatherId}`));
    await expect(area).toHaveAttribute("data-focus-id", grandfatherId);
    await waitForRings(page);
    await page.goBack();
    await expect(area).toHaveAttribute("data-focus-id", L.selfEditor);

    // Tiefe: Adresse und Zusammenfassung folgen.
    await waitForRings(page);
    await page.getByTestId("rings-generations").selectOption("3");
    await expect(page).toHaveURL(/generationen=3/);
    await expect(page.getByTestId("rings-summary")).toContainText("von 14 Vorfahren bis zur 3. Generation");
    await expect(page.locator('[data-testid="rings-slot"][data-generation="4"]')).toHaveCount(0);

    // Färbung: ohne Neuladen umschalten, Adresse teilbar, Legende nach Land.
    await page.getByTestId("rings-coloring-wurzeln").click();
    await expect(page.getByTestId("rings-coloring-wurzeln")).toHaveAttribute("aria-pressed", "true");
    await expect(area).toHaveAttribute("data-coloring", "wurzeln");
    await expect(page).toHaveURL(/farbe=wurzeln/);
    await expect(page.getByTestId("rings-legend")).toContainText("Deutschland");
    await page.getByTestId("rings-coloring-linie").click();
    await expect(page.getByTestId("rings-legend")).toContainText("VV");
    await expect(page).not.toHaveURL(/farbe=/);

    await expectNoA11yViolations(page);
  });

  test("Tastatur: von innen nach außen, Enter führt zu den Wegen", async ({ page }) => {
    await page.goto(ringsUrl());
    await waitForRings(page);
    await page.getByTestId("rings-root").focus();
    await page.keyboard.press("Tab");
    await expect(slot(page, 1, 0)).toBeFocused();
    await expect(page.getByTestId("rings-outline-focus")).toBeAttached();
    await page.keyboard.press("Tab");
    await expect(slot(page, 1, 1)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(slot(page, 2, 0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("rings-info").getByTestId("rings-open")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(slot(page, 2, 0)).toBeFocused();
  });

  test("Datenschutz: nichts von gesperrten Personen in Seite und Quelltext", async ({ page }) => {
    const res = await page.request.get(ringsUrl("&generationen=7"));
    expect(res.status()).toBe(200);
    const html = await res.text();
    const forbidden = forbiddenNamesFor(["A", "B"]);
    expect(forbidden.length).toBeGreaterThan(0);
    for (const name of forbidden) expect(html).not.toContain(name);
    // Keine Kennungen außer denen sichtbarer Personen.
    const visible = new Set(mock.persons.filter((p) => p.familyKeys.some((k) => k === "A" || k === "B")).map((p) => p.id));
    for (const id of html.match(/mock-p-\d+/g) ?? []) expect(visible.has(id), id).toBe(true);

    await page.goto(ringsUrl("&generationen=7"));
    await waitForRings(page);
    const text = (await page.getByTestId("ancestor-rings").textContent()) ?? "";
    for (const name of forbidden) expect(text).not.toContain(name);
  });

  test("gesperrte oder unbekannte Person in der Mitte: „Person nicht gefunden“", async ({ page }) => {
    await page.goto(`/tree?view=rings&focus=${hiddenForEditor.id}`);
    await expect(page.getByTestId("tree-focus-missing")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ringe öffnen" })).toHaveAttribute("href", "/tree?view=rings");
    await expect(page.getByTestId("rings-chart")).toHaveCount(0);
  });

  test("zurück zur Fokus-Ansicht mit derselben Person", async ({ page }) => {
    await page.goto(ringsUrl());
    await waitForRings(page);
    await page.getByTestId("tree-view-focus").click();
    await expect(page).toHaveURL(new RegExp(`/tree\\?focus=${L.selfEditor}$`));
    await expect(page.getByTestId("family-tree")).toHaveAttribute("data-focus-id", L.selfEditor);
  });
});

test.describe("Ringe im dunklen Schema", () => {
  test.use({ storageState: authFile("editor"), colorScheme: "dark" });

  test("Färbung nach Wurzeln per Adresse, Legende, axe", async ({ page }) => {
    await page.goto(ringsUrl("&farbe=wurzeln&generationen=4"));
    const area = await waitForRings(page);
    await expect(area).toHaveAttribute("data-coloring", "wurzeln");
    await expect(page.getByTestId("rings-coloring-wurzeln")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("rings-generations")).toHaveValue("4");
    await expect(page.getByTestId("rings-legend")).toContainText("Deutschland");
    await expect(page.getByTestId("rings-legend")).toContainText("nicht freigegeben");
    await expectNoA11yViolations(page);
  });
});

test.describe("Ringe auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("390 px: kein waagerechtes Scrollen, Antippen, Tippflächen, Vollbild", async ({ page }) => {
    await page.goto(ringsUrl());
    await waitForRings(page);
    await expectNoHorizontalOverflow(page);
    const chart = (await page.getByTestId("rings-chart").boundingBox())!;
    expect(chart.width).toBeGreaterThanOrEqual(320);
    expect(chart.x + chart.width).toBeLessThanOrEqual(390);

    for (const id of ["rings-generations", "rings-coloring-linie", "rings-coloring-wurzeln", "tree-view-rings", "tree-fullscreen"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(Math.round(box.height), `Höhe von ${id}`).toBeGreaterThanOrEqual(44);
    }

    await hit(page, slot(page, 1, 0), true);
    const info = page.getByTestId("rings-info-mobile");
    await expect(info).toBeVisible();
    await expect(info).toContainText("Vater von");
    for (const id of ["rings-open", "rings-center", "rings-info-close"]) {
      const box = (await info.getByTestId(id).boundingBox())!;
      expect(Math.round(box.height), `Höhe von ${id}`).toBeGreaterThanOrEqual(44);
    }
    await info.getByTestId("rings-info-close").tap();
    await expect(info).toHaveCount(0);

    // Vollbild: Fläche füllt den Bildschirm, Escape beendet es.
    const shell = page.getByTestId("tree-shell");
    await page.getByTestId("tree-fullscreen").tap();
    await expect(page).toHaveURL(/[?&]vollbild=1/);
    await expect(shell).toHaveAttribute("data-fullscreen", "true");
    await expect(page.getByRole("toolbar", { name: "Baumansicht" })).toBeHidden();
    await expect(page.locator("footer")).toHaveAttribute("inert", "");
    const area = (await page.getByTestId("ancestor-rings").boundingBox())!;
    expect(area.height).toBeGreaterThanOrEqual(730);
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(shell).not.toHaveAttribute("data-fullscreen", "true");
    await expect(page).not.toHaveURL(/vollbild=/);
  });
});
