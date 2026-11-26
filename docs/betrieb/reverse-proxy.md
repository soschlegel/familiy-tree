# Reverse-Proxy

Die App lauscht auf `127.0.0.1:3080` (änderbar: `APP_PORT`, `APP_BIND`).
Für den Proxy wichtig:

| Punkt | Einstellung |
|---|---|
| Ziel | `http://127.0.0.1:3080` (bzw. LAN-IP der NAS, siehe NPM) |
| Upload-Größe | Bilder bis 15 MB (`MAX_UPLOAD_BYTES`), ZIP-Importe unter *Daten* (`/admin/data`) deutlich mehr — Limit mindestens 20 MB, besser 1 GB |
| Zeitlimit | großer ZIP-Import kann über 60 s dauern — Lese-Timeout 300 s |
| Header | `Host` unverändert durchreichen; `Authorization` durchreichen (KI-Zugang; tun alle drei unten ohne Zutun); `X-Forwarded-For` mit der Adresse des Clients **anhängen** — daran hängt die Sperre nach Fehlversuchen am KI-Zugang. Fehlt der Header, teilen sich alle KI-Clients eine Sperre |
| WebSocket, SSE | nicht nötig (auch nicht für den KI-Zugang) |
| Erreichbarkeit | die App nur über den Proxy: `APP_BIND` nie auf `0.0.0.0` — wer die App direkt erreicht, kann `X-Forwarded-For` selbst setzen |

**Synology (DSM 7)** — Systemsteuerung → Anmeldeportal → Erweitert →
Reverse Proxy → Erstellen:

- *Quelle:* Protokoll `HTTPS`, Hostname `stammbaum.example.de`, Port `443`
  (oder `HTTP`/`80`, wenn `PUBLIC_URL` mit `http://` beginnt)
- *Ziel:* Protokoll `HTTP`, Hostname `localhost`, Port `3080`
- Zertifikat: Systemsteuerung → Sicherheit → Zertifikat → *Einstellungen* —
  dem neuen Eintrag ein Zertifikat zuweisen. Let's Encrypt über DSM braucht
  Erreichbarkeit von außen; ohne Portfreigabe ein Zertifikat per DNS-Challenge
  besorgen und importieren (oder NPM nehmen, s.u.).

DSM reicht den `Host`-Header nach bisheriger Erfahrung durch. Das
Upload-Limit lässt sich in der DSM-Oberfläche nicht einstellen — nach dem
Einrichten ein Bild mit ~15 MB hochladen. Kommt „413 Request Entity Too
Large“, ist der DSM-Proxy für diese App ungeeignet; dann Nginx Proxy Manager
oder das Caddy-Profil verwenden. (Nicht auf einer Synology ausprobiert.)

`X-Forwarded-For` setzen DSM, NPM und Caddy nach ihrer Standardkonfiguration
selbst; auf der NAS ist das nicht geprüft. Prüfen lässt es sich mit einem
absichtlich falschen KI-Schlüssel von einem anderen Gerät aus: `docker logs
familytree-app-1 2>&1 | grep mcp-http` muss bei `Absender` die Adresse dieses
Geräts zeigen, nicht `127.0.0.1` oder die des Proxys.

**Nginx Proxy Manager** — läuft meist selbst in einem Container; dort zeigt
`127.0.0.1` auf NPM selbst. Deshalb im Stack `APP_BIND` auf die LAN-IP der NAS
setzen (z.B. `192.168.178.10`) und in NPM *Hosts → Proxy Hosts → Add Proxy
Host*:

- *Domain Names:* `stammbaum.example.de`; *Scheme:* `http`; *Forward
  Hostname/IP:* LAN-IP der NAS; *Forward Port:* `3080`; *Websockets
  Support:* aus
- *SSL:* Zertifikat; ohne Erreichbarkeit von außen *Use a DNS Challenge*
  (API-Token des DNS-Anbieters)
- *Advanced → Custom Nginx Configuration:*

  ```nginx
  client_max_body_size 1g;
  proxy_read_timeout 300s;
  ```

NPM reicht `Host` und `X-Forwarded-*` von sich aus durch.

**Ohne vorhandenen Proxy:** Stack-Variable `COMPOSE_PROFILES=caddy` startet
Caddy mit inline hinterlegter Konfiguration (kein Bind-Mount aus dem Repo).
Standard: HTTPS mit Caddys eigener Zertifizierungsstelle (`tls internal`) auf
Port `8443`, HTTP auf `8080`; einstellbar über `CADDY_SITE` (Hostname),
`CADDY_HTTPS_PORT`, `CADDY_HTTP_PORT`, `CADDY_BIND`, `CADDY_MAX_BODY` und
`CADDY_TLS` (`internal` oder eine E-Mail für Let's Encrypt — nur bei
öffentlicher Erreichbarkeit). `PUBLIC_URL` dann z.B.
`https://stammbaum.fritz.box:8443`. Der Browser warnt, bis das Stammzertifikat
aus `${DATA_ROOT}/caddy/data/caddy/pki/authorities/local/root.crt` auf den
Geräten importiert ist. Ob Portainer `COMPOSE_PROFILES` aus den
Stack-Variablen an Compose weitergibt, ist nicht auf der NAS geprüft (Docker
Compose selbst liest die Variable aus der Env-Datei, die Portainer übergibt);
erscheint kein `proxy`-Container, liegt es daran.
