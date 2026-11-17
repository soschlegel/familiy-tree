/**
 * Deterministischer Generator für Mock-Daten.
 *
 * Reine Funktion ohne Datenbank und ohne Netz: gleicher Seed, gleiche Daten —
 * bis hin zu den IDs. Dadurch können Tests (Layout, Graph-Algorithmen) die
 * Daten direkt im Speicher verwenden, und E2E-Tests sich auf feste IDs und
 * E-Mail-Adressen verlassen. prisma/seed-mock.ts schreibt das Ergebnis in die
 * Mock-Datenbank.
 *
 * Inhalt: vier Familien über sechs Generationen (ab ca. 1860), durch Heiraten
 * miteinander verbunden, dazu gezielt eingebaute Sonderfälle (Scheidung und
 * Wiederheirat, Halbgeschwister, Stief-, Adoptiv- und Pflegeverhältnis,
 * Datenlücken, mögliche Dubletten, Personen ohne Familie). Die älteren
 * Generationen haben teils ungenaue Daten (nur Jahr/Monat, „um“, „vor“), und
 * es gibt Quellen verschiedener Art mit Belegen über mehrere Familien. Die
 * Sonderfälle sind in `landmarks` mit ihren IDs hinterlegt.
 */

export const MOCK_SEED = 20261116;

/** Feste "Gegenwart" — unabhängig vom Ausführungsdatum. */
export const MOCK_REFERENCE_YEAR = 2025;

export type MockGender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
export type MockPrecision = "DAY" | "MONTH" | "YEAR";
export type MockQualifier = "EXACT" | "ABOUT" | "BEFORE" | "AFTER";
export type FamilyKey = "A" | "B" | "C" | "D";

export type MockFamily = {
  id: string;
  key: FamilyKey;
  name: string;
  description: string;
};

export type MockPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: MockGender;
  birthDate: Date | null;
  birthPlace: string | null;
  deathDate: Date | null;
  deathPlace: string | null;
  birthDatePrecision: MockPrecision;
  birthDateQualifier: MockQualifier;
  deathDatePrecision: MockPrecision;
  deathDateQualifier: MockQualifier;
  notes: string | null;
  /** Familienzuordnung (Rechte). Leer = nur für Admins sichtbar. */
  familyKeys: FamilyKey[];
  /** Generation 0 = Stammeltern (ca. 1860). */
  generation: number;
};

export type MockRelationship = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype:
    | "BIOLOGICAL"
    | "ADOPTIVE"
    | "STEP"
    | "FOSTER"
    | "MARRIED"
    | "UNMARRIED"
    | "DIVORCED";
  fromPersonId: string;
  toPersonId: string;
  startDate: Date | null;
  endDate: Date | null;
  startDatePrecision: MockPrecision;
  startDateQualifier: MockQualifier;
  endDatePrecision: MockPrecision;
  endDateQualifier: MockQualifier;
  notes: string | null;
};

export type MockSource = {
  id: string;
  title: string;
  kind: "CHURCH_BOOK" | "CIVIL_REGISTRY" | "CENSUS" | "GRAVESTONE" | "FAMILY_DOCUMENT" | "ORAL" | "WEBSITE" | "OTHER";
  author: string | null;
  repository: string | null;
  callNumber: string | null;
  url: string | null;
  date: Date | null;
  datePrecision: MockPrecision;
  dateQualifier: MockQualifier;
  notes: string | null;
  /** Bild (MockImage.id) als Scan — wird nur gesetzt, wenn Bilder angelegt wurden. */
  scanImageId: string | null;
  createdById: string;
};

export type MockCitation = {
  id: string;
  sourceId: string;
  personId: string | null;
  relationshipId: string | null;
  fact: "NAME" | "BIRTH" | "DEATH" | "PARTNERSHIP" | "PARENTAGE" | "OTHER";
  detail: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
};

export type MockUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  status: "INVITED" | "ACTIVE" | "BLOCKED";
  /** KI-Recht (MCP). */
  aiAccess: "NONE" | "READ" | "WRITE";
  families: { familyKey: FamilyKey; role: "EDITOR" | "VIEWER" }[];
};

/**
 * KI-Zugangsschlüssel mit FESTEM, öffentlich dokumentiertem Geheimnis — NUR
 * für Tests und die Mock-Umgebung. Der Seed läuft ausschließlich gegen
 * Datenbanken namens …_mock/…_test; in eine echte Datenbank gelangen diese
 * Schlüssel nie.
 */
export type MockApiToken = {
  id: string;
  userId: string;
  name: string;
  /** Vollständiger Schlüssel (ftk_<12 hex>_<43 Zeichen>). */
  secret: string;
  prefix: string;
  level: "READ" | "WRITE";
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type MockImage = {
  id: string;
  kind: "portrait" | "wedding";
  personId?: string;
  relationshipId?: string;
  isPrimary: boolean;
  fileName: string;
  caption: string | null;
  /** Für das Platzhalterbild: Initialen bzw. Beschriftung und Farbton. */
  label: string;
  subtitle: string;
  hue: number;
};

export type MockLandmarks = {
  founders: Record<FamilyKey, string>;
  /** In Familie B geboren, in Familie A eingeheiratet (gehört zu A und B). */
  crossMarriedIntoA: string;
  /** Ihr Partner aus Familie A. */
  crossMarriedPartnerA: string;
  /** Elternteil von crossMarriedIntoA — nur Familie B (für Betrachter A maskiert). */
  inLawOnlyB: string;
  divorced: { person: string; firstSpouse: string; secondSpouse: string; firstMarriage: string };
  halfSiblings: [string, string];
  stepChild: string;
  adoptee: string;
  adoptiveParents: [string, string];
  /** Leibliche Mutter des Adoptivkinds — ohne Familie, nur für Admins sichtbar. */
  biologicalMotherNoFamily: string;
  fosterChild: string;
  fosterParents: [string, string];
  duplicates: [string, string][];
  noFamily: string[];
  missingBirthDate: string[];
  probablyDeceasedWithoutDeathDate: string[];
  /** Personen mit ungenauen Lebensdaten (nur Jahr/Monat, „um“, „vor“). */
  impreciseDates: { yearOnly: string; about: string; before: string; monthOnly: string };
  sources: {
    /** Kirchenbuch Familie A: Geburten, Tod und die Ehe des Stammvaters. */
    churchBookA: string;
    /** Heiratsregister, zitiert in Familie A UND für eine Person nur aus Familie B. */
    crossFamily: string;
    /** Nur für Personen aus Familie D zitiert — für Betrachter A unsichtbar. */
    onlyFamilyD: string;
    /** Ohne Beleg — nur für Ersteller (Admin) sichtbar. */
    uncited: string;
  };
  /** Ehe des Stammvaters A — mit Beleg (PARTNERSHIP). */
  citedMarriage: string;
};

export type MockData = {
  families: MockFamily[];
  users: MockUser[];
  apiTokens: MockApiToken[];
  persons: MockPerson[];
  relationships: MockRelationship[];
  images: MockImage[];
  sources: MockSource[];
  citations: MockCitation[];
  landmarks: MockLandmarks;
};

// ---------------------------------------------------------------------------
// Zufall
// ---------------------------------------------------------------------------

/** mulberry32 — klein, schnell und für Testdaten völlig ausreichend. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
  };
}

// ---------------------------------------------------------------------------
// Stammdaten
// ---------------------------------------------------------------------------

const MALE_NAMES: [number, string[]][] = [
  [1890, ["Wilhelm", "Friedrich", "Heinrich", "Karl", "Hermann", "Otto", "August", "Johann", "Ernst", "Gustav"]],
  [1925, ["Walter", "Kurt", "Werner", "Hans", "Paul", "Erich", "Herbert", "Fritz", "Richard", "Alfred"]],
  [1955, ["Günter", "Gerhard", "Helmut", "Horst", "Dieter", "Klaus", "Manfred", "Rolf", "Heinz", "Bernd"]],
  [1985, ["Jürgen", "Wolfgang", "Peter", "Michael", "Thomas", "Andreas", "Stefan", "Frank", "Uwe", "Ralf"]],
  [2005, ["Christian", "Sebastian", "Tobias", "Markus", "Jan", "Daniel", "Florian", "Matthias", "Philipp", "Dennis"]],
  [9999, ["Lukas", "Felix", "Jonas", "Leon", "Finn", "Ben", "Elias", "Noah", "Paul", "Emil"]],
];

const FEMALE_NAMES: [number, string[]][] = [
  [1890, ["Anna", "Emma", "Martha", "Frieda", "Bertha", "Elisabeth", "Margarethe", "Luise", "Auguste", "Wilhelmine"]],
  [1925, ["Gertrud", "Erna", "Hildegard", "Irmgard", "Charlotte", "Elfriede", "Ilse", "Käthe", "Lieselotte", "Hedwig"]],
  [1955, ["Ursula", "Renate", "Helga", "Ingrid", "Brigitte", "Karin", "Monika", "Christa", "Erika", "Gisela"]],
  [1985, ["Sabine", "Petra", "Andrea", "Claudia", "Susanne", "Birgit", "Gabriele", "Heike", "Martina", "Angelika"]],
  [2005, ["Stefanie", "Nicole", "Katrin", "Anja", "Julia", "Sandra", "Melanie", "Christina", "Jessica", "Vanessa"]],
  [9999, ["Lena", "Laura", "Sophie", "Marie", "Mia", "Hannah", "Lea", "Emilia", "Clara", "Johanna"]],
];

const OUTSIDER_SURNAMES = [
  "Müller", "Schmidt", "Fischer", "Weber", "Meyer", "Schneider", "Koch",
  "Richter", "Klein", "Wolf", "Neumann", "Schwarz", "Zimmermann", "Braun",
  "Krüger", "Hartmann", "Lange", "Werner", "Krause", "Lehmann", "Köhler",
  "Kaiser", "Fuchs", "Vogel", "Keller", "Jung", "Roth", "Peters", "Lorenz",
  "Brandt", "Haas", "Sommer", "Winter", "Böhm", "Seidel", "Ziegler",
];

const FAMILY_DEFS: { key: FamilyKey; surname: string; places: string[]; description: string }[] = [
  { key: "A", surname: "Becker", places: ["Hannover", "Celle", "Hildesheim", "Peine"], description: "Bäcker- und Lehrerfamilie aus dem Raum Hannover" },
  { key: "B", surname: "Hoffmann", places: ["Leipzig", "Halle (Saale)", "Dresden", "Chemnitz"], description: "Handwerkerfamilie aus Sachsen" },
  { key: "C", surname: "Wagner", places: ["Bamberg", "Würzburg", "Nürnberg", "Erlangen"], description: "Fränkische Winzer- und Kaufmannsfamilie" },
  { key: "D", surname: "Schulz", places: ["Kiel", "Lübeck", "Flensburg", "Neumünster"], description: "Seefahrer- und Fischerfamilie von der Ostsee" },
];

const OTHER_PLACES = [
  "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Bremen",
  "Kassel", "Göttingen", "Braunschweig", "Magdeburg", "Rostock", "Stuttgart",
];

const NOTES = [
  "Bäckermeister, übernahm den elterlichen Betrieb.",
  "Wanderte 1923 für einige Jahre nach Amerika aus und kehrte später zurück.",
  "Lehrerin an der Volksschule, sehr musikalisch.",
  "Diente als Matrose auf der Ostsee.",
  "Hinterließ ein Tagebuch, das sich im Familienbesitz befindet.",
  "Laut Kirchenbuch getauft in der Marktkirche.",
  "Geburtsdatum nur aus mündlicher Überlieferung bekannt.",
  "Führte das Familiengeschäft bis zur Rente.",
  "Engagierte sich im örtlichen Gesangsverein.",
  "Angaben zum Sterbeort widersprüchlich, bitte prüfen.",
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

type Internal = MockPerson & {
  /** Familien, in die die Person hineingeboren wurde (Abstammungslinie). */
  line: Set<FamilyKey>;
  married: boolean;
};

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

export function generateMockData(seed: number = MOCK_SEED): MockData {
  const rnd = prng(seed);
  const persons: Internal[] = [];
  const relationships: MockRelationship[] = [];
  const images: MockImage[] = [];
  const byId = new Map<string, Internal>();

  let personCounter = 0;
  let relCounter = 0;
  const personId = () => `mock-p-${String(++personCounter).padStart(3, "0")}`;
  const relId = () => `mock-r-${String(++relCounter).padStart(4, "0")}`;

  const families: MockFamily[] = FAMILY_DEFS.map((f) => ({
    id: `mock-family-${f.key.toLowerCase()}`,
    key: f.key,
    name: `Familie ${f.surname}`,
    description: f.description,
  }));
  const defOf = (key: FamilyKey) => FAMILY_DEFS.find((f) => f.key === key)!;

  const nameFor = (gender: MockGender, year: number) => {
    const table = gender === "FEMALE" ? FEMALE_NAMES : MALE_NAMES;
    return rnd.pick(table.find(([until]) => year <= until)![1]);
  };

  const placeFor = (line: Set<FamilyKey>) => {
    const keys = [...line];
    if (keys.length === 0 || rnd.chance(0.15)) return rnd.pick(OTHER_PLACES);
    return rnd.pick(defOf(rnd.pick(keys)).places);
  };

  const randomDate = (year: number) => utc(year, rnd.int(1, 12), rnd.int(1, 28));

  /** Sterbedatum abhängig vom Jahrgang — ältere Generationen sind verstorben. */
  const deathFor = (birthYear: number): Date | null => {
    const age = MOCK_REFERENCE_YEAR - birthYear;
    const p = age > 95 ? 1 : age > 80 ? 0.75 : age > 60 ? 0.2 : age > 30 ? 0.03 : 0;
    if (!rnd.chance(p)) return null;
    const deathYear = Math.min(
      MOCK_REFERENCE_YEAR - 1,
      birthYear + rnd.int(Math.min(50, age - 1), Math.min(96, age)),
    );
    return randomDate(Math.max(birthYear + 1, deathYear));
  };

  const EXACT_DAY = {
    birthDatePrecision: "DAY",
    birthDateQualifier: "EXACT",
    deathDatePrecision: "DAY",
    deathDateQualifier: "EXACT",
  } as const;

  const add = (
    p: Omit<Internal, "id" | "married" | "birthDatePrecision" | "birthDateQualifier" | "deathDatePrecision" | "deathDateQualifier">,
  ): Internal => {
    const person: Internal = { ...EXACT_DAY, ...p, id: personId(), married: false };
    persons.push(person);
    byId.set(person.id, person);
    return person;
  };

  const makePerson = (opts: {
    gender: MockGender;
    year: number;
    familyName: string;
    line: Set<FamilyKey>;
    familyKeys: FamilyKey[];
    generation: number;
  }): Internal => {
    const birthDate = randomDate(opts.year);
    const deathDate = deathFor(opts.year);
    return add({
      givenName: nameFor(opts.gender, opts.year),
      familyName: opts.familyName,
      birthName: null,
      gender: opts.gender,
      birthDate,
      birthPlace: placeFor(opts.line),
      deathDate,
      deathPlace: deathDate ? placeFor(opts.line) : null,
      notes: rnd.chance(0.12) ? rnd.pick(NOTES) : null,
      familyKeys: opts.familyKeys,
      generation: opts.generation,
      line: opts.line,
    });
  };

  const partner = (
    a: Internal,
    b: Internal,
    subtype: MockRelationship["subtype"],
    startYear: number | null,
    endYear: number | null = null,
  ) => {
    const [from, to] = a.id < b.id ? [a, b] : [b, a];
    const r: MockRelationship = {
      id: relId(),
      type: "PARTNER_OF",
      subtype,
      fromPersonId: from.id,
      toPersonId: to.id,
      startDate: startYear ? randomDate(startYear) : null,
      endDate: endYear ? randomDate(endYear) : null,
      startDatePrecision: "DAY",
      startDateQualifier: "EXACT",
      endDatePrecision: "DAY",
      endDateQualifier: "EXACT",
      notes: null,
    };
    if (r.startDate && r.endDate && r.endDate < r.startDate) r.endDate = r.startDate;
    relationships.push(r);
    a.married = true;
    b.married = true;
    return r;
  };

  const parentOf = (
    parent: Internal,
    child: Internal,
    subtype: MockRelationship["subtype"] = "BIOLOGICAL",
    startYear: number | null = null,
  ) => {
    const r: MockRelationship = {
      id: relId(),
      type: "PARENT_OF",
      subtype,
      fromPersonId: parent.id,
      toPersonId: child.id,
      startDate: startYear ? randomDate(startYear) : null,
      endDate: null,
      startDatePrecision: "DAY",
      startDateQualifier: "EXACT",
      endDatePrecision: "DAY",
      endDateQualifier: "EXACT",
      notes: null,
    };
    relationships.push(r);
    return r;
  };

  /** Ehefrau übernimmt den Namen des Mannes, der Geburtsname bleibt erhalten. */
  const takeName = (wife: Internal, husband: Internal) => {
    if (wife.familyName && wife.familyName !== husband.familyName) {
      wife.birthName = wife.familyName;
      wife.familyName = husband.familyName;
    }
  };

  type Couple = { a: Internal; b: Internal; year: number; generation: number };
  let couples: Couple[] = [];
  const founders = {} as Record<FamilyKey, string>;

  // --- Generation 0: Stammeltern ------------------------------------------
  for (const def of FAMILY_DEFS) {
    const line = new Set<FamilyKey>([def.key]);
    const year = 1856 + rnd.int(0, 8);
    const husband = makePerson({ gender: "MALE", year, familyName: def.surname, line, familyKeys: [def.key], generation: 0 });
    const wife = makePerson({ gender: "FEMALE", year: year + rnd.int(-1, 5), familyName: rnd.pick(OUTSIDER_SURNAMES), line: new Set(), familyKeys: [def.key], generation: 0 });
    takeName(wife, husband);
    founders[def.key] = husband.id;
    const wedding = Math.max(year, wife.birthDate!.getUTCFullYear()) + rnd.int(21, 27);
    partner(husband, wife, "MARRIED", wedding);
    couples.push({ a: husband, b: wife, year: wedding, generation: 0 });
  }

  // Wie viele Kinder je Paar und wie viele Paare überhaupt Kinder haben —
  // so gewählt, dass rund 200 Personen über sechs Generationen entstehen.
  const KIDS: Record<number, [number, number]> = { 0: [3, 4], 1: [2, 3], 2: [1, 3], 3: [1, 3], 4: [1, 2] };
  const MAX_FERTILE: Record<number, number> = { 0: 99, 1: 10, 2: 13, 3: 14, 4: 11 };
  const MARRY: Record<number, number> = { 1: 0.85, 2: 0.8, 3: 0.75, 4: 0.6, 5: 0.25 };

  // Heiraten zwischen den Familien, je Generation geplant.
  const CROSS: Record<number, [FamilyKey, FamilyKey][]> = {
    2: [["A", "B"]], // Mann aus A heiratet Frau aus B
    3: [["C", "A"], ["B", "D"]],
    4: [["D", "C"]],
  };

  let crossIntoA: { wife: Internal; husband: Internal } | null = null;

  for (let g = 1; g <= 5; g++) {
    const children: Internal[] = [];

    // Paare mit Kindern auswählen (stabil nach Reihenfolge, gemischt per Zufall).
    const fertile = couples
      .map((c) => ({ c, k: rnd.next() }))
      .sort((x, y) => x.k - y.k)
      .slice(0, MAX_FERTILE[g - 1] ?? 0)
      .map((x) => x.c)
      .sort((x, y) => x.a.id.localeCompare(y.a.id));

    for (const couple of fertile) {
      const [min, max] = KIDS[couple.generation] ?? [0, 0];
      const count = rnd.int(min, max);
      const mother = couple.a.gender === "FEMALE" ? couple.a : couple.b;
      const father = mother === couple.a ? couple.b : couple.a;
      const line = new Set<FamilyKey>([...father.line, ...mother.line]);
      const familyKeys = [...line].sort();
      let year = couple.year + rnd.int(1, 2);

      for (let i = 0; i < count; i++) {
        const motherAge = year - (mother.birthDate?.getUTCFullYear() ?? year - 30);
        if (motherAge > 42 || year > MOCK_REFERENCE_YEAR - 2) break;
        const child = makePerson({
          gender: rnd.chance(0.5) ? "MALE" : "FEMALE",
          year,
          familyName: father.familyName ?? mother.familyName ?? "Unbekannt",
          line,
          familyKeys,
          generation: g,
        });
        parentOf(father, child);
        parentOf(mother, child);
        children.push(child);
        year += rnd.int(1, 4);
      }
    }

    // Geplante Heiraten zwischen Familien.
    const nextCouples: Couple[] = [];
    for (const [maleKey, femaleKey] of CROSS[g] ?? []) {
      const yearOf = (p: Internal) => p.birthDate!.getUTCFullYear();
      const man = children.find(
        (p) => !p.married && p.gender === "MALE" && p.line.has(maleKey) && !p.line.has(femaleKey) && yearOf(p) <= MOCK_REFERENCE_YEAR - 22,
      );
      const woman = man
        ? children.find(
            (p) =>
              !p.married &&
              p.gender === "FEMALE" &&
              p.line.has(femaleKey) &&
              !p.line.has(maleKey) &&
              Math.abs(yearOf(p) - yearOf(man)) <= 9,
          )
        : undefined;
      if (!man || !woman) continue;

      takeName(woman, man);
      // Wer einheiratet, gehört fortan zu beiden Familien.
      const keys = [...new Set([...man.familyKeys, ...woman.familyKeys])].sort();
      man.familyKeys = keys;
      woman.familyKeys = keys;
      const wedding = Math.max(yearOf(man), yearOf(woman)) + rnd.int(21, 28);
      partner(man, woman, "MARRIED", Math.min(wedding, MOCK_REFERENCE_YEAR - 1));
      nextCouples.push({ a: man, b: woman, year: wedding, generation: g });
      if (maleKey === "A" && femaleKey === "B" && !crossIntoA) crossIntoA = { wife: woman, husband: man };
    }

    // Übrige Kinder heiraten Partner von außerhalb.
    for (const child of children) {
      if (child.married) continue;
      const birthYear = child.birthDate!.getUTCFullYear();
      if (birthYear > MOCK_REFERENCE_YEAR - 22) continue;
      if (!rnd.chance(MARRY[g] ?? 0)) continue;

      const spouseGender = child.gender === "MALE" ? "FEMALE" : "MALE";
      const spouseYear = birthYear + (spouseGender === "FEMALE" ? rnd.int(-6, 2) : rnd.int(-2, 6));
      const spouse = makePerson({
        gender: spouseGender,
        year: Math.min(spouseYear, MOCK_REFERENCE_YEAR - 20),
        familyName: rnd.pick(OUTSIDER_SURNAMES),
        line: new Set(),
        familyKeys: [...child.familyKeys],
        generation: g,
      });
      if (spouse.gender === "FEMALE") takeName(spouse, child);
      else takeName(child, spouse);

      const wedding = Math.min(
        Math.max(birthYear, spouse.birthDate!.getUTCFullYear()) + rnd.int(20, 30),
        MOCK_REFERENCE_YEAR - 1,
      );
      const subtype = g >= 4 && rnd.chance(0.25) ? "UNMARRIED" : "MARRIED";
      partner(child, spouse, subtype, wedding);
      nextCouples.push({ a: child, b: spouse, year: wedding, generation: g });
    }

    couples = nextCouples;
  }

  const yearOf = (p: Internal) => p.birthDate!.getUTCFullYear();
  const familyName = (key: FamilyKey) => defOf(key).surname;

  // --- Sonderfall: Scheidung, Wiederheirat, Halbgeschwister, Stiefkind ----
  // Ein Mann aus Familie A der Generation 3 (Jahrgang ~1950) mit Kindern.
  const childrenOf = (id: string) =>
    relationships
      .filter((r) => r.type === "PARENT_OF" && r.fromPersonId === id)
      .map((r) => byId.get(r.toPersonId)!);
  const marriageOf = (id: string) =>
    relationships.find(
      (r) => r.type === "PARTNER_OF" && (r.fromPersonId === id || r.toPersonId === id),
    );

  const divorcee = persons.find(
    (p) =>
      p.generation === 3 &&
      p.gender === "MALE" &&
      p.familyName === familyName("A") &&
      p.line.has("A") &&
      childrenOf(p.id).length >= 1 &&
      marriageOf(p.id)?.subtype === "MARRIED",
  )!;
  const firstMarriage = marriageOf(divorcee.id)!;
  const firstSpouse = byId.get(
    firstMarriage.fromPersonId === divorcee.id ? firstMarriage.toPersonId : firstMarriage.fromPersonId,
  )!;
  const firstKids = childrenOf(divorcee.id);
  const lastFirstKidYear = Math.max(...firstKids.map(yearOf));
  firstMarriage.subtype = "DIVORCED";
  firstMarriage.endDate = randomDate(Math.min(lastFirstKidYear + 3, MOCK_REFERENCE_YEAR - 5));
  firstMarriage.notes = "Geschieden; Kinder lebten danach beim Vater.";

  const secondSpouse = add({
    givenName: "Monika",
    familyName: divorcee.familyName,
    birthName: "Lindemann",
    gender: "FEMALE",
    birthDate: utc(yearOf(divorcee) + 4, 3, 14),
    birthPlace: "Braunschweig",
    deathDate: null,
    deathPlace: null,
    notes: "Zweite Ehefrau.",
    familyKeys: [...divorcee.familyKeys],
    generation: divorcee.generation,
    line: new Set(),
  });
  const secondWedding = firstMarriage.endDate.getUTCFullYear() + 2;
  partner(divorcee, secondSpouse, "MARRIED", secondWedding);

  const halfSibling = add({
    givenName: "Jana",
    familyName: divorcee.familyName,
    birthName: null,
    gender: "FEMALE",
    birthDate: utc(Math.min(secondWedding + 1, MOCK_REFERENCE_YEAR - 3), 9, 2),
    birthPlace: "Hannover",
    deathDate: null,
    deathPlace: null,
    notes: null,
    familyKeys: [...divorcee.familyKeys],
    generation: divorcee.generation + 1,
    line: new Set(divorcee.line),
  });
  parentOf(divorcee, halfSibling);
  parentOf(secondSpouse, halfSibling);

  const stepChild = firstKids.sort((a, b) => yearOf(b) - yearOf(a))[0];
  parentOf(secondSpouse, stepChild, "STEP", secondWedding);

  // --- Sonderfall: Adoption (drei Elternteile) -----------------------------
  const adoptiveFather = persons.find(
    (p) =>
      p.generation === 3 &&
      p.gender === "MALE" &&
      p.line.has("B") &&
      !p.line.has("A") &&
      p.married &&
      marriageOf(p.id)?.subtype === "MARRIED",
  )!;
  const adoptiveMarriage = marriageOf(adoptiveFather.id)!;
  const adoptiveMother = byId.get(
    adoptiveMarriage.fromPersonId === adoptiveFather.id ? adoptiveMarriage.toPersonId : adoptiveMarriage.fromPersonId,
  )!;
  const adopteeYear = Math.min(
    (adoptiveMarriage.startDate?.getUTCFullYear() ?? yearOf(adoptiveFather) + 25) + 6,
    MOCK_REFERENCE_YEAR - 10,
  );
  const biologicalMother = add({
    givenName: "Sandra",
    familyName: "Krüger",
    birthName: null,
    gender: "FEMALE",
    birthDate: utc(adopteeYear - 19, 5, 30),
    birthPlace: "Magdeburg",
    deathDate: null,
    deathPlace: null,
    notes: "Leibliche Mutter; Kontakt über das Jugendamt. Bewusst keiner Familie zugeordnet.",
    familyKeys: [],
    generation: adoptiveFather.generation,
    line: new Set(),
  });
  const adoptee = add({
    givenName: "Kevin",
    familyName: adoptiveFather.familyName,
    birthName: "Krüger",
    gender: "MALE",
    birthDate: utc(adopteeYear, 11, 8),
    birthPlace: "Magdeburg",
    deathDate: null,
    deathPlace: null,
    notes: "Adoptiert im Alter von zwei Jahren.",
    familyKeys: [...adoptiveFather.familyKeys],
    generation: adoptiveFather.generation + 1,
    line: new Set(adoptiveFather.line),
  });
  parentOf(biologicalMother, adoptee, "BIOLOGICAL");
  parentOf(adoptiveFather, adoptee, "ADOPTIVE", adopteeYear + 2);
  parentOf(adoptiveMother, adoptee, "ADOPTIVE", adopteeYear + 2);

  // --- Sonderfall: Pflegekind ----------------------------------------------
  const fosterFather = persons.find(
    (p) =>
      p.generation === 4 &&
      p.line.has("C") &&
      p.gender === "MALE" &&
      p.married &&
      yearOf(p) <= 1990,
  ) ??
    persons.find((p) => p.generation === 3 && p.line.has("C") && p.gender === "MALE" && p.married)!;
  const fosterMarriage = marriageOf(fosterFather.id)!;
  const fosterMother = byId.get(
    fosterMarriage.fromPersonId === fosterFather.id ? fosterMarriage.toPersonId : fosterMarriage.fromPersonId,
  )!;
  const fosterChild = add({
    givenName: "Mia",
    familyName: "Seidel",
    birthName: null,
    gender: "FEMALE",
    birthDate: utc(2011, 4, 17),
    birthPlace: "Nürnberg",
    deathDate: null,
    deathPlace: null,
    notes: "Pflegekind seit 2016.",
    familyKeys: [...fosterFather.familyKeys],
    generation: fosterFather.generation + 1,
    line: new Set(),
  });
  parentOf(fosterFather, fosterChild, "FOSTER", 2016);
  parentOf(fosterMother, fosterChild, "FOSTER", 2016);

  // --- Datenlücken ---------------------------------------------------------
  // Einige ältere Personen ohne Geburtsdatum, ohne Geburtsort, ohne Geschlecht.
  const old = persons.filter((p) => p.generation <= 1);
  const missingBirthDate: string[] = [];
  for (const p of [old[3], old[9], old[14]].filter(Boolean)) {
    p.birthDate = null;
    p.notes = p.notes ?? "Geburtsdatum unbekannt.";
    missingBirthDate.push(p.id);
  }
  for (const p of persons) {
    if (p.generation <= 2 && rnd.chance(0.2)) p.birthPlace = null;
  }
  persons.find((p) => p.generation === 1 && p.birthDate)!.gender = "UNKNOWN";

  // Vermutlich verstorben, aber ohne Sterbedatum (Jahrgang vor 1925).
  const probablyDeceased: string[] = [];
  for (const p of persons.filter((x) => x.generation === 1 && x.birthDate && x.deathDate).slice(0, 3)) {
    p.deathDate = null;
    p.deathPlace = rnd.chance(0.5) ? p.deathPlace : null;
    probablyDeceased.push(p.id);
  }

  // --- Mögliche Dubletten --------------------------------------------------
  const duplicates: [string, string][] = [];
  const dupSources = persons.filter(
    (p) => p.generation === 1 && p.birthDate && p.familyKeys.length === 1 && p.gender !== "UNKNOWN",
  );
  const variants: ((p: Internal) => Partial<Internal>)[] = [
    // Schreibvariante des Nachnamens, Geburtsjahr um eins verschoben.
    (p) => ({
      familyName: p.familyName === "Hoffmann" ? "Hofmann" : `${p.familyName}`.replace(/er$/, "ert"),
      birthDate: utc(yearOf(p) + 1, 1, 1),
    }),
    // Identischer Name und Jahrgang, anderer Ort.
    (p) => ({ birthDate: utc(yearOf(p), 6, 1), birthPlace: rnd.pick(OTHER_PLACES) }),
    // Vorname ohne h (Margarethe/Margarete) bzw. gleicher Name, Jahrgang -1.
    (p) => ({ givenName: p.givenName.replace("th", "t"), birthDate: utc(yearOf(p) - 1, 3, 3) }),
  ];
  const usedFamilies = new Set<FamilyKey>();
  for (const variant of variants) {
    const source = dupSources.find((p) => !usedFamilies.has(p.familyKeys[0]));
    if (!source) break;
    usedFamilies.add(source.familyKeys[0]);
    const copy = add({
      ...source,
      ...variant(source),
      notes: "Aus einer Abschrift des Kirchenbuchs übernommen — evtl. doppelt erfasst.",
      deathDate: null,
      deathPlace: null,
      line: new Set(source.line),
      familyKeys: [...source.familyKeys],
    });
    duplicates.push([source.id, copy.id]);
  }

  // --- Personen ohne Familie (nur Admin) -----------------------------------
  const unassigned1 = add({
    givenName: "Johann",
    familyName: familyName("A"),
    birthName: null,
    gender: "MALE",
    birthDate: utc(1831, 2, 11),
    birthPlace: "Celle",
    deathDate: utc(1899, 10, 1),
    deathPlace: "Celle",
    notes: "Möglicherweise Vater des Stammvaters — Zuordnung noch unbelegt.",
    familyKeys: [],
    generation: 0,
    line: new Set(),
  });
  const unassigned2 = add({
    givenName: "Elise",
    familyName: "Unbekannt",
    birthName: null,
    gender: "FEMALE",
    birthDate: null,
    birthPlace: null,
    deathDate: null,
    deathPlace: null,
    notes: "Name auf einem Foto im Nachlass; Zuordnung offen.",
    familyKeys: [],
    generation: 1,
    line: new Set(),
  });
  const noFamily = [biologicalMother.id, unassigned1.id, unassigned2.id];

  // --- Benutzer -------------------------------------------------------------
  const users: MockUser[] = [
    { id: "mock-user-admin", email: "admin@example.test", name: "Ada Admin", role: "ADMIN", status: "ACTIVE", aiAccess: "WRITE", families: [] },
    {
      id: "mock-user-editor",
      email: "editor@example.test",
      name: "Erik Editor",
      role: "EDITOR",
      status: "ACTIVE",
      aiAccess: "WRITE",
      families: [
        { familyKey: "A", role: "EDITOR" },
        { familyKey: "B", role: "VIEWER" },
      ],
    },
    { id: "mock-user-viewer", email: "viewer@example.test", name: "Vera Viewer", role: "VIEWER", status: "ACTIVE", aiAccess: "READ", families: [{ familyKey: "A", role: "VIEWER" }] },
    { id: "mock-user-nofamily", email: "nofamily@example.test", name: "Nora Ohnefamilie", role: "VIEWER", status: "ACTIVE", aiAccess: "NONE", families: [] },
    { id: "mock-user-blocked", email: "blocked@example.test", name: "Bernd Gesperrt", role: "VIEWER", status: "BLOCKED", aiAccess: "READ", families: [{ familyKey: "A", role: "VIEWER" }] },
  ];

  // --- Bilder ---------------------------------------------------------------
  let mediaCounter = 0;
  const mediaId = () => `mock-m-${String(++mediaCounter).padStart(3, "0")}`;
  const initials = (p: Internal) =>
    `${p.givenName[0] ?? ""}${p.familyName?.[0] ?? ""}`.toUpperCase();

  const portraitCandidates = persons.filter(
    (p) => p.familyKeys.length > 0 && p.birthDate && yearOf(p) >= 1880,
  );
  for (const p of portraitCandidates) {
    if (!rnd.chance(0.25)) continue;
    images.push({
      id: mediaId(),
      kind: "portrait",
      personId: p.id,
      isPrimary: true,
      fileName: `portrait_${p.givenName}_${p.familyName ?? ""}.png`.replace(/\s+/g, "_"),
      caption: `${p.givenName} ${p.familyName ?? ""}`.trim(),
      label: initials(p),
      subtitle: `${p.givenName} ${p.familyName ?? ""}`.trim(),
      hue: p.gender === "FEMALE" ? rnd.int(320, 360) : p.gender === "MALE" ? rnd.int(190, 230) : rnd.int(30, 60),
    });
  }
  // Gezielt: die eingeheiratete Person aus B bekommt immer ein Bild — so ist
  // im Test prüfbar, dass ihr Bild für Familie A sichtbar ist.
  if (crossIntoA && !images.some((i) => i.personId === crossIntoA!.wife.id)) {
    const w = crossIntoA.wife;
    images.push({
      id: mediaId(),
      kind: "portrait",
      personId: w.id,
      isPrimary: true,
      fileName: `portrait_${w.givenName}.png`,
      caption: `${w.givenName} ${w.familyName}`,
      label: initials(w),
      subtitle: `${w.givenName} ${w.familyName}`,
      hue: 340,
    });
  }

  const weddingRels = [
    crossIntoA
      ? relationships.find(
          (r) =>
            r.type === "PARTNER_OF" &&
            [r.fromPersonId, r.toPersonId].includes(crossIntoA!.wife.id) &&
            [r.fromPersonId, r.toPersonId].includes(crossIntoA!.husband.id),
        )
      : undefined,
    relationships.find(
      (r) =>
        r.type === "PARTNER_OF" &&
        [r.fromPersonId, r.toPersonId].includes(divorcee.id) &&
        [r.fromPersonId, r.toPersonId].includes(secondSpouse.id),
    ),
  ].filter((r): r is MockRelationship => Boolean(r));

  for (const r of weddingRels) {
    const a = byId.get(r.fromPersonId)!;
    const b = byId.get(r.toPersonId)!;
    const year = r.startDate?.getUTCFullYear();
    images.push({
      id: mediaId(),
      kind: "wedding",
      relationshipId: r.id,
      isPrimary: true,
      fileName: `hochzeit_${year ?? "unbekannt"}.png`,
      caption: `Hochzeit ${a.givenName} & ${b.givenName}${year ? ` (${year})` : ""}`,
      label: `${a.givenName} & ${b.givenName}`,
      subtitle: year ? `Hochzeit ${year}` : "Hochzeit",
      hue: 45,
    });
  }

  const inLawOnlyB = crossIntoA
    ? relationships
        .filter((r) => r.type === "PARENT_OF" && r.toPersonId === crossIntoA!.wife.id)
        .map((r) => byId.get(r.fromPersonId)!)
        .find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "B")
    : undefined;

  if (!crossIntoA || !inLawOnlyB) {
    throw new Error("Mock-Daten: Heirat zwischen Familie A und B konnte nicht erzeugt werden.");
  }

  // --- Ungenaue Daten ------------------------------------------------------
  // Bewusst ohne Zufallszahlen: alles oben Erzeugte (IDs, Bilder, Daten)
  // bleibt dadurch unverändert. Das Jahr bleibt gleich, nur Genauigkeit und
  // Zusatz ändern sich — so wie ein Kirchenbuch oft nur das Jahr hergibt.
  const toYear = (d: Date) => utc(d.getUTCFullYear(), 1, 1);
  const toMonth = (d: Date) => utc(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const gen0 = persons.filter((p) => p.generation === 0 && p.familyKeys.length > 0);
  gen0.forEach((p, i) => {
    if (p.birthDate) {
      if (i % 3 === 0) {
        p.birthDate = toYear(p.birthDate);
        p.birthDatePrecision = "YEAR";
        p.birthDateQualifier = "ABOUT";
      } else if (i % 3 === 1) {
        p.birthDate = toYear(p.birthDate);
        p.birthDatePrecision = "YEAR";
      } else {
        p.birthDate = toMonth(p.birthDate);
        p.birthDatePrecision = "MONTH";
      }
    }
    if (p.deathDate && i % 2 === 1) {
      // „vor <Folgejahr>“ — deckt das tatsächliche Sterbejahr ab.
      p.deathDate = utc(p.deathDate.getUTCFullYear() + 1, 1, 1);
      p.deathDatePrecision = "YEAR";
      p.deathDateQualifier = "BEFORE";
    } else if (p.deathDate) {
      p.deathDate = toYear(p.deathDate);
      p.deathDatePrecision = "YEAR";
    }
  });
  const gen1 = persons.filter((p) => p.generation === 1 && p.birthDate && !duplicates.some((d) => d.includes(p.id)));
  gen1.forEach((p, i) => {
    if (i % 4 === 0) {
      p.birthDate = toYear(p.birthDate!);
      p.birthDatePrecision = "YEAR";
    } else if (i % 7 === 3) {
      p.birthDate = toYear(p.birthDate!);
      p.birthDatePrecision = "YEAR";
      p.birthDateQualifier = "ABOUT";
    }
  });
  // Hochzeiten der Stammeltern: nur das Jahr, eine davon „um“.
  relationships
    .filter((r) => r.type === "PARTNER_OF" && gen0.some((p) => p.id === r.fromPersonId) && r.startDate)
    .forEach((r, i) => {
      r.startDate = toYear(r.startDate!);
      r.startDatePrecision = "YEAR";
      if (i === 1) r.startDateQualifier = "ABOUT";
    });
  // Der vermutete Vater des Stammvaters: „um 1831“, gestorben „vor 1900“.
  unassigned1.birthDate = utc(1831, 1, 1);
  unassigned1.birthDatePrecision = "YEAR";
  unassigned1.birthDateQualifier = "ABOUT";
  unassigned1.deathDate = utc(1900, 1, 1);
  unassigned1.deathDatePrecision = "YEAR";
  unassigned1.deathDateQualifier = "BEFORE";

  const pickImprecise = (pred: (p: Internal) => boolean) => persons.find((p) => p.familyKeys.length > 0 && pred(p))!.id;
  const impreciseDates = {
    yearOnly: pickImprecise((p) => p.birthDatePrecision === "YEAR" && p.birthDateQualifier === "EXACT"),
    about: pickImprecise((p) => p.birthDateQualifier === "ABOUT"),
    before: pickImprecise((p) => p.deathDateQualifier === "BEFORE"),
    monthOnly: pickImprecise((p) => p.birthDatePrecision === "MONTH"),
  };

  // --- Quellen und Belege ---------------------------------------------------
  const sources: MockSource[] = [];
  const citations: MockCitation[] = [];
  let sourceCounter = 0;
  let citationCounter = 0;
  const source = (s: Omit<MockSource, "id" | "createdById" | "datePrecision" | "dateQualifier" | "scanImageId"> &
    Partial<Pick<MockSource, "datePrecision" | "dateQualifier" | "scanImageId">>) => {
    const full: MockSource = {
      datePrecision: "DAY",
      dateQualifier: "EXACT",
      scanImageId: null,
      ...s,
      id: `mock-s-${String(++sourceCounter).padStart(2, "0")}`,
      createdById: "mock-user-admin",
    };
    sources.push(full);
    return full.id;
  };
  const cite = (
    sourceId: string,
    target: { personId: string } | { relationshipId: string },
    fact: MockCitation["fact"],
    detail: string | null,
    confidence: MockCitation["confidence"] = "HIGH",
  ) => {
    citations.push({
      id: `mock-c-${String(++citationCounter).padStart(3, "0")}`,
      sourceId,
      personId: "personId" in target ? target.personId : null,
      relationshipId: "relationshipId" in target ? target.relationshipId : null,
      fact,
      detail,
      confidence,
    });
  };
  const spouseOf = (id: string) => {
    const m = marriageOf(id);
    return m ? (m.fromPersonId === id ? m.toPersonId : m.fromPersonId) : null;
  };
  const yearOfId = (id: string) => byId.get(id)?.birthDate?.getUTCFullYear() ?? 0;

  // 1. Kirchenbuch Familie A: Taufen, Trauung des Stammvaters, zwei Kinder.
  const founderA = founders.A;
  const founderAMarriage = marriageOf(founderA)!;
  const churchBookA = source({
    title: "Kirchenbuch St. Marien Celle, Taufen und Trauungen 1855–1895",
    kind: "CHURCH_BOOK",
    author: "Pfarramt St. Marien Celle",
    repository: "Kirchenbuchamt Hannover",
    callNumber: "KB Celle 12",
    url: null,
    date: utc(1895, 1, 1),
    datePrecision: "YEAR",
    dateQualifier: "BEFORE",
    notes:
      "Taufen ab 1855 in deutscher Kurrentschrift, gut lesbar. Trauungen im hinteren Teil des Bandes.\n\n" +
      "Abschrift Taufeintrag: „Otto, Sohn des Bäckers Heinrich B. und seiner Ehefrau …, getauft in der Marktkirche.“",
  });
  cite(churchBookA, { personId: founderA }, "BIRTH", `Taufen ${yearOfId(founderA)}, Nr. 12`);
  cite(churchBookA, { personId: founderA }, "NAME", "Taufeintrag, Randvermerk", "MEDIUM");
  cite(churchBookA, { relationshipId: founderAMarriage.id }, "PARTNERSHIP", "Trauungen, S. 214, Nr. 4");
  const dated = (list: Internal[]) => list.filter((k) => k.birthDate);
  const founderAKids = dated(childrenOf(founderA)).slice(0, 2);
  for (const k of founderAKids) cite(churchBookA, { personId: k.id }, "BIRTH", `Taufen ${yearOf(k)}`, "MEDIUM");

  // 2. Standesamt Leipzig: Geburten der Familie B (nur B).
  const registryB = source({
    title: "Standesamt Leipzig, Geburtsregister 1885–1900",
    kind: "CIVIL_REGISTRY",
    author: null,
    repository: "Stadtarchiv Leipzig",
    callNumber: "StA Leipzig G 1885–1900",
    url: null,
    date: null,
    notes: null,
  });
  for (const k of dated(childrenOf(founders.B)).slice(0, 3)) {
    cite(registryB, { personId: k.id }, "BIRTH", `Nr. ${100 + yearOf(k) - 1880}/${yearOf(k)}`);
  }

  // 3. Heiratsregister: Ehe zwischen Familie A und B — zitiert für die Ehe
  //    (sichtbar in A), die Braut (A und B) und ihren Elternteil (nur B).
  const crossMarriage = relationships.find(
    (r) =>
      r.type === "PARTNER_OF" &&
      [r.fromPersonId, r.toPersonId].includes(crossIntoA!.wife.id) &&
      [r.fromPersonId, r.toPersonId].includes(crossIntoA!.husband.id),
  )!;
  const crossYear = crossMarriage.startDate?.getUTCFullYear() ?? 1940;
  const crossWeddingImage = images.find((i) => i.relationshipId === crossMarriage.id);
  const crossFamily = source({
    title: `Standesamt Hannover, Heiratsregister ${crossYear}`,
    kind: "CIVIL_REGISTRY",
    author: null,
    repository: "Stadtarchiv Hannover",
    callNumber: `Heiratsregister ${crossYear}, Bd. 3`,
    url: null,
    date: utc(crossYear, 1, 1),
    datePrecision: "YEAR",
    notes: "Heiratseintrag mit Angaben zu den Eltern beider Brautleute.",
    scanImageId: crossWeddingImage?.id ?? null,
  });
  cite(crossFamily, { relationshipId: crossMarriage.id }, "PARTNERSHIP", `Nr. 312/${crossYear}`);
  cite(crossFamily, { personId: crossIntoA!.wife.id }, "NAME", "Geburtsname der Braut");
  cite(crossFamily, { personId: inLawOnlyB!.id }, "NAME", "als Elternteil der Braut genannt", "MEDIUM");

  // 4. Volkszählung Kiel: nur Familie D.
  const censusD = source({
    title: "Volkszählung 1900, Kiel — Einwohnerliste",
    kind: "CENSUS",
    author: null,
    repository: "Stadtarchiv Kiel",
    callNumber: "VZ 1900/Kiel/7",
    url: null,
    date: utc(1900, 12, 1),
    notes: null,
  });
  cite(censusD, { personId: founders.D }, "OTHER", "Haushalt Schulz, Blatt 7", "MEDIUM");
  const founderDWife = spouseOf(founders.D);
  if (founderDWife) cite(censusD, { personId: founderDWife }, "OTHER", "Haushalt Schulz, Blatt 7", "MEDIUM");

  // 5. Grabstein der Stammeltern A.
  const grave = source({
    title: "Grabstein Familie Becker, Stadtfriedhof Engesohde",
    kind: "GRAVESTONE",
    author: null,
    repository: "Stadtfriedhof Engesohde, Hannover",
    callNumber: "Abt. 12, Nr. 34",
    url: null,
    date: null,
    notes: "Inschrift: „Hier ruhen in Gott …“ — Sterbejahre gut lesbar, Tage verwittert.",
  });
  cite(grave, { personId: founderA }, "DEATH", null);
  const founderAWife = spouseOf(founderA);
  if (founderAWife && byId.get(founderAWife)?.deathDate) cite(grave, { personId: founderAWife }, "DEATH", null);

  // 6. Familienbibel Wagner (Familie C).
  const bible = source({
    title: "Familienbibel Wagner",
    kind: "FAMILY_DOCUMENT",
    author: "Familie Wagner",
    repository: "Familienbesitz",
    callNumber: null,
    url: null,
    date: utc(1880, 1, 1),
    datePrecision: "YEAR",
    dateQualifier: "ABOUT",
    notes: "Eintragungen auf dem Vorsatzblatt:\n- Hochzeit der Stammeltern\n- Geburten der Kinder",
  });
  cite(bible, { personId: founders.C }, "BIRTH", "Vorsatzblatt", "MEDIUM");
  cite(bible, { relationshipId: marriageOf(founders.C)!.id }, "PARTNERSHIP", "Vorsatzblatt", "MEDIUM");

  // 7. Mündliche Überlieferung zur Scheidung (Familie A).
  const oral = source({
    title: "Erzählungen von Gertrud Becker (Gespräch)",
    kind: "ORAL",
    author: "Gertrud Becker",
    repository: null,
    callNumber: null,
    url: null,
    date: utc(1998, 5, 1),
    datePrecision: "MONTH",
    notes: "Aufgezeichnet bei einem Familientreffen. Jahreszahlen aus der Erinnerung.",
  });
  cite(oral, { relationshipId: firstMarriage.id }, "PARTNERSHIP", "Erinnerung an die Scheidung", "LOW");

  // 8. Online-Ortsfamilienbuch (Familie A, zweite Generation).
  const ofb = source({
    title: "Online-Ortsfamilienbuch Hildesheim",
    kind: "WEBSITE",
    author: "Verein für Computergenealogie",
    repository: null,
    callNumber: null,
    url: "https://ofb.example.org/hildesheim",
    date: null,
    notes: null,
  });
  const ofbPerson = dated(childrenOf(founderA))[2] ?? dated(childrenOf(founderA))[0];
  cite(ofb, { personId: ofbPerson.id }, "BIRTH", "Familie Nr. 4711", "MEDIUM");

  // 9. Noch nicht ausgewertet — ohne Beleg.
  const uncited = source({
    title: "Adressbuch Hannover 1910",
    kind: "OTHER",
    author: null,
    repository: "Stadtbibliothek Hannover",
    callNumber: "Hann. Adr. 1910",
    url: null,
    date: utc(1910, 1, 1),
    datePrecision: "YEAR",
    notes: "Noch nicht ausgewertet.",
  });

  const landmarks: MockLandmarks = {
    founders,
    crossMarriedIntoA: crossIntoA.wife.id,
    crossMarriedPartnerA: crossIntoA.husband.id,
    inLawOnlyB: inLawOnlyB.id,
    divorced: {
      person: divorcee.id,
      firstSpouse: firstSpouse.id,
      secondSpouse: secondSpouse.id,
      firstMarriage: firstMarriage.id,
    },
    halfSiblings: [stepChild.id, halfSibling.id],
    stepChild: stepChild.id,
    adoptee: adoptee.id,
    adoptiveParents: [adoptiveFather.id, adoptiveMother.id],
    biologicalMotherNoFamily: biologicalMother.id,
    fosterChild: fosterChild.id,
    fosterParents: [fosterFather.id, fosterMother.id],
    duplicates,
    noFamily,
    missingBirthDate,
    probablyDeceasedWithoutDeathDate: probablyDeceased,
    impreciseDates,
    sources: { churchBookA, crossFamily, onlyFamilyD: censusD, uncited },
    citedMarriage: founderAMarriage.id,
  };

  return {
    families,
    users,
    apiTokens: mockApiTokens(),
    persons: persons.map(({ line: _line, married: _married, ...p }) => ({
      ...p,
      familyKeys: [...new Set(p.familyKeys)].sort() as FamilyKey[],
    })),
    relationships,
    images,
    sources,
    citations,
    landmarks,
  };
}

// ---------------------------------------------------------------------------
// KI-Zugangsschlüssel (nur Tests)
// ---------------------------------------------------------------------------

/**
 * Fester Testschlüssel: "ftk_" + 12-stellige Kennung + "_" + Klartext-Etikett,
 * auf 43 Zeichen aufgefüllt. Absichtlich lesbar und erkennbar — NIE in einer
 * echten Datenbank verwenden.
 */
function mockSecret(publicId: string, label: string): string {
  const body = `nur-fuer-tests-${label}-`.padEnd(43, "0").slice(0, 43);
  return `ftk_${publicId}_${body}`;
}

const MOCK_TOKEN_CREATED = new Date("2026-01-01T00:00:00Z");
const MOCK_TOKEN_VALID = new Date("2099-12-31T00:00:00Z");

/**
 * Feste Schlüssel für die Tests (tests/ai-access.db.test.ts):
 *   admin-write     Admin, WRITE                  → wirksam WRITE
 *   editor-write    Editor, WRITE                 → wirksam WRITE (Familie A bearbeiten, B nur lesen)
 *   editor-read     Editor, READ                  → wirksam READ
 *   viewer-read     Betrachter, READ              → wirksam READ
 *   viewer-write    Betrachter (Recht READ), WRITE → wirksam READ (gedeckelt)
 *   editor-revoked  widerrufen                    → REVOKED
 *   editor-expired  abgelaufen                    → EXPIRED
 *   nofamily-read   Benutzer ohne KI-Recht        → NO_PERMISSION
 *   blocked-read    gesperrter Benutzer           → USER_BLOCKED
 */
export const MOCK_API_TOKEN_KEYS = [
  "admin-write",
  "editor-write",
  "editor-read",
  "viewer-read",
  "viewer-write",
  "editor-revoked",
  "editor-expired",
  "nofamily-read",
  "blocked-read",
] as const;
export type MockApiTokenKey = (typeof MOCK_API_TOKEN_KEYS)[number];

function mockApiTokens(): MockApiToken[] {
  const defs: [MockApiTokenKey, string, string, "READ" | "WRITE", Partial<MockApiToken>][] = [
    ["admin-write", "00000000a001", "mock-user-admin", "WRITE", {}],
    ["editor-write", "00000000e001", "mock-user-editor", "WRITE", {}],
    ["editor-read", "00000000e002", "mock-user-editor", "READ", {}],
    ["viewer-read", "00000000b001", "mock-user-viewer", "READ", {}],
    ["viewer-write", "00000000b002", "mock-user-viewer", "WRITE", {}],
    ["editor-revoked", "00000000e003", "mock-user-editor", "WRITE", { revokedAt: new Date("2026-02-01T00:00:00Z") }],
    ["editor-expired", "00000000e004", "mock-user-editor", "WRITE", { expiresAt: new Date("2026-03-01T00:00:00Z") }],
    ["nofamily-read", "00000000f001", "mock-user-nofamily", "READ", {}],
    ["blocked-read", "00000000d001", "mock-user-blocked", "READ", {}],
  ];
  return defs.map(([key, publicId, userId, level, extra]) => ({
    id: `mock-token-${key}`,
    userId,
    name: `Test: ${key}`,
    secret: mockSecret(publicId, key),
    prefix: `ftk_${publicId}`,
    level,
    createdAt: MOCK_TOKEN_CREATED,
    expiresAt: MOCK_TOKEN_VALID,
    revokedAt: null,
    ...extra,
  }));
}
