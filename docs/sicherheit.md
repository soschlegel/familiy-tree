# Sicherheitsprüfung

Ergebnis einer Durchsicht der App auf Sicherheits- und Datenschutzlücken
(Stand November 2026). Beschrieben ist, **was jetzt gilt** — Einzelheiten
stehen in der Komponenten-Doku, auf die verwiesen wird. Die App verwaltet
echte Familiendaten; der wichtigste Grundsatz bleibt: **Was ein Benutzer
nicht sehen darf, existiert für ihn nicht** (Antwort wie „nicht gefunden“).

## Geprüfte Bereiche

- **Anfrage-Rahmen der Web-API** (`route()` in `lib/api.ts`): Anmeldung,
  Herkunft schreibender Anfragen, Größe von Anfragen, Anfragegrenzen,
  Fehlermeldungen, Kopfzeilen der Antworten.
- **Rechte und Sichtbarkeit** in den Diensten (`lib/scope.ts`,
  `lib/media-scope.ts`, `lib/services/`): Personen, Beziehungen,
  Ereignisse, Quellen, Bilder, Änderungsgeschichte, Baum, Dubletten,
  Folgedubletten, Herkunft und Importverwaltung.
- **Bilder**: Hochladen, Ausliefern, Lösen und Löschen, Abruf von Adressen
  über den KI-Zugang.
- **KI-Zugang** (`/api/mcp`, `mcp/`): Anmeldung mit Schlüssel, Stufen,
  Fehlermeldungen, Grenzen, Nebenwirkungen schreibender Werkzeuge.
- **Verarbeitung von Fremdtext**: HTML-Fragmente aus Importen und Eingaben.
- **Öffentliche Endpunkte**: Lebenszeichen `/api/health`.
- **Anmeldung per E-Mail-Link** (`lib/email-login.ts`, `lib/auth.ts`,
  Abschnitt unten).
- **Kopfzeilen aller Antworten** (`next.config.mjs`) und
  **Content-Security-Policy** (`lib/csp.ts`, `middleware.ts`).

## Behobene Befunde

| Bereich | Risiko vorher | Was jetzt gilt |
|---|---|---|
| Schreibende Anfragen fremder Webseiten (CSRF) | Schutz hing allein an der Cookie-Einstellung des Browsers. | Zweite Sicherung: schreibende Anfragen mit fremder Herkunft (`Origin`, `Sec-Fetch-Site`) werden mit 403 abgelehnt — noch vor der Anmeldeprüfung (`lib/request-guard.ts`). |
| Große Anfragekörper | Ein Körper wurde vollständig gelesen, bevor die fachliche Größenprüfung griff; viel Speicher je Anfrage möglich. | Grenze laut `Content-Length` vor dem Lesen (JSON 2 MiB, Bilder Uploadgrenze + 1 MiB, Importe 201 MiB); ohne Längenangabe 411. |
| Anfrageflut angemeldeter Benutzer bzw. KI-Schlüssel | Keine Begrenzung; aufwendige Auswertungen (ganzer Baum, Dubletten, Export) beliebig oft hintereinander. | Großzügige Grenzen je Benutzer und Art der Anfrage sowie je KI-Schlüssel; darüber 429 mit Wartezeit (`lib/rate-limit.ts`). |
| Zwischenspeichern personenbezogener Antworten | API-Antworten ohne Vorgabe zum Zwischenspeichern; ein Proxy oder Browser-Verlauf hätte sie aufheben können. | Jede API-Antwort `Cache-Control: private, no-store` (Bilder: nur im Browser des Benutzers) und `nosniff`. |
| Bildauslieferung | Die Inhaltsart kam ungeprüft aus dem Datensatz; ein Datensatz mit HTML- oder SVG-Typ wäre im Browser als Seite ausgeführt worden. | Nur feste Bildarten; alles andere als neutraler Download-Typ, dazu Sandbox-Richtlinie und `nosniff`. |
| Einbetten in fremde Seiten, Referrer | Seiten ließen sich in fremde Seiten einbetten (Clickjacking); externe Links übermittelten die Adresse samt Kennungen. | `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, ohne `X-Powered-By`. |
| Eingeschleuste Skripte (XSS) | Keine Content-Security-Policy für die Seiten; ein eingeschleustes Skript wäre nur durch die Textausgabe der Oberfläche verhindert worden. | Zweite Sicherung: Richtlinie mit Nonce je Antwort — der Browser führt nur die Skripte der App aus, lädt nichts von fremden Adressen, kein Einbetten ([unten](#content-security-policy)). |
| Baum ohne freigegebene Familie | Ein Benutzer ohne Familie bekam alle Personen als anonyme Platzhalter samt Verknüpfungen — Umfang und Struktur des Bestands. | Leere Antwort. |
| Beziehung zu einer verborgenen Person anlegen | Die Antwort unterschied „gibt es nicht“ und „darfst du nicht“ und bestätigte so verborgene Personen. | Verborgen = nicht vorhanden (404). |
| Scans gemeinsam genutzter Quellen | Wer einen einzigen Beleg einer Quelle bearbeiten durfte, konnte ihre Scans löschen — auch über „lösen“ mit Löschen des verwaisten Bildes. | Endgültiges Löschen nur, wer jeden Beleg der Quelle ändern dürfte (wie „Quelle löschen“), für Löschen und Lösen gleich. |
| Bildverlust über den KI-Zugang | Löschte die KI ein Ereignis oder eine Beziehung, verschwanden Bilder, die nur daran hingen — obwohl die KI nie Bilder löschen soll. | Abgelehnt mit Hinweis; in der App (mit Rückfrage) weiterhin möglich. |
| Abruf von Adressen über den KI-Zugang | Ein Schlüssel mit Schreibstufe konnte den Server Adressen abrufen lassen, auch ohne ein einziges Ziel bearbeiten zu dürfen. | Ziele und Rechte werden vor dem Abruf geprüft. |
| Fehlermeldungen an KI-Clients | Unerwartete Fehler gingen samt Datenbankmeldung an den Client. | Nur eine Kennung; Einzelheiten im Server-Log. |
| Änderungsgeschichte | Bearbeiter sahen Namen fremder KI-Schlüssel und Paket-Titel, die Dateinamen von Importen oder freie Texte nennen können; Einträge zu nicht mehr vorhandenen Personen zeigten Feldwerte. | Schlüsselnamen nur für Besitzer und Admins, Paket-Titel nur für Urheber und Admins (sonst neutral); Einträge zu nicht mehr vorhandenen Personen zeigen Feldwerte nur, wenn der Betrachter die Person nach ihren im Eintrag gespeicherten Familien (Stand des Eintrags) sehen durfte — gleiche Prüffunktion wie bei vorhandenen Personen; ältere Einträge ohne diese Angabe bleiben für Nicht-Admins ohne Feldwerte. Dieselbe Regel gilt für die Einträge aufgegangener Personen im Verlauf der bleibenden Person — nie deren heutige Familien; verborgene zeigen dort nur Art und Aktion. Namen, Ereignisse, Belege, Bilder und Beziehungen speichern dafür die Familien ihrer Person(en) zum Zeitpunkt des Eintrags; bei mehreren Personen genügt wie bei vorhandenen Datensätzen eine sichtbare, nicht eindeutige Einträge (z.B. Bild an einer Quelle) bleiben Admins vorbehalten. |
| HTML aus Importen (ReDoS) | Reguläre Ausdrücke mit quadratischer bis kubischer Laufzeit; ein präparierter Text konnte den Server minutenlang blockieren. | Umwandlung in einem linearen Durchlauf. |
| Lebenszeichen ohne Anmeldung | Jeder Aufruf löste eine Datenbankabfrage und Probedateien aus. | Ergebnis gilt einige Sekunden; gleichzeitige Aufrufe teilen sich eine Prüfung. |

Tests zu den Befunden: `tests/request-guard.test.ts`,
`tests/rate-limit.test.ts`, `tests/api-guard.db.test.ts`,
`tests/sicherheit.db.test.ts`, `tests/gedcom-html.test.ts`,
`tests/health.test.ts`, `tests/ai-token-delete.db.test.ts`,
`tests/changelog-subject.db.test.ts`, `tests/csp.test.ts`,
`e2e/read/csp.spec.ts`.

## Content-Security-Policy

**Seiten** (alle Antworten außer `/api`, Build-Dateien, Icons, Geodaten):
`middleware.ts` erzeugt je Anfrage eine Nonce (128 Bit) und setzt die
Richtlinie aus `pagePolicy()` (`lib/csp.ts`) auf die Antwort und auf die
Anfrage — Next.js liest sie beim Rendern und hängt die Nonce an jedes
eigene Skript (Hydration, RSC-Daten, Chunks). Produktion, wörtlich:

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self';
connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none';
base-uri 'none'; form-action 'self' https://github.com https://accounts.google.com;
frame-ancestors 'none'; upgrade-insecure-requests
```

| Direktive | Warum so |
|---|---|
| `default-src 'self'` | Rückfall für alles Ungenannte (z.B. Manifest, Medien): nur die eigene Adresse. |
| `script-src 'nonce-…' 'strict-dynamic'` | Nur Skripte mit der Nonce dieser Antwort; was sie nachladen (Chunks von Next.js), erbt das Vertrauen. Kein `'unsafe-inline'`, kein `'unsafe-eval'`. `'self'` gilt nur in Browsern ohne `'strict-dynamic'`. |
| `style-src 'self' 'unsafe-inline'` | React schreibt `style`-Attribute ins Server-HTML (Baum, Karte, Balken, Farben); React Flow setzt viele Stile. Ohne `'unsafe-inline'` fehlten sie. Bewusst **ohne** Nonce: eine Nonce macht `'unsafe-inline'` wirkungslos. Eingeschleuste Stile können keine Skripte ausführen; Restrisiko gering. |
| `img-src 'self'` | Bilder kommen nur aus `/api/media` und den Icons; keine `data:`-/`blob:`-Bilder (am Build geprüft). |
| `font-src 'self'` | Schriften liefert `next/font` selbst aus. |
| `connect-src 'self'` | `fetch` nur an die eigene API und `/geo/countries.json`; keine externen Karten-Kacheln. |
| `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'` | Keine Plugins, keine eingebetteten Seiten, keine Web-Worker in der App. |
| `base-uri 'none'` | Die App nutzt kein `<base>`; ein eingeschleustes könnte sonst relative Skript-Adressen umleiten. |
| `form-action 'self' https://github.com https://accounts.google.com` | Formulare nur an die App — und an die OAuth-Anbieter: Die Anmelde-Knöpfe sind Formulare mit Server-Action. Mit JavaScript leitet der Client per Navigation zum Anbieter (`form-action` greift nicht). Abgeschickt vor der Hydration oder ohne JavaScript ist es ein echter Formular-POST mit 303 zum Anbieter, und Chromium prüft auch Weiterleitungsziele gegen `form-action`. Ziele laut Auth.js: `github.com/login/oauth/authorize`, `accounts.google.com/o/oauth2/v2/auth`. Festgehalten in `tests/csp.test.ts`. |
| `frame-ancestors 'none'` | Nicht in fremde Seiten einbetten (wie `X-Frame-Options: DENY`, das für ältere Browser bleibt). |
| `upgrade-insecure-requests` | Nur, wenn `AUTH_URL` mit `https://` beginnt — sonst würde die Mock-Umgebung auf `http://localhost` ihre eigenen Dateien nicht laden. |

**Entwicklungsserver** (`next dev`): zusätzlich `'unsafe-eval'` (Fehlerhilfen
von React/Next.js) und `ws:`/`wss:` (Neuladen bei Änderungen), kein
`upgrade-insecure-requests` — nur dort.

**API** (`/api/…`, fest in `next.config.mjs`, gleich `API_POLICY`):
`default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; sandbox`.
JSON, Bilder und Downloads sind keine Seiten; öffnet ein Browser eine
Antwort doch als Dokument, lädt sie nichts, führt nichts aus und lässt sich
nicht einbetten. Diese Kopfzeile ersetzt die gleichnamige eines
Route-Handlers, deshalb steht das `sandbox` der Bildroute mit drin.
Downloads (Export, Importdateien) funktionieren damit unverändert.

**Nonce statt fester Richtlinie:** Next.js kann eine Nonce nur in
dynamisch gerenderte Seiten schreiben (Next.js-Doku „Content Security
Policy“, Abschnitt „Nonces“). Hier kostet das nichts: Das Wurzel-Layout
liest die Sitzung, alle Seiten waren schon vorher dynamisch (Build-Ausgabe:
nur Icons statisch). Gemessen im Produktions-Build der Mock-Umgebung (Median
aus 40 Aufrufen, vorher → nachher): `/login` 9,8 → 8,0 ms, `/tree` 29,5 →
26,1 ms, `/people` 23,0 → 23,3 ms, `/hilfe` 9,5 → 10,4 ms — im Rauschen.
Die Alternative ohne Nonce bräuchte `'unsafe-inline'` für Skripte (die
Inline-Skripte von Next.js) und wäre gegen XSS fast wirkungslos; die
experimentelle SRI-Variante deckt Inline-Skripte nicht ab.

**Middleware in Node.js:** `CSP_MODE` wird zur Laufzeit gelesen (nicht beim
Build). `/api` läuft bewusst nicht durch die Middleware — große Uploads und
Importe sollen nicht durch ihre Körpergrenze.

**Not-Schalter `CSP_MODE`:** `enforce` (Standard; unbekannte Werte ebenso),
`report-only` (Kopfzeile `Content-Security-Policy-Report-Only`: nichts wird
blockiert, Verstöße nur in der Browser-Konsole) oder `off`. Wirkt nur auf
die Seiten, nach Neustart des Containers, ohne neues Image
([Fehlersuche](betrieb/fehlersuche.md#content-security-policy)). Kein
Report-Endpunkt — Verstöße landen weder auf dem Server noch bei Dritten.

**Prüfung in jedem E2E-Lauf:** Der CSP-Wächter der Fixtures
(`e2e/support/fixtures.ts`) lässt jeden Test scheitern, in dem der Browser
eine Verletzung meldet.

## Anmeldung per E-Mail-Link

Was gilt (Einzelheiten:
[bibliotheken.md](komponenten/bibliotheken.md#libemail-logints), Betrieb:
[betrieb/email-anmeldung.md](betrieb/email-anmeldung.md)):

- **Nur Eingeladene:** Eine Mail geht nur an Adressen aus der
  Benutzerliste, die nicht gesperrt sind — geprüft vor dem Anfordern und
  erneut im `signIn`-Callback, beim Einlösen noch einmal. Die App ist kein
  Mail-Verteiler für fremde Adressen; ein Konto entsteht auf diesem Weg nie,
  übernommen werden kann nur das Konto mit genau dieser Adresse.
- **Keine Auskunft über Konten:** dieselbe Antwort für bekannte,
  unbekannte, gesperrte, ungültige und gedrosselte Adressen, frühestens
  nach 800 ms plus Zufall; der SMTP-Versand läuft im Hintergrund. Das
  Anfordern direkt bei Auth.js (`POST /api/auth/signin/nodemailer`) ist
  gesperrt, damit niemand an diesen Regeln vorbei anfragt.
- **Link:** 15 Minuten, einmalig, nur der neueste gilt; gespeichert nur als
  SHA-256 über Token + `AUTH_SECRET`; abgelaufene werden beim nächsten
  Anfordern gelöscht. Die Adresse im Link stammt aus `AUTH_URL`, nie aus
  dem Host-Kopf der Anfrage.
- **Vorab-Abruf:** Der Link öffnet nur eine Bestätigungsseite; angemeldet
  wird erst mit „Jetzt anmelden“ (POST). Ein GET auf die Auth.js-Rückruf-
  adresse löst nichts ein. POST von fremden Seiten → 403 (Anmelde-CSRF).
- **Drosselung** je Adresse (3 in 15 Minuten) und je Absender (10 je
  Stunde), unabhängig von `RATE_LIMIT`.
- **SMTP-Zugang** nur als Umgebungsvariable, nie in der Datenbank
  („Einstellungen“); ohne TLS von Anfang an wird STARTTLS verlangt.
- **Test-Briefkasten** (Mail als Datei) nur bei `MAIL_TEST_OUTBOX=mock-only`
  zusammen mit Mock-Datenbank und Mock-Medienordner — dieselbe enge
  Absicherung wie beim Dev-Login.

Tests: `tests/email-login.test.ts`, `e2e/write/email-login.spec.ts`.

## Bewusst akzeptierte Restrisiken

- **Anfragegrenzen im Speicher eines Prozesses.** Sie gelten nur für den
  einen Container und sind nach einem Neustart leer. Sie zielen auf
  angemeldete Benutzer und gültige Schlüssel; Massenanfragen Unbekannter
  gehören in den Reverse-Proxy.
- **Anfragen ohne Browser-Herkunft** (kein `Origin`, kein `Sec-Fetch-Site`)
  gelten nicht als fremd. Ohne Browser gibt es kein CSRF; die Anmeldung
  wird ohnehin geprüft.
- **Platzhalter im Baum.** Wer mindestens einer Familie angehört, sieht
  verborgene Verwandte als „Nicht freigegeben“ — gewollt, damit der Baum
  zusammenhängt.
- **`style-src 'unsafe-inline'`** in der Content-Security-Policy — nötig
  für `style`-Attribute und React Flow. Eingeschleuste Stile führen keinen
  Code aus; die Oberfläche gibt Benutzertexte ohnehin nur als Text aus.
- **Lebenszeichen ohne Anmeldung** — nötig für Container und Proxy; es
  verrät nur „ok“ oder „Fehler“.
- **E-Mail-Link: Postfach = Zugang.** Wer das Postfach einer eingeladenen
  Person liest, kann sich als sie anmelden — wie bei jedem
  „Passwort vergessen“-Verfahren. Die Drosselung liegt im Speicher (nach
  einem Neustart leer) und zählt je Absender den letzten
  X-Forwarded-For-Eintrag; ohne Reverse-Proxy könnte ein direkt
  verbundener Client ihn selbst setzen.

## Hinweise für den Betrieb

- Der Reverse-Proxy beendet TLS, setzt `Strict-Transport-Security`, setzt
  `X-Forwarded-Host` und hängt `X-Forwarded-For` an (vom Client gelieferte
  Werte überschreiben bzw. nicht ungeprüft durchreichen). Er begrenzt
  Anfragen Unbekannter. Er setzt **keine eigene Content-Security-Policy**
  (die App setzt sie mit Nonce je Seite; eine zweite gälte zusätzlich und
  blockierte die Skripte) — [Reverse-Proxy](betrieb/reverse-proxy.md).
- `CSP_MODE` nur im Fehlerfall vorübergehend auf `report-only` oder `off`.
- `AUTH_URL` muss die öffentliche Adresse der App sein — sie gilt auch als
  erlaubte Herkunft schreibender Anfragen.
- `RATE_LIMIT=off` nie in Produktion setzen (nur für den E2E-Build
  vorgesehen). `ENABLE_DEV_LOGIN` bleibt im Stack aus, `MAIL_TEST_OUTBOX`
  ebenso.
- Für den E-Mail-Link ein eigenes Postfach mit App-Passwort verwenden;
  `SMTP_PASSWORD` nur in den Stack-Variablen.
- Grenzen bei Bedarf über `MAX_UPLOAD_BYTES` anpassen; die
  Körpergrenzen der API wachsen mit.
- KI-Schlüssel mit Schreibstufe nur an Personen geben, die auch in der App
  bearbeiten dürfen; nicht mehr benötigte Schlüssel widerrufen.
- Meldungen mit „Interner Fehler (Kennung …)“ lassen sich über die Kennung
  im Server-Log wiederfinden.
