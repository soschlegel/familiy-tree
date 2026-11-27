"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  countSelection,
  personSelectionParams,
  selectionQuery,
  type ExportFamilyOverview,
  type ExportPersonCard,
} from "@/lib/export-selection";
import { HelpLink } from "./HelpLink";
import { DEFAULT_LINEAGE_OPTIONS, MAX_GENERATIONS, type LineageCounts, type LineageOptions } from "@/lib/export-lineage";

type Format = "gedcom" | "gedzip";
type Mode = "families" | "person";

const TITLE: Record<Format, string> = {
  gedcom: "GEDCOM exportieren",
  gedzip: "GEDCOM mit Bildern exportieren",
};

const persons = (n: number) => (n === 1 ? "1 Person" : `${n.toLocaleString("de-DE")} Personen`);

/** Aufschlüsselung der Zahl „Ab einer Person“ (nur Gruppen mit Personen). */
function breakdown(c: LineageCounts): string {
  const parts: string[] = [];
  if (c.ancestors) parts.push(`${c.ancestors.toLocaleString("de-DE")} ${c.ancestors === 1 ? "Vorfahr" : "Vorfahren"}`);
  if (c.descendants) parts.push(`${c.descendants.toLocaleString("de-DE")} ${c.descendants === 1 ? "Nachkomme" : "Nachkommen"}`);
  if (c.siblings) parts.push(`${c.siblings.toLocaleString("de-DE")} Geschwister`);
  if (c.partners) parts.push(`${c.partners.toLocaleString("de-DE")} Partner`);
  if (c.siblingFamilies) parts.push(`${c.siblingFamilies.toLocaleString("de-DE")} aus den Familien der Geschwister`);
  return parts.length ? `die Person, ${parts.join(", ")}` : "nur die Person selbst";
}

/** Kästchen „Ab einer Person“: Schlüssel, Beschriftung, erklärender Halbsatz. */
const OPTION_BOXES: { key: keyof Omit<LineageOptions, "generations">; label: string; hint: string }[] = [
  { key: "partners", label: "Partner", hint: "Ehe- und Lebenspartner der Person und der Vorfahren, auch frühere, samt Hochzeit" },
  { key: "siblings", label: "Geschwister", hint: "der Person und aller Vorfahren, auch Halbgeschwister — also auch Onkel und Tanten" },
  {
    key: "siblingFamilies",
    label: "Partner und Kinder der Geschwister",
    hint: "Schwager und Schwägerin, Neffen und Nichten, Cousins und Cousinen — nur mit „Geschwister“",
  },
  { key: "descendants", label: "Nachkommen der Person", hint: "Kinder, Enkel und alle weiteren; mit „Partner“ auch deren Partner" },
  { key: "allParents", label: "Auch Adoptiv-, Stief- und Pflegeeltern", hint: "sonst nur leibliche Eltern und deren Vorfahren" },
];

type CountState = { state: "idle" | "loading" } | { state: "ok"; counts: LineageCounts } | { state: "error"; message: string };

/**
 * Knöpfe „GEDCOM“ und „GEDCOM mit Bildern (ZIP)“ mit Dialog zur Auswahl (Ziel
 * z.B. MyHeritage). Zwei Arten, oben umschaltbar:
 * - „Nach Familien“ (Standard): Familien ankreuzen. Alles angekreuzt — dann
 *   geht die Anfrage ohne Auswahl hinaus und der Export ist derselbe wie bisher.
 * - „Ab einer Person“: Person suchen (vorbelegt mit „Das bin ich“ bzw. der
 *   Person, von deren Seite man kommt), dazu Kästchen für Partner,
 *   Geschwister usw. (Regeln: lib/export-lineage.ts). Die Zahl rechnet der
 *   Server (GET /api/export/count), entprellt bei jeder Änderung.
 * Echtes `<dialog>` (showModal): Fokus bleibt im Dialog, Escape schließt,
 * danach kehrt der Fokus zum Knopf zurück. Was exportiert werden darf,
 * entscheidet der Server (lib/services/export-selection.ts); die Liste hier
 * enthält ohnehin nur die Familien des Benutzers.
 */
export function GedcomExportDialog({
  overview,
  self = null,
  initialPerson = null,
}: {
  overview: ExportFamilyOverview;
  /** Eigene Person („Das bin ich“), wenn gesetzt und sichtbar. */
  self?: ExportPersonCard | null;
  /** Einstieg von der Personenseite: Dialog gleich „Ab einer Person“ öffnen. */
  initialPerson?: ExportPersonCard | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const hintId = useId();
  const modeName = useId();
  const [format, setFormat] = useState<Format>("gedcom");
  const [mode, setMode] = useState<Mode>(initialPerson ? "person" : "families");
  const allIds = useMemo(() => overview.families.map((f) => f.id), [overview.families]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(allIds));
  const canWithout = overview.withoutFamily !== null;
  const [withoutFamily, setWithoutFamily] = useState(canWithout);

  const [person, setPerson] = useState<ExportPersonCard | null>(initialPerson ?? self);
  const [options, setOptions] = useState<LineageOptions>(DEFAULT_LINEAGE_OPTIONS);
  const [generationsText, setGenerationsText] = useState("");
  const [count, setCount] = useState<CountState>({ state: "idle" });
  const [isOpen, setIsOpen] = useState(false);

  const perFamily = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of overview.groups) for (const id of g.familyIds) m.set(id, (m.get(id) ?? 0) + g.persons);
    return m;
  }, [overview.groups]);

  const everything = chosen.size === allIds.length && (!canWithout || withoutFamily);
  const nothing = chosen.size === 0 && !(canWithout && withoutFamily);
  const familyCount = countSelection(overview, chosen, canWithout && withoutFamily);

  const generationsValid = generationsText.trim() === "" || /^[1-9]\d*$/.test(generationsText.trim());
  const effectiveOptions: LineageOptions = {
    ...options,
    siblingFamilies: options.siblings && options.siblingFamilies,
    generations: generationsValid && generationsText.trim() !== "" ? Math.min(Number(generationsText.trim()), MAX_GENERATIONS + 1) : null,
  };
  const personQuery = person ? personSelectionParams(person.id, effectiveOptions) : "";

  // Zahl vom Server, entprellt; nur bei offenem Dialog „Ab einer Person“.
  useEffect(() => {
    if (!isOpen || mode !== "person" || !person || !generationsValid) {
      setCount({ state: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setCount({ state: "loading" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/export/count?${personQuery}`, { signal: ctrl.signal });
        if (res.ok) setCount({ state: "ok", counts: (await res.json()) as LineageCounts });
        else
          setCount({
            state: "error",
            message: res.status === 404 ? "Diese Person ist nicht verfügbar. Bitte wähle eine andere." : "Die Zahl ließ sich nicht berechnen.",
          });
      } catch {
        /* abgebrochen */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [isOpen, mode, person, personQuery, generationsValid]);

  const familyHref = `/api/export?format=${format}${
    everything ? "" : selectionQuery({ familyIds: allIds.filter((id) => chosen.has(id)), withoutFamily: canWithout && withoutFamily })
  }`;
  const personHref = `/api/export?format=${format}&${personQuery}`;
  const canDownload = mode === "families" ? !nothing : Boolean(person) && generationsValid && count.state !== "error";

  function open(f: Format, opener: HTMLButtonElement | null) {
    setFormat(f);
    openerRef.current = opener;
    dialogRef.current?.showModal();
    setIsOpen(true);
  }
  function close() {
    dialogRef.current?.close();
  }

  // Einstieg von der Personenseite (/admin/data?gedcomPerson=…): gleich öffnen.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (initialPerson && !autoOpened.current) {
      autoOpened.current = true;
      dialogRef.current?.showModal();
      setIsOpen(true);
    }
  }, [initialPerson]);

  const toggle = (id: string, on: boolean) =>
    setChosen((old) => {
      const next = new Set(old);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  let status: ReactNode;
  if (mode === "families") {
    status = (
      <>
        {nothing ? "Nichts ausgewählt." : `${persons(familyCount)} im Export.`}
        {everything && !nothing && <span className="muted"> Alles ausgewählt: derselbe Export wie bisher, auch mit noch unbelegten Quellen.</span>}
      </>
    );
  } else if (!person) status = "Noch keine Person gewählt.";
  else if (!generationsValid) status = "Generationen: bitte eine ganze Zahl ab 1 eingeben oder leer lassen.";
  else if (count.state === "ok")
    status = (
      <>
        {`${persons(count.counts.total)} im Export`}
        <span className="muted">: {breakdown(count.counts)}.</span>
      </>
    );
  else if (count.state === "error") status = count.message;
  else status = "Zähle …";

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={(e) => open("gedcom", e.currentTarget)}>
          GEDCOM
        </button>
        <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={(e) => open("gedzip", e.currentTarget)}>
          GEDCOM mit Bildern (ZIP)
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onClose={() => {
          setIsOpen(false);
          openerRef.current?.focus();
        }}
        // Klick auf den abgedunkelten Hintergrund schließt (das Ziel ist dann das <dialog> selbst).
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-xl border border-stone-200 bg-surface p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/50 dark:border-stone-700 dark:text-stone-100"
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="border-b border-stone-200 px-5 pb-3 pt-4 dark:border-stone-800">
            <h2 id={titleId} className="section-title">
              {TITLE[format]}
            </h2>
            <fieldset className="mt-3">
              <legend className="sr-only">Art der Auswahl</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-stone-300 p-1 dark:border-stone-700" data-testid="export-mode">
                {(
                  [
                    ["families", "Nach Familien"],
                    ["person", "Ab einer Person"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-center text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 ${
                      mode === value
                        ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                        : "text-stone-700 hover:bg-stone-900/5 dark:text-stone-200 dark:hover:bg-white/10"
                    }`}
                  >
                    <input
                      type="radio"
                      name={modeName}
                      value={value}
                      checked={mode === value}
                      onChange={() => setMode(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <p id={hintId} className="mt-2 text-sm muted">
              {mode === "families"
                ? "Familien für den Export ankreuzen. Eine Person mit mehreren Familien ist dabei, sobald eine davon angekreuzt ist;"
                : "Eine Person und ihre Vorfahren — Eltern, Großeltern und weiter zurück. Mit den Kästchen kommen weitere Verwandte dazu;"}{" "}
              Beziehungen, Quellen und {format === "gedzip" ? "Bilder" : "Belege"} nur, soweit sie zu exportierten Personen gehören.
            </p>
            {mode === "person" && <HelpLink to="gedcomAbPerson" className="mt-1 text-sm max-md:min-h-11" />}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {mode === "person" ? (
              <div className="space-y-4">
                <ExportPersonField person={person} self={self} onChange={setPerson} />
                <fieldset>
                  <legend className="field-label">Außerdem mitnehmen</legend>
                  <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                    {OPTION_BOXES.map((o) => {
                      const disabled = o.key === "siblingFamilies" && !options.siblings;
                      const checked = o.key === "siblingFamilies" ? options.siblings && options.siblingFamilies : options[o.key];
                      return (
                        <li key={o.key}>
                          <label className={`flex min-h-11 items-start gap-3 py-2 text-sm ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              className="mt-0.5 h-5 w-5 shrink-0"
                              checked={checked}
                              disabled={disabled}
                              // Name nur die Beschriftung, der Halbsatz als Beschreibung.
                              aria-label={o.label}
                              aria-describedby={`${hintId}-${o.key}`}
                              onChange={(e) => setOptions((old) => ({ ...old, [o.key]: e.target.checked }))}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">{o.label}</span>
                              <span id={`${hintId}-${o.key}`} className="block text-xs muted">
                                {o.hint}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                <div>
                  <label htmlFor={`${hintId}-gen`} className="field-label">
                    Generationen hinauf
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      id={`${hintId}-gen`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className="field w-24"
                      value={generationsText}
                      onChange={(e) => setGenerationsText(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                      aria-describedby={`${hintId}-gen-hint`}
                    />
                    <span id={`${hintId}-gen-hint`} className="text-xs muted">
                      leer = alle; 1 = nur Eltern, 2 = bis zu den Großeltern
                    </span>
                  </div>
                </div>
              </div>
            ) : allIds.length === 0 && !canWithout ? (
              <p className="text-sm muted">Ihnen sind keine Familien freigegeben — es gibt nichts zu exportieren.</p>
            ) : (
              <fieldset>
                <legend className="field-label">Familien</legend>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary min-h-11"
                    onClick={() => {
                      setChosen(new Set(allIds));
                      setWithoutFamily(canWithout);
                    }}
                  >
                    Alle auswählen
                  </button>
                  <button
                    type="button"
                    className="btn-secondary min-h-11"
                    onClick={() => {
                      setChosen(new Set());
                      setWithoutFamily(false);
                    }}
                  >
                    Keine auswählen
                  </button>
                </div>
                <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                  {overview.families.map((f) => (
                    <li key={f.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1 text-sm">
                        <input type="checkbox" className="h-5 w-5 shrink-0" checked={chosen.has(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
                        <span className="min-w-0 flex-1 break-words">{f.name}</span>
                        <span className="shrink-0 text-xs muted" aria-hidden="true">
                          {perFamily.get(f.id) ?? 0}
                        </span>
                      </label>
                    </li>
                  ))}
                  {canWithout && (
                    <li>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1 text-sm">
                        <input type="checkbox" className="h-5 w-5 shrink-0" checked={withoutFamily} onChange={(e) => setWithoutFamily(e.target.checked)} />
                        <span className="min-w-0 flex-1">Personen ohne Familie</span>
                        <span className="shrink-0 text-xs muted" aria-hidden="true">
                          {overview.withoutFamily}
                        </span>
                      </label>
                    </li>
                  )}
                </ul>
              </fieldset>
            )}
          </div>

          <div className="border-t border-stone-200 px-5 pb-4 pt-3 dark:border-stone-800">
            <p role="status" aria-live="polite" className="text-sm" data-testid="export-count">
              {status}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary min-h-11" onClick={close}>
                Abbrechen
              </button>
              {!canDownload ? (
                <button type="button" className="btn-primary min-h-11" disabled>
                  Herunterladen
                </button>
              ) : (
                // Ein Link statt fetch: Der Browser lädt große Dateien selbst herunter (Content-Disposition).
                <a href={mode === "families" ? familyHref : personHref} className="btn-primary min-h-11" onClick={() => setTimeout(close, 0)}>
                  Herunterladen
                </a>
              )}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

type Hit = { id: string; givenName: string; familyName: string | null; birthDate: string | null; deathDate: string | null };
const year = (iso: string | null) => (iso ? iso.slice(0, 4) : "");
const hitName = (h: Hit) => [h.givenName, h.familyName].filter(Boolean).join(" ");

/**
 * Personenwahl im Dialog — dasselbe Muster wie auf „Wie sind wir verwandt?“
 * (components/KinshipPersonField.tsx): Suche über die sichtbaren Personen
 * (/api/persons?q=, ab zwei Zeichen, höchstens 8 Treffer), „mich wählen“ für
 * die eigene Person, gewählt mit Lebensdaten und „ändern“.
 */
function ExportPersonField({
  person,
  self,
  onChange,
}: {
  person: ExportPersonCard | null;
  self: ExportPersonCard | null;
  onChange: (p: ExportPersonCard | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const searching = !person || editing;

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

  const choose = (p: ExportPersonCard) => {
    setEditing(false);
    setQ("");
    setHits([]);
    onChange(p);
  };

  return (
    <div data-testid="export-person">
      <p id={`${ids}-label`} className="field-label">
        Person
      </p>
      {!searching && person && (
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-surface px-3 py-1.5 dark:border-stone-700">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" data-testid="export-person-selected">
              {person.name}
            </span>
            {person.lifespan && <span className="block text-xs muted">{person.lifespan}</span>}
          </span>
          <button type="button" className="btn-link min-h-11" onClick={() => setEditing(true)} aria-label={`Person ändern (gewählt: ${person.name})`}>
            ändern
          </button>
        </div>
      )}
      {searching && (
        <div>
          <label htmlFor={`${ids}-q`} className="sr-only">
            Person: Name suchen
          </label>
          <input
            ref={inputRef}
            id={`${ids}-q`}
            className="field w-full"
            placeholder="Name eingeben…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            data-testid="export-person-search"
          />
          {(hits.length > 0 || q.trim().length >= 2) && (
            <ul
              className="mt-1 max-h-60 overflow-auto rounded-xl border border-stone-200 bg-surface p-1 shadow-lg dark:border-stone-700"
              aria-busy={busy}
              aria-label="Treffer"
            >
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-stone-900/5 dark:hover:bg-white/10"
                    onClick={() =>
                      choose({
                        id: h.id,
                        name: hitName(h),
                        lifespan: h.birthDate || h.deathDate ? `${year(h.birthDate) || "?"} – ${year(h.deathDate) || "?"}` : "",
                      })
                    }
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
            {self && self.id !== person?.id && (
              <button type="button" className="btn-link min-h-11" onClick={() => choose(self)} data-testid="export-person-self">
                mich wählen ({self.name})
              </button>
            )}
            {editing && person && (
              <button
                type="button"
                className="btn-link min-h-11"
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
