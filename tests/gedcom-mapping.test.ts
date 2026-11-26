/**
 * GEDCOM-Zwischenmodell → Massenimport (lib/gedcom-import): Namen, Daten,
 * Ereignisse, Beziehungen, Quellen, Belege, Schlüssel, Fotos, Rohdaten.
 * Reine Tests ohne Datenbank, nur erfundene Namen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseGedcom } from "@/lib/gedcom";
import { convertEventDate, convertGedcomDate, convertLifeDates } from "@/lib/gedcom-import/dates";
import { mapGedcomDocument, personKey, RAW_TYPES, recentWithoutDeath, sourceKind, UNKNOWN_GIVEN_NAME } from "@/lib/gedcom-import/mapping";
import { parseGedcomDate } from "@/lib/gedcom";

const NOW = new Date("2026-11-19T12:00:00Z");
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", "gedcom", name));

function ged(body: string): string {
  return ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", "1 CHAR UTF-8", body.trim(), "0 TRLR", ""].join("\n");
}
const map = (body: string) => mapGedcomDocument(parseGedcom(ged(body)).document, { now: NOW });

describe("Namen", () => {
  const cases: { name: string; body: string; expect: Partial<{ givenName: string; familyName: string | null; birthName: string | null; nickname: string | null; namePrefix: string | null; nameSuffix: string | null }>; names?: [string, string | null, string | null][] }[] = [
    {
      name: "_MARNM: heutiger Name = Ehename, Geburtsname = Nachname des NAME",
      body: "0 @I1@ INDI\n1 NAME Anna /Probe/\n2 GIVN Anna\n2 SURN Probe\n2 _MARNM Testmann",
      expect: { givenName: "Anna", familyName: "Testmann", birthName: "Probe" },
    },
    {
      name: "ohne Ehenamen: nur familyName",
      body: "0 @I1@ INDI\n1 NAME Otto /Probe/",
      expect: { givenName: "Otto", familyName: "Probe", birthName: null },
    },
    {
      name: "_MARNM gleich Geburtsname: kein birthName",
      body: "0 @I1@ INDI\n1 NAME Eva /Gleich/\n2 _MARNM Gleich",
      expect: { familyName: "Gleich", birthName: null },
    },
    {
      name: "mehrere _MARNM: erster ist heutiger Name, weitere werden Ehenamen",
      body: "0 @I1@ INDI\n1 NAME Rosa /Muster/\n2 _MARNM Erster\n2 _MARNM Zweiter",
      expect: { familyName: "Erster", birthName: "Muster" },
      names: [["MARRIED", "Rosa", "Zweiter"]],
    },
    {
      name: "zweiter NAME mit TYPE married (Gramps/Ancestry): heutiger Name, keine Doppelung",
      body: "0 @I1@ INDI\n1 NAME Lina /Geboren/\n2 TYPE birth\n1 NAME Lina /Verheiratet/\n2 TYPE married",
      expect: { familyName: "Verheiratet", birthName: "Geboren" },
      names: [],
    },
    {
      name: "Hauptname mit TYPE married, Geburtsname als zweiter NAME",
      body: "0 @I1@ INDI\n1 NAME Ida /Ehe/\n2 TYPE married\n1 NAME Ida /Geburt/\n2 TYPE birth",
      expect: { familyName: "Ehe", birthName: "Geburt" },
      names: [["BIRTH", "Ida", "Geburt"]],
    },
    {
      name: "bevorzugter Name (_PRIM Y) schlägt die Reihenfolge",
      body: "0 @I1@ INDI\n1 NAME Alt /Erst/\n1 NAME Neu /Zweit/\n2 _PRIM Y",
      expect: { givenName: "Neu", familyName: "Zweit" },
      names: [["VARIANT", "Alt", "Erst"]],
    },
    {
      name: "Namenszusatz (SPFX) wird nicht verdoppelt, Titel, Rufname, Zusatz",
      body: "0 @I1@ INDI\n1 NAME Karl /Stein/\n2 NPFX Dr.\n2 GIVN Karl\n2 SPFX von\n2 SURN Stein\n2 NSFX jun.\n2 NICK Kalle",
      expect: { familyName: "von Stein", namePrefix: "Dr.", nameSuffix: "jun.", nickname: "Kalle" },
    },
    {
      name: "ohne Vornamen: N.N.",
      body: "0 @I1@ INDI\n1 NAME /Nachname/",
      expect: { givenName: UNKNOWN_GIVEN_NAME, familyName: "Nachname" },
    },
    {
      name: "ganz ohne NAME",
      body: "0 @I1@ INDI\n1 SEX F",
      expect: { givenName: UNKNOWN_GIVEN_NAME, familyName: null },
    },
    {
      name: "_AKA wird Alias",
      body: "0 @I1@ INDI\n1 NAME Hans /Probe/\n2 _AKA Johannes /Probe/",
      expect: { givenName: "Hans" },
      names: [["ALIAS", "Johannes", "Probe"]],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const m = map(c.body);
      expect(m.persons[0]).toMatchObject(c.expect);
      if (c.names) expect(m.names.map((n) => [n.type, n.givenName, n.familyName])).toEqual(c.names);
    });
  }

  it("fehlender Vorname wird vermerkt", () => {
    expect(map("0 @I1@ INDI\n1 NAME /X/").notes.map((n) => n.code)).toContain("NAME_MISSING");
  });
});

describe("Daten", () => {
  const cases: [string, Record<string, unknown> | null, boolean][] = [
    ["12 MAR 1850", { date: "1850-03-12", precision: "DAY", qualifier: "EXACT" }, false],
    ["MAR 1850", { date: "1850-03", precision: "MONTH", qualifier: "EXACT" }, false],
    ["ABT 1850", { date: "1850", precision: "YEAR", qualifier: "ABOUT" }, false],
    ["CAL 1850", { date: "1850", qualifier: "CALCULATED" }, false],
    ["EST 1850", { date: "1850", qualifier: "ESTIMATED" }, false],
    ["BEF 1900", { date: "1900", qualifier: "BEFORE" }, false],
    ["AFT 1900", { date: "1900", qualifier: "AFTER" }, false],
    ["BET 1850 AND 1855", { date: "1850", qualifier: "BETWEEN", to: "1855", toPrecision: "YEAR" }, false],
    ["FROM 1880 TO 1905", { date: "1880", qualifier: "PERIOD", to: "1905" }, false],
    ["FROM 1880", { date: "1880", qualifier: "PERIOD" }, false],
    ["TO 1905", { date: "1905", qualifier: "UNTIL" }, false],
    ["@#DJULIAN@ 1 MAR 1699", { date: "1699-03-11", qualifier: "EXACT", phrase: "@#DJULIAN@ 1 MAR 1699" }, true],
    ["1749/50", { date: "1750", phrase: "1749/50" }, true],
    ["INT 1850 (laut Taufbuch)", { date: "1850", qualifier: "EXACT", phrase: "INT 1850 (laut Taufbuch)" }, true],
    ["(Weihnachten 1850)", { phrase: "(Weihnachten 1850)" }, true],
    ["unlesbar", { phrase: "unlesbar" }, true],
  ];
  for (const [text, expected, lossy] of cases) {
    it(`„${text}“`, () => {
      const c = convertGedcomDate(parseGedcomDate(text));
      if (expected) expect(c.value).toMatchObject(expected);
      else expect(c.value).toBeNull();
      expect(c.lossy).toBe(lossy);
    });
  }

  it("Jahr vor 1000 und Zukunft: nur als Wortlaut", () => {
    const early = convertEventDate(parseGedcomDate("850"), NOW);
    expect(early.value).toEqual({ phrase: "850" });
    expect(early.rejected).toMatch(/vor 1000/);
    const future = convertEventDate(parseGedcomDate("2090"), NOW);
    expect(future.value).toEqual({ phrase: "2090" });
  });

  it("Tod vor Geburt: Tod nur als Wortlaut, Geburt bleibt", () => {
    const r = convertLifeDates(parseGedcomDate("1900"), parseGedcomDate("1850"), NOW);
    expect(r.birth.value).toMatchObject({ date: "1900" });
    expect(r.death.value).toEqual({ phrase: "1850" });
  });
});

describe("Ereignisse und Hauptangaben", () => {
  const body = [
    "0 @I1@ INDI",
    "1 NAME Hans /Probe/",
    "1 BIRT",
    "2 DATE 1 JAN 1850",
    "2 PLAC Probstadt",
    "1 BIRT",
    "2 DATE 1851",
    "1 DEAT",
    "2 DATE 1910",
    "2 PLAC Musterdorf",
    "2 CAUS Fieber",
    "2 AGE 60y",
    "1 OCCU Schmied",
    "1 RESI",
    "2 ADDR Hauptstraße 1",
    "3 CITY Musterdorf",
    "1 EVEN",
    "2 TYPE Militärdienst",
    "1 EVEN",
    "1 FACT blau",
    "2 TYPE Augenfarbe",
    "1 SSN 123",
    "1 TITL Graf",
    "1 BAPM Y",
  ].join("\n");
  const m = map(body);
  it("Geburt/Tod an der Person, zweite Geburt als Alternative", () => {
    expect(m.persons[0]).toMatchObject({
      birth: { date: "1850-01-01" },
      birthPlace: "Probstadt",
      death: { date: "1910" },
      deathPlace: "Musterdorf",
      deathCause: "Fieber",
    });
    expect(m.events.filter((e) => e.type === "BIRTH")).toEqual([expect.objectContaining({ isAlternative: true, date: expect.objectContaining({ date: "1851" }) })]);
    expect(m.events.some((e) => e.type === "DEATH")).toBe(false);
  });
  it.each([
    ["OCCUPATION", { value: "Schmied" }],
    ["RESIDENCE", { address: "Hauptstraße 1\nMusterdorf" }],
    ["MILITARY_SERVICE", { label: "Militärdienst" }],
    ["ID_NUMBER", { value: "123", label: "Sozialversicherungsnummer" }],
    ["TITLE", { value: "Graf" }],
    ["BAPTISM", { value: null }],
  ])("%s", (type, fields) => {
    expect(m.events.find((e) => e.type === type)).toMatchObject(fields);
  });
  it("frei benannte Ereignisse brauchen eine Bezeichnung", () => {
    const custom = m.events.filter((e) => e.type === "CUSTOM");
    expect(custom.map((e) => e.label)).toEqual(["Ereignis", "Augenfarbe"]);
  });
  it("Schlüssel je Art laufend nummeriert", () => {
    expect(m.events.find((e) => e.type === "BIRTH")?.ref).toBe("XREF:I1/BIRTH#2");
  });
});

describe("Familien", () => {
  it("MyHeritage-Fixture: Status, Eltern-Kind-Arten, Ein-Eltern-Familie", () => {
    const m = mapGedcomDocument(parseGedcom(fixture("myheritage.ged")).document, { now: NOW });
    const partners = m.relationships.filter((r) => r.type === "PARTNER_OF");
    expect(partners.map((r) => r.subtype).sort()).toEqual(["DIVORCED", "MARRIED", "PARTNER_UNKNOWN"]);
    const married = partners.find((r) => r.subtype === "MARRIED")!;
    expect(married).toMatchObject({ start: { date: "1878-06-20" }, startPlace: expect.stringContaining("Musterdorf") });
    const divorced = partners.find((r) => r.subtype === "DIVORCED")!;
    expect(divorced).toMatchObject({ start: { date: "1892" }, end: { date: "1900" } });
    // Karl: adoptiert in F1 (beide), leiblich beim Vater aus F4 (Ein-Eltern-Familie)
    const karl = "UID:5F1A0000AAAA0004";
    const karlParents = m.relationships.filter((r) => r.type === "PARENT_OF" && r.toRef === karl).map((r) => r.subtype).sort();
    expect(karlParents).toEqual(["ADOPTIVE", "ADOPTIVE", "BIOLOGICAL"]);
    expect(m.relationships.filter((r) => r.toRef === "UID:5F1A0000AAAA0005").map((r) => r.subtype)).toEqual(["FOSTER", "FOSTER"]);
    // Familienereignis „Death of Spouse“ hängt an der Partnerschaft
    expect(m.events.find((e) => e.label === "Death of Spouse")).toMatchObject({ relationshipRef: married.ref, type: "CUSTOM" });
    // Ein-Eltern-Familie: Rohdaten am Elternteil
    expect(m.rawRecords.find((r) => r.recordType === RAW_TYPES.family && r.xref === "F4")).toMatchObject({ personRef: "UID:5F1A0000AAAA0008" });
  });

  it("Paar ohne Heirat: Ehestand unbekannt, nie unverheiratet", () => {
    const m = map("0 @I1@ INDI\n1 FAMS @F1@\n0 @I2@ INDI\n1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@");
    expect(m.relationships[0].subtype).toBe("PARTNER_UNKNOWN");
  });

  it("dasselbe Paar in zwei Familien: eine Partnerschaft, zweite Heirat als Alternative", () => {
    const m = map(
      "0 @I1@ INDI\n0 @I2@ INDI\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 DATE 1900\n0 @F2@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 DATE 1910",
    );
    expect(m.relationships.filter((r) => r.type === "PARTNER_OF")).toHaveLength(1);
    expect(m.events).toEqual([expect.objectContaining({ type: "MARRIAGE", isAlternative: true })]);
    expect(m.notes.map((n) => n.code)).toContain("DUPLICATE_COUPLE");
  });

  it("Eltern-Kind über zwei Familien nur einmal", () => {
    const m = map("0 @I1@ INDI\n0 @I3@ INDI\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I3@\n0 @F2@ FAM\n1 HUSB @I1@\n1 CHIL @I3@");
    expect(m.relationships.filter((r) => r.type === "PARENT_OF")).toHaveLength(1);
  });
});

describe("Quellen und Belege", () => {
  it.each([
    ["Kirchenbuch", "CHURCH_BOOK", null],
    ["Civil registration", "CIVIL_REGISTRY", null],
    ["Volkszählung", "CENSUS", null],
    ["Friedhof", "GRAVESTONE", null],
    ["Adressbuch", "OTHER", "Adressbuch"],
  ])("Art „%s“", (type, kind, label) => {
    expect(sourceKind(type, undefined)).toEqual({ kind, kindLabel: label });
  });

  it("Fixture: Quelle mit Archiv, Belege mit Angabe und Sicherheit", () => {
    const m = mapGedcomDocument(parseGedcom(fixture("myheritage.ged")).document, { now: NOW });
    expect(m.sources[0]).toMatchObject({ kind: "CHURCH_BOOK", author: "Pfarramt Musterdorf", repository: "Bistumsarchiv Beispielstadt", callNumber: "KB-MD-3" });
    const birth = m.citations.find((c) => c.fact === "BIRTH")!;
    expect(birth).toMatchObject({ detail: "Taufbuch 1850, S. 12, Nr. 7", confidence: "HIGH", text: "Hans, Sohn des Bauern ..." });
    expect(m.citations.find((c) => c.fact === "PARTNERSHIP")).toMatchObject({ confidence: "LOW" });
    expect(m.citations.find((c) => c.fact === "OTHER" && c.personRef)).toMatchObject({ confidence: "MEDIUM" });
  });

  it("eingebettete Quelle wird eigene Quelle; Beleg an Ereignis hat EVENT", () => {
    const m = map("0 @I1@ INDI\n1 BURI\n2 SOUR Grabstein auf dem Friedhof\n3 TEXT Inschrift");
    expect(m.sources).toHaveLength(1);
    expect(m.sources[0].ref).toMatch(/^INLINE:/);
    expect(m.citations[0]).toMatchObject({ fact: "EVENT", eventRef: m.events[0].ref, text: "Inschrift" });
  });
});

describe("Schlüssel, Fremdkennungen, Fotos, Rohdaten", () => {
  it("Schlüssel: _UID vor RIN vor Xref; doppelte UID fällt auf Xref zurück", () => {
    expect(personKey({ id: "I1", externalIds: [{ type: "RIN", value: "MH:I1" }, { type: "UID", value: "ab" }] })).toBe("UID:AB");
    expect(personKey({ id: "I1", externalIds: [{ type: "RIN", value: "MH:I1" }] })).toBe("RIN:MH:I1");
    const m = map("0 @I1@ INDI\n1 _UID X1\n0 @I2@ INDI\n1 _UID X1");
    expect(m.persons.map((p) => p.ref)).toEqual(["UID:X1", "XREF:I2"]);
  });

  it("Fixture: Fotos als Verweis, Fremdkennungen, Rohdaten je Träger, Privatsphäre", () => {
    const m = mapGedcomDocument(parseGedcom(fixture("myheritage.ged")).document, { now: NOW });
    expect(m.photos).toEqual([
      expect.objectContaining({ personRef: "UID:5F1A0000AAAA0001", key: "PHOTO:MH:P500002", primary: true, url: expect.stringMatching(/^https:/) }),
    ]);
    expect(m.externalIds.filter((x) => x.personRef === "UID:5F1A0000AAAA0001").map((x) => x.system).sort()).toEqual(["RIN", "UID"]);
    expect(m.externalIds.some((x) => x.eventRef === "UID:5F1A0000AAAA0101")).toBe(false); // Hauptangabe: Kennung bleibt im Original
    const types = m.rawRecords.map((r) => r.recordType);
    expect(types.filter((t) => t === RAW_TYPES.person)).toHaveLength(8);
    expect(types).toContain(RAW_TYPES.unknown); // _PUBLISH, _MTTAG
    expect(types).toContain(RAW_TYPES.submitter);
    const hans = m.rawRecords.find((r) => r.recordType === RAW_TYPES.person && r.xref === "I1")!;
    expect(JSON.stringify(hans.content)).toContain("_PARENTRIN");
    expect(JSON.stringify(hans.content)).toContain("Ortsvorsteher"); // geteilte Notiz kopiert
    expect(m.personMeta.filter((p) => p.privacyMarked)).toHaveLength(1);
  });

  it("lokale Dateipfade werden gezählt, nie als Foto geholt", () => {
    const m = map("0 @I1@ INDI\n1 OBJE\n2 FILE C:\\Bilder\\a.jpg\n2 FORM jpg");
    expect(m.photos).toHaveLength(0);
    expect(m.counts.localMediaPaths).toBe(1);
  });

  it("Personen ohne Tod, jünger als 100 Jahre (nur Zahl)", () => {
    const m = map("0 @I1@ INDI\n1 BIRT\n2 DATE 1990\n0 @I2@ INDI\n1 BIRT\n2 DATE 1850\n0 @I3@ INDI\n1 BIRT\n2 DATE 1980\n1 DEAT Y");
    expect(recentWithoutDeath(m.personMeta, NOW)).toBe(1);
  });

  it("alle Fixtures lassen sich abbilden", () => {
    for (const f of ["minimal-551.ged", "gedcom7.ged", "torture.ged", "myheritage.ged"]) {
      const m = mapGedcomDocument(parseGedcom(fixture(f)).document, { now: NOW });
      expect(m.persons.length).toBeGreaterThan(0);
      for (const p of m.persons) expect(p.givenName.length).toBeGreaterThan(0);
      const refs = m.events.map((e) => e.ref);
      expect(new Set(refs).size).toBe(refs.length);
    }
  });
});
