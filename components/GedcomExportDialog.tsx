"use client";

import { useId, useMemo, useRef, useState } from "react";

import { countSelection, selectionQuery, type ExportFamilyOverview } from "@/lib/export-selection";

type Format = "gedcom" | "gedzip";

const TITLE: Record<Format, string> = {
  gedcom: "GEDCOM exportieren",
  gedzip: "GEDCOM mit Bildern exportieren",
};

const persons = (n: number) => (n === 1 ? "1 Person" : `${n.toLocaleString("de-DE")} Personen`);

/**
 * Knöpfe „GEDCOM“ und „GEDCOM mit Bildern (ZIP)“ mit Dialog zur
 * Familienauswahl (Ziel z.B. MyHeritage). Echtes `<dialog>` (showModal):
 * Fokus bleibt im Dialog, Escape schließt, danach kehrt der Fokus zum Knopf
 * zurück. Standard: alles angekreuzt — dann geht die Anfrage ohne Auswahl
 * hinaus und der Export ist derselbe wie bisher. Was exportiert werden darf,
 * entscheidet der Server (lib/services/export-selection.ts); die Liste hier
 * enthält ohnehin nur die Familien des Benutzers.
 */
export function GedcomExportDialog({ overview }: { overview: ExportFamilyOverview }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const hintId = useId();
  const [format, setFormat] = useState<Format>("gedcom");
  const allIds = useMemo(() => overview.families.map((f) => f.id), [overview.families]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(allIds));
  const canWithout = overview.withoutFamily !== null;
  const [withoutFamily, setWithoutFamily] = useState(canWithout);

  const perFamily = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of overview.groups) for (const id of g.familyIds) m.set(id, (m.get(id) ?? 0) + g.persons);
    return m;
  }, [overview.groups]);

  const everything = chosen.size === allIds.length && (!canWithout || withoutFamily);
  const nothing = chosen.size === 0 && !(canWithout && withoutFamily);
  const count = countSelection(overview, chosen, canWithout && withoutFamily);
  const href = `/api/export?format=${format}${
    everything ? "" : selectionQuery({ familyIds: allIds.filter((id) => chosen.has(id)), withoutFamily: canWithout && withoutFamily })
  }`;

  function open(f: Format, opener: HTMLButtonElement) {
    setFormat(f);
    openerRef.current = opener;
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }
  const toggle = (id: string, on: boolean) =>
    setChosen((old) => {
      const next = new Set(old);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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
        onClose={() => openerRef.current?.focus()}
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
            <p id={hintId} className="mt-1 text-sm muted">
              Familien für den Export ankreuzen. Eine Person mit mehreren Familien ist dabei, sobald eine davon angekreuzt ist;
              Beziehungen, Quellen und {format === "gedzip" ? "Bilder" : "Belege"} nur, soweit sie zu exportierten Personen gehören.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {allIds.length === 0 && !canWithout ? (
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
            <p role="status" aria-live="polite" className="text-sm">
              {nothing ? "Nichts ausgewählt." : `${persons(count)} im Export.`}
              {everything && !nothing && <span className="muted"> Alles ausgewählt: derselbe Export wie bisher, auch mit noch unbelegten Quellen.</span>}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary min-h-11" onClick={close}>
                Abbrechen
              </button>
              {nothing ? (
                <button type="button" className="btn-primary min-h-11" disabled>
                  Herunterladen
                </button>
              ) : (
                // Ein Link statt fetch: Der Browser lädt große Dateien selbst herunter (Content-Disposition).
                <a href={href} className="btn-primary min-h-11" onClick={() => setTimeout(close, 0)}>
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
