/**
 * Gemeinsamer Aufbau des MCP-Servers — für den stdio-Entwicklungsmodus
 * (mcp/server.ts) und den HTTP-Endpunkt der App (app/api/mcp/route.ts).
 * Werkzeuge, Prompts und Ressourcen werden nur hier registriert.
 *
 * Bewusst ohne Seiteneffekte beim Import: mcp/bootstrap.ts (stdout-Umleitung,
 * .env laden) gehört allein zum stdio-Modus und darf hier nicht hinein.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerReadTools, registerWriteTools, type ToolContext } from "./tools";
import { registerPrompts } from "./prompts";

export const SERVER_INFO = { name: "familytree", title: "Stammbaum", version: "0.1.0" } as const;

export const INSTRUCTIONS = `Family-tree database for genealogical research (German family history; data, names and labels are German).

- Start with search_persons (name words, family, birth-year range, place) to get person IDs; get_statistics gives an overview.
- get_person returns the full record incl. research notes and relatives; get_kinship names the relationship between two persons in German.
- For research leads use find_data_gaps (missing data), check_consistency (contradicting dates), find_possible_duplicates and get_timeline.
- Persons shown as {"name":"Nicht freigegeben","restricted":true} exist but are hidden from this user. Do not guess about them.
- Dates are ISO in their real precision: "1850-03-12", "1850-03" or "1850"; uncertain ones carry a German prefix ("um 1850" = about, "vor 1900" = before, "nach 1723" = after) and fields …Precision (DAY/MONTH/YEAR), …Qualifier (EXACT/ABOUT/BEFORE/AFTER), …Text. "lifespan" is "birth – death" with "?" for unknown. Write dates exactly as precise as the evidence — never pad a year to a full date.
- Sources: search_sources / get_source list recorded documents (church books, civil registry, census, gravestones, family papers, oral tradition, websites); get_person shows each person's citations. find_data_gaps(kinds: ["unsourced"]) lists facts without a citation.
- The server acts as one app user with that user's family permissions. Write tools exist only if enabled; every write is audited. Never invent facts. Record evidence as a citation: find or create the source (search_sources, create_source) and attach it to the fact with cite_source (page/entry in "detail"). Research notes (update_person append_note) are for reasoning and open questions; a free-text "source" there is only a hint, not a citation.`;

/**
 * Neuer MCP-Server mit allen Lesewerkzeugen, Prompts und Ressource; die
 * Schreibwerkzeuge nur bei ctx.allowWrite. Unabhängig davon prüft jedes
 * Werkzeug bei jedem Aufruf über ctx.authorize erneut.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerReadTools(server, ctx);
  if (ctx.allowWrite) registerWriteTools(server, ctx);
  registerPrompts(server, ctx);
  return server;
}
