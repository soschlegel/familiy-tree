/**
 * Formular-Hilfen für Datumsfelder mit Wortlaut (siehe components/DateInput).
 * Bewusst außerhalb der Client-Komponente, damit auch Server-Komponenten
 * (Bearbeitungsseiten) den Anfangszustand bauen können.
 */
import { parseFuzzyDate } from "./dates";

/** Lässt sich der Wert speichern? (leer ist erlaubt; mit Wortlaut-Häkchen auch Unlesbares) */
export function dateInputError(value: string, asPhrase = false): string | null {
  const r = parseFuzzyDate(value);
  if (r.ok) return null;
  return asPhrase && value.trim() ? null : r.error;
}

/**
 * Anfangszustand eines Datumsfelds aus gespeicherten Werten: Eingabetext des
 * Datums, sonst der Wortlaut (dann gleich als Wortlaut markiert).
 */
export function dateFieldFrom(dateText: string, phrase: string | null | undefined): { text: string; asPhrase: boolean } {
  if (dateText) return { text: dateText, asPhrase: false };
  const p = phrase?.trim() ?? "";
  return { text: p, asPhrase: p !== "" };
}

/**
 * Felder für die API: leer → Datum und Wortlaut löschen; lesbar → nur das
 * Datum (der Server behält einen vorhandenen Wortlaut, solange das Datum
 * gleich bleibt); unlesbar und als Wortlaut markiert → kein Datum, nur der
 * Wortlaut.
 */
export function datePayload(key: string, text: string, asPhrase = false): Record<string, string | null> {
  const t = text.trim();
  if (!t) return { [key]: null, [`${key}Phrase`]: null };
  const r = parseFuzzyDate(t);
  if (r.ok) return { [key]: t };
  if (asPhrase) return { [key]: null, [`${key}Phrase`]: t };
  return { [key]: t };
}
