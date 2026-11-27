"use client";

import { useCallback, useState } from "react";

import { historyCookie } from "@/lib/history/events";

/**
 * Schalter „Zeitgeschichte“ (Zeitstrahl im Baum, Zeitreise der Karte,
 * Lebenslauf): ein gemeinsamer Zustand je Browser im Cookie
 * `zeitgeschichte` — der Server liest ihn beim nächsten Laden und zeichnet
 * gleich richtig. Standard: an.
 */
export function useHistoryToggle(initial: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(initial);
  const change = useCallback((next: boolean) => {
    setOn(next);
    try {
      document.cookie = historyCookie(next);
    } catch {
      // ohne Cookie gilt der Schalter nur bis zum Neuladen
    }
  }, []);
  return [on, change];
}

/** Kontrollkästchen „Zeitgeschichte“ — Tippfläche auf dem Telefon mindestens 44 px hoch. */
export function HistoryToggle({
  on,
  onChange,
  className = "",
  testId,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
  testId: string;
}) {
  return (
    <label
      title="Allgemeine Ereignisse der Zeit (Kriege, Seuchen, Auswanderung …) als Hintergrund zeigen"
      className={`flex cursor-pointer items-center gap-2 max-md:min-h-11 ${className}`}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="accent-amber-700 dark:accent-amber-400"
      />
      Zeitgeschichte
    </label>
  );
}
