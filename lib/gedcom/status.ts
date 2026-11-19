/**
 * Familienstand eines Paares bestimmen (siehe GedcomPartnerStatus).
 *
 * Belegt: GEDCOM 7 `NO MARR` (FamilySearch-Spezifikation, Struktur NO);
 * GEDCOM 5.5.5 empfiehlt MARR.TYPE für andere Paarbeziehungen, u.a. „not
 * married“, „partnership“, „living together“ (Tamura Jones, GEDCOM
 * Relationships). Angenommen (Werte nicht an Dateien geprüft): _STAT
 * (FTM/Ancestry/Legacy: z.B. „Never Married“, „Partners“), _MSTAT, Heredis
 * _UST, FAM.TYPE.
 */

import type { GedcomFamily, GedcomPartnerStatus } from "./types";

/** Tags auf Familienebene, die ausdrücklich einen Status angeben (nachsichtig). */
export const FAMILY_STATUS_TAGS = new Set(["_STAT", "_MSTAT", "_UST", "TYPE"]);

const UNMARRIED =
  /^(never married|not married|unmarried|partners?|partnership|living together|living apart together|cohabitation|friends|single|nicht verheiratet|unverheiratet|ledig|lebensgemeinschaft|lebenspartner(?:schaft)?|partnerschaft|nichteheliche lebensgemeinschaft)$/;
const MARRIED =
  /^(married|marriage|verheiratet|ehe|civil|civil union|civil marriage|religious|registered partnership|eingetragene lebenspartnerschaft|common law|widowed|verwitwet|separated|getrennt)$/;
const DIVORCED = /^(divorced|geschieden|annulled|annulliert)$/;
const UNKNOWN = /^(unknown|unbekannt|private|privat)$/;

/** Wert einer Statusangabe → Status; undefined, wenn nicht deutbar. */
export function partnerStatusFromLabel(label: string): GedcomPartnerStatus | undefined {
  const l = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (UNMARRIED.test(l)) return "UNMARRIED";
  if (DIVORCED.test(l)) return "DIVORCED";
  if (MARRIED.test(l)) return "MARRIED";
  if (UNKNOWN.test(l)) return "UNKNOWN";
  return undefined;
}

/** Ist dieses MARR-Ereignis laut TYPE gar keine Ehe (5.5.5-Praxis)? */
export function isNonMaritalMarriageEvent(label: string | undefined): boolean {
  return label !== undefined && partnerStatusFromLabel(label) === "UNMARRIED";
}

/** Setzt status/statusEvidence an einer Familie mit zwei Partnern. */
export function computeFamilyStatus(f: GedcomFamily): void {
  if (f.partners.length !== 2) {
    delete f.status;
    delete f.statusEvidence;
    return;
  }
  const marr = f.events.filter((e) => e.type === "MARRIAGE");
  const realMarriage = marr.some((e) => !isNonMaritalMarriageEvent(e.label));
  const nonMarital = marr.some((e) => isNonMaritalMarriageEvent(e.label));
  const divorce = f.events.some((e) => e.type === "DIVORCE" || e.type === "ANNULMENT");
  const marker = f.statusMarker
    ? f.statusMarker.tag === "NO"
      ? f.statusMarker.value.trim().toUpperCase() === "MARR"
        ? "UNMARRIED"
        : undefined
      : partnerStatusFromLabel(f.statusMarker.value)
    : undefined;

  if (divorce) {
    f.status = "DIVORCED";
    f.statusEvidence = "DIVORCE_EVENT";
  } else if (realMarriage) {
    f.status = "MARRIED";
    f.statusEvidence = "MARRIAGE_EVENT";
  } else if (marker) {
    f.status = marker;
    f.statusEvidence = marker === "UNKNOWN" ? "NO_MARRIAGE_EVENT" : "EXPLICIT";
  } else if (nonMarital) {
    f.status = "UNMARRIED";
    f.statusEvidence = "EXPLICIT";
  } else {
    f.status = "UNKNOWN";
    f.statusEvidence = "NO_MARRIAGE_EVENT";
  }
}
