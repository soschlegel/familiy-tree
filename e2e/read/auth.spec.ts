import { test, expect, devLogin, waitForStartPage } from "../support/fixtures";
import { USERS } from "../support/mock";

/**
 * Anmeldung über den Dev-Login. Diese Tests starten ohne gespeicherten
 * Anmeldezustand.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const ROLE_LABEL = {
  admin: "Ada Admin · Administrator",
  editor: "Erik Editor · Bearbeiter",
  viewer: "Vera Viewer · Betrachter",
  nofamily: "Nora Ohnefamilie · Betrachter",
} as const;

for (const role of ["admin", "editor", "viewer", "nofamily"] as const) {
  test(`Anmeldung als ${role} führt zur Startseite`, async ({ page }) => {
    await devLogin(page, USERS[role]);
    await waitForStartPage(page);
    const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByText(ROLE_LABEL[role])).toBeVisible();
  });
}

test("unbekannte E-Mail wird mit Meldung abgelehnt", async ({ page }) => {
  await devLogin(page, "niemand@example.test");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
});

test("gesperrter Benutzer wird mit Meldung abgelehnt", async ({ page }) => {
  await devLogin(page, USERS.blocked);
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByRole("alert").filter({ hasText: "nicht freigeschaltet" })).toBeVisible();
  // Auch danach kein Zugang.
  await page.goto("/people");
  await expect(page).toHaveURL(/\/login/);
});

test("ohne Anmeldung leiten Seiten auf /login, die API antwortet 401", async ({ page, request }) => {
  for (const url of ["/", "/tree", "/people", "/people/mock-p-001", "/sources", "/research", "/statistics", "/records", "/admin/users"]) {
    await page.goto(url);
    await expect(page, url).toHaveURL(/\/login$/);
  }
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  for (const url of ["/api/persons", "/api/tree", "/api/export?format=json", "/api/media/mock-m-001"]) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(401);
  }
});

test("Abmelden beendet die Sitzung", async ({ page }) => {
  await devLogin(page, USERS.viewer);
  // Die Startseite lädt alles auf dem Server — keine nachlaufenden Anfragen.
  await waitForStartPage(page);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/people");
  await expect(page).toHaveURL(/\/login/);
});

test("angemeldet führt /login direkt zur Startseite", async ({ page }) => {
  await devLogin(page, USERS.editor);
  await waitForStartPage(page);
  await page.goto("/login");
  await waitForStartPage(page);
});
