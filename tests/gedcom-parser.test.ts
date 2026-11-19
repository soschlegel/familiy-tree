import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { decodeAnsel, encodeAnsel } from "@/lib/gedcom/ansel";
import { verifyLossless } from "@/lib/gedcom/lossless";
import { parseGedcom, readGedcomTree } from "@/lib/gedcom/parse";

const FIXTURES = path.resolve(__dirname, "fixtures", "gedcom");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

const SMALL = ["0 HEAD", "1 CHAR UTF-8", "0 @I1@ INDI", "1 NAME Jörg /Prüfer/", "1 NOTE Eins", "2 CONT Zwei", "0 TRLR", ""];

function utf16(text: string, le: boolean, bom: boolean): Uint8Array {
  const out: number[] = bom ? (le ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (le) out.push(c & 0xff, c >> 8);
    else out.push(c >> 8, c & 0xff);
  }
  return Uint8Array.from(out);
}

const nameOf = (bytes: Uint8Array | string) => parseGedcom(bytes).document.persons[0]?.names[0]?.full;

describe("Zeilenenden", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("%s ergibt denselben Baum", (_label, eol) => {
    const r = readGedcomTree(SMALL.join(eol));
    expect(r.records.map((x) => x.tag)).toEqual(["HEAD", "INDI", "TRLR"]);
    expect(r.records[1].children[1].value).toBe("Eins\nZwei");
    expect(r.stats.lines).toBe(7);
  });

  it("gemischte Zeilenenden", () => {
    const text = "0 HEAD\r\n1 CHAR UTF-8\n0 @I1@ INDI\r1 NAME A /B/\r\n0 TRLR";
    const r = readGedcomTree(text);
    expect(r.records).toHaveLength(3);
    expect(r.warnings).toEqual([]);
  });
});

describe("Zeichensätze", () => {
  it("UTF-8 mit BOM", () => {
    const bytes = new TextEncoder().encode("﻿" + SMALL.join("\r\n"));
    const r = parseGedcom(bytes);
    expect(r.encoding).toMatchObject({ encoding: "UTF-8", bom: true, detectedBy: "BOM" });
    expect(r.document.persons[0].names[0].full).toBe("Jörg Prüfer");
  });

  it.each([
    ["UTF-16LE mit BOM", true, true],
    ["UTF-16BE mit BOM", false, true],
    ["UTF-16LE ohne BOM", true, false],
    ["UTF-16BE ohne BOM", false, false],
  ])("%s", (_l, le, bom) => {
    const text = SMALL.join("\r\n").replace("CHAR UTF-8", "CHAR UNICODE");
    const r = parseGedcom(utf16(text, le, bom));
    expect(r.encoding.encoding).toBe(le ? "UTF-16LE" : "UTF-16BE");
    expect(r.encoding.bom).toBe(bom);
    expect(r.document.persons[0].names[0].full).toBe("Jörg Prüfer");
  });

  it("ANSEL: Umlaute als kombinierende Zeichen vor dem Grundbuchstaben, ß", () => {
    // ä = E8 61, Ö = E8 4F, ß = CF (GEDCOM) bzw. C7 (MARC 21), é = E2 65
    const bytes = Uint8Array.from([0xe8, 0x61, 0x20, 0xe8, 0x4f, 0x20, 0xcf, 0x20, 0xc7, 0x20, 0xe2, 0x65, 0x0a]);
    expect(decodeAnsel(bytes).text).toBe("ä Ö ß ß é\n");
  });

  it("ANSEL-Datei laut CHAR, Roundtrip über encodeAnsel", () => {
    const text = SMALL.join("\r\n").replace("CHAR UTF-8", "CHAR ANSEL").replace("Jörg /Prüfer/", "Jörg /Größe-Müller/");
    const bytes = encodeAnsel(text);
    expect(bytes.includes(0xe8)).toBe(true); // Umlaut als ANSEL-Trema
    const r = parseGedcom(bytes);
    expect(r.encoding).toMatchObject({ encoding: "ANSEL", declared: "ANSEL", detectedBy: "CHAR" });
    expect(r.document.persons[0].names[0].full).toBe("Jörg Größe-Müller");
    expect(r.warnings).toEqual([]);
  });

  it("ANSEL angegeben, Inhalt ist UTF-8 → UTF-8 mit Warnung", () => {
    const bytes = new TextEncoder().encode(SMALL.join("\n").replace("CHAR UTF-8", "CHAR ANSEL"));
    const r = parseGedcom(bytes);
    expect(r.encoding.encoding).toBe("UTF-8");
    expect(r.warnings.map((w) => w.code)).toContain("ENCODING_MISMATCH");
    expect(nameOf(bytes)).toBe("Jörg Prüfer");
  });

  it("UTF-8 angegeben, Inhalt ist Windows-1252 → Rückfall mit Warnung", () => {
    const text = SMALL.join("\n");
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const r = parseGedcom(bytes);
    expect(r.encoding.encoding).toBe("WINDOWS-1252");
    expect(r.warnings.map((w) => w.code)).toContain("ENCODING_MISMATCH");
    expect(r.document.persons[0].names[0].full).toBe("Jörg Prüfer");
  });

  it.each(["ANSI", "IBM WINDOWS", "ASCII"])("CHAR %s → Windows-1252", (charset) => {
    const text = SMALL.join("\n").replace("CHAR UTF-8", `CHAR ${charset}`);
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    expect(nameOf(bytes)).toBe("Jörg Prüfer");
  });

  it("ohne CHAR: gültiges UTF-8 bleibt UTF-8, sonst Windows-1252", () => {
    const text = SMALL.filter((l) => !l.includes("CHAR")).join("\n");
    expect(parseGedcom(new TextEncoder().encode(text)).encoding).toMatchObject({ encoding: "UTF-8", detectedBy: "DEFAULT" });
    const latin = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const r = parseGedcom(latin);
    expect(r.encoding.encoding).toBe("WINDOWS-1252");
    expect(r.warnings.map((w) => w.code)).toContain("ENCODING_FALLBACK");
    expect(nameOf(latin)).toBe("Jörg Prüfer");
  });

  it("MACINTOSH", () => {
    const text = SMALL.join("\r").replace("CHAR UTF-8", "CHAR MACINTOSH").replace("Jörg", "Jorg");
    expect(nameOf(new TextEncoder().encode(text))).toBe("Jorg Prüfer");
  });
});

describe("CONC/CONT und @@", () => {
  it("CONC hängt ohne Leerzeichen an, führende Leerzeichen bleiben", () => {
    const r = readGedcomTree("0 @N1@ NOTE Anfang\n1 CONC  mitte\n1 CONC ende\n1 CONT neue Zeile\n1 CONT\n0 TRLR");
    expect(r.records[0].value).toBe("Anfang mitteende\nneue Zeile\n");
    expect(r.stats.continuationLines).toBe(4);
  });

  it("5.5.1: @@ wird überall zu @, Kalender-Escapes bleiben", () => {
    const r = readGedcomTree("0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 EMAIL a@@b.de\n1 BIRT\n2 DATE @#DJULIAN@ 1700\n0 TRLR");
    expect(r.records[1].children[0].value).toBe("a@b.de");
    expect(r.records[1].children[1].children[0].value).toBe("@#DJULIAN@ 1700");
  });

  it("7.0: nur führendes @@ wird aufgelöst", () => {
    const r = readGedcomTree("0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NOTE @@start und a@@b\n0 TRLR");
    expect(r.majorVersion).toBe(7);
    expect(r.records[1].children[0].value).toBe("@start und a@@b");
  });
});

describe("Defekte aus der Praxis", () => {
  const torture = () => parseGedcom(fixture("torture.ged"), { keepRaw: true });

  it("liefert Warnungen mit Zeilennummern statt Ausnahmen", () => {
    const r = torture();
    const codes = new Set(r.warnings.map((w) => w.code));
    for (const c of [
      "MISSING_TRLR",
      "DUPLICATE_XREF",
      "LINE_WITHOUT_LEVEL",
      "MISSING_DELIMITER",
      "TAB_DELIMITER",
      "LEADING_WHITESPACE",
      "POINTER_WITH_TRAILING_TEXT",
      "DANGLING_POINTER",
    ]) {
      expect(codes, c).toContain(c);
    }
    const dup = r.warnings.find((w) => w.code === "DUPLICATE_XREF")!;
    expect(dup.line).toBeGreaterThan(1);
    expect(r.document.persons.map((p) => p.id)).toContain("I6~2");
  });

  it("Zeile ohne Ebene wird an die vorige Zeile angehängt", () => {
    const r = torture();
    const grete = r.document.persons.find((p) => p.id === "I3")!;
    expect(grete.notes[0].content!.text).toBe("Eine Notiz\ndie ohne CONT umgebrochen wurde\n1850 zog sie fort");
  });

  it("überlange Zeilen, Ebenensprünge, Text nach Ebene 0 ohne Tag", () => {
    const long = "x".repeat(400);
    const r = parseGedcom(`0 HEAD\n0 @I1@ INDI\n1 NOTE ${long}\n3 _DEEP tief\n0 TRLR`, { keepRaw: true });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("LINE_TOO_LONG");
    expect(codes).toContain("LEVEL_JUMP");
    expect(r.document.persons[0].notes[0].content!.text).toBe(long);
    expect(verifyLossless(r).lost).toEqual([]);
  });

  it("MyHeritage: „0  _PUBLISH“ mit doppeltem Leerzeichen", () => {
    const r = parseGedcom(fixture("myheritage.ged"));
    expect(r.warnings.map((w) => w.code)).toContain("EXTRA_WHITESPACE");
    expect(r.document.unknownRecords.map((n) => n.tag)).toContain("_PUBLISH");
    const pub = r.document.unknownRecords.find((n) => n.tag === "_PUBLISH")!;
    expect(pub.children[0].value).toBe("beispiel@example.invalid");
  });

  it("Tabs, fehlende Trenner und leere Zeilen", () => {
    const r = readGedcomTree("0 HEAD\n\n1GEDC\n2\tVERS\t5.5.1\n0 @I1@INDI\n1 NAME A /B/\n0 TRLR\n");
    expect(r.records[0].children[0].tag).toBe("GEDC");
    expect(r.records[0].children[0].children[0].value).toBe("5.5.1");
    expect(r.records[1]).toMatchObject({ tag: "INDI", xref: "I1" });
    expect(r.stats.blankLines).toBe(1);
  });

  it("Zeilen vor dem ersten Datensatz werden verworfen und gezählt", () => {
    const r = parseGedcom("Müll am Anfang\n1 VERS 1\n0 HEAD\n0 TRLR", { keepRaw: true });
    expect(r.stats.skippedLines).toBe(2);
    expect(r.warnings.map((w) => w.code)).toContain("MALFORMED_LINE");
    expect(verifyLossless(r).linesBalanced).toBe(true);
  });

  it("Warnungen werden je Art gekappt und gezählt", () => {
    const lines = ["0 HEAD", "0 @I1@ INDI"];
    for (let i = 0; i < 50; i++) lines.push(`1 FAMC @F${i}@`);
    const r = parseGedcom(lines.join("\n"), { warningCap: 10 });
    const dangling = r.warnings.filter((w) => w.code === "DANGLING_POINTER");
    expect(dangling).toHaveLength(11);
    expect(dangling[10].message).toContain("insgesamt 50");
  });
});

describe("Verlustfreiheit", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".ged"));
  it.each(files)("%s: jede Zeile verstanden oder erhalten", (file) => {
    const r = parseGedcom(fixture(file), { keepRaw: true });
    const report = verifyLossless(r);
    expect(report.lost).toEqual([]);
    expect(report.linesBalanced).toBe(true);
    expect(report.consumed + report.preserved).toBeGreaterThanOrEqual(report.nodes);
  });

  it("erhält Unbekanntes auf jeder Ebene mit Pfad", () => {
    const r = parseGedcom(fixture("torture.ged"));
    const paths = new Set(r.unknownTags.flatMap((u) => Object.keys(u.paths)));
    for (const p of [
      "HEAD._HEADER_CUSTOM",
      "INDI._INDI_CUSTOM",
      "INDI.NAME._NAME_CUSTOM",
      "INDI.BIRT.PLAC._PLACE_CUSTOM",
      "INDI.CHR.DATE._DATE_CUSTOM",
      "FAM._FAM_CUSTOM",
      "FAM.CHIL._CHIL_CUSTOM",
      "_CUSTOM_RECORD",
      "INDI.ASSO",
    ]) {
      expect(paths, p).toContain(p);
    }
    const custom = r.unknownTags.find((u) => u.tag === "_INDI_CUSTOM")!;
    expect(custom).toMatchObject({ count: 1, examplePath: "INDI._INDI_CUSTOM" });
    const ext = r.document.persons[0].extensions.find((e) => e.node.tag === "_INDI_CUSTOM")!;
    expect(ext.path).toEqual([]);
    expect(ext.node.children[0]).toMatchObject({ tag: "_NESTED", value: "zwei" });
  });
});
