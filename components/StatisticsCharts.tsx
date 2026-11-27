import type { AverageRow, Bar } from "@/lib/statistics";

/**
 * Bausteine der Seite „Statistik“ (app/statistics/page.tsx): Karte mit
 * Überschrift und Grundlage, waagerechte Balken und Durchschnittstabelle.
 * Reines HTML/CSS ohne Hooks und ohne Skript — keine Diagramm-Bibliothek,
 * nichts, was die Content-Security-Policy berührt (Balkenbreite als
 * `style`-Attribut, das erlaubt lib/csp.ts).
 *
 * Jede Zahl steht als Text da; der Balken ist nur Zierde (aria-hidden).
 * Tabellen mit fester Spaltenaufteilung, damit nichts bei 390 px Breite
 * über den Rand ragt.
 */

const nf = new Intl.NumberFormat("de-DE");
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ganze Zahl mit Tausenderpunkt: „1.240“. */
export const formatCount = (n: number) => nf.format(n);
/** Durchschnitt mit einer Nachkommastelle: „2,7“. */
export const formatAverage = (n: number) => nf1.format(n);

/** „aus 812 von 1.240 Personen mit Geburtsort“. */
export function basisText(count: number, total: number, what: string): string {
  return `aus ${formatCount(count)} von ${formatCount(total)} Personen ${what}`;
}

export function StatsCard({
  id,
  title,
  basis,
  testId,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** Grundlage der Auswertung, z.B. „aus 812 von 1.240 Personen mit Geburtsort“. */
  basis: string;
  testId: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="card min-w-0 space-y-4 p-5" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="section-title">
            {title}
          </h2>
          <p className="text-xs muted" data-testid="stats-basis">
            {basis}
          </p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Hinweis statt eines leeren Diagramms. */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-stone-100 px-3 py-4 text-center text-sm muted dark:bg-stone-800/60" data-testid="stats-empty">
      {children}
    </p>
  );
}

/**
 * Waagerechte Balken als Tabelle: Bezeichnung, Balken, Anzahl. Die längste
 * Zeile füllt die Breite; Nullzeilen bleiben sichtbar (ehrliche Lücken).
 */
export function BarList({
  bars,
  caption,
  valueHeader = "Anzahl",
  labelHeader = "Bezeichnung",
  wideLabels = false,
  testId,
}: {
  bars: Bar[];
  caption: string;
  valueHeader?: string;
  labelHeader?: string;
  /** Breitere Namensspalte (Namen statt Zeiträume). */
  wideLabels?: boolean;
  testId?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <table className="w-full table-fixed text-sm" data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className={wideLabels ? "w-[38%] sm:w-[34%]" : "w-[30%] sm:w-[24%]"} />
        <col />
        <col className="w-16" />
      </colgroup>
      <thead className="sr-only">
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">Balken</th>
          <th scope="col">{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {bars.map((b) => (
          <tr key={b.key} data-testid="stats-bar-row">
            <th scope="row" className="truncate py-1 pr-2 text-left font-normal" title={b.label}>
              {b.label}
            </th>
            <td className="py-1" aria-hidden="true">
              <span className="block h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                <span
                  className="block h-full rounded-full bg-accent-600 dark:bg-accent-400"
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </span>
            </td>
            <td className="py-1 pl-2 text-right tabular-nums">{formatCount(b.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Durchschnitte je Zeile (Jahrhundert, Geschlecht) mit der Zahl der
 * Personen dahinter. Zu kleine Grundlagen: „zu wenige“ statt eines Werts.
 */
export function AverageTable({
  rows,
  caption,
  labelHeader,
  averageHeader,
  unit,
  testId,
}: {
  rows: AverageRow[];
  caption: string;
  labelHeader: string;
  averageHeader: string;
  /** Einheit hinter dem Durchschnitt, z.B. „Jahre“. */
  unit?: string;
  testId?: string;
}) {
  return (
    <table className="w-full table-fixed text-sm" data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-stone-200 text-left text-xs muted dark:border-stone-800">
          <th scope="col" className="py-1 pr-2 font-medium">
            {labelHeader}
          </th>
          <th scope="col" className="py-1 pr-2 text-right font-medium">
            {averageHeader}
          </th>
          <th scope="col" className="w-20 py-1 text-right font-medium">
            Personen
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-stone-100 last:border-0 dark:border-stone-800" data-testid="stats-average-row">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              {r.label}
            </th>
            <td className="py-1.5 pr-2 text-right tabular-nums">
              {r.average === null ? (
                <span className="text-xs muted">zu wenige</span>
              ) : (
                `${formatAverage(r.average)}${unit ? ` ${unit}` : ""}`
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums">{formatCount(r.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Kleine Kennzahl oben auf der Seite. */
export function KeyFigure({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="card min-w-0 p-4" data-testid={testId}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs muted">{sub}</p>}
    </div>
  );
}
