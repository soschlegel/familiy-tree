"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useDismiss } from "./useDismiss";

type Hit = { id: string; givenName: string; familyName: string | null; birthDate: string | null; deathDate: string | null };

const year = (iso: string | null) => (iso ? iso.slice(0, 4) : "");

/**
 * Ausgangsperson der Karte wählen: Suchfeld über die sichtbaren Personen
 * (/api/persons?q=), Auswahl führt zu /map?person=<id>. Ändert die
 * Bezugsperson des Baums nicht.
 */
export function MapPersonChooser({ mode }: { mode: "vorfahren" | "alle" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  useDismiss(open, () => setOpen(false), [boxRef, toggleRef], toggleRef);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/persons?q=${encodeURIComponent(needle)}&limit=8`, { signal: ctrl.signal });
        if (res.ok) setHits(await res.json());
      } catch {
        /* abgebrochen */
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div className="relative">
      <button
        ref={toggleRef}
        type="button"
        className="btn-secondary"
        aria-expanded={open}
        aria-controls={`${ids}-box`}
        onClick={() => setOpen((o) => !o)}
        data-testid="map-choose-person"
      >
        Andere Person …
      </button>
      {open && (
        <div
          ref={boxRef}
          id={`${ids}-box`}
          className="absolute left-0 top-full z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-surface p-2 shadow-lg dark:border-stone-700"
        >
          <label htmlFor={`${ids}-q`} className="sr-only">
            Person suchen
          </label>
          <input
            ref={inputRef}
            id={`${ids}-q`}
            className="field w-full"
            placeholder="Name eingeben…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          <ul className="mt-1 max-h-72 overflow-auto" aria-busy={busy}>
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-stone-900/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/map?person=${encodeURIComponent(h.id)}&mode=${mode}`);
                  }}
                >
                  <span className="font-medium">{[h.givenName, h.familyName].filter(Boolean).join(" ")}</span>
                  {(h.birthDate || h.deathDate) && (
                    <span className="muted">
                      {" "}
                      · {year(h.birthDate) || "?"} – {year(h.deathDate) || "?"}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {q.trim().length >= 2 && !busy && hits.length === 0 && <li className="px-2 py-2 text-sm muted">Niemand gefunden.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
