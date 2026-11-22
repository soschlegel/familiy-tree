/**
 * Bereitschaftsprüfung der Mock-Datenbank für alle tests/*.db.test.ts:
 * liefert null, wenn die Tests laufen können, sonst den Grund zum
 * Überspringen. Die Datenbank kommt aus vitest.config.ts (Mock-DB des
 * Worktrees, MOCK_DATABASE_URL bzw. aus DATABASE_URL abgeleitet).
 */
import { prisma } from "@/lib/prisma";

const SETUP = "bitte `npm run mock:setup` ausführen";

/**
 * @param extra zusätzliche Prüfung (z.B. „es gibt Ereignisse“); `missing`
 *   beschreibt, was fehlt („ohne Ereignisse“).
 */
export async function mockDbSkipReason(extra?: { check: () => Promise<boolean>; missing: string }): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    if (!admin) return `Mock-Datenbank ist leer — ${SETUP}.`;
    if (extra && !(await extra.check())) return `Mock-Datenbank ${extra.missing} — ${SETUP}.`;
    return null;
  } catch (err) {
    const detail =
      (err as Error).message
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop() ?? "unbekannter Fehler";
    return `Mock-Datenbank nicht erreichbar (${detail}). Start mit \`docker compose -f docker-compose.dev.yml up -d\` und \`npm run mock:setup\`.`;
  }
}
