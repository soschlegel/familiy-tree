# KI-Zugang (MCP)

Ein KI-Assistent wie Claude Code oder Claude Desktop kann direkt mit den
Stammbaumdaten arbeiten: Fragen zu Personen und Verwandtschaft beantworten,
Lücken und Widersprüche finden und — wenn freigegeben — Rechercheergebnisse
samt Belegen eintragen. Die App bietet dafür unter `/api/mcp` eine
Schnittstelle nach dem [Model Context Protocol](https://modelcontextprotocol.io)
(MCP). Der Assistent meldet sich dort mit einem **persönlichen Schlüssel** an
und handelt dann **als dieser Benutzer**: Alles läuft über die
[Dienstschicht](../komponenten/dienste.md), Sichtbarkeit nach Familien, Platzhalter für
verborgene Personen („Nicht freigegeben“), Rechteprüfung, Validierung und
Audit-Log gelten genau wie in der Weboberfläche. Einen Zugang an der App
vorbei direkt zur Datenbank gibt es nicht.

Diese Seite beschreibt Einrichtung und Betrieb. **Werkzeuge, Prompts,
Server-Hinweis, Statuscodes und Grenzen der Schnittstelle** stehen in der
Komponenten-Doku [mcp.md](../komponenten/mcp.md), der sichere Abruf von
Bildadressen (`lib/safe-fetch.ts`) in
[bibliotheken.md](../komponenten/bibliotheken.md). Für den Betrieb wichtig:
Bilder kann die KI als base64 schicken (`add_media` mit `data_base64`);
deshalb nimmt `/api/mcp` für Schlüssel mit Schreibstufe Anfragen bis
`MAX_UPLOAD_BYTES` × 4/3 + 1 MiB an (sonst 1 MiB) — der Reverse-Proxy muss
so große Anfragen durchlassen (Nginx: `client_max_body_size`), sonst
antwortet er mit 413.

## Wer darf was

- **Der Administrator vergibt den KI-Zugang je Benutzer** unter *Benutzer*
  (`/admin/users`, Spalte „KI-Zugang“): *kein Zugang* (Standard), *lesen*
  oder *lesen und schreiben*. Die Rolle Administrator schließt ihn **nicht**
  ein — auch der Admin muss ihn sich selbst ausdrücklich geben.
- **Die Familienrechte gelten zusätzlich.** Die KI sieht nur, was der
  Benutzer sieht, und schreibt nur in Familien, die er bearbeiten darf. „Lesen
  und schreiben“ für einen Betrachter erlaubt also trotzdem keine Änderung.
- **Jeder Schlüssel hat eine eigene Stufe** (lesen oder lesen und
  schreiben). Wirksam ist die niedrigere von beiden: Schlüssel „lesen und
  schreiben“ bei einem Benutzer mit KI-Recht „lesen“ wirkt nur lesend.
- **Änderungen wirken sofort.** Rechte, Schlüssel und Sperre werden bei
  jedem einzelnen Aufruf neu geprüft. Herabsetzen auf „lesen“, Entziehen,
  Widerrufen eines Schlüssels oder Sperren des Benutzers greifen beim
  nächsten Aufruf — ohne Neustart von App oder Assistent.
- **Schlüssel verwaltet nur die Weboberfläche**, nie die KI selbst: Anlegen,
  Widerrufen, Löschen und Rechte vergeben gehen über die MCP-Schnittstelle
  nicht.
- **Alles wird protokolliert.** Jede Änderung durch die KI steht im
  Audit-Log unter dem Benutzer, mit Kanal `MCP` und dem verwendeten
  Schlüssel, gebündelt zu Paketen; KI-Notizen tragen zusätzlich
  „KI-Recherche“ und Datum. In der App zeigen der Abschnitt „Änderungen“ der
  Personenseite und `/admin/changes` (Filter Kanal „KI über MCP“) diese
  Änderungen ([Änderungsgeschichte](../fachlich/aenderungsgeschichte.md)). Direkt in der
  Datenbank (auf der NAS, per SSH):

  ```sh
  docker exec familytree-db-1 psql -U familytree -d familytree -c '
    SELECT a."createdAt", a.action, a."entityType", a."entityId", t.prefix, t.name
    FROM "AuditLog" a LEFT JOIN "ApiToken" t ON t.id = a."apiTokenId"
    WHERE a.channel IS NOT NULL ORDER BY a."createdAt" DESC LIMIT 50;'
  ```

Alles, was der Assistent abruft, geht an den jeweiligen KI-Anbieter — bei
lebenden Personen bedenken.

## Einrichten: Schritt für Schritt

1. **Recht geben.** Als Administrator unter *Benutzer* beim eigenen Konto
   „KI-Zugang“ auf *lesen* stellen (für die Recherche genügt das; *lesen und
   schreiben* erst, wenn die KI auch eintragen soll).
2. **Schlüssel anlegen.** In der Navigation erscheint *KI-Zugang*
   (`/ai-access`, jeder Benutzer verwaltet dort seine eigenen Schlüssel).
   Namen vergeben, der sagt, wo der Schlüssel liegt (z.B. „Laptop – Claude
   Code“), Stufe und Gültigkeit wählen (Standard 90, höchstens 365 Tage),
   *Schlüssel anlegen*. Der Schlüssel (`ftk_…`) wird **genau einmal** angezeigt —
   gleich kopieren. Die Seite zeigt dazu die Adresse der Schnittstelle
   (`<PUBLIC_URL>/api/mcp`) und den fertigen Befehl für Claude Code.
3. **Claude Code verbinden** (in einem Terminal, einmal je Rechner):

   ```bash
   claude mcp add --transport http --scope user stammbaum https://stammbaum.example.de/api/mcp --header "Authorization: Bearer ftk_…"
   ```

   `--scope user` macht den Stammbaum in allen Projekten verfügbar. Prüfen:
   `claude mcp list` zeigt `stammbaum: … ✔ Connected`. Der Schlüssel steht
   danach im Klartext in der Benutzerkonfiguration von Claude Code
   (`%USERPROFILE%\.claude.json` unter Windows, `~/.claude.json` sonst) —
   nicht in einem Projektordner, nicht im Repository. Entfernen:
   `claude mcp remove stammbaum --scope user` (löscht ihn aus der Datei);
   danach den Schlüssel in der App widerrufen.
4. **Claude Desktop verbinden** (nur nach Dokumentation, *hier nicht
   getestet*). Claude Desktop spricht MCP-Server mit eigenem Schlüssel über
   die Brücke [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) an
   (braucht Node.js). In `%APPDATA%\Claude\claude_desktop_config.json`
   (Windows) bzw. `~/Library/Application Support/Claude/claude_desktop_config.json`
   (macOS):

   ```json
   {
     "mcpServers": {
       "stammbaum": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote", "https://stammbaum.example.de/api/mcp",
           "--header", "Authorization:${AUTH_HEADER}"
         ],
         "env": { "AUTH_HEADER": "Bearer ftk_…" }
       }
     }
   }
   ```

   Kein Leerzeichen nach `Authorization:` — der Wert kommt aus `env`, weil
   Leerzeichen in `args` unter Windows nicht sicher ankommen. Bei einer
   `http://`-Adresse (nicht `localhost`) zusätzlich `"--allow-http"` an die
   `args` anhängen. Danach Claude Desktop neu starten. Der Schlüssel steht
   im Klartext in dieser Datei; zum Entfernen den Eintrag löschen und den
   Schlüssel widerrufen.
5. **claude.ai im Browser, Claude Desktop und die Claude-App auf dem
   Telefon** verbinden sich über einen „Custom Connector“. Den ruft Anthropic
   aus der Cloud auf (öffentlich per HTTPS auf Port 443 erreichbar nötig) und
   meldet sich per OAuth an, nicht mit einem festen Schlüssel. Dafür steht
   ein **Gateway** (eigenes Repository) vor der App: Beim Verbinden zeigt es
   eine Anmeldeseite, auf der man seinen persönlichen Schlüssel einträgt, und
   reicht ihn als `Authorization: Bearer …` an `/api/mcp` weiter. Ohne
   Gateway, nur im Heimnetz, geht es nicht.

   Die Seite `/ai-access` zeigt dazu eine Schritt-für-Schritt-Anleitung
   (Handy, Browser/Desktop, Claude Code). Die öffentliche Adresse des
   Gateways pflegt ein Administrator unter **Verwaltung → Einstellungen**
   (`/admin/settings`, „Adresse des KI-Connectors“) — nie fest im
   Repository. Ohne Wert dort gilt als Rückfall die Umgebungsvariable
   **`MCP_CONNECTOR_URL`** (Stack, `stack.env.example`); ein Wert in der App
   hat Vorrang. Ist beides leer, verweist die Anleitung auf den
   Administrator. Eingerichtet wird der
   Connector einmal auf claude.ai (Customize → Connectors → „+ Add“ →
   „Add custom connector“); die Handy-App übernimmt ihn danach automatisch.
   Im kostenlosen Claude-Tarif ist nur ein eigener Connector möglich.

## Schlüssel richtig verwenden

- **Ein Schlüssel je Gerät und Zweck** — dann lässt sich einer gezielt
  widerrufen, und die Liste auf `/ai-access` zeigt je Schlüssel, wann er
  zuletzt benutzt wurde. Höchstens 10 aktive Schlüssel je Benutzer.
- **Standardmäßig „lesen“.** Einen Schlüssel „lesen und schreiben“ nur
  anlegen, wenn die KI wirklich eintragen soll.
- **Ablauf:** Schlüssel laufen nach der gewählten Zeit ab (Standard 90 Tage)
  und antworten dann mit 401; dann einen neuen anlegen und im Client
  austauschen (`claude mcp remove …` und neu `add`).
- **Verlauf und Löschen.** Die Liste auf `/ai-access` (und die
  Schlüsselliste eines Benutzers unter *Benutzer*) zeigt standardmäßig nur
  aktive Schlüssel; widerrufene und abgelaufene sind ausgeblendet, ein Zähler
  „N ausgeblendet“ nennt sie. Der Schalter „Widerrufene und abgelaufene
  anzeigen (Verlauf)“ blendet sie zur Ansicht ein (Name, Anfang, Stufe,
  angelegt, zuletzt benutzt, widerrufen bzw. abgelaufen am); er steht in der
  Adresse (`?verlauf=1`) und übersteht so das Neuladen. **Endgültig löschen**
  (mit Rückfrage) lassen sich widerrufene und abgelaufene Schlüssel sowie
  Schlüssel, die noch nie benutzt wurden — bei einem aktiven, unbenutzten ist
  Löschen zugleich Widerruf. Ein aktiver, schon benutzter Schlüssel muss
  zuerst widerrufen werden (die Schnittstelle antwortet sonst mit 409).
  Rechte wie beim Widerrufen: eigene Schlüssel jeder selbst, fremde nur
  Administratoren. Das Löschen steht im Audit-Log (`DELETE`, Name, Anfang,
  Stufe, Daten; bei fremden Schlüsseln der Besitzer) in einem eigenen Paket
  „KI-Schlüssel „…“ gelöscht“. Die Änderungsgeschichte bleibt lesbar:
  Einträge über einen gelöschten Schlüssel zeigen „Schlüssel „…“ (gelöscht)“
  — der Name kommt aus dessen Protokolleintrag —, ohne bekannten Namen
  „Schlüssel (gelöscht)“. Schnittstelle: `DELETE /api/ai-tokens/<id>`
  widerruft, `DELETE /api/ai-tokens/<id>?endgueltig=1` löscht.
- **Schlüssel verraten?** (z.B. in einen Chat, eine Datei im Repository oder
  einen Screenshot geraten): sofort auf `/ai-access` widerrufen — wirkt beim
  nächsten Aufruf. Der Administrator kann unter *Benutzer* über „Schlüssel:
  … aktiv“ jeden Schlüssel widerrufen oder das KI-Recht entziehen. Alle
  Schlüssel beginnen mit `ftk_` und lassen sich so in Dateien suchen
  (`git grep ftk_`, `findstr /s /c:ftk_ *`); die App speichert nur einen
  Hash und schreibt nie den ganzen Schlüssel ins Log, höchstens den Anfang
  `ftk_<12 Zeichen>`, wie er auch in der Schlüsselliste steht.

## Fehlersuche KI-Zugang

| Symptom | Ursache / Abhilfe |
|---|---|
| `claude mcp list`: „Server rejected the configured Authorization header (HTTP 401)“ | Schlüssel abgelaufen, widerrufen, falsch kopiert, oder der Benutzer ist gesperrt. Auf `/ai-access` nachsehen, ggf. neuen Schlüssel anlegen |
| 403 | KI-Recht fehlt oder wurde entzogen — Administrator fragen (*Benutzer*, Spalte „KI-Zugang“) |
| 429 | zu viele Fehlversuche, meist ein Client mit altem Schlüssel in einer Schleife. Den Client korrigieren und 10 Minuten warten |
| 401, obwohl der Schlüssel stimmt; im Browser funktioniert die App | Der Reverse-Proxy reicht den `Authorization`-Header nicht durch — siehe [Reverse-Proxy](reverse-proxy.md) |
| Alle KI-Clients bekommen gleichzeitig 429 | Der Proxy setzt kein `X-Forwarded-For`; dann sieht die App alle Anfragen von derselben Adresse und sperrt alle zusammen |
| Entwicklung: „Missing environment variables: FAMILYTREE_MCP_KEY“ bzw. `familytree-mock` fehlt in `claude mcp list` | Variable vor dem Start von Claude Code setzen (siehe unten) |

## Entwicklung und Tests

Für die Entwicklung läuft alles gegen die [Mock-Daten](../entwicklung/mock-daten.md); die
echte Datenbank bleibt unberührt.

1. `npm run dev:mock` — App gegen `familytree_mock` auf
   `http://localhost:3100`, Schnittstelle unter
   `http://localhost:3100/api/mcp`.
2. Schlüssel setzen. Die Mock-Daten enthalten feste, öffentlich bekannte
   Testschlüssel ([Mock-Daten](../entwicklung/mock-daten.md)); `npm run -s mcp:key [name]` gibt
   einen aus (Standard `editor-read`). In dem Terminal, aus dem Claude Code
   startet:

   ```bash
   export FAMILYTREE_MCP_KEY=$(npm run -s mcp:key)          # Bash
   ```

   ```powershell
   $env:FAMILYTREE_MCP_KEY = npm run -s mcp:key             # PowerShell
   ```

   Die Variable gilt nur für dieses Terminal und alles, was daraus startet.
   Für Claude Code in VS Code also VS Code aus diesem Terminal starten
   (`code .`; nicht eigens ausprobiert).

3. Die Datei [.mcp.json](../../.mcp.json) im Projekt trägt den Server
   `familytree-mock` (`http://localhost:3100/api/mcp`, Header
   `Authorization: Bearer ${FAMILYTREE_MCP_KEY}`) für Claude Code ein. Beim
   ersten Start von `claude` im Projektordner fragt Claude Code, ob es den
   Projekt-Server zulassen soll. Ohne gesetzte Variable lässt Claude Code den
   Server mit der Warnung „Missing environment variables“ weg.
4. Direkt ausprobieren, ohne KI:

   ```bash
   curl -s -X POST http://localhost:3100/api/mcp \
     -H "Authorization: Bearer $FAMILYTREE_MCP_KEY" \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   ```powershell
   (Invoke-RestMethod -Method Post -Uri http://localhost:3100/api/mcp `
     -Headers @{ Authorization = "Bearer $env:FAMILYTREE_MCP_KEY"; Accept = "application/json, text/event-stream" } `
     -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}').result.tools.name
   ```

Den stdio-Server (`npm run -s mcp:stdio`, nur gegen Mock-/Test-Datenbanken)
und die zugehörigen Tests beschreibt [mcp.md](../komponenten/mcp.md).
