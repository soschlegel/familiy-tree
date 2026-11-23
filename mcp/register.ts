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
- Person IDs stay valid after a merge in the app: if a person was merged into another, every tool silently uses the remaining person and reports "resolvedFrom" (old ID → current ID). Continue with the current ID. IDs of merged relationships and events are not redirected.
- Dates are ISO in their real precision: "1850-03-12", "1850-03" or "1850"; uncertain ones carry a German prefix ("um 1850" = about, "vor 1900" = before, "nach 1723" = after, "geschätzt"/"errechnet" = estimated/calculated) and fields …Precision (DAY/MONTH/YEAR), …Qualifier (EXACT/ABOUT/BEFORE/AFTER/ESTIMATED/CALCULATED/BETWEEN/PERIOD/UNTIL), …Text. Ranges have …To: "zwischen 1850 und 1855" (happened once within), "von 1901 bis 1910" (lasted), "ab 1901", "bis 1910". A date the source states only in words ("Palmsonntag 1864") appears as …Text without a date. "lifespan" is "birth – death" with "?" for unknown. Write dates exactly as precise as the evidence — never pad a year to a full date.
- Where facts live: birth and death (date, place, cause) are fields of the person; marriage and divorce (date, place) are fields of the PARTNER_OF relationship (subtype MARRIED/UNMARRIED/DIVORCED/PARTNER_UNKNOWN = marital status unknown). Everything else — baptism, confirmation, occupation, residence, education, military service, emigration, census, burial, probate; engagement or banns of a couple — is a life event (get_person "events", list_events). Further names (married name, spelling variants, aliases) are "otherNames". A second, contradicting birth/death/marriage/divorce record is an event with alternative=true — never treat it as the main fact.
- Sources: search_sources / get_source list recorded documents (church books, civil registry, census, gravestones, family papers, oral tradition, websites, online collections of genealogy providers, other users' online family trees); get_person shows each person's citations. A citation of a source with kind ONLINE_TREE ("independent": false) comes from someone else's family tree — it is a research lead, NOT independent evidence; confirm such facts with primary records. Citation "url" is a link to the record at the provider. find_data_gaps(kinds: ["unsourced"]) lists facts without a citation.
- Images (write tools): attach a scan or photo to the entry it documents — preferably to the citation of the record entry (citation_ids), else to the life event, relationship, person or the source as a whole. Three ways: (1) add_media with url = an https link to the image file, which the server downloads itself (public addresses only); (2) add_media with data_base64 = the file bytes, only if you can actually read the original file (e.g. a local file in Claude Code); (3) link_media with the media_id of an image already in the app (get_person / get_source list them). An image the user only shows you in the chat cannot be transferred — you do not have the file. Then ask for a link (way 1) or for the upload in the app, and use way 3 afterwards. Write a German caption describing what the image shows; never guess what an unseen image contains.
- The server acts as one app user with that user's family permissions. Write tools exist only if enabled; every write is audited. Never invent facts. Record evidence as a citation: find or create the source (search_sources, create_source) and attach it to the fact with cite_source (page/entry in "detail"). Record a baptism, occupation, residence, burial etc. with add_event (never only in notes) and cite it with cite_source(event_id); add other names with add_name_variant, marriage places with update_relationship(start_place). Types BIRTH/DEATH/MARRIAGE/DIVORCE may be added as events ONLY with is_alternative=true for a contradicting second record — the main fact goes into update_person / update_relationship. Research notes (update_person append_note) are for reasoning and open questions; a free-text "source" there is only a hint, not a citation.
- Change history: every write appears in the app's change history (per person, and for administrators per family). Before a larger task (e.g. evaluating one church book, several persons) call begin_change_set with a German title and pass its change_set_id to each write tool; the writes then show up as one package. Without change_set_id, writes of the same key within 30 minutes are bundled automatically into the most recent change set. Change set titles are shown to every user who may edit an affected person, including users who may not see other persons involved: describe the task and the record (e.g. 'Taufbuch St. Marien 1850–1870 ausgewertet'), never put names of persons into a title.
- Places (map): place fields are free text and stay exactly as written — never rewrite a place text to "correct" it. Coordinates come from a separate assignment per distinct text. suggest_place(text) shows candidates from the bundled gazetteer and own places; old and German names are understood ("Breslau" = Wrocław, "Danzig" = Gdańsk, "Königsberg, Ostpreußen" = Kaliningrad; nameKind "historic"). Administrators work through open texts with list_places(status "open") → suggest_place → assign_place (batches up to 50, short German note with the reason, uncertain=true when probable only; own places with coordinates for hamlets, farms or deserted villages missing from the gazetteer). AI assignments are marked "von KI" until an admin confirms them; assignments confirmed by hand are never changed. Prompt orte_zuordnen describes the workflow. No names of persons in change set titles here either.

Duplicates — there is NO merge_persons tool, and no other tool merges, deletes or hides persons. Merging two records is done only by a human in the web app (page "Mögliche Dubletten"), never by you: a wrong merge is the worst possible error in this database. Your part is to pre-check and to propose. list_duplicate_candidates gives the app's candidate pairs with class (high = "sicher", medium = "wahrscheinlich", low = "unklar"), reasons and contradictions; preview_person_merge is a dry run that shows exactly what the app would show before a merge, including blockers, and changes nothing; review_duplicate (write level) stores only your assessment of one pair — MERGE, DISPUTED or NOT_DUPLICATE with a German reason — for the human to read at that pair. An assessment never changes the class of a pair, never selects it for merging and never removes it from the list. Read both records with get_person first; when the evidence is thin or contradictory, the verdict is DISPUTED — never guess. Do not work around the missing merge tool (e.g. by copying one record's data into the other or deleting relationships to imitate a merge). Prompt review_duplicates describes the workflow.`;

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
