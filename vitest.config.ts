import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit-Tests laufen ohne Datenbank. Die datenbankgestützten Dienst-Tests
 * (tests/*.db.test.ts) verwenden die Mock-Datenbank (npm run mock:setup) und
 * überspringen sich mit Hinweis, wenn sie nicht erreichbar ist.
 */
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // ohne .env geht es mit den Standardwerten weiter
  }
}

function mockDatabaseUrl(): string {
  if (process.env.MOCK_DATABASE_URL) return process.env.MOCK_DATABASE_URL;
  const url = new URL(
    process.env.DATABASE_URL ??
      "postgresql://familytree:familytree@localhost:5432/familytree",
  );
  const name = url.pathname.replace(/^\//, "") || "familytree";
  url.pathname = `/${name.replace(/_(mock|test)$/, "")}_mock`;
  return url.toString();
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Die Playwright-Tests (e2e/, npm run test:e2e) laufen getrennt.
    exclude: ["e2e/**", "node_modules/**"],
    testTimeout: 30_000,
    // Die Datenbank-Tests teilen sich eine Mock-Datenbank; schreibende Tests
    // legen kurzzeitig eigene Datensätze an. Parallel liefen Zählungen in
    // anderen Dateien dagegen — deshalb Dateien nacheinander.
    fileParallelism: false,
    hookTimeout: 30_000,
    // Nie gegen die normale Datenbank und den normalen Medienordner: alle
    // Tests sehen nur die Mock-DB und einen eigenen Testordner (Tests, die
    // Dateien schreiben, setzen MEDIA_DIR ohnehin auf ein Temp-Verzeichnis).
    env: {
      DATABASE_URL: mockDatabaseUrl(),
      MEDIA_DIR: path.resolve(__dirname, "data", "media-test"),
      NODE_ENV: "test",
      // Automatische Zuordnung neuer Ortstexte im Hintergrund (lib/services/
      // places.ts) aus — sie liefe sonst nach Testende gegen eine schon
      // aufgeräumte Datenbank weiter. Die eigenen Tests schalten sie ein.
      PLACE_AUTO_ASSIGN: "off",
    },
  },
});
