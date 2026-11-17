/**
 * Prompt-Vorlagen und Ressourcen. Bewusst klein: zwei Arbeitsabläufe, die
 * die Werkzeuge in sinnvoller Reihenfolge verbinden, und eine Ressource je
 * Person zum Einbinden in den Kontext.
 */
import { z } from "zod";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { personResource, type ToolContext } from "./tools";

export function registerPrompts(server: McpServer, ctx: ToolContext): void {
  const writeHint = ctx.allowWrite
    ? "Schreibwerkzeuge sind aktiv. Halte gesicherte Ergebnisse erst nach Rückfrage beim Benutzer fest: " +
      "fehlende Daten nur mit Beleg und nur so genau eintragen, wie die Quelle es hergibt (z.B. „um 1850“, „vor 1900“), " +
      "den Beleg mit search_sources/create_source und cite_source (Fundstelle in detail) erfassen, " +
      "Überlegungen und offene Fragen mit update_person(append_note) notieren, " +
      "nichts überschreiben, was nicht nachweislich falsch ist."
    : "Der Server ist schreibgeschützt. Formuliere Ergebnisse als Vorschläge, die der Benutzer selbst einträgt.";

  server.registerPrompt(
    "research_person",
    {
      title: "Person recherchieren",
      description: "Walk through what is known and missing for one person and plan the next research steps.",
      argsSchema: {
        person_id: z.string().describe("ID der Person (z.B. aus search_persons)."),
      },
    },
    ({ person_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Recherchiere die Person mit der ID ${person_id} im Stammbaum. Antworte auf Deutsch.`,
              "",
              "Vorgehen:",
              "1. get_person: Stammdaten, Notizen, Eltern, Partner, Kinder, Geschwister und Belege (citations).",
              "   Für zitierte Quellen bei Bedarf get_source (Abschrift, weitere belegte Personen).",
              "2. get_timeline(person_id): Lebenslauf in zeitlicher Reihenfolge; `missing` zeigt fehlende Daten.",
              "3. check_consistency(person_id): widersprüchliche Daten.",
              "4. get_ancestors (3 Generationen): Welche Vorfahrenlinien enden früh?",
              "5. find_possible_duplicates und search_persons (Namensvarianten, gleicher Ort, ähnliches Geburtsjahr): " +
                "Ist die Person vielleicht doppelt erfasst?",
              "",
              "Fasse danach zusammen:",
              "- Was ist belegt (Quelle und Fundstelle aus den Belegen, Verlässlichkeit), was nur in Notizen erwähnt, was unbelegt?",
              "- Was fehlt, ist nur ungefähr bekannt (um/vor/nach, nur Jahr) oder widersprüchlich?",
              "- Konkrete nächste Rechercheschritte mit passenden Quellen (Kirchenbücher, Standesamtsregister, " +
                "Adressbücher, Grabsteine, Familienunterlagen), jeweils mit Ort und Zeitraum.",
              "",
              "Als „Nicht freigegeben“ markierte Personen sind für diesen Zugang verborgen — nicht über sie spekulieren.",
              writeHint,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_data_quality",
    {
      title: "Datenqualität prüfen",
      description: "Find gaps, contradictions and duplicates in the whole tree or one family and prioritise fixes.",
      argsSchema: {
        family_id: z.string().optional().describe("Optional: nur diese Familie (IDs aus list_families)."),
      },
    },
    ({ family_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Prüfe die Datenqualität ${family_id ? `der Familie ${family_id}` : "des gesamten Stammbaums"}. Antworte auf Deutsch.`,
              "",
              "1. get_statistics für den Überblick.",
              "2. check_consistency: Widersprüche (Fehler zuerst).",
              "3. find_possible_duplicates: wahrscheinliche Doppelerfassungen.",
              "4. find_data_gaps: fehlende Angaben, auch Lebensdaten ohne Beleg (unsourced).",
              family_id ? `Beschränke dich auf Personen der Familie ${family_id} (search_persons(family_id) zum Abgleich).` : "",
              "",
              "Erstelle eine priorisierte Liste: zuerst eindeutige Fehler, dann Dubletten, dann Lücken mit der besten " +
                "Aussicht auf Klärung. Nenne Personen immer mit Name und ID.",
              writeHint,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerResource(
    "person",
    new ResourceTemplate("familytree://person/{id}", { list: undefined }),
    {
      title: "Person",
      description: "Vollständiger Datensatz einer Person (wie get_person) als JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(Array.isArray(variables.id) ? variables.id[0] : variables.id);
      const auth = await ctx.authorize("READ");
      if (!auth.ok) throw new Error(`Zugriff verweigert: ${auth.message}`);
      const data = await personResource(auth.scope, id);
      if (!data) throw new Error("Person nicht gefunden (oder für diesen Benutzer nicht sichtbar)");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
      };
    },
  );
}
