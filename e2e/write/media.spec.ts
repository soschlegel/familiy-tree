import JSZip from "jszip";
import type { Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, waitForTree } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, IMPORT_TIMEOUT, tinyPng, uniq, type CreatedPerson } from "../support/api";

/**
 * Bilder als Bearbeiter: hochladen, Porträt festlegen (erscheint im Baum und
 * in der Personenliste), im ZIP-Export enthalten, löschen — und nach dem
 * Löschen der Person stellt der Import des vorherigen Exports Person und Bild
 * wieder her. Alles nur über die App, ohne direkten Zugriff auf den Speicher —
 * so taugt der Test auch nach einem Wechsel des Speicher-Backends.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

type Asset = { id: string };
let zipBackup: Buffer;

const tag = uniq();
let p: CreatedPerson;
const assets: Asset[] = [];
const name = () => `${p.givenName} ${p.familyName}`;

test.beforeAll(async () => {
  const api = await apiAs("editor");
  p = await createPerson(api, { givenName: `E2E Bild${tag}`, familyName: "Testfall", birthDate: "1950" });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  await deletePerson(api, p.id);
  await api.dispose();
});

async function upload(page: Page, fileName: string, rgb: [number, number, number]) {
  const gallery = page.getByTestId("gallery-person");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/media") && r.request().method() === "POST"),
    gallery.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "image/png", buffer: tinyPng(rgb, 32) }),
  ]);
  expect(response.status()).toBe(201);
  const asset = (await response.json()) as Asset;
  assets.push(asset);
  await expect(gallery.getByText("Bild hochgeladen.")).toBeVisible();
  return asset;
}

test("hochladen und als Porträt festlegen", async ({ page }) => {
  await page.goto(`/people/${p.id}`);
  const gallery = page.getByTestId("gallery-person");
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (0)");
  await expect(gallery.getByText("Bilder hinzufügen")).toBeVisible();

  const first = await upload(page, "erstes.png", [200, 60, 60]);
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (1)");
  // Das erste Bild wird automatisch zum Porträt.
  await expect(gallery.getByRole("listitem").filter({ hasText: "Porträt" })).toHaveCount(1);
  const second = await upload(page, "zweites.png", [60, 160, 60]);
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (2)");

  const secondItem = gallery.getByRole("listitem").filter({ has: page.locator(`img[src="/api/media/${second.id}?variant=thumb"]`) });
  await secondItem.hover();
  await secondItem.getByRole("button", { name: "Als Porträt" }).click();
  await expect(gallery.getByText("Als Porträt festgelegt.")).toBeVisible();
  await expect(secondItem).toContainText("Porträt");
  await expect(secondItem.getByRole("button", { name: "Als Porträt" })).toHaveCount(0);

  // Die Bilder werden tatsächlich ausgeliefert.
  for (const asset of [first, second]) {
    const res = await page.request.get(`/api/media/${asset.id}?variant=thumb`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/webp");
  }
});

test("Porträt erscheint auf der Baumkarte und in der Personenliste", async ({ page }) => {
  const portrait = assets[1];
  await page.goto(`/tree?focus=${p.id}`);
  await waitForTree(page);
  const img = page.locator(`[data-testid="tree-person"][data-person-id="${p.id}"] img`);
  await expect(img).toHaveAttribute("src", `/api/media/${portrait.id}?variant=thumb`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  await page.goto(`/people?q=${encodeURIComponent(p.givenName)}`);
  const item = page.getByTestId("people-list").getByRole("listitem").filter({ hasText: name() });
  await expect(item.locator("img")).toHaveAttribute("src", new RegExp(`/api/media/${portrait.id}`));
});

test("Bild löschen", async ({ page }) => {
  acceptDialogs(page);
  await page.goto(`/people/${p.id}`);
  const gallery = page.getByTestId("gallery-person");
  const firstItem = gallery.getByRole("listitem").filter({ has: page.locator(`img[src="/api/media/${assets[0].id}?variant=thumb"]`) });
  await firstItem.hover();
  await firstItem.getByRole("button", { name: "Bild löschen" }).click();
  await expect(gallery.getByText("Bild gelöscht.")).toBeVisible();
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (1)");
  expect((await page.request.get(`/api/media/${assets[0].id}`)).status()).toBe(404);
});

test("ZIP-Export enthält das Porträt", async () => {
  const api = await apiAs("editor");
  const res = await api.get("/api/export?format=zip");
  expect(res.status()).toBe(200);
  zipBackup = await res.body();
  await api.dispose();
  const zip = await JSZip.loadAsync(zipBackup);
  const data = JSON.parse(await zip.file("stammbaum.json")!.async("string"));
  const entry = data.media.find((m: { id: string }) => m.id === assets[1].id);
  expect(entry, "Bild im Export").toBeTruthy();
  const person = data.persons.find((x: { id: string }) => x.id === p.id);
  expect(person.media).toEqual([{ mediaId: assets[1].id, isPrimary: true }]);
  const file = zip.file(`media/${entry.fileName}`);
  expect(file, entry.fileName).not.toBeNull();
  expect(Buffer.from((await file!.async("uint8array")).slice(8, 12)).toString("ascii")).toBe("WEBP");
});

test("Person löschen entfernt ihr Bild, der Import stellt beides wieder her", async ({ page, loginAs }) => {
  acceptDialogs(page);
  await page.goto(`/people/${p.id}`);
  await page.getByRole("button", { name: "Person löschen" }).click();
  await page.waitForURL(/\/people\?deleted=/);

  const admin = await apiAs("admin");
  // Auch für den Admin weg: das Bild hängt an nichts mehr und ist gelöscht.
  expect((await admin.get(`/api/media/${assets[1].id}`)).status()).toBe(404);
  await admin.dispose();

  // Den vorher gezogenen ZIP-Export auf diese Person beschränken und einspielen.
  const zip = await JSZip.loadAsync(zipBackup);
  const data = JSON.parse(await zip.file("stammbaum.json")!.async("string"));
  data.persons = data.persons.filter((x: { id: string }) => x.id === p.id);
  data.relationships = [];
  data.sources = [];
  data.citations = [];
  data.media = data.media.filter((m: { id: string }) => m.id === assets[1].id);
  zip.file("stammbaum.json", JSON.stringify(data));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const { page: adminPage } = await loginAs("admin");
  adminPage.on("dialog", (d) => void d.accept());
  await adminPage.goto("/admin/data");
  await adminPage.getByLabel("Exportdatei (JSON oder ZIP)").setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer });
  await adminPage.getByRole("button", { name: "Vorschau", exact: true }).click();
  const status = adminPage.getByRole("status").filter({ hasText: "Personen:" });
  // Bild ist wirklich neu — es war mit der Person gelöscht worden.
  await expect(status).toContainText("Personen: 1 neu, 0 aktualisiert");
  await expect(status).toContainText("Bilder: 1 neu, 0 bereits vorhanden");
  await adminPage.getByRole("button", { name: "Import ausführen" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: "Import abgeschlossen" })).toBeVisible({ timeout: IMPORT_TIMEOUT });

  await adminPage.goto(`/people/${p.id}`);
  const gallery = adminPage.getByTestId("gallery-person");
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (1)");
  const img = gallery.locator(`img[src="/api/media/${assets[1].id}?variant=thumb"]`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(gallery.getByText("Porträt", { exact: true })).toBeVisible();
});
