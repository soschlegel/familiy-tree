import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-End-Tests gegen den Mock-Dev-Server (npm run dev:mock, Port 3100).
 *
 * Bewusst der Dev-Server und nicht `next start`: der Dev-Login ist in
 * Produktion abgeschaltet. Läuft auf 3100 schon ein Server (z.B. ein von Hand
 * gestarteter `npm run dev:mock`), wird er mitbenutzt und hinterher nicht
 * beendet.
 *
 * Ablauf (Projekte):
 *   setup  — Mock-Daten neu aufbauen, je Rolle einmal anmelden
 *            (e2e/.auth/<rolle>.json), Routen vorwärmen
 *   read   — lesende Tests, parallel, gegen den frisch befüllten Stand
 *   write  — ändernde Tests; legen eigene, als „E2E …“ benannte Datensätze
 *            an und räumen sie wieder ab. Laufen erst nach „read“, damit
 *            Zählungen dort nicht von ihnen abhängen.
 *
 * Teilläufe über scripts/e2e.mjs (npm run test:e2e:read / :write / :setup):
 *   E2E_AREA=write      „write“ hängt dann nur am Setup, nicht an „read“
 *   E2E_SKIP_SETUP=1    kein Setup (Zustand schon vorbereitet)
 * Siehe README, Abschnitt „Tests“.
 */
const PORT = Number(process.env.MOCK_PORT ?? 3100);
const SETUP = process.env.E2E_SKIP_SETUP === "1" ? [] : ["setup"];
const WRITE_DEPS = process.env.E2E_AREA === "write" ? SETUP : ["read"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // Dev-Modus: der erste Aufruf einer Route kompiliert sie. Das Vorwärmen im
  // Setup fängt das meiste ab; der Rest steckt in diesen Werten.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 4,
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
      // Dateien untereinander parallel, Tests einer Datei nacheinander. Die
      // Dateien legen je eigene Datensätze an und vertragen sich; mehr als 2
      // Worker bringen gegen den Dev-Server aber nichts (gemessen: 4 Worker
      // 4:05 statt 2:37 min für --repeat-each=2, dazu Zeitüberschreitungen).
      fullyParallel: false,
      workers: 2,
      use: { ...devices["Desktop Chrome"], locale: "de-DE", timezoneId: "Europe/Berlin" },
    },
  ],
  webServer: {
    command: "node scripts/mock.mjs dev",
    url: `${BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
