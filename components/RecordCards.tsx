import Link from "next/link";

import type { NameCell, NameRow, RecordEntry, RecordPart, RecordPlace } from "@/lib/records";
import { EmptyHint, formatCount } from "@/components/StatisticsCharts";

/**
 * Bausteine der Seite „Rekorde“ (app/records/page.tsx): Bestwert groß mit
 * den Personen als Links, darunter die Plätze 2–5, und die Tabelle der
 * häufigsten Vornamen je Jahrhundert. Reines HTML/CSS ohne Hooks und ohne
 * Skript (CSP); die Karte selbst ist `StatsCard` aus StatisticsCharts.
 */

/** Person als Link — unter md vergrößert der Innenabstand die Tippfläche (44 px), nicht die Zeilenhöhe. */
function PersonLink({ id, name, lifespan }: { id: string; name: string; lifespan: string }) {
  return (
    <Link
      href={`/people/${id}`}
      data-testid="records-person"
      title={lifespan || undefined}
      className="font-medium text-accent-700 underline decoration-accent-300 underline-offset-2 hover:decoration-current max-md:py-3 dark:text-accent-300 dark:decoration-accent-700"
    >
      {name}
    </Link>
  );
}

function Part({ part }: { part: RecordPart }) {
  return (
    <>
      {part.prefix && <span className="muted">{part.prefix} </span>}
      {part.persons.map((p, i) => (
        <span key={p.id}>
          {i > 0 && (i === part.persons.length - 1 ? " und " : ", ")}
          <PersonLink {...p} />
          {p.lifespan && <span className="text-xs muted"> ({p.lifespan})</span>}
        </span>
      ))}
    </>
  );
}

function EntryText({ entry }: { entry: RecordEntry }) {
  return (
    <>
      {entry.parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " "}
          <Part part={part} />
        </span>
      ))}
      {entry.detail && <span className="text-sm muted"> — {entry.detail}</span>}
      {entry.note && <span className="badge-alt ml-1 align-middle">{entry.note}</span>}
    </>
  );
}

const moreText = (n: number) => `und ${formatCount(n)} ${n === 1 ? "weiterer Eintrag" : "weitere Einträge"} mit demselben Wert`;

/** Bestwert groß, darunter die weiteren Plätze; Gleichstand = derselbe Platz. */
export function RecordPlaces({ places, empty }: { places: RecordPlace[]; empty: string }) {
  if (places.length === 0) return <EmptyHint>{empty}</EmptyHint>;
  const [best, ...rest] = places;
  return (
    <div className="space-y-3">
      <div data-testid="records-best">
        <p className="font-serif text-2xl font-semibold tabular-nums sm:text-3xl" data-testid="records-best-value">
          {best.entries[0].valueText}
        </p>
        <ul className="mt-1 space-y-1 leading-relaxed [overflow-wrap:anywhere]">
          {best.entries.map((e, i) => (
            <li key={i} data-testid="records-entry">
              <EntryText entry={e} />
            </li>
          ))}
        </ul>
        {best.more > 0 && <p className="mt-1 text-xs muted">{moreText(best.more)}</p>}
      </div>
      {rest.length > 0 && (
        <ol className="divide-y divide-stone-200/80 border-t border-stone-200/80 text-sm dark:divide-stone-800 dark:border-stone-800" aria-label="Weitere Plätze">
          {rest.map((place) => (
            <li key={place.rank} className="flex gap-3 py-2" data-testid="records-place">
              <span className="w-7 shrink-0 text-right tabular-nums muted">{place.rank}.</span>
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="font-semibold tabular-nums">{place.entries[0].valueText}</span>
                <ul className="leading-relaxed">
                  {place.entries.map((e, i) => (
                    <li key={i} data-testid="records-entry">
                      <EntryText entry={e} />
                    </li>
                  ))}
                </ul>
                {place.more > 0 && <p className="text-xs muted">{moreText(place.more)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NameCellText({ cell }: { cell: NameCell }) {
  if (!cell) return <span className="text-xs muted">zu wenige</span>;
  return (
    <>
      <span className="font-medium">{cell.names.join(", ")}</span>{" "}
      <span className="text-xs muted tabular-nums">({formatCount(cell.count)}×)</span>
    </>
  );
}

/** Häufigster Vorname je Geburtsjahrhundert — nur Summen, keine Personen. */
export function NamesByCentury({ rows }: { rows: NameRow[] }) {
  return (
    <table className="w-full table-fixed text-sm" data-testid="records-names-table">
      <caption className="sr-only">Häufigster Vorname je Geburtsjahrhundert</caption>
      <thead>
        <tr className="border-b border-stone-200 text-left text-xs muted dark:border-stone-800">
          <th scope="col" className="w-[30%] py-1 pr-2 font-medium">
            Geboren
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            Mädchen
          </th>
          <th scope="col" className="py-1 font-medium">
            Jungen
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-stone-100 align-top last:border-0 dark:border-stone-800" data-testid="records-names-row">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal tabular-nums">
              {r.label}
            </th>
            <td className="py-1.5 pr-2 [overflow-wrap:anywhere]">
              <NameCellText cell={r.female} />
            </td>
            <td className="py-1.5 [overflow-wrap:anywhere]">
              <NameCellText cell={r.male} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
