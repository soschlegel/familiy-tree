# Bilder an Quellen, Ereignissen und Belegen

Neben Porträts (Person) und Hochzeitsbildern (Beziehung) lassen sich Bilder
an **Quellen** (mehrere: Seiten eines Registers, Grabstein, Titelblatt), an
**Lebensereignissen** (Taufschein, Foto der Konfirmation) und an **Belegen**
(der Ausschnitt einer Quelle, der genau diese Angabe belegt — der Eintrag auf
Seite 12) hängen. Ein Bild ist eine Datei; es kann an beliebig vielen
Einträgen hängen (Tabellen `SourceMedia`, `EventMedia`, `CitationMedia`; der
bisherige Scan `Source.mediaId` bleibt als **Hauptscan** und wird mit den
weiteren Bildern zusammen gelesen, [lib/services/attached-media.ts](../../lib/services/attached-media.ts)).

**Wo erscheint welches Bild?**

| Bild hängt an | erscheint |
|---|---|
| Ereignis | in der Zeile des Ereignisses auf der Personenseite (Ereignisse einer Beziehung auf beiden Personenseiten) und unter „Belegbilder“ |
| Beleg | beim Eintrag, den er belegt: bei einem Ereignis-Beleg in der Ereigniszeile (im Abschnitt „Quellen“ steht dann nur „1 Bild beim Ereignis“), bei Belegen zu Geburt/Tod, Namen oder Beziehungen am Beleg im Abschnitt „Quellen“; dazu einmal unter „Belegbilder“ und auf der Seite der Quelle beim Beleg. Kein Bild steht zugleich in der Ereigniszeile und im Abschnitt „Quellen“ (Entscheidung des Eigentümers: nur am Eintrag + Sammlung) |
| Quelle (Hauptscan oder weiteres Bild) | auf der Seite der Quelle und als **Belegbild bei jedem Beleg dieser Quelle** — **außer** das Bild hängt zugleich an mindestens einem Beleg derselben Quelle: dann gehört es erkennbar zu diesem Beleg und erscheint nur dort |

Beispiel: Am „Taufbuch St. Marien“ hängen ein Titelblatt und der Scan von
Seite 12. Solange der Scan nur an der Quelle hängt, zeigen alle Belege des
Taufbuchs beide Bilder. Wird der Scan zusätzlich an den Beleg „Geburt Anna,
S. 12“ gehängt, zeigen die übrigen Belege nur noch das Titelblatt.

Auf der Personenseite stehen diese Bilder **getrennt** von der Galerie mit
Porträt- und Familienbildern: als kleine Vorschauen (64 px, Alt-Text aus der
Beschriftung) an Ereignis und Beleg und gesammelt im Abschnitt
**„Belegbilder“** mit Herkunft („Taufe 1850 · Taufbuch, S. 12“). Antippen
öffnet das Bild groß wie in der Galerie.

**Bearbeiten in der App:** An jeder Ereignis- und Belegzeile der
Personenseite und auf der Seite der Quelle („Bilder zur Quelle“) führt
„Bild hinzufügen“ zu *Datei hochladen* (gleiche Verarbeitung wie jeder
Upload: Typ anhand der Bytes, `MAX_UPLOAD_BYTES`, WebP, Vorschau) und
*Vorhandenes Bild* verknüpfen (Bilder der Seite bzw. der belegten Personen).
„entfernen“ löst das Bild nur von diesem Eintrag; hängt es danach an nichts
mehr, wird es nach Rückfrage gelöscht. Wird ein Ereignis, Beleg, eine Quelle
oder Person gelöscht, verschwinden Bilder, die nur daran hingen; beim
Zusammenführen von Dubletten wandern die Bilder doppelter Ereignisse und
Belege mit. Der Hauptscan wird wie bisher im Formular der Quelle („Scan“)
gewählt.

**Rechte** ([lib/media-scope.ts](../../lib/media-scope.ts),
[lib/services/media-links.ts](../../lib/services/media-links.ts)):

- Sehen: wer mindestens einen Eintrag sieht, an dem das Bild hängt — ein
  Ereignis bzw. Beleg wie seine Person/Beziehung, eine Quelle wie die Quelle
  (wer einen ihrer Belege sieht, der Ersteller, Administratoren). Ein Bild an
  einer familienübergreifenden Quelle sehen also alle, die die Quelle sehen
  (das gilt jetzt auch für den Hauptscan).
- Hochladen und Verknüpfen: jedes Ziel muss der Benutzer **bearbeiten**
  dürfen (geprüft vor dem Speichern, alles oder nichts); unsichtbare Ziele
  gelten als nicht vorhanden. Ein vorhandenes Bild lässt sich nur
  verknüpfen, wenn der Benutzer es sehen darf.
- Ganz löschen (Galerie „Löschen“): wie bisher über eine bearbeitbare Person
  bzw. Beziehung — hängt das Bild zusätzlich an Ereignissen, Belegen oder
  Quellen, müssen auch diese alle bearbeitbar sein.
- Jede Änderung steht in der Änderungsgeschichte (`MediaAsset`, CREATE /
  UPDATE mit `linked` bzw. `unlinked`) bei allen betroffenen Personen; bei
  einem Quellenbild sind das alle Personen, die die Quelle belegt.

API: `POST /api/media` (Formular mit `file` und genau einem von `personId`,
`relationshipId`, `eventId`, `citationId`, `sourceId`),
`POST /api/media/{id}/links` (JSON mit einem oder mehreren Zielen, auch als
Listen `eventIds` …), `DELETE /api/media/{id}/links?eventId=…`.
Über die KI: `add_media` und `link_media` ([KI-Zugang](../betrieb/ki-zugang.md)).
