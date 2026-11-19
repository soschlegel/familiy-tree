/**
 * Kleine, sich überschneidende GEDCOM-Bäume für die Tests des
 * Zusammenführens (nur erfundene Namen). Jeder Aufruf bekommt eigene
 * _PROJECT_GUID, _UID und einen eigenen Familiennamen, damit sich Läufe nicht
 * mit den Mock-Daten oder älteren Läufen vermischen.
 */
import { randomUUID } from "node:crypto";

/** Zufälliger, aussprechbarer Familienname nur aus Buchstaben („Kelvaro“). */
export function randomSurname(): string {
  const c = "bdfgklmnprstvz";
  const v = "aeiou";
  let s = "";
  const bytes = randomUUID().replace(/-/g, "");
  for (let i = 0; i < 6; i++) {
    const n = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
    s += i % 2 === 0 ? c[n % c.length] : v[n % v.length];
  }
  return s[0].toUpperCase() + s.slice(1);
}

export type TreeIds = { guid: string; uid: string };
export const newTreeIds = (): TreeIds => {
  const id = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return { guid: `MERGE-${id}`, uid: `M${id}` };
};

type Indi = {
  key: string;
  given: string;
  surname: string;
  marriedName?: string;
  sex: "M" | "F";
  birth?: string;
  birthPlace?: string;
  death?: string;
  occupation?: string;
  famc?: string | string[];
  fams?: string[];
};
type Fam = { key: string; husb?: string; wife?: string; children: string[]; marr?: string; marrPlace?: string };

export function buildGedcom(ids: TreeIds, indis: Indi[], fams: Fam[], source = "Kirchenbuch Musterdorf"): string {
  const xref = (k: string) => `@${k}@`;
  const lines = [
    "0 HEAD",
    "1 GEDC",
    "2 VERS 5.5.1",
    "1 CHAR UTF-8",
    "1 SOUR MYHERITAGE",
    "2 NAME MyHeritage Family Tree Builder",
    `1 _PROJECT_GUID ${ids.guid}`,
  ];
  for (const p of indis) {
    lines.push(`0 ${xref(p.key)} INDI`, `1 _UID ${ids.uid}${p.key}`, `1 NAME ${p.given} /${p.surname}/`);
    if (p.marriedName) lines.push(`2 _MARNM ${p.marriedName}`);
    lines.push(`1 SEX ${p.sex}`);
    if (p.birth || p.birthPlace) {
      lines.push("1 BIRT");
      if (p.birth) lines.push(`2 DATE ${p.birth}`);
      if (p.birthPlace) lines.push(`2 PLAC ${p.birthPlace}`);
      lines.push("2 SOUR @S1@", "3 PAGE S. 7");
    }
    if (p.death) lines.push("1 DEAT", `2 DATE ${p.death}`);
    if (p.occupation) lines.push(`1 OCCU ${p.occupation}`);
    for (const f of [p.famc ?? []].flat()) lines.push(`1 FAMC ${xref(f)}`);
    for (const f of p.fams ?? []) lines.push(`1 FAMS ${xref(f)}`);
  }
  for (const f of fams) {
    lines.push(`0 ${xref(f.key)} FAM`, `1 _UID ${ids.uid}${f.key}`);
    if (f.husb) lines.push(`1 HUSB ${xref(f.husb)}`);
    if (f.wife) lines.push(`1 WIFE ${xref(f.wife)}`);
    for (const c of f.children) lines.push(`1 CHIL ${xref(c)}`);
    if (f.marr || f.marrPlace) {
      lines.push("1 MARR");
      if (f.marr) lines.push(`2 DATE ${f.marr}`);
      if (f.marrPlace) lines.push(`2 PLAC ${f.marrPlace}`);
    }
  }
  lines.push("0 @S1@ SOUR", `1 TITL ${source}`, "0 TRLR", "");
  return lines.join("\r\n");
}

/**
 * Zwei Exporte derselben Familie aus verschiedenen Stammbäumen:
 * A: Hans (genaues Geburtsdatum), Maria „Muster“ mit Ehename, Otto; Heirat 1878.
 * B: Hans („um 1850“), Maria nur unter dem Ehenamen, Otto, zusätzlich Lena;
 *    Partnerschaft ohne Heiratsangabe.
 */
export function overlappingPair(surname: string) {
  const a = newTreeIds();
  const b = newTreeIds();
  const fileA = buildGedcom(
    a,
    [
      { key: "I1", given: "Hans", surname, sex: "M", birth: "12 MAR 1850", birthPlace: "Probstadt", occupation: "Schmied", fams: ["F1"] },
      { key: "I2", given: "Maria", surname: "Muster", marriedName: surname, sex: "F", birth: "1855", fams: ["F1"] },
      { key: "I3", given: "Otto", surname, sex: "M", birth: "1880", famc: "F1" },
    ],
    [{ key: "F1", husb: "I1", wife: "I2", children: ["I3"], marr: "1878", marrPlace: "Probstadt" }],
  );
  const fileB = buildGedcom(
    b,
    [
      { key: "I7", given: "Hans", surname, sex: "M", birth: "ABT 1850", occupation: "Schmied", fams: ["F4"] },
      { key: "I8", given: "Maria", surname, sex: "F", birth: "1855", death: "1920", fams: ["F4"] },
      { key: "I9", given: "Otto", surname, sex: "M", birth: "1880", famc: "F4" },
      { key: "I10", given: "Lena", surname, sex: "F", birth: "1882", famc: "F4" },
    ],
    [{ key: "F4", husb: "I7", wife: "I8", children: ["I9", "I10"] }],
  );
  return { a, b, fileA, fileB };
}

/**
 * Ein Baum, in dem dieselbe Frau zweimal steht: einmal „Anna <Ehename> geb.
 * <Geburtsname>“, einmal nur unter dem Geburtsnamen — gleiche Daten, gleiche
 * Eltern.
 */
export function treeWithInnerDuplicate(birthSurname: string, marriedSurname: string) {
  const ids = newTreeIds();
  const file = buildGedcom(
    ids,
    [
      { key: "I1", given: "Karl", surname: birthSurname, sex: "M", birth: "1770", fams: ["F1"] },
      { key: "I2", given: "Anna", surname: birthSurname, marriedName: marriedSurname, sex: "F", birth: "2 APR 1801", famc: "F1", fams: ["F2"] },
      { key: "I3", given: "Anna", surname: birthSurname, sex: "F", birth: "2 APR 1801", birthPlace: "Musterdorf", famc: "F1" },
      { key: "I4", given: "Fritz", surname: marriedSurname, sex: "M", birth: "1798", fams: ["F2"] },
    ],
    [
      { key: "F1", husb: "I1", children: ["I2", "I3"] },
      { key: "F2", husb: "I4", wife: "I2", children: [], marr: "1825" },
    ],
  );
  return { ids, file };
}

/**
 * Ein Baum, dessen zweite Familie an einer Regel der App scheitert (Otto als
 * Partner seiner Mutter): der Rohdatensatz der Familie landet bei einer der
 * beiden Personen (recordType …:ABGELEHNT).
 */
export function treeWithRejectedFamily(surname: string) {
  const ids = newTreeIds();
  const file = buildGedcom(
    ids,
    [
      { key: "I1", given: "Karl", surname, sex: "M", birth: "1840", fams: ["F1"] },
      { key: "I2", given: "Liese", surname, sex: "F", birth: "1842", fams: ["F1", "F2"] },
      { key: "I3", given: "Otto", surname, sex: "M", birth: "1870", famc: "F1", fams: ["F2"] },
    ],
    [
      { key: "F1", husb: "I1", wife: "I2", children: ["I3"] },
      { key: "F2", husb: "I3", wife: "I2", children: [], marr: "1905", marrPlace: "Fernstadt" },
    ],
  );
  return { ids, file };
}
