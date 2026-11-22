"use client";

import { useEffect, useState } from "react";

import type { PlaceHintDto } from "@/lib/services/places";
import { apiFetch, jsonBody } from "./api-client";

/**
 * Dezenter Hinweis unter einem Ortsfeld: welcher Ort beim Tippen erkannt
 * wird („→ Wrocław (Breslau), Polen“, „mehrdeutig“, „nicht gefunden“).
 * Gleiche Regel wie die automatische Zuordnung (GET /api/places/suggest).
 * Der eingegebene Text wird nie verändert — der Hinweis ist nur Anzeige.
 *
 * Mit `onChoose` lässt sich außerdem ein Ort aus den Kandidaten
 * (Verzeichnis und eigene Orte) **auswählen**; das Formular speichert die
 * Wahl nach dem Speichern des Eintrags mit `savePlaceChoices` als Zuordnung
 * genau dieses Freitexts („von Hand“).
 */

const PRECISION_NOTE = { PLACE: "", REGION: " (nur Region)", COUNTRY: " (nur Land)" } as const;

export type PlaceChoice = {
  /** Der Freitext, für den gewählt wurde (ändert sich der Text, gilt die Wahl nicht mehr). */
  forText: string;
  label: string;
  gazetteerId: string | null;
  latitude: number;
  longitude: number;
  precision: "PLACE" | "REGION" | "COUNTRY" | null;
};

type Candidate = Omit<PlaceChoice, "forText"> & { kind: string; population: number | null; own: boolean; recommended: boolean };

// Das Ortsverzeichnis wird beim ersten Ortsfeld einer Seite vorab geladen.
let warmed = false;

export function PlaceHint({
  text,
  id,
  chosen,
  onChoose,
}: {
  text: string;
  id?: string;
  chosen?: PlaceChoice | null;
  onChoose?: (choice: PlaceChoice | null) => void;
}) {
  const [hint, setHint] = useState<PlaceHintDto | null>(null);
  const [forText, setForText] = useState("");
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const q = text.trim();

  useEffect(() => {
    if (warmed) return;
    warmed = true;
    fetch("/api/places/suggest").catch(() => {});
  }, []);

  // Text geändert: eine Auswahl für den alten Text gilt nicht mehr.
  useEffect(() => {
    if (chosen && chosen.forText !== q) onChoose?.(null);
    setOpen(false);
    setCandidates(null);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (candidates) return;
    try {
      const res = await fetch(`/api/places/suggest?q=${encodeURIComponent(q)}&candidates=1`);
      setCandidates(res.ok ? (((await res.json()) as { candidates?: Candidate[] }).candidates ?? []) : []);
    } catch {
      setCandidates([]);
    }
  };

  if (q.length < 2 || !hint || forText !== q) return null;

  return (
    <div id={id} className="mt-1 text-xs muted" aria-live="polite" data-testid="place-hint" data-status={chosen ? "chosen" : hint.status}>
      {chosen ? (
        <>
          <span aria-hidden>→ </span>
          <span className="text-stone-700 dark:text-stone-300">{chosen.label}</span> · ausgewählt
          <button type="button" className="btn-link ml-2 text-xs" onClick={() => onChoose?.(null)}>
            Auswahl aufheben
          </button>
        </>
      ) : hint.status === "none" ? (
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
      {onChoose && !chosen && (
        <button type="button" className="btn-link ml-2 text-xs" aria-expanded={open} onClick={() => void toggle()} data-testid="place-choose">
          {open ? "schließen" : "Ort wählen …"}
        </button>
      )}
      {open && !chosen && (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto rounded-lg border border-stone-200 p-1 dark:border-stone-700" data-testid="place-candidates">
          {candidates === null && <li className="px-2 py-1">Suche …</li>}
          {candidates?.length === 0 && <li className="px-2 py-1">Keine Kandidaten — der Text wird ohne Ort gespeichert.</li>}
          {candidates?.map((c) => (
            <li key={c.gazetteerId ?? `${c.latitude},${c.longitude}`}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-stone-800 hover:bg-stone-900/5 max-md:py-2 dark:text-stone-200 dark:hover:bg-white/10"
                onClick={() => {
                  onChoose?.({
                    forText: q,
                    label: c.label,
                    gazetteerId: c.gazetteerId,
                    latitude: c.latitude,
                    longitude: c.longitude,
                    precision: c.precision,
                  });
                  setOpen(false);
                }}
              >
                {c.label}
                <span className="muted">
                  {" "}
                  · {c.kind}
                  {c.population ? <> · {c.population.toLocaleString("de-DE")} Einw.</> : null}
                  {c.recommended && " · Vorschlag"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Speichert die Auswahl je Ortsfeld nach dem Speichern des Eintrags
 * (POST /api/places/choose). Liefert Fehlermeldungen (z.B. „bereits von
 * Hand zugeordnet“) — der Eintrag selbst ist dann schon gespeichert.
 */
export async function savePlaceChoices(
  target: { personId: string } | { eventId: string } | { relationshipId: string },
  choices: (PlaceChoice | null | undefined)[],
): Promise<string[]> {
  const errors: string[] = [];
  for (const c of choices) {
    if (!c) continue;
    const body = c.gazetteerId
      ? { text: c.forText, ...target, gazetteerId: c.gazetteerId }
      : { text: c.forText, ...target, latitude: c.latitude, longitude: c.longitude, label: c.label, precision: c.precision ?? "PLACE" };
    const res = await apiFetch("/api/places/choose", jsonBody("POST", body));
    if (!res.ok) errors.push(`Ort „${c.forText}“: ${res.message}`);
  }
  return errors;
}
