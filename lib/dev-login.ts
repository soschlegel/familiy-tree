import path from "node:path";

/**
 * Darf der Dev-Login (Anmeldung nur per E-Mail, ohne Passwort) eine Anmeldung
 * annehmen? Wird nur gefragt, wenn der Anbieter überhaupt registriert ist
 * (`ENABLE_DEV_LOGIN=true`, siehe lib/auth.ts).
 *
 * - Außerhalb von `NODE_ENV=production` (Dev-Server, Tests): ja.
 * - In Produktion grundsätzlich nein. Einzige Ausnahme ist der
 *   Produktions-Build der Mock-Umgebung für die End-to-End-Tests
 *   (`npm run mock:start`, scripts/mock.mjs). Dafür müssen ALLE drei
 *   Bedingungen gleichzeitig gelten:
 *     1. `E2E_PRODUCTION_DEV_LOGIN=mock-only` ausdrücklich gesetzt,
 *     2. die Datenbank aus `DATABASE_URL` endet auf `_mock` oder `_test`,
 *     3. der Medienordner `MEDIA_DIR` endet auf `-mock` oder `-test`.
 *   Das sind dieselben Namensregeln, mit denen scripts/mock.mjs alles außer
 *   Mock-Daten verweigert. Der Produktivstack hat weder die Variable noch
 *   solche Namen (und setzt `ENABLE_DEV_LOGIN=false`).
 *
 * `env` nur für Tests austauschbar.
 */
export function devLoginAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  if (env.E2E_PRODUCTION_DEV_LOGIN !== "mock-only") return false;
  return isMockDatabase(env.DATABASE_URL) && isMockMediaDir(env.MEDIA_DIR);
}

function isMockDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return /^[A-Za-z0-9_]+_(mock|test)$/.test(name);
  } catch {
    return false;
  }
}

function isMockMediaDir(dir: string | undefined): boolean {
  if (!dir) return false;
  // Beide Trenner zulassen (Windows/Posix), abschließende Trenner ignorieren.
  const trimmed = dir.replace(/[\\/]+$/, "");
  const base = path.basename(trimmed.replace(/\\/g, "/"));
  return /-(mock|test)$/.test(base);
}
