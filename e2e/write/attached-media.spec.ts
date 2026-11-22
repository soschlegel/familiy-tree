import { test, expect, authFile, acceptDialogs, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, deleteSource, tinyPng, uniq, type CreatedPerson } from "../support/api";

/**
 * Bilder an Ereignissen, Belegen und Quellen (README, „Bilder an Quellen,
 * Ereignissen und Belegen“) als Bearbeiter: hochladen an ein Ereignis und an
 * eine Quelle, ein vorhandenes Bild an einen Beleg verknüpfen (dann erscheint
 * es nur noch dort), entfernen; Belegbilder getrennt von der Galerie;
 * Betrachter sehen die Bilder ohne Bedienelemente; Telefonbreite.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const title = `E2E Taufbuch ${tag}`;
let p: CreatedPerson;
let eventId: string;
let sourceId: string;
let birthCitation: string;
let eventCitation: string;
let sourceImage: string;

const eventRow = (page: import("@playwright/test").Page) => page.locator(`[data-testid="event-row"][data-event-id="${eventId}"]`);
const citationMedia = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-testid="citation-media"][data-target="citation:${id}"]`);

test.beforeAll(async () => {
  const api = await apiAs("editor");
  p = await createPerson(api, { givenName: `E2E Belegbild${tag}`, familyName: "Testfall", birthDate: "1850" });
  const ev = await api.post(`/api/persons/${p.id}/events`, { data: { type: "BAPTISM", date: "1850", place: "Teststadt" } });
  expect(ev.status(), await ev.text()).toBe(201);
  eventId = (await ev.json()).id;
  const src = await api.post("/api/sources", { data: { title, kind: "CHURCH_BOOK" } });
  expect(src.status(), await src.text()).toBe(201);
  sourceId = (await src.json()).id;
  const c1 = await api.post("/api/citations", { data: { sourceId, personId: p.id, fact: "BIRTH", detail: "S. 12" } });
  expect(c1.status(), await c1.text()).toBe(201);
  birthCitation = (await c1.json()).id;
  const c2 = await api.post("/api/citations", { data: { sourceId, eventId, detail: "S. 13" } });
  expect(c2.status(), await c2.text()).toBe(201);
  eventCitation = (await c2.json()).id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  // Person und Quelle löschen räumt ihre Bilder mit ab (hängen sonst nirgends).
  if (p) await deletePerson(api, p.id);
  if (sourceId) await deleteSource(api, sourceId);
  if (sourceImage) expect((await api.get(`/api/media/${sourceImage}`)).status()).toBe(404);
  await api.dispose();
});

test("Bild an ein Ereignis hochladen — erscheint am Ereignis und unter „Belegbilder“", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const row = eventRow(page);
  await row.getByText("Bild hinzufügen").click();
  await row.getByLabel("Datei hochladen").setInputFiles({ name: `taufe-${tag}.png`, mimeType: "image/png", buffer: tinyPng([20, 120, 90]) });
  await expect(row.getByText("Bild hinzugefügt.")).toBeVisible();
  const img = row.getByRole("img", { name: "Bild zu Taufe 1850" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  // Antippen öffnet das Bild groß (eigener Tab, wie in der Galerie)
  await expect(row.getByRole("link", { name: "Bild zu Taufe 1850 in voller Größe öffnen" })).toHaveAttribute("target", "_blank");

  const docs = page.getByTestId("document-images");
  await expect(docs.getByRole("heading", { name: /Belegbilder/ })).toContainText("(1)");
  // Nicht in der Galerie der Person
  await expect(page.getByTestId("gallery-person").getByRole("img")).toHaveCount(0);
});

test("Bild an die Quelle — Belegbild bei allen Belegen der Quelle", async ({ page }) => {
  await page.goto(`/sources/${sourceId}`);
  const box = page.getByTestId("source-media");
  await box.getByText("Bild hinzufügen").click();
  await box.getByLabel("Datei hochladen").setInputFiles({ name: `titel-${tag}.png`, mimeType: "image/png", buffer: tinyPng([200, 200, 40]) });
  await expect(box.getByText("Bild hinzugefügt.")).toBeVisible();
  await expect(box.getByRole("img", { name: `Bild zu ${title}` })).toBeVisible();

  const api = await apiAs("editor");
  const detail = await (await api.get(`/api/sources/${sourceId}`)).json();
  await api.dispose();
  sourceImage = detail.images[0].mediaId;

  await page.goto(`/people/${p.id}`);
  await expect(citationMedia(page, birthCitation).getByTestId("inherited-image")).toHaveCount(1);
  await expect(citationMedia(page, eventCitation).getByTestId("inherited-image")).toHaveCount(1);
  // Am Ereignis als Bild seines Belegs (neben dem eigenen Ereignisbild)
  await expect(eventRow(page).getByTestId("inherited-image")).toHaveCount(1);
  await expect(page.getByTestId("document-image")).toHaveCount(2);
});

test("Vorhandenes Bild an einen Beleg verknüpfen — dann nur noch dort", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const birth = citationMedia(page, birthCitation);
  await birth.getByText("Bild hinzufügen").click();
  const select = birth.getByLabel("Vorhandenes Bild");
  await select.selectOption({ label: `Bild ohne Beschriftung — Quelle ${title}` });
  await birth.getByRole("button", { name: "Verknüpfen" }).click();
  await expect(birth.getByText("Bild verknüpft.")).toBeVisible();

  await expect(birth.getByTestId("attached-image")).toHaveCount(1);
  await expect(birth.getByTestId("inherited-image")).toHaveCount(0);
  // Der andere Beleg derselben Quelle zeigt es nicht mehr
  await expect(citationMedia(page, eventCitation).getByTestId("inherited-image")).toHaveCount(0);
  await expect(eventRow(page).getByTestId("inherited-image")).toHaveCount(0);

  // Auf der Seite der Quelle: beim Beleg
  await page.goto(`/sources/${sourceId}`);
  await expect(page.getByTestId("source-citation-media").getByRole("img")).toHaveCount(1);
});

test("Betrachter sieht die Bilder ohne Bedienelemente", async ({ loginAs }) => {
  const { page } = await loginAs("viewer");
  await page.goto(`/people/${p.id}`);
  const row = eventRow(page);
  await expect(row.getByRole("img", { name: "Bild zu Taufe 1850" })).toBeVisible();
  await expect(row.getByText("Bild hinzufügen")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  await expect(page.getByTestId("document-image")).toHaveCount(2);
});

test("Telefonbreite: keine Querscrollleiste, Tippziele mindestens 44 px, barrierefrei", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/people/${p.id}`);
  await expect(page.getByTestId("document-images")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const remove = citationMedia(page, birthCitation).getByRole("button", { name: /entfernen/ });
  const box = await remove.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const thumb = eventRow(page).getByRole("link", { name: /in voller Größe öffnen/ }).first();
  const t = await thumb.boundingBox();
  expect(Math.min(t!.width, t!.height)).toBeGreaterThanOrEqual(44);
  await expectNoA11yViolations(page);
});

test("Entfernen: hängt das Bild sonst nirgends, wird es gelöscht", async ({ page }) => {
  acceptDialogs(page);
  await page.goto(`/people/${p.id}`);
  const row = eventRow(page);
  const img = row.getByRole("img", { name: "Bild zu Taufe 1850" });
  const mediaId = (await img.getAttribute("src"))!.match(/\/api\/media\/([^?]+)/)![1];
  await row.getByRole("button", { name: /von Taufe 1850 entfernen/ }).click();
  await expect(row.getByText("Bild entfernt und gelöscht (es hing sonst nirgends).")).toBeVisible();
  await expect(row.getByRole("img", { name: "Bild zu Taufe 1850" })).toHaveCount(0);
  const api = await apiAs("editor");
  expect((await api.get(`/api/media/${mediaId}`)).status()).toBe(404);
  await api.dispose();
});
