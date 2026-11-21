import type { Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, httpError } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, uniq, type CreatedPerson } from "../support/api";
import { familyName } from "../support/mock";

/**
 * Lebenszyklus einer Person als Bearbeiter: anlegen (mit Prüfung am Feld),
 * bearbeiten, Beziehungen verschiedener Art, Familienzuordnung, löschen.
 * Alle Datensätze heißen „E2E …“ und werden am Ende entfernt.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const created: string[] = [];
let main: { id: string; name: string };
const helpers: Record<string, CreatedPerson> = {};

const nameOf = (p: CreatedPerson) => [p.givenName, p.familyName].filter(Boolean).join(" ");

test.beforeAll(async () => {
  const api = await apiAs("editor");
  for (const [key, given, birth] of [
    ["mother", "Mutter", "1925"],
    ["father", "Vater", "1922"],
    ["third", "Dritter", "1920"],
    ["partner", "Partnerin", "1952"],
    ["child", "Kind", "1980"],
  ] as const) {
    helpers[key] = await createPerson(api, { givenName: `E2E ${given}${tag}`, familyName: "Testfall", birthDate: birth });
    created.push(helpers[key].id);
  }
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  // Im Personenwähler neu angelegte Person.
  const res = await api.get(`/api/persons?q=${encodeURIComponent(`Neu${tag}`)}`);
  for (const p of (await res.json()) as { id: string }[]) await deletePerson(api, p.id);
  await api.dispose();
});

test("anlegen: Prüfungen stehen auf Deutsch am Feld", async ({ page }) => {
  await page.goto("/people/new");
  // Die einzige bearbeitbare Familie ist vorgewählt.
  await expect(page.getByRole("button", { name: familyName("A") })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: familyName("B") })).toHaveCount(0);

  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Bitte die markierten Felder prüfen." })).toBeVisible();
  await expect(page.locator("#person-givenName-error")).toHaveText("Bitte einen Vornamen angeben.");
  await expect(page.getByLabel("Vorname")).toHaveAttribute("aria-invalid", "true");

  const given = `E2E Anna${tag}`;
  await page.getByLabel("Vorname").fill(given);
  await expect(page.locator("#person-givenName-error")).toHaveCount(0);
  await page.getByLabel("Nachname").fill("Testfall");
  await page.getByLabel("Geschlecht").selectOption({ label: "weiblich" });
  await page.getByLabel("Geburtsdatum").fill("12.03.1950");
  await expect(page.locator("#person-birthDate-hint")).toHaveText("Verstanden als: 12.03.1950");
  await page.getByLabel("Sterbedatum").fill("1940");
  await expect(page.locator("#person-deathDate-hint")).toHaveText("Verstanden als: 1940");
  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.locator("#person-deathDate-hint")).toHaveText("Sterbedatum liegt vor dem Geburtsdatum.");
  await expect(page.locator("#person-deathDate")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL("/people/new");

  // Unsinn im Datum wird schon beim Tippen benannt.
  await page.getByLabel("Sterbedatum").fill("irgendwann");
  await expect(page.locator("#person-deathDate-hint")).toContainText("ist kein erkennbares Datum");

  await page.getByLabel("Sterbedatum").fill("");
  await page.getByLabel("Geburtsort").fill("Celle");
  await page.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page).toHaveURL(/\/people\/(?!new)[\w-]+$/);
  main = { id: page.url().split("/").pop()!, name: `${given} Testfall` };
  created.push(main.id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(main.name);
  await expect(page.getByTestId("person-birth")).toHaveText("12.03.1950 in Celle");
  await expect(page.getByTestId("person-death")).toHaveText("—");
  await expect(page.locator(".badge-accent").filter({ hasText: familyName("A") })).toBeVisible();
});

test("der Server prüft dieselben Regeln", async () => {
  const api = await apiAs("editor");
  const res = await api.patch(`/api/persons/${main.id}`, { data: { deathDate: "1900" } });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toContain("Sterbedatum liegt vor dem Geburtsdatum");
  const bad = await api.patch(`/api/persons/${main.id}`, { data: { birthDate: "gestern" } });
  expect(bad.status()).toBe(400);
  await api.dispose();
});

test("bearbeiten", async ({ page }) => {
  await page.goto(`/people/${main.id}`);
  await page.getByRole("link", { name: "Bearbeiten" }).click();
  await expect(page).toHaveURL(`/people/${main.id}/edit`);
  await expect(page.getByLabel("Vorname")).toHaveValue(main.name.replace(" Testfall", ""));
  await expect(page.getByLabel("Geburtsdatum")).toHaveValue("12.03.1950");
  await page.getByLabel("Geburtsname").fill("Probe");
  await page.getByLabel("Sterbedatum").fill("2010");
  await page.getByLabel("Notizen").fill("Angelegt vom E2E-Test.");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page).toHaveURL(`/people/${main.id}`);
  await expect(page.getByTestId("person-death")).toHaveText("2010");
  await expect(page.getByRole("region", { name: "Notizen" })).toContainText("Angelegt vom E2E-Test.");
  await expect(page.locator("main header")).toContainText("geb. Probe");
  await expect(page.locator("main header")).toContainText("1950 – 2010");
});

async function addRelation(page: Page, kind: string, who: string, subtype: string, dates: Record<string, string> = {}) {
  const form = page.getByRole("form", { name: "Beziehung hinzufügen" });
  await form.getByLabel("Art").selectOption({ label: kind });
  const picker = form.getByRole("combobox", { name: "Person" });
  await picker.fill(who);
  await form.getByRole("button", { name: new RegExp(`^${who}`) }).first().click();
  await expect(form.getByRole("group", { name: "Person" })).toContainText(who);
  await form.getByLabel("Näheres").selectOption({ label: subtype });
  for (const [label, value] of Object.entries(dates)) await form.getByLabel(label).fill(value);
  await form.getByRole("button", { name: "Hinzufügen" }).click();
}

test("Beziehungen: Eltern, Grenze für leibliche Eltern, Adoption, Partner, Kind", async ({ page, consoleGuard }) => {
  // Die abgelehnte Beziehung antwortet mit 409 — das meldet der Browser.
  consoleGuard.allow(httpError(409));
  acceptDialogs(page);
  await page.goto(`/people/${main.id}`);
  const editor = page.getByTestId("relationship-editor");
  const parents = page.getByTestId("relatives-parents");

  await addRelation(page, "Elternteil", nameOf(helpers.mother), "leiblich");
  await expect(editor.getByText(`Beziehung zu ${nameOf(helpers.mother)} hinzugefügt.`)).toBeVisible();
  await expect(parents).toContainText(nameOf(helpers.mother));

  await addRelation(page, "Elternteil", nameOf(helpers.father), "leiblich");
  await expect(parents).toContainText(nameOf(helpers.father));

  // Ein dritter leiblicher Elternteil wird abgelehnt …
  await addRelation(page, "Elternteil", nameOf(helpers.third), "leiblich");
  await expect(editor.getByRole("alert")).toContainText("bereits 2 leibliche Elternteile");
  await expect(parents).not.toContainText(nameOf(helpers.third));

  // … ein Adoptivelternteil dagegen angenommen.
  await page.getByRole("form", { name: "Beziehung hinzufügen" }).getByRole("button", { name: /^Auswahl .* aufheben$/ }).click();
  await addRelation(page, "Elternteil", nameOf(helpers.third), "adoptiert", { "Adoption am": "05.1955" });
  await expect(editor.getByText(`Beziehung zu ${nameOf(helpers.third)} hinzugefügt.`)).toBeVisible();
  const adoptive = parents.getByRole("listitem").filter({ hasText: nameOf(helpers.third) });
  await expect(adoptive).toContainText("Adoptivelternteil");
  await expect(editor.getByTestId("relation-row").filter({ hasText: nameOf(helpers.third) })).toContainText("adoptiert seit Mai 1955");

  await addRelation(page, "Partner", nameOf(helpers.partner), "verheiratet", { Hochzeitsdatum: "um 1975" });
  await expect(page.getByTestId("relatives-partners")).toContainText(nameOf(helpers.partner));
  await expect(page.getByTestId("relatives-partners")).toContainText("verheiratet seit um 1975");

  await addRelation(page, "Kind", nameOf(helpers.child), "leiblich");
  await expect(page.getByTestId("relatives-children")).toContainText(nameOf(helpers.child));

  // Im Personenwähler direkt anlegen.
  const form = page.getByRole("form", { name: "Beziehung hinzufügen" });
  await form.getByLabel("Art").selectOption({ label: "Kind" });
  await form.getByRole("combobox", { name: "Person" }).fill(`E2E Neu${tag}`);
  await form.getByRole("button", { name: new RegExp(`Neu anlegen: E2E Neu${tag}`) }).click();
  await expect(form.getByRole("group", { name: "Person" })).toContainText(`E2E Neu${tag}`);
  await form.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByTestId("relatives-children")).toContainText(`E2E Neu${tag}`);
  await expect(page.getByTestId("relation-row")).toHaveCount(6);
});

test("Beziehung ändern und entfernen", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(400));
  acceptDialogs(page);
  await page.goto(`/people/${main.id}`);
  const editor = page.getByTestId("relationship-editor");

  const partnerRow = editor.getByTestId("relation-row").filter({ hasText: nameOf(helpers.partner) });
  await partnerRow.getByRole("button", { name: "ändern" }).click();
  await partnerRow.getByLabel("Näheres").selectOption({ label: "geschieden" });
  await partnerRow.getByLabel("Scheidungsdatum").fill("1970");
  await partnerRow.getByRole("button", { name: "Speichern" }).click();
  // Scheidung vor der Hochzeit (um 1975) — für jede Lesart widersprüchlich.
  await expect(editor.getByRole("alert")).toBeVisible();
  await partnerRow.getByLabel("Scheidungsdatum").fill("2001");
  await partnerRow.getByRole("button", { name: "Speichern" }).click();
  await expect(editor.getByText("Änderung gespeichert.")).toBeVisible();
  await expect(partnerRow).toContainText("geschieden, um 1975 – 2001");
  await expect(page.getByTestId("relatives-partners")).toContainText("geschieden · um 1975 – 2001");

  await editor.getByRole("button", { name: `Beziehung zu ${nameOf(helpers.third)} entfernen` }).click();
  await expect(editor.getByText("Beziehung entfernt.")).toBeVisible();
  await expect(page.getByTestId("relatives-parents")).not.toContainText(nameOf(helpers.third));
  await expect(editor.getByTestId("relation-row")).toHaveCount(5);
});

test("Familienzuordnung: Bearbeiter nur in eigenen Familien, Admin frei", async ({ page, loginAs }) => {
  await page.goto(`/people/${main.id}`);
  const section = page.getByRole("region", { name: "Familien" });
  await expect(section.getByRole("button", { name: familyName("A") })).toHaveAttribute("aria-pressed", "true");
  // A ist die einzige zugeordnete Familie, in der der Bearbeiter bearbeiten
  // darf — abwählen würde ihn aussperren, deshalb gesperrt und erklärt.
  await expect(section.getByRole("button", { name: familyName("A") })).toBeDisabled();
  await expect(section.getByRole("button", { name: familyName("A") })).toHaveAttribute(
    "title",
    "Letzte Familie, in der du bearbeiten darfst — lässt sich nicht abwählen",
  );
  await expect(section.getByTestId("person-families-last")).toBeVisible();
  // Familie B darf der Bearbeiter nur lesen.
  await expect(section.getByRole("button", { name: familyName("B") })).toBeDisabled();
  await expect(section.getByRole("button", { name: familyName("B") })).toHaveAttribute("title", "Keine Bearbeitungsrechte in dieser Familie");

  const { page: admin } = await loginAs("admin");
  await admin.goto(`/people/${main.id}`);
  const adminSection = admin.getByRole("region", { name: "Familien" });
  const C = adminSection.getByRole("button", { name: familyName("C") });
  await expect(C).toHaveAttribute("aria-pressed", "false");
  await C.click();
  await expect(C).toHaveAttribute("aria-pressed", "true");
  await expect(admin.locator(".badge-accent").filter({ hasText: familyName("C") })).toBeVisible();
  await C.click();
  await expect(C).toHaveAttribute("aria-pressed", "false");
  await expect(admin.locator(".badge-accent").filter({ hasText: familyName("C") })).toHaveCount(0);
});

test("löschen mit Bestätigung", async ({ page, consoleGuard }) => {
  // Erste Antwort: 409 mit der Zahl der Beziehungen.
  consoleGuard.allow(httpError(409));
  const dialogs: string[] = [];
  let answer = false;
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void (answer ? d.accept() : d.dismiss());
  });
  await page.goto(`/people/${main.id}`);

  // Abbrechen lässt alles, wie es ist.
  await page.getByRole("button", { name: "Person löschen" }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain(`„${main.name}" wirklich löschen?`);
  await expect(page).toHaveURL(`/people/${main.id}`);

  // Zweite Rückfrage nennt die Beziehungen.
  answer = true;
  await page.getByRole("button", { name: "Person löschen" }).click();
  await page.waitForURL(/\/people\?deleted=/);
  expect(dialogs[2]).toContain("noch mit 5 Beziehung(en) verknüpft");
  await expect(page.getByRole("status")).toHaveText(`„${main.name}“ wurde gelöscht.`);

  const api = await apiAs("editor");
  expect((await api.get(`/api/persons/${main.id}`)).status()).toBe(404);
  // Die Verwandten bleiben bestehen.
  expect((await api.get(`/api/persons/${helpers.mother.id}`)).status()).toBe(200);
  await api.dispose();
});
