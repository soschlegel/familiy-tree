import { test, expect, authFile, acceptDialogs, httpError } from "../support/fixtures";
import {
  apiAs,
  createPerson,
  createRelationship,
  deletePerson,
  deleteSource,
  tinyPng,
  uniq,
  type CreatedPerson,
} from "../support/api";

/**
 * Quellen und Belege als Bearbeiter: Quelle anlegen, für eine Geburt und eine
 * Heirat zitieren, Beleg ändern und entfernen, Detailseite, Scan-Auswahl,
 * Quelle löschen.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const title = `E2E Kirchenbuch ${tag}`;
let sourceId: string;
let inlineSourceId: string | undefined;
let p: CreatedPerson;
let q: CreatedPerson;
let marriageId: string;
let mediaId: string;
const pName = () => `${p.givenName} ${p.familyName}`;
const qName = () => `${q.givenName} ${q.familyName}`;

test.beforeAll(async () => {
  const api = await apiAs("editor");
  p = await createPerson(api, { givenName: `E2E Quellperson${tag}`, familyName: "Testfall", birthDate: "1890", gender: "FEMALE" });
  q = await createPerson(api, { givenName: `E2E Ehepartner${tag}`, familyName: "Testfall", birthDate: "1888", gender: "MALE" });
  marriageId = (
    await createRelationship(api, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: p.id, toPersonId: q.id, startDate: "1912" })
  ).id;
  const upload = await api.post("/api/media", {
    multipart: { personId: p.id, file: { name: `scan-${tag}.png`, mimeType: "image/png", buffer: tinyPng([90, 120, 200]) } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  mediaId = (await upload.json()).id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of [sourceId, inlineSourceId]) if (id) await deleteSource(api, id);
  for (const person of [p, q]) if (person) await deletePerson(api, person.id);
  // Nichts von diesem Lauf darf übrig bleiben (sonst stimmen spätere Zählungen nicht).
  const left = (await (await api.get(`/api/sources?q=${encodeURIComponent(tag)}`)).json()) as { title: string }[];
  expect(left.map((s) => s.title)).toEqual([]);
  await api.dispose();
});

test("Quelle anlegen (mit Prüfung am Feld)", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(400));
  await page.goto("/sources");
  await page.getByRole("link", { name: "Quelle anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Quelle anlegen" })).toBeVisible();

  await page.getByRole("button", { name: "Quelle anlegen" }).click();
  await expect(page.locator("#source-title-error")).toHaveText("Bitte einen Titel angeben.");

  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Art", { exact: true }).selectOption({ label: "Kirchenbuch" });
  await page.getByLabel("Datum der Quelle").fill("um 1880");
  await expect(page.locator("#source-date-hint")).toHaveText("Verstanden als: um 1880");
  await page.getByLabel("Archiv / Aufbewahrungsort").fill("Kirchenbuchamt Teststadt");
  await page.getByLabel("Signatur").fill(`KB ${tag}`);
  await page.getByLabel("Abschrift und Notizen").fill("Taufeintrag, gut lesbar.");
  // Der Server prüft die Adresse.
  await page.getByLabel("Internetadresse").fill("kein-link");
  await page.getByRole("button", { name: "Quelle anlegen" }).click();
  await expect(page.locator("#source-url-error")).toContainText("vollständige Adresse");
  await page.getByLabel("Internetadresse").fill("");
  await page.getByRole("button", { name: "Quelle anlegen" }).click();

  await expect(page).toHaveURL(/\/sources\/[\w-]+\?saved=1$/);
  sourceId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("status")).toHaveText("Quelle gespeichert.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator("dl")).toContainText("Kirchenbuchamt Teststadt");
  await expect(page.locator("dl")).toContainText("um 1880");
  await expect(page.getByTestId("source-citations")).toContainText("Diese Quelle belegt noch nichts.");

  // In der Liste mit Suche.
  await page.goto(`/sources?q=${encodeURIComponent(tag)}`);
  await expect(page.getByTestId("sources-count")).toHaveText("1 Quelle gefunden");
  await expect(page.getByTestId("sources-list")).toContainText("noch kein Beleg");
});

test("für eine Geburt und eine Heirat zitieren", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const section = page.getByTestId("person-sources");
  await expect(section).toContainText("Noch keine Belege erfasst.");

  await section.getByRole("button", { name: "Beleg hinzufügen" }).click();
  const form = section.getByRole("form", { name: "Beleg hinzufügen" });
  await form.getByLabel("Was wird belegt?").selectOption({ label: "Geburt" });
  await form.getByLabel("Quelle", { exact: true }).selectOption({ label: `${title} (Kirchenbuch)` });
  await form.getByLabel("Fundstelle").fill("Taufen 1890, Nr. 7");
  await form.getByLabel("Verlässlichkeit").selectOption({ label: "gesichert" });
  await form.getByRole("button", { name: "Beleg speichern" }).click();
  await expect(section.getByText("Beleg gespeichert.")).toBeVisible();
  const birth = section.getByTestId("citations-birth");
  await expect(birth.getByTestId("citation-row")).toHaveCount(1);
  await expect(birth).toContainText(title);
  await expect(birth).toContainText("Taufen 1890, Nr. 7");
  await expect(birth).toContainText("gesichert");

  // Heirat über die Beziehung — der Verweis „Belege“ öffnet das Formular dafür.
  await page.getByTestId("relationship-editor").getByTestId("relation-row").filter({ hasText: qName() })
    .getByTestId("relation-citations-link").click();
  await expect(form.getByLabel("Was wird belegt?")).toHaveValue(`${marriageId}|PARTNERSHIP`);
  await form.getByLabel("Quelle", { exact: true }).selectOption({ label: `${title} (Kirchenbuch)` });
  await form.getByLabel("Fundstelle").fill("Trauungen 1912, S. 3");
  await form.getByRole("button", { name: "Beleg speichern" }).click();
  await expect(section.getByText("Beleg gespeichert.")).toBeVisible();
  const marriage = section.getByTestId("citations-partnership");
  await expect(marriage).toContainText(`Ehe mit ${qName()}`);
  await expect(marriage).toContainText("Trauungen 1912, S. 3");
  await expect(page.getByTestId("relation-citations-link")).toHaveText("Belege (1)");

  // Der Partner sieht den Heiratsbeleg ebenfalls.
  await page.goto(`/people/${q.id}`);
  await expect(page.getByTestId("citations-partnership")).toContainText(title);
});

test("Beleg ändern", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const row = page.getByTestId("citations-birth").getByTestId("citation-row");
  await row.getByRole("button", { name: "ändern" }).click();
  const editForm = row.getByRole("form", { name: "Beleg ändern" });
  await editForm.getByLabel("Fundstelle").fill("Taufen 1890, Nr. 8");
  await editForm.getByLabel("Verlässlichkeit").selectOption({ label: "unsicher" });
  await editForm.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByTestId("person-sources").getByText("Änderung gespeichert.")).toBeVisible();
  await expect(row).toContainText("Taufen 1890, Nr. 8");
  await expect(row).toContainText("unsicher");
});

test("Detailseite listet, wofür die Quelle zitiert ist", async ({ page }) => {
  await page.goto(`/sources/${sourceId}`);
  const cited = page.getByTestId("source-citations");
  await expect(cited).toContainText("2 Angaben stützen sich auf diese Quelle.");
  // Je Person bzw. Beziehung eine Gruppe
  const rows = cited.getByTestId("source-citation-group");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Geburt" })).toContainText(pName());
  const marriageRow = rows.filter({ hasText: "Heirat & Partnerschaft" });
  await expect(marriageRow).toContainText("Ehe:");
  await expect(marriageRow.getByRole("link", { name: pName() })).toBeVisible();
  await expect(marriageRow.getByRole("link", { name: qName() })).toBeVisible();
  await rows.filter({ hasText: "Geburt" }).getByRole("link", { name: pName() }).click();
  await expect(page).toHaveURL(`/people/${p.id}`);
});

test("Scan aus einem vorhandenen Bild wählen", async ({ page }) => {
  await page.goto(`/sources/${sourceId}`);
  await page.getByRole("link", { name: "Bearbeiten" }).click();
  await expect(page).toHaveURL(`/sources/${sourceId}/edit`);
  // Rundreise des Datums.
  await expect(page.getByLabel("Datum der Quelle")).toHaveValue("um 1880");
  const scan = page.getByLabel("Scan");
  await expect(scan).toHaveValue("");
  await expect(scan.locator("option")).toContainText([`kein Scan`, `Bild ohne Beschriftung — ${pName()}`]);
  await scan.selectOption({ label: `Bild ohne Beschriftung — ${pName()}` });
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page).toHaveURL(`/sources/${sourceId}?saved=1`);
  const img = page.getByRole("img", { name: `Scan zu ${title}` });
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", `/api/media/${mediaId}?variant=thumb`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // Wieder entfernen geht ebenfalls.
  await page.goto(`/sources/${sourceId}/edit`);
  await expect(page.getByLabel("Scan")).toHaveValue(mediaId);
  await page.getByLabel("Scan").selectOption({ label: "kein Scan" });
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.getByRole("img", { name: `Scan zu ${title}` })).toHaveCount(0);
});

test("Beleg entfernen", async ({ page }) => {
  acceptDialogs(page);
  await page.goto(`/people/${p.id}`);
  const section = page.getByTestId("person-sources");
  await section.getByRole("button", { name: `Beleg ${title} entfernen` }).first().click();
  await expect(section.getByText("Beleg entfernt.")).toBeVisible();
  await expect(section.getByTestId("citation-row")).toHaveCount(1);
  await expect(page.getByTestId("citations-birth")).toHaveCount(0);
});

test("neue Quelle direkt beim Zitieren anlegen", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const section = page.getByTestId("person-sources");
  await section.getByRole("button", { name: "Beleg hinzufügen" }).click();
  const form = section.getByRole("form", { name: "Beleg hinzufügen" });
  await form.getByLabel("Was wird belegt?").selectOption({ label: "Name" });
  await form.getByLabel("Quelle", { exact: true }).selectOption({ label: "+ Neue Quelle anlegen…" });
  await form.getByRole("button", { name: "Beleg speichern" }).click();
  await expect(form.getByText("Bitte einen Titel für die neue Quelle angeben.")).toBeVisible();
  await form.getByLabel("Titel der neuen Quelle").fill(`E2E Gespräch ${tag}`);
  await form.getByLabel("Art", { exact: true }).selectOption({ label: "Mündliche Überlieferung" });
  await form.getByRole("button", { name: "Beleg speichern" }).click();
  await expect(section.getByText("Beleg gespeichert.")).toBeVisible();
  const row = section.getByTestId("citations-name").getByTestId("citation-row");
  await expect(row).toContainText(`E2E Gespräch ${tag}`);
  await row.getByRole("link", { name: `E2E Gespräch ${tag}` }).click();
  // Erst auf die Quellenseite warten — sonst stünde hier die Personen-ID, und
  // das Aufräumen ginge ins Leere.
  await page.waitForURL(/\/sources\/[\w-]+$/);
  inlineSourceId = new URL(page.url()).pathname.split("/").pop();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E Gespräch ${tag}`);
});

test("Quelle löschen", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.goto(`/sources/${sourceId}`);
  await page.getByRole("button", { name: "Quelle löschen" }).click();
  await page.waitForURL(/\/sources\?deleted=/);
  expect(dialogs[0]).toContain(`Quelle „${title}“ wirklich löschen?`);
  expect(dialogs[0]).toContain("der Beleg");
  await expect(page.getByRole("status")).toHaveText(`„${title}“ wurde gelöscht.`);

  const api = await apiAs("editor");
  expect((await api.get(`/api/sources/${sourceId}`)).status()).toBe(404);
  await api.dispose();
  await page.goto(`/people/${p.id}`);
  await expect(page.getByTestId("person-sources")).not.toContainText(title);
});
