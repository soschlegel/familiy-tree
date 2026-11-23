"use client";

import { useCallback, useEffect, useState } from "react";

import { originText } from "@/lib/origin";
import { plural } from "@/lib/plural";
import type { OriginOverview as Overview } from "@/lib/services/origin";
import { apiFetch } from "./api-client";
import { OriginChip } from "./OriginChips";

const W = 520;
const H = 300;

/** Kreise gleichmäßig auf einer Ellipse; ein einzelner in der Mitte. */
function place(n: number): { x: number; y: number }[] {
  if (n === 1) return [{ x: W / 2, y: H / 2 - 10 }];
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - (n === 2 ? Math.PI : Math.PI / 2);
    return { x: W / 2 + Math.cos(a) * 165, y: H / 2 - 12 + Math.sin(a) * 88 };
  });
}

const short = (s: string, max = 22) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Übersicht der Herkunft auf „Importe verbinden“: jeder Import ein Kreis
 * (Fläche nach Zahl der Personen), eine Kante je Import-Paar mit der Zahl
 * der Personen, die in beiden vorkommen. Dieselben Angaben stehen darunter
 * als Tabellen — das Bild ist nur die Veranschaulichung.
 *
 * Lädt neu, sobald „Importe verbinden“ fertig zusammengeführt hat (Ereignis
 * `origin-changed`).
 */
export function OriginOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Overview>("/api/origin/overview");
    if (res.ok) setData(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("origin-changed", on);
    return () => window.removeEventListener("origin-changed", on);
  }, [load]);

  const nodes = data?.nodes ?? [];
  const imports = nodes.filter((n) => !n.manual);
  const pos = place(nodes.length);
  const at = new Map(nodes.map((n, i) => [n.key, pos[i]]));
  const max = Math.max(1, ...nodes.map((n) => n.persons));
  const radius = (persons: number) => 20 + 24 * Math.sqrt(persons / max);
  const maxEdge = Math.max(1, ...(data?.edges ?? []).map((e) => e.persons));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const summary = data
    ? `${plural(imports.length, "Import", "Importe")}, ${plural(data.total, "Person", "Personen")}, davon ${data.connecting} in mehreren Importen.`
    : "";

  return (
    <section className="card space-y-3 p-4" aria-labelledby="origin-overview-h" data-testid="origin-overview">
      <div>
        <h2 id="origin-overview-h" className="section-title">
          Übersicht: Importe und ihre Verbindungen
        </h2>
        <p className="mt-1 max-w-2xl text-sm muted">
          Jeder Kreis ist ein Import. Die Zahl an einer Linie nennt die <strong>Verbindungspersonen</strong>: Personen, die
          schon in beiden Importen vorkommen — also bereits zusammengeführt sind. Ohne Linie hängen zwei Importe noch nicht
          zusammen.
        </p>
      </div>
      {error && (
        <p role="alert" className="alert-error text-sm">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm muted">Lädt …</p>}
      {data && nodes.length === 0 && <p className="text-sm muted">Noch keine Personen.</p>}
      {data && nodes.length > 0 && (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Importe als Kreise. ${summary} Die Zahlen stehen in den Tabellen darunter.`}
            data-testid="origin-overview-graph"
            className="mx-auto block h-auto w-full max-w-xl text-stone-700 dark:text-stone-200"
          >
            {data.edges.map((e) => {
              const a = at.get(e.a)!;
              const b = at.get(e.b)!;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const label = String(e.persons);
              const w = 14 + label.length * 8;
              return (
                <g key={`${e.a}|${e.b}`} data-testid="origin-edge" data-edge={`${e.a}-${e.b}`} data-persons={e.persons}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.55" strokeWidth={1.5 + 4.5 * (e.persons / maxEdge)} strokeLinecap="round" />
                  <rect x={mx - w / 2} y={my - 10} width={w} height={20} rx={10} className="fill-white stroke-stone-400 dark:fill-stone-900 dark:stroke-stone-500" />
                  <text x={mx} y={my + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">
                    {label}
                  </text>
                </g>
              );
            })}
            {nodes.map((n) => {
              const p = at.get(n.key)!;
              const r = radius(n.persons);
              return (
                <g key={n.key} data-testid="origin-node" data-origin={n.key} data-persons={n.persons}>
                  <title>{`${originText(n)} — ${plural(n.persons, "Person", "Personen")}`}</title>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={n.color ?? "transparent"}
                    stroke="currentColor"
                    strokeOpacity={n.manual ? 0.9 : 0.45}
                    strokeWidth={n.manual ? 1.5 : 1}
                    strokeDasharray={n.manual ? "5 4" : undefined}
                    className={n.color || n.manual ? undefined : "fill-stone-300"}
                  />
                  <text x={p.x} y={p.y + 2} textAnchor="middle" fontSize="17" fontWeight="700" fill={n.fg ?? "currentColor"}>
                    {n.letter}
                  </text>
                  <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={n.fg ?? "currentColor"}>
                    {n.persons}
                  </text>
                  <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize="11.5" fill="currentColor">
                    {short(n.name)}
                  </text>
                </g>
              );
            })}
          </svg>

          <p className="text-sm" data-testid="origin-overview-summary">
            {summary}
          </p>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <table className="w-full" data-testid="origin-overview-nodes">
              <caption className="eyebrow mb-1 text-left">Importe</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Import</th>
                  <th scope="col">Personen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {nodes.map((n) => (
                  <tr key={n.key} data-origin={n.key}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden>
                          <OriginChip entry={n} size="md" />
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="sr-only">{n.manual ? "" : `Import ${n.letter}: `}</span>
                          {n.name}
                        </span>
                      </span>
                    </th>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">{plural(n.persons, "Person", "Personen")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full self-start" data-testid="origin-overview-edges">
              <caption className="eyebrow mb-1 text-left">Verbindungspersonen</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Importe</th>
                  <th scope="col">Personen in beiden</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {data.edges.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-1 muted">
                      {imports.length > 1 ? "Noch keine — die Importe hängen bisher nicht zusammen." : "Erst ab zwei Importen."}
                    </td>
                  </tr>
                ) : (
                  data.edges.map((e) => (
                    <tr key={`${e.a}|${e.b}`} data-edge={`${e.a}-${e.b}`}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span aria-hidden className="inline-flex items-center gap-1">
                            <OriginChip entry={byKey.get(e.a)!} size="md" />
                            <span>↔</span>
                            <OriginChip entry={byKey.get(e.b)!} size="md" />
                          </span>
                          <span className="min-w-0 break-words">
                            {byKey.get(e.a)!.name} und {byKey.get(e.b)!.name}
                          </span>
                        </span>
                      </th>
                      <td className="whitespace-nowrap py-1 text-right tabular-nums">{plural(e.persons, "Person", "Personen")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
