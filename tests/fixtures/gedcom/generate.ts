/**
 * Erzeugt große synthetische GEDCOM-Dateien (MyHeritage-Stil) für
 * Leistungsmessungen. Deterministisch (fester Zufallsstartwert), erfundene
 * Namen. Wird nicht als Datei eingecheckt.
 *
 *   npx tsx tests/fixtures/gedcom/generate.ts 100000 > gross.ged
 */

const GIVEN_M = ["Hans", "Karl", "Josef", "Johann", "Franz", "Georg", "Anton", "Michael", "Peter", "Paul"];
const GIVEN_F = ["Maria", "Anna", "Theresia", "Katharina", "Elisabeth", "Barbara", "Rosa", "Agnes", "Magdalena", "Johanna"];
const SURNAMES = ["Mustermann", "Beispiel", "Probe", "Testmann", "Fiktiv", "Erfunden", "Muster", "Platzhalter", "Demo", "Ausgedacht"];
const PLACES = ["Musterdorf", "Beispielstadt", "Probstadt", "Testhausen", "Fiktivingen", "Demobach"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function generateLargeGedcom(individuals: number, seed = 42): string {
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const out: string[] = [
    "0 HEAD",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
    "1 LANG German",
    "1 SOUR MYHERITAGE",
    "2 NAME MyHeritage Family Tree Builder",
    "2 VERS 5.5.1",
    "2 _RTLSAVE RTL",
    "1 SUBM @U1@",
    "0 @U1@ SUBM",
    "1 NAME Generator",
  ];
  const sources = Math.max(1, Math.floor(individuals / 200));
  const families = Math.floor(individuals / 3);
  const famcOf = (i: number) => ((i * 7919) % families) + 1;
  const date = (y: number) => {
    const k = r();
    if (k < 0.6) return `${1 + Math.floor(r() * 28)} ${pick(MONTHS)} ${y}`;
    if (k < 0.8) return String(y);
    if (k < 0.9) return `ABT ${y}`;
    return `BET ${y} AND ${y + 2}`;
  };
  for (let i = 1; i <= individuals; i++) {
    const male = r() < 0.5;
    const by = 1700 + Math.floor(r() * 300);
    const sur = pick(SURNAMES);
    out.push(
      `0 @I${i}@ INDI`,
      `1 RIN MH:I${i}`,
      `1 _UID ${(0x10000000 + i).toString(16).toUpperCase()}AAAA${i.toString(16).padStart(8, "0").toUpperCase()}`,
      `1 _UPD 2 MAR 2026 11:11:50 GMT+1`,
      `1 NAME ${male ? pick(GIVEN_M) : pick(GIVEN_F)} /${sur}/`,
      `2 GIVN ${male ? pick(GIVEN_M) : pick(GIVEN_F)}`,
      `2 SURN ${sur}`,
    );
    if (!male && r() < 0.5) out.push(`2 _MARNM ${pick(SURNAMES)}`);
    out.push(`1 SEX ${male ? "M" : "F"}`, "1 BIRT", `2 DATE ${date(by)}`, `2 PLAC ${pick(PLACES)}, Bayern, Deutschland`);
    if (r() < 0.5) {
      out.push(`2 SOUR @S${1 + Math.floor(r() * sources)}@`, `3 PAGE Seite ${Math.floor(r() * 400)}`, "3 QUAY 3");
    }
    if (by < 1950) out.push("1 DEAT", `2 DATE ${date(by + 20 + Math.floor(r() * 70))}`, `2 PLAC ${pick(PLACES)}`);
    if (r() < 0.3) out.push(`1 OCCU ${pick(["Landwirt", "Schmied", "Lehrer", "Bäcker", "Weber"])}`);
    if (r() < 0.1) {
      out.push(`1 NOTE ${"Eine längere Notiz mit Umlauten äöü und Text. ".repeat(4).trim()}`);
      out.push(`2 CONC  Fortsetzung der Notiz ${i}.`);
      out.push("2 CONT Zweite Zeile.");
    }
    if (r() < 0.05) {
      out.push("1 OBJE", "2 FORM jpg", `2 FILE https://example.invalid/photos/${i}.jpg`, "2 _PRIM Y", `2 _PHOTO_RIN MH:P${i}`);
    }
    const fams = Math.floor((i - 1) / 2) + 1;
    if (fams <= families) out.push(`1 FAMS @F${fams}@`);
    if (i > 2 * families && families > 0) out.push(`1 FAMC @F${famcOf(i)}@`);
  }
  // Kinder je Familie (dieselbe Zuordnung wie bei FAMC)
  const children = new Map<number, number[]>();
  for (let i = 2 * families + 1; i <= individuals && families > 0; i++) {
    const f = famcOf(i);
    const list = children.get(f) ?? [];
    list.push(i);
    children.set(f, list);
  }
  for (let f = 1; f <= families; f++) {
    out.push(`0 @F${f}@ FAM`, `1 RIN MH:F${f}`, `1 _UID F${f.toString(16).padStart(12, "0").toUpperCase()}`);
    out.push(`1 HUSB @I${2 * f - 1}@`, `1 WIFE @I${2 * f}@`);
    for (const c of children.get(f) ?? []) out.push(`1 CHIL @I${c}@`);
    if (r() < 0.6) out.push("1 MARR", `2 DATE ${date(1720 + Math.floor(r() * 280))}`, `2 PLAC ${pick(PLACES)}`);
  }
  for (let s = 1; s <= sources; s++) {
    out.push(`0 @S${s}@ SOUR`, `1 TITL Kirchenbuch ${pick(PLACES)} Band ${s}`, "1 _TYPE Kirchenbuch", "1 _UPD 2 MAR 2026 11:30:00 GMT+1");
  }
  out.push("0 TRLR", "");
  return out.join("\r\n");
}

const isMain = typeof process !== "undefined" && process.argv[1] && /generate\.ts$/.test(process.argv[1]);
if (isMain) {
  const n = Number(process.argv[2] ?? 1000);
  process.stdout.write(generateLargeGedcom(n));
}
