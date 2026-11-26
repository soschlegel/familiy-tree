# Ungenaue Daten

Geburt, Tod und Beginn/Ende einer Beziehung (sowie das Datum einer Quelle)
lassen sich so genau eintragen, wie es die Quelle hergibt. Alle Datumsfelder
sind Textfelder; unter dem Feld steht beim Tippen, wie die Eingabe verstanden
wird („Verstanden als: um 1850“), oder eine Fehlermeldung.

| Eingabe | bedeutet | Anzeige |
|---|---|---|
| `12.03.1850`, `12. März 1850`, `1850-03-12` | genauer Tag | 12.03.1850 |
| `03.1850`, `3/1850`, `März 1850`, `1850-03` | nur Monat | März 1850 |
| `1850` | nur Jahr | 1850 |
| `um 1850`, `ca. 1850`, `circa 1850`, `~1850` | ungefähr (± 2 Jahre) | um 1850 |
| `vor 1900` | spätestens Ende 1899 | vor 1900 |
| `nach 1723` | frühestens 1724 | nach 1723 |
| `geschätzt 1850`, `errechnet 1850` | wie „um“ (± 2 Jahre) | geschätzt 1850 |
| `zwischen 1850 und 1855`, `1850–1855`, `1850-1855` | ein Zeitpunkt in diesem Zeitraum | zwischen 1850 und 1855 |
| `von 1901 bis 1910` | Zeitraum (z.B. Wohnort) | von 1901 bis 1910 |
| `ab 1901`, `seit 1901` | Zeitraum ohne Ende | ab 1901 |
| `bis 1910` | Zeitraum bis einschließlich 1910 | bis 1910 |

Zusätze lassen sich mit jeder Genauigkeit kombinieren („um 03.1850“, „vor
12.03.1900“, „zwischen 12.03.1850 und Mai 1851“). Für KI-Eingaben werden auch
die GEDCOM-Formen `ABT`, `BEF`, `AFT`, `EST`, `CAL`, `BET … AND …`,
`FROM … TO …` und englische Monatskürzel (`12 MAR 1850`) verstanden,
außerdem volle ISO-Zeitstempel (ältere API-Aufrufe).

**Wortlaut:** Was sich nicht strukturiert darstellen lässt („Weihnachten
1850“, ein Datum im julianischen Kalender, eine GEDCOM-Datumsphrase), bleibt
als Text erhalten (`…Phrase`) — allein oder neben dem Datum, angezeigt als
„1850 („Weihnachten 1850“)“. Wird das Datum geändert, ohne einen neuen
Wortlaut anzugeben, verfällt der alte; bleibt das Datum gleich, bleibt er.

**Speicherung:** sortierbarer Ankerpunkt plus Genauigkeit, Zusatz,
Bereichsende und Wortlaut je Datum — beschrieben in
[datenmodell.md](../komponenten/datenmodell.md#ungenaue-datumsangaben-muster-für-alle-datumsfelder);
eingelesen, angezeigt und verglichen wird an einer Stelle,
[lib/dates.ts](../../lib/dates.ts).

**Prüfungen:** Validierung, Plausibilitätsprüfung, Datenlücken, Dubletten,
Alter in Zeitleisten und die Statistik vergleichen den Zeitraum, den eine
Angabe abdeckt. Gemeldet bzw. abgelehnt wird nur, was für *jede* mögliche
Lesart widersprüchlich ist (ein Bereich zählt mit seinem ganzen Zeitraum) —
„1900 gestorben“ und „1900 geboren“ ist kein
Fehler, nur weil beides intern auf den 1. Januar fällt; „vor 1840 gestorben,
1850 geboren“ schon. Ein ungefähres Geburtsdatum gilt nicht als fehlend; die
Zeitleiste einer Person führt es aber als „genaues Geburtsdatum (bisher: um
1850)“ unter den offenen Punkten. Suche und Sortierung nach Geburtsjahr,
Jahresfilter der Familienzeitleiste und die Geburtsjahre der Statistik nutzen
den Ankerpunkt („vor 1900“ zählt als 1900, „zwischen 1850 und 1855“ als 1850).
