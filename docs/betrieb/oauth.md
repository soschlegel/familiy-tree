# Anmeldung (OAuth)

## Anmeldung (OAuth) im Heimnetz

OAuth funktioniert auch ohne öffentlich erreichbare Instanz. Beim
Authorization-Code-Verfahren schickt der Anbieter den **Browser** zurück an
die Callback-URL; GitHub/Google rufen die NAS nie selbst auf. Die NAS braucht
nur **ausgehenden** Internetzugang (Token-Abruf bei `github.com` bzw.
`oauth2.googleapis.com`). Eine Portweiterleitung ist nicht nötig.

Regeln für die Adresse:

- `PUBLIC_URL` ist **genau** die Adresse, die im Browser eingegeben wird
  (Schema, Host, ggf. Port). Daraus bildet die App die Callback-URL
  `<PUBLIC_URL>/api/auth/callback/<anbieter>` und entscheidet über die
  Cookies. Nur über diese Adresse anmelden — nicht parallel über IP:Port.
- **GitHub** (Settings → Developer settings → OAuth Apps): akzeptiert laut
  Doku jede Callback-URL und prüft sie nur auf exakte Übereinstimmung — auch
  `http://` und interne Namen wie `http://nas.fritz.box:3080`.
- **Google** (Cloud Console → APIs & Services → Credentials → OAuth client
  ID, Typ Web): Redirect-URIs müssen laut Doku **HTTPS** verwenden, dürfen
  **keine IP-Adresse** sein und müssen auf einer Endung der Public Suffix
  List enden (Ausnahme nur `localhost`). Interne Endungen wie `.local`,
  `.lan`, `.home` oder `.internal` scheiden damit aus. Für Google also eine
  eigene Domain (z.B. `stammbaum.example.de`, per DNS auf die private
  NAS-IP) mit HTTPS am Reverse-Proxy. Der Zustimmungsbildschirm darf im
  Status „Testing“ bleiben; dann die Familienmitglieder als Testnutzer
  eintragen.

Beides ist aus der Anbieter-Dokumentation abgeleitet (Stand 11/2026), nicht
auf dieser NAS ausprobiert — beim ersten Deploy einmal durchspielen.

**HTTP oder HTTPS:**

- `PUBLIC_URL=http://…` — Cookies ohne `Secure`-Flag, funktioniert im LAN.
  Das Sitzungs-Cookie geht dann unverschlüsselt durchs Heimnetz; nur mit
  GitHub möglich.
- `PUBLIC_URL=https://…` — Cookies mit `Secure` und `__Secure-`-Präfix. TLS
  endet am Reverse-Proxy, die App selbst spricht HTTP. Das passt, weil
  Auth.js Schema und Host aus `AUTH_URL` (= `PUBLIC_URL`) nimmt und nicht aus
  der Anfrage; `AUTH_TRUST_HOST=true` setzt der Stack.
- Der Proxy muss den ursprünglichen `Host`-Header durchreichen (oder
  `X-Forwarded-Host` setzen). Next.js vergleicht bei Formular-Aktionen — auch
  beim Klick auf „Anmelden mit …“ — `Origin` mit dem Host; passt das nicht,
  passiert beim Klick nichts bzw. das Log zeigt „Invalid Server Actions
  request“.

## OAuth lokal einrichten

Beide Anbieter erlauben `localhost` als Callback — echtes Testen geht also
ohne Deployment:

- **GitHub** — Settings → Developer settings → OAuth Apps → New.
  Callback: `http://localhost:3000/api/auth/callback/github`
- **Google** — Cloud Console → Credentials → OAuth client ID (Web).
  Redirect URI: `http://localhost:3000/api/auth/callback/google`

Client-ID und Secret in die `.env` eintragen, `npm run dev` neu starten.
