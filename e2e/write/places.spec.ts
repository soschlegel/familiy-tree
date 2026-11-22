import type { APIRequestContext } from "@playwright/test";

import { test, expect, authFile } from "../support/fixtures";
import { apiAs } from "../support/api";
import { mock } from "../support/mock";

/**
 * Orte zuordnen (nur Admins): nicht zuordenbar, zurücksetzen, automatisch
 * zuordnen, Ort aus dem Verzeichnis wählen, Koordinaten von Hand, Protokoll.
 * Dazu der Vorschlag am Ortsfeld (ohne zu speichern) und eine Zuordnung
 * über den KI-Zugang („von KI“, bestätigen).
 * Arbeitet an „Lüneburg“ und „Hannover (Amtsgericht)“ und stellt zum Schluss
 * die automatische Zuordnung wieder her.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const LUENEBURG = "Lüneburg";
const COURT = "Hannover (Amtsgericht)";

test.afterAll(async () => {
  const admin = await apiAs("admin");
  for (const text of [LUENEBURG, COURT]) await admin.put("/api/places", { data: { action: "reset", text } });
  await admin.post("/api/places/auto");
  await admin.dispose();
});

const row = (page: import("@playwright/test").Page, key: string) => page.locator(`[data-testid="place-row"][data-key="${key}"]`);

test("nicht zuordenbar, zurücksetzen, automatisch zuordnen", async ({ page }) => {
  await page.goto("/admin/places?q=l%C3%BCneburg");
  await expect(page.getByRole("heading", { level: 1, name: "Orte zuordnen" })).toBeVisible();
  const r = row(page, "lüneburg");
  await expect(r).toHaveAttribute("data-status", "auto");
  await expect(r.getByTestId("place-assignment")).toContainText("Lüneburg, Niedersachsen, Deutschland");

  await r.getByRole("button", { name: "Nicht zuordenbar" }).click();
  await expect(r).toHaveAttribute("data-status", "unresolvable");
  // Die automatische Zuordnung lässt von Hand Entschiedenes stehen.
  await page.getByTestId("places-auto").click();
  await expect(page.getByTestId("places-auto-result")).toContainText("von Hand bestätigt");
  // Erst weiter, wenn die Seite neu geladen ist (Knopf wieder frei).
  await expect(page.getByTestId("places-auto")).toBeEnabled();
  await expect(r).toHaveAttribute("data-status", "unresolvable");

  await r.getByRole("button", { name: "Zurücksetzen" }).click();
  await expect(r).toHaveAttribute("data-status", "open");
  await expect(r.getByTestId("place-suggestion")).toContainText("Lüneburg, Niedersachsen");
  await page.getByTestId("places-auto").click();
  await expect(page.getByTestId("places-auto-result")).toContainText(/[1-9]\d* neu/);
  await expect(page.getByTestId("places-auto")).toBeEnabled();
  await expect(r).toHaveAttribute("data-status", "auto");
  await r.getByRole("button", { name: "Bestätigen" }).click();
  await expect(r).toHaveAttribute("data-status", "manual");
});

test("Ort im Verzeichnis suchen (alter Name) und Koordinaten von Hand", async ({ page }) => {
  await page.goto("/admin/places?q=amtsgericht");
  const r = row(page, "hannover (amtsgericht)");
  await r.getByRole("button", { name: "Anderen Ort wählen …" }).click();
  const editor = r.getByTestId("place-editor");
  await editor.getByLabel(/Im Ortsverzeichnis suchen/).fill("Breslau");
  await editor.getByTestId("place-search-results").getByRole("button", { name: /^Wrocław/ }).first().click();
  await expect(r).toHaveAttribute("data-status", "manual");
  await expect(r.getByTestId("place-assignment")).toContainText("Wrocław");

  await r.getByRole("button", { name: "Anderen Ort wählen …" }).click();
  await r.getByLabel(/^Breite/).fill("52,37");
  await r.getByLabel(/^Länge/).fill("9,74");
  await r.getByLabel("Bezeichnung (optional)").fill("Amtsgericht Hannover");
  await r.getByRole("button", { name: "Koordinaten speichern" }).click();
  await expect(r.getByTestId("place-assignment")).toContainText("Amtsgericht Hannover");
  await expect(r.getByTestId("place-assignment")).toContainText("52.37, 9.74");

  // Ungültige Eingabe: Meldung, nichts gespeichert.
  await r.getByRole("button", { name: "Anderen Ort wählen …" }).click();
  await r.getByLabel(/^Breite/).fill("123");
  await r.getByLabel(/^Länge/).fill("9");
  await r.getByRole("button", { name: "Koordinaten speichern" }).click();
  await expect(r.getByRole("alert")).toContainText("Breite");
});

test("Änderungen stehen im Protokoll", async ({ page }) => {
  await page.goto("/admin/changes");
  await expect(page.getByText(/Orte automatisch zugeordnet|Ort zugeordnet/).first()).toBeVisible();
});

test("Karte übernimmt die Zuordnung", async () => {
  const admin = await apiAs("admin");
  const view = await (await admin.get("/api/map?mode=all")).json();
  expect(view.payload.places.some((p: { label: string }) => p.label === "Amtsgericht Hannover")).toBe(true);
  await admin.dispose();
});

const secretOf = (key: string) => mock.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;
async function mcpCall(request: APIRequestContext, key: string, name: string, args: Record<string, unknown>) {
  const res = await request.post("/api/mcp", {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${secretOf(key)}`,
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).result as { isError?: boolean; structuredContent?: Record<string, unknown> };
}

test.describe("Vorschlag am Ortsfeld", () => {
  test.use({ storageState: authFile("editor") });
  test("zeigt beim Tippen den erkannten Ort, ohne den Text zu ändern", async ({ page }) => {
    await page.goto("/people/new");
    const field = page.getByLabel("Geburtsort");
    await field.fill("Breslau, Schlesien");
    const hint = page.getByTestId("place-hint").first();
    await expect(hint).toContainText("Wrocław (Breslau), Polen");
    await expect(hint).toContainText("früherer bzw. deutscher Name: Breslau");
    await expect(field).toHaveValue("Breslau, Schlesien");
    await page.getByLabel("Sterbeort").fill("Qxzvwy Nirgendwo");
    await expect(page.getByTestId("place-hint").nth(1)).toContainText("Ort nicht gefunden");
  });
});

test("Zuordnung über den KI-Zugang: „von KI“ mit Begründung, Admin bestätigt", async ({ page, request }) => {
  const r0 = await mcpCall(request, "admin-write", "assign_place", {
    text: LUENEBURG,
    latitude: 53.25,
    longitude: 10.41,
    label: "Lüneburg (Altstadt), Niedersachsen, Deutschland",
    uncertain: true,
    note: "Lage der Altstadt",
  });
  expect(r0.isError, JSON.stringify(r0)).toBeFalsy();
  // Von Hand bestätigt (erster Test) — die KI ändert das nicht.
  expect((r0.structuredContent as { failed: number }).failed).toBe(1);
  const admin = await apiAs("admin");
  await admin.put("/api/places", { data: { action: "reset", text: LUENEBURG } });
  await admin.dispose();
  const r = await mcpCall(request, "admin-write", "assign_place", {
    text: LUENEBURG,
    latitude: 53.25,
    longitude: 10.41,
    label: "Lüneburg (Altstadt), Niedersachsen, Deutschland",
    uncertain: true,
    note: "Lage der Altstadt",
  });
  expect((r.structuredContent as { assigned: number }).assigned).toBe(1);

  await page.goto("/admin/places?status=ai&q=l%C3%BCneburg");
  const rr = row(page, "lüneburg");
  await expect(rr).toHaveAttribute("data-status", "ai");
  await expect(rr.getByTestId("place-status")).toHaveText("von KI");
  await expect(rr.getByTestId("place-uncertain")).toBeVisible();
  await expect(rr.getByTestId("place-note")).toContainText("Begründung der KI: Lage der Altstadt");
  await rr.getByTestId("place-confirm").click();
  // Bestätigt: verschwindet aus dem Filter „von KI“.
  await expect(rr).toHaveCount(0);
  await page.goto("/admin/places?q=l%C3%BCneburg");
  await expect(rr).toHaveAttribute("data-status", "manual");
  await expect(rr.getByTestId("place-assignment")).toContainText("Lüneburg (Altstadt)");
});
