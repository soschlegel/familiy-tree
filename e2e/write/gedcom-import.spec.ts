import JSZip from "jszip";
import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs, deletePerson, deleteSource, IMPORT_TIMEOUT, uniq } from "../support/api";
import { parseGedcom } from "../../lib/gedcom";

/**
 * GEDCOM-Import und -Export über die Oberfläche (/admin/data).
 *
 * Eigene, synthetische Dateien mit eindeutigem Baum (MyHeritage-Kopf mit
 * eigener _PROJECT_GUID) und eindeutigem Nachnamen „E2E Ged<tag>“. Die
 * importierten Personen hängen an einer eigenen Familie oder an keiner; zum
 * Schluss werden Personen, Quellen und Familien über die API gelöscht und
 * offene Vorschauen verworfen. Ausgeführte Läufe bleiben im Importverlauf
 * stehen (nur Admins sehen ihn; das nächste Setup leert ihn).
 *
 * Nie echte Foto-Downloads: die Datei verweist auf example.invalid, und der
 * Haken „Fotos herunterladen“ bleibt aus.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const SURNAME = `E2E Ged${tag}`;
const GUID = `E2E00000-0000-0000-0000-${tag.padStart(12, "0").slice(-12).toUpperCase()}`;
const GUID_SMALL = `E2E00000-0000-0000-0001-${tag.padStart(12, "0").slice(-12).toUpperCase()}`;
const FAMILY_NEW = `E2E GEDCOM-Familie ${tag}`;
const FAMILY_OWN = `E2E GEDCOM-Bestand ${tag}`;
const SOURCE_TITLE = `E2E GEDCOM-Quelle ${tag}`;

let ownFamilyId = "";
let handMadeId = "";
const batches: string[] = [];

type PersonDef = { x: string; given: string; sex: "M" | "F"; birth?: string; place?: string; extra?: string[] };

/** Kleine GEDCOM-5.5.1-Datei im MyHeritage-Stil (Kopf mit _PROJECT_GUID). */
function gedcom(opts: { guid: string; persons: PersonDef[]; families: string[][]; withSource?: boolean }): string {
  const lines = [
    "0 HEAD",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
    "1 SOUR MYHERITAGE",
    "2 NAME MyHeritage Family Tree Builder",
    "1 SUBM @U1@",
    `1 _PROJECT_GUID ${opts.guid}`,
    "0 @U1@ SUBM",
    "1 NAME E2E Einsender",
  ];
  for (const p of opts.persons) {
    lines.push(`0 @${p.x}@ INDI`, `1 _UID ${opts.guid}-${p.x}`, `1 NAME ${p.given} /${SURNAME}/`, `1 SEX ${p.sex}`);
    if (p.birth) {
      lines.push("1 BIRT", `2 DATE ${p.birth}`);
      if (p.place) lines.push(`2 PLAC ${p.place}`);
      if (opts.withSource) lines.push("2 SOUR @S1@", "3 PAGE S. 7");
    }
    lines.push(...(p.extra ?? []));
  }
  opts.families.forEach((f, i) => lines.push(`0 @F${i + 1}@ FAM`, ...f));
  if (opts.withSource) lines.push("0 @S1@ SOUR", `1 TITL ${SOURCE_TITLE}`);
  lines.push("0 TRLR");
  return lines.join("\n") + "\n";
}

const PHOTO = ["1 OBJE", "2 FORM jpg", "2 FILE https://example.invalid/e2e/photo.jpg"];

/** Stand 1: Familie Anton+Berta mit Kind Carl, Emil und Gustav ohne Familie, Frieda wie von Hand angelegt. */
const V1_PERSONS: PersonDef[] = [
  { x: "I1", given: "Anton", sex: "M", birth: "2 FEB 1901", place: "Probstadt", extra: [...PHOTO, "1 _E2E Stand 1"] },
  { x: "I2", given: "Berta", sex: "F", birth: "1903" },
  { x: "I3", given: "Carl", sex: "M", birth: "1926" },
  { x: "I5", given: "Emil", sex: "M", birth: "1930" },
  { x: "I6", given: "Gustav", sex: "M", birth: "1931" },
  { x: "I7", given: "Frieda", sex: "F", birth: "1932", place: "Probstadt" },
];
const V1_FAMILIES = [
  ["1 HUSB @I1@", "1 WIFE @I2@", "1 CHIL @I3@", "1 MARR", "2 DATE 1925"],
  // Ungültig: Carl als Partner seiner eigenen Mutter.
  ["1 HUSB @I3@", "1 WIFE @I2@", "1 MARR", "2 DATE 1950"],
];
const V1 = gedcom({ guid: GUID, persons: V1_PERSONS, families: V1_FAMILIES, withSource: true });

/** Stand 2: Antons Geburtsjahr geändert, Emil und Gustav fehlen, sonst gleich. */
const V2 = gedcom({
  guid: GUID,
  persons: V1_PERSONS.filter((p) => p.x !== "I5" && p.x !== "I6").map((p) => (p.x === "I1" ? { ...p, birth: "2 FEB 1900", extra: [...PHOTO, "1 _E2E Stand 2"] } : p)),
  families: V1_FAMILIES,
  withSource: true,
});

/** Zweiter, unabhängiger Baum für die Familienzuordnung. */
const SMALL = gedcom({
  guid: GUID_SMALL,
  persons: [
    { x: "I1", given: "Hanna", sex: "F", birth: "1940" },
    { x: "I2", given: "Ida", sex: "F", birth: "1942" },
  ],
  families: [],
});

const file = (name: string, content: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(content, "utf8") });

/** Lädt eine Datei hoch und wartet auf die Vorschau; liefert die Lauf-ID. */
async function preview(page: Page, name: string, content: string): Promise<string> {
  await page.goto("/admin/data");
  await page.getByLabel("GEDCOM-Datei").setInputFiles(file(name, content));
  const response = page.waitForResponse((r) => r.url().endsWith("/api/import/gedcom") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Vorschau der GEDCOM-Datei" }).click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(200);
  const id = (await res.json()).batchId as string;
  batches.push(id);
  await expect(page.getByTestId("gedcom-preview")).toBeVisible();
  return id;
}

const tile = (page: Page, group: string) => page.getByTestId(`gedcom-tile-${group}`).getByTestId("gedcom-tile-count");
const group = (page: Page, g: string) => page.getByTestId(`gedcom-group-${g}`);

/** Bestätigungsdialoge annehmen und ihre Texte sammeln. */
function collectDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (d) => {
    seen.push(d.message());
    void d.accept();
  });
  return seen;
}

/** Ausführen und auf das Ergebnis warten. */
async function apply(page: Page) {
  await page.getByRole("button", { name: "GEDCOM-Import ausführen" }).click();
  await expect(page.getByTestId("gedcom-result")).toBeVisible({ timeout: IMPORT_TIMEOUT });
}

/** Nur Anfragen an den eigenen Server — kein Foto-Abruf von außen. */
function watchOutbound(page: Page): string[] {
  const outside: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) outside.push(r.url());
  });
  return outside;
}

async function findPersons(api: APIRequestContext, given?: string) {
  const res = await api.get(`/api/persons?q=${encodeURIComponent(SURNAME)}&limit=200`);
  expect(res.status()).toBe(200);
  const all = (await res.json()) as { id: string; givenName: string; familyName: string | null }[];
  return all.filter((p) => p.familyName === SURNAME && (!given || p.givenName === given));
}

async function onePerson(api: APIRequestContext, given: string) {
  const list = await findPersons(api, given);
  expect(list, `genau eine Person ${given} ${SURNAME}`).toHaveLength(1);
  return list[0];
}

test.beforeAll(async () => {
  const api = await apiAs("admin");
  const fam = await api.post("/api/families", { data: { name: FAMILY_OWN } });
  expect(fam.status(), await fam.text()).toBe(201);
  ownFamilyId = (await fam.json()).id;
  // Von Hand angelegt — der Import soll sie als ähnliche Person vorschlagen.
  const res = await api.post("/api/persons", {
    data: { givenName: "Frieda", familyName: SURNAME, gender: "FEMALE", birthDate: "1932", birthPlace: "Probstadt", familyIds: [ownFamilyId] },
  });
  expect(res.status(), await res.text()).toBe(201);
  handMadeId = (await res.json()).id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of batches) await api.delete(`/api/import/gedcom/${id}`); // nur offene Vorschauen; ausgeführte bleiben
  for (const p of await findPersons(api)) await deletePerson(api, p.id);
  const sources = await api.get(`/api/sources?q=${encodeURIComponent(SOURCE_TITLE)}`);
  for (const s of (await sources.json()) as { id: string }[]) await deleteSource(api, s.id);
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  for (const f of families.filter((x) => x.name === FAMILY_NEW || x.name === FAMILY_OWN)) {
    const del = await api.delete(`/api/families/${f.id}?force=true`);
    expect([200, 204, 404]).toContain(del.status());
  }
  await api.post(`/api/families/${ownFamilyId}/members`, { data: { userId: "mock-user-viewer", role: null } });
  await api.dispose();
});

test("Vorschau: Kacheln, Gruppen, ungültige Beziehung, Baumwahl; Abbrechen verwirft", async ({ page }) => {
  const outside = watchOutbound(page);
  const batchId = await preview(page, `e2e-${tag}.ged`, V1);

  // 6 Personen + 1 gültige Partnerschaft + 1 Eltern-Kind×2 + Ereignisse + Quelle + Beleg — alles neu.
  await expect(tile(page, "new")).not.toHaveText("0");
  await expect(tile(page, "changed")).toHaveText("0");
  await expect(tile(page, "edited")).toHaveText("0");
  await expect(tile(page, "missing")).toHaveText("0");
  await expect(tile(page, "invalid")).toHaveText("1");
  await expect(tile(page, "unchanged")).toHaveText("0");
  await expect(page.getByRole("row", { name: /^Personen/ })).toContainText("6");

  // Ungültig: Carl als Partner seiner Mutter — mit deutschem Grund.
  const invalid = group(page, "invalid");
  await expect(invalid).toHaveAttribute("open", "");
  const rejected = invalid.getByTestId("gedcom-item");
  await expect(rejected).toContainText("Eltern und Kind können nicht als Partner verbunden werden");
  // Nichts geht verloren: das Original der Familie bleibt bei einer beteiligten Person.
  await expect(rejected).toContainText(`nicht übernehmbar, Original bleibt bei Carl ${SURNAME}`);

  // „Was der Import tut“
  const what = page.getByTestId("gedcom-what");
  await expect(what).toContainText("neu angelegt, 0 mit den Werten der Datei aktualisiert");
  await expect(what).toContainText("1 Eintrag verstößt gegen Regeln der App und wird ausgelassen; abgelehnte Beziehungen bleiben samt Ereignissen im Original");
  await expect(what).toContainText("Die Originaldatei wird aufbewahrt");

  // Neuer Baum am Dateikopf erkannt → kein früherer Import; Wechsel auf
  // „Neuer, unabhängiger Baum“ rechnet neu, ohne Fehler.
  await expect(page.getByText("Neuer, unabhängiger Baum.", { exact: true })).toBeVisible();
  const choose = page.getByRole("combobox", { name: "Baum wählen" });
  await expect(choose).toHaveValue("auto");
  const recomputed = page.waitForResponse((r) => r.url().endsWith(`/api/import/gedcom/${batchId}`) && r.request().method() === "POST");
  await choose.selectOption("new");
  expect((await recomputed).status()).toBe(200);
  await expect(choose).toHaveValue("new");
  await expect(tile(page, "invalid")).toHaveText("1");

  // Fotos: Haken aus, Verweis genannt.
  const photo = page.getByRole("checkbox", { name: /Fotos jetzt herunterladen \(1 Verweis\)/ });
  await expect(photo).not.toBeChecked();

  // Vorschlag für die von Hand angelegte Frieda (nur Name und Geburtsjahr → „unklar“);
  // Standard „Neu anlegen“, die Gruppe ist eingeklappt.
  const links = page.getByTestId("gedcom-links");
  await expect(links).toContainText(/Dieser Import hängt über \d+ (Person|Personen) mit vorhandenen Daten zusammen/);
  await expect(links.getByTestId("gedcom-links-chosen")).toHaveText("Noch keine Verknüpfung ausgewählt.");
  await links.getByTestId("gedcom-links-low").locator("summary").click();
  const row = links.getByTestId("gedcom-link-row").filter({ hasText: "Frieda" });
  await expect(row.getByRole("radio", { name: "Neu anlegen" })).toBeChecked();
  await expect(row.getByRole("radio", { name: /Mit vorhandener Person verknüpfen: Frieda/ })).not.toBeChecked();
  await expect(page.getByTestId("gedcom-what-links")).toContainText("Keine Verknüpfung ausgewählt");

  // Abbrechen verwirft den Lauf (DELETE), nichts wurde angelegt.
  const discarded = page.waitForResponse((r) => r.url().endsWith(`/api/import/gedcom/${batchId}`) && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "Abbrechen" }).click();
  expect((await discarded).status()).toBe(200);
  await expect(page.getByTestId("gedcom-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vorschau der GEDCOM-Datei" })).toBeVisible();
  const api = await apiAs("admin");
  expect(await findPersons(api)).toHaveLength(1); // nur die von Hand angelegte Frieda
  const gone = await api.get(`/api/import/gedcom/${batchId}`);
  expect(gone.status()).toBe(404);
  await api.dispose();
  expect(outside).toEqual([]);
});

test("Vorschau ist barrierefrei und passt auf 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preview(page, `e2e-${tag}-schmal.ged`, V1);
  await expect(group(page, "invalid").getByTestId("gedcom-item")).toBeVisible();
  // Abschnitt „Zusammenhang mit vorhandenen Daten“ aufgeklappt mitprüfen.
  await page.getByTestId("gedcom-links-low").locator("summary").click();
  await expect(page.getByTestId("gedcom-link-row").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByTestId("gedcom-preview")).toHaveCount(0);
});

test("erster Import in eine neue Familie: Vorschlag angenommen, ungültige Beziehung ausgelassen, kein Foto-Abruf", async ({ page }) => {
  const dialogs = collectDialogs(page);
  const outside = watchOutbound(page);
  await preview(page, `e2e-${tag}.ged`, V1);

  // Vorschlag annehmen: Datei-Frieda = von Hand angelegte Frieda.
  const links = page.getByTestId("gedcom-links");
  await links.getByTestId("gedcom-links-low").locator("summary").click();
  const row = links.getByTestId("gedcom-link-row").filter({ hasText: "Frieda" });
  await row.getByRole("radio", { name: /Mit vorhandener Person verknüpfen: Frieda/ }).check();
  await expect(links.getByTestId("gedcom-links-chosen")).toContainText("1 Verknüpfung ausgewählt");
  await expect(page.getByTestId("gedcom-what-links")).toContainText("1 Person der Datei wird mit einer vorhandenen Person verknüpft");

  await page.getByRole("radio", { name: "Neue Familie anlegen" }).check();
  await page.getByLabel("Name der neuen Familie").fill(FAMILY_NEW);
  await expect(page.getByRole("checkbox", { name: /Fotos jetzt herunterladen/ })).not.toBeChecked();
  await apply(page);
  expect(dialogs.join("\n")).toContain("Import jetzt ausführen?");
  expect(dialogs.join("\n")).not.toContain("Fotos werden");

  const result = page.getByTestId("gedcom-result");
  await expect(result).toContainText("Import abgeschlossen");
  await expect(result).toContainText("Personen: 5 neu");
  await expect(result).toContainText("1 mit vorhandenen Personen verknüpft");
  await expect(result).toContainText("1 ausgelassen");
  await expect(result).not.toContainText("Fotos:");

  const api = await apiAs("admin");
  // Frieda gibt es nur einmal (zugeordnet statt doppelt angelegt).
  expect((await onePerson(api, "Frieda")).id).toBe(handMadeId);
  expect(await findPersons(api)).toHaveLength(6);
  // Anton: kein Bild gespeichert — der Verweis blieb nur Verweis.
  const anton = await onePerson(api, "Anton");
  const antonDetail = await (await api.get(`/api/persons/${anton.id}`)).json();
  expect(antonDetail.media).toEqual([]);
  // In der neuen Familie.
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  const fam = families.find((f) => f.name === FAMILY_NEW);
  expect(fam).toBeTruthy();
  const inFamily = await api.get(`/api/persons?familyId=${fam!.id}&limit=50`);
  expect(Number(inFamily.headers()["x-total-count"])).toBe(5);
  await api.dispose();
  expect(outside).toEqual([]);

  // Verlauf: Lauf mit Ergebnis und Originaldatei.
  const entry = page.getByTestId("import-entry").filter({ hasText: `e2e-${tag}.ged` });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("ausgeführt");
  const href = await entry.getByRole("link", { name: "Originaldatei" }).getAttribute("href");
  const original = await page.request.get(href!);
  expect(original.status()).toBe(200);
  expect((await original.body()).toString("utf8")).toBe(V1);
});

test("zweiter Import derselben Datei: alles unverändert", async ({ page }) => {
  collectDialogs(page);
  await preview(page, `e2e-${tag}-nochmal.ged`, V1);
  await expect(page.getByText("Aktualisierung eines früheren Imports")).toBeVisible();
  await expect(tile(page, "new")).toHaveText("0");
  await expect(tile(page, "changed")).toHaveText("0");
  await expect(tile(page, "edited")).toHaveText("0");
  await expect(tile(page, "missing")).toHaveText("0");
  await expect(tile(page, "unchanged")).not.toHaveText("0");
  await apply(page);
  await expect(page.getByTestId("gedcom-result")).toContainText("Insgesamt 0 neu, 0 aktualisiert");
});

test("geänderte Datei: in der Datei geändert, in der App geändert (alle + Einzelwahl), fehlend behalten oder ausdrücklich löschen", async ({ page }) => {
  const api = await apiAs("admin");
  const berta = await onePerson(api, "Berta");
  const carl = await onePerson(api, "Carl");
  for (const p of [berta, carl]) {
    const res = await api.patch(`/api/persons/${p.id}`, { data: { notes: `In der App ergänzt ${tag}` } });
    expect(res.status(), await res.text()).toBe(200);
  }

  const dialogs = collectDialogs(page);
  await preview(page, `e2e-${tag}-v2.ged`, V2);
  await expect(tile(page, "changed")).not.toHaveText("0");
  await expect(tile(page, "edited")).toHaveText("2");
  await expect(tile(page, "missing")).not.toHaveText("0");

  // In der Datei geändert: Anton, Geburtsdatum.
  const changed = group(page, "changed");
  await changed.locator("summary").click();
  await expect(changed.getByTestId("gedcom-item").filter({ hasText: "Anton" })).toContainText("Geburtsdatum");

  // In der App geändert: für alle die Dateiversion, Carl als Ausnahme App-Version.
  const edited = group(page, "edited");
  await expect(edited.getByTestId("gedcom-item")).toHaveCount(2);
  await edited.getByRole("radio", { name: "Dateiversion übernehmen" }).check();
  await edited.getByRole("combobox", { name: /^Version für Carl/ }).selectOption("keep");
  await expect(page.getByTestId("gedcom-what")).toContainText("2 in der App geänderte Einträge übernehmen die Dateiversion — 1 davon nach deiner Einzelwahl andersherum");

  // Fehlt in der Datei: standardmäßig behalten; nur Gustav ausdrücklich löschen.
  const missing = group(page, "missing");
  await expect(missing).toHaveAttribute("open", "");
  await expect(page.getByTestId("gedcom-what")).toContainText("gelöscht wird nichts");
  const missingPersons = missing.getByRole("tab", { name: /^Personen/ });
  if (await missingPersons.count()) await missingPersons.click();
  const gustav = missing.getByTestId("gedcom-item").filter({ hasText: "Gustav" });
  await gustav.getByRole("checkbox", { name: "löschen" }).check();
  await expect(page.getByTestId("gedcom-what")).toContainText("1 davon wird auf deinen Wunsch gelöscht");

  await apply(page);
  expect(dialogs.at(-1)).toContain("Achtung: 1 Eintrag wird endgültig gelöscht.");

  // Ergebnis prüfen.
  const anton = (await (await api.get(`/api/persons/${(await onePerson(api, "Anton")).id}`)).json()).person;
  expect(JSON.stringify(anton)).toContain("1900");
  const bertaNow = (await (await api.get(`/api/persons/${berta.id}`)).json()).person;
  expect(bertaNow.notes ?? null).not.toBe(`In der App ergänzt ${tag}`);
  const carlNow = (await (await api.get(`/api/persons/${carl.id}`)).json()).person;
  expect(carlNow.notes).toBe(`In der App ergänzt ${tag}`);
  expect(await findPersons(api, "Emil")).toHaveLength(1);
  expect(await findPersons(api, "Gustav")).toHaveLength(0);
  await api.dispose();
});

test("Importverlauf: offene Vorschau zugeklappt und verwerfbar, überholte Rohdaten entfernen", async ({ page }) => {
  const dialogs = collectDialogs(page);
  const batchId = await preview(page, `e2e-${tag}-offen.ged`, V2);
  // Seite verlassen, ohne auszuführen → offene Vorschau im Verlauf.
  await page.goto("/admin/data");
  const openPreviews = page.locator("#importe details").filter({ hasText: /nicht ausgeführte Vorschau/ });
  await expect(openPreviews).toBeVisible();
  await expect(openPreviews).not.toHaveAttribute("open", "");
  await openPreviews.locator("summary").click();
  const row = openPreviews.locator(`[data-testid="import-preview-entry"][data-batch-id="${batchId}"]`);
  await row.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vorschau verworfen." })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(dialogs.at(-1)).toContain("verwerfen?");

  // Der erste Lauf hat durch Stand 2 überholte Rohdaten: Antons nicht gedeutete Angabe „_E2E“ hat sich geändert.
  const first = page.getByTestId("import-entry").filter({ hasText: `e2e-${tag}.ged` });
  await expect(first).toContainText("überholt");
  await first.getByRole("button", { name: "Überholte Rohdaten entfernen" }).click();
  await expect(page.getByRole("status").filter({ hasText: /überholter? Rohdatens(atz|ätze) entfernt/ })).toBeVisible();
  await expect(first.getByRole("button", { name: "Überholte Rohdaten entfernen" })).toHaveCount(0);
});

test("zweiter Baum: ohne Familie nur für Admins sichtbar, dann in eine vorhandene Familie", async ({ page, loginAs }) => {
  collectDialogs(page);
  await preview(page, `e2e-${tag}-klein.ged`, SMALL);
  await expect(page.getByRole("radio", { name: /Keiner Familie zuordnen/ })).toBeChecked();
  await apply(page);
  const api = await apiAs("admin");
  const hanna = await onePerson(api, "Hanna");

  // Betrachter: Person ohne Familie unsichtbar.
  const viewerApi = await apiAs("viewer");
  expect((await viewerApi.get(`/api/persons/${hanna.id}`)).status()).toBe(404);
  const { page: viewer } = await loginAs("viewer");
  await viewer.goto(`/people?q=${encodeURIComponent(SURNAME)}`);
  await expect(viewer.getByText("Hanna", { exact: false })).toHaveCount(0);

  // Neue Datei-Fassung desselben Baums in die eigene Familie: vorhandene Personen behalten ihre Zuordnung.
  // Deshalb hier: Zuordnung über die Personenseite (Familien setzen) und den Betrachter dazunehmen.
  const put = await api.put(`/api/persons/${hanna.id}/families`, { data: { familyIds: [ownFamilyId] } });
  expect(put.status(), await put.text()).toBe(200);
  const member = await api.post(`/api/families/${ownFamilyId}/members`, { data: { userId: "mock-user-viewer", role: "VIEWER" } });
  expect(member.status(), await member.text()).toBeLessThan(300);
  expect((await viewerApi.get(`/api/persons/${hanna.id}`)).status()).toBe(200);
  await api.post(`/api/families/${ownFamilyId}/members`, { data: { userId: "mock-user-viewer", role: null } });
  await viewerApi.dispose();
  await api.dispose();
});

test("Import in eine vorhandene Familie", async ({ page }) => {
  collectDialogs(page);
  const third = gedcom({
    guid: `${GUID_SMALL}-B`,
    persons: [{ x: "I1", given: "Jakob", sex: "M", birth: "1950" }],
    families: [],
  });
  await preview(page, `e2e-${tag}-dritter.ged`, third);
  await page.getByRole("radio", { name: "Vorhandenen Familien zuordnen" }).check();
  // Vorbelegt ist die erste Familie — nur die eigene ankreuzen.
  const boxes = page.getByTestId("gedcom-preview").locator('input[type="checkbox"]:checked');
  for (const b of await boxes.all()) {
    const label = await b.evaluate((el) => el.parentElement?.textContent ?? "");
    if (!label.includes(FAMILY_OWN) && !label.includes("Fotos")) await b.uncheck();
  }
  await page.getByRole("checkbox", { name: FAMILY_OWN }).check();
  await apply(page);
  const api = await apiAs("admin");
  const jakob = await onePerson(api, "Jakob");
  const inOwn = (await (await api.get(`/api/persons?familyId=${ownFamilyId}&limit=50`)).json()) as { id: string }[];
  expect(inOwn.map((p) => p.id)).toContain(jakob.id);
  await api.dispose();
});

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

/**
 * GEDCOM-Export über den Auswahldialog: Knopf öffnen, optional Familien
 * wählen (`only`: nur diese Familie ankreuzen), „Herunterladen“.
 */
async function dialogDownload(page: Page, button: string, only?: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (only) {
    await dialog.getByRole("button", { name: "Keine auswählen" }).click();
    await dialog.getByRole("checkbox", { name: only, exact: true }).check();
  }
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", { name: "Herunterladen" }).click()]);
  await expect(dialog).toBeHidden();
  return { name: download.suggestedFilename(), body: await streamBuffer(await download.createReadStream()) };
}

/**
 * Lädt einen Export über den Dialog (alles ausgewählt) herunter und liefert
 * ihn zusammen mit der Personenzahl laut API. Parallel laufende Tests legen
 * Personen an und löschen sie; gezählt wird deshalb vor und nach dem
 * Download, und nur ein Durchgang mit gleichem Stand zählt (höchstens 5
 * Versuche). Gleiche Zahl vorher und nachher schließt nicht aus, dass
 * dazwischen eine Person angelegt und eine andere gelöscht wurde; mit
 * `count` (Personen in der Datei) zählt ein Durchgang deshalb nur, wenn auch
 * die Datei diese Zahl hat.
 */
async function stableDownload(
  page: Page,
  api: APIRequestContext,
  button: string,
  count?: (body: Buffer) => number,
) {
  const total = async () => Number((await api.get("/api/persons?limit=1")).headers()["x-total-count"]);
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await total();
    const { body } = await dialogDownload(page, button);
    if ((await total()) !== before) continue;
    if (count && count(body) !== before) continue;
    return { body, persons: before };
  }
  throw new Error("Personenzahl hat sich bei jedem Versuch während des Downloads geändert");
}

test("GEDCOM-Exporte: Admin (GEDCOM und ZIP) mit erwarteten Zahlen, Betrachter ohne verborgene Personen und ohne offene Zeiger", async ({ page, loginAs }) => {
  const api = await apiAs("admin");
  const sourcesOf = async () => Number((await api.get("/api/sources?limit=1")).headers()["x-total-count"]);

  await page.goto("/admin/data");
  const sourcesBefore = await sourcesOf();
  const ged = await stableDownload(page, api, "GEDCOM", (body) => parseGedcom(body).document.persons.length);
  const gedText = ged.body.toString("utf8");
  const doc = parseGedcom(ged.body).document;
  expect(doc.persons).toHaveLength(ged.persons);
  // Quellen legen parallele Tests seltener an — Bereich statt genauer Zahl, wenn sie sich änderte.
  const sourcesAfter = await sourcesOf();
  expect(doc.sources.length).toBeGreaterThanOrEqual(Math.min(sourcesBefore, sourcesAfter));
  expect(doc.sources.length).toBeLessThanOrEqual(Math.max(sourcesBefore, sourcesAfter));
  expect(doc.persons.some((p) => JSON.stringify(p).includes(SURNAME))).toBe(true);
  expect(doc.sources.some((x) => x.title === SOURCE_TITLE)).toBe(true);
  // Die beim Import abgelehnte Familie (Carl ⚭ Berta, Heirat 1950) steht wieder im Export.
  const rejectedFamily = doc.families.find((f) => f.events.some((e) => e.type === "MARRIAGE" && e.date?.original === "1950"));
  expect(rejectedFamily?.partners).toHaveLength(2);
  expect(danglingPointers(gedText)).toEqual([]);

  const zipped = await stableDownload(page, api, "GEDCOM mit Bildern (ZIP)");
  const zip = await JSZip.loadAsync(zipped.body);
  const inner = Object.values(zip.files).find((f) => /.ged$/i.test(f.name));
  expect(inner).toBeTruthy();
  const zipText = await inner!.async("string");
  expect(parseGedcom(Buffer.from(zipText, "utf8")).document.persons).toHaveLength(zipped.persons);
  expect(danglingPointers(zipText)).toEqual([]);
  // Jede Bilddatei im Archiv ist in der .ged verknüpft (auch Hochzeitsbilder und Quellenbilder).
  const mediaFiles = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith("media/"));
  expect(mediaFiles.length).toBeGreaterThan(0);
  for (const f of mediaFiles) expect(zipText).toContain(`FILE ${f.name}`);

  // Teil-Export nur der Importfamilie (Ziel z.B. wieder MyHeritage): genau
  // ihre Personen, die zurückgeschriebene abgelehnte Familie bleibt, kein
  // offener Zeiger — auch nicht aus den aufbewahrten Rohdaten.
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  const importFamily = families.find((f) => f.name === FAMILY_NEW)!;
  const inImportFamily = Number((await api.get(`/api/persons?familyId=${importFamily.id}&limit=1`)).headers()["x-total-count"]);
  await page.reload();
  const part = await dialogDownload(page, "GEDCOM", FAMILY_NEW);
  expect(part.name).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}_auswahl-1-familie\.ged$/);
  const partText = part.body.toString("utf8");
  const partDoc = parseGedcom(part.body).document;
  expect(partDoc.persons).toHaveLength(inImportFamily);
  expect(partText).toContain(SURNAME);
  expect(partDoc.families.some((f) => f.events.some((e) => e.type === "MARRIAGE" && e.date?.original === "1950"))).toBe(true);
  expect(danglingPointers(partText)).toEqual([]);
  // Umgekehrt: nur Mock-Familie A — nichts aus dem Import.
  const other = await dialogDownload(page, "GEDCOM mit Bildern (ZIP)", families.find((f) => f.id === "mock-family-a")!.name);
  const otherZip = await JSZip.loadAsync(other.body);
  const otherText = await otherZip.file("stammbaum.ged")!.async("string");
  expect(otherText).not.toContain(SURNAME);
  expect(danglingPointers(otherText)).toEqual([]);

  // Betrachter (Familie A): nur seine Personen, keine der importierten ohne Familie.
  const viewerApi = await apiAs("viewer");
  const { page: viewer } = await loginAs("viewer");
  await viewer.goto("/admin/data");
  await expect(viewer.getByRole("heading", { name: "GEDCOM importieren" })).toHaveCount(0);
  const v = await stableDownload(viewer, viewerApi, "GEDCOM");
  const vText = v.body.toString("utf8");
  expect(parseGedcom(v.body).document.persons).toHaveLength(v.persons);
  expect(v.persons).toBeLessThan(ged.persons);
  expect(vText).not.toContain(SURNAME);
  expect(danglingPointers(vText)).toEqual([]);
  await viewerApi.dispose();
  await api.dispose();
});

test("Bearbeiter und Betrachter sehen den GEDCOM-Import nicht und bekommen 403", async ({ loginAs }) => {
  for (const role of ["editor", "viewer"] as const) {
    const { page } = await loginAs(role);
    await page.goto("/admin/data");
    await expect(page.getByRole("heading", { name: "Sichern und einspielen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GEDCOM importieren" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Importe" })).toHaveCount(0);
    await expect(page.getByLabel("GEDCOM-Datei")).toHaveCount(0);

    const api = await apiAs(role);
    const upload = await api.post("/api/import/gedcom", { multipart: { file: file("x.ged", SMALL) } });
    expect(upload.status(), `${role}: Hochladen`).toBe(403);
    expect((await api.get("/api/import/batches")).status(), `${role}: Verlauf`).toBe(403);
    const someBatch = batches[0];
    expect((await api.get(`/api/import/gedcom/${someBatch}`)).status(), `${role}: Vorschau`).toBe(403);
    expect((await api.post(`/api/import/gedcom/${someBatch}/apply`, { data: {} })).status(), `${role}: Ausführen`).toBe(403);
    expect((await api.get(`/api/import/batches/${someBatch}/file`)).status(), `${role}: Originaldatei`).toBe(403);
    expect((await api.post("/api/import/batches/prune", { data: { batchId: someBatch } })).status(), `${role}: Rohdaten`).toBe(403);
    await api.dispose();
  }
});

async function streamBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}
