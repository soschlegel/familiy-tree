"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import type { ConnectPair, ConnectRun } from "@/lib/services/import-linking";
import { evidenceSentence } from "@/lib/import-linking";

type Group = ConnectRun["groups"][number];
type RunView = ConnectRun & { total: number; counts: Record<string, number>; accepted: number };
type Filter = "bridges" | "high" | "veryLikely" | "medium" | "low";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "bridges", label: "Verbindungspersonen", hint: "Verbinden zwei bisher getrennte Teile — bitte besonders sorgfältig prüfen." },
  { key: "high", label: "Sicher", hint: "Gleicher Name, gleiche tagesgenaue Geburts- und Sterbedaten bzw. gemeinsame Eltern, kein Widerspruch. Vorausgewählt." },
  { key: "veryLikely", label: "Sehr wahrscheinlich", hint: "Zwei übereinstimmende Verwandte oder gleiches Geburtsdatum plus ein Verwandter. Nicht vorausgewählt." },
  { key: "medium", label: "Wahrscheinlich", hint: "Achtung bei gleichnamigen Verwandten (Vater und Sohn, früh verstorbene Geschwister) mit fehlenden Daten." },
  { key: "low", label: "Unklar", hint: "Einzelne Übereinstimmungen oder Widersprüche — nur nach Prüfung im Vergleich." },
];
const CLASS_LABEL: Record<string, string> = { high: "sicher", medium: "wahrscheinlich", low: "unklar" };
const PAGE = 50;

const pct = (d: number, t: number) => (t ? Math.round((d / t) * 100) : 0);

/**
 * Importe verbinden: Auswahl → Abgleich → Liste mit Klassen → gemeinsame
 * Vorschau → Zusammenführen (Hintergrund) → Ergebnis mit Folge-Abgleich.
 */
export function ConnectImports() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [within, setWithin] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [filter, setFilter] = useState<Filter>("bridges");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<{ groups: Group[]; runs: ConnectRun[] }>("/api/connect");
      if (!res.ok) return setError(res.message);
      setGroups(res.data.groups);
      if (res.data.runs[0]) setRunId(res.data.runs[0].id);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!runId) return;
    const q = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (filter === "bridges") q.set("bridges", "1");
    else if (filter === "veryLikely") q.set("sehrWahrscheinlich", "1");
    else q.set("confidence", filter);
    const res = await apiFetch<RunView>(`/api/connect/${runId}?${q}`);
    if (!res.ok) return setError(res.message);
    setRun(res.data);
  }, [runId, filter, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stand abfragen, solange im Hintergrund gearbeitet wird
  useEffect(() => {
    if (!run || run.interrupted || !["analyzing", "previewing", "applying"].includes(run.status)) return;
    const t = setTimeout(() => void load(), 1500);
    return () => clearTimeout(t);
  }, [run, load]);

  async function start() {
    setBusy(true);
    setError(null);
    const all = groups.map((g) => g.id);
    const sel = chosen ? [...chosen] : all;
    const res = await apiFetch<ConnectRun>("/api/connect", jsonBody("POST", { groups: sel.length === all.length ? null : sel, withinGroup: within }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setOffset(0);
    setFilter("bridges");
    setRunId(res.data.id);
  }

  async function act(body: Record<string, unknown>) {
    if (!runId) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/connect/${runId}`, jsonBody("POST", body));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    void load();
  }

  const pageKeys = (run?.pairs ?? []).map((p) => p.key);
  const personsOf = (group: string) => group.split("+").reduce((n, g) => n + (groups.find((x) => x.id === g)?.persons ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4" aria-labelledby="connect-choose-h">
        <h2 id="connect-choose-h" className="section-title">
          Was abgleichen?
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm muted">Noch keine Importe vorhanden.</p>
        ) : (
          <fieldset className="space-y-1 text-sm">
            <legend className="sr-only">Importe</legend>
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen ? chosen.has(g.id) : true}
                  onChange={(e) => {
                    const next = new Set(chosen ?? groups.map((x) => x.id));
                    if (e.target.checked) next.add(g.id);
                    else next.delete(g.id);
                    setChosen(next);
                  }}
                />
                {g.label} <span className="muted">· {g.persons} Personen</span>
              </label>
            ))}
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={within} onChange={(e) => setWithin(e.target.checked)} />
              Doppelte innerhalb eines Imports suchen (statt zwischen den Importen)
            </label>
          </fieldset>
        )}
        <button type="button" className="btn-primary" disabled={busy || groups.length === 0} onClick={() => void start()} data-testid="connect-start">
          Abgleichen
        </button>
      </section>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {run && (
        <section className="space-y-4" aria-live="polite" data-testid="connect-run" data-status={run.status}>
          {run.progress && !run.interrupted && (
            <p className="alert-info" role="status">
              {run.progress.phase} läuft … {run.progress.total > 1 ? `${run.progress.done} von ${run.progress.total} (${pct(run.progress.done, run.progress.total)} %)` : ""}
            </p>
          )}
          {run.interrupted && (
            <div className="alert-warning flex flex-wrap items-center gap-3" data-testid="connect-interrupted">
              <span>
                Dieser Lauf wurde unterbrochen (z.B. durch einen Neustart der App)
                {run.apply ? ` — ${run.apply.done} von ${run.apply.clusters.length} Personengruppen sind schon zusammengeführt.` : "."}
              </span>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => void (run.status === "applying" ? act({ action: "apply" }) : run.status === "previewing" ? act({ action: "preview" }) : start())}
              >
                Fortsetzen
              </button>
            </div>
          )}
          {run.status === "error" && <p className="alert-error">{run.error}</p>}

          {run.components && (
            <div className="card space-y-2 p-4" data-testid="connect-summary">
              <p className="text-lg">
                Jetzt <strong className="tabular-nums">{run.components.beforeGroups}</strong>{" "}
                {run.components.beforeGroups === 1 ? "Familienverband" : "Familienverbände"}
                {run.components.beforeSingles > 0 && ` und ${run.components.beforeSingles} Einzelpersonen ohne Verbindung`} — mit den sicheren
                Verbindungen <strong className="tabular-nums">{run.components.afterGroups}</strong>{" "}
                {run.components.afterGroups === 1 ? "Familienverband" : "Familienverbände"}.
              </p>
              <p className="text-sm">
                {run.counts.high} sicher · {run.counts.veryLikely} sehr wahrscheinlich · {run.counts.medium} wahrscheinlich · {run.counts.low} unklar —{" "}
                <strong>{run.accepted}</strong> zum Zusammenführen ausgewählt.
              </p>
              {(run.bridges ?? []).length > 0 && (
                <ul className="text-sm">
                  {run.bridges!.map((b) => (
                    <li key={b.groups.join("|")}>
                      Verbindungspersonen zwischen {b.labels[0]} ({personsOf(b.groups[0])} Personen) und {b.labels[1]} ({personsOf(b.groups[1])}{" "}
                      Personen): <strong>{b.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs muted">
                Eine Verbindung, die als einzige zwei sonst getrennte Familien zusammenführt, gilt nie als „sicher“ — ein Irrtum dort verbände
                fremde Familien.
              </p>
              {["ready", "previewed"].includes(run.status) && (
                <button type="button" className="btn-primary" disabled={busy || run.accepted === 0} onClick={() => void act({ action: "preview" })} data-testid="connect-preview">
                  Gemeinsame Vorschau für {run.accepted} ausgewählte Paare
                </button>
              )}
            </div>
          )}

          {run.preview && run.status === "previewed" && (
            <div className="card space-y-2 p-4" data-testid="connect-preview-box">
              <h3 className="section-title">Was dabei passiert</h3>
              <p className="text-sm">
                {run.preview.persons} Einträge gehen in {run.preview.clusters} Personen auf. Dabei ziehen {run.preview.totals.relationships} Beziehungen,{" "}
                {run.preview.totals.events} Ereignisse und {run.preview.totals.citations} Belege um; {run.preview.totals.collapsedRelationships} doppelte
                Beziehungen werden eins; {run.preview.totals.alternates} abweichende Angaben bleiben als Zweitangabe, {run.preview.totals.newNames} Namen als
                Namensvariante erhalten. Danach sind es {run.preview.componentsAfter} getrennte Teile.
              </p>
              {run.preview.widerVisibility > 0 && (
                <p className="alert-warning text-sm" data-testid="connect-visibility">
                  {run.preview.widerVisibility} Personen gehören danach zu weiteren Familien — wer eine dieser Familien sehen darf, sieht sie dann auch.
                </p>
              )}
              {run.preview.blocked.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer">{run.preview.blocked.length} Paare sind blockiert und werden ausgelassen</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {run.preview.blocked.map((b) => (
                      <li key={b.key}>
                        {b.names}: {b.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => {
                  if (confirm(`${run.preview!.persons} Einträge zusammenführen? Das lässt sich nicht mit einem Klick rückgängig machen.`)) void act({ action: "apply" });
                }}
                data-testid="connect-apply"
              >
                Jetzt zusammenführen
              </button>
            </div>
          )}

          {run.status === "done" && run.apply && (
            <div className="alert-success space-y-1" data-testid="connect-done">
              <p>
                {run.apply.merged} Einträge zusammengeführt — aus den Importen ist ein gemeinsamer Stammbaum geworden.
                {run.apply.failed.length > 0 && ` ${run.apply.failed.length} Gruppen ließen sich nicht zusammenführen.`}
              </p>
              {run.followUpId && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setRunId(run.followUpId!)} data-testid="connect-followup">
                  Neuer Abgleich: Durch die Verbindungen können weitere Zuordnungen entstanden sein — ansehen
                </button>
              )}
            </div>
          )}

          {run.pairs && run.status !== "analyzing" && (
            <div className="space-y-3">
              <nav aria-label="Klassen" className="flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    className={filter === f.key ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                    onClick={() => {
                      setFilter(f.key);
                      setOffset(0);
                    }}
                  >
                    {f.label} ({f.key === "bridges" ? run.counts.bridges : f.key === "veryLikely" ? run.counts.veryLikely : run.counts[f.key]})
                  </button>
                ))}
              </nav>
              <p className="text-xs muted">{FILTERS.find((f) => f.key === filter)!.hint}</p>
              {["ready", "previewed"].includes(run.status) && pageKeys.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void act({ action: "decide", accept: pageKeys })}>
                    Alle auf dieser Seite auswählen
                  </button>
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void act({ action: "decide", reject: pageKeys })}>
                    Alle auf dieser Seite abwählen
                  </button>
                </div>
              )}
              <ul className="space-y-2" data-testid="connect-pairs">
                {run.pairs.map((p) => (
                  <PairRow key={p.key} pair={p} editable={["ready", "previewed"].includes(run.status)} busy={busy} onDecide={(body) => void act({ action: "decide", ...body })} />
                ))}
              </ul>
              {run.total > PAGE && (
                <nav aria-label="Seiten" className="flex items-center gap-3 text-sm">
                  <button type="button" className="btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    ← Zurück
                  </button>
                  <span className="muted">
                    {offset + 1}–{Math.min(run.total, offset + PAGE)} von {run.total}
                  </span>
                  <button type="button" className="btn-secondary btn-sm" disabled={offset + PAGE >= run.total} onClick={() => setOffset(offset + PAGE)}>
                    Weiter →
                  </button>
                </nav>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PairRow({ pair: p, editable, busy, onDecide }: { pair: ConnectPair; editable: boolean; busy: boolean; onDecide: (b: Record<string, unknown>) => void }) {
  return (
    <li className="card p-3 text-sm" data-testid="connect-pair" data-confidence={p.confidence}>
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <input
            type="checkbox"
            checked={p.decision === "accept"}
            disabled={busy}
            aria-label={`${p.a.name} und ${p.b.name} zusammenführen`}
            onChange={(e) => onDecide(e.target.checked ? { accept: [p.key] } : { reject: [p.key] })}
          />
        )}
        <span className={p.confidence === "high" ? "badge-accent" : p.confidence === "medium" ? "badge" : "badge-alt"}>
          {p.veryLikely ? "sehr wahrscheinlich" : CLASS_LABEL[p.confidence]}
        </span>
        {p.bridge && (
          <span className="badge-alt">
            verbindet {p.bridge.sizeA} mit {p.bridge.sizeB} Personen{p.bridge.only ? " (einzige Verbindung)" : ""}
          </span>
        )}
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {[p.a, p.b].map((x) => (
          <Link key={x.id} href={`/people/${x.id}`} className="rounded-md px-2 py-1 hover:bg-stone-100 max-md:py-3 dark:hover:bg-stone-800">
            <span className="font-medium">{x.name}</span> <span className="text-xs muted">{x.life}</span>
            <span className="block text-xs muted">{x.groupLabel}</span>
          </Link>
        ))}
      </div>
      <p className="mt-1 text-xs muted">{evidenceSentence(p.reasons)}</p>
      {p.conflicts.length > 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Widerspruch: {p.conflicts.join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href={`/people/merge?keep=${p.a.id}&other=${p.b.id}`} className="btn-link btn-sm">
          Vergleich ansehen
        </Link>
        {editable && (
          <button type="button" className="btn-link btn-sm" disabled={busy} onClick={() => onDecide({ dismiss: [p.key] })}>
            Kein Duplikat
          </button>
        )}
      </div>
    </li>
  );
}
