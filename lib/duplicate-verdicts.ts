/**
 * Urteile der KI-Vorprüfung möglicher Dubletten (Tabelle DuplicateReview) und
 * ihre Bezeichnungen. Rein, ohne Datenbank — auch für Client-Komponenten.
 */
export const DUPLICATE_VERDICTS = ["MERGE", "DISPUTED", "NOT_DUPLICATE"] as const;
export type DuplicateVerdict = (typeof DUPLICATE_VERDICTS)[number];

/** Wie die Oberfläche die Urteile nennt. */
export const VERDICT_LABEL: Record<DuplicateVerdict, string> = {
  MERGE: "zusammenführen",
  DISPUTED: "strittig",
  NOT_DUPLICATE: "kein Duplikat",
};

export const REVIEW_REASON_MIN = 10;
export const REVIEW_REASON_MAX = 2000;
