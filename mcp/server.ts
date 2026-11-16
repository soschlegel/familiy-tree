/**
 * MCP-Server für die KI-gestützte Ahnenforschung (stdio).
 *
 *   MCP_USER_EMAIL   Benutzer, als der der Server handelt (Pflicht)
 *   MCP_ALLOW_WRITE  "true" schaltet die Schreibwerkzeuge frei (Standard: aus)
 *   DATABASE_URL     wie die Web-App; ohne Angabe aus .env im Projektverzeichnis
 *
 * Start: `npm run -s mcp` (echte Datenbank laut .env) bzw. `npm run -s mcp:mock`.
 * Wichtig: stdout ist dem Protokoll vorbehalten — Meldungen gehen nach stderr.
 */
import { protocolOut } from "./bootstrap";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { prisma } from "../lib/prisma";
import { scopeForEmail } from "../lib/services";
import { registerReadTools, registerWriteTools, type ToolContext } from "./tools";
import { registerPrompts } from "./prompts";

const INSTRUCTIONS = `Family-tree database for genealogical research (German family history; data, names and labels are German).

- Start with search_persons (name words, family, birth-year range, place) to get person IDs; get_statistics gives an overview.
- get_person returns the full record incl. research notes and relatives; get_kinship names the relationship between two persons in German.
- For research leads use find_data_gaps (missing data), check_consistency (contradicting dates), find_possible_duplicates and get_timeline.
- Persons shown as {"name":"Nicht freigegeben","restricted":true} exist but are hidden from this user. Do not guess about them.
- Dates are ISO in their real precision: "1850-03-12", "1850-03" or "1850"; uncertain ones carry a German prefix ("um 1850" = about, "vor 1900" = before, "nach 1723" = after) and fields …Precision (DAY/MONTH/YEAR), …Qualifier (EXACT/ABOUT/BEFORE/AFTER), …Text. "lifespan" is "birth – death" with "?" for unknown. Write dates exactly as precise as the evidence — never pad a year to a full date.
- Sources: search_sources / get_source list recorded documents (church books, civil registry, census, gravestones, family papers, oral tradition, websites); get_person shows each person's citations. find_data_gaps(kinds: ["unsourced"]) lists facts without a citation.
- The server acts as one app user with that user's family permissions. Write tools exist only if enabled; every write is audited. Never invent facts. Record evidence as a citation: find or create the source (search_sources, create_source) and attach it to the fact with cite_source (page/entry in "detail"). Research notes (update_person append_note) are for reasoning and open questions; a free-text "source" there is only a hint, not a citation.`;

function fail(message: string): never {
  console.error(`[mcp] ${message}`);
  process.exit(1);
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
  const email = process.env.MCP_USER_EMAIL?.trim();
  if (!email) {
    fail(
      "MCP_USER_EMAIL ist nicht gesetzt. Der Server handelt immer als ein Benutzer der App — " +
        "bitte dessen E-Mail-Adresse angeben (z.B. MCP_USER_EMAIL=admin@example.test).",
    );
  }
  const allowWrite = process.env.MCP_ALLOW_WRITE?.trim().toLowerCase() === "true";

  let scope;
  try {
    scope = await scopeForEmail(email);
  } catch (err) {
    const detail = (err as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    fail(`Datenbank ${databaseLabel()} nicht erreichbar: ${detail}`);
  }
  if (!scope) {
    fail(`Benutzer ${email} ist in ${databaseLabel()} unbekannt oder gesperrt — Start abgebrochen.`);
  }

  const ctx: ToolContext = {
    email,
    allowWrite,
    // Bei jedem Aufruf neu auflösen: zwei kleine Abfragen, dafür wirken
    // Rollenänderungen und Sperren sofort.
    resolveScope: () => scopeForEmail(email),
  };

  const server = new McpServer(
    { name: "familytree", title: "Stammbaum", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  registerReadTools(server, ctx);
  if (allowWrite) registerWriteTools(server, ctx);
  registerPrompts(server, ctx);

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

  const role = scope.isAdmin
    ? "Administrator"
    : `${scope.families.size} Familie(n), davon ${[...scope.families.values()].filter((r) => r === "EDITOR").length} bearbeitbar`;
  console.error(
    `[mcp] Stammbaum-MCP bereit — Benutzer ${email} (${role}), Datenbank ${databaseLabel()}, ` +
      `Schreibwerkzeuge ${allowWrite ? "AKTIV" : "aus"}.`,
  );
}

main().catch((err) => fail(`Start fehlgeschlagen: ${(err as Error).stack ?? String(err)}`));
