import type { Locator, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs } from "../support/api";
import { FAMILY, L, familyName, fullName, mock, visibleFor } from "../support/mock";
import { parseGedcom } from "../../lib/gedcom";
import { collectLineage, DEFAULT_LINEAGE_OPTIONS, type LineageOptions } from "../../lib/export-lineage";

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

/** Erwartete Personenzahl „Ab einer Person“ aus den Mock-Daten (sichtbar für die Familien `keys`, null = alle). */
function lineage(keys: string[] | null, start: string, opts: Partial<LineageOptions> = {}): number {
  const visible = new Set(mock.persons.filter((p) => !keys || p.familyKeys.some((k) => keys.includes(k))).map((p) => p.id));
  const edges = mock.relationships.map((r) => ({ type: r.type, subtype: r.subtype, from: r.fromPersonId, to: r.toPersonId }));
  return collectLineage(visible, edges, start, { ...DEFAULT_LINEAGE_OPTIONS, ...opts }).counts.total;
}

/** Art der Auswahl umschalten (das Optionsfeld ist unsichtbar, die Beschriftung das Tippziel). */
async function chooseMode(dialog: Locator, name: "Nach Familien" | "Ab einer Person") {
  await dialog.getByTestId("export-mode").locator("label").filter({ hasText: name }).click();
  await expect(dialog.getByRole("radio", { name })).toBeChecked();
}

test.describe("Ab einer Person (Admin)", () => {
  test.use({ storageState: authFile("admin") });

  test("Umschalter, Person suchen, Kästchen ändern die Zahl, abhängiges Kästchen, Download mit erwarteter Personenzahl", async ({ page }) => {
    const { dialog } = await openDialog(page);
    await expect(dialog.getByRole("radio", { name: "Nach Familien" })).toBeChecked();
    await chooseMode(dialog, "Ab einer Person");
    // Admin hat keine eigene Person: noch niemand gewählt, Herunterladen gesperrt, keine Familienliste.
    await expect(dialog.getByTestId("export-count")).toHaveText("Noch keine Person gewählt.");
    await expect(dialog.getByRole("button", { name: "Herunterladen" })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: familyName("A"), exact: true })).toHaveCount(0);

    await dialog.getByTestId("export-person-search").fill(fullName(L.selfEditor));
    await dialog.getByRole("button", { name: new RegExp(`^${fullName(L.selfEditor)}`) }).click();
    await expect(dialog.getByTestId("export-person-selected")).toHaveText(fullName(L.selfEditor));
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor))} im Export`);
    await expectNoA11yViolations(page);

    const box = (name: string) => dialog.getByRole("checkbox", { name, exact: true });
    for (const name of ["Partner", "Geschwister", "Partner und Kinder der Geschwister", "Nachkommen der Person", "Auch Adoptiv-, Stief- und Pflegeeltern"]) {
      await expect(box(name)).not.toBeChecked();
    }
    await box("Partner").check();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor, { partners: true }))} im Export`);
    await box("Partner").uncheck();
    // „Partner und Kinder der Geschwister“ erst mit „Geschwister“.
    await expect(box("Partner und Kinder der Geschwister")).toBeDisabled();
    await box("Geschwister").check();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor, { siblings: true }))} im Export`);
    await expect(box("Partner und Kinder der Geschwister")).toBeEnabled();
    await box("Partner und Kinder der Geschwister").check();
    const expected = lineage(null, L.selfEditor, { siblings: true, siblingFamilies: true });
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(expected)} im Export`);
    await expect(dialog.getByTestId("export-count")).toContainText("Geschwister");
    // Geschwister wieder aus: das abhängige Kästchen ist gesperrt und wirkt nicht.
    await box("Geschwister").uncheck();
    await expect(box("Partner und Kinder der Geschwister")).toBeDisabled();
    await expect(box("Partner und Kinder der Geschwister")).not.toBeChecked();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor))} im Export`);
    await box("Geschwister").check();
    await expect(box("Partner und Kinder der Geschwister")).toBeChecked();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(expected)} im Export`);

    const { name, body } = await download(page);
    expect(name).toMatch(new RegExp(`^stammbaum_\\d{4}-\\d{2}-\\d{2}_auswahl-ab-person-${expected}-personen\\.ged$`));
    expect(name).not.toContain("Lehmann");
    const text = body.toString("utf8");
    const parsed = parseGedcom(body);
    expect(parsed.document.persons).toHaveLength(expected);
    expect(parsed.warnings.filter((w) => w.code === "DANGLING_POINTER")).toEqual([]);
    expect(danglingPointers(text)).toEqual([]);

    // Zurück auf „Nach Familien“: alles wie bisher.
    await openDialog(page);
    await chooseMode(dialog, "Ab einer Person");
    await chooseMode(dialog, "Nach Familien");
    await expect(dialog.getByRole("link", { name: "Herunterladen" })).toHaveAttribute("href", "/api/export?format=gedcom");
  });

  test("Generationen hinauf begrenzt die Zahl; ZIP mit Personenzahl im Dateinamen", async ({ page }) => {
    await page.goto(`/admin/data?gedcomPerson=${L.selfEditor}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Generationen hinauf").fill("1");
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor, { generations: 1 }))} im Export`);
    await dialog.getByLabel("Generationen hinauf").fill("");
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor))} im Export`);
    await dialog.getByRole("button", { name: "Abbrechen" }).click();

    // Wieder öffnen (ohne neu zu laden): Art und Person bleiben.
    await page.getByRole("button", { name: "GEDCOM mit Bildern (ZIP)", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "GEDCOM mit Bildern exportieren" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Ab einer Person" })).toBeChecked();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(null, L.selfEditor))} im Export`);
    const zip = await download(page);
    expect(zip.name).toMatch(new RegExp(`_auswahl-ab-person-${lineage(null, L.selfEditor)}-personen\\.zip$`));
  });
});

test.describe("Ab einer Person (Bearbeiter mit eigener Person)", () => {
  test.use({ storageState: authFile("editor") });

  test("vorbelegt mit „Das bin ich“, nur Sichtbares gezählt; Tastatur", async ({ page }) => {
    const { dialog, opener } = await openDialog(page);
    // Umschalten mit den Pfeiltasten (Optionsfelder).
    await dialog.getByRole("radio", { name: "Nach Familien" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Ab einer Person" })).toBeChecked();
    await expect(dialog.getByTestId("export-person-selected")).toHaveText(fullName(L.selfEditor));
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(["A", "B"], L.selfEditor))} im Export`);
    // Gesperrte Vorfahren (nur Familie D) zählen nicht mit.
    expect(lineage(["A", "B"], L.selfEditor)).toBeLessThan(lineage(null, L.selfEditor));
    // Kästchen mit der Leertaste.
    await dialog.getByRole("checkbox", { name: "Partner", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(["A", "B"], L.selfEditor, { partners: true }))} im Export`);
    // „ändern“ → Suche, „mich wählen“ stellt die eigene Person wieder her.
    await dialog.getByRole("button", { name: /^Person ändern/ }).click();
    await expect(dialog.getByTestId("export-person-search")).toBeFocused();
    await expect(dialog.getByTestId("export-person-self")).toHaveCount(0);
    await dialog.getByRole("button", { name: "abbrechen", exact: true }).click();
    await expect(dialog.getByTestId("export-person-selected")).toHaveText(fullName(L.selfEditor));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("Ab einer Person (Betrachter, Einstieg von der Personenseite)", () => {
  test.use({ storageState: authFile("viewer") });

  test("Link auf der Personenseite öffnet den Dialog mit der Person; gesperrte Person → 404", async ({ page }) => {
    await page.goto(`/people/${L.selfEditor}`);
    await page.getByTestId("person-gedcom-export-link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/data\\?gedcomPerson=${L.selfEditor}$`));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Ab einer Person" })).toBeChecked();
    await expect(dialog.getByTestId("export-person-selected")).toHaveText(fullName(L.selfEditor));
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(["A"], L.selfEditor))} im Export`);

    const api = await apiAs("viewer");
    const onlyD = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!.id;
    expect((await api.get(`/api/export/count?person=${onlyD}`)).status()).toBe(404);
    expect((await api.get(`/api/export/count?person=gibt-es-nicht`)).status()).toBe(404);
    expect((await api.get(`/api/export?format=gedcom&person=${onlyD}`)).status()).toBe(404);
    expect((await api.get(`/api/export?format=gedcom&person=${L.selfEditor}&families=${FAMILY.A}`)).status()).toBe(400);
    const counts = await (await api.get(`/api/export/count?person=${L.selfEditor}&siblings=1`)).json();
    expect(counts.total).toBe(lineage(["A"], L.selfEditor, { siblings: true }));
    const ged = await api.get(`/api/export?format=gedcom&person=${L.selfEditor}&siblings=1`);
    expect(parseGedcom(await ged.body()).document.persons).toHaveLength(counts.total);
    await api.dispose();

    // Gesperrte Person in der Adresse: Dialog bleibt zu.
    await page.goto(`/admin/data?gedcomPerson=${onlyD}`);
    await expect(page.getByRole("heading", { name: "Sichern und einspielen" })).toBeVisible();
    await expect(dialog).toBeHidden();
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

test.describe("Ab einer Person auf dem Telefon (390 px)", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("Dialog passt auf den Bildschirm, Tippziele mindestens 44 px, Kästchen per Antippen", async ({ page }) => {
    const { dialog } = await openDialog(page);
    await dialog.getByTestId("export-mode").locator("label").filter({ hasText: "Ab einer Person" }).tap();
    await expect(dialog.getByRole("radio", { name: "Ab einer Person" })).toBeChecked();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(["A", "B"], L.selfEditor))} im Export`);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await expectNoHorizontalOverflow(page);
    const rows = dialog.locator("fieldset li label");
    const targets = [
      ...(await dialog.getByTestId("export-mode").locator("label").all()),
      ...(await rows.all()),
      dialog.getByRole("button", { name: /^Person ändern/ }),
      dialog.getByRole("button", { name: "Abbrechen" }),
      dialog.getByRole("link", { name: "Herunterladen" }),
      dialog.getByLabel("Generationen hinauf"),
    ];
    for (const t of targets) expect((await t.boundingBox())!.height, (await t.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    await rows.filter({ hasText: "Nachkommen der Person" }).tap();
    await expect(dialog.getByRole("checkbox", { name: "Nachkommen der Person", exact: true })).toBeChecked();
    await expect(dialog.getByTestId("export-count")).toContainText(`${persons(lineage(["A", "B"], L.selfEditor, { descendants: true }))} im Export`);
  });
});
