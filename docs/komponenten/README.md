# Komponenten-Dokumentation

Fachlich-technische Beschreibung jeder Komponente bzw. jedes Moduls der
Stammbaum-App: wozu es da ist, was es tut, welche Regeln gelten, wer es
benutzt und welche Tests es abdecken. Sie erspart das Suchen im Code — der
Code bleibt aber die Wahrheit.

**Pflege:** Nach jeder abgeschlossenen Änderung im selben Commit
fortschreiben (siehe [AGENTS.md](../../AGENTS.md), Abschnitt 1).

## Wegweiser

| Datei | Inhalt | Wann lesen |
|---|---|---|
| [datenmodell.md](datenmodell.md) | Alle Prisma-Modelle und Enums (`prisma/schema.prisma`), ungenaue Datumsangaben, Löschverhalten, Indizes, Liste der Migrationen und Migrationsregeln | Bei jeder Schemaänderung, beim Verstehen von Feldern |
| [dienste.md](dienste.md) | Dienstschicht `lib/services/`: Geschäftslogik für Seiten, API und MCP — Personen, Beziehungen, Ereignisse, Quellen/Belege, Bilder, Import/Export, Dubletten und Zusammenführen, Changelog, Bezugsperson, Karte/Orte, KI-Zugang | Vor fachlichen Änderungen; Rechte- und Protokollfragen |
| [bibliotheken.md](bibliotheken.md) | Alle Module in `lib/` außer den Diensten: Rechte (Scope), Datumslogik, Dubletten-Bewertung, Verwandtschaft, Linien, Layouts, GEDCOM lesen/schreiben/importieren, Karte und Ortsverzeichnis, SSRF-Schutz, Audit/Pakete | Bei Algorithmen und Regeln |
| [seiten-und-api.md](seiten-und-api.md) | Alle Seiten unter `app/` (Adresse, Rechte, Parameter, Daten) und alle API-Routen (Methode, Eingaben, Fehlercodes, Rechte, Dienst, Protokoll) | Bei Änderungen an Seiten oder Schnittstellen |
| [mcp.md](mcp.md) | MCP-Server: Anmeldung, Stufen, Limits, Server-Hinweis, jedes Werkzeug, Prompts, Ressource, Tests | Bei Änderungen an der KI-Schnittstelle |
| [oberflaeche-komponenten.md](oberflaeche-komponenten.md) | Alle React-Komponenten in `components/`, Gestaltungssystem `app/globals.css`, Zusammenspiel der Baumansichten | Bei Änderungen an der Oberfläche |
| [betrieb-und-tests.md](betrieb-und-tests.md) | Skripte, Docker, Compose, CI, Konfiguration, Mock-Umgebung, Geodaten, Umgebungsvariablen; Aufbau von `tests/` und `e2e/`, bekannte Flakes | Bei Betrieb, Ausrollen und Tests |

## Grobe Architektur

- **Oberfläche:** Next.js App Router. Seiten (`app/**/page.tsx`) sind
  Server-Komponenten, die über die Dienste Daten laden; interaktive Teile
  sind Client-Komponenten in `components/`, die über `components/api-client.ts`
  die API-Routen aufrufen.
- **Schnittstellen:** API-Routen (`app/api/**/route.ts`) laufen über
  `route()` in `lib/api.ts` (Anmeldung, Rechteprüfung, Fehlerabbildung,
  Changelog-Paket je Anfrage) und rufen die Dienste. Der MCP-Server
  (`mcp/`, `/api/mcp`) nutzt dieselben Dienste mit den Rechten des
  Schlüssel-Inhabers.
- **Geschäftslogik:** `lib/services/` — alle Regeln, Rechteprüfung über den
  Scope (`lib/scope.ts`), Protokoll über `lib/audit.ts`/`lib/change-sets.ts`.
- **Daten:** PostgreSQL über Prisma (`lib/prisma.ts`), Bilder als Dateien
  unter `MEDIA_DIR` (`lib/storage.ts`).
- **Querschnitt:** Rechte = Familien × Rolle (Betrachter/Bearbeiter/Admin);
  unsichtbare Personen erscheinen als „nicht freigegeben“ und dürfen nirgends
  durchsickern — auch nicht in Zahlen, Verwandtschaftsgraden oder Karten.
