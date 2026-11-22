/**
 * Lebensereignisse und Namensvarianten — Arten, deutsche Bezeichnungen und
 * die Regeln, wo welche Angabe steht. Reine Daten/Funktionen ohne Datenbank,
 * damit Dienste, Import, MCP und Oberfläche dieselben Regeln verwenden.
 *
 * ## Wo steht welche Angabe? (genau ein Ort je Tatsache)
 *
 * | Tatsache | Ort |
 * |---|---|
 * | Geburt (Datum, Ort, Wortlaut) | Person.birthDate…, birthPlace |
 * | Tod (Datum, Ort, Ursache) | Person.deathDate…, deathPlace, deathCause |
 * | Heirat / Beginn einer Partnerschaft | Relationship (PARTNER_OF).startDate…, startPlace; subtype MARRIED/UNMARRIED |
 * | Scheidung / Ende einer Partnerschaft | Relationship.endDate…, endPlace; Scheidung: subtype DIVORCED |
 * | Beginn eines Adoptiv-/Stief-/Pflegeverhältnisses | Relationship (PARENT_OF).startDate |
 * | Name | Person.givenName/familyName/birthName + nickname/namePrefix/nameSuffix |
 * | weitere Namen | PersonName |
 * | alles andere (Taufe, Beerdigung, Beruf, Wohnort, …) | Event an Person bzw. Beziehung |
 *
 * Eine zweite, abweichende Angabe zu Geburt, Tod, Heirat oder Scheidung
 * (in GEDCOM häufig: zwei BIRT-Sätze) überschreibt nichts, sondern wird ein
 * Event der Art BIRTH/DEATH/MARRIAGE/DIVORCE mit `isAlternative = true`.
 * Diese vier Arten gibt es NUR als Alternative. Umgekehrt dürfen alle anderen
 * Arten auch als Alternative vorkommen (zweite, widersprüchliche
 * Taufangabe). Alternativen erscheinen nicht in Zeitleisten und nicht in der
 * Plausibilitätsprüfung — sie sind Recherchematerial, keine Tatsachen.
 *
 * Adoption: GEDCOM ADOP ist ein Ereignis der Person (ADOPTION). Die
 * Elternbeziehung selbst ist PARENT_OF mit subtype ADOPTIVE; deren startDate
 * bleibt leer, wenn das Datum schon im Ereignis steht.
 *
 * Details der Hauptangaben, für die es keine Spalte gibt (Altersangabe oder
 * Anschrift bei Geburt/Tod, Notiz oder TYPE an MARR …), legt der Import im
 * Rohdatenspeicher (ImportRawRecord) der Person bzw. Beziehung ab.
 */

export const EVENT_TYPES = [
  "BIRTH",
  "DEATH",
  "BAPTISM",
  "CHRISTENING",
  "ADULT_CHRISTENING",
  "BURIAL",
  "CREMATION",
  "ADOPTION",
  "CONFIRMATION",
  "FIRST_COMMUNION",
  "BAR_MITZVAH",
  "BAS_MITZVAH",
  "BLESSING",
  "ORDINATION",
  "GRADUATION",
  "EDUCATION",
  "OCCUPATION",
  "RETIREMENT",
  "RESIDENCE",
  "CENSUS",
  "EMIGRATION",
  "IMMIGRATION",
  "NATURALIZATION",
  "MILITARY_SERVICE",
  "RELIGION",
  "NATIONALITY",
  "TITLE",
  "PROPERTY",
  "PHYSICAL_DESCRIPTION",
  "ID_NUMBER",
  "CASTE",
  "CHILDREN_COUNT",
  "MARRIAGE_COUNT",
  "WILL",
  "PROBATE",
  "MARRIAGE",
  "DIVORCE",
  "ENGAGEMENT",
  "MARRIAGE_BANNS",
  "MARRIAGE_CONTRACT",
  "MARRIAGE_LICENSE",
  "MARRIAGE_SETTLEMENT",
  "DIVORCE_FILED",
  "ANNULMENT",
  "CUSTOM",
] as const;
export type EventTypeName = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventTypeName, string> = {
  BIRTH: "Geburt",
  DEATH: "Tod",
  BAPTISM: "Taufe",
  CHRISTENING: "Kindstaufe",
  ADULT_CHRISTENING: "Erwachsenentaufe",
  BURIAL: "Beerdigung",
  CREMATION: "Einäscherung",
  ADOPTION: "Adoption",
  CONFIRMATION: "Konfirmation/Firmung",
  FIRST_COMMUNION: "Erstkommunion",
  BAR_MITZVAH: "Bar Mizwa",
  BAS_MITZVAH: "Bat Mizwa",
  BLESSING: "Segnung",
  ORDINATION: "Ordination/Weihe",
  GRADUATION: "Abschluss",
  EDUCATION: "Ausbildung",
  OCCUPATION: "Beruf",
  RETIREMENT: "Ruhestand",
  RESIDENCE: "Wohnort",
  CENSUS: "Volkszählung",
  EMIGRATION: "Auswanderung",
  IMMIGRATION: "Einwanderung",
  NATURALIZATION: "Einbürgerung",
  MILITARY_SERVICE: "Militärdienst",
  RELIGION: "Religion",
  NATIONALITY: "Staatsangehörigkeit",
  TITLE: "Titel",
  PROPERTY: "Besitz",
  PHYSICAL_DESCRIPTION: "Beschreibung",
  ID_NUMBER: "Kennnummer",
  CASTE: "Stand",
  CHILDREN_COUNT: "Zahl der Kinder",
  MARRIAGE_COUNT: "Zahl der Ehen",
  WILL: "Testament",
  PROBATE: "Testamentseröffnung",
  MARRIAGE: "Heirat",
  DIVORCE: "Scheidung",
  ENGAGEMENT: "Verlobung",
  MARRIAGE_BANNS: "Aufgebot",
  MARRIAGE_CONTRACT: "Ehevertrag",
  MARRIAGE_LICENSE: "Heiratserlaubnis",
  MARRIAGE_SETTLEMENT: "Ehevereinbarung",
  DIVORCE_FILED: "Scheidungsantrag",
  ANNULMENT: "Annullierung",
  CUSTOM: "Sonstiges Ereignis",
};

/** Arten, deren Hauptangabe anderswo steht — nur als Alternative erlaubt. */
export const ALTERNATIVE_ONLY_TYPES: readonly EventTypeName[] = ["BIRTH", "DEATH", "MARRIAGE", "DIVORCE"];

/** Arten, die nur an einer Partnerschaft (PARTNER_OF) stehen dürfen. */
export const PARTNERSHIP_EVENT_TYPES: readonly EventTypeName[] = [
  "MARRIAGE",
  "DIVORCE",
  "ENGAGEMENT",
  "MARRIAGE_BANNS",
  "MARRIAGE_CONTRACT",
  "MARRIAGE_LICENSE",
  "MARRIAGE_SETTLEMENT",
  "DIVORCE_FILED",
  "ANNULMENT",
];

/** Arten, die an Person UND an Beziehung vorkommen (GEDCOM: an INDI und FAM). */
const SHARED_EVENT_TYPES: readonly EventTypeName[] = ["CENSUS", "RESIDENCE", "CUSTOM"];

/** Nach dem Tod üblich — gelten nicht als „Ereignis nach dem Tod“. */
export const POSTHUMOUS_EVENT_TYPES: readonly EventTypeName[] = ["BURIAL", "CREMATION", "PROBATE"];

export type EventOwner =
  | { kind: "person" }
  | { kind: "relationship"; type: "PARENT_OF" | "PARTNER_OF" };

/** Darf diese Art an diesem Träger stehen? */
export function eventTypeAllowed(type: EventTypeName, owner: EventOwner): boolean {
  if (owner.kind === "person") return !PARTNERSHIP_EVENT_TYPES.includes(type);
  if (SHARED_EVENT_TYPES.includes(type)) return true;
  return owner.type === "PARTNER_OF" && PARTNERSHIP_EVENT_TYPES.includes(type);
}

/** Erlaubte Arten für einen Träger (Auswahllisten). */
export function eventTypesFor(owner: EventOwner): EventTypeName[] {
  return EVENT_TYPES.filter((t) => eventTypeAllowed(t, owner));
}

export type EventRuleIssue = { path: string; message: string };

/** Fachregeln eines Ereignisses (Art, Träger, Alternative, Bezeichnung). */
export function eventIssues(e: {
  type: EventTypeName;
  isAlternative: boolean;
  label?: string | null;
  owner: EventOwner;
}): EventRuleIssue[] {
  const issues: EventRuleIssue[] = [];
  const name = EVENT_TYPE_LABEL[e.type];
  if (!eventTypeAllowed(e.type, e.owner)) {
    issues.push({
      path: "type",
      message:
        e.owner.kind === "person"
          ? `„${name}“ gehört an eine Partnerschaft, nicht an eine Person`
          : e.owner.type === "PARENT_OF"
            ? `„${name}“ passt nicht zu einer Eltern-Kind-Beziehung`
            : `„${name}“ gehört an eine Person, nicht an eine Partnerschaft`,
    });
  }
  if (ALTERNATIVE_ONLY_TYPES.includes(e.type) && !e.isAlternative) {
    const where =
      e.type === "BIRTH"
        ? "im Geburtsdatum der Person"
        : e.type === "DEATH"
          ? "im Sterbedatum der Person"
          : e.type === "MARRIAGE"
            ? "im Beginn der Partnerschaft"
            : "im Ende der Partnerschaft";
    issues.push({
      path: "isAlternative",
      message: `„${name}“ steht ${where}; als Ereignis nur als abweichende Zweitangabe (isAlternative)`,
    });
  }
  if (e.type === "CUSTOM" && !e.label?.trim()) {
    issues.push({ path: "label", message: "Ein sonstiges Ereignis braucht eine Bezeichnung" });
  }
  return issues;
}

/** Anzeigename eines Ereignisses: Bezeichnung bei CUSTOM, sonst die Art. */
export function eventTitle(e: { type: EventTypeName; label?: string | null }): string {
  if (e.type === "CUSTOM") return e.label?.trim() || EVENT_TYPE_LABEL.CUSTOM;
  return EVENT_TYPE_LABEL[e.type];
}

// ---------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------

export const PERSON_NAME_TYPES = ["BIRTH", "MARRIED", "ALIAS", "RELIGIOUS", "IMMIGRANT", "VARIANT", "OTHER"] as const;
export type PersonNameTypeName = (typeof PERSON_NAME_TYPES)[number];

export const PERSON_NAME_TYPE_LABEL: Record<PersonNameTypeName, string> = {
  BIRTH: "Geburtsname",
  MARRIED: "Ehename",
  ALIAS: "auch bekannt als",
  RELIGIOUS: "Ordens-/Taufname",
  IMMIGRANT: "Name nach Einwanderung",
  VARIANT: "Schreibvariante",
  OTHER: "anderer Name",
};
