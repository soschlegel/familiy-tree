import type { APIRequestContext } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow, httpError } from "../support/fixtures";
import { apiAs, createPerson, createRelationship, deletePerson, uniq } from "../support/api";
import { mock } from "../support/mock";

/**
 * Changelog: Abschnitt „Änderungen“ auf der Personenseite (nur Bearbeiter,
 * verborgene Personen bleiben verborgen) und die Übersicht /admin/changes
 * (nur Administratoren) mit einem Paket aus dem KI-Zugang (begin_change_set).
 * Eigene Datensätze „E2E …“, die am Ende entfernt werden; Audit-Einträge und
 * Pakete bleiben bis zum nächsten Setup (wie alle Änderungen).
 */
test.describe.configure({ mode: "serial" });

const tag = uniq().replace(/[^a-z]/g, "");
const surname = `Verlauf${tag}`;
const created: string[] = [];
let personId = "";
let hiddenId = "";

const secretOf = (key: string) => mock.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;
let rpcId = 1;
async function mcpCall(request: APIRequestContext, key: string, name: string, args: Record<string, unknown>) {
  const res = await request.post("/api/mcp", {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${secretOf(key)}`,
    },
    data: { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.status()).toBe(200);
  const result = (await res.json()).result;
  expect(result.isError, JSON.stringify(result)).toBeFalsy();
  return result.structuredContent as Record<string, unknown>;
}

test.beforeAll(async () => {
  const editor = await apiAs("editor");
  const p = await createPerson(editor, { givenName: "E2E Greta", familyName: surname, familyIds: ["mock-family-a"] });
  personId = p.id;
  created.push(p.id);
  const res = await editor.patch(`/api/persons/${p.id}`, { data: { birthPlace: "Altstadt" } });
  expect(res.status()).toBe(200);
  const res2 = await editor.patch(`/api/persons/${p.id}`, { data: { birthPlace: "Neustadt" } });
  expect(res2.status()).toBe(200);
  await editor.dispose();

  // Partner in Familie C — für den Bearbeiter nicht sichtbar.
  const admin = await apiAs("admin");
  const h = await createPerson(admin, { givenName: "E2E Geheim", familyName: surname, familyIds: ["mock-family-c"] });
  hiddenId = h.id;
  created.push(h.id);
  await createRelationship(admin, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: personId, toPersonId: hiddenId });
  await admin.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  await api.dispose();
});

test.describe("als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Personenseite: Änderungen mit vorher → nachher, verborgener Partner bleibt verborgen", async ({ page }) => {
    await page.goto(`/people/${personId}`);
    const section = page.getByTestId("person-changes");
    await expect(section.getByRole("heading", { name: "Änderungen" })).toBeVisible();
    const toggle = section.getByRole("button", { name: "Änderungen anzeigen" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(section.getByTestId("change-entry").first()).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(section.getByRole("button", { name: "Änderungen ausblenden" })).toHaveAttribute("aria-expanded", "true");

    const entries = section.getByTestId("change-entry");
    await expect(entries).toHaveCount(4);
    // Neueste zuerst: die Partnerschaft (vom Admin), dann die beiden Änderungen, dann das Anlegen.
    await expect(entries.nth(0)).toContainText("Beziehung angelegt");
    await expect(entries.nth(0)).toContainText("nicht freigegeben");
    await expect(section).not.toContainText("E2E Geheim");
    await expect(entries.nth(1)).toContainText("Person geändert");
    await expect(entries.nth(1)).toContainText("Geburtsort");
    await expect(entries.nth(1)).toContainText("vorher: Altstadt");
    await expect(entries.nth(1)).toContainText("nachher: Neustadt");
    await expect(entries.nth(1)).toContainText("App");
    await expect(entries.nth(1)).toContainText("Paket „Person geändert“");
    await expect(entries.nth(3)).toContainText("Person angelegt");
    await expect(entries.nth(3)).toContainText("E2E Greta");
    await expectNoA11yViolations(page);
  });

  test("Übersicht und API der Übersicht sind Administratoren vorbehalten", async ({ page, consoleGuard }) => {
    consoleGuard.allow(httpError(403));
    expect((await page.request.get("/api/changes")).status()).toBe(403);
    await page.goto("/admin/changes");
    // Umleitung auf den Baum mit Hinweis (die Fokus-Ansicht schreibt die Adresse danach um).
    await expect(page).toHaveURL(/\/tree(\?|$)/);
    await expect(page.getByRole("alert").filter({ hasText: "fehlt dir die Berechtigung" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Änderungen" })).toHaveCount(0);
  });
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("kein Abschnitt „Änderungen“, API verweigert", async ({ page }) => {
    await page.goto(`/people/${personId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Greta");
    await expect(page.getByTestId("person-changes")).toHaveCount(0);
    expect((await page.request.get(`/api/persons/${personId}/changes`)).status()).toBe(403);
  });
});

test.describe("als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("KI-Paket mit Titel erscheint in der Übersicht, aufklappbar bis zum Feld", async ({ page, request }) => {
    const title = `E2E Kirchenbuch ausgewertet ${tag}`;
    const opened = await mcpCall(request, "editor-write", "begin_change_set", { title });
    const csId = opened.change_set_id as string;
    expect(csId).toBeTruthy();
    await mcpCall(request, "editor-write", "update_person", { person_id: personId, birth_place: "Kirchdorf", change_set_id: csId });
    await mcpCall(request, "editor-write", "add_event", { person_id: personId, type: "BAPTISM", date: "um 1850", place: "Kirchdorf", change_set_id: csId });

    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/admin/changes?family=mock-family-a&channel=MCP&from=${today}`);
    await expect(page.getByRole("heading", { level: 1, name: "Änderungen" })).toBeVisible();
    await expect(page.getByLabel("Familie")).toHaveValue("mock-family-a");
    await expect(page.getByLabel("Kanal")).toHaveValue("MCP");
    const row = page.getByTestId("change-set").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("KI über MCP · Schlüssel „Test: editor-write“");
    await expect(row.getByTestId("change-set-summary")).toHaveText("1 Ereignis angelegt · 1 Person geändert");

    const more = row.getByRole("button", { name: /Einzelheiten/ });
    await expect(async () => {
      if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
      await expect(row.getByTestId("change-entry").first()).toBeVisible({ timeout: 2_000 });
    }).toPass();
    const entries = row.getByTestId("change-entry");
    await expect(entries).toHaveCount(2);
    await expect(row).toContainText("Ereignis „Taufe“ angelegt");
    await expect(row).toContainText("vorher: Neustadt");
    await expect(row).toContainText("nachher: Kirchdorf");
    await expectNoA11yViolations(page);

    // Filter „App“ blendet das KI-Paket aus.
    await page.goto(`/admin/changes?family=mock-family-a&channel=APP&from=${today}`);
    await expect(page.getByTestId("change-set").first()).toBeVisible();
    await expect(page.getByTestId("change-set").filter({ hasText: title })).toHaveCount(0);

    // Auf der Personenseite gehört der Eintrag zum Paket.
    await page.goto(`/people/${personId}`);
    const section = page.getByTestId("person-changes");
    const toggle = section.getByRole("button", { name: "Änderungen anzeigen" });
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(section.getByTestId("change-entry").first()).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(section.getByTestId("change-entry").first()).toContainText(`Paket „${title}“`);
    await expect(section).toContainText("E2E Geheim"); // der Admin sieht alle
  });

  test.describe("Telefon (390 px)", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("Übersicht und aufgeklappter Verlauf ohne waagerechtes Scrollen", async ({ page }) => {
      await page.goto("/admin/changes");
      await expect(page.getByRole("heading", { level: 1, name: "Änderungen" })).toBeVisible();
      const first = page.getByTestId("change-set").first();
      const more = first.getByRole("button", { name: /Einzelheiten/ });
      await expect(async () => {
        if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
        await expect(first.getByTestId("change-entry").first()).toBeVisible({ timeout: 2_000 });
      }).toPass();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/people/${personId}`);
      const section = page.getByTestId("person-changes");
      const toggle = section.getByRole("button", { name: "Änderungen anzeigen" });
      await expect(async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await expect(section.getByTestId("change-entry").first()).toBeVisible({ timeout: 2_000 });
      }).toPass();
      await expectNoHorizontalOverflow(page);
    });
  });
});
