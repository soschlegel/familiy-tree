# Berechtigungen

Rechte hängen an **Familien**, nicht an einer pauschalen Rolle.

- Eine Person gehört zu beliebig vielen Familien. Wer einheiratet, gehört zu
  beiden — genau so verbinden sich Familien in der Wirklichkeit.
- Ein Benutzer bekommt je Familie **lesen** oder **bearbeiten**, oder gar
  keinen Zugriff. Ohne Familienzuordnung sieht er nichts.
- Sichtbar ist eine Person, sobald der Benutzer *eine* ihrer Familien hat.
  Bearbeiten darf er, wenn er in *einer* davon Bearbeitungsrechte hat.
- Personen **ohne** Familie sieht ausschließlich der Administrator. Das ist die
  sichere Grundeinstellung: eine vergessene Zuordnung gibt nichts frei.
- Der Administrator sieht und ändert alles und vergibt die Zugriffe.

Im Stammbaum erscheinen gesperrte Personen als anonymer Platzhalter statt zu
verschwinden. So bleibt der Baum zusammenhängend und Kinder stehen nicht ohne
sichtbare Eltern da, während Name, Daten und Bilder verborgen bleiben.

Ein Zugriff auf eine gesperrte Person beantwortet die API mit **404, nicht 403**
— ein 403 würde bestätigen, dass es diese Person gibt.

Verbindlich ist [lib/scope.ts](../../lib/scope.ts); [lib/authz.ts](../../lib/authz.ts)
regelt nur noch die globalen Verwaltungsrechte (Benutzer, Familien, Import).
Auch der Export ist auf den sichtbaren Bestand beschränkt — sonst wäre er ein
Weg, das ganze Konzept mit einem Klick zu umgehen.

## Was wer darf

Die ersten beiden Spalten gelten **je Familie** — ein Benutzer kann in einer
Familie bearbeiten und in einer anderen nur lesen.

| | lesen | bearbeiten | Administrator |
|---|---|---|---|
| Personen und Bilder dieser Familie ansehen | ✓ | ✓ | ✓ |
| Personen/Beziehungen anlegen und ändern | | ✓ | ✓ |
| Bilder hochladen, Primärbild festlegen | | ✓ | ✓ |
| Personen und Bilder löschen | | ✓ | ✓ |
| Familien anlegen, Zugriffe vergeben | | | ✓ |
| Benutzer einladen, sperren und löschen | | | ✓ |
| Daten importieren | | | ✓ |
| Personen ohne Familienzuordnung sehen | | | ✓ |
| KI-Zugang vergeben, fremde KI-Schlüssel widerrufen | | | ✓ |
| Einstellungen der Installation pflegen | | | ✓ |
| Zeitgeschichte pflegen (eigene Ereignisse, mitgelieferte ausblenden, Einträge der KI bestätigen) | | | ✓ |

Der **KI-Zugang** liegt quer dazu: Der Administrator gibt ihn je Benutzer
(kein Zugang, lesen, lesen und schreiben), auch sich selbst ausdrücklich. Mit
eigenen Schlüsseln (Seite *KI-Zugang*) darf ein KI-Assistent dann höchstens,
was der Benutzer laut Tabelle ohnehin darf — „lesen“ verbietet ihm auch dort
das Ändern, wo der Benutzer bearbeiten darf. Einzelheiten:
[KI-Zugang](../betrieb/ki-zugang.md).

Die Prüfung läuft serverseitig in [lib/api.ts](../../lib/api.ts) (Route-Handler) und
[lib/session.ts](../../lib/session.ts) (Seiten). Die UI blendet zusätzlich aus, das
ist reiner Komfort.

## Benutzerverwaltung

Auf `/admin/users` lädt der Administrator Benutzer per E-Mail ein (das ist
zugleich die Freigabeliste für die Anmeldung), ändert Rolle und
Familienrechte, sperrt und **löscht** sie. Gelöscht wird nur der Zugang
selbst (samt Anmeldekonten, Sitzungen und KI-Schlüsseln); was der Benutzer
angelegt hat, bleibt; seine Einträge im Änderungsprotokoll bleiben ebenfalls,
verlieren aber den Bezug zu ihm. Den eigenen Zugang kann niemand löschen,
herabstufen oder sperren, ebenso wenig den letzten aktiven Administrator.
Unter der E-Mail-Adresse ordnet er jedem Benutzer seine eigene Person zu
(„Person: zuordnen“, siehe [Bezugsperson](bezugsperson.md)).

Angemeldet wird mit GitHub, Google oder — falls eingerichtet — per
**E-Mail-Link** ([betrieb/email-anmeldung.md](../betrieb/email-anmeldung.md)).
Für alle Wege gilt dieselbe Freigabeliste; beim Einladen selbst geht keine
Mail hinaus.

Eine **vertippte E-Mail-Adresse** lässt sich korrigieren, solange sich der
Benutzer noch nie angemeldet hat. Danach hängt an der Adresse ein
verknüpftes Google-/GitHub-Konto — eine Änderung würde die Anmeldung still
auf eine andere Person umlenken; dann den Benutzer löschen und neu
einladen.

## Einstellungen

Auf `/admin/settings` (Menü *Verwaltung → Einstellungen*, nur
Administratoren) pflegt der Administrator Einstellungen der Installation als
Schlüssel → Wert, statt sie im Stack zu setzen. Die Schlüssel kommen aus
einem festen Verzeichnis im Code (`lib/settings/registry.ts`, Auswahl per
Drop-down); heute gibt es einen: die *Adresse des KI-Connectors* (Rückfall
`MCP_CONNECTOR_URL`). Ein Wert aus der App hat Vorrang; ohne ihn gilt die
Umgebungsvariable, nach dem Entfernen ebenso. Die Seite zeigt je Schlüssel
den wirksamen Wert und seine Herkunft. Jede Änderung steht im
Änderungsprotokoll. **Nur für Werte, die keine Geheimnisse sind** —
Zugangsdaten bleiben im Stack.

## Zeitgeschichte

Auf `/admin/history` (Menü *Verwaltung → Zeitgeschichte*, Recht
`history:manage`, nur Administratoren) pflegt der Administrator die
allgemeinen Ereignisse, die die App im Zeitstrahl, in der Zeitreise der
Karte und im Lebenslauf zeigt: eigene anlegen, ändern, löschen und
mitgelieferte ausblenden. Sehen dürfen die Ereignisse alle angemeldeten
Benutzer gleich — sie enthalten keine Personendaten und dürfen keine
Personen des Stammbaums nennen. Jede Änderung steht im Änderungsprotokoll
(nur für Administratoren sichtbar).

Über den **KI-Zugang** darf jeder Schlüssel mit Leserecht die Zeitgeschichte
lesen (`list_history_events`). Pflegen (anlegen, ändern, löschen,
mitgelieferte ausblenden) darf die KI nur mit einem Schlüssel der Stufe
„lesen und schreiben“ **und** wenn der Benutzer dahinter Administrator ist;
sonst lehnt der Server ab. Einträge der KI sind sofort für alle sichtbar,
tragen aber den Vermerk „von KI, ungeprüft“, bis ein Administrator sie in
der App bestätigt — bestätigen kann die KI selbst nicht. Einzelheiten:
[MCP-Server](../komponenten/mcp.md).