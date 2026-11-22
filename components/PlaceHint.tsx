"use client";

import { useEffect, useState } from "react";

import type { PlaceHintDto } from "@/lib/services/places";

/**
 * Dezenter Hinweis unter einem Ortsfeld: welcher Ort beim Tippen erkannt
 * wird („→ Wrocław (Breslau), Polen“, „mehrdeutig“, „nicht gefunden“).
 * Gleiche Regel wie die automatische Zuordnung (GET /api/places/suggest).
 * Der eingegebene Text wird nie verändert — der Hinweis ist nur Anzeige.
 */

const PRECISION_NOTE = { PLACE: "", REGION: " (nur Region)", COUNTRY: " (nur Land)" } as const;

// Das Ortsverzeichnis wird beim ersten Ortsfeld einer Seite vorab geladen.
let warmed = false;

export function PlaceHint({ text, id }: { text: string; id?: string }) {
  const [hint, setHint] = useState<PlaceHintDto | null>(null);
  const [forText, setForText] = useState("");
  const q = text.trim();

  useEffect(() => {
    if (warmed) return;
    warmed = true;
    fetch("/api/places/suggest").catch(() => {});
  }, []);

  useEffect(() => {
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return; // z.B. 403 ohne Bearbeitungsrecht: einfach kein Hinweis
        setHint((await res.json()) as PlaceHintDto);
        setForText(q);
      } catch {
        /* abgebrochen oder offline — kein Hinweis */
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  if (q.length < 2 || !hint || forText !== q) return null;

  return (
    <p id={id} className="mt-1 text-xs muted" aria-live="polite" data-testid="place-hint" data-status={hint.status}>
      {hint.status === "none" ? (
        <>Ort nicht gefunden</>
      ) : (
        <>
          <span aria-hidden>→ </span>
          <span className="sr-only">Erkannt: </span>
          <span className="text-stone-700 dark:text-stone-300">{hint.label}</span>
          {hint.precision && PRECISION_NOTE[hint.precision]}
          {hint.own && <> · eigener Ort</>}
          {hint.formerName && <> · früherer bzw. deutscher Name: {hint.formerName}</>}
          {hint.otherName && <> · anderer Name: {hint.otherName}</>}
          {hint.status === "ambiguous" && (
            <span className="badge-alt ml-1" title="Es gibt weitere Orte dieses Namens — ein Zusatz wie Kreis oder Land hilft.">
              mehrdeutig
            </span>
          )}
        </>
      )}
    </p>
  );
}
