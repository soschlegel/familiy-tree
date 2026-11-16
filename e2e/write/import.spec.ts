import JSZip from "jszip";
import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, deleteSource, tinyPng, uniq, type CreatedPerson } from "../support/api";
import { mock } from "../support/mock";

/**
 * Import als Admin: Vorschau und Ausführung eines geänderten Exports (JSON
 * und ZIP mit Bild), und eine Datei im alten Format (Version 1, ohne
 * Genauigkeit, Quellen und Belege).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

type Exchange = {
  version: number;
  persons: Record<string, unknown>[];
  relationships: Record<string, unknown>[];
  media: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  citations: Record<string, unknown>[];
};

const tag = uniq();
let target: CreatedPerson;
const sourceId = `e2e-import-s-${tag}`;
const citationId = `e2e-import-c-${tag}`;
const mediaId = `e2e-import-m-${tag}`;
const v1Person = `e2e-import-p-${tag}`;
const v1Relationship = `e2e-import-r-${tag}`;

test.beforeAll(async () => {
  const api = await apiAs("admin");
  target = await createPerson(api, {
    givenName: `E2E Import${tag}`,
    familyName: "Testfall",
    birthDate: "12.05.1900",
    familyIds: ["mock-family-a"],
  });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  await deleteSource(api, sourceId);
  for (const id of [v1Person, target?.id]) if (id) await deletePerson(api, id);
  await api.dispose();
});

/**
 * Export holen und auf Mock-Daten plus die eigene Testperson beschränken —
 * Datensätze anderer, gleichzeitig laufender Tests würden sonst durch den
 * Import (der nie löscht) wieder angelegt.
 */
async function exportFor(api: APIRequestContext): Promise<Exchange> {
  const data = (await (await api.get("/api/export?format=json")).json()) as Exchange;
  const keep = new Set(
    data.persons.map((p) => p.id as string).filter((id) => id.startsWith("mock-") || id === target.id),
  );
  data.persons = data.persons.filter((p) => keep.has(p.id as string));
  data.relationships = data.relationships.filter(
    (r) => keep.has(r.fromPersonId as string) && keep.has(r.toPersonId as string),
  );
  const rels = new Set(data.relationships.map((r) => r.id as string));
  data.citations = data.citations.filter((c) => (c.personId ? keep.has(c.personId as string) : rels.has(c.relationshipId as string)));
  data.sources = data.sources.filter((s) => (s.id as string).startsWith("mock-"));
  const sources = new Set(data.sources.map((s) => s.id as string));
  data.citations = data.citations.filter((c) => sources.has(c.sourceId as string));
  const used = new Set([
    ...data.persons.flatMap((p) => (p.media as { mediaId: string }[]).map((m) => m.mediaId)),
    ...data.relationships.flatMap((r) => (r.media as { mediaId: string }[]).map((m) => m.mediaId)),
    ...data.sources.map((s) => s.mediaId as string | null).filter(Boolean),
  ]);
  data.media = data.media.filter((m) => used.has(m.id as string));
  return data;
}

async function chooseFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto("/admin/data");
  await page.getByLabel("Exportdatei (JSON oder ZIP)").setInputFiles({ name, mimeType, buffer });
  await expect(page.getByRole("button", { name: "Import ausführen" })).toBeDisabled();
  await page.getByRole("button", { name: "Vorschau" }).click();
  return page.getByRole("status").filter({ hasText: "Personen:" });
}

test("geänderter JSON-Export: Vorschau, dann Import", async ({ page }) => {
  acceptDialogs(page);
  const api = await apiAs("admin");
  const data = await exportFor(api);
  await api.dispose();
  expect(data.version).toBe(2);
  const persons = data.persons.length;
  const relationships = data.relationships.length;
  const sources = data.sources.length;
  const citations = data.citations.length;
  expect(persons).toBe(mock.persons.length + 1);

  // Änderung: Notiz und ungenaues Geburtsdatum der Testperson, dazu eine
  // neue Quelle mit Beleg für ihre Geburt.
  const p = data.persons.find((x) => x.id === target.id)!;
  expect(p).toMatchObject({ birthDatePrecision: "DAY", birthDateQualifier: "EXACT" });
  p.notes = `Per Import geändert ${tag}`;
  p.birthDate = "1901-01-01T00:00:00.000Z";
  p.birthDatePrecision = "YEAR";
  p.birthDateQualifier = "ABOUT";
  data.sources.push({
    id: sourceId,
    title: `E2E Importquelle ${tag}`,
    kind: "CIVIL_REGISTRY",
    author: null,
    repository: "Standesamt Import",
    callNumber: null,
    url: null,
    date: "1901-03-01T00:00:00.000Z",
    datePrecision: "MONTH",
    dateQualifier: "EXACT",
    notes: null,
    mediaId: null,
  });
  data.citations.push({ id: citationId, sourceId, personId: target.id, relationshipId: null, fact: "BIRTH", detail: "Nr. 4711", confidence: "MEDIUM" });

  const status = await chooseFile(page, "export.json", "application/json", Buffer.from(JSON.stringify(data)));
  await expect(status).toContainText("Vorschau — noch nichts geändert");
  await expect(status).toContainText(`Personen: 0 neu, ${persons} aktualisiert`);
  await expect(status).toContainText(`Beziehungen: 0 neu, ${relationships} aktualisiert`);
  await expect(status).toContainText(`Quellen: 1 neu, ${sources} aktualisiert`);
  await expect(status).toContainText(`Belege: 1 neu, ${citations} aktualisiert`);
  await expect(status).toContainText(`Bilder: 0 neu, ${data.media.length} bereits vorhanden`);
  // Noch nichts geändert.
  const before = await page.request.get(`/api/persons/${target.id}`);
  expect((await before.json()).person.notes).toBeNull();

  await page.getByRole("button", { name: "Import ausführen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Import abgeschlossen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import ausführen" })).toBeDisabled();

  await page.goto(`/people/${target.id}`);
  await expect(page.getByRole("region", { name: "Notizen" })).toContainText(`Per Import geändert ${tag}`);
  await expect(page.getByTestId("person-birth")).toHaveText("um 1901");
  const birth = page.getByTestId("citations-birth");
  await expect(birth).toContainText(`E2E Importquelle ${tag}`);
  await expect(birth).toContainText("Nr. 4711");
  await expect(birth).toContainText("wahrscheinlich");
  await birth.getByRole("link", { name: `E2E Importquelle ${tag}` }).click();
  await expect(page.locator("dl")).toContainText("März 1901");
  await expect(page.locator("dl")).toContainText("Standesamt Import");

  // Mock-Daten unverändert durchgereicht (Genauigkeit bleibt erhalten).
  const otto = await (await page.request.get("/api/persons/mock-p-001")).json();
  expect(otto.person).toMatchObject({ birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT" });
});

test("ZIP-Export mit neuem Bild", async ({ page }) => {
  acceptDialogs(page);
  const api = await apiAs("admin");
  const zipRes = await api.get("/api/export?format=zip");
  expect(zipRes.headers()["content-type"]).toBe("application/zip");
  const zip = await JSZip.loadAsync(await zipRes.body());
  await api.dispose();
  const full = JSON.parse(await zip.file("stammbaum.json")!.async("string")) as Exchange;
  // Wie oben auf Mock-Daten und Testperson beschränken.
  const keep = new Set(full.persons.map((p) => p.id as string).filter((id) => id.startsWith("mock-") || id === target.id));
  full.persons = full.persons.filter((p) => keep.has(p.id as string));
  full.relationships = full.relationships.filter((r) => keep.has(r.fromPersonId as string) && keep.has(r.toPersonId as string));
  full.sources = [];
  full.citations = [];

  const p = full.persons.find((x) => x.id === target.id)!;
  p.media = [{ mediaId, isPrimary: true }];
  full.media.push({ id: mediaId, fileName: `e2e_${tag}.png`, caption: "Per Import", mimeType: "image/png", width: 32, height: 32 });
  zip.file(`media/e2e_${tag}.png`, tinyPng([30, 140, 90], 32));
  zip.file("stammbaum.json", JSON.stringify(full));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const status = await chooseFile(page, "export.zip", "application/zip", buffer);
  await expect(status).toContainText("Bilder: 1 neu");
  await page.getByRole("button", { name: "Import ausführen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Import abgeschlossen" })).toBeVisible();

  await page.goto(`/people/${target.id}`);
  const gallery = page.getByTestId("gallery-person");
  await expect(gallery.getByRole("heading")).toHaveText("Bilder (1)");
  const img = gallery.getByRole("img", { name: "Per Import" });
  await expect(img).toHaveAttribute("src", `/api/media/${mediaId}?variant=thumb`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(gallery.getByText("Porträt", { exact: true })).toBeVisible();
});

test("Datei im alten Format (Version 1) ohne neue Felder", async ({ page }) => {
  acceptDialogs(page);
  const v1 = {
    version: 1,
    exportedAt: "2025-01-01T00:00:00.000Z",
    persons: [
      {
        id: v1Person,
        givenName: `E2E Alt${tag}`,
        familyName: "Version1",
        birthName: null,
        gender: "MALE",
        birthDate: "1925-05-17T00:00:00.000Z",
        birthPlace: "Celle",
        deathDate: null,
        deathPlace: null,
        notes: null,
        media: [],
      },
    ],
    relationships: [
      {
        id: v1Relationship,
        type: "PARENT_OF",
        subtype: "BIOLOGICAL",
        fromPersonId: target.id,
        toPersonId: v1Person,
        startDate: null,
        endDate: null,
        notes: null,
        media: [],
      },
    ],
    media: [],
  };
  const status = await chooseFile(page, "alt.json", "application/json", Buffer.from(JSON.stringify(v1)));
  await expect(status).toContainText("Personen: 1 neu, 0 aktualisiert");
  await expect(status).toContainText("Beziehungen: 1 neu, 0 aktualisiert");
  await page.getByRole("button", { name: "Import ausführen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Import abgeschlossen" })).toBeVisible();

  await page.goto(`/people/${v1Person}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E Alt${tag} Version1`);
  // Ohne Genauigkeit: tagesgenau.
  await expect(page.getByTestId("person-birth")).toHaveText("17.05.1925 in Celle");
  await expect(page.getByTestId("relatives-parents")).toContainText(`${target.givenName} ${target.familyName}`);
  // Ohne Familie nur für Admins sichtbar.
  await expect(page.getByRole("region", { name: "Familien" })).toContainText(
    "keiner Familie zugeordnet",
  );
});

test("kaputte Datei wird mit Meldung abgelehnt", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/status of 400/);
  await page.goto("/admin/data");
  await page.getByLabel("Exportdatei (JSON oder ZIP)").setInputFiles({
    name: "kaputt.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 2, persons: [{ id: "x" }], relationships: [] })),
  });
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Datei entspricht nicht dem Austauschformat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import ausführen" })).toBeDisabled();
});
