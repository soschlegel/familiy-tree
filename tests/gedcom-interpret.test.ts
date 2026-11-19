import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { htmlToText } from "@/lib/gedcom/html";
import { parseGedcom } from "@/lib/gedcom/parse";
import { deriveRelationships } from "@/lib/gedcom/relationships";
import type { GedcomDocument } from "@/lib/gedcom/types";

const FIXTURES = path.resolve(__dirname, "fixtures", "gedcom");
const load = (name: string) => parseGedcom(readFileSync(path.join(FIXTURES, name)));
const person = (doc: GedcomDocument, id: string) => doc.persons.find((p) => p.id === id)!;
const family = (doc: GedcomDocument, id: string) => doc.families.find((f) => f.id === id)!;

describe("MyHeritage-Export", () => {
  const r = load("myheritage.ged");
  const doc = r.document;

  it("Kopf: Programm, Version, Zeichensatz, Sprache, Exportdatum, Dialekt, Projektkennungen", () => {
    expect(doc.header).toMatchObject({
      sourceId: "MYHERITAGE",
      sourceName: "MyHeritage Family Tree Builder",
      sourceVersion: "5.5.1",
      sourceCorporation: "MyHeritage.com",
      gedcomVersion: "5.5.1",
      gedcomForm: "LINEAGE-LINKED",
      charset: "UTF-8",
      language: "German",
      exportDate: "3 MAR 2026",
      exportTime: "10:15:00",
      destination: "MYHERITAGE",
      fileName: "Testbaum_Beispiel.ged",
      submitterId: "U1",
      dialect: "MYHERITAGE",
      majorVersion: 5,
    });
    expect(doc.header.externalIds.map((e) => e.type)).toEqual(["PROJECT_GUID", "SITE_ID", "UID"]);
    expect(doc.submitters[0]).toMatchObject({ id: "U1", name: "Erika Beispiel" });
  });

  it("Person: Kennungen, Änderungsstempel, Name, Ehename", () => {
    const hans = person(doc, "I1");
    expect(hans.externalIds).toEqual([
      { type: "RIN", value: "MH:I1" },
      { type: "UID", value: "5F1A0000AAAA0001" },
    ]);
    expect(hans.updated).toBe("2 MAR 2026 11:11:50 GMT+1");
    expect(hans.names[0]).toMatchObject({ full: "Hans Mustermann", given: "Hans", surname: "Mustermann", original: "Hans /Mustermann/" });
    expect(person(doc, "I2").names[0].marriedSurnames).toEqual(["Mustermann"]);
    expect(hans.sex).toBe("MALE");
  });

  it("Ereignisse: alternative Geburt, Ort mit Ebenen, Belege mit Seite und Qualität, Ursache, Alter", () => {
    const hans = person(doc, "I1");
    const births = hans.events.filter((e) => e.type === "BIRTH");
    expect(births).toHaveLength(2);
    expect(births[0].externalIds).toEqual([
      { type: "UID", value: "5F1A0000AAAA0101" },
      { type: "RIN", value: "MH:IF1" },
    ]);
    expect(births[0].place).toMatchObject({
      name: "Musterdorf, Landkreis Beispiel, Bayern, Deutschland",
      parts: ["Musterdorf", "Landkreis Beispiel", "Bayern", "Deutschland"],
    });
    expect(births[0].citations[0]).toMatchObject({
      sourceId: "S1",
      page: "Taufbuch 1850, S. 12, Nr. 7",
      quality: 3,
      confidence: "HIGH",
      eventType: "BIRT",
      role: "CHIL",
      texts: ["Hans, Sohn des Bauern ..."],
    });
    expect(births[0].citations[0].date?.start).toMatchObject({ year: 1850, month: 3, day: 14 });
    expect(births[1].date?.kind).toBe("ABOUT");
    expect(births[1].notes[0].content?.text).toBe("Alternative Angabe aus dem Familienbuch");
    const death = hans.events.find((e) => e.type === "DEATH")!;
    expect(death).toMatchObject({ cause: "Lungenentzündung", age: "61" });
    expect(death.date).toMatchObject({ kind: "BETWEEN", lenient: true });
    expect(hans.citations[0]).toMatchObject({ quality: 2, confidence: "MEDIUM" });
    expect(family(doc, "F1").events[0].citations[0]).toMatchObject({ quality: 1, confidence: "LOW" });
  });

  it("Merkmale und frei benannte Ereignisse: Label sind Daten", () => {
    const hans = person(doc, "I1");
    expect(hans.events.find((e) => e.type === "OCCUPATION")).toMatchObject({ value: "Landwirt", place: { name: "Musterdorf" } });
    const resi = hans.events.find((e) => e.type === "RESIDENCE")!;
    expect(resi.address).toMatchObject({ text: "Hauptstraße 1", lines: ["Hauptstraße 1", "Musterdorf"], emails: ["hans@example.invalid"] });
    expect(resi.date?.kind).toBe("FROM_TO");
    const custom = hans.events.filter((e) => e.type === "CUSTOM_EVENT");
    expect(custom.map((e) => [e.label, e.value])).toEqual([
      ["Reference Number", "4711"],
      ["Auswanderungsversuch", undefined],
    ]);
    expect(custom[1].extensions[0]).toMatchObject({ path: [], node: { tag: "_UNKNOWN_EVENT_TAG", value: "Wert" } });
  });

  it("Foto als eingebettetes OBJE mit URL, Hauptbild, Porträt, Ausschnitt", () => {
    const link = person(doc, "I1").media[0];
    expect(link).toMatchObject({ primary: true, personalPhoto: true, cutout: true, primaryCutout: true });
    expect(link.inline).toMatchObject({
      title: "Hans 1890",
      fileSize: 123456,
      files: [{ location: "https://example.invalid/mh/photos/000/111/222_333_A.jpg", isUrl: true, format: "jpg" }],
      externalIds: [{ type: "PHOTO_RIN", value: "MH:P500002" }],
    });
    expect(link.inline!.extensions.map((e) => e.node.tag)).toEqual(["_PARENTRIN", "_POSITION", "_PARENTPHOTO"]);
  });

  it("Gemeinsame Notiz mit HTML, CONC/CONT und Umlauten", () => {
    const note = doc.notes[0];
    expect(note.content.isHtml).toBe(true);
    expect(note.content.text).toBe(
      "Hans war Ortsvorsteher von 1890 bis 1900.\n\nEr hatte 3 Geschwister & viele Neffen.\n\nZweite Zeile mit Umlauten: äöüß",
    );
    expect(note.content.original).toContain("<b>Ortsvorsteher</b>");
    expect(note.updated).toBe("2 MAR 2026 11:31:00 GMT+1");
    expect(person(doc, "I1").notes[0].noteId).toBe("N1");
  });

  it("Quelle mit Archiv, Signatur und MyHeritage-Feldern", () => {
    expect(doc.sources[0]).toMatchObject({
      id: "S1",
      title: "Kirchenbuch Musterdorf, Taufen 1840-1860",
      author: "Pfarramt Musterdorf",
      publication: "Bistumsarchiv Beispielstadt",
      text: "Mikrofilm, Band 3",
      sourceType: "Kirchenbuch",
      medium: "Mikrofilm",
      repositories: [{ repositoryId: "R1", callNumbers: ["KB-MD-3"], mediaType: "film" }],
    });
    expect(doc.repositories[0]).toMatchObject({ name: "Bistumsarchiv Beispielstadt", address: { city: "Beispielstadt", country: "Deutschland" } });
  });

  it("Familien: Mehrfachehe, Scheidung, Ein-Eltern, Adoption neben leiblichen Eltern, Pflegekind", () => {
    expect(family(doc, "F1")).toMatchObject({ partners: ["I1", "I2"], status: "MARRIED", statusEvidence: "MARRIAGE_EVENT" });
    expect(family(doc, "F3")).toMatchObject({ partners: ["I1", "I7"], status: "DIVORCED" });
    expect(family(doc, "F2")).toMatchObject({ status: "UNKNOWN", statusEvidence: "NO_MARRIAGE_EVENT" });
    expect(family(doc, "F4")).toMatchObject({ partners: ["I8"], partnerRoles: ["HUSB"] });
    expect(family(doc, "F4").status).toBeUndefined();
    const kids = family(doc, "F1").children;
    expect(kids.map((c) => [c.childId, c.kinds, c.explicit])).toEqual([
      ["I3", ["BIOLOGICAL", "BIOLOGICAL"], false],
      ["I4", ["ADOPTIVE", "ADOPTIVE"], true],
      ["I5", ["FOSTER", "FOSTER"], true],
    ]);
    expect(family(doc, "F4").children[0]).toMatchObject({ childId: "I4", kinds: ["BIOLOGICAL"], kindLabels: ["birth"] });
    const karl = person(doc, "I4");
    expect(karl.events.find((e) => e.type === "ADOPTION")!.adoption).toEqual({ familyId: "F1", by: "BOTH" });
    expect(karl.parentFamilies).toEqual(["F1", "F4"]);
    expect(person(doc, "I1").spouseFamilies.map((s) => s.familyId)).toEqual(["F1", "F3"]);
  });

  it("Privatsphäre: RESN und Platzhaltername werden markiert, nicht entschieden", () => {
    const p = person(doc, "I5");
    expect(p.privacy).toMatchObject({ restrictions: ["privacy"], placeholderName: true });
    expect(p.names[0].given).toBe("Private");
    expect(person(doc, "I1").privacy).toEqual({ restrictions: [], livingMarked: false, placeholderName: false, markers: [] });
  });

  it("Unbekannte Datensätze bleiben erhalten (_PUBLISH, _MTTAG)", () => {
    expect(doc.unknownRecords.map((n) => n.tag)).toEqual(["_PUBLISH", "_MTTAG"]);
    expect(person(doc, "I1").extensions.map((e) => e.node.tag)).toEqual(["_MTTAG"]);
    expect(r.unknownTags.find((u) => u.tag === "_MTTAG")).toMatchObject({ count: 2 });
  });

  it("deriveRelationships: Partnerschaften und Eltern-Kind in App-Begriffen", () => {
    const rel = deriveRelationships(doc);
    expect(rel.partnerships.map((p) => [p.familyId, p.status])).toEqual([
      ["F1", "MARRIED"],
      ["F2", "UNKNOWN"],
      ["F3", "DIVORCED"],
    ]);
    expect(rel.partnerships[0].start?.original).toBe("20 JUN 1878");
    expect(rel.partnerships[2].end?.original).toBe("1900");
    expect(rel.singleParentFamilies).toEqual(["F4"]);
    const karl = rel.parentChild.filter((l) => l.childId === "I4").map((l) => [l.parentId, l.kind]);
    expect(karl).toEqual([
      ["I1", "ADOPTIVE"],
      ["I2", "ADOPTIVE"],
      ["I8", "BIOLOGICAL"],
    ]);
  });
});

describe("Torture-Datei", () => {
  const r = load("torture.ged");
  const doc = r.document;

  it("Namen: Teile, Typen, Spitzname, Rufname, romanisierte Variante", () => {
    const [main, aka, immi] = person(doc, "I1").names;
    expect(main).toMatchObject({
      prefix: "Dr.",
      given: "Friedrich Wilhelm",
      surnamePrefix: "von",
      surname: "Probe",
      suffix: "jun.",
      nickname: "Fritz",
      callName: "Wilhelm",
      type: "BIRTH",
      typeLabel: "birth",
    });
    expect(main.citations[0]).toMatchObject({ sourceId: "S1", page: "S. 5" });
    expect(aka.type).toBe("AKA");
    expect(immi.variants).toEqual([{ kind: "romanized", value: "Frederick Probe", method: "manuell" }]);
  });

  it("Ortshierarchie nach HEAD.PLAC.FORM, Koordinaten, julianisches Datum", () => {
    const birth = person(doc, "I1").events[0];
    expect(birth.place).toMatchObject({
      jurisdictions: [
        { level: "Ort", name: "Probstadt" },
        { level: "Kreis", name: "Probkreis" },
        { level: "Land", name: "Probland" },
        { level: "Staat", name: "Deutschland" },
      ],
      latitude: 50.1234,
      longitude: 10.5,
    });
    expect(birth.date?.start).toMatchObject({ calendar: "JULIAN", gregorian: { year: 1700, month: 1, day: 11 } });
  });

  it("Gleichgeschlechtliches Paar (zwei HUSB), Alter der Partner", () => {
    const f = family(doc, "F1");
    expect(f.partners).toEqual(["I1", "I2"]);
    expect(f.partnerRoles).toEqual(["HUSB", "HUSB"]);
    expect(f.events[0].partnerAges).toEqual({ husband: "30" });
    expect(f.status).toBe("MARRIED");
  });

  it("_FREL/_MREL je Elternteil, PEDI step, Ein-Eltern-Familie, fehlende Person", () => {
    expect(family(doc, "F2").children[0]).toMatchObject({ kinds: ["FOSTER", "BIOLOGICAL"], kindLabels: ["Foster", "Natural"] });
    expect(family(doc, "F2").status).toBe("UNKNOWN");
    expect(family(doc, "F2").events[0].type).toBe("ENGAGEMENT");
    expect(family(doc, "F3")).toMatchObject({ partners: ["I3"], partnerRoles: ["WIFE"] });
    expect(family(doc, "F4").children[0]).toMatchObject({ childId: "I4", kinds: ["STEP"] });
    expect(r.warnings.some((w) => w.code === "DANGLING_POINTER" && w.message.includes("@I99@"))).toBe(true);
  });

  it("Eingebettete Quelle mit Text und QUAY 0, gemeinsame Notiz mit CONC/CONT und @", () => {
    const cit = person(doc, "I1").citations[0];
    expect(cit).toMatchObject({ inlineText: "Inline-Quelle: Familienbibel", texts: ["Eintrag auf dem Vorsatzblatt"], quality: 0, confidence: "LOW" });
    expect(doc.notes[0].content.text).toBe(
      "Gemeinsame Notiz, die über mehrere Zeilen geht und mit CONC fortgesetzt wird — dazu ein @-Zeichen.\nNeue Zeile.\n\nNach einer Leerzeile.",
    );
  });

  it("Quellen-DATA und OBJE-Datensatz", () => {
    expect(doc.sources[0].dataEvents[0]).toMatchObject({ types: "BIRT, DEAT", place: "Probstadt", date: { kind: "FROM_TO" } });
    expect(doc.sources[0].dataAgency).toBe("Pfarrei Probstadt");
    expect(doc.media[0]).toMatchObject({ id: "M1", files: [{ location: "bilder/portrait.jpg", isUrl: false, format: "jpeg", mediaType: "photo", title: "Porträt" }] });
  });

  it("DEAT Y, Geschlecht U, Ereignis-Datum mit unbekanntem Unterknoten", () => {
    expect(person(doc, "I1").events.find((e) => e.type === "DEATH")!.value).toBe("Y");
    expect(person(doc, "I4").sex).toBe("UNKNOWN");
    const chr = person(doc, "I1").events.find((e) => e.type === "CHRISTENING")!;
    expect(chr.extensions[0]).toMatchObject({ path: ["DATE"], node: { tag: "_DATE_CUSTOM" } });
  });
});

describe("GEDCOM 7", () => {
  const r = load("gedcom7.ged");
  const doc = r.document;
  it("Version, Kalender als Wort, EXID/UID, SNOTE, RESN-Liste, PEDI mit PHRASE, @VOID@", () => {
    expect(doc.header).toMatchObject({ gedcomVersion: "7.0", majorVersion: 7, language: "de" });
    const lena = person(doc, "I1");
    expect(lena.events[0].date?.start).toMatchObject({ calendar: "JULIAN", year: 1699, month: 3, day: 1 });
    expect(lena.externalIds).toEqual([
      { type: "EXID", value: "9876", scheme: "https://example.invalid/ids" },
      { type: "UID", value: "0f3c0000-0000-4000-8000-000000000001" },
    ]);
    expect(lena.privacy.restrictions).toEqual(["confidential", "locked"]);
    expect(person(doc, "I2").sex).toBe("OTHER");
    expect(doc.notes[0].content.text).toBe("Eine geteilte Notiz\nmit zweiter Zeile und @@ am Anfang? Nein: @nur hier.");
    const f = family(doc, "F1");
    expect(f.partners).toEqual(["I2"]);
    expect(f.children[0]).toMatchObject({ kinds: ["ADOPTIVE"], kindLabels: ["ADOPTED"] });
    expect(f.children[0].childSideExtensions[0]).toMatchObject({ path: ["PEDI"], node: { tag: "PHRASE" } });
  });

  it("NO MARR = ausdrücklich unverheiratet", () => {
    const d = parseGedcom("0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @A@ INDI\n0 @B@ INDI\n0 @F@ FAM\n1 HUSB @A@\n1 WIFE @B@\n1 NO MARR\n0 TRLR").document;
    expect(d.families[0]).toMatchObject({ status: "UNMARRIED", statusEvidence: "EXPLICIT", statusMarker: { tag: "NO", value: "MARR" } });
  });
});

describe("Familienstand", () => {
  const fam = (lines: string[]) =>
    parseGedcom(["0 HEAD", "0 @A@ INDI", "0 @B@ INDI", "0 @F@ FAM", "1 HUSB @A@", "1 WIFE @B@", ...lines, "0 TRLR"].join("\n")).document.families[0];
  it.each([
    [[], "UNKNOWN", "NO_MARRIAGE_EVENT"],
    [["1 MARR Y"], "MARRIED", "MARRIAGE_EVENT"],
    [["1 MARR", "2 TYPE civil"], "MARRIED", "MARRIAGE_EVENT"],
    [["1 MARR", "2 TYPE not married"], "UNMARRIED", "EXPLICIT"],
    [["1 MARR", "2 TYPE partners"], "UNMARRIED", "EXPLICIT"],
    [["1 MARR", "1 DIV"], "DIVORCED", "DIVORCE_EVENT"],
    [["1 ANUL"], "DIVORCED", "DIVORCE_EVENT"],
    [["1 ENGA"], "UNKNOWN", "NO_MARRIAGE_EVENT"],
    [["1 MARB", "1 MARL", "1 MARC"], "UNKNOWN", "NO_MARRIAGE_EVENT"],
    [["1 _STAT Never Married"], "UNMARRIED", "EXPLICIT"],
    [["1 _STAT Partners"], "UNMARRIED", "EXPLICIT"],
    [["1 _MSTAT Unmarried"], "UNMARRIED", "EXPLICIT"],
    [["1 TYPE Lebensgemeinschaft"], "UNMARRIED", "EXPLICIT"],
    [["1 _STAT Married"], "MARRIED", "EXPLICIT"],
    [["1 _STAT Unknown"], "UNKNOWN", "NO_MARRIAGE_EVENT"],
  ])("%j → %s", (lines, status, evidence) => {
    expect(fam(lines as string[])).toMatchObject({ status, statusEvidence: evidence });
  });

  it("unbekannter _STAT-Wert bleibt Rohdaten, Status unbekannt", () => {
    const f = fam(["1 _STAT Irgendwas"]);
    expect(f.status).toBe("UNKNOWN");
    expect(f.statusMarker).toBeUndefined();
    expect(f.extensions[0].node).toMatchObject({ tag: "_STAT", value: "Irgendwas" });
  });
});

describe("Einseitige Verknüpfungen und Platzhalter", () => {
  it("FAMC/FAMS ohne Gegenstück werden ergänzt und gemeldet", () => {
    const r = parseGedcom("0 HEAD\n0 @A@ INDI\n1 SEX F\n1 FAMS @F@\n0 @K@ INDI\n1 FAMC @F@\n0 @F@ FAM\n0 TRLR");
    const f = r.document.families[0];
    expect(f.partners).toEqual(["A"]);
    expect(f.partnerRoles).toEqual(["WIFE"]);
    expect(f.children.map((c) => c.childId)).toEqual(["K"]);
    expect(r.warnings.filter((w) => w.code === "INCONSISTENT_LINK")).toHaveLength(2);
  });

  it.each(["Living", "Lebend", "Privat", "Private Person"])("Platzhaltername „%s“", (name) => {
    const p = parseGedcom(`0 HEAD\n0 @A@ INDI\n1 NAME ${name} /Muster/\n0 TRLR`).document.persons[0];
    expect(p.privacy.placeholderName).toBe(true);
  });

  it("_PRIV, _PRIVATE, _LIVING", () => {
    const p = parseGedcom("0 HEAD\n0 @A@ INDI\n1 _PRIV Y\n1 _LIVING Y\n0 TRLR").document.persons[0];
    expect(p.privacy).toMatchObject({ livingMarked: true, markers: [{ source: "_PRIV", value: "Y" }, { source: "_LIVING", value: "Y" }] });
  });
});

describe("HTML in Notizen", () => {
  it.each([
    ["<p>a</p><p>b</p>", "a\n\nb"],
    ["Zeile<br>Zeile<br/>Ende", "Zeile\nZeile\nEnde"],
    ["<ul><li>eins</li><li>zwei</li></ul>", "• eins\n• zwei"],
    ['<a href="https://example.invalid">Link</a>', "Link (https://example.invalid)"],
    ["&lt;script&gt; &amp; &#228; &#x00FC; &nbsp;x", "<script> & ä ü  x"],
    ["<script>alert(1)</script>Text", "Text"],
  ])("%s", (html, text) => {
    expect(htmlToText(html)).toBe(text);
  });
  it("Text ohne HTML bleibt unverändert", () => {
    const n = parseGedcom("0 HEAD\n0 @N@ NOTE 3 < 4 und a > b\n0 TRLR").document.notes[0];
    expect(n.content).toEqual({ text: "3 < 4 und a > b", isHtml: false });
  });
});
