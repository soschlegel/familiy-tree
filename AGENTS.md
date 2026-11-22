# AGENTS.md — Arbeitsanweisungen für KI-Agenten in diesem Repository

Gilt für jede KI-Sitzung und jeden Sub-Agenten, der an diesem Projekt
arbeitet (Claude Code liest diese Datei über `CLAUDE.md` mit ein). Projekt:
Stammbaum-App (Next.js 15, React 19, Prisma/Postgres, Tailwind, MCP-Server
unter `/api/mcp`). Oberfläche, Code-Kommentare, Commits und Doku auf Deutsch.

Laufender Stand, offene Pakete und Stolperfallen dieser Umgebung stehen in
[UEBERGABE.md](UEBERGABE.md); Bedienung, Betrieb und Tests in
[README.md](README.md). Diese Datei regelt, **wie** gearbeitet wird.

## 1. Komponenten-Dokumentation fortschreiben (Pflicht)

Unter [`docs/komponenten/`](docs/komponenten/) steht je Bereich eine
fachlich-technische Beschreibung jeder Komponente bzw. jedes Moduls: wozu sie
da ist, was sie tut, wichtige Regeln und Entscheidungen, Rechte/Datenschutz,
Abhängigkeiten, wo sie benutzt wird, zugehörige Tests. Einstieg und Übersicht:
[`docs/komponenten/README.md`](docs/komponenten/README.md).

- **Erst lesen, dann suchen:** Vor einer Änderung die Beschreibung der
  betroffenen Komponenten lesen, statt den Code von Grund auf zu
  durchsuchen. Code bleibt die Wahrheit — weicht er ab, gilt der Code, und
  die Beschreibung wird berichtigt.
- **Nach jeder abgeschlossenen Änderung fortschreiben** — im selben Commit
  wie die Änderung: neue Komponenten aufnehmen, geänderte Regeln/Abläufe
  nachziehen, entfernte streichen, Querverweise und Übersicht aktuell halten.
  Eine Änderung ohne passende Doku gilt als nicht abgeschlossen.
- Beschreiben, nicht abschreiben: Zweck, Verhalten, Regeln, Grenzfälle,
  Zusammenspiel. Keine Code-Kopien, keine Zeilennummern (veralten sofort);
  Verweise als Pfad bzw. Funktionsname.
- Öffentliches Repository: keine echten Namen, Orte oder Daten aus
  Stammbäumen, keine Hostnamen oder Zugangsdaten.

## 2. Umsetzung durch Sub-Prozesse (Sub-Agenten)

- Die **Hauptsitzung koordiniert**: Anforderungen klären, Aufgaben
  schneiden, Sub-Agenten beauftragen, Ergebnisse selbst prüfen (Diff lesen,
  Screenshots ansehen, Tests wiederholen), zusammenführen, ausrollen,
  berichten.
- Die **Umsetzung übernehmen Sub-Agenten**: je in sich geschlossenem Paket
  einer, unabhängige Pakete parallel. Kleinigkeiten (wenige Zeilen,
  Konfliktlösung beim Zusammenführen, Doku-Nachträge) darf die Hauptsitzung
  selbst erledigen.
- **Jeder Sub-Agent arbeitet in einem eigenen Git-Worktree** (z.B.
  `C:\Dev\VSCode\familiy-tree-<paket>`, eigener Branch) mit eigener
  Mock-Datenbank (`MOCK_DATABASE_URL=…/familytree_<paket>_mock` in der
  `.env` des Worktrees) und eigenem Port (`$env:MOCK_PORT` nur in der Shell
  setzen). Einzelheiten und bekannte Fallen: UEBERGABE, Abschnitt „Stand“.
- Der Auftrag an einen Sub-Agenten ist vollständig und für sich lesbar:
  Ziel, Entscheidungen des Eigentümers, Grenzen (nicht pushen, nicht mergen,
  keinen fremden Ordner ändern), Prüfauftrag, gewünschter Bericht — und
  immer: Komponenten-Doku fortschreiben (Abschnitt 1).
- Berichte von Sub-Agenten sind Behauptungen, keine Belege: Kernaussagen
  (Tests grün, Migration ergänzend, nichts Fremdes geändert) selbst
  nachprüfen, bevor ausgerollt wird.

## 3. Ausrollen

- `main` ist Produktion: Jeder Push/Merge nach `main` baut das Image und
  wird ausgerollt — auf echte Daten. Gearbeitet wird auf `optimierung`.
- Nach `main` nur zusammengeführte, vollständig geprüfte Stände: Typecheck,
  Lint, Vitest, Migrationen ↔ Schema ohne Abweichung, jede neue Migration
  rein ergänzend (`docker/schema-diff-check.mjs`), Playwright-Gesamtlauf
  mit `npm run test:e2e`: ein Befehl, der den Produktions-Build der
  Mock-Umgebung bei Bedarf neu baut, einen eigenen Server startet,
  setup → read → write ausführt und den Server wieder beendet (kein
  Neustart zwischen read und write nötig). Vorher keinen von Hand
  gestarteten Server auf dem Port laufen lassen (er würde mitbenutzt).
- Veröffentlichte Migrationen nie nachträglich ändern.
- **Neuigkeiten:** Jedes Release nach `main` bekommt einen neuen Eintrag
  ganz oben in [CHANGELOG.md](CHANGELOG.md) — im selben Stand wie die
  Änderung (mit ihr zusammengeführt). **Ohne Eintrag kein Ausrollen.** Die
  App zeigt ihn den Benutzern einmal als „Was ist neu?“ und auf der Seite
  „Neuigkeiten“ (README, „Neuigkeiten“).
  - Überschrift `## JJJJ-MM-TT.N — Kurztitel`: `JJJJ-MM-TT` ist der Tag des
    Ausrollens, `N` die laufende Nummer an diesem Tag (erstes Release des
    Tages `.1`, zweites `.2` …). Keine Commit-Kennung — die Git-Historie
    kann sich ändern. Eine veröffentlichte Kennung nie umbenennen (Benutzer
    haben sie als „gesehen“ gespeichert).
  - Darunter Stichpunkte `- …` in Anwendersprache: was kann ich jetzt, was
    hat sich geändert. Keine Technikbegriffe, keine echten Namen, Orte oder
    Daten; reine Technik ohne sichtbare Folge weglassen.
  - `npm test` prüft das Format (`tests/release-notes.test.ts`).

## 4. Zusammenarbeit mit dem Eigentümer

- Leitlinien des Eigentümers (UEBERGABE, „Leitlinien“) gelten immer —
  besonders: falsche Zusammenführungen sind der schlimmste Fehler; die KI
  über MCP prüft vor und schlägt vor, führt aber nicht selbst zusammen.
- Offene Entscheidungen als **geführte Fragen** stellen (Auswahl mit
  Empfehlung), nicht als Textliste.
- Wünsche, die er ausdrücklich „noch nicht umsetzen“ will, nur sammeln
  (UEBERGABE, Wunschliste) und erst nach Freigabe bauen.
- Schreibende Änderungen an seinen echten Daten (z.B. über das
  Stammbaum-MCP) nur nach ausdrücklicher Freigabe, mit Vorschau vorher und
  Gegenprüfung nachher.
