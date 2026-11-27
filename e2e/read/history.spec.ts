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
import type { FamilyKey } from "../../prisma/mock-data";
import { BUILTIN_HISTORY } from "../../lib/history/builtin";
import { mergeHistory } from "../../lib/history/events";
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
 *
 * Regionaler Bezug (lib/history/areas.ts): Lebenslauf zweier Personen aus
 * verschiedenen Gegenden (Familie B: Sachsen/Sachsen-Anhalt, Familie C:
 * Bayern) — dieselben Ereignisse, andere Reihenfolge. Eigene Ereignisse mit
 * Bereich: e2e/write/history.spec.ts (Block „Geltungsbereich“).
 */
test.use({ storageState: authFile("viewer") });

const events = mergeHistory(BUILTIN_HISTORY, [], []);
const now = new Date().getUTCFullYear();

/** Ortstexte der Mock-Familien B (Ostdeutschland) und C (Bayern). */
const EAST = new Set(["Leipzig", "Halle (Saale)", "Dresden", "Chemnitz"]);
const BAVARIA = new Set(["Bamberg", "Würzburg", "Nürnberg", "Erlangen"]);

/**
 * Person der Familie mit genauem Geburtsdatum, lebend über 1955–1991, deren
 * Orte (Geburt, Tod, Partnerschaften, Ereignisse) alle in der Gegend liegen.
 */
function regionalSubject(family: FamilyKey, places: Set<string>) {
  return mock.persons.find((p) => {
    if (!p.familyKeys.includes(family) || !p.birthDate || p.birthDatePrecision !== "DAY" || !p.birthPlace) return false;
    const by = p.birthDate.getUTCFullYear();
    if (by > 1950 || (p.deathDate ? p.deathDate.getUTCFullYear() < 1991 || p.deathDatePrecision !== "DAY" : by < 1930)) return false;
    const rels = mock.relationships.filter((r) => r.type === "PARTNER_OF" && (r.fromPersonId === p.id || r.toPersonId === p.id));
    const relIds = new Set(rels.map((r) => r.id));
    const texts = [p.birthPlace, p.deathPlace, ...rels.flatMap((r) => [r.startPlace, r.endPlace])];
    for (const e of mock.events) if (e.personId === p.id || (e.relationshipId && relIds.has(e.relationshipId))) texts.push(e.place);
    return texts.every((t) => !t || places.has(t));
  });
}

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
    // Die Reihenfolge hängt vom regionalen Bezug ab (eigene Tests unten) —
    // hier zählt: dieselben Ereignisse der Lebenszeit, höchstens vier vorn.
    await expect(line).toContainText(`Allgemeine Zeitgeschichte ${expected.from}–${expected.to}, keine Angabe über die Person`);
    const shown = line.locator(':scope > p [data-testid="biography-history-item"]');
    await expect(shown.first()).toBeVisible();
    expect(await shown.count()).toBeLessThanOrEqual(4);
    const total = expected.top.length + expected.rest.length;
    if (total > (await shown.count())) {
      const more = page.getByTestId("biography-history-more");
      await more.locator("summary").click();
      await expect(more.getByTestId("biography-history-item")).toHaveCount(total - (await shown.count()));
    }
    const titles = (await line.getByTestId("biography-history-item").allTextContents()).map((t) => t.replace(/\s*\(.*$/, "").trim());
    expect(titles.sort()).toEqual([...expected.top, ...expected.rest].map((e) => e.title).sort());
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

test.describe("Lebenslauf mit regionalem Bezug", () => {
  test.use({ storageState: authFile("admin") });

  const east = regionalSubject("B", EAST);
  const bavaria = regionalSubject("C", BAVARIA);

  const item = (page: Page, title: string) =>
    page.getByTestId("biography-history").getByTestId("biography-history-item").filter({ hasText: title });

  test("Person aus Ostdeutschland: Mauerfall vorn mit Region, Anwerbung unter „Andere Gegenden“", async ({ page }) => {
    expect(east, "Mock-Daten: Person der Familie B mit Orten nur in Sachsen/Sachsen-Anhalt").toBeTruthy();
    await page.goto(`/people/${east!.id}`);
    const line = page.getByTestId("biography-history");
    await expect(line).toContainText("Ereignisse aus der Gegend der erfassten Orte zuerst.");
    const top = line.locator(':scope > p [data-testid="biography-history-item"]');
    await expect(top.filter({ hasText: "Fall der Berliner Mauer" })).toHaveCount(1);
    await expect(top.filter({ hasText: "Fall der Berliner Mauer" }).getByTestId("biography-history-near")).toHaveText(/· Sachsen(-Anhalt)?$/);
    await expect(top.filter({ hasText: "Anwerbung" })).toHaveCount(0);
    const more = page.getByTestId("biography-history-more");
    await more.locator("summary").click();
    await expect(page.getByTestId("biography-history-other")).toContainText("Andere Gegenden:");
    await expect(page.getByTestId("biography-history-other").getByTestId("biography-history-item").filter({ hasText: "Anwerbung" })).toBeVisible();
    // Keine Behauptung über die Person.
    await expect(line).not.toContainText(/erlebte|betroffen war|dabei war/);
    await expectNoA11yViolations(page);
  });

  test("Person aus Bayern: Anwerbung vorn mit Region, Mauerfall ohne Region (nur das Land passt)", async ({ page }) => {
    expect(bavaria, "Mock-Daten: Person der Familie C mit Orten nur in Bayern").toBeTruthy();
    await page.goto(`/people/${bavaria!.id}`);
    const top = page.getByTestId("biography-history").locator(':scope > p [data-testid="biography-history-item"]');
    await expect(top.filter({ hasText: "Anwerbung" }).getByTestId("biography-history-near")).toHaveText("· Bayern");
    const more = page.getByTestId("biography-history-more");
    if ((await more.count()) > 0) await more.locator("summary").click();
    await expect(item(page, "Fall der Berliner Mauer")).toBeVisible();
    await expect(item(page, "Fall der Berliner Mauer").getByTestId("biography-history-near")).toHaveCount(0);
    await expect(page.getByTestId("biography-history-other").getByTestId("biography-history-item").filter({ hasText: "Berliner Mauer" })).toHaveCount(0);
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
