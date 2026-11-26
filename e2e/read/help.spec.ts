import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { L } from "../support/mock";

/**
 * Anwender-Hilfe (/hilfe, Texte aus docs/anwender/): Themenliste, jedes
 * Thema, Links, Telefonbreite, dunkles Farbschema, Barrierefreiheit und die
 * Kontexthilfe-Links in der App. Nur lesend.
 */
const TOPICS = [
  "erste-schritte",
  "personen",
  "quellen-und-belege",
  "stammbaum",
  "karte",
  "orte-zuordnen",
  "dubletten",
  "import-und-export",
  "aenderungen",
  "ki-zugang",
  "datenschutz",
  "einstellungen",
];

test.describe("Hilfe als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("Themenliste: alle Themen, erreichbar über Fußzeile und Menü", async ({ page }) => {
    await page.goto("/sources");
    await page.getByTestId("footer-help").click();
    await expect(page).toHaveURL(/\/hilfe$/);
    await expect(page.getByRole("heading", { level: 1, name: "So funktioniert der Stammbaum" })).toBeVisible();
    const links = page.getByTestId("help-topic-link");
    await expect(links).toHaveCount(TOPICS.length);
    expect(await links.evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname))).toEqual(
      TOPICS.map((t) => `/hilfe/${t}`),
    );
    await page.locator('a[href="/hilfe/karte"]').click();
    await expect(page).toHaveURL(/\/hilfe\/karte$/);
    await expect(page.getByRole("heading", { level: 2, name: "Wie wird gezählt?" })).toBeVisible();
  });

  test("jedes Thema lädt, alle internen Links führen zu vorhandenen Seiten", async ({ page }) => {
    // Elf Themen plus jede verlinkte App-Seite — im Dev-Server mit erstem
    // Übersetzen jeder Seite dauert das länger als ein einzelner Seitentest.
    test.setTimeout(240_000);
    const targets = new Set<string>();
    for (const slug of TOPICS) {
      const res = await page.goto(`/hilfe/${slug}`);
      expect(res?.status(), slug).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("help-content")).toBeVisible();
      // Kein rohes HTML aus dem Markdown im Inhalt.
      expect(await page.getByTestId("help-content").locator("script, iframe, img").count(), slug).toBe(0);
      for (const href of await page.getByTestId("help-content").locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
        const url = new URL(href);
        if (url.origin !== new URL(page.url()).origin) continue;
        targets.add(url.pathname + url.hash);
      }
    }
    expect(targets.size).toBeGreaterThan(5);
    for (const t of targets) {
      const [pathname, hash] = t.split("#");
      const res = await page.request.get(pathname);
      expect(res.status(), t).toBe(200);
      if (hash && pathname.startsWith("/hilfe/")) {
        expect(await res.text(), `Anker ${t}`).toContain(`id="${hash}"`);
      }
    }
  });

  test("unbekanntes Thema: 404", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    const res = await page.goto("/hilfe/gibt-es-nicht");
    expect(res?.status()).toBe(404);
  });

  test("Kontexthilfe: Karte und KI-Zugang verlinken die passende Seite", async ({ page }) => {
    await page.goto("/map");
    await page.getByTestId("map-rules").locator("summary").click();
    await page.getByTestId("map-rules").getByTestId("help-link").click();
    await expect(page).toHaveURL(/\/hilfe\/karte#wie-wird-gezaehlt$/);
    await expect(page.locator("#wie-wird-gezaehlt")).toBeVisible();

    await page.goto("/ai-access");
    await page.getByTestId("help-link").first().click();
    await expect(page).toHaveURL(/\/hilfe\/ki-zugang$/);
  });

  test("Kontexthilfe: Personenseite (Bezugsperson)", async ({ page }) => {
    await page.goto(`/people/${L.founders.A}`);
    await page.getByTestId("person-reference").getByTestId("help-link").click();
    await expect(page).toHaveURL(/\/hilfe\/stammbaum#bezugsperson$/);
    await expect(page.locator("#bezugsperson")).toBeVisible();
  });
});

test("ohne Anmeldung: Weiterleitung zur Anmeldung", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/hilfe/karte");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test.describe("Hilfe als Admin: Kontexthilfe Dubletten und Orte", () => {
  test.use({ storageState: authFile("admin") });

  test("Mögliche Dubletten und Daten verlinken die Hilfe", async ({ page }) => {
    await page.goto("/research/duplicates");
    await page.getByTestId("help-link").first().click();
    await expect(page).toHaveURL(/\/hilfe\/dubletten$/);

    await page.goto("/admin/data");
    await page.getByTestId("data-places-link").getByTestId("help-link").click();
    await expect(page).toHaveURL(/\/hilfe\/orte-zuordnen$/);
  });

  test("Dubletten-Hinweis auf der Personenseite erklärt die Klassen", async ({ page }) => {
    await page.goto(`/people/${L.duplicates[0][0]}`);
    const banner = page.getByTestId("duplicate-banner");
    await expect(banner).toBeVisible();
    await banner.getByTestId("help-link").click();
    await expect(page).toHaveURL(/\/hilfe\/dubletten#was-bedeuten-sicher-wahrscheinlich-und-unklar$/);
  });

  test("Menü „Verwaltung“ enthält „Hilfe“", async ({ page }) => {
    await page.goto("/sources");
    await page.getByRole("button", { name: "Verwaltung" }).click();
    await page.locator("#admin-menu").getByRole("link", { name: "Hilfe" }).click();
    await expect(page).toHaveURL(/\/hilfe$/);
  });
});

test.describe("Hilfe: Telefon, dunkles Farbschema, Barrierefreiheit", () => {
  test.use({ storageState: authFile("viewer"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const url of ["/hilfe", ...TOPICS.map((t) => `/hilfe/${t}`)]) {
    test(`${url}: kein waagerechtes Scrollen`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`axe (${scheme}): Themenliste und Themen mit Tabellen`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const url of ["/hilfe", "/hilfe/karte", "/hilfe/stammbaum", "/hilfe/dubletten", "/hilfe/ki-zugang"]) {
        await page.goto(url);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoA11yViolations(page);
      }
    });
  }
});
