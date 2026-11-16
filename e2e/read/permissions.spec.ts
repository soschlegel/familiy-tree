import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, waitForTree } from "../support/fixtures";
import { apiAs } from "../support/api";
import { L, forbiddenNamesFor, fullName, mock, person } from "../support/mock";

/**
 * Das Kernversprechen: wer nur Familie A sehen darf, erfährt nichts über
 * Personen anderer Familien — weder im sichtbaren Text noch im ausgelieferten
 * HTML (einschließlich der eingebetteten Server-Component-Daten), noch über
 * direkte Adressen oder die API.
 */

const FORBIDDEN_FOR_A = forbiddenNamesFor(["A"]);

/** Prüft das komplette HTML der Seite (inkl. RSC-Nutzlast in <script>). */
async function expectNoForbiddenNames(page: Page, names = FORBIDDEN_FOR_A) {
  const html = await page.content();
  const leaked = names.filter((n) => html.includes(n));
  expect(leaked, `fremde Namen im HTML von ${page.url()}`).toEqual([]);
}

const onlyB = L.inLawOnlyB;
const imageOfOnlyB = mock.images.find((i) => i.personId && !person(i.personId).familyKeys.includes("A"))!;
const imageOfA = mock.images.find((i) => i.personId && person(i.personId).familyKeys.includes("A"))!;
const relationshipInA = mock.relationships.find(
  (r) => person(r.fromPersonId).familyKeys.includes("A") && person(r.toPersonId).familyKeys.includes("A"),
)!;
const citationInA = mock.citations.find((c) => c.personId && person(c.personId).familyKeys.includes("A"))!;

test.describe("Betrachter (nur Familie A)", () => {
  test.use({ storageState: authFile("viewer") });

  test("Personenseite: Verwandte aus Familie B als Platzhalter, kein Name im HTML", async ({ page }) => {
    await page.goto(`/people/${L.crossMarriedIntoA}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(L.crossMarriedIntoA));
    const parents = page.getByTestId("relatives-parents");
    await expect(parents.getByTestId("relative-restricted").first()).toBeVisible();
    await expect(parents.getByTestId("relative-restricted").first()).toContainText("Nicht freigegeben");
    await expect(parents.getByRole("link")).toHaveCount(0);
    await expectNoForbiddenNames(page);
    // Der Titel verrät auch nichts.
    await expect(page).toHaveTitle(`${fullName(L.crossMarriedIntoA)} · Stammbaum`);
  });

  test("Baum: Fokus und ganzer Baum ohne fremde Namen", async ({ page }) => {
    await page.goto(`/tree?focus=${L.crossMarriedIntoA}&up=4&down=4`);
    await waitForTree(page);
    await expect(page.locator('[data-testid="tree-person"][data-restricted="true"]').first()).toBeAttached();
    await expectNoForbiddenNames(page);

    for (const view of ["generations", "timeline"]) {
      await page.goto(`/tree?view=${view}`);
      await waitForTree(page);
      await expect(page.getByTestId("tree-counts")).toContainText("59 Personen");
      await expectNoForbiddenNames(page);
    }
  });

  test("Baumsuche findet keine fremden Personen", async ({ page }) => {
    await page.goto(`/tree?focus=${L.crossMarriedIntoA}`);
    await waitForTree(page);
    await page.locator("#tree-search").fill(person(onlyB).givenName + " " + person(onlyB).familyName);
    await expect(page.getByText("Kein Treffer")).toBeVisible();
  });

  test("Direktaufruf einer Person nur aus Familie B: 404", async ({ page, request, consoleGuard }) => {
    consoleGuard.allow(/Failed to load resource: the server responded with a status of 404/);
    for (const url of [`/people/${onlyB}`, `/people/${onlyB}/edit`]) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(404);
      await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
      await expectNoForbiddenNames(page, [fullName(onlyB)]);
    }
    await page.goto(`/people/${onlyB}`);
    await expect(page).toHaveTitle("Nicht gefunden · Stammbaum");
    // Gleiche Antwort wie für eine Person, die es nicht gibt.
    const res = await page.goto("/people/mock-p-999");
    expect(res?.status()).toBe(404);

    expect((await request.get(`/api/persons/${onlyB}`)).status()).toBe(404);
    expect((await request.get(`/api/persons/mock-p-999`)).status()).toBe(404);
    expect((await request.get(`/api/media/${imageOfOnlyB.id}?variant=thumb`)).status()).toBe(404);
    const search = await request.get(`/api/persons?q=${encodeURIComponent(fullName(onlyB))}`);
    expect(await search.json()).toEqual([]);
    const tree = await (await request.get("/api/tree")).text();
    expect(tree).not.toContain(fullName(onlyB));
  });

  test("Quelle für A und B: keine B-Namen, Hinweis auf verborgene Belege", async ({ page }) => {
    await page.goto(`/sources/${L.sources.crossFamily}`);
    const cited = page.getByTestId("source-citations");
    await expect(cited.getByTestId("source-citation").first()).toBeVisible();
    await expect(page.getByTestId("source-hidden-citations")).toContainText("nicht freigegeben");
    await expect(cited).not.toContainText(fullName(onlyB));
    await expectNoForbiddenNames(page);
    // Ohne Bearbeitungsrecht weder Bearbeiten noch Löschen.
    await expect(page.getByRole("link", { name: "Bearbeiten" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Quelle löschen" })).toHaveCount(0);
  });

  test("Quelle nur aus Familie D: 404", async ({ page, request, consoleGuard }) => {
    consoleGuard.allow(/Failed to load resource: the server responded with a status of 404/);
    const res = await page.goto(`/sources/${L.sources.onlyFamilyD}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
    expect((await request.get(`/api/sources/${L.sources.onlyFamilyD}`)).status()).toBe(404);
    await page.goto("/sources");
    await expect(page.getByTestId("sources-list")).not.toContainText("Kiel");
  });

  test("keine Bearbeitungselemente", async ({ page }) => {
    await page.goto(`/people/${L.founders.A}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(L.founders.A));
    await expect(page.getByRole("link", { name: "Bearbeiten" })).toHaveCount(0);
    await expect(page.getByTestId("relationship-editor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Beleg hinzufügen" })).toHaveCount(0);
    await expect(page.getByText("Bilder hinzufügen")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Person löschen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Als / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bild löschen" })).toHaveCount(0);
    await expect(page.getByTestId("person-sources").getByRole("button", { name: /entfernen|ändern/ })).toHaveCount(0);

    await page.goto("/sources");
    await expect(page.getByRole("link", { name: "Quelle anlegen" })).toHaveCount(0);
    await page.goto(`/sources/${L.sources.churchBookA}`);
    await expect(page.getByRole("link", { name: "Bearbeiten" })).toHaveCount(0);
    await page.goto(`/sources/${L.sources.churchBookA}/edit`);
    await expect(page).toHaveURL(`/sources/${L.sources.churchBookA}`);
    await page.goto(`/people/${L.founders.A}/edit`);
    await expect(page).toHaveURL(`/people/${L.founders.A}`);
    await page.goto("/sources/new");
    await expect(page).toHaveURL("/sources");
    await page.goto("/tree");
    await waitForTree(page);
    await expect(page.getByRole("link", { name: "Person anlegen" })).toHaveCount(0);
  });

  test("API-Änderungen werden abgelehnt (403 bzw. 404)", async () => {
    const api = await apiAs("viewer");
    const A = L.founders.A;
    const before = await (await api.get(`/api/persons/${A}`)).json();

    const cases: [string, () => ReturnType<APIRequestContext["get"]>, number[]][] = [
      ["Person anlegen", () => api.post("/api/persons", { data: { givenName: "E2E Unerlaubt" } }), [403]],
      ["Person ändern", () => api.patch(`/api/persons/${A}`, { data: { notes: "x" } }), [403]],
      ["Person löschen", () => api.delete(`/api/persons/${A}?force=true`), [403]],
      ["fremde Person ändern", () => api.patch(`/api/persons/${onlyB}`, { data: { notes: "x" } }), [404]],
      ["fremde Person löschen", () => api.delete(`/api/persons/${onlyB}?force=true`), [404]],
      ["Familien setzen", () => api.put(`/api/persons/${A}/families`, { data: { familyIds: [] } }), [403]],
      [
        "Beziehung anlegen",
        () => api.post("/api/relationships", { data: { type: "PARTNER_OF", subtype: "UNMARRIED", fromPersonId: A, toPersonId: L.crossMarriedPartnerA } }),
        [403],
      ],
      ["Beziehung ändern", () => api.patch(`/api/relationships/${relationshipInA.id}`, { data: { notes: "x" } }), [403]],
      ["Beziehung löschen", () => api.delete(`/api/relationships/${relationshipInA.id}`), [403]],
      ["Quelle anlegen", () => api.post("/api/sources", { data: { title: "E2E Unerlaubt", kind: "OTHER" } }), [403]],
      ["Quelle ändern", () => api.patch(`/api/sources/${L.sources.churchBookA}`, { data: { title: "x" } }), [403]],
      ["Quelle löschen", () => api.delete(`/api/sources/${L.sources.churchBookA}`), [403]],
      ["fremde Quelle löschen", () => api.delete(`/api/sources/${L.sources.onlyFamilyD}`), [404]],
      [
        "Beleg anlegen",
        () => api.post("/api/citations", { data: { sourceId: L.sources.churchBookA, personId: A, fact: "OTHER" } }),
        [403],
      ],
      ["Beleg ändern", () => api.patch(`/api/citations/${citationInA.id}`, { data: { detail: "x" } }), [403]],
      ["Beleg löschen", () => api.delete(`/api/citations/${citationInA.id}`), [403]],
      ["Bild löschen", () => api.delete(`/api/media/${imageOfA.id}`), [403]],
      ["Porträt setzen", () => api.post(`/api/media/${imageOfA.id}/primary`, { data: { personId: imageOfA.personId } }), [403]],
      [
        "Bild hochladen",
        () => api.post("/api/media", { multipart: { personId: A, file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } } }),
        [403],
      ],
      ["Import", () => api.post("/api/import", { multipart: { file: { name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") } } }), [403]],
      ["Benutzer einladen", () => api.post("/api/users", { data: { email: "e2e-x@example.test", role: "ADMIN" } }), [403]],
      ["Familie anlegen", () => api.post("/api/families", { data: { name: "E2E Unerlaubt" } }), [403]],
    ];
    const results: string[] = [];
    for (const [label, call, expected] of cases) {
      const res = await call();
      if (!expected.includes(res.status())) results.push(`${label}: ${res.status()} ${await res.text()}`);
    }
    expect(results).toEqual([]);

    // Nichts hat sich geändert.
    expect(await (await api.get(`/api/persons/${A}`)).json()).toEqual(before);
    await api.dispose();
  });
});

test.describe("Bearbeiter (A bearbeiten, B lesen)", () => {
  test.use({ storageState: authFile("editor") });

  test("Person aus A: Bearbeiten möglich", async ({ page }) => {
    await page.goto(`/people/${L.founders.A}`);
    await expect(page.getByRole("link", { name: "Bearbeiten" })).toBeVisible();
    await expect(page.getByTestId("relationship-editor")).toBeVisible();
    await page.getByRole("link", { name: "Bearbeiten" }).click();
    await expect(page).toHaveURL(`/people/${L.founders.A}/edit`);
    await expect(page.getByLabel("Vorname")).toHaveValue(person(L.founders.A).givenName);
  });

  test("Person nur aus B: sichtbar, aber nicht bearbeitbar", async ({ page }) => {
    await page.goto(`/people/${onlyB}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullName(onlyB));
    await expect(page.getByRole("link", { name: "Bearbeiten" })).toHaveCount(0);
    await expect(page.getByTestId("relationship-editor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Person löschen" })).toHaveCount(0);
    await expect(page.getByText("Bilder hinzufügen")).toHaveCount(0);
    await page.goto(`/people/${onlyB}/edit`);
    await expect(page).toHaveURL(`/people/${onlyB}`);

    const api = await apiAs("editor");
    expect((await api.patch(`/api/persons/${onlyB}`, { data: { notes: "x" } })).status()).toBe(403);
    expect((await api.delete(`/api/persons/${onlyB}?force=true`)).status()).toBe(403);
    // Eine Person in B anzulegen ist ebenfalls nicht erlaubt.
    const res = await api.post("/api/persons", { data: { givenName: "E2E Unerlaubt", familyIds: ["mock-family-b"] } });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("Person aus C oder D: unsichtbar", async ({ request }) => {
    expect((await request.get(`/api/persons/${L.founders.C}`)).status()).toBe(404);
    expect((await request.get(`/api/persons/${L.founders.D}`)).status()).toBe(404);
    expect((await request.get(`/api/persons/${L.biologicalMotherNoFamily}`)).status()).toBe(404);
  });
});
