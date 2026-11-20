/**
 * Deutsche Bezeichnungen für Quellen und Belege — gemeinsam für Seiten,
 * Formulare und den MCP-Server.
 */
import type {
  CitationConfidenceName,
  CitationFactName,
  SourceKindName,
} from "./validation";

export const SOURCE_KIND_LABEL: Record<SourceKindName, string> = {
  CHURCH_BOOK: "Kirchenbuch",
  CIVIL_REGISTRY: "Standesamt",
  CENSUS: "Volkszählung / Einwohnerliste",
  GRAVESTONE: "Grabstein / Friedhof",
  FAMILY_DOCUMENT: "Familienunterlagen",
  ORAL: "Mündliche Überlieferung",
  WEBSITE: "Webseite / Datenbank",
  OTHER: "Sonstige Quelle",
  ONLINE_TREE: "Online-Stammbaum",
  ONLINE_COLLECTION: "Online-Sammlung",
};

/**
 * Arten, deren Angaben aus Stammbäumen anderer stammen — keine unabhängige
 * Quelle; ihre Belege tragen keine Verlässlichkeit aus der Datei.
 */
export const DERIVED_SOURCE_KINDS: readonly SourceKindName[] = ["ONLINE_TREE"];

/** Erläuterung je Art (Hinweistext an Badges). */
export const SOURCE_KIND_HINT: Partial<Record<SourceKindName, string>> = {
  ONLINE_TREE: "Aus einem Online-Stammbaum anderer Nutzer übernommen — keine unabhängige Quelle, bitte mit Urkunden belegen.",
  ONLINE_COLLECTION: "Online-Sammlung eines Genealogie-Anbieters.",
};

export const CITATION_FACT_LABEL: Record<CitationFactName, string> = {
  NAME: "Name",
  BIRTH: "Geburt",
  DEATH: "Tod",
  PARTNERSHIP: "Heirat & Partnerschaft",
  PARENTAGE: "Abstammung",
  OTHER: "Allgemein",
  EVENT: "Ereignis",
};

export const CONFIDENCE_LABEL: Record<CitationConfidenceName, string> = {
  HIGH: "gesichert",
  MEDIUM: "wahrscheinlich",
  LOW: "unsicher",
};
