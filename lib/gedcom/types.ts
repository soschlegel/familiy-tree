/**
 * Neutrales Zwischenmodell für GEDCOM-Import und -Export.
 *
 * Reine, serialisierbare Typen (nur Strings, Zahlen, Booleans, Arrays und
 * Objekte — keine Date-Objekte, keine Prisma-Typen). Was der Interpreter nicht
 * versteht, steht unverändert als Teilbaum in `extensions` des Elements, an
 * dem es hing; der Writer schreibt es an dieselbe Stelle zurück.
 */

// ---------------------------------------------------------------------------
// Rohbaum
// ---------------------------------------------------------------------------

/** Eine GEDCOM-Zeile samt Unterstruktur, CONC/CONT bereits zusammengesetzt. */
export interface GedcomNode {
  tag: string;
  /** Datensatzkennung ohne @ (nur auf Ebene 0). */
  xref?: string;
  /** Wert ohne Zeiger; `@@` ist bereits zu `@` aufgelöst. */
  value?: string;
  /** Zeiger auf einen Datensatz, ohne @ (z.B. "I1"). */
  pointer?: string;
  /** Zeilennummer in der Quelldatei (1-basiert); fehlt bei erzeugten Knoten. */
  line?: number;
  children: GedcomNode[];
}

/**
 * Nicht interpretierter Teilbaum. `path` sind die Tags zwischen dem Element
 * (z.B. der Person) und dem Elternknoten von `node` — leer, wenn `node` direkt
 * darunter hing. Beispiel: `{ path: ["BIRT"], node: {tag: "_UID", …} }`.
 */
export interface GedcomExtension {
  path: string[];
  node: GedcomNode;
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

export type GedcomCalendar = "GREGORIAN" | "JULIAN" | "HEBREW" | "FRENCH_R" | "ROMAN" | "UNKNOWN";

/** Ein Zeitpunkt im angegebenen Kalender (ganz oder teilweise bekannt). */
export interface GedcomDatePoint {
  calendar: GedcomCalendar;
  /** Jahr im Kalender der Angabe; bei v. Chr. negativ gemeint, siehe `bc`. */
  year?: number;
  month?: number;
  day?: number;
  /** Doppeljahr „1749/50“: year = 1749, dualYear = 1750. */
  dualYear?: number;
  bc?: boolean;
  /**
   * Gregorianische Entsprechung, wenn der Kalender ein anderer ist und die
   * Umrechnung sicher möglich war (Julianisch, Französisch-Republikanisch mit
   * Tag). Fehlt sie bei einem anderen Kalender, ist `unconverted` gesetzt.
   */
  gregorian?: { year: number; month?: number; day?: number };
  unconverted?: boolean;
}

export type GedcomDateKind =
  | "EXACT"
  | "ABOUT"
  | "CALCULATED"
  | "ESTIMATED"
  | "BEFORE"
  | "AFTER"
  | "BETWEEN"
  | "FROM"
  | "TO"
  | "FROM_TO"
  | "INTERPRETED"
  | "PHRASE"
  | "INVALID";

export interface GedcomDate {
  /** Text wie in der Datei (nach CONC/CONT, ohne äußere Leerzeichen). */
  original: string;
  kind: GedcomDateKind;
  /** Bei BETWEEN/FROM_TO der Anfang, sonst der einzige Zeitpunkt. */
  start?: GedcomDatePoint;
  /** Bei BETWEEN/FROM_TO das Ende. */
  end?: GedcomDatePoint;
  /** Freitext: bei PHRASE der Text, bei INTERPRETED die Erläuterung. */
  phrase?: string;
  /**
   * Nur nachsichtig erkannt (z.B. „Abt.“, „ca.“, volle Monatsnamen,
   * „BET ABT 1850 AND 1860“, Punktformat). Der Writer schreibt dann die
   * genormte Form, nicht `original`.
   */
  lenient?: boolean;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

export interface GedcomExternalId {
  /** Art: UID, RIN, AFN, REFN, EXID, FSID (FamilySearch), APID (Ancestry) … */
  type: string;
  value: string;
  /** REFN/EXID: TYPE bzw. Herkunft. */
  scheme?: string;
}

export interface GedcomPlace {
  /** Ortsangabe wie geschrieben, z.B. "Musterdorf, Kreis Beispiel, Bayern, Deutschland". */
  name: string;
  /** Kommagetrennte Teile, getrimmt (kleinste Einheit zuerst). */
  parts: string[];
  /** Ebenen laut PLAC.FORM bzw. HEAD.PLAC.FORM, falls angegeben. */
  form?: string[];
  /** Teile mit Ebenenbezeichnung, wenn `form` vorhanden ist. */
  jurisdictions?: { level: string; name: string }[];
  latitude?: number;
  longitude?: number;
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  extensions: GedcomExtension[];
}

export interface GedcomAddress {
  /** ADDR-Wert samt Zeilen (CONT). */
  text?: string;
  lines?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phones: string[];
  emails: string[];
  faxes: string[];
  urls: string[];
}

export interface GedcomPrivacyMarker {
  /** Woran es erkannt wurde: "RESN", "_PRIV", "_PRIVATE", "_LIVING", "NAME". */
  source: string;
  /** Wert des Markers (z.B. "privacy", "Y", "Lebend"). */
  value: string;
}

/**
 * Hinweise auf Privatsphäre bzw. lebende Personen — ohne Entscheidung. Was
 * daraus folgt (nicht importieren, nur Platzhalter …), entscheidet der Import.
 */
export interface GedcomPrivacy {
  /** RESN-Werte normalisiert (confidential | locked | privacy | …). */
  restrictions: string[];
  /** Ausdrücklich als lebend markiert (_LIVING Y o.ä.). */
  livingMarked: boolean;
  /** Name ist ein Platzhalter („Private“, „Living“, „Lebend“, „Privat“ …). */
  placeholderName: boolean;
  markers: GedcomPrivacyMarker[];
}

// ---------------------------------------------------------------------------
// Notizen, Belege, Medien
// ---------------------------------------------------------------------------

export interface GedcomNoteContent {
  /** Lesbarer Text (HTML-Fragmente in Text umgewandelt). */
  text: string;
  /** Originaltext, falls er HTML enthielt (sonst gleich `text`, dann weggelassen). */
  original?: string;
  isHtml: boolean;
}

/** Verweis auf eine gemeinsame Notiz oder eine eingebettete Notiz. */
export interface GedcomNoteRef {
  noteId?: string;
  /** Eingebettete Notiz. */
  content?: GedcomNoteContent;
  citations: GedcomCitation[];
  extensions: GedcomExtension[];
}

export interface GedcomNote {
  id: string;
  content: GedcomNoteContent;
  citations: GedcomCitation[];
  externalIds: GedcomExternalId[];
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

export type GedcomConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface GedcomCitation {
  /** Verweis auf eine Quelle; fehlt bei eingebetteten Quellen (5.5.1). */
  sourceId?: string;
  /** Text einer eingebetteten Quelle („1 SOUR Kirchenbuch …“). */
  inlineText?: string;
  /** Fundstelle (PAGE). */
  page?: string;
  /** QUAY 0–3 wie in der Datei. */
  quality?: number;
  /** Aus QUAY: 3 → HIGH, 2 → MEDIUM, 0/1 → LOW. */
  confidence?: GedcomConfidence;
  /** Ereignistyp, aus dem zitiert wird (EVEN) samt ROLE. */
  eventType?: string;
  role?: string;
  /** DATA.DATE */
  date?: GedcomDate;
  /** DATA.TEXT bzw. TEXT der eingebetteten Quelle (mehrere möglich). */
  texts: string[];
  notes: GedcomNoteRef[];
  media: GedcomMediaLink[];
  externalIds: GedcomExternalId[];
  extensions: GedcomExtension[];
}

export interface GedcomMediaFile {
  /** Pfad oder URL wie geschrieben. Es wird nie etwas heruntergeladen. */
  location: string;
  isUrl: boolean;
  /** FORM (5.5.1, z.B. "jpg") bzw. MIME (7.0). */
  format?: string;
  /** TYPE/MEDI (photo, document …). */
  mediaType?: string;
  title?: string;
}

export interface GedcomMediaObject {
  id?: string;
  files: GedcomMediaFile[];
  title?: string;
  /** _FILESIZE (MyHeritage) */
  fileSize?: number;
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  externalIds: GedcomExternalId[];
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

/** Medienverweis an einer Person/Familie/einem Ereignis/Beleg. */
export interface GedcomMediaLink {
  /** Verweis auf einen OBJE-Datensatz … */
  mediaId?: string;
  /** … oder eingebettetes Objekt (MyHeritage: immer eingebettet). */
  inline?: GedcomMediaObject;
  /** Hauptbild (_PRIM Y, Legacy/MyHeritage). */
  primary: boolean;
  /** MyHeritage: Porträt der Person (_PERSONALPHOTO Y). */
  personalPhoto?: boolean;
  /** MyHeritage: Ausschnitt (_CUTOUT Y / _PRIM_CUTOUT Y). */
  cutout?: boolean;
  primaryCutout?: boolean;
  title?: string;
  extensions: GedcomExtension[];
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

/** Bekannte Ereignis- und Merkmalsarten; alles andere ist CUSTOM mit Label. */
export const GEDCOM_EVENT_TYPES = [
  // Personenereignisse
  "BIRTH",
  "CHRISTENING",
  "BAPTISM",
  "DEATH",
  "BURIAL",
  "CREMATION",
  "ADOPTION",
  "ADULT_CHRISTENING",
  "BAR_MITZVAH",
  "BAS_MITZVAH",
  "BLESSING",
  "CONFIRMATION",
  "FIRST_COMMUNION",
  "ORDINATION",
  "NATURALIZATION",
  "EMIGRATION",
  "IMMIGRATION",
  "CENSUS",
  "PROBATE",
  "WILL",
  "GRADUATION",
  "RETIREMENT",
  // Merkmale
  "CASTE",
  "PHYSICAL_DESCRIPTION",
  "EDUCATION",
  "ID_NUMBER",
  "NATIONALITY",
  "CHILDREN_COUNT",
  "MARRIAGE_COUNT",
  "OCCUPATION",
  "PROPERTY",
  "RELIGION",
  "RESIDENCE",
  "SOCIAL_SECURITY_NUMBER",
  "NOBILITY_TITLE",
  // Familienereignisse
  "ANNULMENT",
  "DIVORCE",
  "DIVORCE_FILED",
  "ENGAGEMENT",
  "MARRIAGE_BANN",
  "MARRIAGE_CONTRACT",
  "MARRIAGE",
  "MARRIAGE_LICENSE",
  "MARRIAGE_SETTLEMENT",
  // Sonstiges
  "CUSTOM_EVENT",
  "CUSTOM_ATTRIBUTE",
] as const;

export type GedcomEventType = (typeof GEDCOM_EVENT_TYPES)[number];

export interface GedcomEvent {
  type: GedcomEventType;
  /** TYPE-Wert: bei CUSTOM_* die Bezeichnung, sonst eine Präzisierung. */
  label?: string;
  /** Wert der Zeile: Beruf, Religion …, „Y“ bei Ereignissen ohne Details. */
  value?: string;
  date?: GedcomDate;
  place?: GedcomPlace;
  address?: GedcomAddress;
  cause?: string;
  /** Alter zum Zeitpunkt (AGE), wie geschrieben. */
  age?: string;
  /** Familienereignisse: Alter der Partner (HUSB.AGE, WIFE.AGE). */
  partnerAges?: { husband?: string; wife?: string };
  agency?: string;
  religion?: string;
  /** ADOP: adoptierende Familie und wer adoptiert hat (BOTH/HUSB/WIFE). */
  adoption?: { familyId?: string; by?: string };
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  media: GedcomMediaLink[];
  externalIds: GedcomExternalId[];
  privacy?: GedcomPrivacy;
  /** Legacy/MyHeritage: bevorzugte Angabe (_PRIM Y). */
  preferred?: boolean;
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

// ---------------------------------------------------------------------------
// Personen und Familien
// ---------------------------------------------------------------------------

export type GedcomSex = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

export type GedcomNameType =
  | "BIRTH"
  | "MARRIED"
  | "AKA"
  | "IMMIGRANT"
  | "MAIDEN"
  | "RELIGIOUS"
  | "PROFESSIONAL"
  | "NICKNAME"
  | "OTHER";

export interface GedcomNameVariant {
  /** "phonetic" (FONE) oder "romanized" (ROMN). */
  kind: "phonetic" | "romanized";
  value: string;
  method?: string;
}

export interface GedcomName {
  /** Vollständiger Name wie geschrieben, ohne Schrägstriche. */
  full: string;
  /** NAME-Wert wie geschrieben, mit Schrägstrichen. */
  original: string;
  given?: string;
  surname?: string;
  /** NPFX: Titel davor (Dr., Pfarrer). */
  prefix?: string;
  /** SPFX: Namenszusatz (von, van, zu). */
  surnamePrefix?: string;
  /** NSFX: Titel danach (jun., III). */
  suffix?: string;
  nickname?: string;
  /** Rufname (_RUFNAME, deutsche Programme). */
  callName?: string;
  type?: GedcomNameType;
  /** TYPE-Wert wie geschrieben (auch bei OTHER). */
  typeLabel?: string;
  /** MyHeritage/PAF: _MARNM — Ehename(n) zu diesem Namen. */
  marriedSurnames: string[];
  /** _AKA unter NAME (Ancestry/PAF). */
  aliases: string[];
  variants: GedcomNameVariant[];
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  preferred?: boolean;
  extensions: GedcomExtension[];
}

export interface GedcomPerson {
  /** Xref ohne @, eindeutig im Dokument (doppelte erhalten "~2" usw.). */
  id: string;
  /** Erster Name = Hauptname, weitere = Varianten (Reihenfolge der Datei). */
  names: GedcomName[];
  sex: GedcomSex;
  /** SEX-Wert wie geschrieben, falls nicht M/F/U/X. */
  sexRaw?: string;
  /** Ereignisse und Merkmale in Dateireihenfolge (auch mehrere gleicher Art). */
  events: GedcomEvent[];
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  media: GedcomMediaLink[];
  externalIds: GedcomExternalId[];
  privacy: GedcomPrivacy;
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  /** Reihenfolge der FAMC-Verweise (erste = Hauptfamilie bei vielen Programmen). */
  parentFamilies: string[];
  /** Reihenfolge der FAMS-Verweise samt nicht Verstandenem darunter. */
  spouseFamilies: { familyId: string; extensions: GedcomExtension[] }[];
  extensions: GedcomExtension[];
}

/**
 * Familienstand eines Paares — geschlossen, 1:1 auf die App abbildbar:
 * - MARRIED: Heiratsereignis (MARR, außer MARR.TYPE „nicht verheiratet“)
 *   oder ausdrückliche Angabe des Programms (z.B. _STAT Married).
 * - DIVORCED: Scheidung oder Annullierung (DIV/ANUL).
 * - UNMARRIED: nur, wenn die Datei es ausdrücklich sagt (7.0 `NO MARR`,
 *   5.5.5 MARR.TYPE „not married“/„partners“, _STAT/_MSTAT/_UST/TYPE mit
 *   entsprechendem Wert).
 * - UNKNOWN: alles andere — insbesondere ein Paar ohne MARR. Verlobung,
 *   Aufgebot, Ehevertrag und Heiratslizenz (ENGA, MARB, MARC, MARL, MARS)
 *   allein ändern daran nichts; die Ereignisse bleiben erhalten.
 */
export type GedcomPartnerStatus = "MARRIED" | "DIVORCED" | "UNMARRIED" | "UNKNOWN";

export const GEDCOM_PARTNER_STATUSES: readonly GedcomPartnerStatus[] = ["MARRIED", "DIVORCED", "UNMARRIED", "UNKNOWN"];

/** Art der Eltern-Kind-Beziehung je Elternteil (entspricht den App-Untertypen). */
export type GedcomChildKind = "BIOLOGICAL" | "ADOPTIVE" | "FOSTER" | "STEP" | "OTHER";

export interface GedcomFamilyChild {
  childId: string;
  /** Art je Partner, gleiche Reihenfolge wie `GedcomFamily.partners`. */
  kinds: GedcomChildKind[];
  /** Rohwerte (PEDI/_FREL/_MREL) je Partner, falls angegeben. */
  kindLabels: (string | undefined)[];
  /** Art wurde ausdrücklich angegeben (sonst Standard „leiblich“). */
  explicit: boolean;
  /** 7.0 FAMC.STAT bzw. 5.5.1 STAT (challenged, disproven, proven). */
  status?: string;
  notes: GedcomNoteRef[];
  /** Nicht verstandenes unter INDI.FAMC. */
  childSideExtensions: GedcomExtension[];
  /** Nicht verstandenes unter FAM.CHIL. */
  familySideExtensions: GedcomExtension[];
}

/**
 * Eine Familie (FAM): Paar (auch gleichgeschlechtlich), einzelner Elternteil
 * mit Kindern, oder — fehlerhaft — ganz ohne Mitglieder.
 */
export interface GedcomFamily {
  id: string;
  /** 0–2 Personen; Reihenfolge HUSB vor WIFE wie in der Datei. */
  partners: string[];
  /** Rolle je Partner wie in der Datei ("HUSB"/"WIFE"). */
  partnerRoles: ("HUSB" | "WIFE")[];
  /** Nur bei zwei Partnern gesetzt; siehe GedcomPartnerStatus. */
  status?: GedcomPartnerStatus;
  /**
   * Woher der Status kommt: Heirats-/Scheidungsereignis, ausdrückliche
   * Angabe (`statusMarker` bzw. MARR.TYPE) oder — Grund für UNKNOWN — kein
   * Heiratsereignis.
   */
  statusEvidence?: "MARRIAGE_EVENT" | "DIVORCE_EVENT" | "EXPLICIT" | "NO_MARRIAGE_EVENT";
  /**
   * Ausdrückliche Statusangabe wie gelesen, z.B. {tag: "_STAT", value:
   * "Never Married"} oder {tag: "NO", value: "MARR"} (GEDCOM 7).
   */
  statusMarker?: { tag: string; value: string };
  children: GedcomFamilyChild[];
  events: GedcomEvent[];
  notes: GedcomNoteRef[];
  citations: GedcomCitation[];
  media: GedcomMediaLink[];
  externalIds: GedcomExternalId[];
  privacy: GedcomPrivacy;
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

// ---------------------------------------------------------------------------
// Quellen, Archive, Einsender
// ---------------------------------------------------------------------------

export interface GedcomRepositoryRef {
  repositoryId?: string;
  /** Name eines eingebetteten Archivs (ohne Datensatz). */
  name?: string;
  callNumbers: string[];
  /** CALN.MEDI */
  mediaType?: string;
  notes: GedcomNoteRef[];
  extensions: GedcomExtension[];
}

export interface GedcomRepository {
  id: string;
  name?: string;
  address?: GedcomAddress;
  notes: GedcomNoteRef[];
  externalIds: GedcomExternalId[];
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

export interface GedcomSource {
  id: string;
  title?: string;
  abbreviation?: string;
  author?: string;
  publication?: string;
  /** TEXT: Abschrift. */
  text?: string;
  /** URL aus WWW (7.0), _URL/_LINK (Ancestry u.a.). */
  urls: string[];
  /** DATA.EVEN: belegte Ereignisarten mit Zeitraum/Ort. */
  dataEvents: { types: string; date?: GedcomDate; place?: string }[];
  dataAgency?: string;
  /** MyHeritage _TYPE (Art der Quelle, Freitext). */
  sourceType?: string;
  /** MyHeritage _MEDI (Medium, Freitext). */
  medium?: string;
  repositories: GedcomRepositoryRef[];
  notes: GedcomNoteRef[];
  media: GedcomMediaLink[];
  externalIds: GedcomExternalId[];
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

export interface GedcomSubmitter {
  id: string;
  name?: string;
  address?: GedcomAddress;
  language?: string;
  notes: GedcomNoteRef[];
  externalIds: GedcomExternalId[];
  /** CHAN.DATE (+ TIME) wie geschrieben. */
  changed?: string;
  /** MyHeritage _UPD (Änderungszeitpunkt mit Zeitzone) wie geschrieben. */
  updated?: string;
  extensions: GedcomExtension[];
}

// ---------------------------------------------------------------------------
// Kopf und Dokument
// ---------------------------------------------------------------------------

export type GedcomDialect =
  | "MYHERITAGE"
  | "ANCESTRY"
  | "FAMILYSEARCH"
  | "GRAMPS"
  | "AHNENBLATT"
  | "FAMILY_TREE_MAKER"
  | "LEGACY"
  | "ROOTSMAGIC"
  | "PAF"
  | "WEBTREES"
  | "HEREDIS"
  | "FAMILY_HISTORIAN"
  | "STAMMBAUM"
  | "UNKNOWN";

export interface GedcomHeader {
  /** HEAD.SOUR: Kennung des erzeugenden Programms (z.B. "MYHERITAGE"). */
  sourceId?: string;
  sourceName?: string;
  sourceVersion?: string;
  sourceCorporation?: string;
  /** HEAD.GEDC.VERS (z.B. "5.5.1", "7.0.14"). */
  gedcomVersion?: string;
  gedcomForm?: string;
  /** HEAD.CHAR wie geschrieben. */
  charset?: string;
  language?: string;
  /** HEAD.DATE (+ TIME), wie geschrieben. */
  exportDate?: string;
  exportTime?: string;
  destination?: string;
  fileName?: string;
  copyright?: string;
  submitterId?: string;
  /** HEAD.PLAC.FORM als Ebenenliste. */
  placeForm?: string[];
  note?: string;
  /** Erkanntes Programm (für nachsichtige Sonderbehandlung). */
  dialect: GedcomDialect;
  /** GEDCOM-Hauptversion für die Lesart (5 oder 7). */
  majorVersion: 5 | 7;
  externalIds: GedcomExternalId[];
  extensions: GedcomExtension[];
}

export interface GedcomDocument {
  header: GedcomHeader;
  persons: GedcomPerson[];
  families: GedcomFamily[];
  sources: GedcomSource[];
  repositories: GedcomRepository[];
  notes: GedcomNote[];
  media: GedcomMediaObject[];
  submitters: GedcomSubmitter[];
  /** Datensätze unbekannter Art (z.B. MyHeritage `0 _PUBLISH`), unverändert. */
  unknownRecords: GedcomNode[];
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

export type GedcomWarningCode =
  | "ENCODING_FALLBACK"
  | "ENCODING_MISMATCH"
  | "ENCODING_UNSUPPORTED"
  | "INVALID_BYTES"
  | "LINE_WITHOUT_LEVEL"
  | "MALFORMED_LINE"
  | "LINE_TOO_LONG"
  | "LEVEL_JUMP"
  | "LEADING_WHITESPACE"
  | "EXTRA_WHITESPACE"
  | "TAB_DELIMITER"
  | "MISSING_DELIMITER"
  | "ORPHAN_CONTINUATION"
  | "CONC_IN_V7"
  | "POINTER_WITH_TRAILING_TEXT"
  | "DUPLICATE_XREF"
  | "MISSING_XREF"
  | "MISSING_HEAD"
  | "MISSING_TRLR"
  | "DATA_AFTER_TRLR"
  | "DANGLING_POINTER"
  | "WRONG_POINTER_TARGET"
  | "INCONSISTENT_LINK"
  | "TOO_MANY_PARTNERS"
  | "INVALID_DATE"
  | "UNCONVERTED_CALENDAR"
  | "EMPTY_RECORD";

export interface GedcomWarning {
  code: GedcomWarningCode;
  /** Deutsche Meldung ohne personenbezogene Inhalte. */
  message: string;
  line?: number;
  /** Betroffener Datensatz (xref), wenn bekannt. */
  recordId?: string;
}

export interface GedcomEncodingInfo {
  /** Tatsächlich verwendete Dekodierung. */
  encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" | "ANSEL" | "WINDOWS-1252" | "MACINTOSH" | "ISO-8859-1" | "STRING";
  bom: boolean;
  /** HEAD.CHAR wie geschrieben. */
  declared?: string;
  /** Wie die Dekodierung bestimmt wurde. */
  detectedBy: "BOM" | "CHAR" | "HEURISTIC" | "DEFAULT" | "STRING";
}

export interface GedcomUnknownTag {
  tag: string;
  count: number;
  /** Ein Beispielpfad, z.B. "INDI.BIRT._UID". */
  examplePath: string;
  /** Zählung je Pfad (höchstens 20 Pfade). */
  paths: Record<string, number>;
}

export interface GedcomStats {
  lines: number;
  /** Zeilen, die als CONC/CONT in einen Wert eingeflossen sind. */
  continuationLines: number;
  /** Leere Zeilen (übersprungen). */
  blankLines: number;
  /** Zeilen ohne Ebene, die als Fortsetzung angehängt wurden. */
  repairedLines: number;
  /** Unlesbare Zeilen (z.B. vor dem ersten Datensatz) — verworfen, mit Warnung. */
  skippedLines: number;
  nodes: number;
  records: Record<string, number>;
}

export interface GedcomParseResult {
  document: GedcomDocument;
  warnings: GedcomWarning[];
  unknownTags: GedcomUnknownTag[];
  encoding: GedcomEncodingInfo;
  stats: GedcomStats;
  /** Rohbaum aller Datensätze (nur mit `keepRaw: true`). */
  raw?: GedcomNode[];
}
