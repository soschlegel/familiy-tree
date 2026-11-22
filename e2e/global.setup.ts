import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { test as setup, expect } from "@playwright/test";

import { AUTH_DIR, authFile } from "./support/fixtures";
import { L, USERS, type Role } from "./support/mock";

/**
 * Bekannter Ausgangszustand für jeden Lauf: Mock-Datenbank und -Medienordner neu
 * aufbauen (scripts/mock.mjs verweigert alles, was nicht auf _mock/_test
 * endet), je Rolle einmal anmelden und die wichtigsten Routen einmal
 * aufrufen — im Dev-Modus kompiliert Next.js jede Route beim ersten Aufruf,
 * das soll nicht in die Zeitmessung der eigentlichen Tests fallen.
 */
setup.describe.configure({ mode: "serial" });

const ROLES: Role[] = ["admin", "editor", "viewer", "nofamily"];

setup("Mock-Daten neu aufbauen", async () => {
  execFileSync(process.execPath, [path.join("scripts", "mock.mjs"), "seed"], {
    stdio: "pipe",
    timeout: 180_000,
  });
});

for (const role of ROLES) {
  setup(`Anmelden als ${role}`, async ({ page }) => {
    mkdirSync(AUTH_DIR, { recursive: true });
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(USERS[role]);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL(/\/tree/);
    await expect(page.getByRole("heading", { name: "Stammbaum", level: 1 })).toBeVisible();
    await page.context().storageState({ path: authFile(role) });
  });
}

setup("Routen vorwärmen", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("admin") });
  const page = await context.newPage();
  const pages = [
    "/tree",
    "/tree?view=generations",
    "/people",
    `/people/${L.founders.A}`,
    `/people/${L.founders.A}/edit`,
    "/people/new",
    "/sources",
    `/sources/${L.sources.churchBookA}`,
    `/sources/${L.sources.churchBookA}/edit`,
    "/sources/new",
    "/research",
    "/admin/data",
    "/admin/users",
    "/admin/families",
    "/map",
    "/admin/places",
    "/neuigkeiten",
    "/people/gibt-es-nicht",
  ];
  for (const url of pages) {
    await page.goto(url, { timeout: 180_000 });
  }
  // Route-Handler: ein GET kompiliert auch die POST-/PATCH-/DELETE-Routen
  // desselben Moduls.
  const api = [
    "/api/persons?limit=1",
    `/api/persons/${L.founders.A}`,
    `/api/persons/${L.founders.A}/families`,
    "/api/relationships",
    `/api/relationships/${L.citedMarriage}`,
    "/api/sources",
    `/api/sources/${L.sources.churchBookA}`,
    "/api/citations",
    "/api/citations/x",
    "/api/media",
    "/api/media/x",
    "/api/media/x/primary",
    "/api/import",
    "/api/tree",
    "/api/map",
    "/api/places?q=kiel",
    "/api/places/search?q=kiel",
    "/api/places/auto",
    "/api/export?format=json",
    "/api/users",
    "/api/users/x",
    "/api/families",
    "/api/families/x",
    "/api/families/x/members",
    // Neuigkeiten: PUT-Route (GET → 405, kompiliert sie trotzdem).
    "/api/me/release-seen",
  ];
  for (const url of api) {
    await context.request.get(url, { timeout: 180_000 });
  }
  await context.close();
});
