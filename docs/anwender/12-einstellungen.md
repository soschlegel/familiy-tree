# Einstellungen

Für Administratoren: Einstellungen dieser Installation in der App pflegen — welche es gibt, welcher Wert gerade gilt und woher er kommt.

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
