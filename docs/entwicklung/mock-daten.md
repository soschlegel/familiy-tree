# Mock-Daten

Für Entwicklung, Tests und Vorführungen gibt es einen deterministischen
Testdatensatz in einer **eigenen Datenbank** (`familytree_mock`) und einem
**eigenen Medienordner** (`./data/media-mock`) — die normale Datenbank und
`./data/media` bleiben unberührt.

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres
npm run mock:setup    # Datenbank anlegen, Schema anwenden, befüllen, Bilder erzeugen
npm run dev:mock      # Dev-Server gegen die Mock-Daten: http://localhost:3100
```

| Befehl | Zweck |
|---|---|
| `npm run mock:setup` | legt `familytree_mock` an (falls nötig), `prisma db push`, befüllt |
| `npm run db:mock` | nur neu befüllen (löscht vorher alle Mock-Daten) |
| `npm run dev:mock` | `next dev` auf Port **3100** mit Build-Ordner `.next-mock` — läuft parallel zum normalen Dev-Server auf 3000 |
| `npm run mock:env` | zeigt die berechnete Mock-Umgebung |

Die Befehle laufen über `scripts/mock.mjs` (plattformunabhängig, auch unter
Windows). Der Name der Mock-Datenbank wird aus `DATABASE_URL` abgeleitet
(`…/familytree` → `…/familytree_mock`) oder über `MOCK_DATABASE_URL` gesetzt.
`prisma/seed-mock.ts` verweigert den Dienst, wenn der Datenbankname nicht auf
`_mock` oder `_test` endet, und ebenso, wenn der Medienordner nicht auf `-mock`
oder `-test` endet (anderer Ordner über `MOCK_MEDIA_DIR`). Jeder Lauf leert
Mock-Datenbank und Mock-Medienordner und baut alles neu auf; das Ergebnis ist
bei jedem Lauf identisch, einschließlich der IDs (`mock-p-001`, `mock-r-0001`,
`mock-family-a`, …). Geleert werden dabei auch Importläufe, Herkunft,
Fremdkennungen und Rohdaten samt den aufbewahrten Importdateien — die Mock-Daten
selbst enthalten keinen Import. Zum Ausprobieren des GEDCOM-Imports liegen
erfundene Dateien in `tests/fixtures/gedcom/` (`minimal-551.ged`,
`myheritage.ged` im MyHeritage-Stil, `gedcom7.ged`, `torture.ged` mit
Grenzfällen); echte Stammbäume gehören nicht ins Repository.

**Inhalt** (Generator: `prisma/mock-data.ts`, auch direkt in Tests nutzbar;
Quellen `mock-s-01` … `mock-s-09`, Belege `mock-c-001` …):
rund 195 Personen über sechs Generationen ab ca. 1860 in vier Familien:

| ID | Familie |
|---|---|
| `mock-family-a` | Familie Becker (Hannover) |
| `mock-family-b` | Familie Hoffmann (Sachsen) |
| `mock-family-c` | Familie Wagner (Franken) |
| `mock-family-d` | Familie Schulz (Ostsee) |

Die Familien sind durch Heiraten verbunden (Eingeheiratete gehören zu beiden
Familien). Eingebaut sind außerdem: Scheidung mit Wiederheirat,
Halbgeschwister, ein Stiefkind, eine Adoption (Kind mit leiblicher Mutter und
zwei Adoptiveltern, also drei Elternteilen), ein Pflegekind, Personen mit
fehlenden Angaben (Geburtsdatum, Geburtsort, Geschlecht, Sterbedatum bei über
100-Jährigen), drei mögliche Dubletten, drei Personen ohne Familie (nur für
Admins sichtbar), Notizen sowie Platzhalter-Porträts und zwei Hochzeitsfotos.
Die ältesten Generationen haben ungenaue Daten (nur Jahr oder Monat, „um“,
„vor“, Hochzeiten nur mit Jahr). Neun Quellen verschiedener Art belegen
Angaben über mehrere Personen und Ehen; eine davon (Heiratsregister) ist in
Familie A und für eine Person nur aus Familie B zitiert, eine nur in
Familie D, eine ist noch unbelegt. Die meisten Personen haben keinen Beleg.
Dazu kommen Lebensereignisse (`mock-e-001` …: Taufe, Beruf, Beerdigung der
Stammväter, ein Wohnort „von … bis …“, ein Abschluss „zwischen … und …“, eine
Konfirmation nur mit Wortlaut, ein sonstiges Ereignis „Kapitänspatent“, eine
Verlobung an einer Ehe, eine abweichende zweite Geburtsangabe; für die
[Karte](../fachlich/karte-und-orte.md) Wohnorte und eine Auswanderung in GEDCOM-Ortsformen,
auch mit historischen Namen: „Breslau, Schlesien, Preußen“, „Temeswar,
Banat“, „Berkum, Peine, Lk Peine, Niedersachsen, Germany“, „New York, New
York, USA“), Heiratsorte
bei zwei von drei datierten Ehen, ein Scheidungsort, zwei Partnerschaften
mit unbekanntem Ehestand, Rufname, Titel, Namenszusatz, eine Todesursache und
zwei weitere Namen (`mock-n-01`, `mock-n-02`).
Die IDs dieser Sonderfälle liefert `generateMockData().landmarks`
(`landmarks.genealogy` für die Ereignisse und Namen).

**Benutzer** (Anmeldung per Dev-Login — Feld „Dev-Login: E-Mail-Adresse“,
nur E-Mail — oder per E-Mail-Link: die Mail landet nicht im Versand,
sondern als JSON-Datei in `<Mock-Medienordner>/mail-outbox/`, z.B.
`data/media-mock/mail-outbox/`; der Link steht im Feld `url`):

| E-Mail | Rolle | Familien | KI-Zugang |
|---|---|---|---|
| `admin@example.test` | Administrator | alle | lesen und schreiben |
| `editor@example.test` | Bearbeiter | A bearbeiten, B lesen | lesen und schreiben |
| `viewer@example.test` | Betrachter | A lesen | lesen |
| `nofamily@example.test` | Betrachter | keine | kein Zugang |
| `blocked@example.test` | gesperrt | (A lesen) — Anmeldung schlägt fehl | (lesen) |

Der Bearbeiter hat eine eigene Person (`landmarks.selfEditor`, in Familie A,
alle vier Großeltern bekannt; die Großeltern mütterlicherseits gehören nur zu
Familie D und sind für ihn gesperrt) — damit zeigt sein Baum gleich
Verwandtschaftsgrade und Linien.

**Feste KI-Schlüssel** für Tests und Entwicklung, ebenfalls deterministisch
(`npm run -s mcp:key <name>` gibt den Schlüssel aus, Standard `editor-read`):
`admin-write`, `editor-write`, `editor-read`, `viewer-read`, `viewer-write`
(Schlüssel „schreiben“ beim Betrachter mit Recht „lesen“ — wirkt nur lesend),
`editor-revoked` (widerrufen), `editor-expired` (abgelaufen),
`nofamily-read` (Benutzer ohne KI-Recht → 403), `blocked-read` (gesperrter
Benutzer → 401). Sie stehen öffentlich im Repository
([prisma/mock-data.ts](../../prisma/mock-data.ts)) und existieren nur in der
Mock-Datenbank — in einer echten Installation legt sie niemand an, und dort
funktionieren sie nicht.
