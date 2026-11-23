import { test, expect, authFile, acceptDialogs, expectNoA11yViolations } from "../support/fixtures";
import { apiAs, createPerson, createRelationship, deletePerson, deleteSource, uniq } from "../support/api";
import { FAMILY } from "../support/mock";
import type { Page } from "@playwright/test";

/**
 * Lebensereignisse, weitere Namen, Orte und Ehestand auf der Personenseite:
 * anlegen (jede Art, eigenes Ereignis, Datumsbereich, unlesbarer Wortlaut),
 * ändern, löschen, abweichende Hauptangabe, Beleg an einem Ereignis,
 * Beziehungsorte und „Ehestand unbekannt“, Leseansicht für Betrachter und
 * Platzhalter für nicht freigegebene Verwandte. Legt eigene Personen an und
 * räumt sie wieder ab.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const given = `E2E Ereignis${tag}`;
const partnerGiven = `E2E Partnerin${tag}`;
const hiddenGiven = `E2E Verborgen${tag}`;
const sourceTitle = `E2E Kirchenbuch ${tag}`;
const ids: { person?: string; partner?: string; hidden?: string; rel?: string; hiddenRel?: string; source?: string } = {};

test.beforeAll(async () => {
  const editor = await apiAs("editor");
  const admin = await apiAs("admin");
  ids.person = (await createPerson(editor, { givenName: given, familyName: "Testfall", familyIds: [FAMILY.A] })).id;
  ids.partner = (await createPerson(editor, { givenName: partnerGiven, familyName: "Testfall", familyIds: [FAMILY.A] })).id;
  ids.rel = (
    await createRelationship(editor, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: ids.person, toPersonId: ids.partner, startDate: "1880" })
  ).id;
  // Verwandter aus Familie B: für den Betrachter (nur A) ein Platzhalter.
  ids.hidden = (await createPerson(admin, { givenName: hiddenGiven, familyName: "Geheim", familyIds: [FAMILY.B] })).id;
  ids.hiddenRel = (
    await createRelationship(admin, { type: "PARTNER_OF", subtype: "PARTNER_UNKNOWN", fromPersonId: ids.person, toPersonId: ids.hidden })
  ).id;
  const ev = await admin.post(`/api/relationships/${ids.hiddenRel}/events`, {
    data: { type: "ENGAGEMENT", date: "1899", place: "Geheimstadt" },
  });
  expect(ev.status(), await ev.text()).toBe(201);
  const src = await editor.post("/api/sources", { data: { title: sourceTitle, kind: "CHURCH_BOOK" } });
  expect(src.status(), await src.text()).toBe(201);
  ids.source = (await src.json()).id;
  await editor.dispose();
  await admin.dispose();
});

test.afterAll(async () => {
  const admin = await apiAs("admin");
  for (const id of [ids.person, ids.partner, ids.hidden]) if (id) await deletePerson(admin, id);
  if (ids.source) await deleteSource(admin, ids.source);
  await admin.dispose();
});

const events = (page: Page) => page.getByTestId("person-events");
const row = (page: Page, text: string | RegExp) => page.getByTestId("event-row").filter({ hasText: text });

async function addEvent(
  page: Page,
  opts: { owner?: string; type: string; label?: string; date?: string; place?: string; value?: string; valueLabel?: string },
) {
  await events(page).getByRole("button", { name: "Ereignis hinzufügen" }).click();
  const form = page.getByTestId("event-form");
  if (opts.owner) await form.getByLabel("Gehört zu").selectOption({ label: opts.owner });
  await form.getByLabel("Art", { exact: true }).selectOption({ label: opts.type });
  if (opts.label) await form.getByLabel("Bezeichnung des Ereignisses").fill(opts.label);
  if (opts.date) await form.getByLabel("Datum").fill(opts.date);
  if (opts.place) await form.getByLabel("Ort", { exact: true }).fill(opts.place);
  if (opts.value) await form.getByLabel(opts.valueLabel ?? "Beschreibung").fill(opts.value);
  await form.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(events(page).getByText("Ereignis gespeichert.")).toBeVisible();
  await expect(page.getByTestId("event-form")).toHaveCount(0);
}

test("Ereignisse anlegen: Taufe, Beruf, eigenes Ereignis mit Bereich, Verlobung an der Ehe", async ({ page }) => {
  await page.goto(`/people/${ids.person}`);

  await addEvent(page, { type: "Taufe", date: "12.03.1850", place: "Celle" });

  // Das Wertfeld heißt je nach Art anders.
  await events(page).getByRole("button", { name: "Ereignis hinzufügen" }).click();
  const form = page.getByTestId("event-form");
  await form.getByLabel("Art", { exact: true }).selectOption({ label: "Beruf" });
  await expect(form.getByLabel("Beruf")).toBeVisible();
  await form.getByLabel("Art", { exact: true }).selectOption({ label: "Religion" });
  await expect(form.getByLabel("Religion / Konfession")).toBeVisible();
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await addEvent(page, { type: "Beruf", value: "Müller", valueLabel: "Beruf" });

  // Eigenes Ereignis braucht eine Bezeichnung; Datumsbereich mit Hinweis.
  await events(page).getByRole("button", { name: "Ereignis hinzufügen" }).click();
  await form.getByLabel("Art", { exact: true }).selectOption({ label: "Eigenes Ereignis …" });
  await form.getByLabel("Datum").fill("zwischen 1880 und 1885");
  await expect(form.getByTestId("date-hint")).toHaveText("Verstanden als: zwischen 1880 und 1885");
  await form.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(form.getByText("Bitte eine Bezeichnung für das eigene Ereignis angeben.")).toBeVisible();
  await form.getByLabel("Bezeichnung des Ereignisses").fill("Auszeichnung als Schützenkönig");
  await form.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(events(page).getByText("Ereignis gespeichert.")).toBeVisible();

  await addEvent(page, { owner: `Ehe mit ${partnerGiven} Testfall`, type: "Verlobung", date: "1879", place: "Hannover" });

  // Chronologisch, undatierte am Ende; Partnerschaftsereignis mit Partnerin.
  const titles = events(page).getByTestId("event-list").getByTestId("event-title");
  // (Die Verlobung 1899 hängt an der Partnerschaft mit der Person aus Familie B.)
  await expect(titles).toHaveText(["Taufe", "Verlobung", "Auszeichnung als Schützenkönig", "Verlobung", "Beruf"]);
  await expect(row(page, "Taufe").getByTestId("event-date")).toHaveText("12.03.1850");
  await expect(row(page, "Schützenkönig").getByTestId("event-date")).toHaveText("zwischen 1880 und 1885");
  await expect(row(page, "Verlobung").filter({ hasText: "1879" })).toContainText(`mit ${partnerGiven} Testfall`);
  await expect(row(page, "Beruf")).toContainText("— Müller");
  await expect(row(page, "Beruf").getByTestId("event-date")).toHaveText("ohne Datum");
});

test("Ereignis ändern und löschen", async ({ page }) => {
  acceptDialogs(page);
  await page.goto(`/people/${ids.person}`);
  await row(page, "Beruf").getByRole("button", { name: "Beruf ändern" }).click();
  const form = page.getByTestId("event-form");
  await expect(form.getByLabel("Beruf")).toHaveValue("Müller");
  await form.getByLabel("Beruf").fill("Müllermeister");
  await form.getByLabel("Datum").fill("ab 1890");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(events(page).getByText("Änderung gespeichert.")).toBeVisible();
  await expect(row(page, "Beruf")).toContainText("— Müllermeister");
  await expect(row(page, "Beruf").getByTestId("event-date")).toHaveText("ab 1890");

  await row(page, "Taufe").getByRole("button", { name: "Taufe entfernen" }).click();
  await expect(events(page).getByText("Ereignis entfernt.")).toBeVisible();
  await expect(row(page, "Taufe")).toHaveCount(0);
});

test("Abweichende Geburtsangabe: im Kopf neben der Geburt und als eigene Gruppe", async ({ page }) => {
  await page.goto(`/people/${ids.person}`);
  await addEvent(page, { type: "Geburt (abweichende Angabe)", date: "1849", place: "Lüneburg" });
  const alt = page.getByTestId("event-alternatives").getByTestId("event-row");
  await expect(alt).toHaveCount(1);
  await expect(alt.getByTestId("event-alternative")).toHaveText("abweichende Angabe zur Geburt");
  // Nie als Hauptangabe: die Geburt selbst bleibt leer, der Hinweis steht daneben.
  await expect(page.getByTestId("person-birth")).toHaveText("—");
  await expect(page.getByTestId("alternative-fact")).toContainText("1849 in Lüneburg");
  await expect(events(page).getByTestId("event-list").getByText("Geburt", { exact: true })).toHaveCount(0);
});

test("Unlesbarer Wortlaut bleibt erhalten und bearbeitbar", async ({ page }) => {
  await page.goto(`/people/${ids.person}`);
  await events(page).getByRole("button", { name: "Ereignis hinzufügen" }).click();
  const form = page.getByTestId("event-form");
  await form.getByLabel("Art", { exact: true }).selectOption({ label: "Konfirmation/Firmung" });
  await form.getByLabel("Datum").fill("Palmsonntag, Jahr unbekannt");
  await expect(form.getByTestId("date-hint")).toContainText("ist kein erkennbares Datum");
  await form.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.getByTestId("event-form")).toBeVisible();
  await form.getByTestId("date-as-phrase").check();
  await expect(form.getByTestId("date-hint")).toContainText("Wird als Wortlaut gespeichert");
  await form.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(events(page).getByText("Ereignis gespeichert.")).toBeVisible();
  const r = row(page, "Konfirmation");
  await expect(r.getByTestId("event-date")).toHaveText("Palmsonntag, Jahr unbekannt");

  await r.getByRole("button", { name: /ändern$/ }).click();
  await expect(form.getByLabel("Datum")).toHaveValue("Palmsonntag, Jahr unbekannt");
  await expect(form.getByTestId("date-as-phrase")).toBeChecked();
  await form.getByLabel("Datum").fill("Palmsonntag 1864");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(r.getByTestId("event-date")).toHaveText("Palmsonntag 1864");

  // Auch Lebensdaten: Wortlaut im Personenformular.
  await page.goto(`/people/${ids.person}/edit`);
  await page.getByLabel("Sterbedatum").fill("im Krieg verschollen");
  await page.getByTestId("date-as-phrase").check();
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page).toHaveURL(`/people/${ids.person}`);
  await expect(page.getByTestId("person-death")).toHaveText("im Krieg verschollen");
  await page.goto(`/people/${ids.person}/edit`);
  await expect(page.getByLabel("Sterbedatum")).toHaveValue("im Krieg verschollen");
  await expect(page.getByTestId("date-as-phrase")).toBeChecked();
});

test("Beleg an einem Ereignis", async ({ page }) => {
  await page.goto(`/people/${ids.person}`);
  await row(page, "Schützenkönig").getByTestId("event-cite").click();
  const form = page.getByRole("form", { name: "Beleg hinzufügen" });
  await expect(form.getByLabel("Was wird belegt?")).toHaveValue(/^event:.+\|EVENT$/);
  await form.getByLabel("Quelle", { exact: true }).selectOption({ label: `${sourceTitle} (Kirchenbuch)` });
  await form.getByLabel("Fundstelle").fill("S. 12");
  await form.getByRole("button", { name: "Beleg speichern" }).click();
  await expect(page.getByTestId("person-sources").getByText("Beleg gespeichert.")).toBeVisible();
  await expect(row(page, "Schützenkönig").getByTestId("event-citations")).toContainText(sourceTitle);
  await expect(page.getByTestId("citations-event")).toContainText("Auszeichnung als Schützenkönig");

  // Auf der Quellenseite steht der Bezug mit dem Ereignis.
  await page.goto(`/sources/${ids.source}`);
  await expect(page.getByTestId("source-citation")).toContainText("Ereignis: Auszeichnung als Schützenkönig");
});

test("Weitere Namen, Rufname, Zusätze und Todesursache", async ({ page }) => {
  acceptDialogs(page);
  await page.goto(`/people/${ids.person}/edit`);
  await page.getByTestId("person-more").locator("summary").click();
  await page.getByLabel("Rufname / Spitzname").fill("Hannes");
  await page.getByLabel("Namenszusatz vorn (z.B. Dr., Freiherr)").fill("Dr.");
  await page.getByLabel("Todesursache").fill("Lungenentzündung");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page).toHaveURL(`/people/${ids.person}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dr. ${given} Testfall`);
  await expect(page.getByTestId("person-subtitle")).toContainText("genannt „Hannes“");
  await expect(page.getByTestId("person-death-cause")).toHaveText("Ursache: Lungenentzündung");

  const names = page.getByTestId("person-names");
  await names.getByRole("button", { name: "Namen hinzufügen" }).click();
  const form = names.getByTestId("name-form");
  await form.getByLabel("Art des Namens").selectOption({ label: "Schreibvariante" });
  await form.getByLabel("Nachname").fill(`Testfal${tag}`);
  await form.getByRole("button", { name: "Namen speichern" }).click();
  await expect(names.getByText("Name gespeichert.")).toBeVisible();
  await expect(names.getByTestId("name-row")).toContainText(`Testfal${tag}`);
  await expect(names.getByTestId("name-row")).toContainText("Schreibvariante");

  // Suche über den weiteren Namen findet die Person und sagt, warum.
  await page.goto(`/people?q=${encodeURIComponent(`Testfal${tag}`)}`);
  const hit = page.getByTestId("people-list").getByRole("listitem").filter({ hasText: given });
  await expect(hit.getByTestId("match-hint")).toContainText(`auch: Testfal${tag}`);
  await page.goto(`/people?q=Hannes`);
  await expect(
    page.getByTestId("people-list").getByRole("listitem").filter({ hasText: given }).getByTestId("match-hint"),
  ).toContainText("Rufname „Hannes“");

  await page.goto(`/people/${ids.person}`);
  await names.getByRole("button", { name: /ändern$/ }).click();
  await form.getByLabel("Art des Namens").selectOption({ label: "auch bekannt als" });
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(names.getByTestId("name-row")).toContainText("auch bekannt als");
  await names.getByRole("button", { name: /entfernen$/ }).click();
  await expect(names.getByText("Name entfernt.")).toBeVisible();
  await expect(names.getByTestId("name-row")).toHaveCount(0);
});

test("Beziehung: Orte, Ehestand unbekannt und Datumsbereich", async ({ page }) => {
  await page.goto(`/people/${ids.person}`);
  const relRow = page.getByTestId("relation-row").filter({ hasText: partnerGiven });
  await relRow.getByRole("button", { name: "ändern" }).click();
  await relRow.getByLabel("Näheres").selectOption({ label: "Ehestand unbekannt" });
  // Keine Hochzeits-Wortwahl, wenn der Ehestand unbekannt ist.
  await expect(relRow.getByLabel("Hochzeitsdatum")).toHaveCount(0);
  await expect(relRow.getByLabel("Zusammen seit")).toHaveValue("1880");
  await relRow.getByLabel("Ort", { exact: true }).fill("Celle");
  await relRow.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByTestId("relationship-editor").getByText("Änderung gespeichert.")).toBeVisible();
  const card = page.getByTestId("relatives-partners").getByRole("listitem").filter({ hasText: partnerGiven });
  await expect(card).toContainText("Partnerschaft seit 1880 · Ehestand unbekannt");
  await expect(card.getByTestId("partner-places")).toHaveText(/^Beginn in Celle(, Niedersachsen, Deutschland)?$/);
  await expect(relRow).toContainText("Ehestand unbekannt");

  await relRow.getByRole("button", { name: "ändern" }).click();
  await relRow.getByLabel("Näheres").selectOption({ label: "geschieden" });
  await relRow.getByLabel("Hochzeitsdatum").fill("zwischen 1879 und 1881");
  await relRow.getByLabel("Hochzeitsort").fill("Hannover");
  await relRow.getByLabel("Scheidungsdatum").fill("1901");
  await relRow.getByLabel("Scheidungsort").fill("Celle");
  await relRow.getByRole("button", { name: "Speichern" }).click();
  await expect(card).toContainText("geschieden · zwischen 1879 und 1881 – 1901");
  await expect(card.getByTestId("partner-places")).toHaveText(/^Hochzeit in Hannover(, Niedersachsen, Deutschland)? · Scheidung in Celle(, Niedersachsen, Deutschland)?$/);
  await expect(relRow).toContainText("geschieden, zwischen 1879 und 1881 – 1901 · Hannover / Celle");
});

test("Betrachter: alles lesbar, nichts bearbeitbar, Verborgenes bleibt verborgen", async ({ loginAs }) => {
  const { page } = await loginAs("viewer");
  await page.goto(`/people/${ids.person}`);
  await expect(events(page).getByTestId("event-row").first()).toBeVisible();
  await expect(events(page).getByRole("button", { name: "Ereignis hinzufügen" })).toHaveCount(0);
  await expect(events(page).getByRole("button", { name: /ändern$/ })).toHaveCount(0);
  await expect(page.getByTestId("event-cite")).toHaveCount(0);
  await expect(page.getByTestId("alternative-fact")).toBeVisible();
  // Verlobung der verborgenen Partnerschaft: sichtbar, aber ohne Namen.
  await expect(row(page, "Verlobung").filter({ hasText: "1899" })).toContainText("Partner nicht freigegeben");
  await expect(page.getByTestId("relatives-partners").getByTestId("relative-restricted")).toBeVisible();
  expect(await page.content()).not.toContain(hiddenGiven);
  await expectNoA11yViolations(page);
});
