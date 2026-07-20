"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatDate } from "@/lib/tree-layout";

export type PickerPerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthDate: string | null;
  deathDate: string | null;
};

function label(p: PickerPerson): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}

function dates(p: PickerPerson): string {
  const year = (d: string | null) => (d ? new Date(d).getFullYear() : null);
  const b = year(p.birthDate);
  const d = year(p.deathDate);
  if (b && d) return `* ${b} † ${d}`;
  if (b) return `* ${b}`;
  if (d) return `† ${d}`;
  return "ohne Datum";
}

function fullDate(p: PickerPerson): string {
  return formatDate(p.birthDate);
}

/**
 * Suchfeld statt Drop-Down: bei mehreren hundert Personen ist eine Liste
 * unbrauchbar, und gleichnamige Verwandte lassen sich nur über das
 * Geburtsdatum auseinanderhalten — deshalb steht es in jeder Zeile.
 *
 * Findet die Suche niemanden, kann die Person direkt hier angelegt werden,
 * ohne die Seite zu verlassen und die begonnene Zuordnung zu verlieren.
 */
export function PersonPicker({
  people,
  value,
  onChange,
  onCreated,
  placeholder = "Name eingeben…",
}: {
  people: PickerPerson[];
  value: string;
  onChange: (id: string) => void;
  onCreated?: (person: PickerPerson) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(person: PickerPerson) {
    onChange(person.id);
    setQuery("");
    setOpen(false);
  }

  async function createFromQuery() {
    // Erstes Wort als Vorname, Rest als Nachname — die häufigste Eingabe.
    const parts = query.trim().split(/\s+/);
    const givenName = parts[0];
    const familyName = parts.slice(1).join(" ") || null;

    setCreating(true);
    setError(null);

    const res = await fetch("/api/persons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ givenName, familyName }),
    });

    setCreating(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Anlegen fehlgeschlagen (${res.status})`);
      return;
    }

    const person: PickerPerson = await res.json();
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
    <div ref={boxRef} className="relative w-72">
      {selected ? (
        <div className="flex items-center gap-2 rounded border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900">
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
            className="ml-auto shrink-0 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            aria-label="Auswahl aufheben"
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
          className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      )}

      {open && !selected && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded border border-stone-300 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {matches.length === 0 && !canCreate && (
            <p className="px-3 py-2 text-sm text-stone-500">
              Keine Person gefunden.
            </p>
          )}

          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(p)}
              className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
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
              disabled={creating}
              onMouseEnter={() => setCursor(matches.length)}
              onClick={() => void createFromQuery()}
              className={`flex w-full items-center gap-2 border-t border-stone-200 px-3 py-2 text-left text-sm dark:border-stone-700 ${
                cursor === matches.length ? "bg-stone-100 dark:bg-stone-800" : ""
              }`}
            >
              <span className="text-stone-500">＋</span>
              <span>
                {creating ? "Wird angelegt…" : "Neu anlegen: "}
                {!creating && (
                  <strong className="font-medium">{query.trim()}</strong>
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
