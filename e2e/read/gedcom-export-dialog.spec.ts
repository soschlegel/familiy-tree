import type { Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs } from "../support/api";
import { FAMILY, familyName, mock, visibleFor } from "../support/mock";
import { parseGedcom } from "../../lib/gedcom";

/**
 * GEDCOM-Export mit Familienauswahl (/admin/data): Dialog öffnen, Familien
 * wählen, Personenzahl, Download prüfen; Bedienung mit Tastatur und auf dem
 * Telefon; Rechte. Nur lesend (die Mock-Daten bleiben unverändert).
 */

const withoutFamily = mock.persons.filter((p) => p.familyKeys.length === 0);
const persons = (n: number) => (n === 1 ? "1 Person" : `${n.toLocaleString("de-DE")} Personen`);

/** Alle Zeiger (@X@ als Wert) verweisen auf vorhandene Datensätze. */
function danglingPointers(text: string): string[] {
  const defined = new Set<string>();
  const used = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const def = /^0 (@[^@]+@) /.exec(line);
    if (def) defined.add(def[1]);
    const ptr = /^[1-9]\d* \S+ (@[^@#]+@)\s*$/.exec(line);
    if (ptr) used.add(ptr[1]);
  }
  return [...used].filter((x) => !defined.has(x));
}

async function openDialog(page: Page, button = "GEDCOM") {
  await page.goto("/admin/data");
  const opener = page.getByRole("button", { name: button, exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return { dialog, opener };
}

async function download(page: Page) {
  const dialog = page.getByRole("dialog");
  const [dl] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", { name: "Herunterladen" }).click()]);
  await expect(dialog).toBeHidden();
  const path = await dl.path();
  const { readFile } = await import("node:fs/promises");
  return { name: dl.suggestedFilename(), body: await readFile(path!) };
}

test.describe("als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Dialog: alle Familien und „ohne Familie“ vorausgewählt, Zahl der Personen, Barrierefreiheit", async ({ page }) => {
    const { dialog } = await openDialog(page);
    await expect(dialog.getByRole("heading", { name: "GEDCOM exportieren" })).toBeVisible();
    for (const key of ["A", "B", "C", "D"] as const) await expect(dialog.getByRole("checkbox", { name: familyName(key), exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Personen ohne Familie" })).toBeChecked();
    await expect(dialog.getByRole("status")).toContainText(`${persons(mock.persons.length)} im Export`);
    await expectNoA11yViolations(page);

    // Keine: Herunterladen gesperrt; eine Familie: Zahl dieser Familie.
    await dialog.getByRole("button", { name: "Keine auswählen" }).click();
    await expect(dialog.getByRole("status")).toContainText("Nichts ausgewählt");
    await expect(dialog.getByRole("button", { name: "Herunterladen" })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: familyName("D"), exact: true }).check();
    await expect(dialog.getByRole("status")).toContainText(`${persons(visibleFor(["D"]).length)} im Export`);
    // Zwei Familien: Eingeheiratete zählen einmal.
    await dialog.getByRole("checkbox", { name: familyName("C"), exact: true }).check();
    await expect(dialog.getByRole("status")).toContainText(`${persons(visibleFor(["C", "D"]).length)} im Export`);
    await dialog.getByRole("button", { name: "Alle auswählen" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Personen ohne Familie" })).toBeChecked();
  });

  test("Download nur einer Familie: genau ihre Personen, gültig, keine offenen Zeiger, Dateiname mit Auswahl", async ({ page }) => {
    const { dialog } = await openDialog(page);
    await dialog.getByRole("button", { name: "Keine auswählen" }).click();
    await dialog.getByRole("checkbox", { name: familyName("D"), exact: true }).check();
    const { name, body } = await download(page);
    expect(name).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}_auswahl-1-familie\.ged$/);
    const text = body.toString("utf8");
    expect(text).toMatch(/1 GEDC\r?\n2 VERS 5\.5\.1/);
    const parsed = parseGedcom(body);
    expect(parsed.document.persons).toHaveLength(visibleFor(["D"]).length);
    expect(parsed.warnings.filter((w) => w.code === "DANGLING_POINTER")).toEqual([]);
    expect(danglingPointers(text)).toEqual([]);
    // Nur Personen ohne Familie (ZIP).
    const again = await openDialog(page, "GEDCOM mit Bildern (ZIP)");
    await expect(again.dialog.getByRole("heading", { name: "GEDCOM mit Bildern exportieren" })).toBeVisible();
    await again.dialog.getByRole("button", { name: "Keine auswählen" }).click();
    await again.dialog.getByRole("checkbox", { name: "Personen ohne Familie" }).check();
    await expect(again.dialog.getByRole("status")).toContainText(`${persons(withoutFamily.length)} im Export`);
    const zip = await download(page);
    expect(zip.name).toMatch(/_auswahl-ohne-familie\.zip$/);
  });

  test("Tastatur: Fokus im Dialog, Escape schließt, Fokus zurück auf den Knopf; alles ausgewählt = bisheriger Export", async ({ page }) => {
    const { dialog, opener } = await openDialog(page);
    // Fokus liegt im Dialog.
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    // Mit der Tastatur öffnen und „Abbrechen“.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    // Alles ausgewählt: Link ohne Auswahl (derselbe Export wie bisher).
    await opener.click();
    await expect(dialog.getByRole("link", { name: "Herunterladen" })).toHaveAttribute("href", "/api/export?format=gedcom");
  });
});

test.describe("als Betrachter (Familie A)", () => {
  test.use({ storageState: authFile("viewer") });

  test("sieht nur seine Familie, kein „ohne Familie“; fremde Familien in der Anfrage → 403", async ({ page }) => {
    const { dialog } = await openDialog(page);
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await expect(dialog.getByRole("checkbox", { name: familyName("A"), exact: true })).toBeChecked();
    await expect(dialog.getByText(familyName("B"))).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText(`${persons(visibleFor(["A"]).length)} im Export`);

    const api = await apiAs("viewer");
    for (const q of [`families=${FAMILY.B}`, `families=${FAMILY.A},${FAMILY.C}`, "families=gibt-es-nicht", `families=${FAMILY.A}&withoutFamily=1`]) {
      expect((await api.get(`/api/export?format=gedcom&${q}`)).status(), q).toBe(403);
      expect((await api.get(`/api/export?format=gedzip&${q}`)).status(), q).toBe(403);
    }
    const own = await api.get(`/api/export?format=gedcom&families=${FAMILY.A}`);
    expect(own.status()).toBe(200);
    expect(parseGedcom(await own.body()).document.persons).toHaveLength(visibleFor(["A"]).length);
    await api.dispose();
  });
});

test.describe("auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 360, height: 740 }, hasTouch: true });

  test("Dialog passt auf den Bildschirm, Tippziele mindestens 44 px", async ({ page }) => {
    const { dialog } = await openDialog(page);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(box.y + box.height).toBeLessThanOrEqual(740);
    await expectNoHorizontalOverflow(page);
    const targets = [
      dialog.getByRole("button", { name: "Alle auswählen" }),
      dialog.getByRole("button", { name: "Keine auswählen" }),
      dialog.getByRole("button", { name: "Abbrechen" }),
      dialog.getByRole("link", { name: "Herunterladen" }),
      // Das Tippziel einer Zeile ist das ganze Label.
      dialog.locator("label").filter({ hasText: familyName("A") }),
      dialog.locator("label").filter({ hasText: familyName("B") }),
    ];
    for (const t of targets) expect((await t.boundingBox())!.height, (await t.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    // Antippen der Zeile schaltet das Kästchen.
    await dialog.locator("label").filter({ hasText: familyName("B") }).tap();
    await expect(dialog.getByRole("checkbox", { name: familyName("B"), exact: true })).not.toBeChecked();
    await expect(dialog.getByRole("status")).toContainText(`${persons(visibleFor(["A"]).length)} im Export`);
  });
});
