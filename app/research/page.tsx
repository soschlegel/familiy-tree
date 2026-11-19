import Link from "next/link";

import { requireScope } from "@/lib/session";
import {
  findDataGaps,
  findPossibleDuplicates,
  getStatistics,
  type DataGapKind,
  type PersonBrief,
} from "@/lib/services";
import { lifeSpan } from "@/lib/tree-layout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recherche" };

const GAP_LABEL: Record<DataGapKind, { title: string; hint: string }> = {
  missingBirthDate: { title: "Ohne Geburtsdatum", hint: "Kirchenbuch oder Standesamt fragen" },
  missingBirthPlace: { title: "Ohne Geburtsort", hint: "Oft in Heirats- oder Sterbeurkunden vermerkt" },
  missingParents: { title: "Ohne Eltern", hint: "Startpunkte für die nächste Generation" },
  missingGender: { title: "Geschlecht unbekannt", hint: "Meist schnell nachzutragen" },
  probablyDeceasedWithoutDeathDate: {
    title: "Vermutlich verstorben, ohne Sterbedatum",
    hint: "Über 100 Jahre alt laut Geburtsdatum",
  },
  deathPlaceWithoutDeathDate: { title: "Sterbeort ohne Sterbedatum", hint: "Angaben passen nicht zusammen" },
  implausibleParentAge: { title: "Unplausibles Elternalter", hint: "Meist ein Tippfehler im Jahr" },
  isolated: { title: "Ohne jede Beziehung", hint: "Noch nicht mit dem Baum verbunden" },
  withoutFamily: { title: "Ohne Familie", hint: "Nur für Administratoren sichtbar" },
  unsourced: {
    title: "Angaben ohne Beleg",
    hint: "Geburt oder Tod erfasst, aber keine Quelle dazu",
  },
};

const fullName = (p: PersonBrief) => [p.givenName, p.familyName].filter(Boolean).join(" ");

function PersonLink({ person, detail }: { person: PersonBrief; detail?: string }) {
  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
    >
      <span className="truncate font-medium">{fullName(person)}</span>
      <span className="ml-auto shrink-0 text-xs muted">{detail ?? lifeSpan(person)}</span>
    </Link>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs muted">{sub}</p>}
    </div>
  );
}

/**
 * Überblick für die Familienforschung: Bestand, Lücken und mögliche
 * Doppelerfassungen. Alle Zahlen beziehen sich nur auf Personen, die der
 * Benutzer sehen darf (die Dienste filtern entsprechend).
 */
export default async function ResearchPage() {
  const { scope } = await requireScope();
  const [stats, gaps, duplicates] = await Promise.all([
    getStatistics(scope),
    findDataGaps(scope, { limit: 25 }),
    findPossibleDuplicates(scope, { limit: 20 }),
  ]);

  const gapKinds = (Object.keys(GAP_LABEL) as DataGapKind[]).filter(
    (k) => gaps.counts[k] > 0,
  );
  const maxFamily = Math.max(1, ...stats.families.map((f) => f.personCount));
  const span =
    stats.birthYears.earliest && stats.birthYears.latest
      ? `${stats.birthYears.earliest} – ${stats.birthYears.latest}`
      : "—";

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Forschung</p>
        <h1 className="page-title">Recherche</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Was ist erfasst, wo fehlt noch etwas, und welche Einträge könnten
          dieselbe Person meinen? Alle Zahlen beziehen sich auf die für dich
          freigegebenen Familien.
        </p>
      </div>

      {stats.persons.total === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="font-serif text-lg">Noch nichts auszuwerten.</p>
          <p className="mt-1 text-sm muted">
            Sobald dir eine Familie freigegeben ist und Personen erfasst sind,
            erscheint hier der Überblick.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Bestand" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="research-stats">
            <Stat
              label="Personen"
              value={stats.persons.total}
              sub={`${stats.persons.living} lebend · ${stats.persons.deceased} verstorben`}
            />
            <Stat
              label="Beziehungen"
              value={stats.relationships.parentChild + stats.relationships.partnerships}
              sub={`${stats.relationships.parentChild} Eltern-Kind · ${stats.relationships.partnerships} Partnerschaften`}
            />
            <Stat label="Zeitraum" value={span} sub="Geburtsjahre" />
            <Stat label="Porträts & Bilder" value={stats.media.personImages} sub="an Personen" />
          </section>

          {stats.families.length > 1 && (
            <section aria-labelledby="fam-h" className="card p-5">
              <h2 id="fam-h" className="section-title mb-3">
                Personen je Familie
              </h2>
              <ul className="space-y-2">
                {stats.families.map((f) => (
                  <li key={f.id} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
                    <Link href={`/people?family=${f.id}`} className="truncate hover:underline">
                      {f.name}
                    </Link>
                    <span className="h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-accent-500 dark:bg-accent-400"
                        style={{ width: `${(f.personCount / maxFamily) * 100}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums">{f.personCount}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="gaps-h" className="space-y-3" data-testid="research-gaps">
              <div>
                <h2 id="gaps-h" className="section-title">
                  Datenlücken
                </h2>
                <p className="text-sm muted">Ansatzpunkte für die weitere Suche.</p>
              </div>
              {gapKinds.length === 0 ? (
                <p className="alert-success">Keine Lücken gefunden — vorbildlich.</p>
              ) : (
                <div className="space-y-2">
                  {gapKinds.map((k) => (
                    <details key={k} className="card group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{GAP_LABEL[k].title}</span>
                          <span className="block text-xs muted">{GAP_LABEL[k].hint}</span>
                        </span>
                        <span className="badge-accent tabular-nums">{gaps.counts[k]}</span>
                        <span aria-hidden className="text-xs muted transition group-open:rotate-90">▸</span>
                      </summary>
                      <ul className="border-t border-stone-200 p-2 dark:border-stone-800">
                        {gaps.items[k].map((item) => (
                          <li key={item.person.id}>
                            <PersonLink person={item.person} detail={item.detail} />
                          </li>
                        ))}
                        {gaps.counts[k] > gaps.items[k].length && (
                          <li className="px-2 py-1 text-xs muted">
                            … und {gaps.counts[k] - gaps.items[k].length} weitere
                          </li>
                        )}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="dup-h" className="space-y-3" data-testid="research-duplicates">
              <div>
                <h2 id="dup-h" className="section-title">
                  Mögliche Dubletten
                </h2>
                <p className="text-sm muted">
                  Ähnliche Namen und Geburtsjahre — bitte prüfen, ob es dieselbe Person ist.
                </p>
              </div>
              {duplicates.length === 0 ? (
                <p className="alert-success">Keine verdächtigen Doppelungen gefunden.</p>
              ) : (
                <ul className="space-y-2">
                  {duplicates.map((d) => (
                    <li key={`${d.a.id}-${d.b.id}`} className="card p-3">
                      <div className="flex items-center gap-2">
                        <span className="badge tabular-nums" title="Ähnlichkeit">
                          {Math.round(d.score * 100)} %
                        </span>
                        <span className="text-xs muted">{d.reasons.join(" · ")}</span>
                      </div>
                      <div className="mt-2 grid gap-1 sm:grid-cols-2">
                        <PersonLink person={d.a} />
                        <PersonLink person={d.b} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
