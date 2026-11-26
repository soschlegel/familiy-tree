# Fehlersuche

Logs: Portainer → *Stacks → familytree* → Container → *Logs*, oder auf der
NAS `docker logs familytree-app-1` (bzw. `-backup-db-1`, `-media-init-1`, …).
Die Ausgabe der Migrationen steht im Log von **`app`**, vor dem Serverstart
(Zeilen mit `[start]` und die Meldungen von Prisma).

| Symptom | Ursache / Abhilfe |
|---|---|
| Deploy bricht ab mit „… fehlt“ | Pflichtvariable nicht gesetzt (Meldung nennt sie) |
| „pull access denied“ / „denied“ / „unauthorized“ für `ghcr.io/…` | Paket noch privat ([Erste Installation](nas-portainer.md#erste-installation), Schritt 2) oder der Workflow ist noch nie gelaufen; bei bewusst privatem Paket Token falsch oder abgelaufen ([docs/dev-history.md](../dev-history.md#privates-image-mit-registry-zugang-bis-19112026)) |
| Portainer findet `refs/heads/deploy` nicht | Workflow auf `main` noch nie erfolgreich durchgelaufen |
| `app` „restarting“, Log `[start] FEHLER: Eine Migration ist fehlgeschlagen …` | → [Fehlgeschlagene Migration](#fehlgeschlagene-migration) |
| `app` „restarting“, Log `[start] FEHLER: Die Datenbank enthält bereits Tabellen, aber keine Migrationshistorie` | Datenbank stammt aus einer `db push`-Installation → Baselining, siehe [Schema und Migrationen](migrationen.md) |
| `app` „restarting“, Log `[start] FEHLER: Datenbank nach 60s nicht erreichbar` | `db` läuft nicht, oder die Zugangsdaten passen nicht zur Datenbank (`POSTGRES_PASSWORD` nach der Ersteinrichtung geändert — Postgres übernimmt es nur beim allerersten Start) |
| `app` startet nicht, `backup-db` Exit ≠ 0 | Sicherung fehlgeschlagen (Platz, Rechte auf `backups/`) — App und Migration starten absichtlich nicht ohne Sicherung |
| `db` startet nicht: „invalid permissions“ / „Operation not permitted“ | Rechte von `postgres/` verändert (File Station/ACL). Bei Neuinstallation den leeren Ordner löschen und neu deployen; sonst per SSH `chown -R 70:70` und `chmod 700` darauf |
| `app` startet nicht, `media-init` Exit ≠ 0, Log „FEHLER: Die App (uid 1001) kann nicht … schreiben“ | ACLs des gemeinsamen Ordners verhindern das Schreiben trotz Besitzer 1001 → [Bilderordner nicht beschreibbar](#bilderordner-nicht-beschreibbar) |
| `app` „unhealthy“, `/api/health` → `{"status":"error"}` (503) | Datenbank nicht erreichbar **oder** `media/`, `media/originals/` bzw. `media/thumbs/` nicht beschreibbar (z.B. Rechte nachträglich in der File Station geändert, oder nach einer Wiederherstellung gehören die Unterordner root). Welches, steht in `docker logs familytree-app-1` (`[health] Medienordner: … /data/media/originals nicht beschreibbar (EACCES)`). Für `media/`: Stack neu starten (`media-init` repariert Besitzer), sonst [Bilderordner nicht beschreibbar](#bilderordner-nicht-beschreibbar) |
| Einzelne Bilder fehlen (kaputtes Bildsymbol), `/api/media/…` antwortet 404 | Datei fehlt in `media/`, der Datenbankeintrag existiert aber — typisch nach einer Wiederherstellung, bei der `media/` älter ist als der Dump ([Wiederherstellung](sicherung.md#wiederherstellung)). Datei aus einer neueren NAS-Sicherung zurückholen oder das Bild in der App löschen und neu hochladen |
| Anmeldung: GitHub „redirect_uri is not associated“ / Google „redirect_uri_mismatch“ | Callback-URL beim Anbieter ≠ `<PUBLIC_URL>/api/auth/callback/…` (Schema, Port, Schreibweise) |
| Klick auf „Anmelden mit …“ tut nichts, Log „Invalid Server Actions request“ | Proxy reicht `Host` nicht durch |
| Nach der Anmeldung wieder auf `/login` | Seite über eine andere Adresse als `PUBLIC_URL` aufgerufen, oder `https://`-`PUBLIC_URL` über `http://` geöffnet |
| „Anmeldung fehlgeschlagen … nicht freigeschaltet“ | E-Mail des Kontos steht nicht in der Benutzerliste (oder gesperrt); bei falscher OAuth-Konfiguration erscheint dieselbe Meldung — dann das Log von `app` lesen |
| Upload bricht ab, 413 | Upload-Limit des Proxys (siehe Tabelle oben) |
| Seite bleibt nach einem Update leer, Knöpfe reagieren nicht; Browser-Konsole meldet „Refused to … Content Security Policy“ | Schutzregeln des Browsers blockieren etwas → [Content-Security-Policy](#content-security-policy) |
| Port 3080 belegt | `APP_PORT` ändern und im Proxy anpassen |

## Content-Security-Policy

Die App schickt mit jeder Seite eine Content-Security-Policy: Der Browser
führt nur die Skripte der App selbst aus (mit einer Nonce, die für jede
Antwort neu ist) und lädt nichts von fremden Adressen
([Richtlinie und Begründung](../sicherheit.md#content-security-policy)).
Blockiert sie nach einem Update etwas, das gebraucht wird, lässt sie sich
**ohne neues Image** zurückschalten:

1. In Portainer unter den Stack-Variablen `CSP_MODE=report-only` setzen
   (nichts wird blockiert, Verstöße erscheinen nur in der Browser-Konsole,
   F12 → Konsole, mit „[Report Only]“) — oder im Notfall `CSP_MODE=off`
   (keine Richtlinie).
2. Stack aktualisieren (*Update the stack*, kein *Pull* nötig); der
   App-Container startet mit der neuen Einstellung.
3. Prüfen: In den Entwicklerwerkzeugen des Browsers (Netzwerk → eine Seite
   → Antwort-Header) steht dann `Content-Security-Policy-Report-Only` statt
   `Content-Security-Policy` bzw. keines von beiden.
4. Meldungen aus der Konsole als Fehler weitergeben; nach der Korrektur die
   Variable wieder entfernen (Standard `enforce`).

Die Variable wirkt nur auf die Seiten. Die feste Richtlinie der API
(`/api/…`: JSON, Bilder, Downloads) steht im Image und bleibt.

Ein zweiter Grund für dieselben Symptome: Der Reverse-Proxy setzt eine
eigene `Content-Security-Policy` ([Reverse-Proxy](reverse-proxy.md)) —
dann zeigt die Antwort zwei solche Kopfzeilen. Die des Proxys entfernen.

## Fehlgeschlagene Migration

Scheitert `prisma migrate deploy`, beendet sich der App-Container mit
Code 1, **bevor** der Server startet; das Log zeigt Prismas Meldung (z.B.
`Error: P3018 … Migration name: …`, darunter der Datenbankfehler) und einen
Block `[start] FEHLER: …`. Docker startet den Container wegen
`restart: unless-stopped` neu, mit wachsender Pause bis etwa einer Minute
(lokal: nach zwei Minuten 11 Versuche, danach einer pro Minute). Das ist
gewollt billig und ungefährlich: Prisma vermerkt die Migration als
fehlgeschlagen und spielt bei den weiteren Versuchen **nichts** mehr ein
(`Error: P3009`), bis sie freigegeben wird. Die App ist so lange nicht
erreichbar (der Proxy meldet 502). Wer die Schleife anhalten will:
`docker stop familytree-app-1`.

Prisma führt eine Migration in PostgreSQL als Ganzes aus; scheitert eine
Anweisung, wird der Rest der Datei zurückgenommen (lokal nachgeprüft: eine
im selben Skript angelegte Tabelle war danach nicht vorhanden). Vorgehen:

1. App anhalten: `docker stop familytree-app-1`, Ursache im Log verstehen.
2. Nur falls die Migration doch etwas verändert hat: die Sicherung vom
   Stack-Start einspielen ([Wiederherstellung](sicherung.md#wiederherstellung), Schritte
   1–2; sie ist der neueste Dump in `backups/`).
3. Die Migration als zurückgenommen markieren (Name aus dem Log):
   ```sh
   docker run --rm --network familytree_default -e RUN_MIGRATIONS=false \
     -e DATABASE_URL='postgresql://familytree:<POSTGRES_PASSWORD>@db:5432/familytree' \
     ghcr.io/soschlegel/familiy-tree:latest \
     prisma migrate resolve --rolled-back <Migrationsname>
   ```
4. Ein Image mit korrigierter Migration bereitstellen (Push auf `main`) —
   oder per `IMAGE_TAG` auf das vorige Image zurückgehen — und
   *Pull and redeploy*.

## Start ohne Migrationen (RUN_MIGRATIONS=false)

Nur zur Fehlersuche: Stack-Variable `RUN_MIGRATIONS=false` setzen und den
Stack aktualisieren. Der App-Container überspringt dann das Warten auf die
Datenbank, `migrate deploy` und den Admin-Abgleich (Log: `[start]
RUN_MIGRATIONS=false — … übersprungen.`) und startet sofort den Server — auf
eigene Gefahr, wenn das Schema nicht zum Image passt. Variable danach wieder
entfernen. Für einzelne Prisma-Befehle braucht es den Schalter im Stack
nicht: ein Einmal-Container wie oben (`docker run … -e RUN_MIGRATIONS=false
<image> prisma …`) führt nur den angegebenen Befehl aus, und
`docker exec familytree-app-1 prisma migrate status` zeigt im laufenden
Container den Stand.

## Bilderordner nicht beschreibbar

`media-init` übereignet `media/` an UID 1001 und testet dann, ob die App
dort eine Datei anlegen kann. Scheitert der Test trotzdem, entscheiden
nicht die Unix-Rechte, sondern Windows-artige ACLs des gemeinsamen Ordners
(Synology: File Station → *Eigenschaften → Berechtigung*). UID 1001 ist kein
DSM-Benutzer und lässt sich dort nicht auswählen. Abhilfe per SSH als root
(Stack vorher anhalten; Pfad anpassen; nicht auf einer Synology
ausprobiert):

```sh
M=/volume1/docker/familytree/media
synoacltool -get "$M"          # zeigt die ACL; "Linux mode" = keine ACL
synoacltool -del "$M"          # ACL nur von media/ entfernen
chown -R 1001:1001 "$M"
chmod -R u+rwX "$M"
```

Danach *Update the stack*; `media-init` muss „Bilderordner bereit“ melden.
`synoacltool -del` wirkt nur auf `media/`; bereits vorhandene Dateien darin
mit eigener ACL ggf. einzeln (`find "$M" -exec synoacltool -del {} \;`).
Die gröbere Alternative in der File Station: für `media/` der Gruppe
*Everyone* Lesen/Schreiben geben (*auf diesen Ordner, Unterordner und
Dateien anwenden*). Auf einem Netzlaufwerk, das `chown` verweigert (NFS mit
`root_squash`, SMB), muss `media/` stattdessen auf dem Server UID 1001
gehören oder für alle beschreibbar sein.
