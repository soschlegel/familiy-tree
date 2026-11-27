# Einstellungen

Für Administratoren: Einstellungen dieser Installation in der App pflegen — welche es gibt, welcher Wert gerade gilt und woher er kommt. Dazu die Zeitgeschichte: welche allgemeinen Ereignisse die App zeigt.

## Wozu die Seite da ist

Manche Angaben gelten für die ganze Installation, zum Beispiel die Adresse, unter der Claude den Stammbaum über den Connector erreicht. Früher ließen sie sich nur in der Server-Konfiguration ändern. Unter **Verwaltung → Einstellungen** kann ein **Administrator** sie jetzt direkt in der App setzen. Andere Benutzer sehen den Menüpunkt nicht.

> **Keine Geheimnisse:** Hier stehen nur Angaben, die jeder sehen darf. Passwörter, Zugangsschlüssel und Ähnliches bleiben in der Server-Konfiguration — die App bietet dafür bewusst keine Einstellung an.

## Welcher Wert gilt

Die Seite zeigt unter **Übersicht** jede Einstellung mit Erklärung, dem **wirksamen Wert** und seiner Herkunft:

- **in der App gesetzt** — der Wert, den ein Administrator hier eingetragen hat. Er hat Vorrang.
- **aus der Server-Konfiguration** — in der App ist nichts gesetzt; es gilt der Wert, mit dem der Server eingerichtet wurde.
- **nicht gesetzt** — weder hier noch in der Server-Konfiguration gibt es einen Wert.

Darunter steht, was die Server-Konfiguration enthält. So siehst du vorher, was nach dem Entfernen eines Werts gelten würde.

## Einen Wert setzen, ändern oder entfernen

1. Unter **Einstellung hinzufügen** die **Einstellung** aus der Liste wählen. Dort stehen nur Einstellungen, die in der App noch keinen Wert haben; sind alle gesetzt, sagt die Seite das.
2. Den **Wert** eintragen und **Anlegen** wählen. Die App prüft ihn: Eine Adresse muss vollständig sein und mit `https://` (oder `http://`) beginnen, zum Beispiel `https://mcp.example.de/stammbaum`. Passt etwas nicht, steht der Hinweis direkt unter dem Feld.
3. Zum Ändern bei der Einstellung **Ändern** wählen, den **Neuen Wert** eintragen und **Speichern**.
4. **Entfernen** löscht den Wert aus der App. Danach gilt wieder der Wert aus der Server-Konfiguration — oder keiner. Vorher fragt die App nach und nennt, was danach gilt.

Jede Änderung steht in der [Änderungsgeschichte](09-aenderungen.md) unter **Verwaltung → Änderungen**, mit Benutzer und dem Wert vorher und nachher.

## Die Einstellungen im Einzelnen

| Einstellung | Wozu | Wo sie wirkt |
|---|---|---|
| **Adresse des KI-Connectors** | Adresse, die man auf claude.ai beim Einrichten des Connectors „Stammbaum“ einträgt | Seite **KI-Zugang**, Anleitung „Claude auf dem Handy“ (siehe [KI-Zugang](10-ki-zugang.md#claude-auf-dem-handy-im-browser-und-in-claude-desktop)) |

## Zeitgeschichte

Die App zeigt neben der Familiengeschichte, was in der Zeit allgemein geschah — Kriege, Seuchen, Auswanderungswellen, politische Einschnitte. Du siehst diese Ereignisse an drei Stellen:

- im **Zeitstrahl** des Stammbaums als Marken an der Jahresachse (siehe [Zeitgeschichte im Zeitstrahl](04-stammbaum.md#zeitgeschichte-im-zeitstrahl)),
- in der **Zeitreise** der Karte als Zeile zum gewählten Jahr (siehe [Zeitgeschichte in der Zeitreise](05-karte.md#zeitgeschichte-in-der-zeitreise)),
- im **Lebenslauf** einer Person als Zeile „In diese Lebenszeit fielen“ (siehe [Zeitgeschichte im Lebenslauf](02-personen.md#zeitgeschichte-im-lebenslauf)).

Überall gilt: Die Ereignisse sind **Hintergrund**, keine Aussage über eine Person. Jeder kann sie mit dem Kästchen **Zeitgeschichte** für sich ausblenden.

### Woher die Ereignisse kommen

- **Mitgeliefert:** eine kurze Liste allgemein bekannter Ereignisse für den deutschsprachigen Raum und Europa, vom Dreißigjährigen Krieg bis zur Wiedervereinigung — nur mit gesicherten Jahreszahlen.
- **Eigene Einträge:** Ereignisse, die ein Administrator ergänzt, zum Beispiel ein Hochwasser oder ein Stadtbrand in der Gegend, aus der die Familie stammt.
- **Von der KI ergänzt:** Ein Administrator kann auch den [KI-Assistenten](10-ki-zugang.md#zeitgeschichte-ergaenzen-lassen) bitten, Ereignisse aus den Gegenden und Zeiten der Vorfahren zu ergänzen (siehe [Einträge der KI](#eintraege-der-ki)).

Alle Benutzer sehen dieselben Ereignisse. Hat die KI einen Eintrag ergänzt und noch kein Administrator ihn geprüft, steht dahinter überall der Vermerk **von KI, ungeprüft**. Nach dem Bestätigen verschwindet er.

### Zeitgeschichte verwalten

Unter **Verwaltung → Zeitgeschichte** pflegt ein **Administrator** die Liste. Andere Benutzer sehen den Menüpunkt nicht.

1. **Eigenes Ereignis anlegen:** Unter **Ereignis hinzufügen** den **Titel**, das **Jahr von**, bei einem Zeitraum das **Jahr bis**, die **Art** (Krieg, Politik, Seuche/Not, Wanderung, Sonstiges) und, wenn du magst, eine **Beschreibung** in einem Satz eintragen. Unter **Gilt für Region/Ort** kannst du festhalten, wo das Ereignis spielte (z.B. „Beispieltal“) — das steht dann als Zusatz dabei. Mit Wohnorten der Personen vergleicht die App das nicht. **Anlegen** speichert. Passt etwas nicht (Jahr in der Zukunft, „bis“ vor „von“), steht der Hinweis direkt am Feld.
2. **Ändern** öffnet das Ereignis zum Bearbeiten, **Speichern** übernimmt die Änderung.
3. **Löschen** entfernt ein eigenes Ereignis nach einer Rückfrage.
4. **Mitgelieferte Ereignisse** lassen sich nicht ändern oder löschen, aber **ausblenden** — etwa, wenn ein Ereignis nicht zu deiner Familie passt. Es verschwindet dann für alle Benutzer; **Einblenden** holt es zurück.

> **Keine Namen aus dem Stammbaum:** Trage hier nur allgemeine Geschichte ein, die jeder sehen darf — nicht „Onkel Karl wandert aus“. Solche Angaben gehören als Lebensereignis zur Person.

Jede Änderung steht in der [Änderungsgeschichte](09-aenderungen.md) unter **Verwaltung → Änderungen**.

### Einträge der KI

Einträge, die der KI-Assistent ergänzt hat, sind sofort für alle sichtbar — im Zeitstrahl, in der Zeitreise und im Lebenslauf aber mit dem Vermerk **von KI, ungeprüft**, bis du sie geprüft hast. Unter **Eigene Ereignisse** erkennst du sie so:

- Die Plakette **von KI** (bzw. **von KI geändert**, wenn die KI einen von Hand angelegten Eintrag geändert hat) und, solange niemand sie geprüft hat, **ungeprüft**.
- Darunter die **Begründung der KI** — woher die Jahreszahl stammt — und, falls angegeben, die **Quelle** als Link.
- Neben der Überschrift steht, wie viele Einträge noch ungeprüft sind.

So prüfst du sie:

1. Setze das Häkchen **Nur unbestätigte** — dann siehst du nur die Einträge, die noch offen sind.
2. Lies Titel, Jahre und Begründung; öffne bei Bedarf die Quelle.
3. Passt alles, klicke beim Eintrag **Bestätigen**. Passt etwas nicht, korrigiere es mit **Ändern** — **Speichern** bestätigt ihn dann gleich mit. Ist der Eintrag falsch, **Löschen**.
4. Mit **Alle sichtbaren bestätigen** bestätigst du nach einer Rückfrage alle gerade angezeigten unbestätigten Einträge auf einmal — am besten erst, nachdem du sie durchgesehen hast.

Bestätigte Einträge zeigen „Bestätigt am …“ und erscheinen überall ohne Vermerk. Ändert die KI einen Eintrag später, ist er wieder ungeprüft. Die KI kann selbst nichts bestätigen und nur eigene, noch ungeprüfte Einträge löschen.

Solange ein Eintrag der KI ungeprüft ist, gilt er als Ergänzung: Unter dem Lebenslauf steht er hinter den großen Ereignissen, oft erst unter „weitere Ereignisse“. Nach dem Bestätigen rückt er wie deine eigenen Einträge nach vorn.
