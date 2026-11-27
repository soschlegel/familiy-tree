/**
 * „Lebenslauf“ der Personenseite: aus den erfassten Daten einer Person ein
 * kurzer Text in ganzen Sätzen — nach festen Regeln, ohne KI. Reine
 * Funktionen ohne Datenbank; Laden und Rechte macht
 * lib/services/biography.ts. Fachliche Regeln: docs/komponenten/bibliotheken.md
 * („lib/biography.ts“).
 *
 * Grundsätze:
 * - Erzählt wird nur, was erfasst ist: Namen, Geburt, Eltern (und die
 *   Stellung unter den Geschwistern, wenn sie sicher feststeht),
 *   Partnerschaften, Kinder, Lebensereignisse, Tod und erreichtes Alter.
 *   Zweitangaben (`isAlternative`), Notizen und Quellen nicht.
 * - Nichts erfinden, nichts glätten: Unsichere Daten bleiben unsicher
 *   („um 1850“, „vor dem 3. Mai 1900“, „zwischen 1850 und 1855“). Fehlt
 *   etwas, entfällt es. Keine Wertungen und keine Schlüsse.
 * - Die Eingabe enthält nur Personen, die der Benutzer sehen darf — der
 *   Text kann also niemanden nennen oder mitzählen, den er nicht sieht.
 * - Dieselbe Eingabe ergibt immer denselben Text (Abwechslung im Satzbau
 *   folgt einer festen Regel, keinem Zufall).
 */
import { dateBounds, MONTH_NAMES, certainlyBefore, type DateEnd, type FuzzyDate } from "./dates";
import type { EventTypeName, PersonNameTypeName } from "./events";
import { isLiving, type CalendarDay } from "./today";

// ---------------------------------------------------------------------------
// Eingabe und Ausgabe
// ---------------------------------------------------------------------------

export type BioGender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

/** Eine sichtbare andere Person (Elternteil, Partner, Kind). */
export type BioRef = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: BioGender;
  birth: FuzzyDate | null;
  death: FuzzyDate | null;
};

export type BioEvent = {
  type: EventTypeName;
  label: string | null;
  date: FuzzyDate | null;
  /** Wortlaut des Datums (nur genutzt, wenn es kein Datum gibt). */
  phrase: string | null;
  place: string | null;
  value: string | null;
};

export type BioPartnership = {
  partner: BioRef;
  subtype: string;
  start: FuzzyDate | null;
  startPhrase: string | null;
  startPlace: string | null;
  end: FuzzyDate | null;
  endPhrase: string | null;
  endPlace: string | null;
  events: BioEvent[];
  /** Leibliche Kinder beider Partner (sichtbar), nach Geburt geordnet. */
  children: BioRef[];
};

export type BiographyInput = {
  person: {
    givenName: string;
    familyName: string | null;
    birthName: string | null;
    nickname: string | null;
    namePrefix: string | null;
    nameSuffix: string | null;
    gender: BioGender;
    birth: FuzzyDate | null;
    birthPhrase: string | null;
    birthPlace: string | null;
    death: FuzzyDate | null;
    deathPhrase: string | null;
    deathPlace: string | null;
    deathCause: string | null;
  };
  /** Weitere Namen (PersonName), Anzeigeform. */
  otherNames: { type: PersonNameTypeName; text: string }[];
  /** Sichtbare Eltern mit Art der Beziehung (BIOLOGICAL, ADOPTIVE, STEP, FOSTER). */
  parents: { person: BioRef; subtype: string }[];
  /**
   * Stellung unter den leiblichen Kindern beider Eltern — nur gesetzt, wenn
   * beide leiblichen Eltern und alle ihre gemeinsamen Kinder sichtbar sind.
   * position null: Reihenfolge nicht sicher (fehlende oder ungenaue Daten).
   */
  siblingRank: { position: number | null; total: number } | null;
  /** Partnerschaften mit sichtbarem Partner, nach Beginn geordnet. */
  partnerships: BioPartnership[];
  /** Sichtbare Kinder, die keiner Partnerschaft zugeordnet sind. */
  otherChildren: { person: BioRef; subtype: string }[];
  /** Lebensereignisse der Person (ohne Zweitangaben), chronologisch. */
  events: BioEvent[];
  /** Heutiger Kalendertag (für „lebt noch“). */
  today: CalendarDay;
};

/** Ein Stück Text; mit personId wird es zum Link auf die Personenseite. */
export type BioSegment = { text: string; personId?: string };

export type Biography = {
  /** Absätze aus Textstücken (Namen anderer Personen als Link). */
  paragraphs: BioSegment[][];
  /** Derselbe Text ohne Links (zum Kopieren). */
  text: string;
};

// ---------------------------------------------------------------------------
// Wörter und Zahlen
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];

/** Zahl als Wort bis zwölf („sieben“), darüber als Ziffern. */
export function numberWord(n: number): string {
  return n >= 0 && n <= 12 ? NUMBER_WORDS[n] : String(n);
}

const ORDINALS = ["", "erstes", "zweites", "drittes", "viertes", "fünftes", "sechstes", "siebtes", "achtes", "neuntes", "zehntes", "elftes", "zwölftes"];

/** Ordnungszahl im Neutrum ohne Artikel („drittes“), ab 13 „13.“. */
function ordinal(n: number): string {
  return n >= 1 && n <= 12 ? ORDINALS[n] : `${n}.`;
}

/** „A“, „A und B“, „A, B und C“ — als Textstücke. */
function listParts(items: Part[][]): Part[] {
  const out: Part[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(i === items.length - 1 ? "und" : ",");
    out.push(...item);
  });
  return out;
}

const fullName = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Daten in Fließtext
// ---------------------------------------------------------------------------

function core(e: DateEnd): string {
  const y = e.date.getUTCFullYear();
  const month = MONTH_NAMES[e.date.getUTCMonth()];
  if (e.precision === "YEAR") return String(y);
  if (e.precision === "MONTH") return `${month} ${y}`;
  return `${e.date.getUTCDate()}. ${month} ${y}`;
}

/** Genau: „am 12. März 1850“, „im März 1850“, „1850“. */
function exactForm(e: DateEnd): string {
  if (e.precision === "DAY") return `am ${core(e)}`;
  if (e.precision === "MONTH") return `im ${core(e)}`;
  return core(e);
}

/** Mit Artikel nach „zwischen“ usw.: „dem 12. März 1850“, sonst wie es ist. */
const withDative = (e: DateEnd) => (e.precision === "DAY" ? `dem ${core(e)}` : core(e));

/**
 * Datum als Adverbial im Satz. `point`: ein Zeitpunkt (Geburt, Heirat …),
 * `span`: etwas Andauerndes (Wohnort, Beruf, Militärdienst) — dort darf ein
 * Zeitraum „von … bis …“ heißen.
 *
 * „am 12. März 1850“, „im März 1850“, „1850“, „um 1850“, „um den 12. März
 * 1850“, „vor dem 3. Mai 1900“, „nach 1723“, „geschätzt 1850“, „errechnet
 * 1850“, „zwischen 1850 und 1855“, „von 1901 bis 1910“, „ab 1901“, „bis
 * 1910“; bei Zeitpunkten statt „ab“/„bis“ „frühestens“/„spätestens“.
 */
export function dateInText(f: FuzzyDate | null, kind: "point" | "span" = "point"): string | null {
  if (!f) return null;
  const day = f.precision === "DAY";
  switch (f.qualifier) {
    case "EXACT":
      return exactForm(f);
    case "ABOUT":
      return day ? `um den ${core(f)}` : f.precision === "MONTH" ? `etwa im ${core(f)}` : `um ${core(f)}`;
    case "BEFORE":
      return `vor ${withDative(f)}`;
    case "AFTER":
      return `nach ${withDative(f)}`;
    case "ESTIMATED":
      return `geschätzt ${exactForm(f)}`;
    case "CALCULATED":
      return `errechnet ${exactForm(f)}`;
    case "BETWEEN":
      return f.to ? `zwischen ${withDative(f)} und ${withDative(f.to)}` : `frühestens ${exactForm(f)}`;
    case "PERIOD":
      if (f.to) {
        if (kind === "point") return `zwischen ${withDative(f)} und ${withDative(f.to)}`;
        return day ? `vom ${core(f)} bis ${f.to.precision === "DAY" ? "zum " : ""}${core(f.to)}` : `von ${core(f)} bis ${f.to.precision === "DAY" ? "zum " : ""}${core(f.to)}`;
      }
      return kind === "point" ? `frühestens ${exactForm(f)}` : day ? `ab dem ${core(f)}` : `ab ${core(f)}`;
    case "UNTIL":
      return kind === "point" ? `spätestens ${exactForm(f)}` : day ? `bis zum ${core(f)}` : `bis ${core(f)}`;
  }
}

/** Datum nur als Wortlaut (ohne strukturiertes Datum): „(Datum: „Palmsonntag“)“. */
function phraseNote(f: FuzzyDate | null, phrase: string | null | undefined): string | null {
  const p = phrase?.trim();
  return !f && p ? `(Datum: „${p}“)` : null;
}

// ---------------------------------------------------------------------------
// Orte in Fließtext
// ---------------------------------------------------------------------------

/**
 * Länder und Landschaften, die mit Artikel stehen („in der Schweiz“, „in den
 * USA“, „im Elsass“). Entscheidend ist der erste Teil der Ortsangabe —
 * „Zürich, Schweiz“ bleibt „in Zürich, Schweiz“.
 */
const PLACE_ARTICLE: Record<string, "der" | "den" | "dem"> = {
  schweiz: "der",
  türkei: "der",
  slowakei: "der",
  ukraine: "der",
  mongolei: "der",
  tschechoslowakei: "der",
  "tschechische republik": "der",
  "dominikanische republik": "der",
  pfalz: "der",
  oberpfalz: "der",
  lausitz: "der",
  altmark: "der",
  uckermark: "der",
  prignitz: "der",
  wetterau: "der",
  eifel: "der",
  rhön: "der",
  batschka: "der",
  bukowina: "der",
  dobrudscha: "der",
  krim: "der",
  niederlande: "den",
  usa: "den",
  "vereinigte staaten": "den",
  "vereinigte staaten von amerika": "den",
  philippinen: "den",
  bahamas: "den",
  "vereinigtes königreich": "dem",
  kongo: "dem",
  irak: "dem",
  iran: "dem",
  jemen: "dem",
  libanon: "dem",
  sudan: "dem",
  tschad: "dem",
  senegal: "dem",
  vatikan: "dem",
  elsass: "dem",
  saarland: "dem",
  rheinland: "dem",
  ruhrgebiet: "dem",
  allgäu: "dem",
  emsland: "dem",
  sauerland: "dem",
  vogtland: "dem",
  baltikum: "dem",
  banat: "dem",
  burgenland: "dem",
  eichsfeld: "dem",
  erzgebirge: "dem",
  schwarzwald: "dem",
  westerwald: "dem",
  odenwald: "dem",
  harz: "dem",
};

/** Ortsangabe beginnt schon mit einer Präposition („bei Celle“, „auf See“). */
const HAS_PREPOSITION = /^(in|im|bei|beim|auf|an|am|zu|zum|zur|nahe|unweit|vor|über|aus)\s/i;

const articleOf = (place: string) => PLACE_ARTICLE[place.split(",")[0].trim().toLowerCase()];

/** Wo: „in Musterdorf“, „in der Schweiz“, „in den USA“, „im Elsass“. */
export function inPlace(place: string): string {
  const t = place.trim();
  if (HAS_PREPOSITION.test(t)) return t;
  const a = articleOf(t);
  return a === "der" ? `in der ${t}` : a === "den" ? `in den ${t}` : a === "dem" ? `im ${t}` : `in ${t}`;
}

/** Wohin: „nach Musterdorf“, „in die Schweiz“, „in die USA“, „ins Elsass“. */
export function toPlace(place: string): string {
  const t = place.trim();
  if (HAS_PREPOSITION.test(t)) return t;
  const a = articleOf(t);
  return a === "der" || a === "den" ? `in die ${t}` : a === "dem" ? `in den ${t}` : `nach ${t}`;
}

// ---------------------------------------------------------------------------
// Alter
// ---------------------------------------------------------------------------

/** Volle Jahre zwischen zwei Zeitpunkten (Kalender, UTC). */
function fullYears(a: Date, b: Date): number {
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
}

function fullMonths(a: Date, b: Date): number {
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) m--;
  return m;
}

const yearsDative = (n: number) => (n === 1 ? "einem Jahr" : `${numberWord(n)} Jahren`);

const APPROX_QUALIFIERS = new Set(["ABOUT", "ESTIMATED", "CALCULATED"]);

/**
 * Erreichtes Alter beim Tod: „im Alter von 71 Jahren“, „im Alter von 70 oder
 * 71 Jahren“ (nur Jahre bekannt), „im Alter von etwa 71 Jahren“ (bei „um“),
 * „im Alter von drei Monaten“; null, wenn es sich nicht ehrlich sagen lässt
 * (offene Angaben, zu großer Spielraum, Widerspruch).
 */
export function ageAtDeath(birth: FuzzyDate | null, death: FuzzyDate | null, gender: BioGender = "UNKNOWN"): string | null {
  if (!birth || !death) return null;
  const b = dateBounds(birth);
  const d = dateBounds(death);
  if (![b.start, b.end, d.start, d.end].every(Number.isFinite)) return null;
  const min = fullYears(new Date(b.end - 1), new Date(d.start));
  const max = fullYears(new Date(b.start), new Date(d.end - 1));
  if (max < 0) return null;
  const approx = APPROX_QUALIFIERS.has(birth.qualifier) || APPROX_QUALIFIERS.has(death.qualifier);
  if (!approx && min === max && min >= 1) return `im Alter von ${yearsDative(min)}`;
  if (!approx && min === max && min === 0) {
    // Unter einem Jahr nur mit tagesgenauen Daten: Monate bzw. Tage.
    if (birth.precision !== "DAY" || death.precision !== "DAY" || birth.qualifier !== "EXACT" || death.qualifier !== "EXACT") return null;
    const months = fullMonths(birth.date, death.date);
    if (months >= 1) return `im Alter von ${months === 1 ? "einem Monat" : `${numberWord(months)} Monaten`}`;
    const days = Math.round((death.date.getTime() - birth.date.getTime()) / 86_400_000);
    if (days < 0) return null;
    if (days === 0) return gender === "MALE" ? "am Tag seiner Geburt" : gender === "FEMALE" ? "am Tag ihrer Geburt" : "am Tag der Geburt";
    return `im Alter von ${days === 1 ? "einem Tag" : `${numberWord(days)} Tagen`}`;
  }
  if (min < 0) return null;
  if (!approx && max - min === 1 && min >= 1) return `im Alter von ${numberWord(min)} oder ${yearsDative(max)}`;
  if (approx && max - min <= 6) {
    const n = death.date.getUTCFullYear() - birth.date.getUTCFullYear();
    return n >= 1 ? `im Alter von etwa ${yearsDative(n)}` : null;
  }
  if (!approx && max - min <= 3 && min >= 1) return `im Alter von ${numberWord(min)} bis ${yearsDative(max)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Sätze bauen
// ---------------------------------------------------------------------------

/**
 * Intern: Ortsangabe „in X“ mit dem Ort, damit ein Ort, der schon im
 * vorigen Satz stand, zu „dort“ werden kann (siehe replaceWithThere). `keep`: nie
 * ersetzen (Sterbeort).
 */
type Seg = BioSegment & { place?: string; keep?: boolean };

type Part = string | Seg | null | undefined | false;

const link = (p: BioRef, text = fullName(p)): BioSegment => ({ text, personId: p.id });

/** Ortsteil „in X“ (bzw. „in der Schweiz“ …) als Seg. */
function where(place: string | null | undefined, keep = false): Seg | null {
  const t = place?.trim();
  return t ? { text: inPlace(t), place: t, keep } : null;
}

const isPlain = (s: Seg) => !s.personId && !s.place;

/** Satz aus Teilen: Leerzeichen dazwischen, groß anfangen, Punkt am Ende. */
function sentence(...parts: Part[]): Seg[] {
  const segs: Seg[] = [];
  let prevText = "";
  for (const raw of parts) {
    if (!raw) continue;
    const seg: Seg = typeof raw === "string" ? { text: raw } : { ...raw };
    if (!seg.text) continue;
    if (segs.length > 0 && !/^[,.;:)]/.test(seg.text) && !/[(„]$/.test(prevText)) segs.push({ text: " " });
    segs.push(seg);
    prevText = seg.text;
  }
  if (segs.length === 0) return segs;
  // Apposition vor dem Satzende: „…, geb. Muster,.“ → „…, geb. Muster.“
  const last = segs[segs.length - 1];
  if (isPlain(last) && last.text === ",") segs.pop();
  segs.push({ text: "." });
  segs[0] = { ...segs[0], text: segs[0].text.charAt(0).toUpperCase() + segs[0].text.slice(1) };
  return mergePlain(segs);
}

/** Benachbarte reine Textstücke zusammenfassen (Links und Orte bleiben einzeln). */
function mergePlain(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && isPlain(prev) && isPlain(s)) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/**
 * „dort“: Nennt ein Satz denselben Ort wie der unmittelbar vorige, heißt er
 * „dort“ („… in Musterdorf geboren. Sie wurde dort getauft.“). Der Sterbeort
 * wird immer ausgeschrieben.
 */
function replaceWithThere(sentences: Seg[][]): Seg[][] {
  let previous = new Set<string>();
  return sentences.map((s) => {
    const places = new Set<string>();
    const out = s.map((seg) => {
      if (!seg.place) return seg;
      places.add(seg.place);
      return !seg.keep && previous.has(seg.place) ? { ...seg, text: "dort" } : seg;
    });
    previous = places;
    return out;
  });
}

/** Interne Felder entfernen, reine Textstücke zusammenfassen. */
function finish(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && !prev.personId && !s.personId) prev.text += s.text;
    else out.push(s.personId ? { text: s.text, personId: s.personId } : { text: s.text });
  }
  return out;
}

const plain = (segs: Seg[]) => segs.map((s) => s.text).join("");

/** Wer der Satz spricht: Pronomen nach Geschlecht, sonst der Name. */
type Voice = {
  /** Satzanfang: „Sie“, „Er“ bzw. der Name. */
  subject(): string;
  /** Im Satz nach dem Verb: „sie“, „er“ bzw. der Name. */
  inner(): string;
  /** „ihr“, „sein“ — null bei unbekanntem Geschlecht. */
  poss: "ihr" | "sein" | null;
};

function voiceFor(gender: BioGender, name: string, full: string): Voice & { introduced: boolean } {
  const v = {
    introduced: false,
    poss: gender === "MALE" ? ("sein" as const) : gender === "FEMALE" ? ("ihr" as const) : null,
    subject() {
      if (!v.introduced) {
        v.introduced = true;
        return full;
      }
      return gender === "MALE" ? "Er" : gender === "FEMALE" ? "Sie" : name;
    },
    inner() {
      if (!v.introduced) {
        v.introduced = true;
        return full;
      }
      return gender === "MALE" ? "er" : gender === "FEMALE" ? "sie" : name;
    },
  };
  return v;
}

/** „Sohn“, „Tochter“, „Kind“. */
const childNoun = (g: BioGender) => (g === "MALE" ? "Sohn" : g === "FEMALE" ? "Tochter" : "Kind");

/**
 * Kinder zählen: „zwei Söhne und eine Tochter“ (alle Geschlechter bekannt),
 * sonst „drei Kinder“; Einzahl „ein Sohn“, „eine Tochter“, „ein Kind“.
 * `acc`: Akkusativ („einen Sohn“).
 */
function childrenCount(children: BioRef[], acc = false): string {
  const n = children.length;
  const one = (g: BioGender) =>
    g === "MALE" ? (acc ? "einen Sohn" : "ein Sohn") : g === "FEMALE" ? "eine Tochter" : "ein Kind";
  if (n === 1) return one(children[0].gender);
  const sons = children.filter((c) => c.gender === "MALE").length;
  const daughters = children.filter((c) => c.gender === "FEMALE").length;
  if (sons + daughters !== n || sons === 0 || daughters === 0) {
    if (sons === n) return `${numberWord(n)} Söhne`;
    if (daughters === n) return `${numberWord(n)} Töchter`;
    return `${numberWord(n)} Kinder`;
  }
  const s = sons === 1 ? one("MALE") : `${numberWord(sons)} Söhne`;
  const d = daughters === 1 ? one("FEMALE") : `${numberWord(daughters)} Töchter`;
  return `${s} und ${d}`;
}

/** Höchstens so viele Kinder werden mit Namen genannt, sonst nur gezählt. */
export const CHILD_NAMES_MAX = 4;

/** Kindernamen: Vorname, wenn der Familienname zu einem Elternteil passt. */
function childNames(children: BioRef[], parentFamilyNames: (string | null)[]): Part[] {
  return listParts(
    children.map((c) => {
      const short = !c.familyName || parentFamilyNames.includes(c.familyName);
      return [link(c, short ? c.givenName : fullName(c))];
    }),
  );
}

/** „Erna Beispiel, geb. Muster,“ als Teile (Link + Geburtsname). */
function personWithBirthName(p: BioRef): Part[] {
  return p.birthName && p.birthName !== p.familyName ? [link(p), ",", `geb. ${p.birthName}`, ","] : [link(p)];
}

const EARLY_TYPES: readonly EventTypeName[] = [
  "BAPTISM",
  "CHRISTENING",
  "ADOPTION",
  "CONFIRMATION",
  "FIRST_COMMUNION",
  "BAR_MITZVAH",
  "BAS_MITZVAH",
  "BLESSING",
];
const POSTHUMOUS_TYPES: readonly EventTypeName[] = ["BURIAL", "CREMATION", "PROBATE"];
const LATE_TYPES: readonly EventTypeName[] = ["RETIREMENT", "WILL"];
/** Merkmale ohne eigenen Zeitpunkt: „Als Religion ist „evangelisch“ erfasst.“ */
const ATTRIBUTE_LABEL: Partial<Record<EventTypeName, string>> = {
  RELIGION: "Religion",
  NATIONALITY: "Staatsangehörigkeit",
  TITLE: "Titel",
  CASTE: "Stand",
  PROPERTY: "Besitz",
};
/** Nicht erzählt: Kennnummern, Beschreibungen, gezählte Kinder/Ehen (würden Nicht-Sichtbares verraten). */
const SKIPPED_TYPES: readonly EventTypeName[] = [
  "BIRTH",
  "DEATH",
  "MARRIAGE",
  "DIVORCE",
  "ID_NUMBER",
  "PHYSICAL_DESCRIPTION",
  "CHILDREN_COUNT",
  "MARRIAGE_COUNT",
];

const anchor = (f: FuzzyDate | null) => (f ? f.date.getTime() : Infinity);

const isMarriage = (subtype: string) => subtype === "MARRIED" || subtype === "DIVORCED";

/** Erzeugt die Sätze; hält Zustand für Pronomen und Satzbau-Wechsel. */
class Narrator {
  readonly voice: ReturnType<typeof voiceFor>;
  /** Wechsel „Datum vorn“ / „Person vorn“ bei datierten Sätzen. */
  private flip = false;

  constructor(
    readonly input: BiographyInput,
    readonly living: boolean,
    readonly deceased: boolean,
  ) {
    const p = input.person;
    const full = [p.namePrefix, p.givenName, p.familyName, p.nameSuffix].filter(Boolean).join(" ");
    this.voice = voiceFor(p.gender, p.givenName, full);
  }

  /**
   * Aussage über die Person: Verb an zweiter Stelle, Datum vorn oder hinter
   * dem Subjekt (abwechselnd). `refl`: „verlobte sich“.
   */
  clause(verb: string, date: string | null, rest: Part[], opts: { refl?: boolean; note?: string | null } = {}): Seg[] {
    const refl = opts.refl ? "sich" : null;
    const parts: Part[] =
      this.voice.introduced && this.front(date)
        ? [date, verb, this.voice.inner(), refl, ...rest]
        : [this.voice.subject(), verb, refl, date, ...rest];
    return sentence(...parts, opts.note);
  }

  /** Steht das Datum dieses Satzes vorn? Wechselt bei jedem datierten Satz. */
  front(date: string | null): boolean {
    if (!date) return false;
    this.flip = !this.flip;
    return this.flip;
  }

  /** Aussage mit anderem Subjekt („das Aufgebot“, „die beiden“), Datum abwechselnd vorn. */
  other(subject: string, verb: string, date: string | null, rest: Part[], note?: string | null): Seg[] {
    if (this.front(date)) return sentence(date, verb, subject, ...rest, note);
    return sentence(subject, verb, date, ...rest, note);
  }
}

// ---------------------------------------------------------------------------
// Einzelne Teile
// ---------------------------------------------------------------------------

/** Erster Satz: Name, Geburt, Eltern, Stellung unter den Geschwistern. */
function birthSentence(n: Narrator): Seg[] | null {
  const { person, parents, siblingRank } = n.input;
  const bio = parents
    .filter((p) => p.subtype === "BIOLOGICAL")
    .sort((a, b) => (a.person.gender === "MALE" ? 0 : 1) - (b.person.gender === "MALE" ? 0 : 1));
  const date = dateInText(person.birth);
  const note = phraseNote(person.birth, person.birthPhrase);
  const hasBirth = Boolean(date || note || person.birthPlace?.trim());
  if (!hasBirth && bio.length === 0) return null;

  const appositions: Part[] = [];
  if (person.birthName && person.birthName !== person.familyName) appositions.push(",", `geb. ${person.birthName}`, ",");
  if (person.nickname) appositions.push(",", `genannt „${person.nickname}“`, ",");
  const subject = n.voice.subject();

  const parentParts = listParts(bio.map((p) => personWithBirthName(p.person)));
  const rank = bio.length === 2 ? siblingRank : null;
  const rankWord = (withArticle: boolean): string | null => {
    if (!rank || rank.total < 2) return null;
    const total = numberWord(rank.total);
    if (rank.position === null) return `eines von ${total} Kindern`;
    const pos = rank.position;
    if (pos > 12 && pos < rank.total) return `${withArticle ? "das " : ""}${pos}. von ${total} Kindern`;
    const word =
      rank.total === 2
        ? pos === 1
          ? "ältere"
          : "jüngere"
        : pos === 1
          ? "älteste"
          : pos === rank.total
            ? "jüngste"
            : ordinal(pos).replace(/s$/, "");
    return withArticle ? `das ${word} von ${total} Kindern` : `${word}s von ${total} Kindern`;
  };

  if (hasBirth) {
    const as: Part[] =
      bio.length > 0 ? ["als", rankWord(false) ?? childNoun(person.gender), "von", ...parentParts] : [];
    return sentence(subject, ...appositions, "wurde", date, where(person.birthPlace), ...as, "geboren", note);
  }
  // Ohne Geburtsangaben: nur die Abstammung.
  const verb = n.living ? "ist" : "war";
  const noun = rankWord(true) ?? (person.gender === "FEMALE" ? "eine Tochter" : person.gender === "MALE" ? "ein Sohn" : "ein Kind");
  return sentence(subject, ...appositions, verb, noun, "von", ...parentParts);
}

const NON_BIO_PARENT: Record<string, { one: Record<"MALE" | "FEMALE" | "X", string>; many: string }> = {
  ADOPTIVE: { one: { MALE: "Adoptivvater", FEMALE: "Adoptivmutter", X: "Adoptivelternteil" }, many: "Adoptiveltern" },
  STEP: { one: { MALE: "Stiefvater", FEMALE: "Stiefmutter", X: "Stiefelternteil" }, many: "Stiefeltern" },
  FOSTER: { one: { MALE: "Pflegevater", FEMALE: "Pflegemutter", X: "Pflegeelternteil" }, many: "Pflegeeltern" },
};

/** „Als Adoptiveltern sind A und B erfasst.“ */
function otherParentsSentences(n: Narrator): Seg[][] {
  const out: Seg[][] = [];
  for (const [subtype, words] of Object.entries(NON_BIO_PARENT)) {
    const list = n.input.parents.filter((p) => p.subtype === subtype);
    if (list.length === 0) continue;
    const g = list[0].person.gender;
    const noun = list.length > 1 ? words.many : words.one[g === "MALE" || g === "FEMALE" ? g : "X"];
    out.push(sentence(`Als ${noun}`, list.length > 1 ? "sind" : "ist", ...listParts(list.map((p) => [link(p.person)])), "erfasst"));
  }
  return out;
}

/** Weitere Namen, je Art ein Satz. */
function nameSentences(n: Narrator): Seg[][] {
  const { otherNames, person } = n.input;
  const byType = new Map<PersonNameTypeName, string[]>();
  for (const nm of otherNames) {
    const t = nm.text.trim();
    if (!t) continue;
    if (nm.type === "BIRTH" && t === person.birthName) continue;
    const list = byType.get(nm.type) ?? [];
    if (!list.includes(t)) list.push(t);
    byType.set(nm.type, list);
  }
  const out: Seg[][] = [];
  const names = (list: string[]) => listParts(list.map((t) => [t]));
  const known = n.living ? "ist" : "war";
  for (const [type, list] of byType) {
    const many = list.length > 1;
    switch (type) {
      case "ALIAS":
        out.push(sentence(n.voice.subject(), known, "auch als", ...names(list), "bekannt"));
        break;
      case "VARIANT":
        out.push(sentence(`Der Name ist auch in ${many ? "den Schreibweisen" : "der Schreibweise"}`, ...names(list), "überliefert"));
        break;
      case "MARRIED":
        out.push(sentence(`Als ${many ? "Ehenamen sind" : "Ehename ist"}`, ...names(list), "erfasst"));
        break;
      case "BIRTH":
        out.push(sentence(`Als Geburtsname ${many ? "sind" : "ist"} auch`, ...names(list), "erfasst"));
        break;
      case "RELIGIOUS":
        out.push(sentence(`Als Ordens- bzw. Taufname ${many ? "sind" : "ist"}`, ...names(list), "erfasst"));
        break;
      case "IMMIGRANT":
        out.push(sentence("Nach der Einwanderung führte", n.voice.inner(), many ? "die Namen" : "den Namen", ...names(list)));
        break;
      default:
        out.push(sentence(`Als ${many ? "weitere Namen sind" : "weiterer Name ist"}`, ...names(list), "erfasst"));
    }
  }
  return out;
}

/** Detailangabe in Klammern: „(Gesellenprüfung)“. */
const detail = (v: string | null | undefined) => (v?.trim() ? `(${v.trim()})` : null);

/** „konfirmiert“, „gefirmt“ oder beides — je nach Bezeichnung. */
function confirmationWord(label: string | null): string {
  const l = label?.toLowerCase() ?? "";
  if (l.includes("firm") && !l.includes("konfirm")) return "gefirmt";
  if (l.includes("konfirm")) return "konfirmiert";
  return "konfirmiert bzw. gefirmt";
}

/** Ein Lebensereignis der Person als Satz; null, wenn es nichts zu sagen gibt. */
function eventSentence(n: Narrator, e: BioEvent): Seg[] | null {
  const g = n.input.person.gender;
  const span = ["RESIDENCE", "OCCUPATION", "EDUCATION", "MILITARY_SERVICE"].includes(e.type);
  const date = dateInText(e.date, span ? "span" : "point");
  const note = phraseNote(e.date, e.phrase);
  const attr = ATTRIBUTE_LABEL[e.type];
  if (attr) {
    if (!e.value?.trim()) return null;
    return sentence(`Als ${attr} ist „${e.value.trim()}“ erfasst`);
  }
  const place = () => where(e.place);
  const opts = { note };
  switch (e.type) {
    case "BAPTISM":
    case "CHRISTENING":
      return n.clause("wurde", date, [place(), "getauft"], opts);
    case "ADULT_CHRISTENING":
      return n.clause("wurde", date, [place(), g === "MALE" ? "als Erwachsener" : g === "FEMALE" ? "als Erwachsene" : "im Erwachsenenalter", "getauft"], opts);
    case "ADOPTION":
      return n.clause("wurde", date, [place(), "adoptiert"], opts);
    case "CONFIRMATION":
      return n.clause("wurde", date, [place(), confirmationWord(e.label)], opts);
    case "FIRST_COMMUNION":
      return n.clause("empfing", date, [place(), "die Erstkommunion"], opts);
    case "BAR_MITZVAH":
      return n.clause("feierte", date, [place(), "die Bar Mizwa"], opts);
    case "BAS_MITZVAH":
      return n.clause("feierte", date, [place(), "die Bat Mizwa"], opts);
    case "BLESSING":
      return n.clause("wurde", date, [place(), "gesegnet"], opts);
    case "ORDINATION":
      return n.clause("empfing", date, [place(), "die Weihe", detail(e.value)], opts);
    case "GRADUATION":
      return n.clause("machte", date, [place(), "einen Abschluss", detail(e.value)], opts);
    case "EDUCATION":
      return n.clause("absolvierte", date, [place(), "eine Ausbildung", detail(e.value)], opts);
    case "OCCUPATION":
      if (!e.value?.trim()) return null;
      return n.clause("war", date, [place(), `als ${e.value.trim()}`, "tätig"], opts);
    case "RETIREMENT":
      return n.clause("ging", date, [place(), "in den Ruhestand"], opts);
    case "RESIDENCE": {
      if (!e.place?.trim()) return null;
      return n.clause("lebte", date, [place()], opts);
    }
    case "CENSUS":
      return n.clause("wurde", date, ["bei einer Volkszählung", place(), "erfasst"], opts);
    case "EMIGRATION": {
      const p = e.place?.trim();
      return n.clause("wanderte", date, ["aus", detail(e.value), p ? `; als Ort ist ${p} vermerkt` : null], opts);
    }
    case "IMMIGRATION": {
      const p = e.place?.trim();
      return n.clause("wanderte", date, [p ? toPlace(p) : null, "ein", detail(e.value)], opts);
    }
    case "NATURALIZATION":
      return n.clause("wurde", date, [place(), "eingebürgert"], opts);
    case "MILITARY_SERVICE":
      return n.clause("leistete", date, [place(), "Militärdienst", detail(e.value)], opts);
    case "WILL":
      return n.clause("verfasste", date, [place(), "ein Testament"], opts);
    case "PROBATE":
      return n.other("das Testament", "wurde", date, [place(), "eröffnet"], note);
    case "BURIAL":
      return n.clause("wurde", date, [place(), "beerdigt"], opts);
    case "CREMATION":
      return n.clause("wurde", date, [place(), "eingeäschert"], opts);
    case "CUSTOM": {
      const label = e.label?.trim();
      if (!label) return null;
      return sentence("Außerdem ist das Ereignis", `„${label}“`, detail(e.value), date, place(), "verzeichnet", note);
    }
    default:
      return null;
  }
}

/** Ereignis einer Partnerschaft (Verlobung, Aufgebot …); `partner` für die Verlobung. */
function partnershipEventSentence(n: Narrator, e: BioEvent, partner: BioRef): { segs: Seg[]; namesPartner: boolean } | null {
  const date = dateInText(e.date, e.type === "RESIDENCE" ? "span" : "point");
  const note = phraseNote(e.date, e.phrase);
  const place = () => where(e.place);
  const res = (segs: Seg[] | null, namesPartner = false) => (segs ? { segs, namesPartner } : null);
  switch (e.type) {
    case "ENGAGEMENT":
      return res(n.clause("verlobte", date, [place(), "mit", link(partner)], { refl: true, note }), true);
    case "MARRIAGE_BANNS":
      return res(n.other("das Aufgebot", "wurde", date, [place(), "bestellt"], note));
    case "MARRIAGE_LICENSE":
      return res(n.other("die Heiratserlaubnis", "wurde", date, [place(), "erteilt"], note));
    case "MARRIAGE_CONTRACT":
      return res(n.other("ein Ehevertrag", "wurde", date, [place(), "geschlossen"], note));
    case "MARRIAGE_SETTLEMENT":
      return res(n.other("eine Ehevereinbarung", "wurde", date, [place(), "geschlossen"], note));
    case "DIVORCE_FILED":
      return res(n.other("die Scheidung", "wurde", date, [place(), "beantragt"], note));
    case "ANNULMENT":
      return res(n.other("die Ehe", "wurde", date, [place(), "annulliert"], note));
    case "RESIDENCE":
      if (!e.place?.trim()) return null;
      return res(n.other("das Paar", "lebte", date, [place()], note));
    case "CENSUS":
      return res(n.other("das Paar", "wurde", date, ["bei einer Volkszählung", place(), "erfasst"], note));
    case "CUSTOM": {
      const label = e.label?.trim();
      if (!label) return null;
      return res(sentence("Für das Paar ist das Ereignis", `„${label}“`, detail(e.value), date, place(), "verzeichnet", note));
    }
    default:
      return null;
  }
}

const BEFORE_WEDDING: readonly EventTypeName[] = [
  "ENGAGEMENT",
  "MARRIAGE_BANNS",
  "MARRIAGE_LICENSE",
  "MARRIAGE_CONTRACT",
  "MARRIAGE_SETTLEMENT",
];

/** Alle Sätze zu einer Partnerschaft: Vorfeld, Beginn, Ereignisse, Ende, Tod des Partners, Kinder. */
function partnershipSentences(n: Narrator, ps: BioPartnership, current: boolean): Seg[][] {
  const out: Seg[][] = [];
  const { partner } = ps;
  const marriage = isMarriage(ps.subtype);
  const events = [...ps.events].sort((a, b) => anchor(a.date) - anchor(b.date));
  const startAnchor = anchor(ps.start);
  const before = events.filter((e) => BEFORE_WEDDING.includes(e.type) && (!e.date || anchor(e.date) <= startAnchor));
  const after = events.filter((e) => !before.includes(e));

  let partnerNamed = false;
  for (const e of before) {
    const s = partnershipEventSentence(n, e, partner);
    if (s) {
      out.push(s.segs);
      partnerNamed ||= s.namesPartner;
    }
  }

  const date = dateInText(ps.start);
  const note = phraseNote(ps.start, ps.startPhrase);
  if (marriage) {
    if (current) {
      const wedding: Part[] = date || ps.startPlace?.trim() ? [";", "die Hochzeit war", date, where(ps.startPlace), note] : [note];
      out.push(sentence(n.voice.subject(), "ist mit", link(partner), "verheiratet", ...wedding));
    } else if (partnerNamed) {
      out.push(n.other("die beiden", "heirateten", date, [where(ps.startPlace)], note));
    } else {
      out.push(n.clause("heiratete", date, [where(ps.startPlace), link(partner)], { note }));
    }
  } else if (date || ps.startPlace?.trim()) {
    const poss = n.voice.poss ? `${n.voice.poss === "sein" ? "seine" : "ihre"} Partnerschaft` : "die Partnerschaft";
    const at = where(ps.startPlace);
    out.push(
      n.front(date)
        ? sentence(date, "begann", poss, "mit", link(partner), at, note)
        : sentence(poss, "mit", link(partner), "begann", date, at, note),
    );
  } else {
    out.push(sentence(n.voice.subject(), current ? "lebt" : "lebte", "in einer Partnerschaft mit", link(partner)));
  }

  for (const e of after) {
    const s = partnershipEventSentence(n, e, partner);
    if (s) out.push(s.segs);
  }

  // Kinder aus dieser Partnerschaft.
  if (ps.children.length > 0) {
    const verb = ps.children.length === 1 ? "ging" : "gingen";
    const names = ps.children.length <= CHILD_NAMES_MAX ? [":", ...childNames(ps.children, [n.input.person.familyName, n.input.person.birthName, partner.familyName, partner.birthName])] : [];
    out.push(sentence(`Aus der ${marriage ? "Ehe" : "Partnerschaft"}`, verb, childrenCount(ps.children), "hervor", ...names));
  }

  // Ende. (Der Tod des Partners steht zeitlich eingeordnet, partnerDeathSentence.)
  const endDate = dateInText(ps.end);
  const endNote = phraseNote(ps.end, ps.endPhrase);
  if (ps.subtype === "DIVORCED") {
    out.push(n.other("die Ehe", "wurde", endDate, [where(ps.endPlace), "geschieden"], endNote));
  } else if (endDate || endNote || ps.endPlace?.trim()) {
    out.push(n.other(marriage ? "die Ehe" : "die Partnerschaft", "endete", endDate, [where(ps.endPlace)], endNote));
  }
  return out;
}

/**
 * „Ihr Mann starb 1899.“ — nur, wenn die Partnerschaft nicht vorher endete
 * (keine Scheidung, kein Ende erfasst) und der Partner sicher vor der Person
 * starb bzw. die Person noch lebt.
 */
function partnerDeathSentence(n: Narrator, ps: BioPartnership): Seg[] | null {
  if (ps.subtype === "DIVORCED" || ps.end || ps.endPhrase?.trim() || ps.endPlace?.trim()) return null;
  if (!ps.partner.death || !partnerDiedFirst(n, ps.partner)) return null;
  return n.other(partnerNoun(n, ps.partner, isMarriage(ps.subtype)), "starb", dateInText(ps.partner.death), [], null);
}

/**
 * Starb der Partner sicher vor der Person? Ohne eigenes Sterbedatum nur,
 * wenn die Person nicht als verstorben erfasst ist (sonst ist die
 * Reihenfolge offen).
 */
function partnerDiedFirst(n: Narrator, partner: BioRef): boolean {
  const own = n.input.person.death;
  if (!partner.death) return false;
  if (!own) return !n.deceased;
  return certainlyBefore(partner.death, own);
}

/** „Ihr Mann“, „Seine Frau“, „Ihre Partnerin“ — sonst der Name des Partners. */
function partnerNoun(n: Narrator, partner: BioRef, marriage: boolean): string {
  const poss = n.voice.poss;
  const g = partner.gender;
  if (!poss || (g !== "MALE" && g !== "FEMALE")) return fullName(partner);
  const noun = marriage ? (g === "MALE" ? "Mann" : "Frau") : g === "MALE" ? "Partner" : "Partnerin";
  const article = g === "MALE" ? poss : `${poss}e`;
  return `${article} ${noun}`;
}

const NON_BIO_CHILD: Record<string, [string, string]> = {
  ADOPTIVE: ["ein Adoptivkind", "Adoptivkinder"],
  STEP: ["ein Stiefkind", "Stiefkinder"],
  FOSTER: ["ein Pflegekind", "Pflegekinder"],
};

/** Kinder ohne zugeordnete Partnerschaft und Adoptiv-, Stief- und Pflegekinder. */
function otherChildrenSentences(n: Narrator, anyPartnershipChildren: boolean): Seg[][] {
  const out: Seg[][] = [];
  const has = n.living ? "hat" : "hatte";
  const bio = n.input.otherChildren.filter((c) => c.subtype === "BIOLOGICAL").map((c) => c.person);
  const familyNames = [n.input.person.familyName, n.input.person.birthName];
  if (bio.length > 0) {
    const names = bio.length <= CHILD_NAMES_MAX ? [":", ...childNames(bio, familyNames)] : [];
    if (anyPartnershipChildren) {
      const count =
        bio.length === 1
          ? bio[0].gender === "MALE"
            ? "einen weiteren Sohn"
            : bio[0].gender === "FEMALE"
              ? "eine weitere Tochter"
              : "ein weiteres Kind"
          : `${numberWord(bio.length)} weitere Kinder`;
      out.push(sentence("Außerdem", has, n.voice.inner(), count, ...names));
    } else {
      out.push(sentence(n.voice.subject(), has, childrenCount(bio, true), ...names));
    }
  }
  for (const [subtype, [one, many]] of Object.entries(NON_BIO_CHILD)) {
    const list = n.input.otherChildren.filter((c) => c.subtype === subtype).map((c) => c.person);
    if (list.length === 0) continue;
    const count = list.length === 1 ? one : `${numberWord(list.length)} ${many}`;
    const names = list.length <= CHILD_NAMES_MAX ? [":", ...listParts(list.map((c) => [link(c)]))] : [];
    out.push(sentence(n.voice.subject(), has, count, ...names));
  }
  return out;
}

/** Tod mit Alter und Ort (die Ursache folgt nach der Beerdigung). */
function deathSentences(n: Narrator): Seg[][] {
  const p = n.input.person;
  const date = dateInText(p.death);
  const note = phraseNote(p.death, p.deathPhrase);
  const age = ageAtDeath(p.birth, p.death, p.gender);
  if (!date && !note && !p.deathPlace?.trim()) return [];
  return [n.clause("starb", date, [age, where(p.deathPlace, true)], { note })];
}

// ---------------------------------------------------------------------------
// Gesamttext
// ---------------------------------------------------------------------------

/** Ist die Person verstorben (Sterbeangabe, Beerdigung …)? */
export function isDeceased(input: BiographyInput): boolean {
  const p = input.person;
  return Boolean(
    p.death || p.deathPhrase?.trim() || p.deathPlace?.trim() || p.deathCause?.trim() || input.events.some((e) => POSTHUMOUS_TYPES.includes(e.type)),
  );
}

/**
 * Text des Lebenslaufs; null, wenn die Daten über den Namen hinaus nichts
 * hergeben (dann entfällt der Abschnitt).
 */
export function buildBiography(input: BiographyInput): Biography | null {
  const deceased = isDeceased(input);
  // Lebend: kein Tod erfasst und laut Geburt nicht zu alt — ohne Geburtsdatum
  // bleibt es offen (Vergangenheit, aber kein Sterbesatz).
  const living =
    !deceased && input.person.birth !== null && isLiving({ birth: input.person.birth, death: null, deathWithoutDate: false }, input.today);
  const n = new Narrator(input, living, deceased);

  const events = input.events.filter((e) => !SKIPPED_TYPES.includes(e.type));
  const first: Seg[][] = [];
  const middle: Seg[][] = [];
  const last: Seg[][] = [];

  // 1. Herkunft: Geburt, Eltern, frühe Ereignisse ohne Datum, Namen.
  const birth = birthSentence(n);
  if (birth) first.push(birth);
  first.push(...otherParentsSentences(n));

  const early = events.filter((e) => EARLY_TYPES.includes(e.type));
  const posthumous = events.filter((e) => POSTHUMOUS_TYPES.includes(e.type));
  const late = events.filter((e) => LATE_TYPES.includes(e.type));
  const rest = events.filter((e) => !EARLY_TYPES.includes(e.type) && !POSTHUMOUS_TYPES.includes(e.type) && !LATE_TYPES.includes(e.type));

  // Frühe Ereignisse (Taufe …) direkt nach der Geburt — datierte in
  // zeitlicher Reihenfolge, undatierte dahinter.
  for (const e of [...early.filter((e) => e.date).sort((a, b) => anchor(a.date) - anchor(b.date)), ...early.filter((e) => !e.date)]) {
    const s = eventSentence(n, e);
    if (s) first.push(s);
  }

  // 2. Leben: datierte Ereignisse und Partnerschaften nach Datum; dann
  // undatierte Ereignisse, Merkmale, undatierte Partnerschaften, Kinder.
  const marriedOpen = input.partnerships.filter(
    (ps) => ps.subtype === "MARRIED" && !ps.end && !ps.endPhrase && !ps.endPlace && !ps.partner.death,
  );
  const unmarriedOpen = input.partnerships.filter(
    (ps) => !isMarriage(ps.subtype) && !ps.end && !ps.endPhrase && !ps.endPlace && !ps.partner.death,
  );
  const isCurrent = (ps: BioPartnership) =>
    living && input.partnerships.length > 0 && (marriedOpen.length === 1 ? ps === marriedOpen[0] : marriedOpen.length === 0 && unmarriedOpen.length === 1 && ps === unmarriedOpen[0]);

  type Item = { at: number; order: number; render: () => Seg[][] };
  const items: Item[] = [];
  let order = 0;
  const datedRest = rest.filter((e) => e.date);
  const undatedRest = rest.filter((e) => !e.date);
  for (const e of datedRest) items.push({ at: anchor(e.date), order: order++, render: () => [eventSentence(n, e)].filter((s): s is Seg[] => !!s) });
  for (const ps of input.partnerships.filter((ps) => ps.start)) {
    items.push({ at: anchor(ps.start), order: order++, render: () => partnershipSentences(n, ps, isCurrent(ps)) });
    if (ps.partner.death) {
      // Tod des Partners an seiner Stelle in der Zeit (nie vor der Partnerschaft).
      const at = Math.max(anchor(ps.partner.death), anchor(ps.start));
      items.push({ at, order: order++, render: () => [partnerDeathSentence(n, ps)].filter((s): s is Seg[] => !!s) });
    }
  }
  for (const e of late.filter((e) => e.date)) items.push({ at: anchor(e.date), order: order++, render: () => [eventSentence(n, e)].filter((s): s is Seg[] => !!s) });
  items.sort((a, b) => a.at - b.at || a.order - b.order);

  // Namen erst, wenn die Person schon eingeführt ist (sonst bezöge sich „Der Name“ auf nichts).
  let nameCount = 0;
  const names = () => {
    const s = nameSentences(n);
    nameCount += s.length;
    return s;
  };
  if (first.length > 0) first.push(...names());

  // Undatierte Angaben (Beruf, Wohnort, Merkmale) vor der Zeitleiste — sie
  // gehören zu keinem Zeitpunkt; Berufe ohne Datum und ohne Ort in einem Satz.
  const plainJobs = undatedRest.filter((e) => e.type === "OCCUPATION" && e.value?.trim() && !e.place?.trim() && !e.phrase?.trim());
  if (plainJobs.length > 0) {
    const jobs = [...new Set(plainJobs.map((e) => e.value!.trim()))];
    middle.push(
      living
        ? sentence(`Als Beruf${jobs.length > 1 ? "e sind" : " ist"}`, ...listParts(jobs.map((j) => [j])), "erfasst")
        : sentence(n.voice.subject(), "war als", ...listParts(jobs.map((j) => [j])), "tätig"),
    );
  }
  for (const e of undatedRest.filter((e) => !plainJobs.includes(e) && !ATTRIBUTE_LABEL[e.type])) {
    if (living && e.type === "OCCUPATION" && e.value?.trim()) {
      middle.push(sentence(`Als Beruf ist ${e.value.trim()}`, e.place?.trim() ? inPlace(e.place) : null, "erfasst"));
      continue;
    }
    if (living && e.type === "RESIDENCE" && e.place?.trim()) {
      middle.push(sentence(`Als Wohnort ist ${e.place.trim()} erfasst`));
      continue;
    }
    const s = eventSentence(n, e);
    if (s) middle.push(s);
  }
  for (const e of undatedRest.filter((e) => ATTRIBUTE_LABEL[e.type])) {
    const s = eventSentence(n, e);
    if (s) middle.push(s);
  }
  for (const it of items) middle.push(...it.render());
  for (const ps of input.partnerships.filter((ps) => !ps.start)) {
    middle.push(...partnershipSentences(n, ps, isCurrent(ps)));
    const death = partnerDeathSentence(n, ps);
    if (death) middle.push(death);
  }
  middle.push(...otherChildrenSentences(n, input.partnerships.some((ps) => ps.children.length > 0)));
  for (const e of late.filter((e) => !e.date)) {
    const s = eventSentence(n, e);
    if (s) middle.push(s);
  }
  if (first.length === 0 && middle.length > 0) middle.push(...names());

  // 3. Lebensende: Tod, Ursache, Beerdigung, Testamentseröffnung.
  last.push(...deathSentences(n));
  for (const e of [...posthumous.filter((e) => e.date).sort((a, b) => anchor(a.date) - anchor(b.date)), ...posthumous.filter((e) => !e.date)]) {
    const s = eventSentence(n, e);
    if (s) last.push(s);
  }
  if (input.person.deathCause?.trim()) last.push(sentence(`Als Todesursache ist „${input.person.deathCause.trim()}“ vermerkt`));
  if (first.length === 0 && middle.length === 0 && last.length > 0) last.push(...names());

  // Nur Namenssätze ergeben keinen Lebenslauf.
  if (first.length + middle.length + last.length - nameCount <= 0) return null;

  // „dort“ innerhalb eines Absatzes; ein neuer Absatz nennt den Ort wieder.
  const paragraphs = [first, middle, last]
    .filter((p) => p.length > 0)
    .map((g) => finish(replaceWithThere(g).flatMap((s, k) => (k === 0 ? s : [{ text: " " }, ...s]))));
  return { paragraphs, text: paragraphs.map(plain).join("\n\n") };
}
