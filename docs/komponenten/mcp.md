# MCP-Server (KI-Zugang)

Der MCP-Server lässt KI-Assistenten (Claude Code, Claude Desktop, claude.ai über
ein Gateway) mit den Stammbaumdaten arbeiten: suchen, abfragen, Lücken und
Widersprüche finden und — mit Schreibstufe — Ergebnisse samt Belegen
eintragen. Der Server handelt immer **als ein Benutzer der App**: Alle
Werkzeuge laufen über die Dienstschicht (`lib/services`) mit dessen `Scope`;
Sichtbarkeit nach Familien, Platzhalter für verborgene Personen,
Rechteprüfung, Validierung und Audit gelten wie in der Weboberfläche. Einen
Weg an der Dienstschicht vorbei zur Datenbank gibt es nicht.

Bedienung und Einrichtung für Anwender: [docs/betrieb/ki-zugang.md](../betrieb/ki-zugang.md).
Schlüsselverwaltung in der Oberfläche: Seite `/ai-access` und die Routen
`/api/ai-tokens…`, `/api/users/[id]/ai-access` (siehe
[seiten-und-api.md](seiten-und-api.md)).

## Aufbau

| Datei | Aufgabe |
|---|---|
| `mcp/register.ts` | Gemeinsamer Aufbau: `createMcpServer(ctx)` erzeugt einen `McpServer` mit Name `familytree`, Titel „Stammbaum“, Version `0.1.0` und dem Server-Hinweis (`INSTRUCTIONS`). Registriert immer die Lesewerkzeuge, Prompts und die Ressource, die Schreibwerkzeuge nur bei `ctx.allowWrite`. Ohne Seiteneffekte beim Import. |
| `mcp/tools.ts` | Alle Werkzeuge (`registerReadTools`, `registerWriteTools`), Ausgabeaufbereitung, `personResource` für die Ressource. |
| `mcp/prompts.ts` | Drei Prompt-Vorlagen und die Ressource `familytree://person/{id}`. |
| `mcp/person-redirects.ts` | Alte Personen-Kennungen: `resolvePersonArgs` löst sie in den Eingaben jedes Werkzeugs auf (`person_id`, `other_person_id`, `from_person_id`, `to_person_id`, `person_ids`); `withResolvedFrom` ergänzt das Ausgabeschema dieser Werkzeuge um `resolvedFrom`. |
| `mcp/format.ts` | Reine Formatierungsfunktionen: einheitliche Personenreferenz (`ref`), Lebensspanne, Datumsfelder in echter Genauigkeit (`dateFields`, `dateToken`), `appendResearchNote`. |
| `mcp/http.ts` | Der reguläre Zugang: `handleMcpPost` für Streamable HTTP, Schlüsselprüfung, Origin-Prüfung, Sperre nach Fehlversuchen, Größenlimits. Bewusst ohne `next/*`, damit Tests den Handler direkt aufrufen können. |
| `app/api/mcp/route.ts` | Route-Handler `/api/mcp`: `POST` → `handleMcpPost`; `GET`, `DELETE`, `PUT`, `PATCH`, `OPTIONS` → 405. Laufzeit Node.js, immer dynamisch, kein Caching. |
| `mcp/server.ts` | stdio-Server **nur für Entwicklung und automatische Tests** (siehe unten). |
| `mcp/bootstrap.ts` | Nur für den stdio-Modus, wird als erstes Modul geladen: leitet alles, was auf stdout schreiben würde (`console.log` usw.), nach stderr um und gibt dem Transport einen eigenen Zugang zum echten stdout (`protocolOut`); lädt die `.env` aus dem Projektverzeichnis, ohne bereits gesetzte Variablen zu überschreiben. |

### Kontext der Werkzeuge (`ToolContext`)

- `label` — wer zugreift, nur für Meldungen (E-Mail im stdio-Modus,
  öffentlicher Schlüsselanfang `ftk_<12 Zeichen>` über HTTP).
- `allowWrite` — ob die Schreibwerkzeuge registriert sind; steuert auch den
  Schreibhinweis in den Prompts.
- `authorize(need)` — Wächter je Aufruf (`authorizeAiCall` in
  `lib/services/ai-access.ts`): prüft den Zugang bei **jedem**
  Werkzeugaufruf neu und verlangt die Stufe `READ` bzw. `WRITE`. Widerruf,
  Ablauf, Sperre sowie Rollen- und KI-Rechteänderungen wirken dadurch beim
  nächsten Aufruf, ohne Neustart. Liefert den `Scope` samt Kanal (`via`)
  für das Audit.
- `mediaFetch` — nur für Tests: ersetzt Namensauflösung/Transport für
  `add_media` mit `url`.

### Gemeinsames Verhalten aller Werkzeuge

- Ergebnis ist kompaktes JSON, einmal als Text und zusätzlich als
  `structuredContent` passend zum Ausgabeschema.
- Fehler kommen als Ergebnis mit `isError`: verweigerter Zugang als
  „Zugriff verweigert (…): Meldung [Grund]“, `ServiceError` als Meldung mit
  betroffenen Feldern und Code (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`,
  `VALIDATION`), alles andere als „Interner Fehler (Kennung …)“ — ohne
  die eigentliche Meldung (Datenbankfehler samt Abfrage, Pfade); die
  Einzelheiten stehen unter derselben Kennung im Server-Log. Die
  Personen-Ressource verfährt ebenso.
- Personen erscheinen überall gleich als `{ id, name, lifespan }`;
  verborgene als `{ id, name: "Nicht freigegeben", restricted: true }`.
  Unsichtbare Personen/Quellen gelten als nicht gefunden („… (oder für
  diesen Benutzer nicht sichtbar)“).
- Daten stehen als ISO-Datum in ihrer tatsächlichen Genauigkeit (`1850`,
  `1850-03`, `1850-03-12`), mit `…Precision`, `…Qualifier`, bei Bereichen
  `…To`, und `…Text` (deutsche Form oder wörtlicher Originalwortlaut).
  In kompakten Listen bekommen nur ungenaue Daten die Zusatzfelder.
  Lebensspanne: „1850 – um 1920“, „?“ für unbekannt.
- Eingabedaten (`dateInput`, höchstens 60 Zeichen) verstehen dieselben
  Formen wie die Oberfläche: ISO, deutsche Schreibweise, Vorsätze
  „um/ca./ABT“, „vor/BEF“, „nach/AFT“, „geschätzt/EST“, „errechnet/CAL“,
  Bereiche „zwischen … und …“, „von … bis …“, „ab …“, „bis …“. Geprüft
  wird in der Dienstschicht.
- Lesewerkzeuge tragen die Hinweise „nur lesend, nicht zerstörend,
  idempotent, keine Außenwelt“.

## Anmeldung und Stufen

### HTTP-Endpunkt `/api/mcp` (regulärer Zugang)

Ablauf je Anfrage (`handleMcpPost`): Methode → Origin → Sperre nach
Fehlversuchen → Schlüssel → Anfragegrenze je Schlüssel → MCP.

- **Zustandslos:** Für jede `POST`-Anfrage entstehen ein neuer Server und
  ein neuer Transport (Streamable HTTP ohne Sitzungskennung, Antworten als
  JSON statt SSE). Nach der Antwort wird der Server geschlossen. Kein
  SSE-Strom, keine Sitzungen; alle anderen Methoden → 405 mit `Allow: POST`.
- **Anmeldung nur per `Authorization: Bearer <Schlüssel>`.** Das
  Sitzungs-Cookie der Web-App wird nicht gelesen (damit auch kein CSRF),
  Schlüssel in der Adresse werden nicht angenommen. Schlüssel beginnen mit
  `ftk_`; gespeichert ist nur ein Hash (`lib/ai-tokens.ts`,
  `verifyApiToken`).
- **Origin:** Anfragen ohne `Origin`-Kopfzeile (Claude Code, `mcp-remote`)
  sind erlaubt. Mit `Origin` nur die eigene Adresse (`AUTH_URL`, im Stack
  aus `PUBLIC_URL` gesetzt) oder ein Eintrag aus `MCP_ALLOWED_ORIGINS`
  (kommagetrennt); sonst 403. Keine CORS-Kopfzeilen.
- **Sperre nach Fehlversuchen:** 20 fehlgeschlagene Anmeldungen (401) je
  Absender in 10 Minuten → 429 mit `Retry-After` bis Fensterende, auch mit
  richtigem Schlüssel. Absender ist der **letzte** Eintrag in
  `X-Forwarded-For` (vom eigenen Proxy angehängt). Die Tabelle liegt im
  Speicher des Prozesses (höchstens 10 000 Absender), ein Neustart leert
  sie.
- **Anfragegrenze je Schlüssel:** nach erfolgreicher Anmeldung höchstens
  300 Anfragen je Minute und Schlüssel (`checkMcpRate` in
  `lib/rate-limit.ts`), sonst 429 mit `Retry-After`. Mit `RATE_LIMIT=off`
  abgeschaltet (nur E2E-Build).
- **Stufe:** Die wirksame Stufe ist die niedrigere aus Schlüsselstufe und
  KI-Recht des Benutzers (`User.aiAccess`: kein Zugang / lesen / lesen und
  schreiben). Bei wirksamer Stufe `READ` werden die Schreibwerkzeuge gar
  nicht registriert (`tools/list` zeigt sie nicht); zusätzlich verlangt
  jedes Schreibwerkzeug bei jedem Aufruf `WRITE`
  (`INSUFFICIENT_LEVEL` sonst). Die Administratorrolle schließt das
  KI-Recht nicht ein. Die Familienrechte gelten zusätzlich — eine
  Schreibstufe für einen Betrachter erlaubt trotzdem keine Änderung.
- **Größenlimits:** Anfragekörper höchstens 1 MiB (`MCP_MAX_BODY_BYTES`);
  für Schlüssel mit wirksamer Schreibstufe `MAX_UPLOAD_BYTES` × 4/3 + 1 MiB
  (`mcpWriteBodyLimit`, Standard-Upload 15 MiB), damit ein Bild als base64
  passt. Das größere Limit gilt erst **nach** der Schlüsselprüfung. Die
  Prüfung selbst übernimmt der Transport des SDK.
- **Logs** nennen höchstens den öffentlichen Schlüsselanfang, nie das
  Geheimnis. Antworten tragen `Cache-Control: no-store` und
  `X-Content-Type-Options: nosniff`.

| Status | Bedeutung |
|---|---|
| 200 | in Ordnung (Fehler einzelner Werkzeuge stehen im Ergebnis mit `isError`) |
| 401 | Schlüssel fehlt, Format falsch, unbekannt, widerrufen, abgelaufen, Benutzer unbekannt oder gesperrt — einheitlich ohne Grund, mit `WWW-Authenticate: Bearer realm="familytree"` (bei gesendetem Schlüssel zusätzlich `error="invalid_token"`) |
| 403 | Schlüssel gültig, aber kein KI-Recht (`NO_PERMISSION`, `WWW-Authenticate` mit `insufficient_scope`), oder fremder `Origin` |
| 405 | andere Methode als `POST` |
| 413 | Anfragekörper zu groß (vom Transport des SDK): über 1 MiB, mit Schlüssel der Schreibstufe über `mcpWriteBodyLimit()` (`MAX_UPLOAD_BYTES` × 4/3 + 1 MiB) |
| 429 | Sperre nach Fehlversuchen oder Anfragegrenze des Schlüssels, mit `Retry-After` |
| 500 | unerwarteter Fehler im Transport |
| 503 | Schlüsselprüfung fehlgeschlagen (z.B. Datenbank nicht erreichbar) |

Fehlerantworten haben die JSON-RPC-Form `{ jsonrpc, error: { code: -32000, message }, id: null }`.

### stdio-Server (nur Entwicklung und Tests)

Start mit `npm run -s mcp:stdio` (= `node scripts/mock.mjs mcp`, setzt die
Mock-Datenbank und startet `mcp/server.ts` über `tsx`).

- Startet **nur** gegen Datenbanken, deren Name auf `_mock` oder `_test`
  endet; sonst Abbruch mit Exit-Code 2, bevor eine Verbindung entsteht.
- Kein Schlüssel: Der Benutzer kommt aus `MCP_USER_EMAIL` (Pflicht).
  `MCP_ALLOW_WRITE=true` schaltet Schreibwerkzeuge frei — aber nur, wenn
  der Benutzer das KI-Recht „lesen und schreiben“ hat (sonst Hinweis auf
  stderr, Werkzeuge bleiben aus). Ohne KI-Recht, bei unbekanntem oder
  gesperrtem Benutzer oder nicht erreichbarer Datenbank bricht der Start
  ab (Exit-Code 1).
- Auch hier prüft der Wächter jeden Aufruf neu.
- stdout gehört allein dem Protokoll (`mcp/bootstrap.ts`); die
  Bereitmeldung mit Benutzer, Rolle/Familien, Datenbank, KI-Recht und
  Schreibstatus geht nach stderr. Beendet sich sauber bei Ende von stdin
  oder `SIGINT`/`SIGTERM`.

Für die Arbeit mit Claude Code gegen die Mock-Daten trägt `.mcp.json` den
Server `familytree-mock` (HTTP auf den Mock-Server, Schlüssel aus der
Umgebungsvariable `FAMILYTREE_MCP_KEY`) ein; `npm run -s mcp:key [name]`
gibt einen der festen Testschlüssel der Mock-Daten aus (Standard
`editor-read`).

## Server-Hinweis (Instructions) in Worten

Der Hinweis an das Modell (englisch, `INSTRUCTIONS` in `mcp/register.ts`)
sagt sinngemäß:

- Es ist eine Stammbaumdatenbank deutscher Familiengeschichte; Daten,
  Namen und Bezeichnungen sind deutsch.
- Einstieg über `search_persons` (Personen-IDs), Überblick mit
  `get_statistics`; `get_person` liefert den vollen Datensatz,
  `get_kinship` die deutsche Verwandtschaftsbezeichnung. Für
  Rechercheansätze `find_data_gaps`, `check_consistency`,
  `find_possible_duplicates`, `get_timeline`.
- Als „Nicht freigegeben“ markierte Personen existieren, sind aber
  verborgen — nicht über sie spekulieren.
- Daten stehen in echter Genauigkeit mit deutschem Vorsatz für ungenaue
  Angaben und Bereichen; nie ein Jahr zu einem vollen Datum auffüllen.
- Wo Fakten liegen: Geburt und Tod an der Person, Heirat und Scheidung an
  der Partnerbeziehung (`PARTNER_OF`, Ehestand auch „unbekannt“); alles
  andere (Taufe, Beruf, Wohnort, Beerdigung, Verlobung, Aufgebot …) sind
  Lebensereignisse; weitere Namen sind `otherNames`; eine widersprechende
  zweite Geburts-/Sterbe-/Heirats-/Scheidungsangabe ist ein Ereignis mit
  `alternative=true`, nie die Hauptangabe.
- Quellen: Belege von Online-Stammbäumen anderer (`ONLINE_TREE`,
  `independent: false`) sind nur Hinweise, keine unabhängigen Belege.
  `find_data_gaps` mit `unsourced` findet unbelegte Angaben.
- Bilder: an den Eintrag hängen, den sie belegen — bevorzugt an den Beleg
  (`citation_ids`). Drei Wege (Adresse, base64 nur bei echtem
  Dateizugriff, vorhandenes Bild verknüpfen). Ein nur im Chat gezeigtes Bild
  ist nicht übertragbar — dann um einen Link oder das Hochladen in der App
  bitten. Deutsche Bildunterschrift; nie raten, was ein ungesehenes Bild
  zeigt.
- Der Server handelt als ein Benutzer; jede Änderung wird protokolliert.
  Nichts erfinden. Belege als Zitat (`search_sources`/`create_source` +
  `cite_source`), Ereignisse mit `add_event` statt in Notizen, weitere
  Namen mit `add_name_variant`, Heiratsorte mit `update_relationship`.
  Notizen (`append_note`) nur für Überlegungen und offene Fragen.
- Änderungsgeschichte: vor größeren Aufgaben `begin_change_set` mit
  deutschem Titel und die `change_set_id` an jedes Schreibwerkzeug geben;
  ohne Kennung bündeln Schreibvorgänge desselben Schlüssels innerhalb von
  30 Minuten automatisch. Titel sehen auch Benutzer, die nicht jede
  beteiligte Person sehen — deshalb nie Personennamen in den Titel.
- **Orte (eigener Absatz):** Ortsfelder sind Freitext und bleiben genau so,
  wie sie geschrieben sind — nie einen Ortstext „verbessern“. Koordinaten
  kommen aus einer eigenen Zuordnung je Text. `suggest_place` zeigt
  Kandidaten aus dem Verzeichnis und eigene Orte; alte und deutsche Namen
  werden verstanden („Breslau“ = Wrocław, „Danzig“ = Gdańsk, „Königsberg,
  Ostpreußen“ = Kaliningrad; `nameKind` „historic“). Administratoren
  arbeiten offene Texte ab: `list_places` (offen) → `suggest_place` →
  `assign_place` (Stapel bis 50, kurze deutsche Begründung, `uncertain`
  bei nur Wahrscheinlichem, eigene Orte für Weiler, Höfe, Wüstungen).
  KI-Zuordnungen heißen „von KI“, bis ein Admin bestätigt; von Hand
  Bestätigtes wird nie geändert. Ablauf im Prompt `orte_zuordnen`; keine
  Personennamen in Pakettiteln.
- **Dubletten (eigener Absatz):** Es gibt **kein** `merge_persons` und kein
  anderes Werkzeug, das Personen zusammenführt, löscht oder ausblendet;
  zusammenführen tut nur ein Mensch in der Web-App — eine falsche
  Zusammenführung ist der schlimmste Fehler. Aufgabe der KI: vorprüfen und
  vorschlagen. `list_duplicate_candidates` → beide Datensätze mit
  `get_person` lesen → `preview_person_merge` (Trockenlauf) →
  `review_duplicate` speichert nur die Einschätzung. Sie ändert nie die
  Klasse, wählt nichts vor, entfernt nichts aus der Liste. Bei dünner oder
  widersprüchlicher Lage `DISPUTED`, nie raten; das fehlende Werkzeug nicht
  umgehen (keine Daten umkopieren oder Beziehungen löschen, um ein
  Zusammenführen nachzuahmen). Ablauf im Prompt `review_duplicates`.
- **Zeitgeschichte (eigener Absatz):** allgemeine Geschichte als Hintergrund
  in Zeitstrahl, Zeitreise und Lebenslauf, nie eine Aussage über eine
  Person. Vorher `list_history_events`; nur gesicherte Ereignisse mit
  nachprüfbarer Jahreszahl und Quelle in `reason` eintragen
  (`add_history_event`, nur Administratoren mit Schreibstufe); im Zweifel
  nicht eintragen; regionale Ereignisse mit `region`; nie Personennamen in
  Titel, Beschreibung oder Region. Einträge sind sofort sichtbar, aber „von
  KI, ungeprüft“, bis ein Administrator in der App bestätigt; die KI kann
  nicht bestätigen, eine Änderung macht den Eintrag wieder unbestätigt.

## Lesewerkzeuge (immer vorhanden, Stufe `READ`)

| Werkzeug | Zweck | Parameter | Ergebnis |
|---|---|---|---|
| `search_persons` | Personen suchen, alle Filter mit UND verknüpft (`searchPersons`) | `query` (jedes Wort muss in Vor-, Familien-, Geburts- oder Rufname oder einem weiteren Namen vorkommen), `family_id`, `born_from`/`born_to` (Geburtsjahr; ungenaue Daten zählen mit ihrem Ankerjahr; ohne Geburtsdatum ausgeschlossen), `place` (Geburts-, Sterbe-, Ereignis-, Heirats-/Scheidungsort), `gender`, `deceased`, `sort` (Name, Geburtsdatum auf-/absteigend, zuletzt geändert), `limit` (Standard 20, höchstens 100), `offset` | `total`, `offset`, `hasMore`, `persons` (Referenz plus Geschlecht, Geburts-/Sterbeort, Familien-IDs, Zahl der Beziehungen, ob Notizen vorhanden) |
| `get_person` | Voller Datensatz einer Person (`getPersonDetail`) | `person_id` | Personenfelder samt Notizen und Datumsangaben, `canEdit`, `families`, `parents`/`partners`/`children` (mit `relationshipId`, Art, Daten, Heirats-/Scheidungsort, Notizen, Bildzahl, Ereignissen der Beziehung), `siblings` (voll/halb), `media` (eigene Bilder, Porträt zuerst), `citations` (Quelle, Angabe, Fundstelle, Verlässlichkeit, `independent: false` bei abgeleiteten Quellen, Bezug zu Beziehung oder Ereignis, Bilder am Beleg und geerbte Bilder der Quelle), `events` und `otherNames` nur, wenn vorhanden; `places` (Freitext → zugeordneter Ort mit `placeId`, Anzeigename, Koordinaten; der Freitext in den Feldern bleibt); `origin` nur, wenn der Benutzer die Person bearbeiten darf (`getPersonOrigin`): `manual` (von Hand erfasst), `imports` (je Import `letter`, `name` wie in der App — ohne eigenen Namen „Import vom …“, nur für Administratoren Datei und Datum —, erster/letzter Import, `records`, `viaMerge`; nie die Quell-Baum-Kennung), `merged` (Zahl der Einträge, erstes/letztes Zusammenführen). Keine Herkunft je Feld; Chips je Eintrag gibt es nur in der App |
| `get_ancestors` | Vorfahren nach Generationen (`getAncestors`) | `person_id`, `generations` (Standard 4, höchstens 12), `limit` (Standard 200, höchstens 500) | `root`, `generationsRequested`, `total`, `truncated`, `generations` mit deutscher Bezeichnung („Eltern“, „Großeltern“, „Urgroßeltern“ …, ab der 7. „n. Generation“); je Eintrag `viaPersonId` und `subtype` nur bei nicht leiblicher Verbindung |
| `get_descendants` | Nachfahren nach Generationen (`getDescendants`) | wie `get_ancestors` | wie `get_ancestors` („Kinder“, „Enkel“, „Urenkel“ …) |
| `get_kinship` | Verwandtschaft von `other_person_id` aus Sicht von `person_id` (`getKinship`) | `person_id`, `other_person_id` | `from`, `to`, `summary` (bevorzugt Blutsverwandtschaft; ohne Weg „keine Verbindung im Stammbaum gefunden“), `blood` (Begriff, Generationen hinauf/hinab, halb, adoptiv, Seite, gemeinsame Vorfahren) und `path` (kürzester Weg über Eltern-/Partnerkanten mit Begriff und Kette „Mutter → Bruder → Ehefrau“). Wege durch Platzhalter sind hier zugelassen (die Oberfläche — Baumkarten, Personenseite und die Seite „Wie sind wir verwandt?“ — rechnet strenger nur über sichtbare Personen und kann deshalb „keine Verwandtschaft über freigegebene Personen bekannt“ sagen, wo das Werkzeug eine nennt; [bezugsperson.md](../fachlich/bezugsperson.md)) |
| `list_families` | Sichtbare Familien mit Personenzahl und eigener Rolle (`listFamilies`) | keine | `families` |
| `get_statistics` | Überblick über den sichtbaren Baum (`getStatistics`) | keine | Personen (lebend/verstorben, nach Geschlecht), Beziehungen nach Art, Personen je Familie, Bildzahl, fehlende Angaben, früheste/späteste Geburtsjahre |
| `find_data_gaps` | Fehlende oder unplausible Angaben (`findDataGaps`) | `kinds` (Auswahl aus fehlendem Geburtsdatum/-ort, Eltern, Geschlecht, vermutlich verstorben ohne Sterbedatum, Sterbeort ohne Sterbedatum, unplausibles Elternalter, isoliert, ohne Familie — nur Admins sinnvoll —, unbelegt; sowie Ehe ohne Ort und Partnerschaft mit unbekanntem Ehestand), `limit` (Personen je Art, Standard 15, höchstens 200) | `counts` (immer alle Arten), `items` je angeforderter Art, `relationshipGaps` mit Paaren samt `relationshipId` |
| `find_possible_duplicates` | Vermutlich doppelt erfasste Personen (`findPossibleDuplicates`, bis 500 Kandidaten, dann gefiltert) | `min_score` (Standard 0,5), `max_year_diff` (Standard 2, höchstens 10), `limit` (Standard 20) | `total`, `candidates` mit beiden Personen (mit Geburtsort), Wert, Sicherheit, deutschen Gründen und Widersprüchen, `crossTree` bei Personen aus verschiedenen Importen. Zusammenführen geht nur in der Web-App |
| `check_consistency` | Widersprüche zwischen Daten (`findInconsistencies`) | `kinds` (Prüfarten aus `lib/consistency.ts`), `person_id`, `limit` (Standard 30) | `total`, `counts`, `items` (Art, Schwere, Meldung, Personen, Beziehungs-IDs, ggf. `eventIds`); Fehler vor Warnungen |
| `get_timeline` | Zeitleiste **einer** Person oder **einer** Familie (`getPersonTimeline` / `getFamilyTimeline`) | genau eines von `person_id`/`family_id` (sonst Validierungsfehler), `from_year`/`to_year` (nach Ankerjahr), `limit` (Standard 100), `offset` | `subject`, `total`, `hasMore`, `events` (Datum, Art, Bezeichnung, Personen, Ort, Rolle, Alter ggf. ungefähr), bei Personen `missing` (fehlende Daten) |
| `list_events` | Alle Lebensereignisse einer Person oder einer Beziehung mit allen Feldern (`listPersonEvents` / `listRelationshipEvents`) | genau eines von `person_id`/`relationship_id` | `events` chronologisch, undatierte zuletzt, mit `sortOrder` und `canEdit`; dazu `places` wie bei `get_person` |
| `search_sources` | Quellen suchen (`listSources`) | `query` (Titel, Verfasser, Archiv, Signatur), `kind`, `limit` (Standard 20, höchstens 100), `offset` | `total`, `offset`, `hasMore`, `sources` mit Zahl der sichtbaren Belege |
| `suggest_place` | Kandidaten für einen Ortstext (`suggestPlaces`) — für jeden Lesezugang, liest nur das mitgelieferte Verzeichnis und eigene Orte | `text` (wie in den Daten) | `text`, `recommended` (Wahl der automatischen Zuordnung bzw. passender eigener Ort), `ambiguous`, `candidates` je mit `source` (`directory`/`own` = eigener Ort), `gazetteerId`, `label` (heutiger Name, alter Name in Klammern), `kind` (Ort, Region, historische Landschaft, Land, eigener Ort), Genauigkeit, Koordinaten, Land, Einwohnerzahl, `matchedName` und `nameKind` (`historic` = früherer/deutscher Name, `alternate`, `official`), `distanceKm` zur Empfehlung; ohne Treffer Präfixtreffer. Nur für Admins `current` (vorhandene Zuordnung mit Status) |
| `get_place` | Ein Ort wie auf seiner Seite (`getPlacePage`) — gleiche Sichtbarkeit | genau eines von `place_id` (aus `places` von `get_person`/`list_events`) oder `text`; `page` | `placeId`, Anzeigename, Name, Region, Land, Koordinaten, Art, Herkunft, weitere Namen, Freitexte mit Anzahl, `entries` (Person, Art, Jahr, Text), `total`; Begründungen nur für Admins |
| `list_places` | Vorkommende Ortstexte mit Status (`listPlaces`, `placeTextContext`) — **nur Administratoren**, sonst Fehler „Keine Berechtigung …“ | `status` (`open`/`offen`, `auto`/`automatisch`, `ai`/`ki`, `manual`/`von_hand`, `unresolvable`/`nicht_zuordenbar`, `all`/`alle`), `query`, `page` (50 je Seite) | `total`, `page`, `pages`, `counts`, `places` je mit Text, Anzahl, Schreibweisen, Status, `context` (Feldarten birth/death/marriage/divorce/`event:<Art>` mit Anzahl, `fromYear`/`toYear` — ohne Personen), Zuordnung (Quelle, Bezeichnung, Koordinaten, ggf. `uncertain`, `note`), Vorschlag der Automatik |
| `list_duplicate_candidates` | Die Liste „Mögliche Dubletten“ der App zum Vorprüfen (`listDuplicateCandidates`) — dieselbe Reihenfolge (Klasse, dann Punkte), nur Paare, deren beide Personen sichtbar sind, ohne als „kein Duplikat“ markierte | `confidence` (`high`/`medium`/`low`), `review` (`unreviewed` = keine oder veraltete Einschätzung, `reviewed` = irgendeine, oder ein Urteil), `limit` (Standard 20, höchstens 50), `offset` | `total`, `offset`, `hasMore`, `counts` je Klasse, `candidates` je mit beiden Personen, Punkten, Klasse samt deutscher Bezeichnung, Gründen, Widersprüchen, `crossTree`, `canReview` (= beide bearbeitbar) und `review` (Urteil, Begründung, Vorschlag, Zeitpunkt, `stale`) — die Einschätzung nur bei `canReview` |
| `preview_person_merge` | **Trockenlauf**, ändert nichts: genau die Vorschau, die die App vor dem Zusammenführen zeigt (`previewPersonMerge`); Rechte wie in der App (beide bearbeitbar) | `keep_id`, `merge_id` | `dryRun: true`, beide Seiten (Daten, Eltern, Partner, Kinderzahl, Familien, Importe, Zählungen), `fields` (je Feld beide Werte, `differs`, Vorauswahl und Grund), `sentences`, `alternates`, `newNames`, `dropped`, `blockers` (mit `suggestions`), `canMerge`, Hinweis „nichts geändert“ |
| `get_source` | Eine Quelle mit Abschrift/Notizen und allem, wofür sie zitiert wird (`getSource`) | `source_id` | `source`, `canEdit`, `citations` (Angabe, Fundstelle, Ziel Person/Beziehung, Ereignis, Bilder), `hiddenCitationCount` (Belege an verborgenen Personen nur gezählt), `images` (Hauptscan markiert) |
| `list_history_events` | Die Zeitgeschichte der App (`listHistoryEventsForAi`) — für jeden Lesezugang, enthält keine Personendaten | `year` (berührt dieses Jahr) **oder** `from_year`/`to_year` (berührt die Spanne; beides zugleich → Validierungsfehler), `region` (Teiltext, nur eigene Einträge haben eine Region), `source` (`all`/`custom`/`builtin`), `include_hidden` (ausgeblendete mitgelieferte mit `hidden: true`), `only_unconfirmed`, `limit` (Standard 100, höchstens 500), `offset` | `total`, `offset`, `hasMore`, `events` nach der Zeit: `id` (mitgeliefert: Kennung aus `builtin.ts`, eigen: `c:…`), `source`, Titel, `from`/`to`, Art samt deutscher Bezeichnung, Beschreibung, Region; bei eigenen `origin` (`MANUAL`/`AI`/`AI_EDITED`), `unconfirmed: true` bei unbestätigten KI-Einträgen, `confirmedAt`; `aiReason`/`aiSourceUrl` nur für Administratoren |

## Schreibwerkzeuge (nur bei wirksamer Stufe `WRITE`)

Alle Schreibwerkzeuge außer `begin_change_set` laufen über `runWrite`:
Wächter mit Stufe `WRITE`, dann wird das Änderungspaket bestimmt
(`mcpChangeSet` in `lib/change-sets.ts`), **bevor** etwas geändert wird.
Jedes nimmt optional `change_set_id`:

- angegeben: muss ein Paket **dieses Benutzers** aus dem KI-Zugang sein
  und darf höchstens 24 Stunden alt sein; sonst Validierungsfehler am Feld
  `change_set_id` ohne Änderung;
- weggelassen: automatisches Bündeln — Schreibvorgänge desselben
  Schlüssels innerhalb von 30 Minuten landen im jüngsten Paket.

Alle Änderungen landen im Audit-Log mit Kanal `MCP` und Schlüssel-ID.
Rechte: Die Dienstschicht verlangt Bearbeitungsrecht in der Familie der
betroffenen Person bzw. Beziehung. Personen, Quellen und Bilder löschen
kann die KI bewusst nicht — auch nicht als Nebenwirkung: `delete_event`
und `delete_relationship` werden mit `CONFLICT` (`WOULD_DELETE_MEDIA`)
abgelehnt, wenn danach ein Bild an nichts mehr hinge
(`assertNoMediaLossViaAi` in `lib/services/media.ts`); in der App, mit
Rückfrage, geht es weiterhin.

| Werkzeug | Zweck | Parameter (in Worten) | Ergebnis / Besonderheiten |
|---|---|---|---|
| `begin_change_set` | Änderungspaket mit Titel öffnen (`beginMcpChangeSet`) | `title` (3 bis 200 Zeichen, deutsch, ohne Personennamen) | `change_set_id`, `title`, `created_at`. Läuft über `run` mit Stufe `WRITE`, nimmt selbst keine `change_set_id` |
| `create_person` | Person anlegen (`createPerson`) | Vorname (Pflicht), Familien-, Geburtsname, Geschlecht, Geburts-/Sterbedatum und -ort, Todesursache, Rufname, Namensvorsatz/-zusatz, `family_ids`, `note` (wird datierte Recherchenotiz), `source` (Freitext-Quellenhinweis nur in der Notiz) | `person` (Zusammenfassung). Ohne `family_ids` landet die Person bei Nicht-Admins in der ersten bearbeitbaren Familie |
| `update_person` | Felder ergänzen/korrigieren (`updatePerson`) | `person_id`, alle Personenfelder (weggelassen = unverändert, `null` = leeren), `append_note` + `source` | `person`, `changed` (geänderte Felder). Notizen werden nie überschrieben, nur mit „[Datum, KI-Recherche] … (Quelle: …)“ ergänzt. Ohne Änderung Validierungsfehler |
| `create_relationship` | Zwei Personen verknüpfen (`createRelationship`) | `type` (Eltern-Kind: von = Elternteil, zu = Kind; Partner: ungerichtet), `from_person_id`, `to_person_id`, `subtype` (leiblich/adoptiv/stief/pflege bzw. verheiratet/unverheiratet/geschieden/Ehestand unbekannt), Beginn- und Enddatum/-ort (Heirat/Scheidung), `notes` | `relationship`. Zyklen und Doppelte werden abgelehnt, höchstens zwei leibliche Eltern |
| `update_relationship` | Art, Daten, Orte, Notiz korrigieren (`updateRelationship`) | `relationship_id`, dieselben Felder, `null` leert, Notiz ersetzt | `relationship`. Die verknüpften Personen sind nicht änderbar (löschen und neu anlegen) |
| `delete_relationship` | Eine falsche Verknüpfung entfernen (`deleteRelationship`) | `relationship_id` | `deleted`, `relationshipId`; der gelöschte Stand bleibt im Audit-Log |
| `set_person_families` | Familienzuordnung setzen — vollständige Liste, kein Delta (`setPersonFamilies`) | `person_id`, `family_ids` (höchstens 50) | `personId`, `familyIds`. Dem Benutzer unbekannte Familien bleiben erhalten; Nicht-Admins ändern nur Familien, die sie bearbeiten |
| `create_source` | Quelle einmal erfassen (`createSource`) | `title` (Pflicht), `kind` (Standard sonstige), Verfasser, Archiv, Signatur, `url`, `date`, `notes` (Abschrift bis 50 000 Zeichen) | `source`. Bis zum ersten Beleg nur für den Benutzer und Admins sichtbar |
| `cite_source` | Quelle für **eine** Angabe zitieren (`createCitation`) | `source_id`, genau eines von `person_id` (Angabe Name/Geburt/Tod/sonstige), `relationship_id` (Partnerschaft/Abstammung/sonstige) oder `event_id` (Angabe Ereignis, darf fehlen), `fact`, `detail` (Fundstelle), `confidence` (hoch/mittel/niedrig) | `citation`. Ohne `fact` und ohne `event_id` Validierungsfehler; mit `event_id` wird `EVENT` ergänzt |
| `add_event` | Lebensereignis an Person oder Partnerschaft erfassen (`createEvent`) | `person_id` oder `relationship_id`, `type` (Ereignisarten aus `lib/events.ts`), `is_alternative`, Bezeichnung (Pflicht bei eigener Art), Datum, wörtlicher Datumstext, Ort, Adresse, Wert (z.B. Beruf), Ursache, Alter laut Quelle, zuständige Stelle, Notizen | `event`. Geburt/Tod/Heirat/Scheidung nur mit `is_alternative=true` als widersprechende Zweitangabe |
| `update_event` | Ereignis korrigieren (`updateEvent`) | `event_id`, Art, `is_alternative`, Ereignisfelder (`null` leert) | `event`. Datumsänderung ohne neuen Datumstext verwirft den alten Wortlaut; Besitzer (Person/Beziehung) nicht änderbar |
| `delete_event` | Falsch erfasstes Ereignis samt seinen Belegen entfernen (`deleteEvent`) | `event_id` | `deleted`, `eventId`; die Quellen bleiben |
| `add_name_variant` | Weiteren Namen erfassen (`createPersonName`) | `person_id`, `type` (Geburtsname, Ehename, Alias, religiöser Name, Name nach Einwanderung, Schreibvariante, sonstiger mit Bezeichnung), Vor-/Familienname, Vorsatz, Zusatz, Rufname, Bezeichnung, Notiz | `name`. Mindestens Vor-, Familien- oder Rufname; der Hauptname bleibt an der Person |
| `add_media` | Neues Bild speichern und anhängen (`addMedia`) | **genau eines** von `url` oder `data_base64`; `mime_type`, `file_name`, `caption` (wird Alt-Text); Ziele `person_ids`, `relationship_ids`, `event_ids`, `citation_ids`, `source_ids` (mindestens eines, je Liste begrenzt durch `MAX_MEDIA_TARGETS`) | `media`, `linked`. Jedes Ziel muss bearbeitbar sein — geprüft **vor** dem Abruf einer `url`, damit kein Schlüssel den Server Adressen abrufen lässt, ohne ein Ziel ändern zu dürfen. Einziges Werkzeug mit „Außenwelt“-Hinweis |
| `assign_place` | Ortstexten Koordinaten zuordnen (`assignPlacesByAi`) — **nur Administratoren**, wie `/admin/places`; der Freitext bleibt unverändert | entweder eine Zuordnung (`text` + genau eines von `gazetteer_id` \| `latitude`+`longitude`+`label` (eigener Ort, `precision` Standard Ort) \| `unresolvable`) oder `assignments` mit bis zu 50 solchen; je optional `uncertain`, `note` (Begründung, bis 1000 Zeichen); `change_set_id` | `assigned`, `failed`, `results` je mit `ok`, Status, Bezeichnung, Koordinaten, `replaced` (vorherige Herkunft) bzw. `error`. Herkunft `AI` („von KI“), gilt sofort für die Karte; überschreibt automatische und frühere KI-Zuordnungen, nie von Hand bestätigte (Eintrag mit Fehler, die übrigen laufen weiter); Text muss in den Daten vorkommen. Protokoll mit Kanal `MCP` und Schlüssel; Paket „Ort zugeordnet (KI): …“ bzw. „Orte zugeordnet (KI)“ ohne Kennung |
| `review_duplicate` | Einschätzung **eines** Dublettenpaares speichern — sonst nichts (`reviewDuplicate`) | `person_a_id`, `person_b_id`, `verdict` (`MERGE` sicher dieselbe Person, `NOT_DUPLICATE` sicher verschiedene, `DISPUTED` alles andere — im Zweifel immer), `reason` (deutsch, 10 bis 2000 Zeichen, mit den konkreten Belegen und Widersprüchen), `suggested_keep_id` (nur bei `MERGE`, eine der beiden — nur ein Hinweis) | `personAId`, `personBId` (kanonisch), Urteil, Begründung, Vorschlag, `reviewedAt`, `replacedVerdict`, immer `merged: false`. Eine neue Einschätzung ersetzt die alte; ein von einem Menschen als „kein Duplikat“ markiertes Paar wird abgewiesen. Bearbeitungsrecht an beiden Personen nötig. Paket „Mögliche Dubletten vorgeprüft (KI)“ ohne Kennung |
| `link_media` | Vorhandenes Bild an weitere Einträge hängen oder lösen (`linkMedia` / `unlinkMedia`) | `media_id`, `action` (verknüpfen, Standard, oder lösen), Ziele wie bei `add_media` | `mediaId`, `action`, `targets`, `changed`. Das Bild muss sichtbar, jedes Ziel bearbeitbar sein; die letzte Zuordnung lässt sich nicht lösen — die KI löscht nie ein Bild |
| `add_history_event` | Ereignis der Zeitgeschichte ergänzen (`aiCreateHistoryEvent`) — **nur Administratoren** (Recht `history:manage`), sonst „Keine Berechtigung für: Zeitgeschichte pflegen (nur Administratoren, Recht history:manage)“ | `title`, `year_from`, `year_to` (optional), `kind` (`krieg`/`politik`/`not`/`wanderung`/`sonstiges`), `description`, `region`, **`reason`** (Pflicht: Begründung mit Quelle der Jahreszahl, 15 bis 1000 Zeichen), `source_url` (optional, nur `https://`) | `event` (Kennung `c:…`, Felder, `origin: "AI"`, `unconfirmed: true`). Grenzen wie auf `/admin/history` (`checkHistoryInput`). **Dublettenschutz:** gleicher bzw. sehr ähnlicher Titel, überlappende Jahre und verträgliche Region bei einem mitgelieferten (auch ausgeblendeten) oder eigenen Eintrag → `CONFLICT` mit Titel, Jahren und Kennung des vorhandenen. Paket „Zeitgeschichte ergänzt (KI): …“ ohne Kennung |
| `update_history_event` | Eigenen Eintrag ändern (`aiUpdateHistoryEvent`) — nur Administratoren | `event_id` (`c:…`), `title`, `year_from`, `year_to`, `kind`, `description`, `region` (weggelassen = unverändert, `null` leert `year_to`/`description`/`region`), **`reason`** (Pflicht), `source_url` | `event`, `changed` (geänderte Felder; leer = nichts geändert, kein Protokoll). Inhaltliche Änderung → wieder unbestätigt; von Hand angelegte werden `AI_EDITED` („von KI geändert“); die Begründung ersetzt die alte. Mitgelieferte sind fest (Validierungsfehler mit Hinweis aufs Ausblenden); Dublettenschutz wie beim Anlegen, ohne den Eintrag selbst. Unbekannte Felder (etwa ein „bestätigt“) werden verworfen |
| `delete_history_event` | Eigenen Eintrag löschen (`aiDeleteHistoryEvent`) — nur Administratoren | `event_id` (`c:…`), **`reason`** (15 bis 1000 Zeichen) | `deleted`, `eventId`, `title`. Die gelöschten Werte, die Herkunft und die Begründung stehen im Protokoll. Mitgelieferte lassen sich nicht löschen |
| `set_builtin_history_event_hidden` | Mitgelieferten Eintrag für alle aus- bzw. wieder einblenden (`aiSetBuiltinHidden` → `setBuiltinHidden`) — nur Administratoren | `builtin_id`, `hidden` | `id`, `title`, `hidden`. Schon im gewünschten Zustand: nichts, kein Protokoll |

**Zeitgeschichte — „von KI“ und Bestätigen:** Alle vier Schreibwerkzeuge
laufen über `runWrite` (Stufe `WRITE`, Paket, Protokoll mit Kanal `MCP` und
Schlüssel) und verlangen im Dienst zusätzlich Administratorrechte — wie
`assign_place` sind sie für jeden Schreibschlüssel registriert und lehnen
Nicht-Administratoren beim Aufruf ab. Einträge der KI sind sofort für alle
sichtbar; bis ein Administrator sie auf `/admin/history` bestätigt
(`confirmHistoryEvents`, Route `POST /api/history-events/confirm`), tragen
sie an den Anzeigestellen den Vermerk „von KI, ungeprüft“. **Es gibt
bewusst kein Werkzeug zum Bestätigen.** Regeln im Einzelnen:
`lib/history/origin.ts` in [bibliotheken.md](bibliotheken.md) und
`lib/services/history.ts` in [dienste.md](dienste.md).

### Bild-Wege

1. **`add_media` mit `url`** — der Server lädt die Datei selbst
   (`fetchImageFromUrl`, aufgebaut auf `lib/safe-fetch.ts`): nur öffentliche
   https-Adressen, keine internen Netze, Größe begrenzt durch
   `MAX_UPLOAD_BYTES`. Die Inhaltsart der Antwort dient nur als Angabe;
   fehlt ein Dateiname, kommt er aus der Antwort. Einzelheiten des sicheren
   Abrufs: `lib/safe-fetch.ts` in [bibliotheken.md](bibliotheken.md) und die Doku
   der Dienste.
2. **`add_media` mit `data_base64`** — nur für Clients, die die
   Originaldatei wirklich lesen können (z.B. Claude Code mit lokaler Datei);
   auch als `data:`-Adresse. Größe wird vor dem Dekodieren geprüft
   (`decodeBase64Image`), der Typ anhand der Bytes; `mime_type` ist nur
   Gegenprobe. Deshalb das größere Körperlimit für Schreibschlüssel.
3. **`link_media` mit `media_id`** — ein Bild, das schon in der App ist
   (aus `get_person` `media`, `events[].media`, `citations[].media` oder
   `get_source` `images`).

Ein nur im Chat gezeigtes Bild hat das Modell nicht als Datei; dafür Weg 1
oder 3 (Server-Hinweis und Werkzeugbeschreibung sagen das ausdrücklich).

## Prompts und Ressource

- **Prompt `research_person`** („Person recherchieren“, Argument
  `person_id`): Ablauf `get_person` (ggf. `get_source`) → `get_timeline` →
  `check_consistency` → `get_ancestors` (3 Generationen) →
  `find_possible_duplicates`/`search_persons`; danach Zusammenfassung:
  belegt / nur in Notizen / unbelegt, Fehlendes und Ungenaues, konkrete
  nächste Rechercheschritte. Antwort auf Deutsch, keine Spekulation über
  verborgene Personen.
- **Prompt `review_data_quality`** („Datenqualität prüfen“, optional
  `family_id`): `get_statistics` → `check_consistency` →
  `find_possible_duplicates` → `find_data_gaps`, priorisierte Liste
  (Fehler, Dubletten, Lücken), Personen immer mit Name und ID.
- **Prompt `orte_zuordnen`** („Orte zuordnen“, optional `limit`, Standard
  100): offene Ortstexte stapelweise abarbeiten — `list_places(offen)` →
  je Text `suggest_place` und begründet wählen (weitere Teile des Texts,
  Kontext, Nähe) → eindeutige mit `assign_place` in Stapeln samt `note`
  zuordnen, fehlende Orte nur bei sicherer Lage als eigenen Ort anlegen,
  Wahrscheinliches mit `uncertain`, echte Zweifel offen lassen, vorher
  `begin_change_set` ohne Personennamen; am Ende Liste der unsicheren und
  offen gelassenen zur Prüfung auf `/admin/places`. Ohne Schreibrecht als
  Vorschlagsliste.
- **Prompt `review_duplicates`** („Dubletten vorprüfen“, optional
  `confidence` und `limit`, Standard 20): `list_duplicate_candidates`
  (nicht vorgeprüft) → je Paar `get_person` für beide und
  `preview_person_merge` → `review_duplicate` mit deutscher Begründung;
  Regeln für die drei Urteile (im Zweifel `DISPUTED`, nie raten, verborgene
  Verwandte nicht deuten), vorher `begin_change_set` ohne Personennamen.
  Sagt ausdrücklich, dass es kein Werkzeug zum Zusammenführen gibt. Am
  Ende Zahl je Urteil und die strittigen Paare mit offener Frage. Ohne
  Schreibrecht als Liste.
- `research_person` und `review_data_quality` hängen einen Schreibhinweis an: mit Schreibwerkzeugen
  „erst nach Rückfrage festhalten, nur mit Beleg, so genau wie die Quelle,
  Ereignisse statt Notizen, nichts nachweislich Richtiges überschreiben“;
  ohne „schreibgeschützt — Ergebnisse als Vorschläge formulieren“.
- **Ressource `familytree://person/{id}`** („Person“, JSON): derselbe
  Datensatz wie `get_person`. Prüft den Zugang mit Stufe `READ`;
  verweigert oder nicht sichtbar → Fehler. Keine Auflistung aller
  Personen (`list` nicht angeboten).

## Alte Kennungen nach einem Zusammenführen

Ist eine Person in der Web-App in einer anderen aufgegangen, bleibt ihre
Kennung für die KI brauchbar: Jedes Werkzeug löst sie vor dem Aufruf des
Dienstes still auf die bleibende Person auf und meldet das im Ergebnis als
`resolvedFrom` (alte → heutige Kennung); der Server-Hinweis bittet, mit der
heutigen Kennung weiterzuarbeiten. Das gilt auch für Schreibwerkzeuge (die
Änderung trifft die bleibende Person) und für die Ressource
`familytree://person/{id}`. Ohne alte Kennung fehlt das Feld. Aufgelöst
werden die Eingaben `person_id`, `other_person_id`, `from_person_id`,
`to_person_id`, `person_ids` und die Paar-Kennungen der Dubletten-Werkzeuge
(`keep_id`, `merge_id`, `person_a_id`, `person_b_id`) —
`mcp/person-redirects.ts`. Zeigen beide Kennungen danach auf dieselbe
Person, lehnt der Dienst ab („zwei verschiedene Personen“).

Aufgelöst wird nur, wenn der Benutzer die bleibende Person sehen darf
(`lib/services/redirects.ts`); sonst antwortet das Werkzeug wie bei einer
unbekannten Kennung. Kennungen aufgegangener Beziehungen und Ereignisse
werden nicht aufgelöst.

## Datenschutz und Grenzen

- Alles, was der Assistent abruft, geht an den KI-Anbieter.
- Verborgene Personen erscheinen nur als Platzhalter; Belege an ihnen
  werden in `get_source` nur gezählt.
- Schlüssel, Rechte und Sperren verwaltet nur die Weboberfläche; es gibt
  kein Werkzeug dafür.
- Zusammenführen von Dubletten, Löschen von Personen, Quellen und Bildern
  geht über MCP nicht. Die KI-Vorprüfung (`review_duplicate`) speichert nur
  eine Einschätzung; kein Dienstweg macht daraus ein Zusammenführen oder ein
  „kein Duplikat“ (`tests/duplicate-review.db.test.ts` prüft, dass die
  Werkzeugliste kein Zusammenführen enthält und nach einer Einschätzung
  beide Personen unverändert sind).

## Tests

| Test | Prüft |
|---|---|
| `tests/mcp-http.db.test.ts` | HTTP-Endpunkt mit dem HTTP-Client des SDK: Werkzeuglisten je Stufe, Lese-Schlüssel ohne Schreibwerkzeuge, Audit mit Kanal und Schlüssel-ID, Herabstufen und Widerruf beim nächsten Aufruf, 401/403-Matrix samt `WWW-Authenticate`, Cookie allein meldet nicht an, Maskierung für Betrachter, Körpergröße, Origin, Methoden, Sperre nach Fehlversuchen, keine Geheimnisse im Log, `.mcp.json` |
| `tests/mcp.db.test.ts` | stdio-Server: alle Lesewerkzeuge, Prompts und Ressource, Maskierung, Schreibwerkzeuge mit Audit, Ereignisse/Namen/Orte/Belege an Ereignissen, Startverweigerung (ohne/unbekannter/gesperrter Benutzer, ohne KI-Recht, falsche Datenbank), KI-Recht „lesen“ trotz `MCP_ALLOW_WRITE`, Rechteänderung während der Sitzung, Start wie `npm run mcp:stdio` mit sauberem stdout |
| `tests/person-redirect.db.test.ts` | Alte Kennungen: Auflösen in Eingaben (einzeln, Listen), `resolvedFrom` in Lese- und Schreibwerkzeugen samt Schema-Prüfung des Clients, Ressource, verborgene Zielperson wie unbekannt |
| `tests/duplicate-review.db.test.ts` | KI-Vorprüfung: Werkzeuge und Prompt je Stufe, kein Zusammenführen-Werkzeug, Server-Hinweis; `list_duplicate_candidates` nur mit beiden sichtbaren Personen; `preview_person_merge` als Trockenlauf mit Rechten wie in der App; `review_duplicate` mit Rechten, ändert nichts außer der Einschätzung, Protokoll; „veraltet“ nach Änderung, Ersetzen; „kein Duplikat“ eines Menschen geht vor; Löschen entfernt die Einschätzung |
| `tests/mcp-format.test.ts` | Formatierung: Personenreferenz, Lebensspanne, Recherchenotiz anhängen, ungenaue Daten |
| `tests/media-links.db.test.ts` | `add_media` per base64 und per Adresse (mit ersetztem Netz), `link_media`, Rechte |
| `tests/changelog.db.test.ts` | Bündeln je Schlüssel, `begin_change_set`, fremde Paketkennung abgelehnt |
| `tests/places-ai.db.test.ts` | `suggest_place` (früherer Name, mehrdeutig, eigener Ort), `list_places` nur für Admins mit Kontext ohne Personennamen, `assign_place` mit Stapel, eigenem Ort, Ablehnung bei MANUAL bzw. unbekanntem Text, Protokoll mit Kanal und Schlüssel, Rechte für Nicht-Admins |
| `tests/history-ai.db.test.ts` | Zeitgeschichte über MCP: Server-Hinweis; Leseschlüssel nur `list_history_events` mit Filtern; Schreibschlüssel eines Nicht-Administrators abgelehnt; Administrator legt nur mit Begründung an (Herkunft `AI`, unbestätigt, Protokoll mit Kanal, Schlüssel und Paket), Dublette (mitgeliefert, eigen, auch beim Ändern) abgelehnt, andere Region erlaubt; Ändern macht wieder unbestätigt bzw. „von KI geändert“; kein Werkzeug zum Bestätigen; Löschen mit Begründung, Ausblenden; Bestätigen über Dienst und Route |
| `tests/history-origin.test.ts` | Reine Regeln aus `lib/history/origin.ts`: unbestätigt, Herkunft nach KI-Änderung, Bestätigen beim Speichern von Hand, Begründung/Adresse, Titelähnlichkeit, Jahre, Region, Hinweistext |
| `tests/ai-access.db.test.ts`, `tests/ai-access.test.ts` | Rechte- und Schlüssellogik (`authorizeAiCall`, Stufen) |
| `e2e/read/mcp-http.spec.ts` | Gegen den laufenden Server: Schlüssel-Matrix, `tools/list` nach Stufe (auch `list_history_events` bzw. `add_history_event`), Cookie allein meldet nicht an |
| `e2e/write/history.spec.ts`, Block „Einträge der KI“ | Einträge über `add_history_event`; Vermerk „von KI, ungeprüft“ an Zeitstrahl, Zeitreise und Lebenslauf; Verwaltung mit Filter und Bestätigen; Vermerk danach weg |
| `e2e/write/ai-access.spec.ts` | Oberfläche `/ai-access` und Verwaltung (Schlüssel anlegen, herabsetzen, widerrufen) |

Die `.db`-Tests überspringen sich ohne Mock-Datenbank.
