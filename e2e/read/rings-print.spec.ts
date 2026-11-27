import fs from "node:fs";

import type { Page } from "@playwright/test";

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
 * „Ahnentafel zum Drucken“ (app/tree/print, components/RingsPrintSheet.tsx,
 * lib/rings-print.ts). Nur lesend. Die Druckseite zeigt genau, was die
 * Ringe zeigen: Die mütterlichen Großeltern des Bearbeiters gehören nur zu
 * Familie D und erscheinen als „Nicht freigegeben“ ohne Angaben.
 */

const printUrl = (q = "") => `/tree/print?focus=${L.selfEditor}${q}`;
const hiddenForEditor = mock.persons.find((p) => p.familyKeys.length > 0 && p.familyKeys.every((k) => k === "D"))!;

async function waitForSheet(page: Page) {
  await expect(page.getByTestId("print-sheet")).toBeVisible();
  await expect(page.getByTestId("print-preview")).toHaveAttribute("aria-busy", "false");
  await waitForHydration(page, '[data-testid="print-now"]');
}

/** Seitenzahl und Seitengröße (in Punkt) eines von Chromium erzeugten PDFs. */
function pdfPages(pdf: Buffer) {
  const text = pdf.toString("latin1");
  const pages = text.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { pages, width: Number(box?.[1]), height: Number(box?.[2]) };
}
const mmToPt = (mm: number) => (mm / 25.4) * 72;

test.describe("Druckansicht als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Knopf in den Ringen, Seite ohne Navigation, Einstellungen ändern Vorschau und Adresse", async ({ page }) => {
    await page.goto(`/tree?view=rings&focus=${L.selfEditor}&generationen=4&farbe=wurzeln`);
    const print = page.getByTestId("rings-print");
    await expect(print).toHaveAttribute("href", `/tree/print?focus=${L.selfEditor}&generationen=4&farbe=wurzeln`);
    await waitForHydration(page, '[data-testid="rings-root"]');
    await print.click();
    await expect(page).toHaveURL(new RegExp(`/tree/print\\?focus=${L.selfEditor}&generationen=4&farbe=wurzeln$`));
    await waitForSheet(page);

    // Ohne Kopfzeile und Fußzeile der App.
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
    await expect(page.locator("body > footer")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Drucken" })).toBeVisible();

    const sheet = page.getByTestId("print-sheet");
    await expect(sheet).toHaveAttribute("data-coloring", "wurzeln");
    await expect(page.getByTestId("print-legend")).toContainText("Deutschland");
    await expect(page.getByTestId("print-sheet-title")).toHaveText(/^Vorfahren von .+/);
    await expect(page.getByTestId("print-sheet-footer")).toContainText("von 30 Vorfahren bis zur 4. Generation bekannt, davon 2 nicht freigegeben");
    await expect(page.getByTestId("print-labels")).toContainText("Nicht freigegeben");

    // Papier und Ausrichtung: Seitenverhältnis der Vorschau und Adresse folgen.
    await page.getByTestId("print-format").selectOption("a3");
    await expect(sheet).toHaveAttribute("data-format", "a3");
    await expect(sheet).toHaveAttribute("viewBox", "0 0 297 420");
    await page.getByTestId("print-orientation-quer").click();
    await expect(sheet).toHaveAttribute("viewBox", "0 0 420 297");
    const box = (await sheet.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(420 / 297, 1);
    await expect(page).toHaveURL(/format=a3&ausrichtung=quer/);

    // Titel, Untertitel, Färbung, äußere Namen.
    await page.getByTestId("print-title").fill("Zum Familienfest");
    await expect(page.getByTestId("print-sheet-title")).toHaveText("Zum Familienfest");
    await expect(page).toHaveURL(/titel=Zum\+Familienfest/);
    await expect(page.getByTestId("print-sheet-subtitle")).toBeVisible();
    await page.getByTestId("print-date").uncheck();
    await expect(page.getByTestId("print-sheet-subtitle")).toHaveCount(0);
    await expect(page).toHaveURL(/datum=0/);
    await page.getByTestId("print-coloring-linie").click();
    await expect(page.getByTestId("print-legend")).toContainText("VV Großvater");
    await expect(page).not.toHaveURL(/farbe=/);
    await page.getByTestId("print-outer-names").uncheck();
    await expect(page).toHaveURL(/namen=0/);

    // Generationen laden neu, die übrigen Einstellungen bleiben.
    await page.getByTestId("print-generations").selectOption("3");
    await expect(page).toHaveURL(/generationen=3/);
    await expect(page.getByTestId("print-sheet-footer")).toHaveText(/^\d+ von 14 Vorfahren bis zur 3\. Generation bekannt, davon 2 nicht freigegeben$/);
    await expect(page.getByTestId("print-sheet-title")).toHaveText("Zum Familienfest");
    await expect(page.getByTestId("print-sheet")).toHaveAttribute("data-format", "a3");
  });

  test("Druckmedium: nur das Blatt, weiß, in Blattgröße — auch im dunklen Schema", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor"), colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(printUrl("&ausrichtung=quer"));
    await waitForSheet(page);
    // Am Bildschirm im dunklen Schema: Seite dunkel, Blatt weiß.
    const sheetFill = await page.locator('[data-testid="print-sheet"] > rect').first().getAttribute("fill");
    expect(sheetFill).toBe("#ffffff");

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-controls")).toBeHidden();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    const box = (await page.getByTestId("print-sheet").boundingBox())!;
    // 297 mm × 210 mm in CSS-Pixeln (96 dpi).
    expect(box.width).toBeCloseTo((297 / 25.4) * 96, 0);
    expect(box.height).toBeCloseTo((210 / 25.4) * 96, 0);
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.y).toBeCloseTo(0, 0);
    await context.close();
  });

  for (const c of [
    { q: "&ausrichtung=quer", w: 297, h: 210 },
    { q: "&richtung=nachfahren&format=a3", w: 297, h: 420 },
    { q: "&generationen=7&format=a1", w: 594, h: 841 },
  ]) {
    test(`PDF: genau eine Seite ${c.w} × ${c.h} mm (${c.q})`, async ({ page }) => {
      await page.goto(printUrl(c.q));
      await waitForSheet(page);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const info = pdfPages(pdf);
      expect(info.pages).toBe(1);
      expect(Math.abs(info.width - mmToPt(c.w))).toBeLessThan(1.5);
      expect(Math.abs(info.height - mmToPt(c.h))).toBeLessThan(1.5);
    });
  }

  test("Als Bild speichern: SVG-Datei mit Blattmaß, ohne gesperrte Namen", async ({ page }) => {
    await page.goto(printUrl("&format=a2"));
    await waitForSheet(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("print-svg").click()]);
    expect(download.suggestedFilename()).toMatch(/^vorfahren-[a-z0-9-]+-a2-hoch\.svg$/);
    const svg = fs.readFileSync((await download.path())!, "utf8");
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('height="594mm"');
    expect(svg).toContain("Nicht freigegeben");
    // Keine CSS-Variablen: die Datei zeigt auch außerhalb der App dieselben Farben.
    expect(svg).not.toContain("var(--");
    for (const name of forbiddenNamesFor(["A", "B"])) expect(svg).not.toContain(name);
  });

  test("Datenschutz: Quelltext ohne fremde Namen und Kennungen; gesperrte Mitte „nicht gefunden“", async ({ page }) => {
    const res = await page.request.get(printUrl("&generationen=7"));
    expect(res.status()).toBe(200);
    const html = await res.text();
    for (const name of forbiddenNamesFor(["A", "B"])) expect(html).not.toContain(name);
    const visible = new Set(mock.persons.filter((p) => p.familyKeys.some((k) => k === "A" || k === "B")).map((p) => p.id));
    for (const id of html.match(/mock-p-\d+/g) ?? []) expect(visible.has(id), id).toBe(true);

    await page.goto(`/tree/print?focus=${hiddenForEditor.id}`);
    await expect(page.getByTestId("print-missing")).toContainText("Person nicht gefunden");
    await expect(page.getByTestId("print-sheet")).toHaveCount(0);
  });
});

test.describe("Druckansicht als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("nur Familie A: nichts aus anderen Familien in Quelltext und Blatt", async ({ page }) => {
    const res = await page.request.get(`/tree/print?focus=${L.founders.A}&richtung=nachfahren&generationen=7`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const forbidden = forbiddenNamesFor(["A"]);
    for (const name of forbidden) expect(html).not.toContain(name);
    const visible = new Set(mock.persons.filter((p) => p.familyKeys.includes("A")).map((p) => p.id));
    for (const id of html.match(/mock-p-\d+/g) ?? []) expect(visible.has(id), id).toBe(true);

    await page.goto(`/tree/print?focus=${L.founders.A}&richtung=nachfahren&generationen=7`);
    await waitForSheet(page);
    const text = (await page.getByTestId("print-sheet").textContent()) ?? "";
    for (const name of forbidden) expect(text).not.toContain(name);
    await expectNoA11yViolations(page);
  });
});

test.describe("Druckansicht ohne Anmeldung", () => {
  test("führt zur Anmeldung", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(printUrl());
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("print-sheet")).toHaveCount(0);
    await context.close();
  });
});

test.describe("Druckansicht auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("390 px: kein waagerechtes Scrollen, Bedienelemente erreichbar, Blatt in voller Breite", async ({ page }) => {
    await page.goto(printUrl());
    await waitForSheet(page);
    await expectNoHorizontalOverflow(page);
    for (const id of ["print-format", "print-orientation-quer", "print-title", "print-generations", "print-svg", "print-now"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(Math.round(box.height), `Höhe von ${id}`).toBeGreaterThanOrEqual(44);
    }
    const sheet = (await page.getByTestId("print-sheet").boundingBox())!;
    expect(sheet.width).toBeGreaterThanOrEqual(330);
    await expectNoA11yViolations(page);
  });
});
