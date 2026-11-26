# Übergabe (Stand 26.11.2026)

Kurze Arbeitsnotiz für die nächste Sitzung: Stand, Arbeitsumgebung, Fallen,
offene Punkte. Was gebaut ist, beschreibt
[docs/komponenten/](docs/komponenten/README.md); was wann ausgerollt wurde,
[CHANGELOG.md](CHANGELOG.md) und die Git-Historie. Beim Weiterarbeiten
aktuell halten — Erledigtes streichen, keine Paketgeschichte sammeln.

## Stand

- `main` = ausgerollter Stand. Jeder Merge nach `main` baut das Image
  (GitHub Actions, Workflow „Images“) und zieht den Branch `deploy` nach;
  Portainer aktualisiert den Stack von dort. **Ein Merge ist ein
  Produktiv-Deployment auf echte Daten.**
- `optimierung` = Arbeitsbranch, zum Zeitpunkt der Übergabe gleich `main`.
- Letztes Release: **2026-11-26.3** (Anmeldung per E-Mail-Link über SMTP,
  Vollbild im Stammbaum, Vorschläge schon beim GEDCOM-Import gegen alle
  vorhandenen Personen, Familien auch an Ereignis-/Namens-/Beleg-/Bild- und
  Beziehungseinträgen der Änderungsgeschichte, Content-Security-Policy mit
  Not-Schalter `CSP_MODE`). Davor am selben Tag .2 (Verlauf aufgegangener
  Personen, verschlankte Doku) und .1 (Seite „Einstellungen“). Neueste
  Migration: `20261126000100_audit_personenfamilien` (Liste aller
  Migrationen:
  [datenmodell.md](docs/komponenten/datenmodell.md#migrationen-prismamigrations)).
- Prüfstand dieses Releases: Migrationen ↔ Schema ohne Abweichung, keine
  neue Migration, Typecheck, Lint, Vitest 1041/1041; `npm run test:e2e`
  (Produktions-Build, strenger Hydration-Wächter, CSP-Wächter): siehe
  Git-Nachricht des Release-Commits.
- Git-Verlauf am 23.11. umgeschrieben (alle Zweige neu hochgeladen). Ältere
  Klone und Worktrees passen nicht mehr dazu — neu klonen statt
  zusammenführen.

### Arbeitsumgebung für Sub-Agenten

Je Paket ein eigener Worktree mit eigener Mock-Datenbank und eigenem Port
(AGENTS.md, Abschnitt 2):

```powershell
git -C C:\Dev\VSCode\familiy-tree worktree add -b <paket> C:\Dev\VSCode\familiy-tree-<paket> optimierung
# .env ist nicht im Git: aus dem Hauptordner kopieren und darin setzen
#   MOCK_DATABASE_URL="postgresql://familytree:familytree@localhost:5432/familytree_<paket>_mock"
npm install; npx prisma generate                   # Install-Skripte sind blockiert
docker compose -f docker-compose.dev.yml up -d     # Postgres (einmal für alle Worktrees)
$env:MOCK_PORT = '31xx'                            # nur in der Shell, nie in die .env
npm run mock:setup                                 # legt die eigene Mock-Datenbank an
```

Gezielt prüfen: `npm run typecheck`, `npm run lint`, `npm test` und nur die
Playwright-Specs des eigenen Bereichs (`npm run test:e2e -- e2e/read/….spec.ts`).
Anleitungen: [docs/entwicklung/tests.md](docs/entwicklung/tests.md),
[docs/entwicklung/mock-daten.md](docs/entwicklung/mock-daten.md).

### Bekannte Fallen dieser Umgebung

- **PowerShell:** in Befehlen absolute Pfade des eigenen Worktrees
  verwenden — sonst landen Änderungen im Hauptordner.
- **`npx prisma db push` ohne Mock-Skript** nimmt `DATABASE_URL` (die
  normale Dev-Datenbank), nicht die Mock-Datenbank.
- **`MOCK_PORT`** wirkt nur aus der Shell (`scripts/mock.mjs` liest ihn vor
  der `.env`); mehrere Worktrees brauchen verschiedene Ports.
- **E2E laufen gegen einen Produktions-Build** (`npm run test:e2e` baut nach
  `.next-e2e`, nur bei geänderten Quellen). Ein schon laufender Server auf
  dem Port wird mitbenutzt — nach Codeänderungen einen von Hand gestarteten
  `mock:start` beenden.
- **Entwicklungsserver** (`--dev` bzw. `npm run dev:mock`): wächst auf
  3–4 GB, verwirft übersetzte Seiten, die erste Übersetzung reißt
  Zeitgrenzen — vor dem Lauf und zwischen read und write neu starten,
  währenddessen nichts ändern.
- **Dev-Login im Produktions-Build** nur über die eng begrenzte
  Mock-Freigabe (`lib/dev-login.ts`: `E2E_PRODUCTION_DEV_LOGIN=mock-only`
  plus Datenbank `…_mock`/`…_test` plus Medienordner `…-mock`/`…-test`).
  Nie im Stack setzen.
- **Mock:** Seed und Setup verweigern Datenbanknamen ohne `_mock`/`_test`
  und Medienordner ohne `-mock`/`-test`.
- **Windows:** `prisma generate` scheitert mit EPERM, solange ein
  Entwicklungsserver die Engine geladen hat — vorher stoppen.
- **Playwright:** lesende Tests mit 6 Workern, schreibende mit 2 (mehr ist
  nicht schneller und trifft fremde „E2E …“-Datensätze); `serial`-Dateien
  überspringen nach einem Fehler den Rest der Datei. Weitere Flakes:
  [betrieb-und-tests.md](docs/komponenten/betrieb-und-tests.md#10-bekannte-flakes-und-stolperfallen).
- **Migrationen:** veröffentlichte nie ändern; jede neue mit
  `node docker/schema-diff-check.mjs < migration.sql` prüfen.
- **Ausrollen:** Der Reverse-Proxy muss für `/api/mcp` größere Anfragen
  durchlassen (Bilder als base64, bis `MAX_UPLOAD_BYTES` × 4/3 + 1 MiB),
  sonst 413.
- **Öffentliches Repository:** nichts Persönliches committen (keine
  Hostnamen, keine Namen oder Daten aus echten Stammbäumen). Echte
  GEDCOM-Dateien liegen nur lokal unter `data/import/` (von Git ausgenommen).

## Leitlinien des Eigentümers

- **Die App ist die Wahrheit, Importe sind Quellen.** Zusammenführen heißt
  anreichern: Leeres füllen, der genauere Wert bleibt, Widersprüchliches wird
  Zweitangabe. Keine Verwaltung nach „Bäumen“, keine Frage „welcher Baum
  gewinnt“. Herkunft ist Zusatzinformation.
- **Falsche Zusammenführungen sind der schlimmste Fehler.** Die Klasse
  „sicher“ wird nie gelockert; eine einzelne Brücke zwischen sonst getrennten
  Familien ist nie „sicher“.
- **KI über MCP: vorprüfen und vorschlagen, nicht selbst zusammenführen.**
- Lange Arbeiten in kleine Schritte teilen und nach jedem Schritt berichten.
- Nach `main` nur abgeschlossene, geprüfte Stände.

## Offene Punkte

- **Umleitung alter Kennungen** mit echten Daten prüfen: eine alte Adresse
  aufrufen und im Server-Log `[umleitungen] … nachgetragen` suchen.
- **Änderungsgeschichte, zur Entscheidung:** Paket-Titel aus
  `begin_change_set` werden Bearbeitern unverändert gezeigt (der
  Server-Hinweis verbietet Namen darin, erzwungen wird es nicht);
  GEDCOM-Import protokolliert gelöschte Datensätze nur als Zahl, nicht je
  Person.
- **Bilder:** Abruf per MCP nur über https (keine http-Adressen). Löscht ein
  erneuter GEDCOM-Import ein Ereignis oder einen Beleg, bleibt dessen Bild
  verwaist (nur für Admins sichtbar).
- **GEDCOM:** eine abgelehnte Eltern-Kind-Verbindung wird nicht
  zurückgeschrieben. Nicht ausprobiert: Import des Exports in MyHeritage &
  Co., Foto-Download gegen echte MyHeritage-Server.
- **Importe verbinden** (`/research/connect`) mit echten Datenmengen über
  die Oberfläche noch nicht erprobt.
- **Admin-Aktion „Quellen neu einordnen“** für gespeicherte Daten älterer
  Importe (Art, Anbieter, Belegadressen). Regeln: von Hand Geändertes nicht
  anfassen, Fingerabdrücke der Herkunftsvermerke nachziehen, doppelte Belege
  nur auf ausdrückliches Ankreuzen entfernen.
- **Stammbaum auf dem Telefon:** Vollbild-Knopf vorhanden (Entscheidung des
  Eigentümers); auf echtem iOS-Safari und Android-Chrome nicht geprüft
  (Zurück-Geste, Adressleiste). Die Karten sind beim Standardzoom klein.
- **Karte:** Kreise ab 70 px begrenzt; Kartendaten für „alle“ bei 12 000
  Personen 1,4 MB und gut 1 s auf dem Server.
- **Bezugsperson:** kein MCP-Werkzeug für „ich“.
- **Sicherheit:** Anfragegrenzen für Unangemeldete und HSTS gehören in den
  Reverse-Proxy ([docs/sicherheit.md](docs/sicherheit.md)). Nach dem
  Ausrollen der Content-Security-Policy die echte Anmeldung mit GitHub und
  Google einmal ausprobieren; Not-Schalter `CSP_MODE=report-only` bzw.
  `off` in Portainer ([docs/betrieb/fehlersuche.md](docs/betrieb/fehlersuche.md)).
- **E-Mail-Link:** SMTP-Versand mit echtem Postfach noch nicht erprobt
  (Tests laufen über den Test-Briefkasten); einzurichten nach
  [docs/betrieb/email-anmeldung.md](docs/betrieb/email-anmeldung.md). Idee:
  automatische Einladungs-Mail beim Einladen.
- **Vorschläge beim Import:** mit echten Datenmengen unerprobt (Laufzeit der
  Vorschau, Liste „unklar“ bei Tausenden Einträgen, erneuter Import mit
  verknüpften Personen). Beziehungsfelder (z. B. Heiratsdatum) werden beim
  Verknüpfen nicht ergänzt.
- **Herkunfts-Übersicht** bei 390 px: Beim seitlichen Kreis überdeckt die
  Zahl an der Linie den Namensanfang.

## Wunschliste

Gesammelte Wünsche des Eigentümers — **erst nach seiner Freigabe bauen**
(AGENTS.md, Abschnitt 4).

- OAuth-Zugang für claude.ai-Connectoren; Anbindung an das Gateway (eigenes
  Repository).
- **Orte: zeitabhängige Staatszugehörigkeit** (Idee, nicht beauftragt):
  Breslau 1900 = Deutsches Reich, heute Polen — Bezeichnung oder Karte je
  nach Jahr mit dem damaligen Staat; bräuchte historische Grenzen bzw. eine
  Zuordnung Ort × Zeitraum → Staat.
- **Orte: eigene Orte in der Automatik:** Eigene Orte (Wüstung, Hof)
  erscheinen bei späteren Texten als Vorschlag, die automatische Zuordnung
  nutzt sie aber nicht (gleichnamige Weiler wären riskant). Bei Bedarf
  entscheiden.
