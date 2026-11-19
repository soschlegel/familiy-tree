/**
 * Oberflächen-Texte zu Lebensereignissen: Auswahlreihenfolge der Arten und
 * die Beschriftung des Wertfelds je Art. Die Regeln selbst (welche Art wo
 * stehen darf) stehen in lib/events.ts.
 */
import {
  ALTERNATIVE_ONLY_TYPES,
  EVENT_TYPE_LABEL,
  eventTypesFor,
  type EventOwner,
  type EventTypeName,
} from "./events";

/** Beschriftung des Wertfelds („Beruf“ statt „Wert“). */
const VALUE_CAPTION: Partial<Record<EventTypeName, string>> = {
  OCCUPATION: "Beruf",
  EDUCATION: "Schule / Ausbildung",
  GRADUATION: "Abschluss",
  RELIGION: "Religion / Konfession",
  NATIONALITY: "Staatsangehörigkeit",
  TITLE: "Titel",
  PROPERTY: "Besitz",
  PHYSICAL_DESCRIPTION: "Beschreibung",
  ID_NUMBER: "Nummer",
  CASTE: "Stand",
  CHILDREN_COUNT: "Anzahl der Kinder",
  MARRIAGE_COUNT: "Anzahl der Ehen",
  RESIDENCE: "Anschrift / Beschreibung",
  MILITARY_SERVICE: "Einheit / Dienstgrad",
  CENSUS: "Haushalt / Eintrag",
  WILL: "Inhalt",
};

export function valueCaption(type: EventTypeName): string {
  return VALUE_CAPTION[type] ?? "Beschreibung";
}

/** Häufige Arten zuerst — der Rest folgt alphabetisch unter „Weitere“. */
const COMMON_PERSON: EventTypeName[] = [
  "BAPTISM",
  "CONFIRMATION",
  "OCCUPATION",
  "RESIDENCE",
  "EDUCATION",
  "MILITARY_SERVICE",
  "EMIGRATION",
  "IMMIGRATION",
  "BURIAL",
];
const COMMON_PARTNERSHIP: EventTypeName[] = ["ENGAGEMENT", "MARRIAGE_BANNS", "MARRIAGE_CONTRACT", "RESIDENCE"];

export type EventTypeGroups = {
  common: EventTypeName[];
  more: EventTypeName[];
  /** Hauptangaben, die hier nur als abweichende Zweitangabe stehen dürfen. */
  alternativeOnly: EventTypeName[];
};

/** Arten für die Auswahlliste eines Trägers, gruppiert. CUSTOM steht für sich. */
export function eventTypeGroups(owner: EventOwner): EventTypeGroups {
  const allowed = eventTypesFor(owner);
  const commonList = owner.kind === "person" ? COMMON_PERSON : COMMON_PARTNERSHIP;
  const common = commonList.filter((t) => allowed.includes(t));
  const alternativeOnly = allowed.filter((t) => ALTERNATIVE_ONLY_TYPES.includes(t));
  const more = allowed
    .filter((t) => !common.includes(t) && !alternativeOnly.includes(t) && t !== "CUSTOM")
    .sort((a, b) => EVENT_TYPE_LABEL[a].localeCompare(EVENT_TYPE_LABEL[b], "de"));
  return { common, more, alternativeOnly };
}
