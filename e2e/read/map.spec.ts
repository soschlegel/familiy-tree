import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs } from "../support/api";
import { L, fullName, mock, person, visibleFor } from "../support/mock";

/**
 * Karte „Wurzeln nach Jahr“ (README, „Karte und Orte“). Nur lesend; die
 * Ortszuordnung kommt aus dem Mock-Seed (automatisch aus dem Ortsverzeichnis).
 */

type MapApi = {
  mode: string;
  person: { id: string } | null;
  selected: number;
  payload: { persons: { id: string; n: string }[]; places: { label: string }[]; undated: number; yearMin: number; yearMax: number };
};

test.describe("Karte als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("zeigt seine Vorfahren mit Linien, Jahr wechselt ohne Neuladen", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("heading", { level: 1, name: "Wurzeln nach Jahr" })).toBeVisible();
    await expect(page.getByTestId("map-person")).toHaveText(fullName(L.selfEditor));
    await expect(page.getByTestId("map-mode-ancestors")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("map-countries").locator("path").first()).toBeAttached();
    await expect(page.getByTestId("map-circle").first()).toBeAttached();
    await expect(page.getByTestId("map-borders-note")).toHaveText("heutige Grenzen");
    await expect(page.getByTestId("map-attribution")).toContainText("GeoNames");
    // Legende: Linien mit Kurzzeichen, gesperrte Großeltern „nicht erfasst“.
    const legend = page.getByTestId("map-legend");
    await expect(legend.locator('[data-line="FF"]')).toContainText("VV");
    await expect(legend.locator('[data-line="MM"]')).toContainText("nicht erfasst");

    // Jahr per Tastatur am Regler; kein Neuladen (Marker bleibt erhalten).
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    const slider = page.getByTestId("map-year-slider");
    const year = Number(await page.getByTestId("map-year").textContent());
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("map-year")).toHaveText(String(year + 1));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("map-year")).toHaveText(String(year - 1));
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
    await expect(page).toHaveURL(new RegExp(`jahr=${year - 1}`));

    // Abspielen und Anhalten.
    await page.getByTestId("map-play").click();
    await expect(page.getByTestId("map-play")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("map-year")).not.toHaveText(String(year - 1));
    await page.getByTestId("map-play").click();
    await expect(page.getByTestId("map-play")).toHaveAttribute("aria-pressed", "false");
  });

  test("Kreis anklicken zeigt die Personen mit Link, Ortsliste als Alternative", async ({ page }) => {
    await page.goto("/map");
    const circle = page.getByTestId("map-circle").last();
    await expect(circle).toBeAttached();
    const place = await circle.getAttribute("data-place");
    const count = Number(await circle.getAttribute("data-count"));
    await circle.click();
    await expect(page.getByTestId("map-panel").getByRole("heading")).toHaveText(place!);
    const links = page.getByTestId("map-panel-list").getByRole("link");
    await expect(links).toHaveCount(count);
    const href = await links.first().getAttribute("href");
    expect(href).toMatch(/^\/people\//);

    // Dieselben Orte in der Liste; Knopf wählt den Ort.
    const rows = page.getByTestId("map-place-row");
    expect(await rows.count()).toBe(await page.getByTestId("map-circle").count());
    await rows.first().getByRole("button").click();
    await expect(page.getByTestId("map-panel").getByRole("heading")).toBeFocused();
  });

  test("Ausschnitte, Zoom-Knöpfe und Barrierefreiheit", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByTestId("map-circle").first()).toBeAttached();
    const svg = page.getByTestId("map-svg");
    const before = await svg.getAttribute("viewBox");
    await page.getByTestId("map-view-world").click();
    await expect(page.getByTestId("map-view-world")).toHaveAttribute("aria-pressed", "true");
    const world = await svg.getAttribute("viewBox");
    expect(world).not.toBe(before);
    await page.getByRole("button", { name: "Hineinzoomen" }).click();
    expect(await svg.getAttribute("viewBox")).not.toBe(world);
    await page.getByTestId("map-view-europe").click();
    await expect(page.getByTestId("map-view-europe")).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page);
  });

  test("Daten: nur sichtbare Personen, gesperrte Ausgangsperson wird ignoriert", async () => {
    const api = await apiAs("editor");
    const visible = new Set(visibleFor(["A", "B"]).map((p) => p.id));
    for (const mode of ["ancestors", "all"]) {
      const res = await api.get(`/api/map?mode=${mode}`);
      expect(res.ok()).toBe(true);
      const view = (await res.json()) as MapApi;
      expect(view.payload.persons.length).toBeGreaterThan(0);
      for (const p of view.payload.persons) expect(visible.has(p.id), p.id).toBe(true);
      if (mode === "all") expect(view.selected).toBe(visible.size);
    }
    const dOnly = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
    const view = (await (await api.get(`/api/map?person=${dOnly.id}`)).json()) as MapApi;
    expect(view.person?.id).toBe(L.selfEditor);
    expect(JSON.stringify(view)).not.toContain(dOnly.givenName + " " + (dOnly.familyName ?? ""));
    await api.dispose();
  });

  test("andere Ausgangsperson wählen", async ({ page }) => {
    const target = person(L.founders.A);
    await page.goto("/map");
    await page.getByTestId("map-choose-person").click();
    await page.getByPlaceholder("Name eingeben…").fill(`${target.givenName} ${target.familyName}`);
    await page.getByRole("button", { name: new RegExp(`^${target.givenName} ${target.familyName}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`person=${L.founders.A}`));
    await expect(page.getByTestId("map-person")).toHaveText(fullName(L.founders.A));
    await page.getByTestId("map-mode-all").click();
    await expect(page.getByTestId("map-mode-all")).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(/mode=alle/);
  });
});

test.describe("Karte: weitere Rollen", () => {
  test("Betrachter ohne eigene Person: alle sichtbaren, ohne Linien", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("viewer") });
    const page = await ctx.newPage();
    await page.goto("/map");
    await expect(page.getByTestId("map-mode-all")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("map-legend").locator("[data-line]")).toHaveCount(0);
    await expect(page.getByTestId("map-admin-hint")).toHaveCount(0);
    await ctx.close();
  });

  test("ohne Familie: keine Personen, keine Zahlen", async () => {
    const api = await apiAs("nofamily");
    const view = (await (await api.get("/api/map?mode=all")).json()) as MapApi;
    expect(view.selected).toBe(0);
    expect(view.payload.persons).toEqual([]);
    expect(view.payload.undated).toBe(0);
    await api.dispose();
  });

  test("Ortszuordnung nur für Admins", async () => {
    const editor = await apiAs("editor");
    expect((await editor.get("/api/places")).status()).toBe(403);
    expect((await editor.get("/api/places/search?q=Kiel")).status()).toBe(403);
    expect((await editor.post("/api/places/auto")).status()).toBe(403);
    expect((await editor.put("/api/places", { data: { action: "reset", text: "Kiel" } })).status()).toBe(403);
    await editor.dispose();
    const admin = await apiAs("admin");
    const list = await (await admin.get("/api/places?q=breslau")).json();
    expect(list.rows[0]).toMatchObject({ text: "Breslau, Schlesien, Preußen", status: "auto" });
    expect(list.rows[0].assignment.label).toMatch(/^Wrocław/);
    await admin.dispose();
  });
});

test.describe("Karte auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("kein waagerechtes Scrollen, Kreis antippen", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByTestId("map-circle").first()).toBeAttached();
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("map-circle").last().tap();
    await expect(page.getByTestId("map-panel-list").getByRole("link").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
