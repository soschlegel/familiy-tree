"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import type { FieldChoice, MergeField, MergePreview, MergeResult } from "@/lib/services/merge";

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

const CHOICE_LABEL: Record<FieldChoice, string> = { keep: "bleibende Person", other: "andere Person", both: "beide" };

/**
 * Vergleich zweier Personen vor dem Zusammenführen: beide Seiten
 * nebeneinander, Abweichungen markiert, je Feld wählbar, darunter in ganzen
 * Sätzen, was geschieht (umziehen, zusammenfallen, Zweitangaben, Blockaden).
 * Jede Änderung der Wahl holt die Vorschau neu — sie ist die Rechnung des
 * Servers, nicht eine Schätzung im Browser.
 */
export function MergeView({ keepId: initialKeep, otherId: initialOther }: { keepId: string; otherId: string }) {
  const [keepId, setKeepId] = useState(initialKeep);
  const [otherId, setOtherId] = useState(initialOther);
  const [choices, setChoices] = useState<Partial<Record<MergeField, FieldChoice>>>({});
  const [subtypes, setSubtypes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
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
    setKeepId(otherId);
    setOtherId(keepId);
    setChoices({});
    setSubtypes({});
  }

  async function merge() {
    if (!preview || busy) return;
    if (!confirm(`„${preview.other.name}“ in „${preview.keep.name}“ zusammenführen? Das lässt sich nicht mit einem Klick rückgängig machen.`)) return;
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

  if (result) {
    return (
      <section className="card space-y-3 p-5" data-testid="merge-result" aria-live="polite">
        <h2 className="section-title">{result.alreadyMerged ? "Bereits zusammengeführt" : "Zusammengeführt"}</h2>
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
                {(b.suggestPairs ?? []).map(([a, c]) => (
                  <Link key={`${a}-${c}`} href={`/people/merge?keep=${a}&other=${c}`} className="ml-1 underline">
                    Diese Eltern vergleichen
                  </Link>
                ))}
              </li>
            ))}
          </ul>
        </div>
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
        <span className="text-xs muted">
          {CHOICE_LABEL.keep}: „{preview.keep.name}“ · {CHOICE_LABEL.other}: „{preview.other.name}“
        </span>
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
              ? "Keine widersprüchlichen Angaben — leere Felder werden aus der anderen Person ergänzt."
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
  return (
    <div className="card p-4" data-testid={testId}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-serif text-lg font-semibold">
        <Link href={`/people/${side.id}`} className="hover:underline">
          {side.name}
        </Link>
      </p>
      {(side.values.birthDate || side.values.deathDate) && (
        <p className="text-sm">
          {side.values.birthDate && `* ${side.values.birthDate}`} {side.values.deathDate && `† ${side.values.deathDate}`}
        </p>
      )}
      <p className="mt-1 text-xs muted">
        {c.relationships} Beziehungen · {c.events} Ereignisse · {c.names} Namensvarianten · {c.citations} Belege · {c.media} Bilder
      </p>
      {side.familyNames.length > 0 && <p className="mt-1 text-xs muted">Familien: {side.familyNames.join(", ")}</p>}
      {side.provenance.length > 0 && (
        <p className="mt-1 text-xs muted">
          Importiert
          {side.provenance.some((p) => p.fileName)
            ? `: ${[...new Set(side.provenance.map((p) => p.fileName).filter(Boolean))].join(", ")}`
            : ` (${side.provenance.length} Herkunftsangabe${side.provenance.length === 1 ? "" : "n"})`}
        </p>
      )}
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
