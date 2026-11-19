import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkGedcom, formatReport } from "@/lib/gedcom/cli";
import { diagnoseGedcom } from "@/lib/gedcom/diagnostics";
import { diffDocuments } from "@/lib/gedcom/diff";
import { parseGedcom } from "@/lib/gedcom/parse";

const FIXTURES = path.resolve(__dirname, "fixtures", "gedcom");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));
const diag = (text: string) => diagnoseGedcom(parseGedcom(text).document);
const codes = (text: string) => diag(text).map((d) => d.code);

const G = (...lines: string[]) => ["0 HEAD", ...lines, "0 TRLR"].join("\n");

describe("diagnoseGedcom", () => {
  it("Person als eigener Vorfahre", () => {
    const d = diag(
      G("0 @A@ INDI", "1 FAMC @F2@", "1 FAMS @F1@", "0 @B@ INDI", "1 FAMC @F1@", "1 FAMS @F2@", "0 @F1@ FAM", "1 HUSB @A@", "1 CHIL @B@", "0 @F2@ FAM", "1 HUSB @B@", "1 CHIL @A@"),
    );
    const cyc = d.filter((x) => x.code === "OWN_ANCESTOR");
    expect(cyc).toHaveLength(1);
    expect(cyc[0]).toMatchObject({ severity: "error" });
    expect(cyc[0].personIds!.sort()).toEqual(["A", "B"]);
  });

  it("Kind älter als Elternteil, Kind lange nach Tod des Elternteils, Tod vor Geburt", () => {
    const text = G(
      "0 @P@ INDI",
      "1 BIRT",
      "2 DATE 1900",
      "1 DEAT",
      "2 DATE 1950",
      "1 FAMS @F@",
      "0 @K@ INDI",
      "1 BIRT",
      "2 DATE 1880",
      "1 FAMC @F@",
      "0 @L@ INDI",
      "1 BIRT",
      "2 DATE 1960",
      "1 DEAT",
      "2 DATE 1955",
      "1 FAMC @F@",
      "0 @F@ FAM",
      "1 HUSB @P@",
      "1 CHIL @K@",
      "1 CHIL @L@",
    );
    expect(codes(text)).toEqual(expect.arrayContaining(["CHILD_BORN_BEFORE_PARENT", "CHILD_BORN_AFTER_PARENT_DEATH", "DEATH_BEFORE_BIRTH"]));
  });

  it("ungenaue Daten: nur sichere Widersprüche", () => {
    const text = G("0 @P@ INDI", "1 BIRT", "2 DATE ABT 1900", "1 FAMS @F@", "0 @K@ INDI", "1 BIRT", "2 DATE 1899", "1 FAMC @F@", "0 @F@ FAM", "1 HUSB @P@", "1 CHIL @K@");
    expect(codes(text)).not.toContain("CHILD_BORN_BEFORE_PARENT");
  });

  it("Familie ohne Mitglieder, fehlende Datensätze, mehr als zwei leibliche Eltern, Selbstbezug", () => {
    const text = G(
      "0 @A@ INDI",
      "1 FAMS @F1@",
      "1 SOUR @S9@",
      "0 @B@ INDI",
      "1 FAMS @F1@",
      "0 @C@ INDI",
      "1 FAMS @F2@",
      "0 @D@ INDI",
      "1 FAMS @F2@",
      "0 @K@ INDI",
      "1 FAMC @F1@",
      "1 FAMC @F2@",
      "1 NOTE @N9@",
      "0 @F1@ FAM",
      "1 HUSB @A@",
      "1 WIFE @B@",
      "1 CHIL @K@",
      "0 @F2@ FAM",
      "1 HUSB @C@",
      "1 WIFE @D@",
      "1 CHIL @K@",
      "1 CHIL @C@",
      "0 @F3@ FAM",
      "0 @F4@ FAM",
      "1 HUSB @X@",
    );
    const d = diag(text);
    const c = d.map((x) => x.code);
    expect(c).toContain("EMPTY_FAMILY");
    expect(c).toContain("TOO_MANY_BIOLOGICAL_PARENTS");
    expect(c).toContain("SELF_RELATION");
    const missing = d.filter((x) => x.code === "MISSING_RECORD").map((x) => x.recordId).sort();
    expect(missing).toEqual(["N9", "S9", "X"]);
    for (const x of d) expect(x.message).toMatch(/[äöüÄÖÜß]|Familie|Person|Quelle|Notiz/);
  });

  it("Adoptiveltern zählen nicht als leibliche", () => {
    const text = G(
      "0 @A@ INDI",
      "0 @B@ INDI",
      "0 @C@ INDI",
      "0 @D@ INDI",
      "0 @K@ INDI",
      "1 FAMC @F1@",
      "1 FAMC @F2@",
      "2 PEDI adopted",
      "0 @F1@ FAM",
      "1 HUSB @A@",
      "1 WIFE @B@",
      "1 CHIL @K@",
      "0 @F2@ FAM",
      "1 HUSB @C@",
      "1 WIFE @D@",
      "1 CHIL @K@",
    );
    expect(codes(text)).not.toContain("TOO_MANY_BIOLOGICAL_PARENTS");
  });

  it("doppelte _UID, Privatsphäre-Hinweis, verändert die Daten nicht", () => {
    const doc = parseGedcom(fixture("myheritage.ged")).document;
    doc.persons[1].externalIds.push({ type: "UID", value: "5F1A0000AAAA0001" });
    const before = JSON.stringify(doc);
    const d = diagnoseGedcom(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(d.map((x) => x.code)).toEqual(expect.arrayContaining(["DUPLICATE_UID", "PRIVACY_MARKED"]));
  });

  it("MyHeritage-Fixture ohne Fehler", () => {
    expect(diagnoseGedcom(parseGedcom(fixture("myheritage.ged")).document).filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("diffDocuments", () => {
  it("erkennt Datensätze über _UID wieder, auch bei neuen Xrefs", () => {
    const a = parseGedcom(fixture("myheritage.ged")).document;
    // neuer Export: Xrefs umnummeriert, eine Person geändert, eine neu, eine entfernt
    const text = fixture("myheritage.ged")
      .toString("utf8")
      .replace(/@I(\d)@/g, "@P$1@")
      .replace("2 DATE 5 MAY 1855", "2 DATE 6 MAY 1855")
      .replace("1 _UPD 2 MAR 2026 11:13:00 GMT+1", "1 _UPD 4 MAR 2026 09:00:00 GMT+1")
      .replace(/0 @P8@ INDI[\s\S]*?(?=0 @F1@ FAM)/, "0 @P9@ INDI\n1 _UID NEU0000000000001\n1 NAME Neu /Person/\n")
      .replace("1 HUSB @P8@", "");
    const b = parseGedcom(text).document;
    const d = diffDocuments(a, b);
    expect(d.persons.added.map((x) => x.id)).toEqual(["P9"]);
    expect(d.persons.removed.map((x) => x.id)).toEqual(["I8"]);
    expect(d.persons.changed).toEqual([{ key: { by: "UID", value: "5F1A0000AAAA0002" }, idA: "I2", idB: "P2", fields: ["events"] }]);
    expect(d.persons.touched.map((x) => x.idA)).toEqual(["I3"]);
    expect(d.persons.unchanged).toBe(5);
    expect(d.families.changed.map((x) => [x.idA, x.fields])).toEqual([["F4", ["children", "partnerRoles", "partners"]]]);
  });

  it("ohne _UID: RIN, sonst Xref", () => {
    const a = parseGedcom(G("0 @I1@ INDI", "1 RIN 77", "0 @I2@ INDI")).document;
    const b = parseGedcom(G("0 @X@ INDI", "1 RIN 77", "0 @I2@ INDI", "1 SEX M")).document;
    const d = diffDocuments(a, b);
    expect(d.persons.unchanged).toBe(1);
    expect(d.persons.changed).toMatchObject([{ key: { by: "XREF", value: "I2" }, fields: ["sex"] }]);
  });
});

describe("Prüfprogramm (gedcom:check)", () => {
  it("gibt ohne --show-names keine Namen, Orte oder Texte aus", () => {
    const report = checkGedcom(fixture("myheritage.ged"), "myheritage.ged");
    const text = formatReport(report);
    for (const secret of ["Hans", "Mustermann", "Musterdorf", "Ortsvorsteher", "Lungenentzündung", "example.invalid", "Erika"]) {
      expect(text).not.toContain(secret);
      expect(JSON.stringify(report)).not.toContain(secret);
    }
    expect(text).toContain("MYHERITAGE");
    expect(text).toContain("_PARENTRIN");
    expect(text).toContain("0 verloren");
    expect(report.roundTrip.equalRecords).toBe(true);
    expect(report.identity["persons with UID"]).toBe(8);
  });

  it("--show-names ergänzt Namen bei Diagnosen", () => {
    const bytes = new TextEncoder().encode(G("0 @A@ INDI", "1 NAME Otto /Probe/", "1 BIRT", "2 DATE 1900", "1 DEAT", "2 DATE 1800"));
    const report = checkGedcom(bytes, "x.ged", { showNames: true });
    expect(formatReport(report)).toContain("Otto Probe");
  });

  it("--compare zählt Änderungen gegenüber einem älteren Export", () => {
    const report = checkGedcom(fixture("myheritage.ged"), "neu.ged", { compareWith: fixture("myheritage.ged") });
    expect(report.compare!.persons).toMatchObject({ added: [], removed: [], changed: [], unchanged: 8 });
    expect(formatReport(report)).toContain("Vergleich mit älterem Export");
  });
});
