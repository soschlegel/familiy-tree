"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { apiFetch } from "./api-client";
import { PersonPicker, type PickerPerson } from "./PersonPicker";
import { VERDICT_LABEL } from "@/lib/duplicate-verdicts";
import { CONFIDENCE_LABEL } from "@/lib/duplicates";
import { HELP_LINKS } from "@/lib/help/links";
import { lifeSpan } from "@/lib/tree-layout";
import type { PersonDuplicates } from "@/lib/services/duplicates";

const CLASS_BADGE = { high: "badge-accent", medium: "badge", low: "badge-alt" } as const;

const fullName = (p: { givenName: string; familyName: string | null; birthName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ") + (p.birthName ? ` geb. ${p.birthName}` : "");

/**
 * Personenseite → „Zusammenführen …“: Dialog mit den möglichen Dubletten
 * dieser Person (Klasse und Begründung, erst beim Öffnen geladen) und
 * darunter der freien Personensuche. Der Dialog führt selbst nichts zusammen
 * — jede Wahl öffnet den Vergleich (/people/merge), in dem diese Person die
 * bleibende ist; dort lassen sich die Seiten tauschen.
 *
 * Echtes `<dialog>` (showModal): Fokus bleibt im Dialog, Escape schließt,
 * danach kehrt der Fokus zum Knopf zurück.
 */
export function MergeDialog({ personId, personName, people }: { personId: string; personName: string; people: PickerPerson[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();
  const searchId = useId();
  const [candidates, setCandidates] = useState<PersonDuplicates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState("");

  async function open() {
    dialogRef.current?.showModal();
    setError(null);
    const res = await apiFetch<PersonDuplicates>(`/api/persons/${personId}/duplicates`);
    if (!res.ok) return setError(res.message);
    setCandidates(res.data);
  }
  const close = () => dialogRef.current?.close();
  const compareHref = (otherId: string) => `/people/merge?keep=${personId}&other=${otherId}`;
  const more = candidates ? candidates.total - candidates.items.length : 0;

  return (
    <>
      <button ref={openerRef} type="button" className="btn-secondary" aria-haspopup="dialog" onClick={() => void open()} data-testid="merge-open">
        Zusammenführen …
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onClose={() => openerRef.current?.focus()}
        // Klick auf den abgedunkelten Hintergrund schließt (das Ziel ist dann das <dialog> selbst).
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        // Oben statt mittig und ohne eigenes Abschneiden: Die Vorschlagsliste
        // der Personensuche klappt nach unten über den Dialogrand hinaus auf.
        className="mx-auto mb-auto mt-4 w-[min(36rem,calc(100vw-2rem))] overflow-visible rounded-xl border border-stone-200 bg-surface p-0 text-left text-stone-900 shadow-xl backdrop:bg-stone-950/50 sm:mt-[8dvh] dark:border-stone-700 dark:text-stone-100"
        data-testid="merge-dialog"
      >
        <div className="border-b border-stone-200 px-5 pb-3 pt-4 dark:border-stone-800">
          <h2 id={titleId} className="section-title">
            Mit anderem Eintrag zusammenführen
          </h2>
          <p id={hintId} className="mt-1 text-sm muted">
            Ist „{personName}“ doppelt erfasst? Wähle den anderen Eintrag. Danach zeigt der Vergleich genau, was geschieht — erst
            dort wird zusammengeführt.
          </p>
        </div>

        <section aria-labelledby={`${titleId}-c`} className="px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 id={`${titleId}-c`} className="eyebrow">
              Mögliche Dubletten dieser Person
            </h3>
            <Link href={HELP_LINKS.dublettenKlassen} className="btn-link text-xs" data-testid="merge-help-link">
              Was bedeuten die Klassen?
            </Link>
          </div>
          {error ? (
            <p role="alert" className="alert-error mt-2">
              {error}
            </p>
          ) : !candidates ? (
            <p role="status" className="mt-2 text-sm muted">
              Wird gesucht…
            </p>
          ) : candidates.items.length === 0 ? (
            <p className="mt-2 text-sm muted" data-testid="merge-no-candidates">
              Keine möglichen Dubletten gefunden. Eingetragene Vorfahren und Nachkommen werden nie vorgeschlagen.
            </p>
          ) : (
            <>
              <ul className="mt-2 max-h-[32dvh] space-y-2 overflow-y-auto" data-testid="merge-candidates">
                {candidates.items.map((d) => (
                  <li key={d.person.id} className="card p-3 text-sm" data-testid="merge-candidate" data-confidence={d.confidence}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-medium">{fullName(d.person)}</span>
                      <span className="muted">
                        {lifeSpan(d.person) || "Lebensdaten unbekannt"} · {d.origin.join(", ")}
                      </span>
                      <span className={CLASS_BADGE[d.confidence]}>{CONFIDENCE_LABEL[d.confidence]}</span>
                    </div>
                    <p className="mt-1 text-xs muted" data-testid="merge-candidate-reason">
                      {d.sentence}
                    </p>
                    {/* KI-Vorprüfung: nur das Urteil — es ändert weder Klasse noch Reihenfolge. */}
                    {d.review && (
                      <p className="mt-1 text-xs" data-testid="merge-candidate-review" data-verdict={d.review.verdict}>
                        KI-Einschätzung: {VERDICT_LABEL[d.review.verdict]}
                        {d.review.stale && " (veraltet)"}
                      </p>
                    )}
                    {d.conflicts.length > 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Widerspruch: {d.conflicts.join(" · ")}</p>}
                    <Link href={compareHref(d.person.id)} className="btn-secondary btn-sm mt-2" data-testid="merge-candidate-compare">
                      Vergleichen<span className="sr-only"> mit {fullName(d.person)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <p className="mt-2 text-xs muted">
                  {more === 1 ? "und 1 weitere" : `und ${more} weitere`} — alle unter{" "}
                  <Link href="/research/duplicates" className="underline underline-offset-2">
                    Mögliche Dubletten
                  </Link>
                  .
                </p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby={searchId} className="border-t border-stone-200 px-5 py-3 dark:border-stone-800">
          <h3 id={searchId} className="eyebrow">
            Andere Person suchen
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PersonPicker people={people} value={other} onChange={setOther} labelledBy={searchId} placeholder="Name der doppelten Person…" />
            <button type="button" className="btn-primary" disabled={!other} onClick={() => router.push(compareHref(other))} data-testid="merge-compare">
              Vergleichen
            </button>
          </div>
        </section>

        <div className="flex justify-end border-t border-stone-200 px-5 py-3 dark:border-stone-800">
          <button type="button" className="btn-secondary" onClick={close}>
            Abbrechen
          </button>
        </div>
      </dialog>
    </>
  );
}
