"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { FollowUpDuplicates } from "./FollowUpDuplicates";
import type { FieldChoice, MergeField, MergePreview, MergeResult } from "@/lib/services/merge";

/** Ein Elternpaar, das vor diesem Paar zusammengeführt würde, mit seiner eigenen Vorschau. */
type ParentPlan = { a: string; b: string; label: string; preview: MergePreview };

const SUBTYPE_LABEL: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "Adoption",
  STEP: "Stiefeltern",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
  PARTNER_UNKNOWN: "Ehestand unbekannt",
};


/**
 * Vergleich zweier Personen vor dem Zusammenführen: beide Seiten
 * nebeneinander, Abweichungen markiert, je Feld wählbar, darunter in ganzen
 * Sätzen, was geschieht (umziehen, zusammenfallen, Zweitangaben, Blockaden).
 * Jede Änderung der Wahl holt die Vorschau neu — sie ist die Rechnung des
 * Servers, nicht eine Schätzung im Browser.
 */
export function MergeView({ keepId, otherId }: { keepId: string; otherId: string }) {
  // Die beiden IDs kommen aus der URL (die Seite setzt key={keep:other}): Links
  // auf ein anderes Paar und „Seiten tauschen“ ändern die URL, nicht einen
  // inneren Zustand — sonst zeigte die Seite nach einem Link das alte Paar.
  const router = useRouter();
  const [choices, setChoices] = useState<Partial<Record<MergeField, FieldChoice>>>({});
  const [subtypes, setSubtypes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  // „Erst die Eltern, dann dieses Paar“: Vorschau je Elternpaar (null = nicht geöffnet).
  const [parentPlan, setParentPlan] = useState<ParentPlan[] | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    setParentPlan(null);
    const res = await apiFetch<MergePreview>(
      "/api/persons/merge/preview",
      jsonBody("POST", { keepId, mergeId: otherId, choices, relationshipSubtypes: subtypes }),
    );
    if (n !== seq.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      setPreview(null);
      return;
    }
    setError(null);
    setPreview(res.data);
  }, [keepId, otherId, choices, subtypes]);

  useEffect(() => {
    void load();
  }, [load]);

  function swap() {
    router.replace(`/people/merge?keep=${otherId}&other=${keepId}`);
  }

  async function merge() {
    if (!preview || busy) return;
    if (!confirm("Den anderen Eintrag in den bleibenden zusammenführen? Das lässt sich nicht mit einem Klick rückgängig machen.")) return;
    setBusy(true);
    const res = await apiFetch<MergeResult>(
      "/api/persons/merge",
      jsonBody("POST", { keepId, mergeId: otherId, choices, relationshipSubtypes: subtypes, expectedToken: preview.token }),
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      if (res.status === 409) void load();
      return;
    }
    setResult(res.data);
  }

  /** Vorschau der Elternpaare holen, die die Sperre vorschlägt (schreibt nichts). */
  async function planParentsFirst(pairs: { a: string; b: string; label: string }[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const plans: ParentPlan[] = [];
    for (const p of pairs) {
      const res = await apiFetch<MergePreview>("/api/persons/merge/preview", jsonBody("POST", { keepId: p.a, mergeId: p.b }));
      if (!res.ok) {
        setBusy(false);
        setError(res.message);
        return;
      }
      plans.push({ ...p, preview: res.data });
    }
    setBusy(false);
    setParentPlan(plans);
  }

  /** Eltern und dieses Paar in EINEM Schritt (eine Transaktion auf dem Server). */
  async function mergeParentsFirst() {
    if (!preview || !parentPlan || busy) return;
    if (!confirm("Erst die Eltern, dann dieses Paar zusammenführen? Das lässt sich nicht mit einem Klick rückgängig machen.")) return;
    setBusy(true);
    const res = await apiFetch<MergeResult>(
      "/api/persons/merge",
      jsonBody("POST", {
        keepId,
        mergeId: otherId,
        choices,
        relationshipSubtypes: subtypes,
        expectedToken: preview.token,
        parentsFirst: parentPlan.map((p) => ({ keepId: p.a, mergeId: p.b, expectedToken: p.preview.token })),
      }),
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      if (res.status === 409) void load();
      return;
    }
    setResult(res.data);
  }

  if (result) {
    const parents = result.parentMerges ?? [];
    return (
      <div className="space-y-5">
        <section className="card space-y-3 p-5" data-testid="merge-result" aria-live="polite">
          <h2 className="section-title">{result.alreadyMerged ? "Bereits zusammengeführt" : "Zusammengeführt"}</h2>
          {parents.length > 0 && (
            <p className="text-sm" data-testid="merge-result-parents">
              Zuvor im selben Schritt zusammengeführt: {parents.length === 1 ? "der doppelt erfasste Elternteil" : "die doppelt erfassten Eltern"}{" "}
              {parents.map((p, i) => (
                <span key={p.keepId}>
                  {i > 0 && " und "}
                  <Link href={`/people/${p.keepId}`} className="underline">
                    {p.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {result.summary.sentences
              .filter((s) => !s.startsWith("Blockiert"))
              .map((s, i) => (
                <li key={i}>{s}</li>
              ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href={`/people/${result.keepId}`} className="btn-primary">
              Zur Person
            </Link>
            <Link href="/research/duplicates" className="btn-secondary">
              Weitere Dubletten prüfen
            </Link>
          </div>
        </section>
        <FollowUpDuplicates personIds={[result.keepId, ...parents.map((p) => p.keepId)]} />
      </div>
    );
  }

  if (!preview) {
    return loading ? (
      <p className="text-sm muted" role="status">
        Vergleich wird berechnet…
      </p>
    ) : (
      <p role="alert" className="alert-error">
        {error ?? "Der Vergleich ließ sich nicht laden."}
      </p>
    );
  }

  const differing = preview.fields.filter((f) => f.differs).length;
  // Nur wenn NICHTS anderes im Weg steht als doppelt erfasste Eltern, die sich
  // alle zuordnen lassen (der Server prüft das beim Ausführen noch einmal).
  const parentPairs = preview.blockers.flatMap((b) => b.suggestions ?? []);
  const parentsFirstPossible = parentPairs.length > 0 && preview.blockers.every((b) => b.code === "BIO_PARENTS" && b.resolvable);
  const parentPlanOk = parentPlan !== null && parentPlan.every((p) => p.preview.canMerge);

  return (
    <div className="space-y-6" data-testid="merge-view" aria-busy={loading}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <PersonCard label="Bleibt" side={preview.keep} testId="merge-keep" />
        <div className="flex items-center justify-center">
          <button type="button" onClick={swap} className="btn-secondary btn-sm" data-testid="merge-swap">
            ⇄ Seiten tauschen
          </button>
        </div>
        <PersonCard label="Geht darin auf" side={preview.other} testId="merge-other" />
      </div>

      <section aria-labelledby="merge-what-h" className="card space-y-2 p-4" data-testid="merge-summary">
        <h2 id="merge-what-h" className="section-title">
          Was dabei passiert
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {preview.summary.sentences
            .filter((s) => !s.startsWith("Blockiert"))
            .map((s, i) => (
              <li key={i}>{s}</li>
            ))}
        </ul>
      </section>

      {preview.blockers.length > 0 && (
        <div role="alert" className="alert-error space-y-2" data-testid="merge-blockers">
          <p className="font-medium">So lassen sich die beiden nicht zusammenführen:</p>
          <ul className="list-disc space-y-1 pl-5">
            {preview.blockers.map((b, i) => (
              <li key={i}>
                {b.message}
                {(b.suggestions ?? []).map((sg) => (
                  <Link key={`${sg.a}-${sg.b}`} href={`/people/merge?keep=${sg.a}&other=${sg.b}`} className="mt-1 block underline" data-testid="merge-parent-link">
                    {sg.label}
                  </Link>
                ))}
              </li>
            ))}
          </ul>
          {parentsFirstPossible && !parentPlan && (
            <button type="button" className="btn-secondary" disabled={busy || loading} onClick={() => void planParentsFirst(parentPairs)} data-testid="merge-parents-first">
              Erst die Eltern, dann dieses Paar zusammenführen …
            </button>
          )}
        </div>
      )}

      {parentPlan && (
        <section className="card space-y-3 p-4" aria-labelledby="parents-first-h" data-testid="merge-parents-plan">
          <h2 id="parents-first-h" className="section-title">
            Erst die Eltern, dann dieses Paar
          </h2>
          <p className="text-sm muted">
            In einem Schritt: Zuerst {parentPlan.length === 1 ? "wird das doppelt erfasste Elternpaar" : "werden die doppelt erfassten Elternpaare"} zusammengeführt
            (nach den Regeln, ohne Feldwahl), danach dieses Paar mit deiner Wahl. Geht ein Teil nicht, wird nichts geändert. Bitte prüfe, dass es wirklich
            dieselben Personen sind.
          </p>
          {parentPlan.map((p) => (
            <div key={`${p.a}|${p.b}`} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800" data-testid="merge-parents-pair">
              <p>
                Bleibt <strong>{p.preview.keep.name}</strong>
                {p.preview.keep.born && ` (*${p.preview.keep.born})`}, darin geht auf: <strong>{p.preview.other.name}</strong>
                {p.preview.other.born && ` (*${p.preview.other.born})`}.{" "}
                <Link href={`/people/merge?keep=${p.a}&other=${p.b}`} className="underline">
                  Einzeln vergleichen
                </Link>
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs muted">
                {p.preview.summary.sentences
                  .filter((s) => !s.startsWith("Blockiert"))
                  .slice(1)
                  .map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
              </ul>
              {p.preview.blockers.length > 0 && (
                <p role="alert" className="mt-1 text-red-700 dark:text-red-300">
                  Geht so nicht: {p.preview.blockers.map((b) => b.message).join(" ")}
                </p>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={!parentPlanOk || busy || loading} onClick={() => void mergeParentsFirst()} data-testid="merge-parents-confirm">
              {busy ? "Wird zusammengeführt…" : "Eltern und dieses Paar zusammenführen"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setParentPlan(null)}>
              Abbrechen
            </button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!preview.canMerge || busy || loading}
          onClick={() => void merge()}
          data-testid="merge-confirm"
        >
          {busy ? "Wird zusammengeführt…" : "Zusammenführen"}
        </button>
        <Link href={`/people/${keepId}`} className="btn-secondary">
          Abbrechen
        </Link>
      </div>

      <details className="card group p-4" data-testid="merge-details" open={openDetails}>
        <summary className="flex cursor-pointer list-none items-center gap-2" onClick={(e) => { e.preventDefault(); setOpenDetails((o) => !o); }}>
          <span className="section-title">Angaben einzeln ansehen und wählen</span>
          <span className="text-sm muted">
            {differing === 0 ? "— nichts widerspricht sich" : `— ${differing} ${differing === 1 ? "Angabe weicht" : "Angaben weichen"} ab`}
          </span>
          <span aria-hidden className="ml-auto text-xs muted transition group-open:rotate-90">▸</span>
        </summary>
        <div className="mt-3 space-y-4">
        <section aria-labelledby="merge-fields-h" className="">
          <h2 id="merge-fields-h" className="sr-only">
            Angaben
          </h2>
          <p className="mb-3 text-sm muted">
            {differing === 0
              ? "Keine widersprüchlichen Angaben — leere Felder werden aus dem anderen Eintrag ergänzt."
              : `${differing} ${differing === 1 ? "Angabe weicht" : "Angaben weichen"} ab (markiert). Nicht gewählte Geburts- und Sterbeangaben bleiben als Zweitangabe, nicht gewählte Namen als Namensvariante erhalten.`}
          </p>
          <div className="divide-y divide-stone-200 dark:divide-stone-800">
            {preview.fields
              .filter((f) => f.keep || f.other)
              .map((f) => (
                <fieldset
                  key={f.field}
                  className={`grid gap-2 py-2 sm:grid-cols-[10rem_1fr_1fr] sm:items-start ${
                    f.differs ? "-mx-2 rounded-md bg-amber-50 px-2 dark:bg-amber-900/20" : ""
                  }`}
                  data-testid={`merge-field-${f.field}`}
                  data-differs={f.differs}
                >
                  <legend className="contents">
                    <span className="text-sm font-medium">
                      {f.label}
                      {f.differs && <span className="sr-only"> (weicht ab)</span>}
                    </span>
                  </legend>
                  {(["keep", "other"] as const).map((side) => (
                    <ChoiceCell
                      key={side}
                      name={f.field}
                      value={side}
                      text={f[side]}
                      checked={(choices[f.field] ?? f.choice) === side}
                      selectable={f.differs}
                      onChange={() => setChoices((c) => ({ ...c, [f.field]: side }))}
                    />
                  ))}
                  {f.options.includes("both") && f.differs && (
                    <label className="flex items-center gap-2 text-sm sm:col-start-2">
                      <input
                        type="radio"
                        name={f.field}
                        checked={(choices[f.field] ?? f.choice) === "both"}
                        onChange={() => setChoices((c) => ({ ...c, [f.field]: "both" }))}
                      />
                      beide behalten (aneinandergehängt)
                    </label>
                  )}
                  {f.why && <p className="text-xs muted sm:col-start-2 sm:col-span-2">{f.why}</p>}
                </fieldset>
              ))}
          </div>
        </section>

        {preview.relationshipChoices.length > 0 && (
          <section aria-labelledby="merge-rel-h" className="card space-y-2 p-4">
            <h2 id="merge-rel-h" className="section-title">
              Beziehungen, die beide haben
            </h2>
            {preview.relationshipChoices.map((r) => (
              <label key={r.survivorId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{r.label}</span>
                <select
                  className="field w-auto"
                  value={subtypes[r.survivorId] ?? r.chosen}
                  onChange={(e) => setSubtypes((s) => ({ ...s, [r.survivorId]: e.target.value }))}
                >
                  {r.options.map((o) => (
                    <option key={o} value={o}>
                      {SUBTYPE_LABEL[o] ?? o}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </section>
        )}

        </div>
      </details>
    </div>
  );
}

function PersonCard({ label, side, testId }: { label: string; side: MergePreview["keep"]; testId: string }) {
  const c = side.counts;
  const row = (term: string, value: string | null | undefined) =>
    value ? (
      <div className="flex gap-2">
        <dt className="w-20 shrink-0 muted">{term}</dt>
        <dd className="min-w-0">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="card p-4" data-testid={testId}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-serif text-lg font-semibold">
        <Link href={`/people/${side.id}`} className="hover:underline">
          {side.name}
        </Link>
      </p>
      <dl className="mt-2 space-y-0.5 text-sm">
        {row("geboren", side.born)}
        {row("gestorben", side.died)}
        {row("Eltern", side.parents.join(", "))}
        {row(side.partners.length > 1 ? "Partner" : "Partner/in", side.partners.join(", "))}
        {row("Kinder", side.children ? String(side.children) : null)}
        {row("Familien", side.familyNames.join(", "))}
        {row("Import", side.imports.join(", "))}
      </dl>
      <p className="mt-2 text-xs muted">
        {c.events} Ereignisse · {c.names} Namensvarianten · {c.citations} Belege · {c.media} Bilder
      </p>
    </div>
  );
}

function ChoiceCell({
  name,
  value,
  text,
  checked,
  selectable,
  onChange,
}: {
  name: string;
  value: "keep" | "other";
  text: string;
  checked: boolean;
  selectable: boolean;
  onChange: () => void;
}) {
  const sideLabel = value === "keep" ? "Bleibt" : "Andere";
  if (!selectable) {
    return (
      <p className={`text-sm ${text ? "" : "muted"}`}>
        <span className="text-xs muted sm:sr-only">{sideLabel}: </span>
        {text || "—"}
      </p>
    );
  }
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md text-sm ${checked ? "font-medium" : ""}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1" />
      <span>
        <span className="text-xs muted sm:sr-only">{sideLabel}: </span>
        {text || <span className="muted">— (leer)</span>}
      </span>
    </label>
  );
}
