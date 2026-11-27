/**
 * „Lebenslauf“ der Personenseite: Satzbildung aus lib/biography.ts und die
 * Eingabe aus den Daten der Personenseite (lib/biography-input.ts) — ohne
 * Datenbank. Alle Namen, Orte und Daten erfunden.
 */
import { describe, expect, it } from "vitest";

import { toFuzzyDate, type FuzzyDate } from "@/lib/dates";
import {
  ageAtDeath,
  buildBiography,
  dateInText,
  inPlace,
  numberWord,
  toPlace,
  type BioEvent,
  type BioPartnership,
  type BioRef,
  type BiographyInput,
} from "@/lib/biography";
import { biographyInputOf, siblingRankOf, type ParentEdge } from "@/lib/biography-input";
import type { PersonDetail } from "@/lib/services/persons";

const TODAY = { year: 2026, month: 11, day: 27 };

const day = (iso: string, q = "EXACT"): FuzzyDate => toFuzzyDate(iso, "DAY", q)!;
const month = (iso: string, q = "EXACT"): FuzzyDate => toFuzzyDate(`${iso}-01`, "MONTH", q)!;
const year = (y: number, q = "EXACT"): FuzzyDate => toFuzzyDate(`${y}-01-01`, "YEAR", q)!;
const range = (a: number, b: number, q: "BETWEEN" | "PERIOD"): FuzzyDate =>
  toFuzzyDate(`${a}-01-01`, "YEAR", q, `${b}-01-01`, "YEAR")!;

function ref(id: string, givenName: string, familyName: string | null, gender: BioRef["gender"], extra: Partial<BioRef> = {}): BioRef {
  return { id, givenName, familyName, birthName: null, gender, birth: null, death: null, ...extra };
}

function input(over: Omit<Partial<BiographyInput>, "person"> & { person?: Partial<BiographyInput["person"]> } = {}): BiographyInput {
  const { person, ...rest } = over;
  return {
    person: {
      givenName: "Anna",
      familyName: "Beispiel",
      birthName: null,
      nickname: null,
      namePrefix: null,
      nameSuffix: null,
      gender: "FEMALE",
      birth: null,
      birthPhrase: null,
      birthPlace: null,
      death: null,
      deathPhrase: null,
      deathPlace: null,
      deathCause: null,
      ...person,
    },
    otherNames: [],
    parents: [],
    siblingRank: null,
    partnerships: [],
    otherChildren: [],
    events: [],
    today: TODAY,
    ...rest,
  };
}

const ev = (type: BioEvent["type"], date: FuzzyDate | null, place: string | null = null, extra: Partial<BioEvent> = {}): BioEvent => ({
  type,
  label: null,
  date,
  phrase: null,
  place,
  value: null,
  ...extra,
});

function partnership(partner: BioRef, extra: Partial<BioPartnership> = {}): BioPartnership {
  return {
    partner,
    subtype: "MARRIED",
    start: null,
    startPhrase: null,
    startPlace: null,
    end: null,
    endPhrase: null,
    endPlace: null,
    events: [],
    children: [],
    ...extra,
  };
}

const text = (i: BiographyInput) => buildBiography(i)?.text ?? null;

const KARL = ref("p-karl", "Karl", "Beispiel", "MALE");
const ERNA = ref("p-erna", "Erna", "Beispiel", "FEMALE", { birthName: "Muster" });
const OTTO = ref("p-otto", "Otto", "Vorlage", "MALE", { death: year(1899) });

describe("Zahlen, Daten und Orte im Fließtext", () => {
  it("Zahlwörter bis zwölf, darüber Ziffern", () => {
    expect([1, 2, 7, 12, 13].map(numberWord)).toEqual(["eins", "zwei", "sieben", "zwölf", "13"]);
  });

  it("Daten in ihrer Genauigkeit und mit Zusatz", () => {
    expect(dateInText(day("1850-03-12"))).toBe("am 12. März 1850");
    expect(dateInText(month("1850-03"))).toBe("im März 1850");
    expect(dateInText(year(1850))).toBe("1850");
    expect(dateInText(year(1850, "ABOUT"))).toBe("um 1850");
    expect(dateInText(day("1850-03-12", "ABOUT"))).toBe("um den 12. März 1850");
    expect(dateInText(month("1850-03", "ABOUT"))).toBe("etwa im März 1850");
    expect(dateInText(day("1900-05-03", "BEFORE"))).toBe("vor dem 3. Mai 1900");
    expect(dateInText(year(1723, "AFTER"))).toBe("nach 1723");
    expect(dateInText(year(1850, "ESTIMATED"))).toBe("geschätzt 1850");
    expect(dateInText(year(1850, "CALCULATED"))).toBe("errechnet 1850");
    expect(dateInText(range(1850, 1855, "BETWEEN"))).toBe("zwischen 1850 und 1855");
    expect(dateInText(range(1901, 1910, "PERIOD"), "span")).toBe("von 1901 bis 1910");
    expect(dateInText(range(1901, 1910, "PERIOD"), "point")).toBe("zwischen 1901 und 1910");
    expect(dateInText(toFuzzyDate("1901-01-01", "YEAR", "PERIOD"), "span")).toBe("ab 1901");
    expect(dateInText(toFuzzyDate("1910-01-01", "YEAR", "UNTIL"), "span")).toBe("bis 1910");
    expect(dateInText(toFuzzyDate("1910-01-01", "YEAR", "UNTIL"), "point")).toBe("spätestens 1910");
    expect(dateInText(null)).toBeNull();
  });

  it("Präpositionen bei Orten, auch Länder mit Artikel", () => {
    expect(inPlace("Musterdorf")).toBe("in Musterdorf");
    expect(inPlace("Schweiz")).toBe("in der Schweiz");
    expect(inPlace("USA")).toBe("in den USA");
    expect(inPlace("Elsass")).toBe("im Elsass");
    expect(inPlace("Zürich, Schweiz")).toBe("in Zürich, Schweiz");
    expect(inPlace("bei Musterstadt")).toBe("bei Musterstadt");
    expect(toPlace("Musterstadt")).toBe("nach Musterstadt");
    expect(toPlace("USA")).toBe("in die USA");
    expect(toPlace("Schweiz")).toBe("in die Schweiz");
  });

  it("Alter beim Tod: genau, Jahr ungenau, „um“, zu unsicher", () => {
    expect(ageAtDeath(day("1850-03-12"), day("1921-05-03"))).toBe("im Alter von 71 Jahren");
    expect(ageAtDeath(day("1850-03-12"), day("1921-03-12"))).toBe("im Alter von 71 Jahren");
    expect(ageAtDeath(day("1850-03-12"), day("1921-03-11"))).toBe("im Alter von 70 Jahren");
    expect(ageAtDeath(day("1900-01-10"), day("1907-02-01"))).toBe("im Alter von sieben Jahren");
    expect(ageAtDeath(day("1900-01-10"), day("1901-02-01"))).toBe("im Alter von einem Jahr");
    expect(ageAtDeath(year(1850), year(1921))).toBe("im Alter von 70 oder 71 Jahren");
    expect(ageAtDeath(year(1850, "ABOUT"), day("1921-05-03"))).toBe("im Alter von etwa 71 Jahren");
    expect(ageAtDeath(day("1900-01-10"), day("1900-04-20"))).toBe("im Alter von drei Monaten");
    expect(ageAtDeath(day("1900-01-10"), day("1900-01-22"))).toBe("im Alter von zwölf Tagen");
    expect(ageAtDeath(day("1900-01-10"), day("1900-01-10"), "FEMALE")).toBe("am Tag ihrer Geburt");
    // Offen oder zu weit: kein Alter.
    expect(ageAtDeath(year(1850, "BEFORE"), year(1921))).toBeNull();
    expect(ageAtDeath(range(1840, 1855, "BETWEEN"), year(1921))).toBeNull();
    expect(ageAtDeath(null, year(1921))).toBeNull();
  });
});

describe("Lebenslauf: Sätze", () => {
  it("reich erfasste Verstorbene: Geburt mit Eltern und Stellung, Taufe, Ehe, Kinder, Tod", () => {
    const children = [
      ref("c1", "Paul", "Vorlage", "MALE"),
      ref("c2", "Marie", "Vorlage", "FEMALE"),
      ref("c3", "Frieda", "Neumann", "FEMALE"),
    ];
    const result = buildBiography(
      input({
        person: {
          familyName: "Vorlage",
          birthName: "Beispiel",
          birth: day("1850-03-12"),
          birthPlace: "Musterdorf",
          death: day("1921-05-03"),
          deathPlace: "Neustadt",
        },
        parents: [
          { person: ERNA, subtype: "BIOLOGICAL" },
          { person: KARL, subtype: "BIOLOGICAL" },
        ],
        siblingRank: { position: 3, total: 7 },
        events: [ev("BAPTISM", day("1850-03-20"), "Musterdorf"), ev("BURIAL", day("1921-05-07"), "Neustadt")],
        partnerships: [partnership(OTTO, { start: year(1874), startPlace: "Musterstadt", children })],
      }),
    )!;
    expect(result.text).toBe(
      "Anna Vorlage, geb. Beispiel, wurde am 12. März 1850 in Musterdorf als drittes von sieben Kindern von Karl Beispiel und Erna Beispiel, geb. Muster, geboren. " +
        "Am 20. März 1850 wurde sie dort getauft.\n\n" +
        "Sie heiratete 1874 in Musterstadt Otto Vorlage. Aus der Ehe gingen ein Sohn und zwei Töchter hervor: Paul, Marie und Frieda Neumann. " +
        "1899 starb ihr Mann.\n\n" +
        "Sie starb am 3. Mai 1921 im Alter von 71 Jahren in Neustadt. Am 7. Mai 1921 wurde sie dort beerdigt.",
    );
    // Namen anderer Personen sind Links (Textstücke mit personId).
    const links = result.paragraphs.flat().filter((s) => s.personId);
    expect(links.map((s) => [s.personId, s.text])).toEqual([
      ["p-karl", "Karl Beispiel"],
      ["p-erna", "Erna Beispiel"],
      ["p-otto", "Otto Vorlage"],
      ["c1", "Paul"],
      ["c2", "Marie"],
      ["c3", "Frieda Neumann"],
    ]);
  });

  it("Mann, ältestes Kind, Beruf ohne Datum, Todesursache nach der Beerdigung", () => {
    expect(
      text(
        input({
          person: { givenName: "Hans", familyName: "Muster", gender: "MALE", birth: year(1801), birthPlace: "Musterdorf", death: year(1870), deathCause: "Fieber" },
          parents: [
            { person: KARL, subtype: "BIOLOGICAL" },
            { person: ERNA, subtype: "BIOLOGICAL" },
          ],
          siblingRank: { position: 1, total: 2 },
          events: [ev("OCCUPATION", null, null, { value: "Schmied" }), ev("BURIAL", year(1870), "Musterdorf")],
        }),
      ),
    ).toBe(
      "Hans Muster wurde 1801 in Musterdorf als älteres von zwei Kindern von Karl Beispiel und Erna Beispiel, geb. Muster, geboren.\n\n" +
        "Er war als Schmied tätig.\n\n" +
        "1870 starb er im Alter von 68 oder 69 Jahren. Er wurde 1870 in Musterdorf beerdigt. Als Todesursache ist „Fieber“ vermerkt.",
    );
  });

  it("unbekanntes Geschlecht: Name statt „er/sie“, „Kind“", () => {
    const t = text(
      input({
        person: { givenName: "Kim", familyName: "Muster", gender: "UNKNOWN", birth: year(1900), birthPlace: "Musterdorf", death: year(1950) },
        parents: [{ person: KARL, subtype: "BIOLOGICAL" }],
        events: [ev("BAPTISM", year(1900), "Musterdorf")],
      }),
    )!;
    expect(t).toBe(
      "Kim Muster wurde 1900 in Musterdorf als Kind von Karl Beispiel geboren. 1900 wurde Kim dort getauft.\n\nKim starb 1950 im Alter von 49 oder 50 Jahren.",
    );
    expect(t).not.toMatch(/\b(er|sie|Er|Sie)\b/);
  });

  it("lebende Person: Präsens, kein Sterbesatz", () => {
    const t = text(
      input({
        person: { birth: day("1980-06-01"), birthPlace: "Musterstadt" },
        partnerships: [partnership(ref("p-paul", "Paul", "Beispiel", "MALE"), { start: day("2005-05-20"), startPlace: "Neustadt", children: [ref("k1", "Lena", "Beispiel", "FEMALE")] })],
        events: [ev("OCCUPATION", null, null, { value: "Lehrerin" })],
      }),
    );
    expect(t).toBe(
      "Anna Beispiel wurde am 1. Juni 1980 in Musterstadt geboren.\n\n" +
        "Als Beruf ist Lehrerin erfasst. Sie ist mit Paul Beispiel verheiratet; die Hochzeit war am 20. Mai 2005 in Neustadt. Aus der Ehe ging eine Tochter hervor: Lena.",
    );
    expect(t).not.toContain("starb");
  });

  it("ohne Geburtsdatum über 120 Jahre: Vergangenheit, aber kein Sterbesatz und kein Präsens", () => {
    const t = text(input({ person: { birth: year(1850) }, partnerships: [partnership(KARL, { start: year(1874) })] }))!;
    expect(t).toBe("Anna Beispiel wurde 1850 geboren.\n\n1874 heiratete sie Karl Beispiel.");
  });

  it("ungenaue Daten bleiben ungenau; Wortlaut ohne Datum in Klammern", () => {
    const t = text(
      input({
        person: { birth: year(1850, "ABOUT"), birthPlace: "Musterdorf", death: day("1900-05-03", "BEFORE") },
        events: [
          ev("CONFIRMATION", null, "Musterdorf", { phrase: "Palmsonntag, Jahr unbekannt" }),
          ev("RESIDENCE", range(1871, 1880, "PERIOD"), "Musterstadt"),
          ev("GRADUATION", range(1866, 1868, "BETWEEN"), "Neustadt", { value: "Gesellenprüfung" }),
        ],
      }),
    )!;
    expect(t).toBe(
      "Anna Beispiel wurde um 1850 in Musterdorf geboren. Sie wurde dort konfirmiert bzw. gefirmt (Datum: „Palmsonntag, Jahr unbekannt“).\n\n" +
        "Zwischen 1866 und 1868 machte sie in Neustadt einen Abschluss (Gesellenprüfung). Sie lebte von 1871 bis 1880 in Musterstadt.\n\n" +
        "Vor dem 3. Mai 1900 starb sie.",
    );
    expect(t).not.toMatch(/vermutlich|wohl|wahrscheinlich/);
  });

  it("fehlende Teile werden weggelassen, nicht umschrieben", () => {
    expect(text(input({ person: { birthPlace: "Musterdorf" } }))).toBe("Anna Beispiel wurde in Musterdorf geboren.");
    expect(
      text(
        input({
          person: { gender: "MALE", givenName: "Hans" },
          parents: [
            { person: KARL, subtype: "BIOLOGICAL" },
            { person: ERNA, subtype: "BIOLOGICAL" },
          ],
          siblingRank: { position: 2, total: 4 },
        }),
      ),
    ).toBe("Hans Beispiel war das zweite von vier Kindern von Karl Beispiel und Erna Beispiel, geb. Muster.");
    // Sterbeort ohne Datum, ohne Alter.
    expect(text(input({ person: { birth: year(1800), deathPlace: "Neustadt" } }))).toBe(
      "Anna Beispiel wurde 1800 geboren.\n\nSie starb in Neustadt.",
    );
  });

  it("mehrere Ehen: geschieden, dann zweite Ehe; Kinder je Ehe; Verlobung → „die beiden“", () => {
    const first = ref("p-1", "Fritz", "Erst", "MALE");
    const second = ref("p-2", "Gustav", "Zweit", "MALE", { death: year(1930) });
    const t = text(
      input({
        person: { birth: year(1880), death: year(1950), deathPlace: "Neustadt" },
        partnerships: [
          partnership(first, {
            subtype: "DIVORCED",
            start: year(1900),
            startPlace: "Musterdorf",
            end: year(1905),
            endPlace: "Musterstadt",
            children: [ref("k1", "Lotte", "Erst", "FEMALE")],
          }),
          partnership(second, {
            start: year(1910),
            events: [ev("ENGAGEMENT", year(1909), "Neustadt")],
            children: [ref("k2", "Max", "Zweit", "MALE"), ref("k3", "Ida", "Zweit", "FEMALE")],
          }),
        ],
      }),
    );
    expect(t).toBe(
      "Anna Beispiel wurde 1880 geboren.\n\n" +
        "1900 heiratete sie in Musterdorf Fritz Erst. Aus der Ehe ging eine Tochter hervor: Lotte. Die Ehe wurde 1905 in Musterstadt geschieden. " +
        "1909 verlobte sie sich in Neustadt mit Gustav Zweit. Die beiden heirateten 1910. Aus der Ehe gingen ein Sohn und eine Tochter hervor: Max und Ida. " +
        "1930 starb ihr Mann.\n\n" +
        "Sie starb 1950 im Alter von 69 oder 70 Jahren in Neustadt.",
    );
  });

  it("Partnerschaft ohne Ehe und Kinder ohne zugeordnete Partnerschaft", () => {
    const t = text(
      input({
        person: { gender: "MALE", givenName: "Hans", birth: year(1950) },
        partnerships: [partnership(ERNA, { subtype: "UNMARRIED", start: year(1975), startPlace: "Musterstadt" })],
        otherChildren: [
          { person: ref("k1", "Tom", "Beispiel", "MALE"), subtype: "BIOLOGICAL" },
          { person: ref("k2", "Mia", "Seidel", "FEMALE"), subtype: "FOSTER" },
        ],
      }),
    );
    expect(t).toBe(
      "Hans Beispiel wurde 1950 geboren.\n\n" +
        "1975 begann seine Partnerschaft mit Erna Beispiel in Musterstadt. Er hat einen Sohn: Tom. Er hat ein Pflegekind: Mia Seidel.",
    );
  });

  it("mehr als vier Kinder: nur gezählt; Söhne und Töchter nur bei bekanntem Geschlecht", () => {
    const kids = ["A", "B", "C", "D", "E"].map((g, i) => ref(`k${i}`, g, "Beispiel", i === 4 ? "UNKNOWN" : "MALE"));
    const t = text(input({ person: { birth: year(1800) }, partnerships: [partnership(KARL, { start: year(1820), children: kids })] }))!;
    expect(t).toContain("Aus der Ehe gingen fünf Kinder hervor.");
    expect(t).not.toContain("Beispiel, B");
  });

  it("weitere Namen, Titel und Spitzname", () => {
    const t = text(
      input({
        person: { namePrefix: "Dr.", nickname: "Anni", birth: year(1900) },
        otherNames: [
          { type: "VARIANT", text: "Bispiel" },
          { type: "ALIAS", text: "Nanni" },
        ],
      }),
    );
    expect(t).toBe(
      "Dr. Anna Beispiel, genannt „Anni“, wurde 1900 geboren. Der Name ist auch in der Schreibweise Bispiel überliefert. Sie war auch als Nanni bekannt.",
    );
  });

  it("Ereignisse: Auswanderung, Einwanderung mit Artikel, Militär, sonstiges Ereignis, Merkmal", () => {
    const t = text(
      input({
        person: { gender: "MALE", givenName: "Hans", birth: year(1850), death: year(1920) },
        events: [
          ev("MILITARY_SERVICE", range(1870, 1871, "PERIOD"), "Musterstadt", { value: "Infanterie" }),
          ev("EMIGRATION", year(1880), "Hafenstadt"),
          ev("IMMIGRATION", year(1880), "USA"),
          ev("CUSTOM", year(1890, "ABOUT"), "Neustadt", { label: "Kapitänspatent" }),
          ev("RELIGION", null, null, { value: "evangelisch" }),
          ev("CHILDREN_COUNT", null, null, { value: "elf Kinder" }),
        ],
      }),
    )!;
    expect(t).toContain("Als Religion ist „evangelisch“ erfasst.");
    expect(t).toContain("Von 1870 bis 1871 leistete er in Musterstadt Militärdienst (Infanterie).");
    expect(t).toContain("Er wanderte 1880 aus; als Ort ist Hafenstadt vermerkt.");
    expect(t).toContain("1880 wanderte er in die USA ein.");
    expect(t).toContain("Außerdem ist das Ereignis „Kapitänspatent“ um 1890 in Neustadt verzeichnet.");
    // Gezählte Kinder (CHILDREN_COUNT) würden Nicht-Sichtbares verraten.
    expect(t).not.toContain("elf Kinder");
  });

  it("sehr wenig Daten: nur der Name bzw. nur weitere Namen → kein Lebenslauf", () => {
    expect(buildBiography(input())).toBeNull();
    expect(buildBiography(input({ otherNames: [{ type: "ALIAS", text: "Nanni" }] }))).toBeNull();
    expect(buildBiography(input({ events: [ev("OCCUPATION", null, null)] }))).toBeNull();
  });

  it("gleiche Eingabe → gleicher Text; Kopiertext ohne Links gleich dem Absatztext", () => {
    const i = input({
      person: { birth: day("1850-03-12"), birthPlace: "Musterdorf", death: year(1920) },
      events: [ev("BAPTISM", day("1850-03-20"), "Musterdorf"), ev("RESIDENCE", year(1880), "Neustadt"), ev("RESIDENCE", year(1890), "Musterstadt")],
      partnerships: [partnership(KARL, { start: year(1875) })],
    });
    const a = buildBiography(i)!;
    const b = buildBiography(i)!;
    expect(b).toEqual(a);
    expect(a.paragraphs.map((p) => p.map((s) => s.text).join("")).join("\n\n")).toBe(a.text);
  });
});

// ---------------------------------------------------------------------------
// Eingabe aus den Daten der Personenseite (Rechte: nur Sichtbares)
// ---------------------------------------------------------------------------

const MASK = (id: string) => ({ id, restricted: true as const, name: "Nicht freigegeben" });

function brief(id: string, givenName: string, gender: "MALE" | "FEMALE", birth: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    givenName,
    familyName: "Beispiel",
    birthName: null,
    gender,
    birthDate: birth,
    birthPlace: null,
    deathDate: null,
    birthDatePrecision: "DAY",
    birthDateQualifier: "EXACT",
    deathDatePrecision: "DAY",
    deathDateQualifier: "EXACT",
    restricted: false as const,
    ...extra,
  };
}

function rel(other: unknown, role: "parent" | "child" | "partner", subtype: string, extra: Record<string, unknown> = {}) {
  return {
    relationshipId: `r-${(other as { id: string }).id}-${role}`,
    type: role === "partner" ? "PARTNER_OF" : "PARENT_OF",
    subtype,
    role,
    startDate: null,
    startDatePrecision: "DAY",
    startDateQualifier: "EXACT",
    endDate: null,
    endDatePrecision: "DAY",
    endDateQualifier: "EXACT",
    startDateTo: null,
    startDateToPrecision: "DAY",
    startDatePhrase: null,
    startPlace: null,
    endDateTo: null,
    endDateToPrecision: "DAY",
    endDatePhrase: null,
    endPlace: null,
    notes: null,
    other,
    media: [],
    events: [],
    ...extra,
  };
}

function detail(over: Partial<Record<"parents" | "children" | "partners" | "siblings" | "events" | "names", unknown[]>> = {}): PersonDetail {
  return {
    person: {
      ...brief("me", "Anna", "FEMALE", "1852-06-01T00:00:00.000Z"),
      nickname: null,
      namePrefix: null,
      nameSuffix: null,
      deathPlace: null,
      deathCause: null,
      notes: null,
      birthDateTo: null,
      birthDateToPrecision: "DAY",
      birthDatePhrase: null,
      deathDateTo: null,
      deathDateToPrecision: "DAY",
      deathDatePhrase: null,
      birthPlace: "Musterdorf",
      createdAt: "",
      updatedAt: "",
      primaryMediaId: null,
      familyIds: [],
    },
    canEdit: false,
    families: [],
    media: [],
    relations: [],
    citations: [],
    parents: [],
    children: [],
    partners: [],
    siblings: [],
    events: [],
    names: [],
    ...over,
  } as unknown as PersonDetail;
}

const FATHER = brief("fa", "Karl", "MALE", null);
const MOTHER = brief("mo", "Erna", "FEMALE", null);
const SIB_OLD = brief("s1", "Paul", "MALE", "1850-01-01T00:00:00.000Z");
const SIB_YOUNG = brief("s2", "Marie", "FEMALE", "1855-01-01T00:00:00.000Z");
const edgesFor = (children: string[], subtype = "BIOLOGICAL"): ParentEdge[] =>
  ["fa", "mo"].flatMap((p) => children.map((c) => ({ from: p, to: c, subtype })));
const sibling = (p: unknown) => ({ person: p, kind: "full", sharedParentIds: ["fa", "mo"] });

describe("Lebenslauf: Geschwisterstellung nur bei sicherer Grundlage", () => {
  const parents = [rel(FATHER, "parent", "BIOLOGICAL"), rel(MOTHER, "parent", "BIOLOGICAL")];

  it("alle sichtbar, Daten eindeutig → Position und Zahl", () => {
    const d = detail({ parents, siblings: [sibling(SIB_OLD), sibling(SIB_YOUNG)] });
    expect(siblingRankOf(d, edgesFor(["me", "s1", "s2"]))).toEqual({ position: 2, total: 3 });
  });

  it("ein Geschwister nicht sichtbar → keine Stellung, keine Zahl", () => {
    const d = detail({ parents, siblings: [sibling(SIB_OLD), sibling(MASK("s2"))] });
    expect(siblingRankOf(d, edgesFor(["me", "s1", "s2"]))).toBeNull();
    const t = buildBiography(biographyInputOf(d, edgesFor(["me", "s1", "s2"]), TODAY))!.text;
    expect(t).not.toMatch(/von (zwei|drei) Kindern/);
    expect(t).toContain("als Tochter von Karl Beispiel und Erna Beispiel");
  });

  it("ein Elternteil nicht sichtbar → nur der sichtbare genannt, keine Stellung", () => {
    const d = detail({ parents: [rel(FATHER, "parent", "BIOLOGICAL"), rel(MASK("mo"), "parent", "BIOLOGICAL")], siblings: [sibling(SIB_OLD)] });
    expect(siblingRankOf(d, edgesFor(["me", "s1"]))).toBeNull();
    const bio = buildBiography(biographyInputOf(d, edgesFor(["me", "s1"]), TODAY))!;
    expect(bio.text).toBe("Anna Beispiel wurde am 1. Juni 1852 in Musterdorf als Tochter von Karl Beispiel geboren.");
    expect(JSON.stringify(bio)).not.toContain("mo");
  });

  it("ungenaues Geburtsjahr eines Geschwisters → nur die Zahl („eines von …“)", () => {
    const fuzzy = brief("s1", "Paul", "MALE", "1852-01-01T00:00:00.000Z", { birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT" });
    const d = detail({ parents, siblings: [sibling(fuzzy)] });
    expect(siblingRankOf(d, edgesFor(["me", "s1"]))).toEqual({ position: null, total: 2 });
    expect(buildBiography(biographyInputOf(d, edgesFor(["me", "s1"]), TODAY))!.text).toContain("als eines von zwei Kindern von");
  });

  it("Adoptivkinder der Eltern zählen nicht mit; Halbgeschwister nicht", () => {
    const d = detail({ parents, siblings: [sibling(SIB_OLD), sibling(SIB_YOUNG)] });
    const edges = [...edgesFor(["me", "s1"]), { from: "fa", to: "s2", subtype: "ADOPTIVE" }, { from: "mo", to: "s2", subtype: "ADOPTIVE" }];
    expect(siblingRankOf(d, edges)).toEqual({ position: 2, total: 2 });
    const half = [...edgesFor(["me", "s1"]), { from: "fa", to: "s2", subtype: "BIOLOGICAL" }];
    expect(siblingRankOf(d, half)).toEqual({ position: 2, total: 2 });
  });
});

describe("Lebenslauf: nicht sichtbare Angehörige", () => {
  it("nicht sichtbare Partner, Kinder und Eltern werden weder genannt noch gezählt", () => {
    const visibleChild = brief("k1", "Lena", "FEMALE", "1880-01-01T00:00:00.000Z");
    const hiddenPartner = MASK("hp");
    const d = detail({
      parents: [rel(MASK("fa"), "parent", "BIOLOGICAL"), rel(MASK("mo"), "parent", "BIOLOGICAL")],
      partners: [
        rel(hiddenPartner, "partner", "MARRIED", { startDate: "1875-01-01T00:00:00.000Z", startDatePrecision: "YEAR", startPlace: "Geheimort" }),
        rel(brief("vp", "Otto", "MALE", null), "partner", "MARRIED", { startDate: "1878-01-01T00:00:00.000Z", startDatePrecision: "YEAR" }),
      ],
      children: [rel(visibleChild, "child", "BIOLOGICAL"), rel(MASK("k2"), "child", "BIOLOGICAL"), rel(MASK("k3"), "child", "BIOLOGICAL")],
    });
    const edges: ParentEdge[] = [
      { from: "vp", to: "k1", subtype: "BIOLOGICAL" },
      { from: "hp", to: "k2", subtype: "BIOLOGICAL" },
    ];
    const bio = buildBiography(biographyInputOf(d, edges, TODAY))!;
    expect(bio.text).toBe(
      "Anna Beispiel wurde am 1. Juni 1852 in Musterdorf geboren.\n\n1878 heiratete sie Otto Beispiel. Aus der Ehe ging eine Tochter hervor: Lena.",
    );
    const json = JSON.stringify(bio);
    for (const hidden of ["hp", "k2", "k3", "Geheimort", "Nicht freigegeben", "1875"]) expect(json).not.toContain(hidden);
  });

  it("Zweitangaben (isAlternative) erscheinen nicht", () => {
    const d = detail({
      events: [
        { id: "e1", type: "BAPTISM", label: null, isAlternative: true, date: "1853-01-01T00:00:00.000Z", datePrecision: "YEAR", dateQualifier: "EXACT", dateTo: null, dateToPrecision: "DAY", datePhrase: null, place: "Anderswo", value: null },
        { id: "e2", type: "BIRTH", label: null, isAlternative: true, date: "1853-01-01T00:00:00.000Z", datePrecision: "YEAR", dateQualifier: "EXACT", dateTo: null, dateToPrecision: "DAY", datePhrase: null, place: "Anderswo", value: null },
      ],
    });
    const t = buildBiography(biographyInputOf(d, [], TODAY))!.text;
    expect(t).toBe("Anna Beispiel wurde am 1. Juni 1852 in Musterdorf geboren.");
  });
});
