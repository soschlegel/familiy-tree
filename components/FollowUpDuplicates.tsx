"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { CONFIDENCE_LABEL } from "@/lib/duplicates";
import { lifeSpan } from "@/lib/tree-layout";
import type { PersonBrief } from "@/lib/services/dto";
import type { BulkPreview, BulkResult } from "@/lib/services/merge-bulk";
import type { FollowUpDuplicate, FollowUpDuplicates as FollowUps } from "@/lib/services/merge-followups";

const CLASS_BADGE = { high: "badge-accent", medium: "badge", low: "badge-alt" } as const;
const VIA_TEXT = { parents: "Beide als Eltern von", partners: "Beide als Partner von", children: "Beide als Kinder von" } as const;

const fullName = (p: PersonBrief) => [p.givenName, p.familyName].filter(Boolean).join(" ") + (p.birthName ? ` geb. ${p.birthName}` : "");
const withLife = (p: PersonBrief) => `${fullName(p)}${lifeSpan(p) ? ` (${lifeSpan(p)})` : ""}`;

type Preview = BulkPreview & { skipped: BulkResult["skipped"] };

/**
 * Ergebnisseite nach einem Zusammenführen: Eltern, Partner und Kinder der
 * bleibenden Person, die jetzt selbst doppelt aussehen (Folgedubletten), je
 * mit Klasse und Begründung. Jedes Paar lässt sich einzeln vergleichen; die
 * „sicheren“ gehen auf Wunsch gemeinsam — aber nur über die normale Vorschau
 * des Sammel-Zusammenführens, die jedes Paar selbst noch einmal bewertet.
 * Nichts ist vorausgewählt; „wahrscheinlich“ und „unklar“ gehen nie mit.
 * Nach dem gemeinsamen Zusammenführen wird neu gesucht, auch bei den dabei
 * bleibenden Personen (deren Eltern können nun ebenfalls doppelt sein).
 */
export function FollowUpDuplicates({ personIds }: { personIds: string[] }) {
  const [ids, setIds] = useState(personIds);
  const [data, setData] = useState<FollowUps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const res = await apiFetch<FollowUps>(`/api/persons/merge/followups?ids=${ids.map(encodeURIComponent).join(",")}`);
    if (n !== seq.current) return;
    if (!res.ok) return setError(res.message);
    setError(null);
    setData(res.data);
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  const sure = data?.items.filter((d) => d.confidence === "high") ?? [];
  const pairs = sure.map((d) => ({ a: d.a.id, b: d.b.id }));

  async function previewBulk() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<Preview>("/api/persons/merge/bulk", jsonBody("POST", { pairs, dryRun: true }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setPreview(res.data);
  }

  async function runBulk() {
    if (!preview) return;
    setBusy(true);
    const res = await apiFetch<BulkResult>("/api/persons/merge/bulk", jsonBody("POST", { pairs }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setResult(res.data);
    setPreview(null);
    // Neu suchen — auch bei den eben zusammengeführten Verwandten.
    setIds((old) => [...new Set([...old, ...res.data.merged.map((m) => m.keepId)])].slice(0, 20));
  }

  if (!data && !error) return null;
  if (data && data.items.length === 0 && !result && !error) return null;
  const ready = preview?.pairs.filter((p) => p.status !== "blocked") ?? [];

  return (
    <section className="card space-y-3 p-5" aria-labelledby="followups-h" data-testid="merge-followups">
      <div>
        <h2 id="followups-h" className="section-title">
          Folgedubletten
        </h2>
        <p className="text-sm muted">
          Nach dem Zusammenführen stehen Verwandte oft doppelt da — je einmal aus jedem der beiden Einträge. Bitte prüfen; nichts
          davon wird von selbst zusammengeführt.
        </p>
      </div>

      {result && (
        <div className="alert-success" role="status" data-testid="followup-bulk-result">
          {result.merged.length === 1 ? "1 Paar zusammengeführt" : `${result.merged.length} Paare zusammengeführt`}
          {result.failed.length > 0 && `, ${result.failed.length} nicht möglich (${result.failed.map((f) => `${f.name}: ${f.reason}`).join("; ")})`}.
        </div>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {data && data.items.length === 0 && result && <p className="text-sm muted">Keine weiteren Folgedubletten gefunden.</p>}

      {data && data.items.length > 0 && (
        <ul className="space-y-2" data-testid="followup-list">
          {data.items.map((d: FollowUpDuplicate) => (
            <li key={`${d.a.id}|${d.b.id}`} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800" data-testid="merge-followup" data-confidence={d.confidence}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={CLASS_BADGE[d.confidence]}>{CONFIDENCE_LABEL[d.confidence]}</span>
                <span>
                  <Link href={`/people/${d.a.id}`} className="font-medium hover:underline">
                    {withLife(d.a)}
                  </Link>{" "}
                  ↔{" "}
                  <Link href={`/people/${d.b.id}`} className="font-medium hover:underline">
                    {withLife(d.b)}
                  </Link>
                </span>
              </div>
              <p className="mt-1 text-xs muted">
                {VIA_TEXT[d.via.relation]} {d.via.name} eingetragen. {d.sentence}
              </p>
              {d.conflicts.length > 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Bitte prüfen: {d.conflicts.join(" · ")}</p>}
              <Link href={`/people/merge?keep=${d.a.id}&other=${d.b.id}`} className="btn-secondary btn-sm mt-2" data-testid="followup-compare">
                Vergleichen<span className="sr-only">: {fullName(d.a)} und {fullName(d.b)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sure.length > 0 && !preview && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary max-w-full whitespace-normal text-left" disabled={busy} onClick={() => void previewBulk()} data-testid="followup-bulk-preview">
            Alle sicheren Folgedubletten zusammenführen … ({sure.length})
          </button>
          <span className="text-xs muted">Zeigt zuerst die gemeinsame Vorschau. Nur die Klasse „sicher“.</span>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800" data-testid="followup-bulk-summary">
          <h3 className="font-semibold">Gemeinsame Vorschau</h3>
          <p className="text-sm">
            {ready.length} von {preview.pairs.length} {preview.pairs.length === 1 ? "Paar lässt" : "Paaren lassen"} sich zusammenführen (Eltern zuerst, jedes Paar
            für sich). Dabei ziehen {preview.totals.relationships} Beziehungen, {preview.totals.events} Ereignisse, {preview.totals.citations} Belege und{" "}
            {preview.totals.media} Bilder um; {preview.totals.collapsedRelationships} doppelte Beziehungen werden eins; {preview.totals.alternates} abweichende
            Angaben bleiben als Zweitangabe, {preview.totals.newNames} Namen als Namensvariante erhalten.
            {preview.totals.newFamilyMemberships > 0 &&
              ` ${preview.totals.newFamilyMemberships} Personen gehören danach zu zusätzlichen Familien — wer diese sehen darf, sieht sie dann auch.`}
          </p>
          <ul className="space-y-1 text-sm">
            {preview.pairs.map((p) => (
              <li key={`${p.keepId}|${p.mergeId}`} className={p.status === "blocked" ? "text-red-700 dark:text-red-300" : ""}>
                Bleibt <strong>{p.keepName}</strong>, darin geht auf: {p.mergeName} —{" "}
                {p.status === "ready" ? "bereit" : p.status === "afterParents" ? p.reason : (p.blockers ?? []).map((b) => b.message).join(" ") || p.reason}
              </li>
            ))}
            {preview.skipped.map((s) => (
              <li key={`${s.a}|${s.b}`} className="muted">
                Übersprungen: {s.reason}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={ready.length === 0 || busy} onClick={() => void runBulk()} data-testid="followup-bulk-confirm">
              {busy ? "Wird zusammengeführt…" : ready.length === 1 ? "1 Paar zusammenführen" : `${ready.length} Paare zusammenführen`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
