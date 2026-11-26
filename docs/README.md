# Dokumentation

Übersicht über alle Dokumente der Stammbaum-App. Einstieg und Schnellstart:
[README](../README.md). Arbeitsweise für KI-Sitzungen:
[AGENTS.md](../AGENTS.md), laufender Stand: [UEBERGABE.md](../UEBERGABE.md).

Grundsatz: **Fachliches und Anleitungen** stehen hier je Thema in einer
Datei; **technische Einzelheiten je Modul** (Funktionen, Regeln im Code,
Tests) stehen in der [Komponenten-Doku](komponenten/README.md) und werden
hier nicht wiederholt. Weicht eine Beschreibung vom Code ab, gilt der Code.

## Fachliches und Bedienung

| Datei | Inhalt |
|---|---|
| [fachlich/fokus-ansicht.md](fachlich/fokus-ansicht.md) | Fokus-Ansicht des Stammbaums (Ausschnitt, Rand, Klicks, Adresse, Einstieg) und Grenzen der Gesamtansichten |
| [fachlich/bezugsperson.md](fachlich/bezugsperson.md) | „Das bin ich“, vorübergehende Bezugsperson, Verwandtschaftsgrade und Großeltern-Linien, Datenschutz |
| [fachlich/karte-und-orte.md](fachlich/karte-und-orte.md) | Karte „Wurzeln nach Jahr“, Orte zuordnen (automatisch, von Hand, durch die KI), Ortsseiten, Ortsnamen, mitgelieferte Geodaten und Lizenzen |
| [fachlich/ungenaue-daten.md](fachlich/ungenaue-daten.md) | Eingabeformen ungenauer Daten, Wortlaut, wie Prüfungen damit umgehen |
| [fachlich/beziehungen-und-ereignisse.md](fachlich/beziehungen-und-ereignisse.md) | Regeln für Beziehungen; wo welche Angabe steht (Lebensereignisse, weitere Namen, abweichende Angaben); Import-Herkunft |
| [fachlich/quellen-und-belege.md](fachlich/quellen-und-belege.md) | Quellen, Belege, Einordnung importierter Quellen, Oberfläche, Rechte |
| [fachlich/bilder-an-eintraegen.md](fachlich/bilder-an-eintraegen.md) | Bilder an Quellen, Ereignissen und Belegen: wo sie erscheinen, Bearbeiten, Rechte |
| [fachlich/austauschformat.md](fachlich/austauschformat.md) | Eigenes Export-/Importformat (JSON/ZIP) und seine Versionen |
| [fachlich/gedcom.md](fachlich/gedcom.md) | GEDCOM: Datei vorab prüfen, Import Schritt für Schritt, wiederholte Importe, Fotos, Export, Grenzen |
| [fachlich/dubletten.md](fachlich/dubletten.md) | Mögliche Dubletten, Vergleich und Zusammenführen, Importe verbinden, Herkunft nach dem Zusammenführen |
| [fachlich/aenderungsgeschichte.md](fachlich/aenderungsgeschichte.md) | Änderungsprotokoll, Pakete, Anzeige und Datenschutz |
| [fachlich/berechtigungen.md](fachlich/berechtigungen.md) | Rechte je Familie, was wer darf, Benutzerverwaltung, Einstellungen |

## Betrieb

| Datei | Inhalt |
|---|---|
| [betrieb/nas-portainer.md](betrieb/nas-portainer.md) | Betrieb auf der NAS mit Portainer: Dienste, Datenordner, erste Installation, Updates, Zurückrollen |
| [betrieb/oauth.md](betrieb/oauth.md) | Anmeldung per GitHub/Google im Heimnetz und lokal |
| [betrieb/reverse-proxy.md](betrieb/reverse-proxy.md) | Anforderungen an den Reverse-Proxy; Synology, Nginx Proxy Manager, Caddy-Profil |
| [betrieb/sicherung.md](betrieb/sicherung.md) | Sicherung (Dump + Bilderordner), Planung, Wiederherstellung |
| [betrieb/migrationen.md](betrieb/migrationen.md) | Was beim Start mit Migrationen geschieht, Baselining, Prisma-CLI im Image |
| [betrieb/fehlersuche.md](betrieb/fehlersuche.md) | Symptome und Abhilfe im Betrieb, fehlgeschlagene Migration, Bilderordner |
| [betrieb/ki-zugang.md](betrieb/ki-zugang.md) | KI-Zugang einrichten (Claude Code, Desktop, Connector), Rechte, Schlüssel, Fehlersuche, Entwicklung |
| [sicherheit.md](sicherheit.md) | Sicherheitsprüfung: Befunde, Restrisiken, Hinweise für den Betrieb |
| [dev-history.md](dev-history.md) | Frühere Stände und Umstiege für alte Installationen |

## Entwicklung

| Datei | Inhalt |
|---|---|
| [entwicklung/tests.md](entwicklung/tests.md) | Prüfbefehle, Unit- und E2E-Tests, Teilläufe, Sharding, Fehlersuche bei roten Tests |
| [entwicklung/mock-daten.md](entwicklung/mock-daten.md) | Mock-Umgebung: Befehle, Inhalt, Testbenutzer, feste KI-Schlüssel |
| [entwicklung/neuigkeiten.md](entwicklung/neuigkeiten.md) | Wie `CHANGELOG.md` zu „Was ist neu?“ und der Seite „Neuigkeiten“ wird |
| [komponenten/](komponenten/README.md) | Technische Beschreibung jeder Komponente, Datenmodell, Migrationen, Betriebsskripte, Testaufbau |
| [anwender/](anwender/README.md) | Hilfe für Anwender (in der App unter `/hilfe`) |
