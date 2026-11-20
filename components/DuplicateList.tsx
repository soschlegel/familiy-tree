"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { lifeSpan } from "@/lib/tree-layout";
import type { DuplicateCandidate } from "@/lib/services/duplicates";
import type { BulkPreview, BulkResult } from "@/lib/services/merge-bulk";
import type { PersonBrief } from "@/lib/services/dto";

const CLASS_LABEL = { high: "sicher", medium: "wahrscheinlich", low: "unklar — bitte prüfen" } as const;
const CLASS_BADGE = { high: "badge-accent", medium: "badge", low: "badge-alt" } as const;

const fullName = (p: PersonBrief) => [p.givenName, p.familyName].filter(Boolean).join(" ") + (p.birthName ? ` geb. ${p.birthName}` : "");

/**
 * Liste möglicher Dubletten mit Aktionen: Zusammenführen (Vergleich), „kein
 * Duplikat“ (dauerhaft ausblenden) und — nur für die Klasse „sicher“ —
 * mehrere auswählen, gemeinsame Vorschau, in einem Rutsch zusammenführen.
 */
export function DuplicateList({ items, emptyText }: { items: DuplicateCandidate[]; emptyText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<(BulkPreview & { skipped: BulkResult["skipped"] }) | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const key = (d: DuplicateCandidate) => `${d.a.id}|${d.b.id}`;
  const selectable = items.filter((d) => d.confidence === "high" && d.canMerge);
  const pairs = items.filter((d) => selected.has(key(d))).map((d) => ({ a: d.a.id, b: d.b.id }));

  async function dismiss(d: DuplicateCandidate) {
    setBusy(key(d));
    setError(null);
    const res = await apiFetch("/api/duplicates/dismiss", jsonBody("POST", { a: d.a.id, b: d.b.id }));
    setBusy(null);
    if (!res.ok) return setError(res.message);
    router.refresh();
  }

  async function previewBulk() {
    setBusy("bulk");
    setError(null);
    const res = await apiFetch<BulkPreview & { skipped: BulkResult["skipped"] }>("/api/persons/merge/bulk", jsonBody("POST", { pairs, dryRun: true }));
    setBusy(null);
    if (!res.ok) return setError(res.message);
    setBulk(res.data);
  }

  async function runBulk() {
    if (!bulk) return;
    setBusy("bulk");
    const res = await apiFetch<BulkResult>("/api/persons/merge/bulk", jsonBody("POST", { pairs }));
    setBusy(null);
    if (!res.ok) return setError(res.message);
    setBulkResult(res.data);
    setBulk(null);
    setSelected(new Set());
    router.refresh();
  }

  const ready = bulk?.pairs.filter((p) => p.status !== "blocked") ?? [];

  return (
    <div className="space-y-3">
      {selectable.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-3" data-testid="dup-bulk-bar">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === selectable.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map(key)) : new Set())}
            />
            Alle sicheren auf dieser Seite auswählen
          </label>
          <button type="button" className="btn-primary btn-sm ml-auto" disabled={pairs.length === 0 || busy === "bulk"} onClick={() => void previewBulk()} data-testid="dup-bulk-preview">
            Ausgewählte zusammenführen … ({pairs.length})
          </button>
        </div>
      )}

      {bulk && (
        <section className="card space-y-3 p-4" aria-labelledby="bulk-h" data-testid="dup-bulk-summary">
          <h2 id="bulk-h" className="section-title">
            Gemeinsame Vorschau
          </h2>
          <p className="text-sm">
            {ready.length} von {bulk.pairs.length} Paaren lassen sich zusammenführen (Eltern zuerst, jedes Paar für sich). Dabei ziehen{" "}
            {bulk.totals.relationships} Beziehungen, {bulk.totals.events} Ereignisse, {bulk.totals.citations} Belege und {bulk.totals.media} Bilder um;{" "}
            {bulk.totals.collapsedRelationships} doppelte Beziehungen werden eins; {bulk.totals.alternates} abweichende Angaben bleiben als Zweitangabe,{" "}
            {bulk.totals.newNames} Namen als Namensvariante erhalten.
            {bulk.totals.newFamilyMemberships > 0 &&
              ` ${bulk.totals.newFamilyMemberships} Personen gehören danach zu zusätzlichen Familien — wer diese sehen darf, sieht sie dann auch.`}
          </p>
          <ul className="space-y-1 text-sm">
            {bulk.pairs.map((p) => (
              <li key={`${p.keepId}|${p.mergeId}`} className={p.status === "blocked" ? "text-red-700 dark:text-red-300" : ""}>
                Bleibt <strong>{p.keepName}</strong>, darin geht auf: {p.mergeName} —{" "}
                {p.status === "ready" ? "bereit" : p.status === "afterParents" ? p.reason : (p.blockers ?? []).map((b) => b.message).join(" ") || p.reason}
              </li>
            ))}
            {bulk.skipped.map((s) => (
              <li key={`${s.a}|${s.b}`} className="muted">
                Übersprungen: {s.reason}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={ready.length === 0 || busy === "bulk"} onClick={() => void runBulk()} data-testid="dup-bulk-confirm">
              {busy === "bulk" ? "Wird zusammengeführt…" : `${ready.length} Paare zusammenführen`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setBulk(null)}>
              Abbrechen
            </button>
          </div>
        </section>
      )}

      {bulkResult && (
        <div className="alert-success" role="status" data-testid="dup-bulk-result">
          {bulkResult.merged.length} Paare zusammengeführt
          {bulkResult.failed.length > 0 && `, ${bulkResult.failed.length} nicht möglich (${bulkResult.failed.map((f) => `${f.name}: ${f.reason}`).join("; ")})`}.
        </div>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {items.length === 0 && emptyText && <p className="alert-success">{emptyText}</p>}
      <ul className="space-y-2" data-testid="dup-list">
        {items.map((d) => (
          <li key={key(d)} className="card p-3" data-testid="dup-item" data-confidence={d.confidence}>
            <div className="flex flex-wrap items-center gap-2">
              {d.confidence === "high" && d.canMerge && (
                <input
                  type="checkbox"
                  aria-label={`${fullName(d.a)} und ${fullName(d.b)} auswählen`}
                  checked={selected.has(key(d))}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(key(d));
                    else next.delete(key(d));
                    setSelected(next);
                  }}
                />
              )}
              <span className={CLASS_BADGE[d.confidence]}>{CLASS_LABEL[d.confidence]}</span>
              <span className="badge tabular-nums" title="Ähnlichkeit">
                {Math.round(d.score * 100)} %
              </span>
              {d.crossTree && <span className="badge-alt">zwei Importe</span>}
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {[d.a, d.b].map((p) => (
                <Link key={p.id} href={`/people/${p.id}`} className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-stone-100 dark:hover:bg-stone-800">
                  <span className="truncate font-medium">{fullName(p)}</span>
                  <span className="ml-auto shrink-0 text-xs muted">{lifeSpan(p)}</span>
                </Link>
              ))}
            </div>
            <p className="mt-1 text-xs muted">{d.reasons.join(" · ")}</p>
            {d.conflicts.length > 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Widerspruch: {d.conflicts.join(" · ")}</p>}
            {d.canMerge && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/people/merge?keep=${d.a.id}&other=${d.b.id}`} className="btn-secondary btn-sm" data-testid="dup-merge">
                  Zusammenführen …
                </Link>
                <button type="button" className="btn-link btn-sm" disabled={busy === key(d)} onClick={() => void dismiss(d)} data-testid="dup-dismiss">
                  Kein Duplikat
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
