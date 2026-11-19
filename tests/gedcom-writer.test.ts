import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifyLossless } from "@/lib/gedcom/lossless";
import { parseGedcom } from "@/lib/gedcom/parse";
import { deriveRelationships, familiesFromRelationships } from "@/lib/gedcom/relationships";
import type { GedcomDocument, GedcomPerson } from "@/lib/gedcom/types";
import { escapeValue, splitForConc, writeGedcom } from "@/lib/gedcom/writer";

const FIXTURES = path.resolve(__dirname, "fixtures", "gedcom");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));
const NOW = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));

/**
 * Modell ohne Kopf und ohne Zeilennummern — für den Vergleich nach dem
 * Roundtrip. Bewusste Normalisierungen des Writers werden herausgerechnet:
 * Datumstexte werden getrennt verglichen (nachsichtig gelesene erscheinen
 * genormt, genormte wörtlich),
 * ungültige Kennungen werden ersetzt (idMap), ein fehlender Einsender wird
 * ergänzt.
 */
function comparable(doc: GedcomDocument, idMap: Record<string, string> = {}, dropSubmitters = false): unknown {
  const { header: _h, submitters, ...rest } = doc;
  const json = JSON.stringify(dropSubmitters ? rest : { ...rest, submitters }, (k, v) => {
    if (k === "line") return undefined;
    if (v && typeof v === "object" && "kind" in v && "original" in v) {
      const { original: _o, lenient: _l, ...date } = v;
      return date;
    }
    if (typeof v === "string" && idMap[v] && idMap[v] !== v) return idMap[v];
    return v;
  });
  return JSON.parse(json);
}

function roundTrip(file: string) {
  const first = parseGedcom(fixture(file));
  const written = writeGedcom(first.document, { now: NOW });
  const second = parseGedcom(written.bytes, { keepRaw: true });
  return { first, written, second };
}

describe("Roundtrip parse → write → parse", () => {
  it.each(["minimal-551.ged", "myheritage.ged", "torture.ged"])("%s ergibt dasselbe Modell", (file) => {
    const { first, second, written } = roundTrip(file);
    const noSubm = first.document.submitters.length === 0;
    expect(comparable(second.document, {}, noSubm)).toEqual(comparable(first.document, written.idMap, noSubm));
    expect(verifyLossless(second).lost).toEqual([]);
    // Genormte Datumstexte bleiben wörtlich, nachsichtige werden genormt.
    const dates = (d: GedcomDocument) => {
      const out: { original: string; lenient?: boolean }[] = [];
      JSON.stringify(d, (_k, v) => {
        if (v && typeof v === "object" && "kind" in v && "original" in v) out.push(v);
        return v;
      });
      return out;
    };
    const a = dates(first.document);
    const b = dates(second.document);
    expect(b).toHaveLength(a.length);
    a.forEach((d, i) => {
      if (!d.lenient) expect(b[i].original).toBe(d.original);
      else expect(b[i].lenient).toBeUndefined();
    });
  });

  it("MyHeritage-Datei: keine unbekannten Tags gehen verloren", () => {
    const { first, second, written } = roundTrip("myheritage.ged");
    const tags = (r: typeof first) => Object.fromEntries(r.unknownTags.map((u) => [u.tag, u.count]));
    const before = tags(first);
    const after = tags(second);
    // Kopf-Tags des früheren Programms (HEAD.SOUR._RTLSAVE) werden bewusst nicht übernommen.
    delete before._RTLSAVE;
    expect(after).toEqual(before);
    for (const t of ["_PARENTRIN", "_POSITION", "_PARENTPHOTO", "_MTTAG", "_PUBLISH", "_RINS", "_UNKNOWN_EVENT_TAG"]) {
      expect(written.text).toContain(t);
    }
    // Kennungen und Änderungsstempel bleiben erhalten
    expect(written.text).toContain("1 _UID 5F1A0000AAAA0001");
    expect(written.text).toContain("1 RIN MH:I1");
    expect(written.text).toContain("1 _UPD 2 MAR 2026 11:11:50 GMT+1");
    expect(written.text).toContain("2 _PHOTO_RIN MH:P500002");
    expect(written.text).toContain("1 _PROJECT_GUID 00000000-AAAA-BBBB-CCCC-000000000001");
  });

  it("GEDCOM 7 → 5.5.1: Inhalte bleiben, 7.0-Besonderheiten werden übersetzt", () => {
    const { first, second, written } = roundTrip("gedcom7.ged");
    expect(written.text).toContain("2 VERS 5.5.1");
    expect(written.text).not.toContain("@VOID@");
    const lena = (d: GedcomDocument) => d.persons.find((p) => p.id === "I1")!;
    expect(lena(second.document).events[0].date).toEqual(lena(first.document).events[0].date);
    expect(lena(second.document).privacy.restrictions).toEqual(["confidential", "locked"]);
    expect(lena(second.document).externalIds).toEqual(lena(first.document).externalIds);
    expect(second.document.notes[0].content).toEqual(first.document.notes[0].content);
    // SEX X gibt es in 5.5.1 nicht
    expect(second.document.persons.find((p) => p.id === "I2")!.sex).toBe("UNKNOWN");
  });
});

describe("Kopf und Format", () => {
  it("Kopf mit dieser App als Quelle, Pflicht-SUBM, TRLR, CRLF", () => {
    const { written } = roundTrip("minimal-551.ged");
    const lines = written.text.split("\r\n");
    expect(lines.slice(0, 9)).toEqual([
      "0 HEAD",
      "1 GEDC",
      "2 VERS 5.5.1",
      "2 FORM LINEAGE-LINKED",
      "1 CHAR UTF-8",
      "1 SOUR FAMILYTREE",
      "2 NAME Stammbaum",
      "1 DATE 19 NOV 2026",
      "2 TIME 12:00:00",
    ]);
    expect(written.text).toContain("1 SUBM @SUB1@");
    expect(lines.at(-2)).toBe("0 TRLR");
    expect(written.bytes[0]).toBe(0x30);
  });

  it("BOM auf Wunsch", () => {
    const doc = parseGedcom(fixture("minimal-551.ged")).document;
    const { bytes } = writeGedcom(doc, { bom: true, now: NOW });
    expect([...bytes.slice(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 0x30]);
    expect(parseGedcom(bytes).encoding).toMatchObject({ encoding: "UTF-8", bom: true });
  });

  it("ohne Einsender wird einer erzeugt", () => {
    const doc = parseGedcom("0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR").document;
    const { text } = writeGedcom(doc, { now: NOW, submitterName: "Testexport" });
    expect(text).toContain("1 SUBM @SUBM1@");
    expect(text).toContain("0 @SUBM1@ SUBM\r\n1 NAME Testexport");
  });

  it("lange Werte: CONC an Code-Point-Grenzen, nie an Leerzeichen, höchstens 255 Bytes", () => {
    const long = "Wört ".repeat(60) + "Ende😀" + "x".repeat(300) + "\nzweite Zeile";
    const doc = parseGedcom(`0 HEAD\n0 @I1@ INDI\n1 NOTE kurz\n0 TRLR`).document;
    doc.persons[0].notes[0].content = { text: long, isHtml: false };
    const { text } = writeGedcom(doc, { now: NOW });
    const lines = text.split("\r\n");
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(255);
    expect(lines.filter((l) => l.startsWith("2 CONC")).length).toBeGreaterThan(1);
    for (const l of lines.filter((x) => x.startsWith("2 CONC "))) expect(l[7]).not.toBe(" ");
    const back = parseGedcom(text).document.persons[0].notes[0].content!.text;
    expect(back).toBe(long);
  });

  it("splitForConc zerreißt weder Surrogatpaare noch @@", () => {
    const pieces = splitForConc("ab@@cd😀😀😀", 4);
    expect(pieces.join("")).toBe("ab@@cd😀😀😀");
    for (const p of pieces) {
      expect(p.endsWith("@") && !p.endsWith("@@")).toBe(false);
      expect(p).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });

  it("@ wird verdoppelt, Kalender-Escapes nicht", () => {
    expect(escapeValue("a@b.de")).toBe("a@@b.de");
    expect(escapeValue("@#DJULIAN@ 1 JAN 1700")).toBe("@#DJULIAN@ 1 JAN 1700");
  });

  it("ungültige Kennungen werden ersetzt, Verweise folgen", () => {
    const doc = parseGedcom(fixture("minimal-551.ged")).document;
    doc.persons[0].id = "cmabcdefghijklmnopqrstuvwxyz0123";
    doc.families[0].partners[0] = "cmabcdefghijklmnopqrstuvwxyz0123";
    const { text, idMap } = writeGedcom(doc, { now: NOW });
    const newId = idMap["cmabcdefghijklmnopqrstuvwxyz0123"];
    expect(newId).toMatch(/^I\d+$/);
    expect(text).toContain(`1 HUSB @${newId}@`);
    expect(text).not.toContain("cmabcdef");
  });

  it("Daten aus der Struktur ohne deutsche Monatsnamen", () => {
    const doc = parseGedcom("0 HEAD\n0 @I1@ INDI\n1 BIRT\n2 DATE 12. März 1850\n0 TRLR").document;
    const { text } = writeGedcom(doc, { now: NOW });
    expect(text).toContain("2 DATE 12 MAR 1850");
    expect(text).not.toMatch(/März|Mai|Okt|Dez/);
  });
});

describe("Familien und Beziehungen", () => {
  const persons = [
    { id: "A", sex: "MALE" as const },
    { id: "B", sex: "FEMALE" as const },
    { id: "C", sex: "FEMALE" as const },
    { id: "D", sex: "FEMALE" as const },
    { id: "K1", sex: "MALE" as const },
    { id: "K2", sex: "FEMALE" as const },
    { id: "K3", sex: "UNKNOWN" as const },
  ];
  const person = (id: string, sex: GedcomPerson["sex"]): GedcomPerson => ({
    id,
    names: [{ full: id, original: `${id} //`, given: id, marriedSurnames: [], aliases: [], variants: [], notes: [], citations: [], extensions: [] }],
    sex,
    events: [],
    notes: [],
    citations: [],
    media: [],
    externalIds: [],
    privacy: { restrictions: [], livingMarked: false, placeholderName: false, markers: [] },
    parentFamilies: [],
    spouseFamilies: [],
    extensions: [],
  });

  it("aus Beziehungen werden Familien (Rollen, Adoption + leibliche Eltern, Ein-Eltern, gleichgeschlechtlich)", () => {
    const families = familiesFromRelationships({
      persons,
      partnerships: [
        { personIds: ["B", "A"], status: "MARRIED" },
        { personIds: ["C", "D"], status: "UNMARRIED" },
        { personIds: ["A", "C"] },
      ],
      parentChild: [
        { parentId: "A", childId: "K1" },
        { parentId: "B", childId: "K1" },
        { parentId: "C", childId: "K1", kind: "ADOPTIVE" },
        { parentId: "D", childId: "K1", kind: "ADOPTIVE" },
        { parentId: "D", childId: "K2", kind: "BIOLOGICAL" },
        { parentId: "A", childId: "K3", kind: "STEP" },
        { parentId: "B", childId: "K3", kind: "BIOLOGICAL" },
      ],
    });
    const ab = families.find((f) => f.partners.includes("A") && f.partners.includes("B"))!;
    expect(ab.partners).toEqual(["A", "B"]); // Mann HUSB, Frau WIFE
    expect(ab.status).toBe("MARRIED");
    expect(ab.children.map((c) => [c.childId, c.kinds])).toEqual([
      ["K1", ["BIOLOGICAL", "BIOLOGICAL"]],
      ["K3", ["STEP", "BIOLOGICAL"]],
    ]);
    const cd = families.find((f) => f.partners.includes("C") && f.partners.includes("D"))!;
    expect(cd.partnerRoles).toEqual(["HUSB", "WIFE"]); // gleiches Geschlecht: nach Reihenfolge
    expect(cd.status).toBe("UNMARRIED");
    expect(cd.children[0]).toMatchObject({ childId: "K1", kinds: ["ADOPTIVE", "ADOPTIVE"] });
    expect(families.find((f) => f.partners.includes("A") && f.partners.includes("C"))!.status).toBe("UNKNOWN");
    const single = families.find((f) => f.partners.length === 1)!;
    expect(single).toMatchObject({ partners: ["D"], partnerRoles: ["WIFE"] });
    expect(single.children[0].childId).toBe("K2");

    // schreiben und wieder lesen: dieselben Beziehungen
    const doc: GedcomDocument = {
      header: { dialect: "UNKNOWN", majorVersion: 5, externalIds: [], extensions: [] },
      persons: persons.map((p) => person(p.id, p.sex)),
      families,
      sources: [],
      repositories: [],
      notes: [],
      media: [],
      submitters: [],
      unknownRecords: [],
    };
    const { text } = writeGedcom(doc, { now: NOW });
    expect(text).toContain("2 PEDI adopted");
    expect(text).toMatch(/2 _FREL Step\r\n2 _MREL Natural/);
    expect(text).toContain("1 _STAT Unmarried");
    const back = deriveRelationships(parseGedcom(text).document);
    const orig = deriveRelationships(doc);
    const key = (r: typeof orig) => ({
      partnerships: r.partnerships.map((p) => [p.personIds.join("+"), p.status]).sort(),
      parentChild: r.parentChild.map((l) => [l.parentId, l.childId, l.kind]).sort(),
    });
    expect(key(back)).toEqual(key(orig));
  });

  it("Status UNKNOWN und UNMARRIED bleiben im Roundtrip getrennt", () => {
    const text = [
      "0 HEAD",
      "0 @A@ INDI",
      "1 SEX M",
      "0 @B@ INDI",
      "1 SEX F",
      "0 @C@ INDI",
      "0 @D@ INDI",
      "0 @F1@ FAM",
      "1 HUSB @A@",
      "1 WIFE @B@",
      "1 ENGA",
      "2 DATE 1900",
      "0 @F2@ FAM",
      "1 HUSB @C@",
      "1 WIFE @D@",
      "1 _STAT Never Married",
      "0 TRLR",
    ].join("\n");
    const first = parseGedcom(text).document;
    expect(first.families.map((f) => [f.status, f.statusEvidence])).toEqual([
      ["UNKNOWN", "NO_MARRIAGE_EVENT"],
      ["UNMARRIED", "EXPLICIT"],
    ]);
    const second = parseGedcom(writeGedcom(first, { now: NOW }).text).document;
    expect(second.families.map((f) => f.status)).toEqual(["UNKNOWN", "UNMARRIED"]);
    expect(second.families[1].statusMarker).toEqual({ tag: "_STAT", value: "Never Married" });
  });
});
