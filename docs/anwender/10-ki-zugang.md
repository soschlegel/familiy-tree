# KI-Zugang

Wie ein KI-Assistent wie Claude im Stammbaum mitrecherchiert: Schlüssel anlegen, Stufen, Verlauf und Löschen, die Anmeldung per „Authorization: Bearer …“ und Claude auf dem Handy.

## Was die KI kann — und was nicht

Mit einem **persönlichen Schlüssel** arbeitet ein KI-Assistent (Claude) direkt mit den Stammbaumdaten: Er beantwortet Fragen zu Personen und Verwandtschaft („Wer waren die Eltern von Anna Vogt?“), findet fehlende Angaben, Widersprüche und mögliche Dubletten und trägt — wenn du es erlaubst — Rechercheergebnisse samt Belegen ein.

Dabei handelt die KI **als du**: Sie sieht nur, was du siehst, und ändert nur, was du ändern darfst. Personen, Quellen oder Bilder löschen und Personen zusammenführen kann sie nie — auch nicht nebenbei: Hängt an einem Ereignis oder einer Beziehung ein Bild, das sonst nirgends hängt, lehnt die App das Löschen durch die KI ab; das erledigst du dann selbst in der App. Jede Änderung durch die KI steht in der [Änderungsgeschichte](09-aenderungen.md) mit dem Namen des Schlüssels.

**Dubletten vorprüfen:** Die KI kann die Liste „Mögliche Dubletten“ durchgehen, beide Einträge eines Paares lesen, sich dieselbe Vorschau ansehen wie du vor dem Zusammenführen und am Paar eine Einschätzung hinterlassen — „zusammenführen“, „strittig“ oder „kein Duplikat“, immer mit Begründung. Dafür braucht der Schlüssel die Stufe „lesen und schreiben“ und du das Bearbeitungsrecht an beiden Personen. Gespeichert wird nur die Einschätzung; zusammengeführt wird nichts. Wie du damit arbeitest, steht unter [Von der KI vorgeprüfte Paare](07-dubletten.md#von-der-ki-vorgepruefte-paare). Bitte die KI zum Beispiel: „Prüfe die möglichen Dubletten vor“ (in Claude gibt es dafür die Vorlage „Dubletten vorprüfen“).

> **Bedenke:** Alles, was der Assistent abruft, geht an den KI-Anbieter. Besonders bei lebenden Personen lohnt es sich, das zu bedenken.

## Wer darf was

- Den KI-Zugang gibt der **Administrator** je Benutzer frei (unter „Benutzer“): **kein Zugang** (Standard), **lesen** oder **lesen und schreiben**. Auch Administratoren müssen ihn sich ausdrücklich selbst geben.
- **Deine Familienrechte gelten zusätzlich.** „Lesen und schreiben“ erlaubt einem Betrachter trotzdem keine Änderung.
- Jeder Schlüssel hat eine eigene **Stufe** (lesen oder lesen und schreiben). Wirksam ist immer die niedrigere — von Schlüssel und deinem KI-Zugang.
- Änderungen wirken sofort: Wird dein Zugang entzogen oder ein Schlüssel widerrufen, ist beim nächsten Aufruf Schluss.

## Einen Schlüssel anlegen

1. Im Menü **Verwaltung → KI-Zugang** (der Punkt erscheint, sobald du KI-Zugang hast).
2. Unter **Neuen Schlüssel anlegen** einen **Namen** vergeben, der sagt, wo der Schlüssel liegt („Claude Handy“, „Laptop – Claude Code“), die **Stufe** wählen (im Zweifel „lesen“) und wie viele Tage er **gültig** sein soll (Standard 90, höchstens 365).
3. **Schlüssel anlegen**. Der Schlüssel (er beginnt mit `ftk_`) wird **genau einmal** angezeigt — kopier ihn sofort, z.B. in einen Passwortmanager. Später lässt er sich nicht mehr anzeigen; geht er verloren, widerruf ihn und leg einen neuen an.

Tipp: **ein Schlüssel je Gerät und Zweck**. Dann kannst du einen gezielt widerrufen, und die Liste zeigt je Schlüssel, wann er zuletzt benutzt wurde. Höchstens 10 Schlüssel können gleichzeitig aktiv sein.

## So meldet sich die KI an

Die KI schickt deinen Schlüssel bei jeder Anfrage im HTTP-Header **Authorization** mit, mit dem Wort **Bearer** und einem Leerzeichen davor:

| Header-Name | Header-Wert |
|---|---|
| `Authorization` | `Bearer ftk_…` (statt „ftk_…“ dein ganzer Schlüssel) |

Ohne „Bearer “ davor, mit Anführungszeichen oder mit Zeilenumbruch wird der Schlüssel abgelehnt. In die Adresse (URL) gehört er nie. Bei Claude Code setzt du den Header beim Einrichten; beim Connector auf claude.ai erledigt das die Anmeldeseite.

## Claude auf dem Handy, im Browser und in Claude Desktop

Diese drei verbinden sich über einen **Custom Connector**, den du **einmal** auf claude.ai einrichtest (am besten am Computer). Die Claude-App auf dem Handy übernimmt ihn dann automatisch.

1. Schlüssel anlegen (siehe oben) und kopieren.
2. Auf claude.ai mit demselben Konto wie auf dem Handy anmelden.
3. **Customize → Connectors**, **„+ Add“**, **„Add custom connector“**.
4. Name „Stammbaum“, als Adresse die, die auf der Seite „KI-Zugang“ steht (fehlt sie, bekommst du sie vom Administrator). Administratoren tragen sie unter **Verwaltung → Einstellungen** ein, siehe [Einstellungen](12-einstellungen.md).
5. „Add“ und „Connect“ — es öffnet sich die Anmeldeseite des Stammbaums: dort deinen Schlüssel einfügen.
6. Auf dem Handy in der Claude-App im Chat über „+“ bzw. das Werkzeug-Symbol den Connector „Stammbaum“ einschalten.

Ein Bild, das du Claude im Chat zeigst, kann Claude nicht in den Stammbaum hochladen — lade es in der App hoch, dann kann Claude es zuordnen. Im kostenlosen Claude-Tarif ist nur ein eigener Connector möglich.

Für **Claude Code** (Terminal, VS Code) zeigt die Seite „KI-Zugang“ nach dem Anlegen eines Schlüssels den fertigen Befehl zum Kopieren.

## Widerrufen, Verlauf und Löschen

- **Widerrufen** sperrt einen Schlüssel sofort. Tu das auch, wenn ein Schlüssel versehentlich in einen Chat, eine Datei oder einen Screenshot geraten ist.
- Abgelaufene Schlüssel funktionieren nicht mehr; leg dann einen neuen an und tausche ihn im Assistenten aus.
- Widerrufene und abgelaufene Schlüssel sind ausgeblendet; „N ausgeblendet“ nennt ihre Zahl. Der Schalter **Widerrufene und abgelaufene anzeigen (Verlauf)** blendet sie ein.
- **Endgültig löschen** kannst du widerrufene und abgelaufene Schlüssel und solche, die noch nie benutzt wurden. Ein aktiver, schon benutzter Schlüssel muss zuerst widerrufen werden. Die Änderungsgeschichte bleibt beim Löschen erhalten und nennt den Schlüssel dann „gelöscht“.

Der Administrator kann unter „Benutzer“ jeden Schlüssel widerrufen und den KI-Zugang entziehen.
