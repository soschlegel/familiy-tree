import { existsSync } from "node:fs";

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, waitForTree } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, tinyPng, uniq, type CreatedPerson } from "../support/api";

/**
 * Bilder als Bearbeiter: hochladen, Porträt festlegen (erscheint im Baum und
 * in der Personenliste), löschen — und beim Löschen der Person verschwinden
 * auch die Dateien im Mock-Bucket.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

if (existsSync(".env")) process.loadEnvFile(".env");
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9100",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  },
});
// Immer der Mock-Bucket (siehe scripts/mock.mjs), nie der normale.
const BUCKET = process.env.MOCK_S3_BUCKET ?? "familytree-mock";

async function objectExists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "NotFound") return false;
    throw err;
  }
}

type Asset = { id: string; storageKey: string; thumbnailKey: string | null };

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
  expect(await objectExists(assets[0].storageKey)).toBe(false);
});

test("Person löschen entfernt auch ihre Bilddateien", async ({ page }) => {
  const remaining = assets[1];
  expect(await objectExists(remaining.storageKey)).toBe(true);
  if (remaining.thumbnailKey) expect(await objectExists(remaining.thumbnailKey)).toBe(true);

  acceptDialogs(page);
  await page.goto(`/people/${p.id}`);
  await page.getByRole("button", { name: "Person löschen" }).click();
  await page.waitForURL(/\/people\?deleted=/);

  const admin = await apiAs("admin");
  expect((await admin.get(`/api/media/${remaining.id}`)).status()).toBe(404);
  await admin.dispose();
  expect(await objectExists(remaining.storageKey)).toBe(false);
  if (remaining.thumbnailKey) expect(await objectExists(remaining.thumbnailKey)).toBe(false);
});
