/**
 * GEDCOM-Bibliothek: Lesen (5.5/5.5.1/7.0, nachsichtig), Zwischenmodell,
 * Prüfungen für die Importvorschau, Vergleich zweier Exporte, Schreiben
 * (5.5.1, UTF-8). Ohne Datenbank und ohne App-Abhängigkeiten.
 * Siehe lib/gedcom/README.md.
 */

export * from "./types";
export { parseGedcom, readGedcomTree, type GedcomInput, type ParseOptions, type ParseResultWithTrace } from "./parse";
export { writeGedcom, type WriteOptions, type WriteResult } from "./writer";
export {
  parseGedcomDate,
  formatGedcomDate,
  toAppDate,
  fromAppDate,
  sameDate,
  type AppDate,
  type SimpleDate,
  type AppPrecision,
  type AppQualifier,
} from "./dates";
export {
  deriveRelationships,
  familiesFromRelationships,
  assignRoles,
  UNMARRIED_MARKER,
  type DerivedRelationships,
  type DerivedPartnership,
  type DerivedParentChild,
  type RelationshipsInput,
} from "./relationships";
export { partnerStatusFromLabel, computeFamilyStatus } from "./status";
export { diagnoseGedcom, type GedcomDiagnostic, type DiagnosticCode, type DiagnosticSeverity } from "./diagnostics";
export { diffDocuments, identityKey, type DocumentDiff, type RecordDiff, type RecordChange, type DiffKey } from "./diff";
export { verifyLossless, type LosslessReport } from "./lossless";
export { htmlToText, looksLikeHtml } from "./html";
export { decodeAnsel, encodeAnsel } from "./ansel";
export { encodeUtf8 } from "./encoding";
export { childKindFromLabel, detectDialect } from "./interpret";
