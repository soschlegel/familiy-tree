# Sicherung

Eine vollständige Sicherung besteht aus genau zwei Teilen:

1. **Datenbank-Dump** — `backups/db_<Datum>_<Zeit>.sql.gz`, erzeugt vom
   Dienst `backup-db` (`pg_dump --clean --if-exists`, also direkt wieder
   einspielbar). Er löscht Dumps, die älter als `BACKUP_KEEP_DAYS`
   (Standard 30) Tage sind.
2. **Bilderordner** — `media/` selbst. Die Bilder sind gewöhnliche Dateien,
   benannt nach den Schlüsseln in der Datenbank; es gibt keinen eigenen
   Sicherungsdienst und keine zweite Kopie innerhalb von `${DATA_ROOT}` (sie
   läge auf demselben Datenträger und würde die NAS-Sicherung nur
   vergrößern). Gesichert wird `media/` von der NAS-Sicherung.

`backup-db` läuft **bei jedem Stack-Start vor dem App-Container** (und damit
vor dessen Migration), damit es zu
jedem Update eine Sicherung vom Stand davor gibt (mehrere Updates am Tag
ergeben mehrere Dumps), und zusätzlich täglich per Aufgabenplaner.

**Täglich planen (Synology):** Systemsteuerung → Aufgabenplaner → Erstellen →
Geplante Aufgabe → Benutzerdefiniertes Script; Benutzer `root`; Zeitplan
z.B. täglich 03:00; Script:

```sh
docker start -a familytree-backup-db-1
```

Das startet nur den vorhandenen Container erneut — es braucht weder eine
Repo-Kopie noch `docker compose` auf der NAS. `-a` hängt die Ausgabe ans
Aufgabenprotokoll; ein Fehlschlag lässt die Aufgabe fehlschlagen (Mail-
Benachrichtigung im Aufgabenplaner einschalten). Mit Repo-Kopie geht
dasselbe über `./scripts/backup.sh [Stackname]`.

**NAS-Sicherung (Hyper Backup o.ä.) — Pflicht:** `${DATA_ROOT}` vollständig
sichern, mindestens `backups/` **und** `media/`, mit Versionierung (sonst
überschreibt eine versehentliche Löschung die einzige Kopie). Zeitplan
**nach** dem Dump, z.B. Dump 03:00, Hyper Backup 03:30 — dann stammt
`media/` in jeder Version vom selben oder einem etwas späteren Zeitpunkt als
der Dump darin, und genau das braucht eine konsistente Wiederherstellung
(siehe unten). Die Rohdateien unter `postgres/` sind im laufenden Betrieb
nur zusammen mit einem Snapshot (Btrfs) konsistent; maßgeblich sind die
Dumps. Zusätzlich ist der ZIP-Export unter `/admin/data` ein vollständiges,
instanzunabhängiges Backup ([Austauschformat](../fachlich/austauschformat.md)).

**Wenn Dump und Bilder nicht exakt zusammenpassen:**

| Lage | Folge |
|---|---|
| `media/` neuer als der Dump (Bilder nach dem Dump hochgeladen) | verwaiste Dateien ohne Datenbankeintrag — harmlos, belegen nur Platz |
| `media/` älter als der Dump bzw. Datei fehlt | Datenbankeintrag ohne Datei — das Bild erscheint als kaputtes Symbol, `/api/media/…` antwortet 404; der Rest der App läuft normal. Datei aus einer neueren Sicherung holen oder Bild löschen und neu hochladen |

Deshalb: Bilder immer vom selben oder einem späteren Zeitpunkt als der Dump
zurückspielen — nie umgekehrt.

## Wiederherstellung

Beispiel für Stack `familytree` und `DATA_ROOT=/volume1/docker/familytree`,
per SSH als root auf der NAS. Funktioniert genauso auf einer frisch
installierten NAS (erst den Stack wie oben deployen; `postgres/` **nicht**
aus der NAS-Sicherung zurückholen, sondern den Dump einspielen).

Vorher aus der NAS-Sicherung (Hyper Backup → *Wiederherstellen* →
*Daten*, Ziel ein eigener Ordner) den gewünschten Dump und den Ordner
`media/` derselben Version holen — z.B. nach `/volume1/restore/familytree/`.
Ein Dump, der noch in `backups/` liegt, kann direkt verwendet werden; dann
`media/` aus einer NAS-Sicherung vom selben Tag oder später.

```sh
# 1. App anhalten
docker stop familytree-app-1

# 2. Datenbank: Schema leeren, Dump einspielen
docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /volume1/docker/familytree/backups/db_2026-11-16_030000.sql.gz \
  | docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 -q

# 3. Bilder zurückkopieren — ergänzend (vorhandene neuere Dateien bleiben,
#    sie sind nur verwaist und schaden nicht). Besitzer egal, siehe 4.
cp -a /volume1/restore/familytree/media/. /volume1/docker/familytree/media/

# 4. Wieder starten — Portainer: Stacks → familytree → "Update the stack".
#    Das lässt media-init laufen (übereignet die zurückkopierten Dateien an
#    die App), sichert den eingespielten Stand und startet die App, die ggf.
#    neuere Migrationen anwendet. Ohne Portainer:
#    docker start -a familytree-media-init-1 && docker start familytree-app-1
```

Danach `curl http://127.0.0.1:3080/api/health` → `{"status":"ok"}` und
einige Personen mit Bildern ansehen. Ist der Dump älter als der aktuelle
Programmstand, holt die App beim Start die fehlenden Migrationen nach
(Log von `app`).
