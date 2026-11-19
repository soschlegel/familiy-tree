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
};

export const CITATION_FACT_LABEL: Record<CitationFactName, string> = {
  NAME: "Name",
  BIRTH: "Geburt",
  DEATH: "Tod",
  PARTNERSHIP: "Heirat & Partnerschaft",
  PARENTAGE: "Abstammung",
  OTHER: "Sonstiges",
  EVENT: "Ereignis",
};

export const CONFIDENCE_LABEL: Record<CitationConfidenceName, string> = {
  HIGH: "gesichert",
  MEDIUM: "wahrscheinlich",
  LOW: "unsicher",
};
