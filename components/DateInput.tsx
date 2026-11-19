"use client";

import { useId } from "react";

import { DATE_INPUT_EXAMPLES, formatFuzzyDate, parseFuzzyDate } from "@/lib/dates";

/**
 * Textfeld für (auch ungenaue) Daten statt des nativen Datumsfelds: „1850“,
 * „03.1850“, „12.03.1850“, „um 1850“, „vor 1900“, „nach 1723“. Unter dem Feld
 * steht beim Tippen, wie die Eingabe verstanden wird, oder der Fehler. Der
 * Server prüft dieselbe Eingabe noch einmal (lib/validation.ts) und bleibt
 * maßgeblich; `error` zeigt seine Meldung.
 */
export function DateInput({
  id,
  label,
  value,
  onChange,
  error,
  className = "",
  compact = false,
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
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const parsed = parseFuzzyDate(value);
  const localError = !parsed.ok ? parsed.error : undefined;
  const shownError = error || localError;
  const hint =
    parsed.ok && parsed.value
      ? `Verstanden als: ${formatFuzzyDate(parsed.value)}`
      : !value.trim()
        ? compact
          ? null
          : DATE_INPUT_EXAMPLES
        : null;

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
    </div>
  );
}

/** Lässt sich der Wert speichern? (leer ist erlaubt) */
export function dateInputError(value: string): string | null {
  const r = parseFuzzyDate(value);
  return r.ok ? null : r.error;
}
