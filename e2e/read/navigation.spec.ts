import { test, expect, authFile } from "../support/fixtures";

const ALL = ["Baum", "Personen", "Recherche", "Quellen", "Daten"];
const ADMIN_ONLY = ["Familien", "Benutzer"];

const nav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Hauptnavigation" });

test.describe("Navigation je Rolle", () => {
  for (const role of ["admin", "editor", "viewer"] as const) {
    test(`${role}: Menüpunkte`, async ({ loginAs }) => {
      const { page } = await loginAs(role);
      await page.goto("/people");
      for (const label of ALL) {
        await expect(nav(page).getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      for (const label of ADMIN_ONLY) {
        await expect(nav(page).getByRole("link", { name: label, exact: true })).toHaveCount(role === "admin" ? 1 : 0);
      }
    });
  }
});

test.describe("als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("aria-current markiert den aktuellen Bereich, auch auf Unterseiten", async ({ page }) => {
    await page.goto("/sources");
    await expect(nav(page).getByRole("link", { name: "Quellen" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Personen" })).not.toHaveAttribute("aria-current", /.*/);

    await nav(page).getByRole("link", { name: "Personen" }).click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(nav(page).getByRole("link", { name: "Personen" })).toHaveAttribute("aria-current", "page");

    await page.goto("/people/mock-p-001");
    await expect(nav(page).getByRole("link", { name: "Personen" })).toHaveAttribute("aria-current", "page");

    await page.goto("/admin/families");
    await expect(nav(page).getByRole("link", { name: "Familien" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Daten" })).not.toHaveAttribute("aria-current", /.*/);
  });

  test.describe("schmalster Desktop (1024 px, Grenze lg)", () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test("alle Menüpunkte und Abmelden in einer Zeile, kein Menü-Knopf", async ({ page }) => {
      await page.goto("/people");
      await expect(page.getByRole("button", { name: "Menü" })).toBeHidden();
      const tops = new Set<number>();
      for (const label of [...ALL, "KI-Zugang", ...ADMIN_ONLY]) {
        const link = nav(page).getByRole("link", { name: label, exact: true });
        await expect(link).toBeVisible();
        tops.add(Math.round((await link.boundingBox())!.y));
      }
      expect(tops.size, "Menüpunkte auf mehreren Zeilen").toBe(1);
      // Der Name wird gekürzt statt umzubrechen — die Kopfzeile bleibt einzeilig.
      const header = (await nav(page).boundingBox())!;
      const signOut = (await nav(page).getByRole("button", { name: "Abmelden" }).boundingBox())!;
      expect(header.height).toBeLessThan(58);
      expect(signOut.x + signOut.width).toBeLessThanOrEqual(1024);
    });
  });

  test.describe("Telefon (390 px)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("Menü klappt auf, navigiert und schließt", async ({ page }) => {
      await page.goto("/people");
      const toggle = page.getByRole("button", { name: "Menü" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      // Die Desktop-Links sind ausgeblendet.
      await expect(nav(page).getByRole("link", { name: "Quellen" })).toBeHidden();

      await toggle.click();
      const menu = page.locator("#mobile-menu");
      await expect(menu).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      for (const label of [...ALL, ...ADMIN_ONLY]) {
        await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      await expect(menu.getByRole("link", { name: "Personen" })).toHaveAttribute("aria-current", "page");
      await expect(menu.getByRole("button", { name: "Abmelden" })).toBeVisible();

      // Escape schließt und gibt den Fokus zurück.
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(toggle).toBeFocused();

      // Nach einem Seitenwechsel ist das Menü zu.
      await toggle.click();
      await menu.getByRole("link", { name: "Quellen" }).click();
      await expect(page).toHaveURL(/\/sources$/);
      await expect(page.locator("#mobile-menu")).toBeHidden();

      // Klick daneben schließt.
      await toggle.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(200, 820);
      await expect(menu).toBeHidden();
    });
  });
});

test.describe("Zugriffsschutz für Verwaltungsseiten", () => {
  const cases = [
    { role: "viewer", urls: ["/admin/users", "/admin/families", "/people/new"] },
    { role: "editor", urls: ["/admin/users", "/admin/families"] },
    { role: "nofamily", urls: ["/admin/users", "/people/new"] },
  ] as const;
  for (const { role, urls } of cases) {
    test(`${role} wird umgeleitet und sieht den Hinweis`, async ({ loginAs }) => {
      const { page } = await loginAs(role);
      for (const url of urls) {
        await page.goto(url);
        // Die Fokus-Ansicht schreibt die Adresse danach auf ?focus=… um; der
        // Hinweis bleibt stehen.
        await expect(page, url).toHaveURL(/\/tree(\?|$)/);
        await expect(page.getByRole("alert").filter({ hasText: "fehlt dir die Berechtigung" })).toBeVisible();
      }
    });
  }

  test("Betrachter: Daten-Seite ohne Import", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await page.goto("/admin/data");
    await expect(page.getByRole("heading", { name: "Sichern und einspielen" })).toBeVisible();
    await expect(page.getByText("Nur Administratoren können Daten einspielen.")).toBeVisible();
    await expect(page.getByLabel("Exportdatei (JSON oder ZIP)")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Nur JSON" })).toBeVisible();
  });

  test("Bearbeiter sieht „Person anlegen“, Betrachter nicht", async ({ loginAs }) => {
    for (const [role, visible] of [["editor", 1], ["viewer", 0]] as const) {
      const { page } = await loginAs(role);
      await page.goto("/people");
      await expect(page.getByRole("link", { name: "Person anlegen" })).toHaveCount(visible);
    }
  });
});

test.describe("Benutzer ohne Familie", () => {
  test.use({ storageState: authFile("nofamily") });

  test("bekommt die Erklärung statt eines Baums", async ({ page }) => {
    await page.goto("/tree");
    const empty = page.getByTestId("tree-empty");
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("heading", { name: "Noch keine Familie freigegeben" })).toBeVisible();
    await expect(empty).toContainText("Sobald ein Administrator dich einer Familie zuordnet");
    await expect(page.getByTestId("family-tree")).toHaveCount(0);
    // Keine Zahlen über fremde Familien.
    await expect(page.getByTestId("tree-counts")).toHaveCount(0);

    await page.goto("/people");
    await expect(page.getByTestId("people-count")).toHaveText("Keine Treffer");
    await page.goto("/research");
    await expect(page.getByText("Noch nichts auszuwerten.")).toBeVisible();
  });
});
