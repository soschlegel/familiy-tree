"use client";

import { useId } from "react";

import { DATE_INPUT_EXAMPLES, formatFuzzyDate, parseFuzzyDate } from "@/lib/dates";

/**
 * Textfeld für (auch ungenaue) Daten statt des nativen Datumsfelds: „1850“,
 * „03.1850“, „12.03.1850“, „um 1850“, „vor 1900“, „nach 1723“, „geschätzt
 * 1850“, Bereiche „zwischen 1850 und 1855“, „1850–1855“, „von 1901 bis
 * 1910“, „ab 1901“, „bis 1910“. Unter dem Feld steht beim Tippen, wie die
 * Eingabe verstanden wird, oder der Fehler. Der Server prüft dieselbe Eingabe
 * noch einmal (lib/validation.ts) und bleibt maßgeblich; `error` zeigt seine
 * Meldung.
 *
 * Wortlaut (`…Phrase`): Mit `allowPhrase` lässt sich ein Text, der sich nicht
 * als Datum lesen lässt („Palmsonntag, Jahr unbekannt“), bewusst als Wortlaut
 * speichern — per Häkchen, damit ein Tippfehler nicht unbemerkt zum Wortlaut
 * wird. Ein importierter Wortlaut ohne Datum steht so im Feld und bleibt
 * bearbeitbar. `phrase` zeigt einen Wortlaut, der NEBEN einem Datum
 * gespeichert ist; er bleibt erhalten, solange das Datum gleich bleibt.
 * Was an die API geht, baut datePayload().
 */
export function DateInput({
  id,
  label,
  value,
  onChange,
  error,
  className = "",
  compact = false,
  allowPhrase = false,
  asPhrase = false,
  onAsPhraseChange,
  phrase,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Meldung vom Server oder aus der Formularprüfung. */
  error?: string;
  className?: string;
  /** In engen Zeilen: ohne Beispieltext, solange das Feld leer ist. */
  compact?: boolean;
  /** Unlesbaren Text auf Wunsch als Wortlaut speichern. */
  allowPhrase?: boolean;
  asPhrase?: boolean;
  onAsPhraseChange?: (value: boolean) => void;
  /** Gespeicherter Wortlaut neben einem Datum (nur Anzeige). */
  phrase?: string | null;
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const parsed = parseFuzzyDate(value);
  const unreadable = !parsed.ok && value.trim() !== "";
  const keptAsPhrase = allowPhrase && unreadable && asPhrase;
  const localError = !parsed.ok && !keptAsPhrase ? parsed.error : undefined;
  const shownError = error || localError;
  const hint = keptAsPhrase
    ? "Wird als Wortlaut gespeichert — ohne Einordnung in Zeitleiste und Prüfungen."
    : parsed.ok && parsed.value
      ? `Verstanden als: ${formatFuzzyDate(parsed.value)}`
      : !value.trim()
        ? compact
          ? null
          : DATE_INPUT_EXAMPLES
        : null;
  const storedPhrase = phrase?.trim() && parsed.ok && parsed.value ? phrase.trim() : null;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={compact ? "z.B. um 1850" : "TT.MM.JJJJ, JJJJ, um JJJJ …"}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={shownError || hint ? `${inputId}-hint` : undefined}
        className={`field w-full ${shownError ? "field-invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {(shownError || hint) && (
        <span
          id={`${inputId}-hint`}
          data-testid="date-hint"
          aria-live="polite"
          className={shownError ? "field-error" : "mt-1 block text-xs muted"}
        >
          {shownError ?? hint}
        </span>
      )}
      {allowPhrase && unreadable && (
        <label className="mt-1 flex items-center gap-1.5 text-xs text-stone-700 dark:text-stone-300">
          <input
            type="checkbox"
            checked={asPhrase}
            onChange={(e) => onAsPhraseChange?.(e.target.checked)}
            data-testid="date-as-phrase"
          />
          Als Wortlaut speichern
        </label>
      )}
      {storedPhrase && (
        <span className="mt-1 block text-xs muted" data-testid="date-phrase">
          Wortlaut der Quelle: „{storedPhrase}“ — bleibt erhalten, solange das Datum gleich bleibt.
        </span>
      )}
    </div>
  );
}

export { dateInputError, dateFieldFrom, datePayload } from "@/lib/date-fields";
