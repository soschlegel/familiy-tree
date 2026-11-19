/**
 * MCP-Server für die KI-gestützte Ahnenforschung (stdio) — NUR für Entwicklung
 * und automatische Tests. Er greift direkt auf die Datenbank zu und nimmt die
 * Identität aus Umgebungsvariablen; deshalb startet er ausschließlich gegen
 * Datenbanken, deren Name auf _mock oder _test endet. Der reguläre Zugang ist
 * der MCP-Endpunkt der App mit persönlichem Schlüssel.
 *
 *   MCP_USER_EMAIL   Benutzer, als der der Server handelt (Pflicht)
 *   MCP_ALLOW_WRITE  "true" schaltet die Schreibwerkzeuge frei (Standard: aus)
 *   DATABASE_URL     Mock-/Testdatenbank; ohne Angabe aus .env im Projektverzeichnis
 *
 * Zusätzlich gilt das KI-Recht des Benutzers (User.aiAccess): ohne Recht kein
 * Start, mit Recht „lesen" keine Schreibwerkzeuge, auch nicht mit
 * MCP_ALLOW_WRITE. Geprüft wird bei jedem Werkzeugaufruf neu
 * (lib/services/ai-access.ts, authorizeAiCall).
 *
 * Start: `npm run -s mcp:stdio` (= node scripts/mock.mjs mcp, setzt die Mock-Datenbank).
 * Wichtig: stdout ist dem Protokoll vorbehalten — Meldungen gehen nach stderr.
 */
import { protocolOut } from "./bootstrap";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { prisma } from "../lib/prisma";
import { authorizeAiCall, type AiAuthResult, type AiCredential } from "../lib/services";
import type { ToolContext } from "./tools";
import { createMcpServer } from "./register";

/** Gleiche Regel wie scripts/mock.mjs und prisma/seed-mock.ts. */
const MOCK_DATABASE = /_(mock|test)$/;

function fail(message: string): never {
  console.error(`[mcp] ${message}`);
  process.exit(1);
}

function databaseName(): string {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function databaseLabel(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port || 5432}${url.pathname}`;
  } catch {
    return "(DATABASE_URL fehlt oder ist ungültig)";
  }
}

async function main(): Promise<void> {
  // Vor jeder Verbindung: nie gegen eine echte Datenbank.
  const dbName = databaseName();
  if (!MOCK_DATABASE.test(dbName)) {
    console.error(
      `[mcp] Abbruch: DATABASE_URL zeigt auf "${dbName || "(keine)"}". ` +
        "Der lokale stdio-Modus greift direkt auf die Datenbank zu und läuft deshalb nur " +
        "gegen Datenbanken, deren Name auf _mock oder _test endet.\n" +
        "       Bitte `npm run -s mcp:stdio` verwenden; echte Daten nur über den MCP-Endpunkt der App mit persönlichem Schlüssel.",
    );
    process.exit(2);
  }

  const email = process.env.MCP_USER_EMAIL?.trim();
  if (!email) {
    fail(
      "MCP_USER_EMAIL ist nicht gesetzt. Der Server handelt immer als ein Benutzer der App — " +
        "bitte dessen E-Mail-Adresse angeben (z.B. MCP_USER_EMAIL=admin@example.test).",
    );
  }
  const allowWrite = process.env.MCP_ALLOW_WRITE?.trim().toLowerCase() === "true";
  const credential: AiCredential = { kind: "dev", email, allowWrite };

  let auth: AiAuthResult;
  try {
    auth = await authorizeAiCall(credential, "READ");
  } catch (err) {
    const detail = (err as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    fail(`Datenbank ${databaseLabel()} nicht erreichbar: ${detail}`);
  }
  if (!auth.ok) {
    fail(`Benutzer ${email} in ${databaseLabel()}: ${auth.message} [${auth.reason}] — Start abgebrochen.`);
  }

  // Schreibwerkzeuge nur, wenn beides zutrifft: MCP_ALLOW_WRITE und KI-Recht
  // WRITE. Der Wächter prüft trotzdem jeden einzelnen Aufruf erneut.
  const writeTools = allowWrite && auth.level === "WRITE";
  if (allowWrite && !writeTools) {
    console.error(
      `[mcp] Hinweis: MCP_ALLOW_WRITE=true, aber ${email} hat nur das KI-Recht „lesen" — Schreibwerkzeuge bleiben aus.`,
    );
  }

  const ctx: ToolContext = {
    label: email,
    allowWrite: writeTools,
    // Bei jedem Aufruf neu prüfen: wenige kleine Abfragen, dafür wirken
    // Sperren sowie Rollen- und KI-Rechteänderungen sofort.
    authorize: (need) => authorizeAiCall(credential, need),
  };

  const server = createMcpServer(ctx);

  const transport = new StdioServerTransport(process.stdin, protocolOut);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);

  const scope = auth.scope;
  const role = scope.isAdmin
    ? "Administrator"
    : `${scope.families.size} Familie(n), davon ${[...scope.families.values()].filter((r) => r === "EDITOR").length} bearbeitbar`;
  console.error(
    `[mcp] Stammbaum-MCP bereit (Entwicklungsmodus) — Benutzer ${email} (${role}), Datenbank ${databaseLabel()}, ` +
      `KI-Recht ${auth.user.aiAccess}, Schreibwerkzeuge ${writeTools ? "AKTIV" : "aus"}.`,
  );
}

main().catch((err) => fail(`Start fehlgeschlagen: ${(err as Error).stack ?? String(err)}`));
