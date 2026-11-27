import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs } from "../support/api";
import { L, forbiddenNamesFor, fullName, mock, person } from "../support/mock";

/**
 * „Lebensweg“ auf der Karte (/map?mode=lebensweg, docs/fachlich/karte-und-orte.md).
 * Nur lesend. Der Bearbeiter sieht die Familien A und B; die Vorfahren
 * seiner Mutter gehören nur zu Familie D und sind für ihn gesperrt.
 */

type LifePathApi = {
  kind: string;
  person: { id: string } | null;
  lineEnd: string | null;
  path: { stations: { n: number | null; title: string; personId: string | null }[]; points: unknown[] } | null;
};

test.describe("Lebensweg als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Betriebsart wählbar, Stationenliste und Karte hängen zusammen", async ({ page }) => {
    await page.goto("/map");
    await page.getByTestId("map-mode-lifepath").click();
    await expect(page).toHaveURL(/mode=lebensweg/);
    await expect(page.getByRole("heading", { level: 1, name: "Lebensweg" })).toBeVisible();
    await expect(page.getByTestId("map-mode-lifepath")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("lifepath-kind-person")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("map-person")).toHaveText(fullName(L.selfEditor));

    // Stammvater A: Geburt vorn, Tod und Beerdigung hinten, Beruf ohne Datum.
    const founder = L.founders.A;
    await page.goto(`/map?person=${founder}&mode=lebensweg`);
    const stations = page.getByTestId("lifepath-station");
    await expect(stations.first()).toContainText("Geburt");
    await expect(stations.last()).toContainText("Beerdigung");
    await expect(stations.first()).toContainText("(ungenau)");
    await expect(page.getByTestId("lifepath-undated")).toContainText("Beruf");
    await expect(page.getByTestId("lifepath-point").first()).toBeAttached();
    // Geburt und Taufe am selben Ort: ein Punkt mit zwei Nummern (Tod am selben Ort steht mit dabei).
    await expect(page.getByTestId("lifepath-point").first()).toHaveAttribute("data-numbers", /^1–2/);

    // Station wählen → Punkt hervorgehoben; Punkt wählen → Station hervorgehoben.
    await stations.last().getByRole("button").click();
    await expect(stations.last()).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-testid="lifepath-point"][data-active="true"]')).toHaveCount(1);
    await page.getByTestId("lifepath-point").first().locator("rect").click();
    await expect(stations.first()).toHaveAttribute("data-active", "true");
    await expect(stations.last()).not.toHaveAttribute("data-active", "true");

    await expectNoA11yViolations(page);
  });

  test("Vater- und Mutterlinie umschalten, gesperrte Vorfahren ohne Angaben", async ({ page }) => {
    await page.goto("/map?mode=lebensweg");
    await page.getByTestId("lifepath-kind-vaterlinie").click();
    await expect(page).toHaveURL(/art=vaterlinie/);
    await expect(page.getByTestId("lifepath-kind-vaterlinie")).toHaveAttribute("aria-current", "true");
    const stations = page.getByTestId("lifepath-station");
    expect(await stations.count()).toBeGreaterThanOrEqual(3);
    // Älteste Generation oben, die Person selbst unten — je mit Link zur Personenseite.
    await expect(stations.last()).toContainText(fullName(L.selfEditor));
    await expect(stations.last().getByTestId("lifepath-person-link")).toHaveAttribute("href", `/people/${L.selfEditor}`);
    await expect(page.getByTestId("lifepath-line-end")).toHaveAttribute("data-end", "none");
    // Ein Vorfahr ohne Ort: Teilstück gestrichelt.
    await expect(page.locator('[data-testid="lifepath-segment"][data-skipped="true"]').first()).toBeAttached();

    await page.getByTestId("lifepath-kind-mutterlinie").click();
    await expect(page).toHaveURL(/art=mutterlinie/);
    await expect(page.getByTestId("lifepath-line-end")).toHaveText("Weiter hinauf nicht freigegeben.");
    const html = await page.content();
    for (const name of forbiddenNamesFor(["A", "B"])) expect(html, name).not.toContain(name);
  });

  test("Daten: gesperrte Vorfahren und gesperrte Person in der Adresse", async () => {
    const api = await apiAs("editor");
    const res = await api.get("/api/map?mode=lifepath&kind=mother");
    expect(res.ok()).toBe(true);
    const view = (await res.json()) as LifePathApi;
    expect(view.lineEnd).toBe("restricted");
    const text = JSON.stringify(view);
    for (const name of forbiddenNamesFor(["A", "B"])) expect(text, name).not.toContain(name);
    for (const s of view.path!.stations) expect(person(s.personId!).familyKeys.some((k) => k === "A" || k === "B")).toBe(true);

    const dOnly = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
    const fallback = (await (await api.get(`/api/map?mode=lifepath&person=${dOnly.id}`)).json()) as LifePathApi;
    expect(fallback.person?.id).toBe(L.selfEditor);
    await api.dispose();
  });

  test("Einstieg von der Personenseite, Art bleibt beim Wechsel der Person", async ({ page }) => {
    await page.goto(`/people/${L.founders.A}`);
    await page.getByTestId("person-lifepath-link").click();
    await expect(page).toHaveURL(new RegExp(`person=${L.founders.A}&mode=lebensweg`));
    await expect(page.getByTestId("lifepath-station").first()).toContainText("Geburt");

    // Andere Person wählen: die Art (hier Vaterlinie) bleibt.
    await page.goto(`/map?person=${L.founders.A}&mode=lebensweg&art=vaterlinie`);
    const target = person(L.selfEditor);
    await page.getByTestId("map-choose-person").click();
    await page.getByPlaceholder("Name eingeben…").fill(`${target.givenName} ${target.familyName}`);
    await page.getByRole("button", { name: new RegExp(`^${target.givenName} ${target.familyName}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`person=${L.selfEditor}&mode=lebensweg&art=vaterlinie`));
    await expect(page.getByTestId("lifepath-kind-vaterlinie")).toHaveAttribute("aria-current", "true");

  });
});

test.describe("Lebensweg auf dem Telefon", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("Karte oben, Liste darunter, kein waagerechtes Scrollen, Punkt antippen", async ({ page }) => {
    await page.goto(`/map?person=${L.founders.A}&mode=lebensweg`);
    const svg = page.getByTestId("lifepath-svg");
    const list = page.getByTestId("lifepath-list");
    await expect(page.getByTestId("lifepath-point").first()).toBeAttached();
    await expectNoHorizontalOverflow(page);
    const [mapBox, listBox] = [await svg.boundingBox(), await list.boundingBox()];
    expect(mapBox!.y + mapBox!.height).toBeLessThanOrEqual(listBox!.y);
    // Knöpfe der Liste mindestens 44 px hoch.
    const button = page.getByTestId("lifepath-station").first().getByRole("button");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("lifepath-point").last().locator("rect").tap();
    await expect(page.locator('[data-testid="lifepath-station"][data-active="true"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });
});
