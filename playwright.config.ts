import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-End-Tests gegen die Mock-Umgebung (Port MOCK_PORT, Standard 3100).
 *
 * Server (E2E_SERVER, gesetzt von scripts/e2e.mjs):
 *   prod (Standard) — Produktions-Build der Mock-Umgebung (`npm run
 *            mock:build` nach .next-e2e, `npm run mock:start` = next start).
 *            Nichts wird beim ersten Aufruf übersetzt, der Speicher bleibt
 *            klein; der Dev-Login ist dort nur über die eng begrenzte
 *            Mock-Freigabe in lib/dev-login.ts erlaubt.
 *   dev      — der Mock-Dev-Server (`npm run dev:mock`), Option `--dev`.
 * scripts/e2e.mjs baut und startet den Server selbst und beendet ihn danach.
 * Läuft auf dem Port schon ein Server, wird er mitbenutzt und nicht beendet.
 *
 * Ablauf (Projekte):
 *   setup  — Mock-Daten neu aufbauen, je Rolle einmal anmelden
 *            (e2e/.auth/<rolle>.json), beim Dev-Server Routen vorwärmen
 *   read   — lesende Tests, parallel, gegen den frisch befüllten Stand
 *   write  — ändernde Tests; legen eigene, als „E2E …“ benannte Datensätze
 *            an und räumen sie wieder ab. Laufen erst nach „read“, damit
 *            Zählungen dort nicht von ihnen abhängen.
 *
 * Teilläufe über scripts/e2e.mjs (npm run test:e2e:read / :write / :setup):
 *   E2E_AREA=write      „write“ hängt dann nur am Setup, nicht an „read“
 *   E2E_SKIP_SETUP=1    kein Setup (Zustand schon vorbereitet)
 * Siehe docs/entwicklung/tests.md.
 */
const PORT = Number(process.env.MOCK_PORT ?? 3100);
const SETUP = process.env.E2E_SKIP_SETUP === "1" ? [] : ["setup"];
const WRITE_DEPS = process.env.E2E_AREA === "write" ? SETUP : ["read"];
const BASE_URL = `http://localhost:${PORT}`;
const DEV = process.env.E2E_SERVER === "dev";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // Großzügig wegen des Dev-Modus (erster Aufruf einer Route übersetzt sie)
  // und paralleler Worktrees; gegen den Produktions-Build reicht weit weniger.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Lesende Tests: gegen den Produktions-Build 6 parallel (gemessen: 6 und 8
  // Worker je rund 55 s, mehr Last bringt nur mehr Hydration-Meldungen),
  // gegen den Dev-Server 4. `--workers` übersteuert.
  workers: process.env.CI ? 2 : DEV ? 4 : 6,
  // „list“: Fortschritt je Test während des Laufs.
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
      timeout: 600_000,
    },
    {
      name: "read",
      testDir: "./e2e/read",
      dependencies: SETUP,
      fullyParallel: true,
      use: { ...devices["Desktop Chrome"], locale: "de-DE", timezoneId: "Europe/Berlin" },
    },
    {
      name: "write",
      testDir: "./e2e/write",
      dependencies: WRITE_DEPS,
      // Dateien untereinander parallel, Tests einer Datei nacheinander, 2
      // Worker. Mehr bringt nichts: die längste Datei bestimmt die Dauer
      // (Produktions-Build: 2 Worker 67 s, 6 Worker 64 s; Dev-Server: 4
      // Worker langsamer als 2, dazu Zeitüberschreitungen). Und mit mehr
      // gleichzeitigen Dateien treffen Zählungen öfter auf fremde
      // „E2E …“-Datensätze (gemessen mit 4: GEDCOM-Export 210 statt 212
      // Personen). E2E_WRITE_WORKERS übersteuert für Messungen
      // (`--workers` hebt diese Obergrenze je Projekt nicht an).
      fullyParallel: false,
      workers: Number(process.env.E2E_WRITE_WORKERS) || 2,
      use: { ...devices["Desktop Chrome"], locale: "de-DE", timezoneId: "Europe/Berlin" },
    },
  ],
  // Nur für direkte Aufrufe (`playwright test`, `npm run test:e2e:ui`):
  // scripts/e2e.mjs startet den Server selbst, bevor Playwright läuft. Der
  // Produktionsserver braucht einen vorhandenen Build (npm run mock:build).
  webServer: {
    command: DEV ? "node scripts/mock.mjs dev" : "node scripts/mock.mjs start",
    url: `${BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
