# Anwender-Hilfe — Hinweise für die Pflege

Diese Dateien sind die Hilfe **für Anwender** (Familienmitglieder ohne
Technikwissen). Die App zeigt sie unter `/hilfe` bzw. `/hilfe/<thema>`
(Link „Hilfe“ in der Fußzeile). Die technische Doku für Entwickler steht in
[docs/komponenten/](../komponenten/README.md).

**Pflicht:** Nach jeder abgeschlossenen Änderung, die Anwender betrifft, im
selben Commit fortschreiben (AGENTS.md, Abschnitt „Anwender-Hilfe“).

## Aufbau

- Je Thema eine Datei `NN-thema.md`. Die Nummer bestimmt die Reihenfolge,
  `thema` die Adresse (`/hilfe/thema`). Ein neues Thema = eine neue Datei,
  kein Code. Diese README gehört nicht zur Hilfe.
- Erste Zeile `# Titel`, danach ein kurzer Absatz — er erscheint als
  Beschreibung in der Themenliste.
- Querverweise als `[Text](05-karte.md#anker)` (funktioniert auch auf
  GitHub), Seiten der App als `/pfad`, externe Seiten nur mit `https://`.
- Erlaubt ist nur das Markdown-Subset aus `lib/help/markdown.ts`:
  Überschriften, Absätze, Listen (eine Ebene), `> Hinweiskasten`, Tabellen,
  **fett**, *kursiv*, `Code`, Links. Kein HTML — es wird als Text angezeigt.
- Anker entstehen aus Überschriften („Wie wird gezählt?“ →
  `wie-wird-gezaehlt`). Die Kontexthilfe der App verlinkt einige davon
  (`lib/help/links.ts`); `tests/help.test.ts` prüft, dass es sie gibt.
  Eine Überschrift umbenennen heißt also auch dort nachziehen.

## Stil

- „du“-Ansprache wie in der App, kurz und freundlich, Begriffe der
  Oberfläche wörtlich und **fett** („Automatisch zuordnen“).
- Beispiele mit erfundenen Namen und Orten — öffentliches Repository.
- Nur beschreiben, was die App heute kann; jede Aussage am Code prüfen.
