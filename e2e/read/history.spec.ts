import type { Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  waitForHydration,
  waitForTree,
} from "../support/fixtures";
import { mock } from "../support/mock";
import { BUILTIN_HISTORY } from "../../lib/history/builtin";
import { formatHistoryYears, mergeHistory } from "../../lib/history/events";
import { lifetimeHistory } from "../../lib/history/lifetime";
import { fuzzyField } from "../../lib/dates";

/**
 * Zeitgeschichte — die drei Anzeigestellen, nur lesend: Marken am
 * Zeitstrahl des Baums (components/TimelineHistory.tsx), Zeile der Zeitreise
 * auf der Karte (components/MapExplorer.tsx) und Zeile im Lebenslauf
 * (components/PersonBiography.tsx). Ein- und Ausblenden über den Schalter
 * „Zeitgeschichte“ (Cookie, gilt für alle drei), Telefonbreite.
 *
 * Grundlage ist die mitgelieferte Liste ohne eigene oder ausgeblendete
 * Einträge — e2e/write/history.spec.ts räumt hinter sich auf.
 */
test.use({ storageState: authFile("viewer") });

const events = mergeHistory(BUILTIN_HISTORY, [], []);
const now = new Date().getUTCFullYear();

/** Für den Betrachter (Familie A) sichtbare, verstorbene Person mit genauen Daten über den Ersten Weltkrieg. */
const subject = mock.persons.find((p) => {
  if (!p.familyKeys.includes("A") || !p.birthDate || !p.deathDate) return false;
  if (p.birthDatePrecision !== "DAY" || p.deathDatePrecision !== "DAY") return false;
  return p.birthDate.getUTCFullYear() < 1914 && p.deathDate.getUTCFullYear() > 1918;
})!;

async function openTimeline(page: Page) {
  await page.goto("/tree?view=timeline");
  await waitForTree(page);
  await waitForHydration(page, '[data-testid="tree-history-toggle"]');
}

test.describe("Zeitstrahl im Baum", () => {
  test("Marken an der Jahresachse, Anzeige beim Überfahren, Fokus und Antippen", async ({ page }) => {
    await openTimeline(page);
    const marks = page.getByTestId("tree-history");
    await expect(marks).toBeVisible();
    await expect(page.getByTestId("tree-history-band").or(page.getByTestId("tree-history-mark")).first()).toBeAttached();
    const buttons = page.getByTestId("tree-history-button");
    await expect(buttons.first()).toBeVisible();
    expect((await buttons.first().getAttribute("aria-label")) ?? "").toMatch(/^Zeitgeschichte \d{4}/);

    // Überfahren zeigt Titel und Jahre.
    await buttons.first().hover();
    const tip = page.getByTestId("tree-history-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Zeitgeschichte");
    await expect(tip).toContainText(/\d{4}/);
    await page.mouse.move(600, 10);
    await expect(tip).toBeHidden();

    // Antippen hält die Anzeige; Escape schließt.
    await buttons.first().click();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();

    // Legende nennt die Marken und verweist auf die Hilfe.
    await expect(page.getByTestId("legend-history")).toBeVisible();
    await expect(page.getByTestId("legend-history").getByTestId("help-link")).toHaveAttribute(
      "href",
      "/hilfe/stammbaum#zeitgeschichte-im-zeitstrahl",
    );
    await expectNoA11yViolations(page);
  });

  test("ausblenden gilt nach dem Neuladen und auch für Karte und Lebenslauf", async ({ page }) => {
    await openTimeline(page);
    const toggle = page.getByTestId("tree-history-toggle");
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.getByTestId("tree-history")).toHaveCount(0);
    await expect(page.getByTestId("legend-history")).toHaveCount(0);

    await page.reload();
    await waitForTree(page);
    await expect(page.getByTestId("tree-history-toggle")).not.toBeChecked();
    await expect(page.getByTestId("tree-history")).toHaveCount(0);

    await page.goto("/map?mode=alle&jahr=1916");
    await expect(page.getByTestId("map-history-toggle")).not.toBeChecked();
    await expect(page.getByTestId("map-history")).toHaveCount(0);
    await page.goto(`/people/${subject.id}`);
    await expect(page.getByTestId("biography-history-toggle")).not.toBeChecked();
    await expect(page.getByTestId("biography-history")).toHaveCount(0);

    // Wieder einschalten.
    await waitForHydration(page, '[data-testid="biography-history-toggle"]');
    await page.getByTestId("biography-history-toggle").check();
    await expect(page.getByTestId("biography-history")).toBeVisible();
    await openTimeline(page);
    await expect(page.getByTestId("tree-history")).toBeVisible();
  });

  test("nur im Zeitstrahl — Generationen und Fokus ohne Schalter", async ({ page }) => {
    await page.goto("/tree?view=generations");
    await waitForTree(page);
    await expect(page.getByTestId("tree-history-toggle")).toHaveCount(0);
    await expect(page.getByTestId("tree-history")).toHaveCount(0);
    await page.getByTestId("tree-view-timeline").click();
    await expect(page.getByTestId("tree-history-toggle")).toBeVisible();
    await expect(page.getByTestId("tree-history")).toBeVisible();
  });
});

test.describe("Zeitreise auf der Karte", () => {
  test("Zeile zum gewählten Jahr, feine Marken, Schritte ändern die Zeile", async ({ page }) => {
    await page.goto("/map?mode=alle&jahr=1916");
    await waitForHydration(page, '[data-testid="map-history-toggle"]');
    await expect(page.getByTestId("map-year")).toHaveText("1916");
    const line = page.getByTestId("map-history");
    await expect(line).toContainText("Zeitgeschichte 1916:");
    await expect(line).toContainText("Erster Weltkrieg (1914–1918)");
    await expect(line.getByTestId("map-history-item")).toHaveCount(1);
    await expect(line.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/karte#zeitgeschichte-in-der-zeitreise");
    await expect(page.getByTestId("map-history-marks")).toBeVisible();

    // 1918: Zeitraum am Rand und zwei Ereignisse, die in diesem Jahr beginnen.
    await page.getByTestId("map-step-plus1").click();
    await page.getByTestId("map-step-plus1").click();
    await expect(line).toContainText("Zeitgeschichte 1918:");
    await expect(line.getByTestId("map-history-item")).toHaveCount(3);
    await expect(line).toContainText("Spanische Grippe (1918–1920)");

    await page.getByTestId("map-history-toggle").uncheck();
    await expect(line).toHaveCount(0);
    await expect(page.getByTestId("map-history-marks")).toHaveCount(0);
    await page.getByTestId("map-history-toggle").check();
    await expect(page.getByTestId("map-history")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("Jahr ohne Ereignis aus der Liste", async ({ page }) => {
    await page.goto("/map?mode=alle&jahr=1900");
    await expect(page.getByTestId("map-history-none")).toHaveText("kein Ereignis aus der Liste");
  });
});

test.describe("Lebenslauf", () => {
  test("Zeile unter dem Text: Ereignisse der Lebenszeit, nicht im Text und nicht beim Kopieren", async ({ page, context }) => {
    expect(subject, "Mock-Daten: verstorbene Person mit genauen Daten über 1914–1918").toBeTruthy();
    const expected = lifetimeHistory(
      events,
      { birth: fuzzyField(subject, "birthDate"), death: fuzzyField(subject, "deathDate"), deceased: true },
      now,
    )!;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/people/${subject.id}`);
    const line = page.getByTestId("biography-history");
    await expect(line).toBeVisible();
    await expect(line).toContainText("In diese Lebenszeit fielen:");
    await expect(line).toContainText(`Allgemeine Zeitgeschichte ${expected.from}–${expected.to}, keine Angabe über die Person.`);
    const shown = line.locator(':scope > p [data-testid="biography-history-item"]');
    await expect(shown).toHaveText(expected.top.map((e) => `${e.title} (${formatHistoryYears(e)})`));
    if (expected.rest.length > 0) {
      const more = page.getByTestId("biography-history-more");
      await more.locator("summary").click();
      await expect(more.getByTestId("biography-history-item")).toHaveCount(expected.rest.length);
    }
    await expect(line.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/personen#zeitgeschichte-im-lebenslauf");

    // Nicht Teil des Lebenslauf-Texts — und keine Behauptung über die Person.
    const text = page.getByTestId("biography-text");
    for (const e of [...expected.top, ...expected.rest]) await expect(text).not.toContainText(e.title);
    await expect(line).not.toContainText(/erlebte|betroffen war|kämpfte/);

    await waitForHydration(page, '[data-testid="biography-copy"]');
    await page.getByTestId("biography-copy").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).not.toContain("In diese Lebenszeit fielen");
    for (const e of expected.top) expect(copied).not.toContain(e.title);

    await expectNoA11yViolations(page);
  });
});

test.describe("Telefon (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("ohne Seitwärts-Scrollen, Tippflächen mindestens 44 px", async ({ page }) => {
    await openTimeline(page);
    await expectNoHorizontalOverflow(page);
    const button = page.getByTestId("tree-history-button").first();
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId("tree-history-toggle").locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.tap();
    const tip = page.getByTestId("tree-history-tip");
    await expect(tip).toBeVisible();
    const t = (await tip.boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(390);

    await page.goto("/map?mode=alle&jahr=1916");
    await expect(page.getByTestId("map-history")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect((await page.getByTestId("map-history-toggle").locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.goto(`/people/${subject.id}`);
    await expect(page.getByTestId("biography-history")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect((await page.getByTestId("biography-history-toggle").locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test.describe("dunkles Schema", () => {
    test.use({ colorScheme: "dark" });

    test("Barrierefreiheit im Lebenslauf und auf der Karte", async ({ page }) => {
      await page.goto(`/people/${subject.id}`);
      await expect(page.getByTestId("biography-history")).toBeVisible();
      await expectNoA11yViolations(page);
      await page.goto("/map?mode=alle&jahr=1916");
      await expect(page.getByTestId("map-history")).toBeVisible();
      await expectNoA11yViolations(page);
    });
  });
});
