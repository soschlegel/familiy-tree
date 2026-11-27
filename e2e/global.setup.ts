import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { test as setup } from "@playwright/test";

import { AUTH_DIR, authFile, waitForStartPage } from "./support/fixtures";
import { L, USERS, type Role } from "./support/mock";

/**
 * Bekannter Ausgangszustand für jeden Lauf: Mock-Datenbank und -Medienordner neu
 * aufbauen (scripts/mock.mjs verweigert alles, was nicht auf _mock/_test
 * endet), je Rolle einmal anmelden und die wichtigsten Routen einmal
 * aufrufen — im Dev-Modus kompiliert Next.js jede Route beim ersten Aufruf,
 * das soll nicht in die Zeitmessung der eigentlichen Tests fallen. Gegen den
 * Produktions-Build (Standard, siehe playwright.config.ts) ist alles schon
 * übersetzt; dort entfällt das Vorwärmen.
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
    await page.getByLabel("Dev-Login: E-Mail-Adresse").fill(USERS[role]);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    // Nach der Anmeldung: Startseite „Heute in der Familie“.
    await waitForStartPage(page);
    await page.context().storageState({ path: authFile(role) });
  });
}

setup("Routen vorwärmen", async ({ browser }) => {
  setup.skip(process.env.E2E_SERVER !== "dev", "Produktions-Build: nichts zu übersetzen");
  const context = await browser.newContext({ storageState: authFile("admin") });
  const page = await context.newPage();
  const pages = [
    "/",
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
    "/statistics",
    "/records",
    "/progress",
    "/admin/data",
    "/admin/users",
    "/admin/families",
    "/map",
    "/admin/places",
    "/admin/settings",
    "/admin/history",
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
    "/api/settings",
    "/api/settings/x",
    "/api/history-events",
    "/api/history-events/x",
    "/api/history-events/builtin/x",
    // Neuigkeiten: PUT-Route (GET → 405, kompiliert sie trotzdem).
    "/api/me/release-seen",
  ];
  for (const url of api) {
    await context.request.get(url, { timeout: 180_000 });
  }
  await context.close();
});
