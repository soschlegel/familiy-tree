# Betrieb auf der NAS (Portainer)

Gedacht für eine NAS (x86-64) mit Portainer, hinter dem Reverse-Proxy, der
auf der NAS ohnehin läuft (Synology-Reverse-Proxy oder Nginx Proxy Manager).
Die App kann **nur im Heimnetz bzw. über VPN** oder **aus dem Internet**
erreichbar sein; für den zweiten Fall gelten zusätzlich die Hinweise in
[reverse-proxy.md](reverse-proxy.md) und [../sicherheit.md](../sicherheit.md).

```
git push (main)
   └─ GitHub Actions (.github/workflows/images.yml)
        ├─ prüft: Typen, Lint, Unit-Tests
        ├─ baut EIN Image und lädt es nach ghcr.io (öffentliches Paket):
        │    ghcr.io/soschlegel/familiy-tree   (App samt Migrationen)
        └─ setzt Branch "deploy" auf diesen Commit
Portainer (beobachtet "deploy") ─ lädt das Image ─ startet den Stack neu
```

Auf der NAS wird nichts gebaut, und der Stack braucht keine Dateien aus dem
Repository außer `docker-compose.yml` selbst. Das App-Image wendet beim
Start selbst die Migrationen an und stellt den Administrator sicher
([docker/entrypoint.sh](../../docker/entrypoint.sh)), erst danach startet der
Server. Die übrigen Images (`postgres:17-alpine`, optional `caddy`) kommen
unverändert von Docker Hub.

**Dienste** ([docker-compose.yml](../../docker-compose.yml)):

| Dienst | Aufgabe |
|---|---|
| `db` | PostgreSQL 17, kein Port nach außen |
| `media-init` | legt den Bilderordner `media/` an, übergibt ihn der App (uid 1001) und prüft, dass sie schreiben kann; beendet sich |
| `backup-db` | Datenbank-Dump nach `backups/` — bei jedem Stack-Start **vor** dem App-Container (und damit vor der Migration), und auf Abruf |
| `app` | startet erst nach erfolgreichem `media-init` und `backup-db`; wendet dann die Migrationen an (`prisma migrate deploy`), legt `INITIAL_ADMIN_EMAIL` als Admin an und startet den Server — schlägt das fehl, beendet sie sich, statt auf halbem Schema zu laufen. Bilder in `media/`; Port `127.0.0.1:3080` für den Proxy |
| `proxy` | *optional* (Profil `caddy`): eigener Reverse-Proxy, falls keiner vorhanden ist |

Der KI-Zugang braucht keinen eigenen Dienst und keinen zusätzlichen Port: er
läuft in der App unter `/api/mcp` ([KI-Zugang](ki-zugang.md)).

Alle Daten liegen als Bind-Mounts unter **einem** Pfad — genau dieses
Verzeichnis muss die NAS-Sicherung erfassen:

```
${DATA_ROOT}/              z.B. /volume1/docker/familytree
├── postgres/     Datenbank (gehört UID 70, Rechte 0700 — nicht ändern)
├── media/        Bilder als gewöhnliche Dateien (gehört UID 1001)
│   ├── originals/    Originale
│   └── thumbs/       Vorschauen
├── backups/      db_<Datum>_<Zeit>.sql.gz
└── caddy/        nur mit Profil caddy: Zertifikate
```

Die Dateinamen unter `media/` sind die Schlüssel aus der Datenbank. Ein
Datenbank-Dump plus eine Kopie von `media/` ist deshalb eine vollständige
Sicherung ([Sicherung](sicherung.md)).

Die Unterordner legt Docker beim ersten Start selbst an; vorher muss nur der
gemeinsame Ordner (bei Synology meist `docker`) existieren. Besitzer und
Rechte richten die Container selbst ein:

- `postgres/` — der Postgres-Container (UID 70, `0700`).
- `media/` — der Einmal-Dienst `media-init`. Docker legt fehlende Ordner als
  root an; die App läuft aber bewusst nicht als root, sondern als UID 1001.
  `media-init` (läuft als root, aus dem ohnehin geladenen Postgres-Image)
  übereignet deshalb bei jedem Start alles in `media/`, was nicht UID 1001
  gehört — beim ersten Start den leeren Ordner, nach einer Wiederherstellung
  die zurückkopierten Dateien, sonst nichts — und prüft mit einer
  Testdatei, dass die App dort schreiben kann. Klappt das nicht, bricht er
  mit Hinweis ab und die App startet nicht (siehe
  [Fehlersuche](fehlersuche.md), Bilderordner).
- `backups/`, `caddy/` — Container, die als root laufen; nichts zu tun.

Danach in der File Station **keine** Berechtigungen auf diese Unterordner
anwenden (insbesondere nicht „auf Unterordner und Dateien anwenden“) — sonst
startet die Datenbank nicht mehr („data directory has invalid permissions“)
oder die App kann keine Bilder mehr speichern. Auf einer Synology ist das
nicht ausprobiert.

## Erste Installation

Voraussetzungen: Portainer CE 2.19 oder neuer (Git-Stacks mit
Umgebungsvariablen und Docker Compose v2), ausgehender Internetzugang der NAS
(Images laden, OAuth-Anmeldung).

1. **Image bauen lassen.** Auf `main` pushen (oder unter *Actions → Images →
   Run workflow* von Hand starten) und warten, bis der Lauf grün ist (ca.
   5–10 min). Danach gibt es den Branch `deploy` und das Paket
   `familiy-tree` (GitHub → Profil → *Packages*).
2. **Paket öffentlich machen (einmalig).** Neue Pakete auf ghcr.io sind
   privat, auch bei öffentlichem Repository. GitHub → Profil → *Packages* →
   `familiy-tree` → *Package settings* → *Danger Zone* → *Change
   visibility* → *Public* → Paketnamen bestätigen. Das lässt sich **nicht
   rückgängig machen** — GitHub erlaubt nicht, ein öffentliches Paket wieder
   privat zu stellen. Unbedenklich, weil das Image nichts enthält, was nicht
   ohnehin im öffentlichen Repository steht: gebauter Code, Schema,
   Migrationen, Prisma-CLI; keine `.env`, keine Schlüssel (Geheimnisse
   kommen erst zur Laufzeit über die Stack-Variablen). Danach lädt Portainer
   das Image ohne Anmeldung; eine Registry muss dort nicht eingetragen
   werden.

   Wer das Paket lieber privat hält, findet den früheren Weg mit
   Registry-Zugang in [docs/dev-history.md](../dev-history.md#privates-image-mit-registry-zugang-bis-19112026).
3. **Adresse festlegen.** Unter welcher Adresse die Familie den Stammbaum
   aufruft, z.B. `https://stammbaum.example.de` — das wird `PUBLIC_URL`.
   Der Name muss im Heimnetz (und im VPN) auf die NAS zeigen: lokaler
   DNS-Eintrag im Router/Pi-hole oder ein öffentlicher DNS-Eintrag, der auf
   die **private** IP der NAS zeigt. Welche Adressen OAuth akzeptiert, steht
   unter [Anmeldung (OAuth) im Heimnetz](oauth.md#anmeldung-oauth-im-heimnetz).
4. **OAuth-App anlegen** (GitHub und/oder Google) mit der Callback-URL
   `<PUBLIC_URL>/api/auth/callback/github` bzw. `…/google`.
5. **Stack anlegen.** Portainer → *Stacks → Add stack*:
   - *Name:* `familytree` (bestimmt die Containernamen, z.B.
     `familytree-app-1` — die Befehle in diesem Abschnitt gehen davon aus)
   - *Build method:* **Repository**
   - *Repository URL:* `https://github.com/soschlegel/familiy-tree`
   - *Repository reference:* `refs/heads/deploy`
   - *Compose path:* `docker-compose.yml`
   - *Authentication:* aus (öffentliches Repository)
   - *GitOps updates:* an — *Mechanism* **Polling**, *Fetch interval* `5m`;
     **Re-pull image** an; *Force redeployment* aus (siehe
     [Updates](#updates))
   - *Environment variables:* *Advanced mode* → Inhalt von
     [stack.env.example](../../stack.env.example) einfügen und die Werte ausfüllen.
     Pflicht: `DATA_ROOT`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `PUBLIC_URL`,
     `INITIAL_ADMIN_EMAIL` und mindestens ein OAuth-Paar. Nur zwei
     Zufallswerte: `POSTGRES_PASSWORD` mit `openssl rand -hex 32` (nur
     Hex-Zeichen, weil es in einer URL steht), `AUTH_SECRET` mit
     `openssl rand -base64 32`.
     `ENABLE_DEV_LOGIN` **nicht** setzen (der Stack schaltet ihn ohnehin ab).
   - *Deploy the stack.*
6. **Start prüfen.** *Stacks → familytree*: `media-init` und `backup-db`
   sind „exited“ mit Code 0 (Log: `[media-init] Bilderordner bereit …`);
   `app` steht nach einigen Sekunden auf „healthy“. Im Log von `app` stehen
   beim ersten Start „Applying migration“ für `0_init` und die beiden
   weiteren Migrationen, `[seed-admin] … ist Administrator.` und
   `[start] Datenbank bereit, starte die App.` Auf der NAS:
   `curl http://127.0.0.1:3080/api/health` → `{"status":"ok"}` — das prüft
   Datenbank **und** Schreibrecht auf `media/` samt `originals/` und
   `thumbs/`. `ls -lnd
   /volume1/docker/familytree/media` zeigt den Ordner mit Besitzer `1001`.
7. **Reverse-Proxy einrichten**, siehe [Reverse-Proxy](reverse-proxy.md).
8. **Erste Anmeldung:** `PUBLIC_URL` öffnen, mit dem GitHub-/Google-Konto
   anmelden, dessen E-Mail `INITIAL_ADMIN_EMAIL` ist. Weitere Personen unter
   *Benutzer* (`/admin/users`) eintragen — nur eingetragene E-Mails kommen
   hinein.
9. **Sicherung planen**, siehe [Sicherung](sicherung.md).

## Updates

Mit den Einstellungen aus Schritt 5 läuft ein Update ohne Handgriff:
Push auf `main` → Actions baut und prüft (ca. 5–10 min) → Branch `deploy`
rückt nach → Portainer bemerkt das beim nächsten Abruf (≤ 5 min), lädt die
Image neu (*Re-pull image*) und startet den Stack: `backup-db` → `app`
(Migrationen, dann Server).

**Warum `deploy` statt `main`:** Würde Portainer `main` beobachten, sähe es
den neuen Commit sofort, der Image-Build läuft dann aber noch. Portainer
würde das alte `latest` erneut laden — und erst beim *nächsten* Commit
nachziehen. Schlimmer: eine neue `docker-compose.yml` könnte auf Images
treffen, die es noch nicht gibt. Der Workflow setzt `deploy` erst, wenn alle
Image fertig ist; Compose-Datei und Image passen so immer zusammen.
*Force redeployment* bleibt aus: es würde den Stack bei jedem Abruf neu
starten — und damit jedes Mal eine Sicherung anlegen.
Webhooks scheiden aus, weil GitHub die NAS nicht erreicht.

**Version festhalten / zurückrollen:** Stack-Variable `IMAGE_TAG` setzen und
*Update the stack* mit *Re-pull image*:

| `IMAGE_TAG` | Bedeutung |
|---|---|
| `latest` (Standard) | jeweils der neueste Stand von `main` |
| `sha-1a2b3c4` | genau dieser Commit (die ersten 7 Zeichen, siehe GitHub → Packages) |
| `1.2.0` / `1.2` | ein Release; entsteht durch einen Git-Tag `v1.2.0` |

Achtung beim Zurückrollen über eine Migration hinweg: Die Datenbank behält
das neuere Schema. Bei rein ergänzenden Migrationen läuft die ältere App
weiter; sonst die Sicherung vor dem Update einspielen
([Wiederherstellung](sicherung.md#wiederherstellung)). Zum Zurückkehren `IMAGE_TAG`
wieder auf `latest` setzen.

**Von Hand aktualisieren:** *Stacks → familytree → Pull and redeploy*.

**Was ein Neustart des Stacks tut** (lokal nachgeprüft): Hat sich das
App-Image geändert, hält Compose die alte App **zuerst** an, lässt dann
`media-init` und `backup-db` laufen und startet erst danach den neuen
App-Container, der migriert — eine Migration läuft also nie neben der alten
App und nie ohne frische Sicherung. Ohne neues Image (*Update the stack*
ohne Änderung) laufen die beiden Einmal-Jobs erneut, die App läuft dabei
einfach weiter; migriert wird nichts. Startet nur der App-Container neu
(Absturz, Neustart der NAS), prüft er die Migrationen erneut — mit
demselben Image gibt es dann nichts einzuspielen („No pending migrations to
apply.“, kostet 2–3 s).
