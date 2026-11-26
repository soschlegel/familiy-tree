# Änderungsgeschichte

Jede Änderung — in der Oberfläche, beim Import, beim Zusammenführen und über
den KI-Zugang — steht im `AuditLog`: wer, wann, was, über welchen Kanal
(App oder KI über MCP mit dem Namen des Schlüssels; ein inzwischen
gelöschter Schlüssel erscheint als „Schlüssel „…“ (gelöscht)“, siehe
[KI-Zugang](../betrieb/ki-zugang.md#schlüssel-richtig-verwenden)). Seit der Migration
`20261122000000_changelog` speichert ein Eintrag bei Änderungen je Feld den
Wert **vorher und nachher** (`diff.changes`; ungenaue Daten in Anzeigeform,
„um 1850“ → „12.03.1850“), dazu eine **Momentaufnahme der betroffenen
Personen und Familien** (`personIds`, `familyIds`) — eine Änderung an einem
Ereignis, Namen, Beleg, Bild oder einer Beziehung gehört so zu allen
beteiligten Personen, und auch nach dem Löschen bleibt erkennbar, welche
Familie betroffen war.

**Pakete (`ChangeSet`).** Zusammengehörige Änderungen bilden ein Paket mit
Titel ([lib/change-sets.ts](../../lib/change-sets.ts)):

| Herkunft | Paket |
|---|---|
| Oberfläche | eine API-Anfrage = ein Paket; Titel aus dem ersten Eintrag („Person geändert“, „Beleg angelegt“) |
| GEDCOM-Import / Daten einspielen | ein Paket „GEDCOM-Import „Datei““ bzw. „Daten eingespielt („Datei“)“; je betroffener Person ein Eintrag (angelegt bzw. aktualisiert mit vorher → nachher, dazu die Zahl der angelegten Ereignisse, Namen, Beziehungen, Belege) |
| Zusammenführen | „Personen zusammengeführt“; Sammel-Zusammenführen und „Importe verbinden“ je ein Paket für alle Paare |
| KI-Zugang | `begin_change_set(title)` öffnet ein Paket, die Schreibwerkzeuge nehmen optional `change_set_id`. Ohne Kennung hängt der Server an das zuletzt benutzte Paket desselben Benutzers und Schlüssels an, wenn dessen letzte Änderung höchstens 30 Minuten zurückliegt, sonst beginnt ein neues („KI-Änderungen über „Schlüssel““). Ein mit `begin_change_set` geöffnetes Paket nimmt 24 Stunden Änderungen an; eine fremde oder abgelaufene Kennung lehnt das Werkzeug ab, bevor etwas geändert wird. Der MCP-Endpunkt ist zustandslos, deshalb gibt es keine Bündelung „je Sitzung“ |

Angelegt wird ein Paket erst mit dem ersten Eintrag; lesende Anfragen
hinterlassen nichts. Ein „Paket rückgängig machen“ gibt es bewusst nicht.

**Anzeige.**

- **Personenseite**, Abschnitt „Änderungen“ (nur für Bearbeiter der Person,
  wie `canEditPerson`): neueste zuerst, je Eintrag Datum, Benutzer, Kanal,
  Paket und Feld vorher → nachher; lädt beim Aufklappen, je 20 Einträge.
  API: `GET /api/persons/<id>/changes?cursor=…` (Betrachter 403, unsichtbare
  Person 404).
- **`/admin/changes`** (nur Administratoren, Menüpunkt „Änderungen“): eine
  Zeile je Paket mit Zusammenfassung („2 Personen, 5 Belege angelegt · 1
  Person geändert“), aufklappbar bis zum einzelnen Feld; Filter Familie,
  Benutzer, Kanal und Zeitraum (ohne Angabe die letzten 30 Tage). Mit
  Familienfilter erscheinen nur die Einträge, die diese Familie betreffen.
  API: `GET /api/changes?family=&user=&channel=APP|MCP&from=&to=&page=` und
  `GET /api/changes/<paket>?cursor=…` (sonst 403).
- **Datenschutz:** Verweise auf Personen und Familien, die der Betrachter
  nicht sehen darf (z.B. der Partner aus einer fremden Familie), erscheinen
  als „nicht freigegeben“; Einträge über eine andere, nicht sichtbare Person
  (z.B. eine zusammengeführte Person aus fremder Familie) ohne Feldwerte.
- **Ältere Einträge** (vor der Migration) haben weder Paket noch
  Momentaufnahme: Der Personenverlauf findet sie über die Kennungen der
  Person und ihrer heutigen Ereignisse, Namen, Belege, Beziehungen und Bilder
  und zeigt nur die neuen Werte („vorheriger Wert nicht erfasst“); in der
  Übersicht stehen sie als Einzeländerung, beim Familienfilter fehlen sie.

Gemessen (Mock-Datenbank mit 250 000 zusätzlichen Einträgen): Verlauf einer
Person rund 2 ms (GIN-Index auf `personIds`, ältere Einträge über
`entityType`/`entityId`), Übersicht einer Familie für einen Tag rund 70 ms;
die Übersicht über alle Einträge ohne Zeitraum braucht bei dieser Menge
mehrere Sekunden — deshalb der Standardzeitraum.
