import type { Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs, createPerson, createRelationship, deletePerson, uniq, type CreatedPerson } from "../support/api";

/**
 * Dubletten zusammenführen als Bearbeiter: von der Personenseite über den
 * Personenwähler zum Vergleich, Feld wählen, Zusammenfassung, Bestätigen,
 * Ergebnis; Recherche → Mögliche Dubletten: „kein Duplikat“, sichere Paare in
 * einem Rutsch; Blockade bei verbundenen Personen; Betrachter ohne Knopf und
 * ohne Zugriff. Alle Datensätze heißen „E2E …“ und werden entfernt.
 * Mit MERGE_SCREENS=<Ordner> entstehen Bildschirmfotos (1440 und 390 px).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const created: string[] = [];
const shots = process.env.MERGE_SCREENS;
const surname = `Mergetest${tag.replace(/[^a-z]/g, "")}`;

async function shot(page: Page, name: string) {
  if (!shots) return;
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: `${shots}/${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function person(data: Record<string, unknown>): Promise<CreatedPerson> {
  const api = await apiAs("editor");
  const p = await createPerson(api, { familyName: surname, ...data });
  await api.dispose();
  created.push(p.id);
  return p;
}

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  await api.dispose();
});

test("Personenseite → Vergleich → Zusammenführen: Wahl, Zweitangabe, Ergebnis", async ({ page }) => {
  acceptDialogs(page);
  const keep = await person({ givenName: "E2E Anna", birthDate: "1801-04-02", birthPlace: "Probstadt", notes: "Notiz eins" });
  const other = await person({ givenName: "E2E Anna", birthName: "Kelvaro", birthDate: "1802-01-01", deathDate: "1870-01-05", notes: "Notiz zwei" });

  await page.goto(`/people/${keep.id}`);
  await page.getByTestId("merge-open").click();
  await page.getByPlaceholder("Name der doppelten Person…").fill(`E2E Anna ${surname} 1802`);
  await page.getByRole("button", { name: new RegExp(`E2E Anna ${surname}`) }).first().click();
  await page.getByTestId("merge-compare").click();
  await expect(page).toHaveURL(new RegExp(`/people/merge\\?keep=${keep.id}&other=${other.id}`));

  const view = page.getByTestId("merge-view");
  await expect(view).toBeVisible();
  await page.getByTestId("merge-details").locator("summary").click();
  const birth = page.getByTestId("merge-field-birthDate");
  await expect(birth).toHaveAttribute("data-differs", "true");
  await expect(page.getByTestId("merge-summary")).toContainText("Zweitangabe");
  await expect(page.getByTestId("merge-summary")).toContainText("Sterbe");
  await expectNoA11yViolations(page);
  await shot(page, "merge-view");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Andere Geburtsangabe wählen → Vorschau rechnet neu
  await birth.getByRole("radio").nth(1).check();
  await expect(page.getByTestId("merge-summary")).toContainText("02.04.1801");
  await page.getByTestId("merge-confirm").click();
  const result = page.getByTestId("merge-result");
  await expect(result).toContainText("Zusammengeführt");
  await shot(page, "merge-result");
  await result.getByRole("link", { name: "Zur Person" }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${keep.id}$`));
  await expect(page.getByRole("main")).toContainText("1802");
  await expect((await page.request.get(`/api/persons/${other.id}`)).status()).toBe(404);
});

test("verbundene Personen: Blockade mit Erklärung, Knopf gesperrt", async ({ page }) => {
  const a = await person({ givenName: "E2E Bert", birthDate: "1900" });
  const b = await person({ givenName: "E2E Bert", birthDate: "1900" });
  const api = await apiAs("editor");
  await createRelationship(api, { type: "PARTNER_OF", fromPersonId: a.id, toPersonId: b.id });
  await api.dispose();
  await page.goto(`/people/merge?keep=${a.id}&other=${b.id}`);
  await expect(page.getByTestId("merge-blockers")).toContainText("als Partner eingetragen");
  await expect(page.getByTestId("merge-confirm")).toBeDisabled();
  await shot(page, "merge-blocked");
});

test("Mögliche Dubletten: sicher erkannt, „kein Duplikat“ blendet aus, sichere Paare in einem Rutsch", async ({ page }) => {
  acceptDialogs(page);
  const pairs: CreatedPerson[][] = [];
  for (const given of ["E2E Clara", "E2E Doris", "E2E Emil"]) {
    const gender = given === "E2E Emil" ? "MALE" : "FEMALE";
    pairs.push([
      await person({ givenName: given, gender, birthDate: "1850-03-12", deathDate: "1920-07-01" }),
      await person({ givenName: given, gender, birthDate: "1850-03-12", deathDate: "1920-07-01" }),
    ]);
  }
  await page.goto("/research/duplicates?klasse=high");
  const item = (p: CreatedPerson[]) =>
    page.getByTestId("dup-item").filter({ has: page.locator(`a[href="/people/${p[0].id}"]`) }).filter({ has: page.locator(`a[href="/people/${p[1].id}"]`) });
  for (const p of pairs) await expect(item(p)).toHaveAttribute("data-confidence", "high");
  await expectNoA11yViolations(page);
  await shot(page, "duplicates");

  // „kein Duplikat“
  await item(pairs[0]).getByTestId("dup-dismiss").click();
  await expect(item(pairs[0])).toHaveCount(0);

  // zwei sichere Paare gemeinsam
  for (const p of pairs.slice(1)) await item(p).getByRole("checkbox").check();
  await page.getByTestId("dup-bulk-preview").click();
  const summary = page.getByTestId("dup-bulk-summary");
  await expect(summary).toContainText("2 von 2 Paaren");
  await shot(page, "duplicates-bulk");
  await page.getByTestId("dup-bulk-confirm").click();
  await expect(page.getByTestId("dup-bulk-result")).toContainText("2 Paare zusammengeführt");
  for (const p of pairs.slice(1)) await expect(item(p)).toHaveCount(0);

  // Die ausgeblendeten erscheinen nicht wieder, auch nicht in der Recherche-Übersicht
  await page.goto("/research");
  const dismissed = page
    .getByTestId("research-duplicates")
    .getByTestId("dup-item")
    .filter({ has: page.locator(`a[href="/people/${pairs[0][0].id}"]`) })
    .filter({ has: page.locator(`a[href="/people/${pairs[0][1].id}"]`) });
  await expect(dismissed).toHaveCount(0);
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("kein Zusammenführen-Knopf, Vergleich verweigert", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/403|Forbidden/);
    const a = await person({ givenName: "E2E Viktor" });
    const b = await person({ givenName: "E2E Viktor" });
    await page.goto(`/people/${a.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("merge-open")).toHaveCount(0);
    await page.goto(`/people/merge?keep=${a.id}&other=${b.id}`);
    await expect(page.locator("p.alert-error")).toContainText("Berechtigung");
  });
});
