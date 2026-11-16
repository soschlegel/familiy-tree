/**
 * Kompakte Darstellung für MCP-Ergebnisse — reine Funktionen.
 *
 * Jede Person erscheint überall gleich: `{ id, name, lifespan }`, verborgene
 * Personen als `{ id, name: "Nicht freigegeben", restricted: true }`. Daten
 * stehen als ISO-Datum in ihrer tatsächlichen Genauigkeit darin: `1850`,
 * `1850-03` oder `1850-03-12`; ungefähre Daten mit deutschem Zusatz
 * („um 1850“, „vor 1900“, „nach 1723“).
 */
import {
  toFuzzyDate,
  toIsoPartial,
  formatFuzzyDate,
  type FuzzyDate,
} from "../lib/dates";

export type PersonLike = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName?: string | null;
  birthDate: string | null;
  deathDate: string | null;
  birthDatePrecision?: string | null;
  birthDateQualifier?: string | null;
  deathDatePrecision?: string | null;
  deathDateQualifier?: string | null;
  restricted: boolean;
};

export type Ref =
  | { id: string; name: string; lifespan: string }
  | { id: string; name: string; restricted: true };

/** ISO-Zeitstempel -> YYYY-MM-DD (null bleibt null). */
export const isoDay = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null;

const QUALIFIER_WORD: Record<string, string> = { ABOUT: "um ", BEFORE: "vor ", AFTER: "nach " };

/** Kurzform für Lebensspannen und Listen: „1850-03-12“, „1850“, „um 1850“. */
export function dateToken(f: FuzzyDate | null): string | null {
  if (!f) return null;
  return (QUALIFIER_WORD[f.qualifier] ?? "") + toIsoPartial(f);
}

/**
 * Datum mit Genauigkeit für Ergebnisse, z.B. für prefix "birthDate":
 * `{ birthDate: "1850", birthDatePrecision: "YEAR", birthDateQualifier:
 * "ABOUT", birthDateText: "um 1850" }` — ohne Datum nur `{ birthDate: null }`.
 */
export function dateFields(
  prefix: string,
  iso: string | null | undefined,
  precision?: string | null,
  qualifier?: string | null,
): Record<string, string | null> {
  const f = toFuzzyDate(iso ?? null, precision, qualifier);
  if (!f) return { [prefix]: null };
  return {
    [prefix]: toIsoPartial(f),
    [`${prefix}Precision`]: f.precision,
    [`${prefix}Qualifier`]: f.qualifier,
    [`${prefix}Text`]: formatFuzzyDate(f),
  };
}

export function displayName(p: Pick<PersonLike, "givenName" | "familyName" | "birthName">): string {
  const base = [p.givenName, p.familyName].filter(Boolean).join(" ");
  return p.birthName && p.birthName !== p.familyName ? `${base} (geb. ${p.birthName})` : base;
}

/** "1890-03-12 – 1965-07-01", "um 1850 – vor 1920", "1890 –", "? – 1965-07-01", "?". */
export function lifespan(
  p: Pick<
    PersonLike,
    "birthDate" | "deathDate" | "birthDatePrecision" | "birthDateQualifier" | "deathDatePrecision" | "deathDateQualifier"
  >,
): string {
  const born = dateToken(toFuzzyDate(p.birthDate, p.birthDatePrecision, p.birthDateQualifier));
  const died = dateToken(toFuzzyDate(p.deathDate, p.deathDatePrecision, p.deathDateQualifier));
  if (!born && !died) return "?";
  return `${born ?? "?"} –${died ? ` ${died}` : ""}`;
}

export function ref(p: PersonLike): Ref {
  if (p.restricted) return { id: p.id, name: "Nicht freigegeben", restricted: true };
  return { id: p.id, name: displayName(p), lifespan: lifespan(p) };
}

/**
 * Hängt eine datierte Recherchenotiz an vorhandene Notizen an, statt sie zu
 * ersetzen. Format: "[2026-11-16, KI-Recherche] Text (Quelle: …)".
 */
export function appendResearchNote(
  existing: string | null | undefined,
  note: string,
  options: { source?: string | null; now?: Date } = {},
): string {
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const source = options.source?.trim();
  const entry = `[${date}, KI-Recherche] ${note.trim()}${source ? ` (Quelle: ${source})` : ""}`;
  const before = existing?.trimEnd();
  return before ? `${before}\n\n${entry}` : entry;
}
