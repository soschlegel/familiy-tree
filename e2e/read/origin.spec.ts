import type { Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow, waitForTree } from "../support/fixtures";
import { L, mock, person } from "../support/mock";

/**
 * Herkunft sichtbar machen — nur lesend, auf den Mock-Daten (alle Personen
 * dort sind von Hand erfasst: Chip „H“). Geprüft werden Schalter und Rechte:
 * standardmäßig aus, Zuordnung nur mit `?herkunft=1`, nur für Bearbeiter und
 * Administratoren und nur an Personen, die man bearbeiten darf. Importe,
 * Buchstaben und Verbindungspersonen prüft e2e/write/origin.spec.ts.
 */
const SELF = L.selfEditor;
const card = (page: Page, id: string) => page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`);

test.describe("Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Schalter „Herkunft“: standardmäßig aus, lädt die Zuordnung erst beim Einschalten, Legende hebt hervor", async ({ page }) => {
    await page.goto(`/tree?focus=${SELF}`);
    await waitForTree(page);
    const toggle = page.getByTestId("tree-origin-toggle");
    await expect(toggle).not.toBeChecked();
    // Aus: keine Zuordnung in der Seite — weder Chips noch Kennungen an den Karten.
    await expect(page.locator('[data-testid="tree-person"][data-origin]')).toHaveCount(0);
    await expect(page.getByTestId("origin-chip")).toHaveCount(0);
    await expect(page.getByTestId("tree-origin-legend")).toHaveCount(0);

    // Der Haken folgt der Adresse (der Server lädt die Zuordnung) — deshalb klicken statt check().
    await toggle.click();
    await expect(page).toHaveURL(/herkunft=1/);
    await waitForTree(page);
    await expect(toggle).toBeChecked();
    await expect(card(page, SELF)).toHaveAttribute("data-origin", "H");
    await expect(card(page, SELF).getByTestId("origin-chip")).toHaveText("H");
    // Nie nur Farbe: Titel am Chip, Text für Screenreader an der Karte.
    await expect(card(page, SELF).getByTestId("origin-chip")).toHaveAttribute("title", "von Hand erfasst");
    await expect(card(page, SELF).getByTestId("tree-person-main")).toContainText("Herkunft: von Hand erfasst");
    await expect(page.locator('[data-testid="tree-person"][data-connecting]')).toHaveCount(0);

    const legend = page.getByTestId("tree-origin-legend");
    await expect(legend).toBeVisible();
    const item = legend.getByTestId("origin-legend-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("von Hand erfasst");
    await expect(item).toHaveAttribute("aria-pressed", "false");
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("origin-legend-status")).toContainText("Hervorgehoben: von Hand erfasst");
    await expectNoA11yViolations(page);

    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "false");

    // Der Schalter bleibt beim Wandern durch den Baum erhalten: Die Links der
    // anderen Karten tragen ihn mit. (Der Adresse folgen statt zu klicken — die
    // offene Legende kann je nach Breite eine Karte verdecken.)
    const otherId = await page
      .locator(`[data-testid="tree-person"][data-origin]:not([data-person-id="${SELF}"])`)
      .first()
      .getAttribute("data-person-id");
    expect(otherId).toBeTruthy();
    const href = await card(page, otherId!).getByTestId("tree-person-main").getAttribute("href");
    expect(href).toMatch(/herkunft=1/);
    await page.goto(href!);
    await expect(page).toHaveURL(new RegExp(`focus=${otherId}.*herkunft=1|herkunft=1.*focus=${otherId}`));
    await waitForTree(page);
    await expect(page.getByTestId("tree-origin-toggle")).toBeChecked();
    // … und lässt sich wieder ausschalten.
    await page.getByTestId("tree-origin-toggle").click();
    await expect(page).not.toHaveURL(/herkunft/);
    await expect(page.getByTestId("origin-chip")).toHaveCount(0);
  });

  test("verträgt sich mit „Linien“: beide zugleich", async ({ page }) => {
    await page.goto(`/tree?focus=${SELF}&up=3&herkunft=1`);
    await waitForTree(page);
    await page.getByTestId("tree-lines-toggle").check();
    await expect(page.getByTestId("tree-line-legend")).toBeVisible();
    await expect(page.getByTestId("tree-origin-legend")).toBeVisible();
    const both = page.locator('[data-testid="tree-person"][data-origin]').filter({ has: page.getByTestId("tree-line-codes") }).first();
    await expect(both.getByTestId("origin-chip")).toBeVisible();
    await expect(both.getByTestId("tree-line-stripe")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("ganzer Baum: Chips nur an Personen, die der Bearbeiter bearbeiten darf", async ({ page }) => {
    await page.goto(`/tree?view=generations&focus=${L.inLawOnlyB}&herkunft=1`);
    await waitForTree(page);
    // Familie B darf der Bearbeiter nur lesen: Karte sichtbar, aber ohne Herkunft.
    await expect(card(page, L.inLawOnlyB)).toBeVisible();
    await expect(card(page, L.inLawOnlyB)).not.toHaveAttribute("data-origin", /.*/);
    const ids = await page.locator('[data-testid="tree-person"][data-origin]').evaluateAll((els) => els.map((e) => e.getAttribute("data-person-id")!));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(person(id).familyKeys, id).toContain("A");
  });

  test("Telefonbreite: Schalter erreichbar, nichts läuft über", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tree?focus=${SELF}&herkunft=1`);
    await waitForTree(page);
    await expect(page.getByTestId("tree-origin-toggle")).toBeChecked();
    await expect(card(page, SELF).getByTestId("origin-chip")).toHaveText("H");
    await expectNoHorizontalOverflow(page);
    const box = await page.getByTestId("tree-origin-toggle").locator("xpath=..").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("Personenseite: Block „Herkunft“ mit ehrlicher Aussage; an nur lesbaren Personen fehlt er", async ({ page }) => {
    await page.goto(`/people/${SELF}`);
    const block = page.getByTestId("person-origin");
    await expect(block.getByRole("heading", { name: "Herkunft" })).toBeVisible();
    await expect(block.getByTestId("person-origin-manual")).toContainText("Von Hand erfasst");
    await expect(block.getByTestId("person-origin-merged")).toHaveCount(0);
    await expect(block.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/personen#herkunft");
    await page.goto(`/people/${L.inLawOnlyB}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("person-origin")).toHaveCount(0);
  });

  test("Übersicht über die Schnittstelle: nur bearbeitbare Personen gezählt", async ({ page }) => {
    const res = await page.request.get("/api/origin/overview");
    expect(res.status()).toBe(200);
    const data = (await res.json()) as { total: number; nodes: { key: string; persons: number }[] };
    expect(data.total).toBe(mock.persons.filter((p) => p.familyKeys.includes("A")).length);
    expect(data.nodes[0].persons).toBe(data.total);
    expect(data.nodes.map((n) => n.key)).toEqual(["H"]);
  });
});

test.describe("Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("kein Schalter, und die Adresse allein schaltet nichts ein", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/403/);
    await page.goto("/tree?herkunft=1");
    await waitForTree(page);
    await expect(page.getByTestId("tree-origin-toggle")).toHaveCount(0);
    await expect(page.locator('[data-testid="tree-person"][data-origin]')).toHaveCount(0);
    await expect(page.getByTestId("origin-chip")).toHaveCount(0);
    await expect(page.getByTestId("tree-origin-legend")).toHaveCount(0);
    expect((await page.request.get("/api/origin/overview")).status()).toBe(403);
    expect((await page.request.get("/api/import/sources")).status()).toBe(403);
    await page.goto(`/people/${SELF}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("person-origin")).toHaveCount(0);
  });
});
