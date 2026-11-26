# Anmeldung per E-Mail-Link

Für eingeladene Verwandte ohne GitHub- oder Google-Konto: Auf der
Anmeldeseite geben sie ihre E-Mail-Adresse ein und tippen auf „Link
zusenden“. Die App schickt über **ein eigenes Postfach per SMTP** einen
Link; der führt auf eine Bestätigungsseite mit dem Knopf „Jetzt anmelden“.
Technik: [bibliotheken.md](../komponenten/bibliotheken.md#libemail-logints).

## Regeln

- **Nur auf Einladung**, wie bei GitHub/Google: Eine Mail geht nur an
  Adressen aus der Benutzerliste (Verwaltung → Benutzer), die nicht
  gesperrt sind. Ein neues Konto entsteht auf diesem Weg nie.
- **Keine Auskunft über Konten:** Nach „Link zusenden“ steht immer dieselbe
  Meldung („Wenn diese Adresse freigeschaltet ist, kommt gleich eine
  E-Mail …“), gleich schnell — auch bei unbekannten, gesperrten oder
  gedrosselten Adressen.
- **Link:** gilt 15 Minuten und nur einmal; ein neuer Link ersetzt den
  vorigen. Gespeichert wird nur ein Hash des Links. Er baut auf
  `PUBLIC_URL` auf — die Adresse muss also stimmen
  ([oauth.md](oauth.md)).
- **Drosselung:** höchstens 3 Links je Adresse in 15 Minuten und 10
  Anforderungen je Absender in der Stunde. Danach kommt still keine Mail
  mehr (die Meldung bleibt gleich). Der Zähler liegt im Speicher und ist
  nach einem Neustart leer.
- Beim **Einladen** geht keine Mail hinaus — der Administrator sagt der
  Person Bescheid, dass sie sich mit „Link zusenden“ anmelden kann.

## Einrichten in Portainer

Im Stack unter „Environment variables“ eintragen (Vorlage:
[stack.env.example](../../stack.env.example)) und den Stack neu
bereitstellen:

| Variable | Wert |
|---|---|
| `SMTP_HOST` | SMTP-Server des Anbieters, z.B. `smtp.example.de` |
| `SMTP_PORT` | `587` (STARTTLS, Standard) oder `465` (TLS von Anfang an) |
| `SMTP_SECURE` | leer lassen; nur nötig, wenn ein Port ungleich 465 sofort TLS spricht (`true`) |
| `SMTP_USER` | Anmeldename des Postfachs, meist die Adresse |
| `SMTP_PASSWORD` | Passwort bzw. App-Passwort des Postfachs |
| `SMTP_FROM` | Absender, z.B. `Stammbaum <stammbaum@example.de>` — muss zum Postfach passen |

Fehlt einer der Werte `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` oder
`SMTP_FROM`, gibt es den E-Mail-Link nicht (kein Feld auf der
Anmeldeseite); GitHub/Google bleiben unverändert. Zugangsdaten gehören
**nur** in die Umgebungsvariablen, nie unter Verwaltung → Einstellungen.

Ohne TLS von Anfang an verlangt die App STARTTLS; ein Server, der weder
das eine noch das andere kann, wird nicht benutzt (kein Passwort im
Klartext).

### Typische Anbieter-Hinweise

- **Eigenes Postfach statt privater Adresse:** Am besten eine eigene
  Adresse nur für den Stammbaum anlegen.
- **App-Passwort:** Viele Anbieter verlangen bei aktivierter
  Zwei-Faktor-Anmeldung ein eigenes App-Passwort für SMTP (in den
  Sicherheitseinstellungen des Kontos). Das normale Passwort wird dann
  abgelehnt.
- **SMTP freischalten:** Manche Anbieter schalten SMTP/„externe
  Programme“ erst in den Postfach-Einstellungen frei.
- **Absender:** `SMTP_FROM` muss die Adresse des Postfachs (oder ein dort
  eingerichteter Alias) sein, sonst lehnt der Server ab oder die Mail landet
  im Spam.
- **Ausgehende Verbindung:** Die NAS braucht ausgehenden Zugang zu Port 587
  bzw. 465. Port 25 sperren viele Internetanbieter.

## Ausprobieren

1. Unter Verwaltung → Benutzer eine eigene Zweitadresse einladen.
2. In einem privaten Browserfenster die Anmeldeseite öffnen, die Adresse
   eingeben, „Link zusenden“.
3. Mail öffnen (auch im Spam-Ordner nachsehen), Link öffnen, „Jetzt
   anmelden“.

## Fehlersuche

| Symptom | Ursache und Abhilfe |
|---|---|
| Kein Feld „E-Mail-Adresse“ auf der Anmeldeseite | Eine der vier Pflichtangaben fehlt, `SMTP_PORT` ist keine Zahl oder `PUBLIC_URL` ist ungültig. Variablen prüfen, Stack neu bereitstellen. |
| Meldung erscheint, aber keine Mail kommt | Container-Protokoll ansehen: `[email-login] Versand fehlgeschlagen: …` nennt den Grund (Anmeldung abgelehnt → App-Passwort; Zeitüberschreitung → Port/Firewall; Zertifikat → `SMTP_HOST` muss zum Zertifikat passen). Steht nichts im Protokoll: Adresse nicht eingeladen, gesperrt, anders geschrieben — oder gedrosselt (`[email-login] Anforderung gedrosselt.`), dann 15 Minuten warten. |
| Mail landet im Spam | `SMTP_FROM` an das Postfach angleichen; beim eigenen Mail-Anbieter SPF/DKIM für die Domain einrichten. |
| „Dieser Anmeldelink gilt nicht mehr“ | Link älter als 15 Minuten, schon benutzt oder durch einen neueren ersetzt. „Neuen Link anfordern“. |
| Link führt auf eine falsche Adresse | `PUBLIC_URL` stimmt nicht mit der Adresse im Browser überein. |
| Nach „Jetzt anmelden“ zurück auf der Anmeldeseite mit „nicht freigeschaltet“ | Benutzer wurde inzwischen gesperrt oder gelöscht. |

## Entwicklung und Tests

In der Mock-Umgebung (`npm run dev:mock`, E2E-Tests) geht nie eine echte
Mail hinaus: `scripts/mock.mjs` setzt `MAIL_TEST_OUTBOX=mock-only` und leert
die SMTP-Angaben; die Mails liegen als JSON-Dateien unter
`<Mock-Medienordner>/mail-outbox/`. Dieser Test-Briefkasten wirkt nur
zusammen mit einer Mock-Datenbank und einem Mock-Medienordner — im
Produktivstack nie. Tests: [tests.md](../entwicklung/tests.md).
