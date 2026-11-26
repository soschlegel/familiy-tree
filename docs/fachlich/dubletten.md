# Dubletten zusammenführen

Steht dieselbe Person zweimal im Archiv — von Hand doppelt erfasst, einmal
unter dem Ehe- und einmal unter dem Geburtsnamen, oder aus zwei Importen —,
werden beide Einträge zu einem. Die App ist dabei die eine Wahrheit; ein
Import ist eine Quelle, aus der sie sich bedient. Bearbeiter (Recht an
**beiden** Personen nötig) finden das unter **Recherche → Mögliche
Dubletten** (alle Paare: `/research/duplicates`) und auf jeder Personenseite
mit dem Knopf **Zusammenführen …** neben „Im Stammbaum zeigen“ (Dialog:
zuerst die möglichen Dubletten dieser Person mit Klasse und Begründung,
darunter die freie Personensuche). Nach dem Zusammenführen nennt die
Ergebnisseite **Folgedubletten** (Eltern, Partner, Kinder der bleibenden
Person; „sichere“ gemeinsam nur über die Vorschau des
Sammel-Zusammenführens); ein nur wegen doppelt erfasster Eltern gesperrtes
Paar geht mit **„Erst die Eltern, dann dieses Paar“** in einem Schritt. Die
**alte Kennung** der aufgegangenen Person leitet danach auf die bleibende um
(`/people/<alt>`, `/tree?focus=<alt>` und `GET /api/persons/<alt>` mit 308;
`PATCH`/`DELETE` mit 409 und `mergedInto`; nur, wenn die bleibende Person
für den Benutzer sichtbar ist — sonst 404 wie bei einer unbekannten Kennung;
der KI-Zugang löst still auf und meldet `resolvedFrom`). Einzelheiten:
[docs/komponenten/dienste.md](../komponenten/dienste.md),
`merge-followups.ts` und `redirects.ts`.

## Mögliche Dubletten

Verglichen werden sichtbare Personen mit gleichem erstem Vornamen (darin nur
gleiche oder ähnlich geschriebene Nachnamen — einige tausend Personen in
Sekundenbruchteilen); bewertet nach Vor- und Nachname (auch Geburtsname und
weitere Namen — „Anna Müller geb. Schmidt“ und „Anna Schmidt“ passen),
Geburts- und Sterbedatum (auch ungenaue: „um 1760“ passt zu „12.03.1760“),
Geburtsort und Verwandten (dieselben oder gleichnamige Eltern bzw. Partner).
Direkt verbundene Personen (Vater und Sohn gleichen Namens), eingetragene
Vorfahren und Nachkommen über beliebig viele Generationen (auch über
Adoptiv-, Stief- und Pflegeeltern — der gleichnamige Urgroßvater ist nicht
sein Urenkel) und Personen verschiedenen Geschlechts kommen nie in Frage.
Die Abstammungskette zählt nur über Personen, die der Benutzer sehen darf;
das Fehlen eines Paares verrät so nichts über verborgene Personen (das
Zusammenführen selbst sperrt Zyklen ohnehin über alle Kanten). Drei Klassen:

| Klasse | Bedeutung |
|---|---|
| **sicher** | gleicher ganzer Name, gleiches tagesgenaues Geburtsdatum, gleiches tagesgenaues Sterbedatum (oder beide ohne Tod, aber dieselben bzw. gleichnamigen Eltern/Partner) und kein Widerspruch |
| **wahrscheinlich** | viele Übereinstimmungen, kein Widerspruch |
| **unklar — bitte prüfen** | einzelne Übereinstimmungen oder ein Widerspruch (verschiedene Sterbedaten, verschiedene Eltern, nur der erste Vorname gleich) |

**Kein Duplikat** blendet ein Paar dauerhaft aus (für alle, Tabelle
`DuplicateDismissal`); zusammengeführte Paare verschwinden ohnehin — die
Liste wird kürzer, je weiter man kommt. Paare der Klasse „sicher“ lassen sich
auswählen und nach einer gemeinsamen Vorschau **in einem Rutsch**
zusammenführen: Eltern vor Kindern, jedes Paar in einer eigenen Transaktion,
die Klasse wird dabei neu geprüft; bleibend ist der Eintrag mit mehr Angaben.

## Vergleich und Zusammenführen

Der schnelle Weg: Vergleich öffnen, lesen, was geschieht, **Zusammenführen**.
Die Vorgaben reichern an, statt zu streiten: Leeres wird aus dem anderen
Eintrag ergänzt, von zwei vereinbaren Daten gewinnt das genauere, bei
„Geburtsname als Nachname“ gegen „Ehename geb. …“ entsteht eine Person mit
Ehename und Geburtsname, Notizen werden aneinandergehängt; bei echtem
Widerspruch gilt der Wert des bleibenden Eintrags, und der andere bleibt
erhalten — eine abweichende Geburts- oder Todesangabe als Zweitangabe
(Ereignis mit `isAlternative`), ein anderer Name als Namensvariante, sofern
er nicht schon im Ergebnis steckt. Nur ein abweichendes Geschlecht lässt sich
nicht aufbewahren; das steht dann ausdrücklich in der Zusammenfassung. Wer
will, klappt **„Angaben einzeln ansehen und wählen“** auf (beide Einträge
nebeneinander, Abweichungen markiert, je Angabe wählbar); „Seiten tauschen“
bestimmt, welcher Eintrag bleibt.

Danach zieht alles um: Lebensereignisse, Namensvarianten, Belege, Bilder
(ein Hauptbild, kein doppelter Verweis), Familien (Vereinigung — wer eine
der Familien sehen darf, sieht die Person danach; die Vorschau sagt das),
Fremdkennungen, Rohdaten und die Herkunft aus Importen. Gleiches fällt
zusammen (gleiche Ereignisse, Belege, Namen); Beziehungen werden umgehängt,
und zwei gleiche Beziehungen (beide Einträge mit demselben Elternteil bzw.
Partner) werden eine — mit der genaueren Art (verheiratet vor „Ehestand
unbekannt“, Adoption vor leiblich; wählbar), ergänzten Daten und Orten,
abweichender Heirat/Scheidung als Zweitangabe und den Belegen und Ereignissen
beider.

**Blockiert** — mit Erklärung, schon in der Vorschau — wird, was die Regeln
der App verletzen würde: die beiden sind miteinander verbunden; zusammen
hätten sie mehr als zwei leibliche Eltern (dann sind meist die Eltern selbst
doppelt — der Vergleich verlinkt das Elternpaar: erst die Eltern, dann das
Kind); ein Zyklus (Großvater und Enkel gleichen Namens); eine Person wäre
zugleich Partner und Elternteil; Tod vor Geburt durch die Wahl.

Ausgeführt wird in **einer Transaktion**; geänderte Daten seit der Vorschau
ergeben einen Hinweis statt einer Überraschung, doppeltes Absenden das
gespeicherte Ergebnis. Der `AuditLog`-Eintrag (`action` „MERGE“, Person =
bleibende) enthält beide IDs, die Wahl je Feld, die vorherigen Werte der
bleibenden Person und die vollständigen Spalten der aufgegangenen samt IDs
ihrer Namen, Ereignisse, Belege, Beziehungen, Rohdaten und Herkunftsangaben.
Rückgängig per Knopf gibt es nicht; **von Hand** hieße das: die Person aus
`diff.merged.person` neu anlegen (gleiche ID), die vorherigen Werte aus
`diff.keepBefore` zurückschreiben, Herkunftsangaben mit `mergedFromId` =
aufgegangene ID, ihre Rohdaten (`rawRecordIds`) und Fremdkennungen
zurückhängen und Beziehungen, Ereignisse, Namen und Belege anhand der IDs im
Eintrag wieder zuordnen — einfacher ist meist die Sicherung vom Vortag.

## Importe verbinden

Mehrere Importe (z.B. zwei MyHeritage-Exporte verschiedener Verwandter)
enthalten oft dieselben Menschen. **Recherche → „Importe verbinden“**
(`/research/connect`, nur Administratoren) findet diese
Verbindungspersonen und führt sie nach Bestätigung zusammen — aus den
Importen wird ein gemeinsamer Stammbaum.

Schneller Weg: Seite öffnen (Auswahl „alle Importe“ steht schon), **Abgleichen**
(läuft im Hintergrund), oben steht „Jetzt N Familienverbände — mit den
sicheren Verbindungen M Familienverbände“ und je Import-Paar die Zahl der
Verbindungspersonen;
**Gemeinsame Vorschau** (was umzieht, zusammenfällt, Zweitangabe wird, was
blockiert ist, wie viele Personen danach zu weiteren Familien gehören und
damit für deren Mitglieder sichtbar werden), **Jetzt zusammenführen**,
bestätigen. Danach startet von selbst ein neuer Abgleich — durch die
Verbindungen haben Verwandte jetzt gemeinsame Eltern, Partner und Kinder.

Abgleich ([lib/import-linking.ts](../../lib/import-linking.ts)): Kandidaten nur
zwischen verschiedenen Importen (bzw. innerhalb eines Imports, wenn gewählt),
geblockt nach Vor- und Nachnamen; dann Ausbreitung über Eltern, Partner und
Kinder schon verbundener Paare; je Person und Import höchstens ein Partner;
Gruppen über mehrere Importe nur, wenn alle Mitglieder zueinander passen.

| Klasse | Bedeutung | vorausgewählt |
|---|---|---|
| **sicher** | wie bei den Dubletten (gleicher ganzer Name, gleiche tagesgenaue Geburts- und Sterbedaten bzw. gemeinsame Eltern, kein Widerspruch) oder über einen *sicheren* Verwandten mit gleichem ganzen Vornamen und vereinbarem Geburtsdatum | ja |
| **sehr wahrscheinlich** | zwei übereinstimmende Verwandte, oder gleiches tagesgenaues Geburtsdatum plus ein Verwandter; nie einseitig fehlendes Geburtsdatum | nein |
| **wahrscheinlich** | Name und vereinbare Daten plus ein weiterer Beleg (tagesgenaue Geburt, passender Tod oder Verwandte) | nein |
| **unklar** | nur Name und ungefähres Jahr, Widerspruch, mehrere gleich gute Kandidaten | nein |

Eine Verbindung, die als **einzige** zwei sonst getrennte Familien
zusammenführt und sich auf keinen übereinstimmenden Verwandten stützt, ist
nie „sicher“ — ein Irrtum dort verbände fremde Familien. Jede Brücke zeigt,
wie viele Personen sie verbindet. Auf erfundenen Testbäumen mit Fallen
(gleichnamige Geschwister, Vater und Sohn gleichen Namens, Zwillinge,
Wiederverheiratung, falsche Einzelbrücke, Widerspruch im dritten Import):
„sicher“ und „sehr wahrscheinlich“ ohne Fehler, „wahrscheinlich“ 99,4–99,9 %
richtig (Vorsicht bei gleichnamigen Verwandten mit fehlenden Daten);
`tests/import-linking.test.ts`. Laufzeit: zwei Importe à ~5000 Personen
unter einer Sekunde, fünf Importe mit zusammen ~12 000 Personen etwa 5 s.

Ausführen im Hintergrund; jede Personengruppe ist eine eigene Transaktion
(danach ist der Stammbaum stimmig). Der Lauf liegt als Datei unter
`MEDIA_DIR/connect/`; wird die App mitten im Lauf neu gestartet, zeigt die
Seite „unterbrochen — X von Y erledigt“ und **Fortsetzen** macht weiter
(schon Zusammengeführtes wird erkannt, nichts doppelt). Abgelehnte Paare
lassen sich dauerhaft als „kein Duplikat“ markieren; ein späterer Abgleich
zeigt nur Neues. Ein Audit-Eintrag `CONNECT` je Lauf listet alle Gruppen,
dazu je Zusammenführung der übliche `MERGE`-Eintrag. Kein KI-Werkzeug.

## Herkunft und spätere Importe

Jeder Datensatz kann mehrere Herkunftsangaben (`ImportLink`) haben — eine je
Datensatz einer Importdatei. Beim Zusammenführen ziehen die der aufgegangenen
Person (und ihrer Untereinträge) mit um (`mergedFromId`, `mergedAt`). So
erkennt ein späterer Import **jeder** beteiligten Datei die Person wieder:
nichts wird neu angelegt, nichts als „fehlt in der Datei“ gemeldet. Steht
eine Person in **einer** Datei doppelt, trägt sie danach zwei Links dieser
Datei; der zweite Eintrag wird ihr zugeordnet, überschreibt sie aber nie.

Weicht der App-Stand eines zusammengeführten Eintrags vom letzten Stand
einer Datei ab, weil beim Zusammenführen der andere Wert gewählt wurde, und
bringt die Datei seitdem nichts Neues, meldet die Importvorschau ihn still
als **unverändert** (der App-Stand bleibt) statt als „in der App geändert“.
Hat die Datei dagegen seither etwas geändert, erscheint er wie gewohnt zur
Entscheidung.

**GEDCOM-Export einer zusammengeführten Person:** eine Person, eine `_UID` —
die des ursprünglichen Datensatzes der bleibenden Person (Herkunftsangabe
ohne `mergedFromId`, sonst die älteste) samt dessen Zusatz-Tags. Die
Kennungen der anderen Importe bleiben in der App und im JSON-Export.

Kein KI-Werkzeug: Zusammenführen geht nur in der Web-App;
`find_possible_duplicates` zeigt Klasse, Gründe und Widersprüche.

Dienste: [lib/services/merge.ts](../../lib/services/merge.ts) (Vorschau,
Zusammenführen), [lib/merge-rules.ts](../../lib/merge-rules.ts) (Regeln),
[lib/services/merge-bulk.ts](../../lib/services/merge-bulk.ts) (sichere Paare in
einem Rutsch), [lib/duplicates.ts](../../lib/duplicates.ts) und
[lib/services/duplicates.ts](../../lib/services/duplicates.ts) (Erkennung, „kein
Duplikat“). API: `POST /api/persons/merge/preview`, `POST /api/persons/merge`,
`POST /api/persons/merge/bulk` (mit `dryRun`), `GET /api/duplicates`,
`POST`/`DELETE /api/duplicates/dismiss`.
