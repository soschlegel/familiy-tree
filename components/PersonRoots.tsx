"use client";

import { useId, useRef, useState } from "react";

import type { AreaLevel } from "@/lib/places/area";
import { generationName, ROOTS_MAX_GENERATION, ROOTS_MIN_GENERATION, type RootsSlice } from "@/lib/roots";
import type { PersonRootsDto } from "@/lib/services/roots";
import { apiFetch } from "./api-client";
import { DonutChart, DonutLegend } from "./DonutChart";
import { HelpLink } from "./HelpLink";

/**
 * Abschnitt „Wurzeln“ der Personenseite: aus welchen Ländern bzw. Regionen
 * die Vorfahren stammen, als Ring mit Legende. Die Seite liefert den
 * Standard (Generation 4, nach Land) gleich mit; Generation und Stufe
 * lädt der Abschnitt über /api/persons/[id]/roots nach. Rechnung und
 * Regeln: lib/roots.ts, lib/services/roots.ts.
 */

const GENERATIONS = Array.from(
  { length: ROOTS_MAX_GENERATION - ROOTS_MIN_GENERATION + 1 },
  (_, i) => ROOTS_MIN_GENERATION + i,
);

const LEVELS: { value: AreaLevel; label: string }[] = [
  { value: "country", label: "nach Land" },
  { value: "region", label: "nach Region" },
];

/** „25 %“; ein Stück unter einem halben Prozent heißt „unter 1 %“. */
function percentText(s: Pick<RootsSlice, "percent" | "share">): string {
  return s.percent === 0 && s.share > 0 ? "unter 1 %" : `${s.percent} %`;
}

function membersText(members: string[] | undefined): string | undefined {
  if (!members?.length) return undefined;
  const shown = members.slice(0, 4).join(", ");
  return members.length > 4 ? `${shown} und ${members.length - 4} weitere` : shown;
}

export function PersonRoots({ personId, initial }: { personId: string; initial: PersonRootsDto }) {
  const [data, setData] = useState(initial);
  const [generations, setGenerations] = useState(initial.generations);
  const [level, setLevel] = useState<AreaLevel>(initial.level);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const selectId = useId();

  async function load(next: { generations: number; level: AreaLevel }) {
    setGenerations(next.generations);
    setLevel(next.level);
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ generations: String(next.generations), level: next.level });
    const res = await apiFetch<PersonRootsDto>(`/api/persons/${encodeURIComponent(personId)}/roots?${q}`);
    // Nur die letzte Anfrage zählt (schnelles Umschalten).
    if (ticket !== request.current) return;
    setLoading(false);
    if (!res.ok) return setError(res.message);
    setData(res.data);
  }

  const n = data.generations;
  const levelLabel = data.level === "region" ? "Region" : "Land";

  return (
    <section aria-labelledby="roots-h" className="card space-y-4 p-5" data-testid="person-roots">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="roots-h" className="section-title flex items-center gap-2">
            Wurzeln
            <HelpLink to="wurzeln" compact label="Wie werden die Wurzeln gerechnet?" />
          </h2>
          <p className="text-sm muted">Aus welchen Ländern die Vorfahren stammen — gerechnet aus dem Stammbaum.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={selectId} className="field-label">
              Bis Generation
            </label>
            <select
              id={selectId}
              className="field"
              value={generations}
              data-testid="roots-generations"
              onChange={(e) => void load({ generations: Number(e.target.value), level })}
            >
              {GENERATIONS.map((g) => (
                <option key={g} value={g}>
                  {g} – {generationName(g)} ({2 ** g})
                </option>
              ))}
            </select>
          </div>
          <div
            role="group"
            aria-label="Einteilung"
            className="inline-flex overflow-hidden rounded-lg border border-stone-300 text-sm dark:border-stone-700"
          >
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                aria-pressed={level === l.value}
                data-testid={`roots-level-${l.value}`}
                onClick={() => level !== l.value && void load({ generations, level: l.value })}
                className={`px-3 py-1.5 transition max-md:min-h-11 ${
                  level === l.value
                    ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                    : "bg-surface hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {loading ? "Wurzeln werden berechnet …" : ""}
      </p>

      <div
        aria-busy={loading}
        className={`flex flex-col items-center gap-5 sm:flex-row sm:items-start ${loading ? "opacity-60" : ""}`}
      >
        <DonutChart
          slices={data.slices.map((s) => ({ key: s.key, label: s.label, value: s.share, color: s.color, valueText: percentText(s) }))}
          label={`Wurzeln nach ${levelLabel}, bis zur ${n}. Generation`}
          size={180}
          center={{ value: `${n}.`, caption: "Generation" }}
          className="shrink-0"
          testId="roots-chart"
        />
        <div className="w-full min-w-0 flex-1 sm:max-w-lg">
          <DonutLegend
            caption={`Wurzeln nach ${levelLabel}`}
            testId="roots-legend"
            items={data.slices.map((s) => ({
              key: s.key,
              label: s.label,
              color: s.color,
              valueText: percentText(s),
              detail: membersText(s.members),
            }))}
          />
        </div>
      </div>

      <p className="text-xs muted" data-testid="roots-summary">
        Gerechnet aus den Geburtsorten der Vorfahren (fehlt er, aus dem Ort der Taufe) bis zur {n}. Generation (
        {generationName(n)}); {data.filledSlots} von {data.slots} Linien {data.filledSlots === 1 ? "reicht" : "reichen"} bis
        dorthin.
      </p>
    </section>
  );
}
