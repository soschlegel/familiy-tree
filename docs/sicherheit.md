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
- **Kopfzeilen aller Antworten** (`next.config.mjs`).

## Behobene Befunde

| Bereich | Risiko vorher | Was jetzt gilt |
|---|---|---|
| Schreibende Anfragen fremder Webseiten (CSRF) | Schutz hing allein an der Cookie-Einstellung des Browsers. | Zweite Sicherung: schreibende Anfragen mit fremder Herkunft (`Origin`, `Sec-Fetch-Site`) werden mit 403 abgelehnt — noch vor der Anmeldeprüfung (`lib/request-guard.ts`). |
| Große Anfragekörper | Ein Körper wurde vollständig gelesen, bevor die fachliche Größenprüfung griff; viel Speicher je Anfrage möglich. | Grenze laut `Content-Length` vor dem Lesen (JSON 2 MiB, Bilder Uploadgrenze + 1 MiB, Importe 201 MiB); ohne Längenangabe 411. |
| Anfrageflut angemeldeter Benutzer bzw. KI-Schlüssel | Keine Begrenzung; aufwendige Auswertungen (ganzer Baum, Dubletten, Export) beliebig oft hintereinander. | Großzügige Grenzen je Benutzer und Art der Anfrage sowie je KI-Schlüssel; darüber 429 mit Wartezeit (`lib/rate-limit.ts`). |
| Zwischenspeichern personenbezogener Antworten | API-Antworten ohne Vorgabe zum Zwischenspeichern; ein Proxy oder Browser-Verlauf hätte sie aufheben können. | Jede API-Antwort `Cache-Control: private, no-store` (Bilder: nur im Browser des Benutzers) und `nosniff`. |
| Bildauslieferung | Die Inhaltsart kam ungeprüft aus dem Datensatz; ein Datensatz mit HTML- oder SVG-Typ wäre im Browser als Seite ausgeführt worden. | Nur feste Bildarten; alles andere als neutraler Download-Typ, dazu Sandbox-Richtlinie und `nosniff`. |
| Einbetten in fremde Seiten, Referrer | Seiten ließen sich in fremde Seiten einbetten (Clickjacking); externe Links übermittelten die Adresse samt Kennungen. | `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, ohne `X-Powered-By`. |
| Baum ohne freigegebene Familie | Ein Benutzer ohne Familie bekam alle Personen als anonyme Platzhalter samt Verknüpfungen — Umfang und Struktur des Bestands. | Leere Antwort. |
| Beziehung zu einer verborgenen Person anlegen | Die Antwort unterschied „gibt es nicht“ und „darfst du nicht“ und bestätigte so verborgene Personen. | Verborgen = nicht vorhanden (404). |
| Scans gemeinsam genutzter Quellen | Wer einen einzigen Beleg einer Quelle bearbeiten durfte, konnte ihre Scans löschen — auch über „lösen“ mit Löschen des verwaisten Bildes. | Endgültiges Löschen nur, wer jeden Beleg der Quelle ändern dürfte (wie „Quelle löschen“), für Löschen und Lösen gleich. |
| Bildverlust über den KI-Zugang | Löschte die KI ein Ereignis oder eine Beziehung, verschwanden Bilder, die nur daran hingen — obwohl die KI nie Bilder löschen soll. | Abgelehnt mit Hinweis; in der App (mit Rückfrage) weiterhin möglich. |
| Abruf von Adressen über den KI-Zugang | Ein Schlüssel mit Schreibstufe konnte den Server Adressen abrufen lassen, auch ohne ein einziges Ziel bearbeiten zu dürfen. | Ziele und Rechte werden vor dem Abruf geprüft. |
| Fehlermeldungen an KI-Clients | Unerwartete Fehler gingen samt Datenbankmeldung an den Client. | Nur eine Kennung; Einzelheiten im Server-Log. |
| Änderungsgeschichte | Bearbeiter sahen Namen fremder KI-Schlüssel und Paket-Titel, die Dateinamen von Importen oder freie Texte nennen können; Einträge zu nicht mehr vorhandenen Personen zeigten Feldwerte. | Schlüsselnamen nur für Besitzer und Admins, Paket-Titel nur für Urheber und Admins (sonst neutral); Einträge zu nicht mehr vorhandenen Personen für Nicht-Admins ohne Feldwerte. |
| HTML aus Importen (ReDoS) | Reguläre Ausdrücke mit quadratischer bis kubischer Laufzeit; ein präparierter Text konnte den Server minutenlang blockieren. | Umwandlung in einem linearen Durchlauf. |
| Lebenszeichen ohne Anmeldung | Jeder Aufruf löste eine Datenbankabfrage und Probedateien aus. | Ergebnis gilt einige Sekunden; gleichzeitige Aufrufe teilen sich eine Prüfung. |

Tests zu den Befunden: `tests/request-guard.test.ts`,
`tests/rate-limit.test.ts`, `tests/api-guard.db.test.ts`,
`tests/sicherheit.db.test.ts`, `tests/gedcom-html.test.ts`,
`tests/health.test.ts`, `tests/ai-token-delete.db.test.ts`.

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
- **Keine globale Content-Security-Policy** für die Seiten. Die Oberfläche
  gibt Benutzertexte nur als Text aus (kein ungeprüftes HTML); eine
  Richtlinie wäre eine zusätzliche Sicherung und ist für später vorgemerkt.
- **Lebenszeichen ohne Anmeldung** — nötig für Container und Proxy; es
  verrät nur „ok“ oder „Fehler“.

## Hinweise für den Betrieb

- Der Reverse-Proxy beendet TLS, setzt `Strict-Transport-Security`, setzt
  `X-Forwarded-Host` und hängt `X-Forwarded-For` an (vom Client gelieferte
  Werte überschreiben bzw. nicht ungeprüft durchreichen). Er begrenzt
  Anfragen Unbekannter.
- `AUTH_URL` muss die öffentliche Adresse der App sein — sie gilt auch als
  erlaubte Herkunft schreibender Anfragen.
- `RATE_LIMIT=off` nie in Produktion setzen (nur für den E2E-Build
  vorgesehen). `ENABLE_DEV_LOGIN` bleibt im Stack aus.
- Grenzen bei Bedarf über `MAX_UPLOAD_BYTES` anpassen; die
  Körpergrenzen der API wachsen mit.
- KI-Schlüssel mit Schreibstufe nur an Personen geben, die auch in der App
  bearbeiten dürfen; nicht mehr benötigte Schlüssel widerrufen.
- Meldungen mit „Interner Fehler (Kennung …)“ lassen sich über die Kennung
  im Server-Log wiederfinden.
