# Import und Export

Daten sichern, mit anderen Stammbaumprogrammen austauschen und einen Stammbaum aus MyHeritage übernehmen. Alles unter „Daten“ im Menü.

## Exportieren (alle Benutzer)

Exportieren darf jeder — aber immer nur, was er sehen darf. Nicht freigegebene Personen fehlen samt aller Verweise auf sie.

- **ZIP mit Bildern** bzw. **Nur JSON**: das eigene Format der App, vollständig (Personen, Beziehungen, Ereignisse, Quellen, Belege, Bildzuordnungen). Das ZIP enthält zusätzlich die Bilddateien und eignet sich als Sicherung oder für einen Umzug.
- **GEDCOM** bzw. **GEDCOM mit Bildern (ZIP)**: das Austauschformat der Stammbaumprogramme (MyHeritage, Ancestry, Gramps, Ahnenblatt …).

Beim GEDCOM-Export fragt ein Dialog, **welche Familien** in die Datei sollen (alle sind vorausgewählt, mit „Alle“ und „Keine“). Er zeigt, wie viele Personen das sind. Eine Person mit mehreren Familien ist dabei, sobald eine davon gewählt ist; Beziehungen kommen nur mit, wenn beide Personen dabei sind.

Ob andere Programme den GEDCOM-Export vollständig übernehmen, ist noch nicht ausprobiert.

## Importieren (nur Administratoren)

Bearbeiter und Betrachter sehen den Import nicht. Ein Import ändert erst etwas, **nachdem du die Vorschau gesehen und bestätigt hast**.

### Eine GEDCOM-Datei einspielen — z.B. aus MyHeritage

1. Exportiere den Stammbaum im anderen Programm als GEDCOM-Datei (`.ged`, oder ein `.zip`, das eine `.ged` enthält).
2. Unter **Daten** die Datei wählen und **Vorschau der GEDCOM-Datei**. An den Daten ändert sich dabei nichts.
3. Die Vorschau erkennt, ob dieser Baum schon einmal importiert wurde („Automatisch erkennen“), und sortiert alles in Gruppen: **Neu**, **In der Datei geändert**, **In der App geändert**, **Fehlt in der Datei**, **Nicht übernehmbar**, **Schon vorhanden**, **Unverändert**.
4. Sieht eine neue Person einer schon vorhandenen ähnlich, fragt die Vorschau „Ist das eine dieser Personen?“. Nur wenn du eine auswählst, werden die beiden verbunden.
5. Wähle, zu welchen **Familien** die neuen Personen gehören sollen (siehe unten).
6. „Was der Import tut“ fasst alles in Sätzen zusammen. **GEDCOM-Import ausführen** fragt noch einmal nach und läuft dann im Hintergrund.

### Wiederholte Importe

Der Normalfall ist, denselben Baum regelmäßig neu zu exportieren und einzuspielen. Die App erkennt jeden Eintrag wieder:

- **In der Datei geändert** wird übernommen.
- **In der App geändert** bleibt wie in der App — außer du stellst ausdrücklich „Dateiversion übernehmen“ ein. Hier Geändertes wird also nie still überschrieben.
- **Fehlt in der Datei** bleibt erhalten. Gelöscht wird nur, was du einzeln ankreuzt und beim Ausführen noch einmal bestätigst.

Nichts geht verloren: Was die App nicht abbilden kann, bewahrt sie unverändert auf und schreibt es beim GEDCOM-Export zurück. Die Originaldatei jedes Imports kannst du im Importverlauf wieder herunterladen.

### Familien beim Import

Sichtbarkeit hängt an Familien (siehe [Erste Schritte](01-erste-schritte.md#familien-wer-was-sieht)). Neue Personen kommen deshalb standardmäßig in **keine** Familie — dann sieht sie nur der Administrator, bis er sie zuordnet. Du kannst sie aber gleich vorhandenen Familien oder einer neuen Familie zuordnen. Personen, die in der Datei als privat oder lebend markiert sind, bleiben auf Wunsch (Standard) ohne Familie.

### Fotos aus MyHeritage

MyHeritage verweist in der Datei auf Fotos auf seinen Servern. Heruntergeladen werden sie **nur**, wenn du den Haken **Fotos jetzt herunterladen** setzt (Standard: aus). Gegen echte MyHeritage-Server ist das noch nicht ausprobiert.

### Quellen aus MyHeritage

Quellen werden beim Import eingeordnet: Kirchenbuch, Standesamt, Volkszählung usw., wenn der Titel das hergibt. Stammbäume anderer Nutzer („… Stammbäume“, „Smart Matches“) werden **Online-Stammbaum** — keine unabhängige Quelle, siehe [Quellen und Belege](03-quellen-und-belege.md).

## Sicherung einspielen (JSON/ZIP)

Eine Exportdatei im eigenen Format (JSON oder ZIP) spielt der Administrator unter „Import“ wieder ein. Auch hier zuerst die Vorschau; vorhandene Einträge werden erkannt und aktualisiert, unbekannte ergänzt. **Gelöscht wird nichts.**

Mehrfach vorhandene Personen aus verschiedenen Importen führst du danach zusammen — siehe [Dubletten](07-dubletten.md).
