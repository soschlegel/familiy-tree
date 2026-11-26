# Neuigkeiten

Der Versions-Changelog für Anwender — nicht zu verwechseln mit der
[Änderungsgeschichte](../fachlich/aenderungsgeschichte.md) der Daten. Einzige Quelle ist
[CHANGELOG.md](../../CHANGELOG.md) im Wurzelverzeichnis:

```markdown
## 2026-11-22.2 — Kurztitel

- Was kann ich jetzt, was hat sich geändert — in Anwendersprache,
  Folgezeilen eingerückt.
```

- **Kennung** `JJJJ-MM-TT.N`: Tag des Ausrollens und laufende Nummer an
  diesem Tag — keine Commit-Kennung. Neueste zuerst. Jedes Release nach
  `main` bekommt einen Eintrag (AGENTS.md, Abschnitt 3).
- **Eingebaut zur Build-Zeit** (`lib/release-notes-data.ts`, Webpack-Regel
  `?raw` in `next.config.mjs`): das Image braucht die Datei zur Laufzeit
  nicht. Den Aufbau prüft `tests/release-notes.test.ts` (fehlerfrei, keine
  Commit-Kennungen, keine Technikbegriffe).
- **Fenster „Was ist neu?“**: Angemeldete sehen nach einer neuen Version auf
  der ersten aufgerufenen Seite einmal die Releases seit dem zuletzt
  gesehenen (höchstens drei, für den Rest ein Hinweis auf die Seite). Jedes
  Schließen — „Gelesen“, Escape, Hintergrund, „Alle Neuigkeiten“ — merkt
  das neueste Release am Benutzer (`User.lastSeenReleaseId`, Migration
  `20261124000000_neuigkeiten`; `PUT /api/me/release-seen`, nur für sich
  selbst). Wer noch nichts gesehen hat (bestehende Benutzer beim ersten
  Ausrollen), sieht nur das neueste Release; neu eingeladene Benutzer
  starten beim neuesten, das Fenster kommt für sie erst mit dem nächsten.
  Nie auf der Anmeldeseite, nie ohne Anmeldung.
- **Seite `/neuigkeiten`**: alle Releases; nur für Angemeldete, Link in der
  Fußzeile neben der Build-Angabe.
- **Tests**: Die Mock-Benutzer haben nach dem Seed das neueste Release schon
  gesehen, kein Test begegnet also einem unerwarteten Fenster.
  `e2e/write/whats-new.spec.ts` prüft das Fenster mit einem eigenen,
  eingeladenen Benutzer.
