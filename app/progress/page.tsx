import Link from "next/link";
import { cookies } from "next/headers";

import { requireScope } from "@/lib/session";
import { REFERENCE_COOKIE, REFERENCE_SELF, type LineKey } from "@/lib/reference";
import {
  PROGRESS_DEFAULT_GENERATION,
  PROGRESS_GENERATION_PARAM,
  PROGRESS_MAX_GENERATION,
  PROGRESS_MIN_GENERATION,
  PROGRESS_SHOWN_SUGGESTIONS,
  QUALITY_POINTS,
  type PlaceCounts,
  type QualitySummary,
  type Suggestion,
} from "@/lib/research-progress";
import { getResearchProgress } from "@/lib/services/research-progress";
import { HelpLink } from "@/components/HelpLink";
import { MapPersonChooser } from "@/components/MapPersonChooser";
import { LineCode } from "@/components/ReferenceLines";
import { EmptyHint, formatCount, KeyFigure, StatsCard } from "@/components/StatisticsCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forschungs-Fortschritt" };

// Bewusst eine eigene Route ohne loading.tsx (nicht unter /research): Der
// Wechsel der Tiefe oder der Person ändert nur Suchparameter, und eine
// Ladeanzeige ließe solche Wechsel hängen (siehe /statistics, /kinship).

type Params = { person?: string | string[]; generationen?: string | string[] };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** „50 %“; ein Anteil unter einem halben Prozent heißt „unter 1 %“. */
function percent(part: number, whole: number): string {
  if (whole <= 0) return "0 %";
  const p = Math.round((part / whole) * 100);
  return p === 0 && part > 0 ? "unter 1 %" : `${p} %`;
}

/** „3 von 6 Personen (50 %)“. */
const shareText = (part: number, whole: number) =>
  `${formatCount(part)} von ${formatCount(whole)} ${whole === 1 ? "Person" : "Personen"} (${percent(part, whole)})`;

const lineColor = (k: LineKey) => `var(--line-${k.toLowerCase()})`;

/**
 * Balken „gefunden | nicht freigegeben | fehlt“ — nur Zierde, die Zahlen
 * stehen daneben als Text.
 */
function PlacesBar({ counts, color }: { counts: PlaceCounts; color?: string }) {
  const w = (n: number) => `${(n / Math.max(1, counts.places)) * 100}%`;
  return (
    <span aria-hidden className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      <span
        className={color ? "block h-full" : "block h-full bg-accent-600 dark:bg-accent-400"}
        style={color ? { width: w(counts.found), background: color } : { width: w(counts.found) }}
      />
      {counts.restricted > 0 && (
        <span className="block h-full bg-stone-400 dark:bg-stone-500" style={{ width: w(counts.restricted) }} />
      )}
    </span>
  );
}

/** „gefunden 6 von 8“ und, wenn vorhanden, „2 nicht freigegeben“ / „2 Personen doppelt“. */
function CountsText({ counts }: { counts: PlaceCounts }) {
  const extras: string[] = [];
  if (counts.restricted > 0) extras.push(`${formatCount(counts.restricted)} nicht freigegeben`);
  extras.push(`${formatCount(counts.missing)} fehlen`);
  if (counts.distinct < counts.found) {
    extras.push(`${formatCount(counts.distinct)} verschiedene Personen (Ahnenschwund)`);
  }
  return (
    <>
      <span className="shrink-0 font-medium tabular-nums" data-testid="progress-found">
        {formatCount(counts.found)} von {formatCount(counts.places)}
      </span>
      <span className="sr-only">gefunden; </span>
      <span className="block w-full text-xs muted" data-testid="progress-counts-extra">
        {extras.join(" · ")}
      </span>
    </>
  );
}

function QualityText({ q }: { q: QualitySummary }) {
  if (q.persons === 0) return <span className="block text-xs muted">Noch keine Person gefunden.</span>;
  return (
    <span className="block text-xs" data-testid="progress-quality">
      <span className="block">Daten vollständig: {shareText(q.complete, q.persons)}</span>
      <span className="block">Mit Beleg: {shareText(q.sourced, q.persons)}</span>
      <span className="block muted">
        Punkte: {formatCount(q.points)} von {formatCount(q.maxPoints)} ({percent(q.points, q.maxPoints)})
      </span>
    </span>
  );
}

function SuggestionItem({ s }: { s: Suggestion }) {
  return (
    <li>
      <Link
        href={`/people/${s.personId}`}
        className="flex min-h-11 flex-col justify-center rounded-md px-2 py-2 hover:bg-stone-100 dark:hover:bg-stone-800"
        data-testid="progress-suggestion"
        data-kind={s.kind}
      >
        <span className="font-medium">{s.title}</span>
        {s.detail && <span className="text-xs muted">{s.detail}</span>}
      </Link>
    </li>
  );
}

const QUALITY_RULES: { label: string; points: string }[] = [
  { label: "Geburtsdatum", points: `${QUALITY_POINTS.birthDate} genau (Tag), 1 ungenau (nur Jahr, „um“ …), 0 fehlt` },
  { label: "Geburtsort", points: String(QUALITY_POINTS.birthPlace) },
  { label: "Sterbedatum (nur Verstorbene)", points: String(QUALITY_POINTS.deathDate) },
  { label: "Sterbeort (nur Verstorbene)", points: String(QUALITY_POINTS.deathPlace) },
  { label: "Beide Eltern erfasst", points: String(QUALITY_POINTS.parents) },
  { label: "Geburt belegt", points: String(QUALITY_POINTS.birthEvidence) },
  { label: "Tod belegt (nur Verstorbene)", points: String(QUALITY_POINTS.deathEvidence) },
];

/**
 * Forschungs-Fortschritt: Wie vollständig sind die Vorfahren der
 * Ausgangsperson erforscht — je Generation und je Großeltern-Linie — und wo
 * lohnt sich das Weitersuchen? Adresse: /progress?person=<id>&generationen=<4…10>.
 * Rechnung: lib/research-progress.ts, Laden und Rechte:
 * lib/services/research-progress.ts.
 */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const jar = await cookies();
  const personRaw = first(params.person);
  const page = await getResearchProgress(scope, {
    person: personRaw,
    cookie: jar.get(REFERENCE_COOKIE)?.value ?? null,
    generations: first(params.generationen),
  });
  const n = page.generations;
  const root = page.root;
  const r = page.progress;
  // Die Person bleibt nur in der Adresse, wenn sie ausdrücklich gewählt war
  // (auch die eigene oder „ich“ — sonst gälte beim Umschalten wieder das Cookie).
  const personParam = root && personRaw && (personRaw === root.id || personRaw === REFERENCE_SELF) ? personRaw : null;

  const hrefFor = (next: { generations?: number; person?: string | null }) => {
    const sp = new URLSearchParams();
    const person = next.person === undefined ? personParam : next.person;
    if (person) sp.set("person", person);
    const g = next.generations ?? n;
    if (g !== PROGRESS_DEFAULT_GENERATION) sp.set(PROGRESS_GENERATION_PARAM, String(g));
    const s = sp.toString();
    return s ? `/progress?${s}` : "/progress";
  };
  const chooserTarget = n !== PROGRESS_DEFAULT_GENERATION ? `/progress?${PROGRESS_GENERATION_PARAM}=${n}` : "/progress";

  const depths = Array.from(
    { length: PROGRESS_MAX_GENERATION - PROGRESS_MIN_GENERATION + 1 },
    (_, i) => PROGRESS_MIN_GENERATION + i,
  );
  const shown = r?.suggestions.slice(0, PROGRESS_SHOWN_SUGGESTIONS) ?? [];
  const more = r?.suggestions.slice(PROGRESS_SHOWN_SUGGESTIONS) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Forschung</p>
        <h1 className="page-title">Forschungs-Fortschritt</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Wie vollständig sind die Vorfahren erforscht — je Generation und je Großeltern-Linie? Und wo lohnt sich
          das Weitersuchen am meisten? Gezählt werden nur Personen, die für dich freigegeben sind.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <HelpLink to="fortschritt" />
          <Link href="/research" className="btn-link inline-flex min-h-11 items-center text-sm" data-testid="progress-to-research">
            <span aria-hidden className="mr-1">←</span> Recherche
          </Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" data-testid="progress-controls">
        <div className="min-w-0">
          <span className="muted">Ausgangsperson: </span>
          {root ? (
            <>
              <Link
                href={`/people/${root.id}`}
                className="font-medium text-accent-700 hover:underline dark:text-accent-300"
                data-testid="progress-person"
              >
                {root.name}
              </Link>
              {root.lifespan && <span className="muted"> ({root.lifespan})</span>}
              {root.isSelf && <span className="muted"> · ich</span>}
              {!root.isSelf && root.source !== "param" && <span className="muted"> · Bezugsperson</span>}
            </>
          ) : (
            <span className="muted" data-testid="progress-person">
              keine
            </span>
          )}
        </div>
        <MapPersonChooser target={chooserTarget} label={root ? "Andere Person …" : "Person wählen …"} testId="progress-choose-person" />
        {personParam && (
          <Link href={hrefFor({ person: null })} className="btn-link inline-flex min-h-11 items-center" data-testid="progress-back">
            zurück zur Bezugsperson
          </Link>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <span className="muted" id="progress-depth-label">
            Generationen:
          </span>
          <div role="group" aria-labelledby="progress-depth-label" className="flex flex-wrap gap-1" data-testid="progress-depth">
            {depths.map((d) => (
              <Link
                key={d}
                href={hrefFor({ generations: d })}
                scroll={false}
                aria-current={d === n ? "true" : undefined}
                aria-label={`${d} Generationen`}
                data-testid={`progress-depth-${d}`}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-sm tabular-nums transition sm:min-h-9 sm:min-w-9 ${
                  d === n
                    ? "border-accent-700 bg-accent-700 text-white dark:border-accent-300 dark:bg-accent-300 dark:text-stone-950"
                    : "border-stone-300 bg-surface hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                }`}
              >
                {d}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {page.notFound && (
        <p className="alert-warning" data-testid="progress-notfound">
          Die gewählte Person wurde nicht gefunden.{" "}
          {root ? "Gezeigt wird deshalb deine Bezugsperson." : "Bitte wähle eine andere Person."}
        </p>
      )}

      {!root || !r ? (
        <div className="card space-y-2 px-6 py-8 text-center" data-testid="progress-no-root">
          <p className="font-serif text-lg">Von wem aus soll gezählt werden?</p>
          <p className="mx-auto max-w-xl text-sm muted">
            Wähle oben mit <strong>Person wählen …</strong> eine Person — oder öffne deine eigene Personenseite und
            klicke dort auf <strong>Das bin ich</strong>. Dann zeigt diese Seite immer gleich deine Vorfahren.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Überblick" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="progress-key-figures">
            <KeyFigure
              label="Vorfahren gefunden"
              value={`${formatCount(r.total.found)} von ${formatCount(r.total.places)}`}
              sub={`bis zur ${n}. Generation (${percent(r.total.found, r.total.places)})`}
              testId="progress-total"
            />
            <KeyFigure
              label="Daten vollständig"
              value={percent(r.quality.complete, r.quality.persons)}
              sub={`${formatCount(r.quality.complete)} von ${formatCount(r.quality.persons)} gefundenen Personen`}
              testId="progress-complete"
            />
            <KeyFigure
              label="Mit Beleg"
              value={percent(r.quality.sourced, r.quality.persons)}
              sub={`${formatCount(r.quality.sourced)} von ${formatCount(r.quality.persons)} gefundenen Personen`}
              testId="progress-sourced"
            />
            <KeyFigure
              label="Nicht freigegeben"
              value={formatCount(r.total.restricted)}
              sub={r.total.restricted > 0 ? "Plätze — dort wird nicht weitergezählt" : "alle Plätze einsehbar"}
              testId="progress-restricted"
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <StatsCard
              id="progress-generations"
              title="Vollständigkeit je Generation"
              testId="progress-generations"
              basis={`gefundene Vorfahren je Generation; jede Generation hat doppelt so viele Plätze wie die vorige`}
            >
              <ul className="space-y-4">
                {r.byGeneration.map((g) => (
                  <li key={g.generation} data-testid="progress-generation-row" data-generation={g.generation}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 font-medium">
                        {g.label} <span className="text-xs font-normal muted">· {g.generation}. Generation</span>
                      </span>
                      <CountsText counts={g} />
                    </div>
                    <div className="mt-1">
                      <PlacesBar counts={g} />
                    </div>
                    <div className="mt-1">
                      <QualityText q={g.quality} />
                    </div>
                  </li>
                ))}
              </ul>
            </StatsCard>

            <StatsCard
              id="progress-lines"
              title="Die vier Großeltern-Linien"
              testId="progress-lines"
              basis={`Vorfahren ab den Großeltern bis zur ${n}. Generation, getrennt nach den vier Großeltern — Farben wie im Stammbaum`}
            >
              <ul className="space-y-4">
                {r.lines.map((l) => (
                  <li key={l.line} data-testid="progress-line-row" data-line={l.line}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <LineCode line={l.line} />
                        <span className="min-w-0">
                          <span className="font-medium">{l.label}</span>
                          <span className="block text-xs muted" data-testid="progress-line-grandparent">
                            {l.grandparent?.kind === "person" ? (
                              <Link href={`/people/${l.grandparent.id}`} className="hover:underline">
                                {l.grandparent.name}
                              </Link>
                            ) : l.grandparent?.kind === "restricted" ? (
                              "nicht freigegeben"
                            ) : (
                              "nicht erfasst"
                            )}
                          </span>
                        </span>
                      </span>
                      <CountsText counts={l} />
                    </div>
                    <div className="mt-1">
                      <PlacesBar counts={l} color={lineColor(l.line)} />
                    </div>
                    <div className="mt-1">
                      <QualityText q={l.quality} />
                    </div>
                  </li>
                ))}
              </ul>
            </StatsCard>
          </div>

          <section aria-labelledby="progress-suggestions-h" className="card space-y-3 p-5" data-testid="progress-suggestions">
            <div>
              <h2 id="progress-suggestions-h" className="section-title">
                Hier lohnt sich die Suche
              </h2>
              <p className="text-xs muted">
                Nähere Generationen zuerst; in einer Generation zuerst fehlende Eltern (sie schneiden eine ganze Linie
                ab), dann fehlende Daten, dann Belege — und jeweils zuerst dort, wo Geburtsjahr und Geburtsort schon
                bekannt sind.
              </p>
            </div>
            {shown.length === 0 ? (
              <EmptyHint>Keine offenen Punkte bis zur {n}. Generation — vorbildlich.</EmptyHint>
            ) : (
              <>
                <ol className="space-y-1">
                  {shown.map((s) => (
                    <SuggestionItem key={`${s.kind}:${s.personId}`} s={s} />
                  ))}
                </ol>
                {more.length > 0 && (
                  <details className="group" data-testid="progress-more">
                    <summary className="btn-link inline-flex min-h-11 cursor-pointer list-none items-center">
                      Weitere {formatCount(more.length)} anzeigen
                    </summary>
                    <ol className="space-y-1" start={shown.length + 1}>
                      {more.map((s) => (
                        <SuggestionItem key={`${s.kind}:${s.personId}`} s={s} />
                      ))}
                    </ol>
                  </details>
                )}
                {r.suggestionsTotal > r.suggestions.length && (
                  <p className="text-xs muted">
                    … und {formatCount(r.suggestionsTotal - r.suggestions.length)} weitere, entferntere Punkte.
                  </p>
                )}
              </>
            )}
          </section>

          <details className="card p-3 text-sm" data-testid="progress-rules">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">Wie wird gezählt?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Plätze:</strong> Die Eltern sind die 1. Generation mit 2 Plätzen, die Großeltern die 2. mit 4,
                die Urgroßeltern die 3. mit 8 — jede Generation doppelt so viele. Es zählen nur leibliche Eltern.
                Kommt ein Vorfahr mehrfach vor (Ahnenschwund), zählt er auf jedem seiner Plätze.
              </li>
              <li>
                <strong>Nicht freigegeben</strong> ist ein Vorfahr, den du nicht sehen darfst, und jeder Platz
                dahinter. Diese Plätze zählen weder als gefunden noch als fehlend.
              </li>
              <li>
                <strong>Verstorben</strong> ist, wer ein Sterbedatum oder einen Sterbeort hat — oder vermutlich: wer
                laut eigenem Geburtsdatum oder dem eines Kindes oder Enkels in der Linie über 100 Jahre alt wäre. Nur
                bei Verstorbenen zählen Sterbedatum, Sterbeort und der Beleg des Todes.
              </li>
              <li>
                <strong>Daten vollständig:</strong> Geburtsdatum (auch ungenau), Geburtsort und beide Eltern sind
                erfasst, bei Verstorbenen auch Sterbedatum und Sterbeort. <strong>Mit Beleg:</strong> Geburt — und bei
                Verstorbenen der Tod — ist durch eine Quelle belegt. Ein fremder Stammbaum (etwa bei einem
                Online-Anbieter) ist nur ein Hinweis und zählt nicht als Beleg.
              </li>
            </ul>
            <table className="mt-3 w-full table-fixed text-sm" data-testid="progress-points">
              <caption className="mb-1 text-left font-medium">Punkte je Person</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Angabe</th>
                  <th scope="col">Punkte</th>
                </tr>
              </thead>
              <tbody>
                {QUALITY_RULES.map((q) => (
                  <tr key={q.label} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {q.label}
                    </th>
                    <td className="py-1 text-right">{q.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2">
              <HelpLink to="fortschritt" label="Ausführlich mit Beispiel: wie der Fortschritt zählt" />
            </p>
          </details>
        </>
      )}
    </div>
  );
}
