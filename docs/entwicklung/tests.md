# Entwicklung: Prüfen und Testen

Anleitung für die Testläufe. Aufbau der Tests und Testläufer-Konfiguration:
[betrieb-und-tests.md](../komponenten/betrieb-und-tests.md); was vor dem
Ausrollen alles grün sein muss: [AGENTS.md](../../AGENTS.md), Abschnitt 3.

| Befehl | Zweck |
|---|---|
| `npm run typecheck` | TypeScript-Prüfung (`tsc --noEmit`) |
| `npm run lint` | ESLint (Flat-Config `eslint.config.mjs`, Next-Regeln) |
| `npm test` | Vitest — Unit-Tests und Dienst-Tests |
| `npm run test:watch` | Vitest im Watch-Modus |

Die Unit-Tests (Rechte, Validierung, Graph-Algorithmen, Layout) brauchen keine
Datenbank. Die Dienst-Tests (`tests/services.db.test.ts`) laufen gegen die
**Mock-Datenbank** und überspringen sich mit Hinweis, wenn diese nicht
erreichbar oder leer ist — vorher also `npm run mock:setup`. Die Tests greifen
nie auf die normale Datenbank zu; schreibende Tests räumen ihre eigenen
Datensätze wieder ab.

## Tests

**Unit- und Dienst-Tests** (Vitest, Ordner `tests/`): `npm test`. Ohne
laufende Mock-Datenbank überspringen sich die `*.db.test.ts` mit Hinweis, der
Rest läuft trotzdem (so auch in der CI).

**End-to-End-Tests** (Playwright, Ordner `e2e/`) bedienen die App im Browser
(Chromium) gegen die Mock-Umgebung — standardmäßig gegen einen
**Produktions-Build** der Mock-Umgebung (`next build` nach `.next-e2e`,
`next start` auf dem Mock-Port), nicht gegen den Dev-Server.

Voraussetzungen: Docker Desktop läuft (`docker compose -f
docker-compose.dev.yml up -d` — Postgres), die Mock-Datenbank ist
einmal angelegt (`npm run mock:setup`), und einmalig `npx playwright install
chromium`.

| Befehl | Zweck | Dauer (Build aktuell) |
|---|---|---|
| `npm run test:e2e` | **alles mit einem Befehl:** Build prüfen (nur bei geänderten Quellen neu), Server starten, setup → read → write, Server beenden | ca. 1,5–3 min, mit Neubau 1–2 min mehr (früher gegen den Dev-Server 9–10 min) |
| `npm run test:e2e:setup` | nur Ausgangszustand: Mock-Daten neu, Anmeldungen | ca. 10 s |
| `npm run test:e2e:read` | setup + lesende Tests (`e2e/read/`, 217 Tests, 6 parallel) | ca. 1 min (früher 3:10–3:20 min) |
| `npm run test:e2e:write` | setup + ändernde Tests (`e2e/write/`, 128 Tests, 2 Dateien parallel) — ohne die lesenden | ca. 1:10 min (früher 4–5 min) |
| `npm run mock:build` / `npm run mock:start` | Build von Hand erzeugen bzw. den Server von Hand starten (z.B. für mehrere Terminals) | |
| `npm run test:e2e:headed` | alles mit sichtbarem Browser, ein Test nach dem anderen | |
| `npm run test:e2e:ui` | Playwright-Oberfläche: Tests einzeln starten, Schritte ansehen | |
| `npm run test:e2e:report` | HTML-Bericht des letzten Laufs öffnen | |

Eigene Optionen von `scripts/e2e.mjs` (nach `--`): `--dev` testet wie
früher gegen den Mock-Dev-Server (`npm run dev:mock`, Vorwärmen im Setup,
4 bzw. 2 Worker), `--rebuild` baut in jedem Fall neu, `--no-build` nimmt den
vorhandenen Build ungeprüft, `--skip-setup` siehe unten. Port und Datenbank
je Worktree wie bisher: `MOCK_PORT` in der Shell, `MOCK_DATABASE_URL` in der
`.env`. Läuft auf dem Port schon ein Server, wird er mitbenutzt und nicht
beendet (das Skript sagt, ob Dev-Server oder Build) — sonst startet und
beendet es ihn selbst.

Alle `test:e2e*`-Befehle reichen weitere Argumente an `playwright test`
durch (nach `--`), z.B. eine einzelne Datei oder einen Testnamen:

```bash
npm run test:e2e:write -- e2e/write/sources.spec.ts
npm run test:e2e:read -- e2e/read/permissions.spec.ts -g "Betrachter"
npm run test:e2e -- e2e/read/export.spec.ts e2e/write/media.spec.ts
npm run test:e2e -- --dev e2e/read/auth.spec.ts      # gegen den Dev-Server
```

Mit Filter (Datei oder `-g`) läuft `npm run test:e2e` in drei Schritten
nacheinander: Setup, die passenden lesenden, dann die passenden ändernden
Tests. Sonst zöge ein Filter auf eine `write`-Datei alle lesenden Tests als
Abhängigkeit mit. Der HTML-Bericht enthält danach nur den letzten Schritt.

**Setup überspringen:** Ist der Ausgangszustand schon vorbereitet (gerade
`npm run test:e2e:setup` gelaufen), spart
`--skip-setup` (oder Umgebungsvariable `E2E_SKIP_SETUP=1`) das Setup: `npm run test:e2e:write -- --skip-setup e2e/write/sources.spec.ts`.
Die ändernden Tests räumen ihre Datensätze selbst ab und lassen sich daher
mehrfach hintereinander ohne neues Setup laufen; die lesenden zählen gegen den
frisch befüllten Stand und brauchen ein Setup, nachdem ändernde Tests liefen.

Der Produktionsserver startet in gut einer Sekunde; ein eigener Server im
Hintergrund lohnt sich kaum. Wer trotzdem einen will (oder beim Sharding):
`npm run mock:build`, dann `npm run mock:start` in einem eigenen Terminal —
die Läufe benutzen ihn mit. Nach Codeänderungen diesen Server beenden, sonst
testen die Läufe den alten Stand.

**Auf mehrere Terminals verteilen (Sharding):** `npm run mock:start` in
einem eigenen Terminal (sonst beendet der zuerst fertige Teil den Server
der anderen), einmal `npm run test:e2e:setup`, dann in jedem Terminal einen
Teil mit `--skip-setup` — etwa
`npm run test:e2e:read -- --skip-setup --shard=1/2` und
`npm run test:e2e:read -- --skip-setup --shard=2/2`. Ohne `--skip-setup`
würde jeder Teil die Mock-Daten neu aufbauen, während die anderen noch laufen.
Die ändernden Tests erst nach den lesenden starten (sie verändern Zählungen).

**Worker** (gemessen gegen den Build): lesende 6 (6 und 8 je rund 55 s);
ändernde 2 Dateien gleichzeitig — 6 waren mit 64 statt 67 s kaum schneller,
weil die längste Datei die Dauer bestimmt, und mit 4 trafen Zählungen auf
fremde „E2E …“-Datensätze.

Ablauf: `scripts/e2e.mjs` baut bei Bedarf (`npm run mock:build`, Ordner
`.next-e2e`, getrennt von `.next` und `.next-mock`) und startet `npm run
mock:start` auf dem Mock-Port. Der Dev-Login ist in Produktion gesperrt; der
Server bekommt deshalb eine eng begrenzte Freigabe, die nur zusammen mit
Mock-Datenbank (`…_mock`/`…_test`) und Mock-Medienordner wirkt
(`lib/dev-login.ts`, [Komponenten-Doku](../komponenten/bibliotheken.md)).
Das Projekt `setup` baut die Mock-Daten neu auf (`npm run db:mock`) und
meldet jede Rolle einmal an (`e2e/.auth/`); nur gegen den Dev-Server ruft es
zusätzlich die Seiten einmal auf, damit Next.js sie vorab kompiliert. Danach
laufen die lesenden Tests (`e2e/read/`) parallel, erst
dann die ändernden (`e2e/write/`); diese legen eigene, „E2E …“ benannte
Datensätze an und räumen sie wieder ab. Jeder Test schlägt außerdem fehl, wenn
im Browser ein unerwarteter Konsolenfehler oder eine nicht abgefangene
Ausnahme auftritt (`e2e/support/fixtures.ts`), auch bei einem
Hydration-Fehler (React #418). Die Tests sprechen nur mit der
App (Browser und HTTP-API), nie direkt mit Datenbank oder Medienordner. Was
die einzelnen Spec-Dateien prüfen, Hilfen, Konfiguration und bekannte Flakes:
[betrieb-und-tests.md](../komponenten/betrieb-und-tests.md#9-end-to-end-tests-e2e-playwright).

**Fehlersuche bei einem roten E2E-Test:**

- `npm run test:e2e:report` öffnen; bei Fehlschlägen liegen dort Screenshot
  und Trace (`npx playwright show-trace test-results/…/trace.zip` zeigt jeden
  Schritt mit DOM, Netzwerk und Konsole).
- Den Test einzeln und sichtbar wiederholen:
  `npm run test:e2e:write -- --skip-setup e2e/write/sources.spec.ts --headed -g "Quelle löschen"`.
- Wackelt ein Test, mit `--repeat-each=3` wiederholen.
- Nach einem abgebrochenen Lauf können „E2E …“-Datensätze übrig sein — das
  nächste Setup baut die Mock-Daten ohnehin neu auf.
