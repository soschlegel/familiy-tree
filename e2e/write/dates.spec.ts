import { test, expect, authFile, waitForTree } from "../support/fixtures";
import { apiAs, deletePerson, uniq } from "../support/api";

/**
 * Ungenaue Daten über das Formular: Hinweis beim Tippen, Ablehnung von
 * Unsinn, gleiche Anzeige auf Personenseite, Liste und Baumkarte, und
 * unverändert zurück ins Bearbeitungsformular.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const given = `E2E Datum${tag}`;
let id: string;

test.afterAll(async () => {
  if (!id) return;
  const api = await apiAs("admin");
  await deletePerson(api, id);
  await api.dispose();
});

test("Hinweis beim Tippen und Ablehnung von Unsinn", async ({ page }) => {
  await page.goto("/people/new");
  const birth = page.getByLabel("Geburtsdatum");
  const hint = page.locator("#person-birthDate-hint");
  await expect(hint).toContainText("z.B. 1850, 03.1850");

  for (const [input, understood] of [
    ["1850", "1850"],
    ["03.1850", "März 1850"],
    ["März 1850", "März 1850"],
    ["um 1850", "um 1850"],
    ["ca. 1850", "um 1850"],
    ["vor 1900", "vor 1900"],
    ["nach 1723", "nach 1723"],
    ["12.03.1850", "12.03.1850"],
    ["1850-03-12", "12.03.1850"],
  ] as const) {
    await birth.fill(input);
    await expect(hint, input).toHaveText(`Verstanden als: ${understood}`);
    await expect(birth).not.toHaveAttribute("aria-invalid", "true");
  }

  for (const [input, message] of [
    ["31.02.1850", "gibt es nicht"],
    ["13.1850", "Einen Monat 13 gibt es nicht"],
    ["irgendwann", "ist kein erkennbares Datum"],
    ["um", "ist kein erkennbares Datum"],
  ] as const) {
    await birth.fill(input);
    await expect(hint, input).toContainText(message);
    await expect(birth).toHaveAttribute("aria-invalid", "true");
  }

  // Mit Unsinn lässt sich nicht speichern.
  await page.getByLabel("Vorname").fill(given);
  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Bitte die markierten Felder prüfen." })).toBeVisible();
  await expect(page).toHaveURL("/people/new");

  // Unschärfe zählt: „vor 1840“ gestorben, 1850 geboren ist ein Widerspruch …
  await birth.fill("1850");
  await page.getByLabel("Sterbedatum").fill("vor 1840");
  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.locator("#person-deathDate-hint")).toHaveText("Sterbedatum liegt vor dem Geburtsdatum.");
  // … „1850“ und „1850“ dagegen nicht.
  await page.getByLabel("Sterbedatum").fill("1850");
  await expect(page.locator("#person-deathDate-hint")).toHaveText("Verstanden als: 1850");
});

test("„um 1850“ und „vor 1900“: gleiche Anzeige überall", async ({ page }) => {
  await page.goto("/people/new");
  await page.getByLabel("Vorname").fill(given);
  await page.getByLabel("Nachname").fill("Testfall");
  await page.getByLabel("Geburtsdatum").fill("um 1850");
  await page.getByLabel("Sterbedatum").fill("vor 1900");
  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page).toHaveURL(/\/people\/(?!new)[\w-]+$/);
  id = page.url().split("/").pop()!;

  await expect(page.getByTestId("person-birth")).toHaveText("um 1850");
  await expect(page.getByTestId("person-death")).toHaveText("vor 1900");
  await expect(page.locator("main header")).toContainText("um 1850 – vor 1900");

  await page.goto(`/people?q=${encodeURIComponent(given)}`);
  await expect(page.getByTestId("people-list").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("people-list")).toContainText("um 1850 – vor 1900");

  await page.goto(`/tree?focus=${id}`);
  await waitForTree(page);
  await expect(page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`)).toContainText("um 1850 – vor 1900");

  // Gespeichert mit Genauigkeit und Zusatz.
  const api = await apiAs("editor");
  const detail = await (await api.get(`/api/persons/${id}`)).json();
  expect(detail.person).toMatchObject({
    birthDatePrecision: "YEAR",
    birthDateQualifier: "ABOUT",
    deathDatePrecision: "YEAR",
    deathDateQualifier: "BEFORE",
  });
  await api.dispose();
});

test("Rundreise durch das Bearbeitungsformular", async ({ page }) => {
  await page.goto(`/people/${id}/edit`);
  await expect(page.getByLabel("Geburtsdatum")).toHaveValue("um 1850");
  await expect(page.getByLabel("Sterbedatum")).toHaveValue("vor 1900");

  // Unverändert speichern ändert nichts an der Genauigkeit.
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page).toHaveURL(`/people/${id}`);
  await expect(page.getByTestId("person-birth")).toHaveText("um 1850");
  await expect(page.getByTestId("person-death")).toHaveText("vor 1900");

  // Nur Monat.
  await page.goto(`/people/${id}/edit`);
  await page.getByLabel("Geburtsdatum").fill("03.1850");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.getByTestId("person-birth")).toHaveText("März 1850");
  await expect(page.locator("main header")).toContainText("1850 – vor 1900");
  await page.goto(`/people/${id}/edit`);
  await expect(page.getByLabel("Geburtsdatum")).toHaveValue("03.1850");

  // Nur Jahr.
  await page.getByLabel("Geburtsdatum").fill("1850");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.getByTestId("person-birth")).toHaveText("1850");
  await page.goto(`/people/${id}/edit`);
  await expect(page.getByLabel("Geburtsdatum")).toHaveValue("1850");
  await expect(page.getByLabel("Sterbedatum")).toHaveValue("vor 1900");

  // Datum leeren.
  await page.getByLabel("Sterbedatum").fill("");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.getByTestId("person-death")).toHaveText("—");
  await expect(page.locator("main header")).toContainText("* 1850");
});
