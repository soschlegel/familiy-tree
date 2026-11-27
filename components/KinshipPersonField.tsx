"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { kinshipHref } from "./kinship-url";

type Hit = { id: string; givenName: string; familyName: string | null; birthDate: string | null; deathDate: string | null };

const year = (iso: string | null) => (iso ? iso.slice(0, 4) : "");
const hitName = (h: Hit) => [h.givenName, h.familyName].filter(Boolean).join(" ");

/**
 * Auswahlfeld einer Person auf „Wie sind wir verwandt?“. Gewählt: Name mit
 * Lebensjahren und „ändern“; sonst ein Suchfeld über die sichtbaren
 * Personen (/api/persons?q=, ab zwei Zeichen, höchstens 8 Treffer).
 * Die Auswahl landet als Suchparameter in der Adresse (`a` bzw. `b`), die
 * andere Person bleibt erhalten — die Seite rechnet dann neu.
 */
export function KinshipPersonField({
  slot,
  label,
  selected,
  notFound,
  otherId,
  self,
}: {
  slot: "a" | "b";
  label: string;
  selected: { id: string; name: string; lifespan: string } | null;
  notFound: boolean;
  /** Die andere gewählte Person (bleibt in der Adresse). */
  otherId: string | null;
  /** Eigene Person für „mich wählen“. */
  self: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const searching = !selected || editing;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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

  const choose = (id: string) => {
    setEditing(false);
    setQ("");
    setHits([]);
    router.push(slot === "a" ? kinshipHref(id, otherId) : kinshipHref(otherId, id));
  };

  return (
    <div className="min-w-0 flex-1 basis-60" data-testid={`kinship-field-${slot}`}>
      <p id={`${ids}-label`} className="field-label">
        {label}
      </p>
      {!searching && selected && (
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-surface px-3 py-1.5 dark:border-stone-700">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" data-testid={`kinship-selected-${slot}`}>
              {selected.name}
            </span>
            {selected.lifespan && <span className="block text-xs muted">{selected.lifespan}</span>}
          </span>
          <button
            type="button"
            className="btn-link"
            onClick={() => setEditing(true)}
            aria-label={`${label} ändern (gewählt: ${selected.name})`}
          >
            ändern
          </button>
        </div>
      )}
      {searching && (
        <div>
          <label htmlFor={`${ids}-q`} className="sr-only">
            {label}: Name suchen
          </label>
          <input
            ref={inputRef}
            id={`${ids}-q`}
            className="field w-full"
            placeholder="Name eingeben…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && selected) {
                setEditing(false);
                setQ("");
              }
            }}
            autoComplete="off"
            aria-describedby={notFound ? `${ids}-nf` : undefined}
            data-testid={`kinship-search-${slot}`}
          />
          {notFound && !editing && (
            <p id={`${ids}-nf`} className="alert-warning mt-2" data-testid={`kinship-notfound-${slot}`}>
              Diese Person wurde nicht gefunden. Bitte wähle eine andere.
            </p>
          )}
          {(hits.length > 0 || q.trim().length >= 2) && (
            <ul
              className="mt-1 max-h-72 overflow-auto rounded-xl border border-stone-200 bg-surface p-1 shadow-lg dark:border-stone-700"
              aria-busy={busy}
              aria-label={`Treffer für ${label}`}
            >
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-stone-900/5 max-md:min-h-11 dark:hover:bg-white/10"
                    onClick={() => choose(h.id)}
                  >
                    <span className="font-medium">{hitName(h)}</span>
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
          )}
          <div className="mt-1 flex flex-wrap gap-x-3">
            {self && self.id !== selected?.id && self.id !== otherId && (
              <button type="button" className="btn-link" onClick={() => choose(self.id)} data-testid={`kinship-self-${slot}`}>
                mich wählen ({self.name})
              </button>
            )}
            {editing && selected && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEditing(false);
                  setQ("");
                }}
              >
                abbrechen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
