import {
  formatDateWithPhrase,
  formatFuzzyDate,
  formatFuzzyYear,
  fuzzyField,
  toFuzzyDate,
  type DatePrecision,
  type DateQualifier,
  type FuzzyKey,
} from "./dates";

export type TreePerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birthDate: string | null;
  deathDate: string | null;
  /** Genauigkeit und Zusatz der Lebensdaten (fehlend = tagesgenau). */
  birthDatePrecision?: DatePrecision;
  birthDateQualifier?: DateQualifier;
  deathDatePrecision?: DatePrecision;
  deathDateQualifier?: DateQualifier;
  /** Bereichsende der Lebensdaten (nur bei „zwischen … und …“ bzw. „von … bis …“). */
  birthDateTo?: string | null;
  birthDateToPrecision?: DatePrecision;
  deathDateTo?: string | null;
  deathDateToPrecision?: DatePrecision;
  primaryMediaId: string | null;
  /** Anonymer Platzhalter: der Benutzer darf diese Person nicht sehen. */
  restricted?: boolean;
  /** Familien der Person — Grundlage für den Filter in der Baumansicht. */
  familyIds?: string[];
};

export type TreeRelationship = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  fromPersonId: string;
  toPersonId: string;
  startDate: string | null;
  endDate: string | null;
  startDatePrecision?: DatePrecision;
  startDateQualifier?: DateQualifier;
  endDatePrecision?: DatePrecision;
  endDateQualifier?: DateQualifier;
  /** Bereichsende des Beginns (z.B. Heirat „zwischen 1850 und 1855“). */
  startDateTo?: string | null;
  startDateToPrecision?: DatePrecision;
  primaryMediaId: string | null;
};

/**
 * Treffpunkt zweier Elternteile, die nicht auf einer Doppelkarte sitzen.
 * Beide Elternlinien laufen hier zusammen, von hier führt eine Linie zu den
 * gemeinsamen Kindern — statt dass jeder Elternteil einzeln zu jedem Kind
 * zieht und dieselbe Verbindung mehrfach gezeichnet wird.
 */
export type ParentJunction = {
  id: string;
  x: number;
  y: number;
  parentUnitIds: string[];
  childUnitIds: string[];
};

/** Hochzeit als eigenständiges Ereignis auf der Zeitachse. */
export type MarriageEvent = {
  id: string;
  relationshipId: string;
  date: string;
  datePrecision?: DatePrecision;
  dateQualifier?: DateQualifier;
  dateTo?: string | null;
  dateToPrecision?: DatePrecision;
  subtype: string;
  primaryMediaId: string | null;
  partnerAId: string;
  partnerBId: string;
  /** Knoten, an denen die Partner gezeichnet werden — Ziel der Verbindungen.
   *  Bei einem absorbierten Paar sind beide gleich. */
  anchorAId: string;
  anchorBId: string;
  partnerNames: string;
};

export type TreeData = {
  persons: TreePerson[];
  relationships: TreeRelationship[];
};

export type LayoutNode = {
  person: TreePerson;
  x: number;
  y: number;
  /** Partner, der als zweite Karte direkt daneben gezeichnet wird. */
  partner: TreePerson | null;
  /** Ehe zwischen person und partner — für Datum und Bild am Verbindungsstück. */
  marriage: MarriageInfo | null;
  /** Gehen von diesem Knoten Abstammungslinien aus? Steuert den Stiel, der
   *  die Ehe-Verbindung nach unten mit den Kindern zusammenführt. */
  hasDescendants: boolean;
};

export type MarriageInfo = {
  relationshipId: string;
  /** Personenseite, auf der diese Ehe bearbeitet wird — Ziel des Klicks. */
  personId: string;
  date: string | null;
  endDate: string | null;
  /** Genauigkeit und Zusatz von `date` (Beginn der Ehe). */
  datePrecision?: DatePrecision;
  dateQualifier?: DateQualifier;
  /** Bereichsende von `date`. */
  dateTo?: string | null;
  dateToPrecision?: DatePrecision;
  subtype: string;
  primaryMediaId: string | null;
};

export type LayoutEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "parent" | "partner";
  /** Nur bei kind === "partner": Daten für Beschriftung und Bild der Kante. */
  marriage?: MarriageInfo;
  /**
   * Nur bei kind === "parent": Spur, auf der das waagerechte Stück verläuft.
   * Alle Kinder desselben Elternteils teilen sich eine Spur, verschiedene
   * Eltern bekommen verschiedene — sonst liefen die Linien mehrerer Familien
   * auf gleicher Höhe ineinander und ließen sich nicht mehr zuordnen.
   */
  lane?: number;
  /**
   * An welcher Karte des Kastens die Linie ansetzt. Bei einer Doppelkarte ist
   * die Mitte das Ehe-Verbindungsstück — eine Linie dorthin behauptet, das Kind
   * stamme vom Paar, obwohl nur einer der beiden Elternteil ist.
   */
  sourceSide?: "left" | "right" | "center";
  targetSide?: "left" | "right" | "center";
  /**
   * Korridor für Linien, die mehr als eine Generation überspannen: Punkte in
   * den übersprungenen Ebenen, durch die die Linie geführt wird, statt quer
   * durch fremde Karten zu laufen.
   */
  waypoints?: { x: number; y: number }[];
};

export const NODE_WIDTH = 180;
/**
 * Höhe eines Knotens. Die Karte selbst ist 70px hoch; früher waren es 96,
 * und die 26px Luft standen in jeder Zeile als zusätzlicher Leerraum
 * zwischen den Generationen (die Linien setzten 13px neben der Karte an).
 */
export const NODE_HEIGHT = 76;

type Index = {
  byId: Map<string, TreePerson>;
  childrenOf: Map<string, string[]>;
  parentsOf: Map<string, string[]>;
  partnersOf: Map<string, string[]>;
};

export function indexTree(data: TreeData): Index {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();

  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };

  for (const r of data.relationships) {
    if (r.type === "PARENT_OF") {
      push(childrenOf, r.fromPersonId, r.toPersonId);
      push(parentsOf, r.toPersonId, r.fromPersonId);
    } else {
      push(partnersOf, r.fromPersonId, r.toPersonId);
      push(partnersOf, r.toPersonId, r.fromPersonId);
    }
  }

  return { byId, childrenOf, parentsOf, partnersOf };
}

/**
 * Einheitliches Datumsformat für die gesamte Oberfläche: 01.08.1984 — bzw.
 * bei ungenauen Daten „März 1850“, „1850“, „um 1850“, „vor 1900“. Ohne
 * Angabe von Genauigkeit und Zusatz gilt das Datum als tagesgenau.
 */
export function formatDate(
  d: string | Date | null | undefined,
  precision?: DatePrecision | string | null,
  qualifier?: DateQualifier | string | null,
  /** Ende eines Bereichs (zwischen … und …, von … bis …). */
  to?: string | Date | null,
  toPrecision?: DatePrecision | string | null,
): string {
  return formatFuzzyDate(toFuzzyDate(d ?? null, precision, qualifier, to ?? null, toPrecision));
}

/**
 * Ein Datumsfeld eines Datensatzes vollständig anzeigen — Anker, Genauigkeit,
 * Zusatz, Bereichsende und Wortlaut (`…To`, `…ToPrecision`, `…Phrase`):
 * formatDateOf(person, "birthDate") → „zwischen 1850 und 1855“, „Weihnachten
 * 1850“ (nur Wortlaut) oder „1850 („Weihnachten 1850“)“. Bevorzugt vor
 * formatDate, weil kein Teil der Angabe vergessen werden kann.
 */
export function formatDateOf(obj: object, key: FuzzyKey): string {
  const phrase = (obj as Record<string, unknown>)[`${key}Phrase`];
  return formatDateWithPhrase(fuzzyField(obj, key), typeof phrase === "string" ? phrase : null);
}

export function displayName(p: TreePerson): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}

/** Wortlaut in Kurzanzeigen (Lebensspanne) kürzen. */
const shortPhrase = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim()) return "";
  const t = v.trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
};

/**
 * „1850 – 1912“, „um 1850 – vor 1920“, „zw. 1850 u. 1855 – 1912“, „* um
 * 1850“, „† 1912“. Bereichsenden (`…To`) und — ohne Datum — der Wortlaut
 * (`…Phrase`, gekürzt) zählen mit, wenn das Objekt sie mitbringt.
 */
export function lifeSpan(p: {
  birthDate: string | null;
  deathDate: string | null;
  birthDatePrecision?: DatePrecision | string | null;
  birthDateQualifier?: DateQualifier | string | null;
  deathDatePrecision?: DatePrecision | string | null;
  deathDateQualifier?: DateQualifier | string | null;
  birthDateTo?: string | null;
  birthDateToPrecision?: DatePrecision | string | null;
  deathDateTo?: string | null;
  deathDateToPrecision?: DatePrecision | string | null;
  birthDatePhrase?: string | null;
  deathDatePhrase?: string | null;
}): string {
  const b =
    formatFuzzyYear(
      toFuzzyDate(p.birthDate, p.birthDatePrecision, p.birthDateQualifier, p.birthDateTo, p.birthDateToPrecision),
    ) || shortPhrase(p.birthDatePhrase);
  const d =
    formatFuzzyYear(
      toFuzzyDate(p.deathDate, p.deathDatePrecision, p.deathDateQualifier, p.deathDateTo, p.deathDateToPrecision),
    ) || shortPhrase(p.deathDatePhrase);
  if (!b && !d) return "";
  if (b && d) return `${b} – ${d}`;
  if (b) return `* ${b}`;
  return `† ${d}`;
}
