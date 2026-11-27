/**
 * Ringdiagramm als eigenes Inline-SVG — keine Diagramm-Bibliothek, kein
 * Skript, nichts, was die Content-Security-Policy (lib/csp.ts) berührt.
 * Allgemein gehalten: Stücke mit Bezeichnung, Wert und Farbe (z.B.
 * `var(--chart-1)` aus app/globals.css). Ohne Hooks, also in Server- und
 * Client-Komponenten nutzbar.
 *
 * Farbe ist nie die einzige Information: Das SVG trägt eine Beschreibung
 * aller Stücke für Screenreader, jedes Stück einen Tooltip, und
 * `DonutLegend` zeigt dieselben Stücke als Tabelle mit Bezeichnung und Wert.
 */

export type DonutSlice = {
  key: string;
  label: string;
  /** Beliebige nichtnegative Größe; der Anteil ergibt sich aus der Summe. */
  value: number;
  /** CSS-Farbe, z.B. `var(--chart-1)`. */
  color: string;
  /** Text des Werts für Tooltip und Beschreibung, z.B. „25 %“. */
  valueText?: string;
};

const TAU = Math.PI * 2;

function point(r: number, angle: number): string {
  // 0 = oben, im Uhrzeigersinn.
  const x = 50 + r * Math.sin(angle);
  const y = 50 - r * Math.cos(angle);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

/** Pfad eines Ringstücks von `a0` bis `a1` (Bogenmaß) zwischen innerem und äußerem Radius. */
export function ringSegmentPath(a0: number, a1: number, outer: number, inner: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M${point(outer, a0)}`,
    `A${outer} ${outer} 0 ${large} 1 ${point(outer, a1)}`,
    `L${point(inner, a1)}`,
    `A${inner} ${inner} 0 ${large} 0 ${point(inner, a0)}`,
    "Z",
  ].join("");
}

export function DonutChart({
  slices,
  label,
  size = 200,
  thickness = 0.38,
  center,
  className = "",
  testId,
}: {
  slices: DonutSlice[];
  /** Kurzer Titel des Diagramms für Screenreader („Wurzeln nach Land“). */
  label: string;
  /** Kantenlänge in Pixeln (das SVG schrumpft mit, wenn der Platz fehlt). */
  size?: number;
  /** Ringbreite als Anteil des Radius (0…1). */
  thickness?: number;
  /** Text in der Mitte, z.B. Zahl und kleine Unterzeile. */
  center?: { value: string; caption?: string };
  className?: string;
  testId?: string;
}) {
  const outer = 48;
  const inner = outer * (1 - Math.min(0.9, Math.max(0.1, thickness)));
  const parts = slices.filter((s) => s.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const describe = (s: DonutSlice) => (s.valueText ? `${s.label}: ${s.valueText}` : s.label);
  const ariaLabel = parts.length ? `${label}: ${parts.map(describe).join(", ")}` : `${label}: keine Angaben`;

  let angle = 0;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className={`h-auto max-w-full ${className}`}
      data-testid={testId}
    >
      {total <= 0 ? (
        <circle cx={50} cy={50} r={(outer + inner) / 2} fill="none" stroke="var(--chart-unknown)" strokeWidth={outer - inner} />
      ) : parts.length === 1 ? (
        <circle
          cx={50}
          cy={50}
          r={(outer + inner) / 2}
          fill="none"
          stroke={parts[0].color}
          strokeWidth={outer - inner}
          data-slice={parts[0].key}
        >
          <title>{describe(parts[0])}</title>
        </circle>
      ) : (
        parts.map((s) => {
          const a0 = angle;
          angle += (s.value / total) * TAU;
          return (
            <path
              key={s.key}
              d={ringSegmentPath(a0, angle, outer, inner)}
              fill={s.color}
              stroke="rgb(var(--surface))"
              strokeWidth={0.8}
              strokeLinejoin="round"
              data-slice={s.key}
            >
              <title>{describe(s)}</title>
            </path>
          );
        })
      )}
      {center && (
        <g aria-hidden="true" className="fill-stone-800 dark:fill-stone-100">
          <text x={50} y={center.caption ? 49 : 53} textAnchor="middle" fontSize={11} fontWeight={600}>
            {center.value}
          </text>
          {center.caption && (
            <text x={50} y={60} textAnchor="middle" fontSize={6.5} className="fill-stone-600 dark:fill-stone-400">
              {center.caption}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

/**
 * Legende als Tabelle: Farbfeld, Bezeichnung (optional mit Zusatzzeile) und
 * Wert — dieselben Stücke wie im Ring, damit nichts nur über Farbe zu
 * erkennen ist.
 */
export function DonutLegend({
  items,
  caption,
  valueHeader = "Anteil",
  testId,
}: {
  items: (Pick<DonutSlice, "key" | "label" | "color"> & { valueText: string; detail?: string })[];
  caption: string;
  valueHeader?: string;
  testId?: string;
}) {
  return (
    <table className="w-full text-sm" data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Bezeichnung</th>
          <th scope="col">{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.key} className="border-b border-stone-100 last:border-0 dark:border-stone-800" data-testid="donut-legend-row">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              <span className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-stone-900/10 dark:ring-white/10"
                  style={{ background: it.color }}
                />
                <span className="min-w-0">
                  <span className="block">{it.label}</span>
                  {it.detail && <span className="block text-xs muted">{it.detail}</span>}
                </span>
              </span>
            </th>
            <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{it.valueText}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
