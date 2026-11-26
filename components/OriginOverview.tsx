"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { originText } from "@/lib/origin";
import { plural } from "@/lib/plural";
import type { OriginOverview as Overview } from "@/lib/services/origin";
import { apiFetch } from "./api-client";
import { OriginChip } from "./OriginChips";

/** Breite des Bildes auf breiten Bildschirmen; schmaler wird es mitgemessen. */
const WIDE = 520;
const NARROW_MIN = 300;

/**
 * Kreise gleichmäßig auf einer Ellipse; ein einzelner in der Mitte. Seitlich
 * bleibt Platz für die Beschriftung unter den äußeren Kreisen.
 */
function place(n: number, w: number, h: number): { x: number; y: number }[] {
  if (n === 1) return [{ x: w / 2, y: h / 2 - 10 }];
  const rx = w / 2 - (w < 420 ? 62 : 95);
  // Schmal stehen die Namen der oberen Kreise über ihnen — dafür mehr Rand.
  const ry = h / 2 - (w < 420 ? 95 : 62);
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - (n === 2 ? Math.PI : Math.PI / 2);
    return { x: w / 2 + Math.cos(a) * rx, y: h / 2 - 12 + Math.sin(a) * ry };
  });
}

/**
 * Name in höchstens zwei Zeilen zu je etwa `max` Zeichen, nach Wörtern
 * umbrochen; was dann nicht passt, endet mit „…“.
 */
export function labelLines(name: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  // Auch nach Bindestrichen umbrechen („Muster-“ / „hausen“).
  const words = name.split(/\s+/).filter(Boolean).flatMap((w) => w.split(/(?<=-)(?=.)/));
  const join = (a: string, b: string) => (a ? (a.endsWith("-") ? `${a}${b}` : `${a} ${b}`) : b);
  for (const word of words) {
    const next = join(line, word);
    if (next.length <= max || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const cut = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  if (lines.length <= 2) return lines.map(cut);
  return [cut(lines[0]), cut(lines.slice(1).reduce(join))];
}

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
  // Das Bild wird in der Breite seines Platzes gezeichnet (nicht verkleinert):
  // so bleiben Beschriftungen auch auf dem Telefon lesbar groß.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(WIDE);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setW(Math.round(Math.max(NARROW_MIN, Math.min(WIDE, el.clientWidth || WIDE))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  const narrow = W < 420;
  const H = narrow ? 350 : 300;

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
  const pos = place(nodes.length, W, H);
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
          <div ref={boxRef}>
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
              return (
                <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.55" strokeWidth={1.5 + 4.5 * (e.persons / maxEdge)} strokeLinecap="round" />
              );
            })}
            {nodes.map((n) => {
              const p = at.get(n.key)!;
              const r = radius(n.persons);
              const lines = labelLines(n.name, narrow ? 20 : 24);
              // Schmal: Namen oberer Kreise darüber, sonst liefen sie in die Linien nach unten.
              const above = narrow && nodes.length > 1 && p.y < H / 2 - 30;
              const labelY = above ? p.y - r - 8 - (lines.length - 1) * 15 : p.y + r + 15;
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
                  <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill={n.fg ?? "currentColor"}>
                    {n.persons}
                  </text>
                  {/* Hof in Hintergrundfarbe: Linien zu anderen Kreisen laufen nicht durch den Namen. */}
                  <text
                    x={p.x}
                    y={labelY}
                    textAnchor="middle"
                    fontSize="12.5"
                    fill="currentColor"
                    strokeWidth={4}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    className="stroke-white dark:stroke-stone-900"
                  >
                    {lines.map((line, i) => (
                      <tspan key={i} x={p.x} dy={i === 0 ? 0 : 15}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
            {/* Zahlen an den Linien zuletzt: sie bleiben lesbar, auch wo ein Name heranreicht. */}
            {data.edges.map((e) => {
              const a = at.get(e.a)!;
              const b = at.get(e.b)!;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const label = String(e.persons);
              const w = 14 + label.length * 8;
              return (
                <g key={`${e.a}|${e.b}`} data-testid="origin-edge" data-edge={`${e.a}-${e.b}`} data-persons={e.persons}>
                  <rect x={mx - w / 2} y={my - 10} width={w} height={20} rx={10} className="fill-white stroke-stone-400 dark:fill-stone-900 dark:stroke-stone-500" />
                  <text x={mx} y={my + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
          </div>

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
