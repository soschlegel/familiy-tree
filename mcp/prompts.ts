/**
 * Prompt-Vorlagen und Ressourcen. Bewusst klein: wenige Arbeitsabläufe, die
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
      "Taufe, Beruf, Wohnort, Beerdigung u.ä. als Ereignis mit add_event festhalten (nicht nur in die Notizen schreiben) " +
      "und mit cite_source(event_id) belegen, weitere Namen mit add_name_variant, Heiratsorte mit update_relationship; " +
      "Geburt, Tod, Heirat und Scheidung selbst gehören an Person bzw. Beziehung — als Ereignis nur mit is_alternative=true " +
      "für eine abweichende zweite Angabe, nie als Hauptangabe, " +
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
              "1. get_person: Stammdaten, Notizen, Eltern, Partner (mit Heiratsort und Ereignissen der Ehe), Kinder, Geschwister, " +
                "Lebensereignisse (events; alternative = abweichende Zweitangabe), weitere Namen (otherNames) und Belege (citations).",
              "   Für zitierte Quellen bei Bedarf get_source (Abschrift, weitere belegte Personen).",
              "2. get_timeline(person_id): Lebenslauf in zeitlicher Reihenfolge; `missing` zeigt fehlende Daten.",
              "3. check_consistency(person_id): widersprüchliche Daten.",
              "4. get_ancestors (3 Generationen): Welche Vorfahrenlinien enden früh?",
              "5. find_possible_duplicates und search_persons (Namensvarianten, gleicher Ort, ähnliches Geburtsjahr): " +
                "Ist die Person vielleicht doppelt erfasst?",
              "",
              "Fasse danach zusammen:",
              "- Was ist belegt (Quelle und Fundstelle aus den Belegen, Verlässlichkeit), was nur in Notizen erwähnt, was unbelegt?",
              "- Was fehlt, ist nur ungefähr bekannt (um/vor/nach, zwischen … und …, nur Jahr, nur Wortlaut) oder widersprüchlich " +
                "(auch abweichende Angaben zu Geburt, Tod oder Heirat)?",
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

  server.registerPrompt(
    "orte_zuordnen",
    {
      title: "Orte zuordnen",
      description:
        "Work through the open place texts in batches: list_places(open) → suggest_place per text → assign_place for clear " +
        "cases, uncertain ones marked or left open, summary at the end. Administrators only.",
      argsSchema: {
        limit: z.string().optional().describe("Höchstens so viele Ortstexte in diesem Durchgang (Standard 100)."),
      },
    },
    ({ limit }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Ordne die offenen Ortstexte des Stammbaums Koordinaten zu (höchstens ${Number(limit) || 100} in diesem Durchgang). Antworte auf Deutsch.`,
              "Der Ortstext in den Daten bleibt immer unverändert — es geht nur um die Position auf der Karte. Nur für Administratoren.",
              "",
              "1. list_places(status: \"open\"): offene Ortstexte, häufigste zuerst, mit Kontext (Feldarten, Zeitraum).",
              "2. Je Text suggest_place(text): Kandidaten mit heutigem Namen, früherem/deutschem Namen (nameKind \"historic\"), " +
                "Einwohnerzahl, Land und Entfernung. Wähle begründet: weitere Teile des Texts (Kreis, Land, Landschaft wie " +
                "„Schlesien“, „Ostpreußen“), Zeitraum und Feldart aus dem Kontext, Nähe zu anderen Orten derselben Familie.",
              "3. Eindeutige Fälle mit assign_place zuordnen — gesammelt in `assignments` (bis 50 je Aufruf), je mit kurzer " +
                "deutscher Begründung in `note`. Fehlt ein Ort im Verzeichnis (Wüstung, Weiler, Hof, eingemeindeter Ortsteil) " +
                "und kennst du seine Lage sicher, lege ihn als eigenen Ort an (latitude, longitude, label, precision).",
              "4. Wahrscheinliche, aber nicht sichere Fälle mit uncertain=true zuordnen; echte Zweifel offen lassen. " +
                "Nichts erfinden — keine geschätzten Koordinaten ohne Grundlage; „nicht zuordenbar“ (unresolvable) nur, " +
                "wenn der Text gar keinen Ort nennt.",
              "5. Mit write-Werkzeugen vorher begin_change_set mit einem Titel wie „Orte zugeordnet (KI)“ öffnen und die " +
                "change_set_id mitgeben — ohne Personennamen im Titel.",
              "",
              "Zum Schluss: Zahl der zugeordneten Texte, Liste der unsicher zugeordneten und der offen gelassenen mit Grund " +
                "— die prüft ein Administrator auf /admin/places („von KI“, Bestätigen oder Ändern).",
              ctx.allowWrite ? "" : "Der Server ist schreibgeschützt: gib die Zuordnungen als Liste von Vorschlägen aus.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  // KI-Vorprüfung möglicher Dubletten: prüfen und einschätzen — nie zusammenführen.
  server.registerPrompt(
    "review_duplicates",
    {
      title: "Dubletten vorprüfen",
      description:
        "Pre-check possible duplicates for a human: list_duplicate_candidates → per pair get_person for both + " +
        "preview_person_merge → verdict with reason via review_duplicate. Never merges anything; never guesses.",
      argsSchema: {
        confidence: z.string().optional().describe("Optional: nur diese Klasse — high (sicher), medium (wahrscheinlich) oder low (unklar)."),
        limit: z.string().optional().describe("Höchstens so viele Paare in diesem Durchgang (Standard 20)."),
      },
    },
    ({ confidence, limit }) => {
      const klass = (["high", "medium", "low"] as const).find((k) => k === confidence);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Prüfe mögliche Dubletten im Stammbaum vor (höchstens ${Number(limit) || 20} Paare in diesem Durchgang${klass ? `, nur Klasse ${klass}` : ""}). Antworte auf Deutsch.`,
                "Du führst NICHTS zusammen — es gibt dafür kein Werkzeug. Zusammenführen kann nur ein Mensch in der App; eine falsche " +
                  "Zusammenführung ist der schlimmste Fehler. Deine Einschätzung ist ein Hinweis für diesen Menschen.",
                "",
                `1. list_duplicate_candidates(review: "unreviewed"${klass ? `, confidence: "${klass}"` : ""}): Paare ohne (aktuelle) Einschätzung mit Klasse, ` +
                  "Gründen (reasons) und Widersprüchen (conflicts). Nur Paare mit canReview=true bearbeiten.",
                "2. Je Paar get_person für BEIDE Personen: Namen und weitere Namen, Geburt/Tod mit Genauigkeit, Orte, Eltern, Partner, " +
                  "Kinder, Geschwister, Ereignisse, Belege. Vergleiche Punkt für Punkt — gleiche Namen allein beweisen nichts " +
                  "(Vater und Sohn, Geschwister nach verstorbenem Kind, Cousins gleichen Namens).",
                "3. preview_person_merge(keep_id, merge_id): der Trockenlauf — genau die Vorschau der App. Blocker (blockers) und " +
                  "abweichende Angaben (fields mit differs, alternates) ernst nehmen. Die Vorschau ändert nichts.",
                "4. Urteil mit review_duplicate und deutscher Begründung, die die konkreten Belege nennt:",
                "   - MERGE: sicher dieselbe Person — übereinstimmende Daten UND Verwandte, kein unerklärter Widerspruch, kein Blocker. " +
                  "Optional suggested_keep_id (der besser belegte Eintrag).",
                "   - NOT_DUPLICATE: sicher verschiedene Personen (z.B. verschiedene Eltern, unvereinbare Lebensdaten, beide zugleich an verschiedenen Orten).",
                "   - DISPUTED: alles andere — Hinweise in beide Richtungen, zu wenige Daten, ein offener Widerspruch. Im Zweifel immer DISPUTED.",
                "   Nie raten: Fehlt die Grundlage, schreibe in die Begründung, was fehlt und welche Quelle es klären könnte.",
                "5. Als „Nicht freigegeben“ markierte Verwandte nicht deuten; hängt das Urteil an ihnen, ist es DISPUTED.",
                ctx.allowWrite
                  ? "Vorher begin_change_set mit einem Titel wie „Mögliche Dubletten vorgeprüft (KI)“ öffnen und die change_set_id mitgeben — ohne Personennamen im Titel."
                  : "Der Server ist schreibgeschützt (kein review_duplicate): gib die Urteile mit Begründung als Liste aus.",
                "",
                "Zum Schluss: Zahl der Paare je Urteil und die Liste der strittigen mit der offenen Frage. Weise darauf hin, dass die " +
                  "Einschätzungen in der App unter „Mögliche Dubletten“ stehen (Filter „Von der KI vorgeprüft“) und dort ein Mensch entscheidet.",
              ].join("\n"),
            },
          },
        ],
      };
    },
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
      let data;
      try {
        data = await personResource(auth.scope, id);
      } catch (err) {
        // Keine Datenbankmeldungen an den Client (wie bei den Werkzeugen).
        console.error("[mcp] Fehler beim Lesen der Ressource:", err);
        throw new Error("Interner Fehler. Einzelheiten stehen im Server-Log.");
      }
      if (!data) throw new Error("Person nicht gefunden (oder für diesen Benutzer nicht sichtbar)");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
      };
    },
  );
}
