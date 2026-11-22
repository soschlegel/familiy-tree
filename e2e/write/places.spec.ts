import { test, expect, authFile } from "../support/fixtures";
import { apiAs } from "../support/api";

/**
 * Orte zuordnen (nur Admins): nicht zuordenbar, zurücksetzen, automatisch
 * zuordnen, Ort aus dem Verzeichnis wählen, Koordinaten von Hand, Protokoll.
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
  await expect(r).toHaveAttribute("data-status", "unresolvable");

  await r.getByRole("button", { name: "Zurücksetzen" }).click();
  await expect(r).toHaveAttribute("data-status", "open");
  await expect(r.getByTestId("place-suggestion")).toContainText("Lüneburg, Niedersachsen");
  await page.getByTestId("places-auto").click();
  await expect(page.getByTestId("places-auto-result")).toContainText(/[1-9]\d* neu/);
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
