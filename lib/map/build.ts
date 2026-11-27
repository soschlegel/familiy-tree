/**
 * Karte „Wurzeln nach Jahr“: aus Personen, ihren Ortsangaben und den
 * Ortskoordinaten die Daten für den Browser — reine Funktion, einmal je
 * Ausgangsperson auf dem Server gerechnet. Der Browser wechselt die Jahre
 * dann ohne Neuladen (lib/map/year.ts).
 *
 * Regeln (docs/fachlich/karte-und-orte.md):
 *
 * - Jahr einer Angabe: das Jahr des Datums; ungenaue Angaben zählen mit ihrem
 *   Jahr („um 1850“, „vor 1850“, „nach 1850“ als 1850), „zwischen 1850 und
 *   1854“ mit der Mitte (1852), ein Zeitraum „von … bis …“ mit seinem Beginn.
 * - Lebend im Jahr J: Beginn ≤ J ≤ Ende. Beginn = Geburtsjahr, sonst das
 *   früheste datierte Ereignis (Taufe, Heirat, Wohnort …). Ende = Todesjahr,
 *   sonst das Jahr der Beerdigung, sonst geschätzt: Beginn + PRESUMED_LIFESPAN
 *   Jahre (mindestens das letzte datierte Ereignis, höchstens das laufende
 *   Jahr). Personen ganz ohne Datum erscheinen nicht auf der Karte, nur in
 *   der Zahl „ohne Lebensdaten“.
 * - Ort im Jahr J: der zuletzt bekannte Ort bis einschließlich J — Geburt,
 *   Ereignisse mit Ort und Datum (Taufe, Wohnort, Volkszählung, Beruf,
 *   Auswanderung …), Heirat und Scheidung, Tod. Ein Geburtsort ohne
 *   Geburtsdatum gilt ab dem Beginn; Angaben ohne Datum zählen sonst nicht.
 *   Abweichende Zweitangaben (isAlternative) zählen nicht. Vor der ersten
 *   Ortsangabe: „ohne bekannten Ort“. Ein Ortstext ohne Koordinaten
 *   (noch nicht zugeordnet oder nicht zuordenbar) zählt als „Ort nicht auf
 *   der Karte“ — er verdrängt einen früheren Ort, weil die Person dann
 *   nicht mehr dort war.
 * - Zeitreise (Liste „Wer lebte …?“, lib/map/year.ts): Alter im Jahr J =
 *   J − Geburtsjahr (ersatzweise Taufjahr); „etwa“, wenn die Geburt ungenau
 *   ist („um“, „vor“, „zwischen“ …) oder nur die Taufe bekannt ist. Ohne
 *   Geburts- und Taufjahr kein Alter. Hochzeiten (Ehe bzw. geschiedene Ehe
 *   mit Datum) nur, wenn beide Partner sichtbar sind — wie beim Lebensweg.
 */
import { PRESUMED_LIFESPAN } from "../consistency";
import { formatFuzzyYear, type FuzzyDate } from "../dates";
import { placeKey } from "../places/normalize";
import { LINE_KEYS, type LineKey } from "../reference";

export const LINE_BIT: Record<LineKey, number> = { FF: 1, FM: 2, MF: 4, MM: 8 };
export const linesFromBits = (bits: number): LineKey[] => LINE_KEYS.filter((k) => bits & LINE_BIT[k]);

export type MapPlace = {
  label: string;
  lat: number;
  lon: number;
  precision: "PLACE" | "REGION" | "COUNTRY";
};

/** Kurze Schlüssel: die Liste kann bei großen Beständen einige tausend Einträge haben. */
export type MapPerson = {
  id: string;
  /** Name */
  n: string;
  /** Lebensdaten für die Anzeige („1850 – 1912“, „um 1850 – ?“) */
  life: string;
  /** Beginn (Jahr) */
  y0: number;
  /** Ende (Jahr) */
  y1: number;
  /** Ende geschätzt (kein Todes- oder Beerdigungsdatum) */
  est?: 1;
  /** Linien als Bits (LINE_BIT) */
  ln?: number;
  /** Stationen: [Jahr, Ortsindex, Jahr, Ortsindex, …]; Ortsindex -1 = Ort ohne Koordinaten */
  st: number[];
  /** Geburtsjahr für Alter und „Geburten“, nur wenn es von y0 abweicht. */
  b?: number;
  /** Alter ungenau (ungenaue Geburt oder nur Taufe bekannt). */
  ba?: 1;
  /** Jahr aus der Taufe (keine Geburt bekannt). */
  bt?: 1;
  /** Kein Geburts- und kein Taufjahr: kein Alter, keine „Geburt“. */
  nb?: 1;
};

/** Hochzeit einer Person der Auswahl: [Jahr, Index, Index des Partners oder -1, …]. */
export type MapMarriages = number[];

export type MapPayload = {
  places: MapPlace[];
  persons: MapPerson[];
  /** Personen der Auswahl ganz ohne Datum (nicht auf der Karte). */
  undated: number;
  yearMin: number;
  yearMax: number;
  /** Jahr mit den meisten Personen an einem Ort der Karte. */
  defaultYear: number;
  /** Ortstexte der Auswahl ohne Koordinaten (für den Hinweis an Admins). */
  unmappedTexts: number;
  /** Hochzeiten der Auswahl (Zeile „In diesem Jahr“), nach Jahr sortiert. */
  mar: MapMarriages;
};

/** Hochzeit (Ehe mit Datum); b = Partner, wenn er auch in der Auswahl steht. */
export type MapMarriageInput = { a: string; b: string | null; date: FuzzyDate };

export type MapPersonInput = {
  id: string;
  name: string;
  birth: FuzzyDate | null;
  birthPlace: string | null;
  death: FuzzyDate | null;
  deathPlace: string | null;
  lines: LineKey[];
  /** Früheste Taufe (auch ohne Ort): ersetzt für Beginn und Alter die fehlende Geburt. */
  baptism?: FuzzyDate | null;
};

/** Datierte Ortsangabe außer Geburt und Tod (Ereignis, Heirat, Scheidung). */
export type MapFactInput = {
  personId: string;
  date: FuzzyDate | null;
  place: string | null;
  /** Beerdigung/Einäscherung: beendet das Leben, wenn kein Tod bekannt ist. */
  burial?: boolean;
};

/** Ehen (wie die Statistik): verheiratet oder geschieden. */
const MARRIAGE_SUBTYPES = new Set(["MARRIED", "DIVORCED"]);

/**
 * Hochzeiten für die Zeile „In diesem Jahr“: Ehen (auch geschiedene) mit
 * Datum, bei denen **beide** Partner sichtbar sind und mindestens einer in
 * der Auswahl steht — wie beim Lebensweg verrät eine Ehe sonst nichts über
 * einen gesperrten Partner.
 */
export function pickMarriages(
  relationships: { type: string; subtype: string | null; from: string; to: string; date: FuzzyDate | null }[],
  visible: (id: string) => boolean,
  selected: (id: string) => boolean,
): MapMarriageInput[] {
  const out: MapMarriageInput[] = [];
  for (const r of relationships) {
    if (r.type !== "PARTNER_OF" || !MARRIAGE_SUBTYPES.has(r.subtype ?? "") || !r.date) continue;
    if (!visible(r.from) || !visible(r.to)) continue;
    const [a, b] = [r.from, r.to].filter(selected);
    if (a) out.push({ a, b: b ?? null, date: r.date });
  }
  return out;
}

export type CoordsLookup =(key: string) => MapPlace | null;

/** Repräsentatives Jahr einer (ungenauen) Angabe. */
export function factYear(f: FuzzyDate): number {
  const y = f.date.getUTCFullYear();
  if (f.qualifier === "BETWEEN" && f.to) return Math.floor((y + f.to.date.getUTCFullYear()) / 2);
  return y;
}

type Stop = { year: number; rank: number; seq: number; place: string };

export function buildMapData(input: {
  persons: MapPersonInput[];
  facts: MapFactInput[];
  coords: CoordsLookup;
  currentYear: number;
  marriages?: MapMarriageInput[];
}): MapPayload {
  const { currentYear } = input;
  const factsOf = new Map<string, MapFactInput[]>();
  for (const f of input.facts) {
    const list = factsOf.get(f.personId);
    if (list) list.push(f);
    else factsOf.set(f.personId, [f]);
  }

  const places: MapPlace[] = [];
  const placeIndex = new Map<string, number>();
  const unmapped = new Set<string>();
  const indexOf = (text: string): number => {
    const key = placeKey(text);
    const known = placeIndex.get(key);
    if (known !== undefined) return known;
    const c = input.coords(key);
    if (!c) {
      unmapped.add(key);
      placeIndex.set(key, -1);
      return -1;
    }
    places.push(c);
    placeIndex.set(key, places.length - 1);
    return places.length - 1;
  };

  const persons: MapPerson[] = [];
  const indexOfPerson = new Map<string, number>();
  let undated = 0;
  for (const p of input.persons) {
    const facts = factsOf.get(p.id) ?? [];
    const datedYears = facts.filter((f) => f.date).map((f) => factYear(f.date!));
    const baptismYear = p.baptism ? factYear(p.baptism) : null;
    if (baptismYear !== null) datedYears.push(baptismYear);
    const birthYear = p.birth ? factYear(p.birth) : null;
    const deathYear = p.death ? factYear(p.death) : null;

    const y0 = birthYear ?? (datedYears.length ? Math.min(...datedYears, deathYear ?? Infinity) : deathYear);
    if (y0 === null) {
      undated++;
      continue;
    }
    const burials = facts.filter((f) => f.burial && f.date).map((f) => factYear(f.date!));
    let y1: number;
    let est = false;
    if (deathYear !== null) y1 = deathYear;
    else if (burials.length) y1 = Math.min(...burials);
    else {
      est = true;
      y1 = Math.min(currentYear, Math.max(y0 + PRESUMED_LIFESPAN, ...datedYears));
    }
    if (y1 < y0) y1 = y0;

    const stops: Stop[] = [];
    let seq = 0;
    if (p.birthPlace?.trim()) stops.push({ year: y0, rank: 0, seq: seq++, place: p.birthPlace });
    for (const f of facts) {
      if (!f.date || !f.place?.trim()) continue;
      stops.push({ year: Math.min(Math.max(factYear(f.date), y0), y1), rank: 1, seq: seq++, place: f.place });
    }
    if (p.deathPlace?.trim() && deathYear !== null) stops.push({ year: y1, rank: 2, seq: seq++, place: p.deathPlace });
    stops.sort((a, b) => a.year - b.year || a.rank - b.rank || a.seq - b.seq);

    const st: number[] = [];
    for (const s of stops) {
      const idx = indexOf(s.place);
      const n = st.length;
      if (n && st[n - 2] === s.year) {
        // Im selben Jahr zählt die letzte Angabe (Tod nach Geburt, Heirat nach Taufe).
        st[n - 1] = idx;
        if (n >= 4 && st[n - 3] === idx) st.splice(n - 2, 2);
        continue;
      }
      if (n && st[n - 1] === idx) continue; // gleicher Ort wie zuvor
      st.push(s.year, idx);
    }

    // Alter: Geburtsjahr, ersatzweise Taufjahr (dann immer „etwa“).
    const ageBase = birthYear ?? baptismYear;
    const ageApprox = birthYear !== null ? p.birth!.qualifier !== "EXACT" : baptismYear !== null;

    const bits = p.lines.reduce((b, k) => b | LINE_BIT[k], 0);
    indexOfPerson.set(p.id, persons.length);
    persons.push({
      id: p.id,
      n: p.name,
      life: lifeText(p.birth, p.death),
      y0,
      y1,
      ...(est ? { est: 1 as const } : {}),
      ...(bits ? { ln: bits } : {}),
      st,
      ...(ageBase !== null && ageBase !== y0 ? { b: ageBase } : {}),
      ...(ageApprox ? { ba: 1 as const } : {}),
      ...(birthYear === null && baptismYear !== null ? { bt: 1 as const } : {}),
      ...(ageBase === null ? { nb: 1 as const } : {}),
    });
  }

  // Hochzeiten: je Ehe ein Eintrag, Personen ohne Lebensdaten fallen weg.
  const marriages: { year: number; a: number; b: number }[] = [];
  for (const m of input.marriages ?? []) {
    const a = indexOfPerson.get(m.a);
    const b = m.b ? indexOfPerson.get(m.b) : undefined;
    if (a === undefined && b === undefined) continue;
    marriages.push({ year: factYear(m.date), a: (a ?? b)!, b: a === undefined ? -1 : (b ?? -1) });
  }
  marriages.sort((x, y) => x.year - y.year || x.a - y.a);
  const mar: MapMarriages = marriages.flatMap((m) => [m.year, m.a, m.b]);

  // Jahresbereich und Startjahr (meiste Personen an einem Ort der Karte).
  let yearMin = Infinity;
  let yearMax = -Infinity;
  for (const p of persons) {
    yearMin = Math.min(yearMin, p.y0);
    yearMax = Math.max(yearMax, p.y1);
  }
  if (!Number.isFinite(yearMin)) {
    yearMin = currentYear - 100;
    yearMax = currentYear;
  }
  yearMax = Math.min(Math.max(yearMax, yearMin), currentYear);
  yearMin = Math.min(yearMin, yearMax);

  const span = yearMax - yearMin + 1;
  const delta = new Int32Array(span + 1);
  for (const p of persons) {
    for (let i = 0; i < p.st.length; i += 2) {
      const from = Math.max(p.st[i], yearMin);
      const to = Math.min(i + 2 < p.st.length ? p.st[i + 2] - 1 : p.y1, yearMax);
      if (p.st[i + 1] < 0 || to < from) continue;
      delta[from - yearMin]++;
      delta[to - yearMin + 1]--;
    }
  }
  let best = yearMin;
  let bestCount = -1;
  for (let i = 0, run = 0; i < span; i++) {
    run += delta[i];
    if (run > bestCount) {
      bestCount = run;
      best = yearMin + i;
    }
  }

  return { places, persons, undated, yearMin, yearMax, defaultYear: best, unmappedTexts: unmapped.size, mar };
}

function lifeText(birth: FuzzyDate | null, death: FuzzyDate | null): string {
  const b = birth ? formatFuzzyYear(birth) : "";
  const d = death ? formatFuzzyYear(death) : "";
  if (!b && !d) return "";
  return `${b || "?"} – ${d || "?"}`;
}
