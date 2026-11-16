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
 * Datenlücken, mögliche Dubletten, Personen ohne Familie). Die Sonderfälle
 * sind in `landmarks` mit ihren IDs hinterlegt.
 */

export const MOCK_SEED = 20261116;

/** Feste "Gegenwart" — unabhängig vom Ausführungsdatum. */
export const MOCK_REFERENCE_YEAR = 2025;

export type MockGender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
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
  notes: string | null;
};

export type MockUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  status: "INVITED" | "ACTIVE" | "BLOCKED";
  families: { familyKey: FamilyKey; role: "EDITOR" | "VIEWER" }[];
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
};

export type MockData = {
  families: MockFamily[];
  users: MockUser[];
  persons: MockPerson[];
  relationships: MockRelationship[];
  images: MockImage[];
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

  const add = (p: Omit<Internal, "id" | "married">): Internal => {
    const person: Internal = { ...p, id: personId(), married: false };
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
    { id: "mock-user-admin", email: "admin@example.test", name: "Ada Admin", role: "ADMIN", status: "ACTIVE", families: [] },
    {
      id: "mock-user-editor",
      email: "editor@example.test",
      name: "Erik Editor",
      role: "EDITOR",
      status: "ACTIVE",
      families: [
        { familyKey: "A", role: "EDITOR" },
        { familyKey: "B", role: "VIEWER" },
      ],
    },
    { id: "mock-user-viewer", email: "viewer@example.test", name: "Vera Viewer", role: "VIEWER", status: "ACTIVE", families: [{ familyKey: "A", role: "VIEWER" }] },
    { id: "mock-user-nofamily", email: "nofamily@example.test", name: "Nora Ohnefamilie", role: "VIEWER", status: "ACTIVE", families: [] },
    { id: "mock-user-blocked", email: "blocked@example.test", name: "Bernd Gesperrt", role: "VIEWER", status: "BLOCKED", families: [{ familyKey: "A", role: "VIEWER" }] },
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
  };

  return {
    families,
    users,
    persons: persons.map(({ line: _line, married: _married, ...p }) => ({
      ...p,
      familyKeys: [...new Set(p.familyKeys)].sort() as FamilyKey[],
    })),
    relationships,
    images,
    landmarks,
  };
}
