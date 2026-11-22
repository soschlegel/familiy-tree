"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useDismiss } from "./useDismiss";

import { formatDateOf, lifeSpan } from "@/lib/tree-layout";
import { apiFetch, jsonBody } from "./api-client";

export type PickerPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthDate: string | null;
  deathDate: string | null;
  birthDatePrecision?: string;
  birthDateQualifier?: string;
  deathDatePrecision?: string;
  deathDateQualifier?: string;
  birthDateTo?: string | null;
  birthDateToPrecision?: string;
  deathDateTo?: string | null;
  deathDateToPrecision?: string;
};

function label(p: PickerPerson): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}

function dates(p: PickerPerson): string {
  const span = lifeSpan(p);
  if (!span) return "ohne Datum";
  // „1850 – 1912“ -> „* 1850 † 1912“ (Format der Auswahlliste)
  return p.birthDate && p.deathDate ? `* ${span.replace(" – ", " † ")}` : span;
}

function fullDate(p: PickerPerson): string {
  return formatDateOf(p, "birthDate");
}

/**
 * Suchfeld statt Drop-Down: bei mehreren hundert Personen ist eine Liste
 * unbrauchbar, und gleichnamige Verwandte lassen sich nur über das
 * Geburtsdatum auseinanderhalten — deshalb steht es in jeder Zeile.
 *
 * Findet die Suche niemanden, kann die Person direkt hier angelegt werden,
 * ohne die Seite zu verlassen und die begonnene Zuordnung zu verlieren. Die
 * neue Person kommt in `createFamilyIds` (z.B. die Familien der
 * Ausgangsperson); ohne Angabe entscheidet der Server (Bearbeiter: erste
 * bearbeitbare Familie, Administratoren: keine Familie). `createNote` nennt
 * das im Anlege-Eintrag, damit niemand überrascht wird.
 */
export function PersonPicker({
  people,
  value,
  onChange,
  onCreated,
  placeholder = "Name eingeben…",
  labelledBy,
  createFamilyIds,
  createNote,
}: {
  people: PickerPerson[];
  value: string;
  onChange: (id: string) => void;
  onCreated?: (person: PickerPerson) => void;
  placeholder?: string;
  /** id des sichtbaren Feldnamens (für Screenreader). */
  labelledBy?: string;
  /** Familien für eine hier neu angelegte Person. */
  createFamilyIds?: string[];
  /** Kurzer Hinweis im Anlege-Eintrag, z.B. „in Familie Becker“. */
  createNote?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = people.find((p) => p.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people.slice(0, 8);
    return people
      .filter((p) => {
        const haystack = `${label(p)} ${fullDate(p)}`.toLowerCase();
        return needle
          .split(/\s+/)
          .every((token) => haystack.includes(token));
      })
      .slice(0, 8);
  }, [people, query]);

  // Der Anlege-Eintrag erscheint nur, wenn wirklich etwas gesucht wurde.
  const canCreate = Boolean(onCreated) && query.trim().length >= 2;
  const rowCount = matches.length + (canCreate ? 1 : 0);

  useEffect(() => setCursor(0), [query]);

  // Vorschläge schließen bei Klick daneben, Escape und Tab aus dem Feld.
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [boxRef]);

  function pick(person: PickerPerson) {
    onChange(person.id);
    setQuery("");
    setOpen(false);
  }

  async function createFromQuery() {
    if (creating) return;
    // Erstes Wort als Vorname, Rest als Nachname — die häufigste Eingabe.
    const parts = query.trim().split(/\s+/);
    const givenName = parts[0];
    const familyName = parts.slice(1).join(" ") || null;

    setCreating(true);
    setError(null);

    const res = await apiFetch<PickerPerson>("/api/persons", jsonBody("POST", {
        givenName,
        familyName,
        ...(createFamilyIds && createFamilyIds.length > 0 ? { familyIds: createFamilyIds } : {}),
      }));

    setCreating(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    const person = res.data;
    onCreated?.(person);
    pick(person);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (cursor < matches.length) pick(matches[cursor]);
      else if (canCreate) void createFromQuery();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full sm:w-72">
      {selected ? (
        <div className="field flex items-center gap-2" aria-labelledby={labelledBy} role="group">
          <span className="truncate font-medium">{label(selected)}</span>
          <span className="shrink-0 text-xs text-stone-500">
            {dates(selected)}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className="btn-link ml-auto shrink-0"
            aria-label={`Auswahl ${label(selected)} aufheben`}
          >
            ändern
          </button>
        </div>
      ) : (
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-labelledby={labelledBy}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="field w-full"
        />
      )}

      {open && !selected && (
        <div id={listId} className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-stone-300 bg-surface shadow-lift dark:border-stone-700">
          {matches.length === 0 && !canCreate && (
            <p className="px-3 py-2 text-sm text-stone-500">
              Keine Person gefunden.
            </p>
          )}

          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(p)}
              className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm max-md:py-3 ${
                i === cursor ? "bg-stone-100 dark:bg-stone-800" : ""
              }`}
            >
              <span className="truncate font-medium">{label(p)}</span>
              <span className="ml-auto shrink-0 text-xs text-stone-500">
                {fullDate(p) || dates(p)}
              </span>
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              tabIndex={-1}
              disabled={creating}
              onMouseEnter={() => setCursor(matches.length)}
              onClick={() => void createFromQuery()}
              className={`flex w-full items-center gap-2 border-t border-stone-200 px-3 py-2 text-left text-sm max-md:py-3 dark:border-stone-700 ${
                cursor === matches.length ? "bg-stone-100 dark:bg-stone-800" : ""
              }`}
            >
              <span className="text-stone-500">＋</span>
              <span>
                {creating ? "Wird angelegt…" : "Neu anlegen: "}
                {!creating && (
                  <strong className="font-medium">{query.trim()}</strong>
                )}
                {!creating && createNote && (
                  <span className="block text-xs text-stone-500" data-testid="picker-create-note">
                    {createNote}
                  </span>
                )}
              </span>
            </button>
          )}

          {error && (
            <p className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
