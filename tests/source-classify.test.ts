/**
 * Einordnung importierter Quellen (lib/source-classify.ts) — erfundene,
 * MyHeritage-artige Angaben, keine echten Daten.
 */
import { describe, expect, it } from "vitest";

import { classifySource, detectProvider, displayCitation, displaySourceKind, findUrls, plainText, splitCitationPage } from "@/lib/source-classify";

describe("classifySource", () => {
  it("Stammbaum-Sammlung eines Anbieters mit HTML-Text: Online-Stammbaum, Anbieter, Adresse", () => {
    const c = classifySource({
      title: "Musterland Stammbäume",
      type: "Stammbaum",
      medium: "Online-Datenbank",
      text: '<a id="" href="https://www.myheritage.de" class="green" target="_blank" rel="noopener">www.myheritage.de</a> Die Sammlung gehört MyHeritage.',
      citationPages: ["https://www.myheritage.de/research/collection-1/musterland?itemId=1&amp;action=showRecord"],
    });
    expect(c).toMatchObject({ kind: "ONLINE_TREE", provider: "MyHeritage", url: "https://www.myheritage.de", derived: true });
  });

  it("Zensus und Kirchenbuch über einen Anbieter: nach dem, was sie sind, Anbieter vermerkt", () => {
    expect(classifySource({ title: "Volkszählung Musterland 1900", urls: ["https://www.ancestry.de/search/collections/123"] })).toMatchObject({
      kind: "CENSUS",
      provider: "Ancestry",
      derived: false,
    });
    expect(classifySource({ title: "Germany, Lutheran Baptisms, 1500-1900", citationPages: ["https://www.familysearch.org/ark:/61903/1:1:XYZ"] })).toMatchObject({
      kind: "CHURCH_BOOK",
      provider: "FamilySearch",
    });
  });

  it("Sammlung eines erkannten Anbieters ohne Inhaltsart: Online-Sammlung; unbekannter Anbieter: Webseite", () => {
    expect(classifySource({ title: "Zeitungsarchiv", text: "Quelle: Geneanet" })).toMatchObject({ kind: "ONLINE_COLLECTION", provider: "Geneanet" });
    expect(classifySource({ title: "Sippenbuch online", urls: ["https://beispiel.invalid/sippen"] })).toMatchObject({ kind: "WEBSITE", provider: null });
    expect(classifySource({ title: "Aufzeichnungen Onkel Karl" })).toMatchObject({ kind: "OTHER", provider: null, url: null });
  });

  it("Smart Matches und World Family Tree sind Online-Stammbäume", () => {
    expect(classifySource({ title: "MyHeritage Smart Matches" }).kind).toBe("ONLINE_TREE");
    expect(classifySource({ title: "World Family Tree" }).kind).toBe("ONLINE_TREE");
  });
});

describe("Hilfen", () => {
  it("Fundstelle mit Adresse: Adresse heraus, Rest bleibt", () => {
    expect(splitCitationPage("https://www.myheritage.de/research/collection-1?itemId=9&action=showRecord")).toEqual({
      detail: null,
      url: "https://www.myheritage.de/research/collection-1?itemId=9&action=showRecord",
    });
    expect(splitCitationPage("Seite 12, https://beispiel.invalid/a/b")).toEqual({ detail: "Seite 12", url: "https://beispiel.invalid/a/b" });
    expect(splitCitationPage("S. 7")).toEqual({ detail: "S. 7", url: null });
    expect(splitCitationPage("javascript:alert(1)")).toEqual({ detail: "javascript:alert(1)", url: null });
  });

  it("HTML zu Text, Adressen finden, Anbieter erkennen", () => {
    expect(plainText("<p>Erste&nbsp;Zeile</p><p>Zweite</p>")).toBe("Erste Zeile\n\nZweite");
    expect(findUrls('<a href="https://www.geni.com/people/x">x</a>')).toContain("https://www.geni.com/people/x");
    expect(detectProvider(["https://sites-cf.mhcache.com/a.jpg"], [])).toBe("MyHeritage");
    expect(detectProvider([], ["Daten von FamilySearch"])).toBe("FamilySearch");
  });
});

describe("Anzeige älterer Importe (ohne neues Einlesen)", () => {
  it("„<Name> Web Site“ mit _TYPE „Smart Matching“ und Personen-Adressen: Online-Stammbaum von MyHeritage", () => {
    const c = classifySource({
      title: "Kelvaro Web Site",
      type: "Smart Matching",
      text: "<p>MyHeritage-Stammbaum</p><p>Familienseite: Kelvaro Web Site</p>Stammbaum: 123456789",
      citationPages: ["https://www.myheritage.de/person-1000001_123456789_123456789/anna-kelvaro"],
    });
    expect(c).toMatchObject({ kind: "ONLINE_TREE", provider: "MyHeritage", derived: true });
  });

  it("displaySourceKind ordnet gespeichertes „Sonstige“ ein; andere Arten bleiben", () => {
    const stored = { kind: "OTHER", kindLabel: "Smart Matching", title: "Kelvaro Web Site", notes: "<p>MyHeritage-Stammbaum</p>", url: null };
    expect(displaySourceKind(stored, ["https://www.myheritage.de/person-1_2_3/x"])).toEqual({ kind: "ONLINE_TREE", provider: "MyHeritage" });
    expect(displaySourceKind({ ...stored, kind: "CHURCH_BOOK" })).toEqual({ kind: "CHURCH_BOOK", provider: null });
  });

  it("displayCitation: Adresse in der Fundstelle wird Link, Rest bleibt; unsichere Adressen nicht", () => {
    expect(displayCitation({ detail: "https://www.myheritage.de/person-1_2_3/anna", url: null })).toEqual({ detail: null, url: "https://www.myheritage.de/person-1_2_3/anna" });
    expect(displayCitation({ detail: "S. 4, https://beispiel.invalid/x", url: null })).toEqual({ detail: "S. 4", url: "https://beispiel.invalid/x" });
    expect(displayCitation({ detail: "https://nutzer:geheim@beispiel.invalid/x", url: null }).url).toBeNull();
    expect(displayCitation({ detail: "<b>S. 7</b>", url: null })).toEqual({ detail: "S. 7", url: null });
  });
});
