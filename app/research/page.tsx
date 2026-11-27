import Link from "next/link";

import { requireScope } from "@/lib/session";
import {
  findDataGaps,
  findInconsistencies,
  listDuplicateCandidates,
  getStatistics,
  RELATIONSHIP_GAP_KINDS,
  type DataGapKind,
  type PersonBrief,
  type PersonRef,
  type RelationshipGapKind,
} from "@/lib/services";
import type { ConsistencyKind } from "@/lib/consistency";
import { lifeSpan } from "@/lib/tree-layout";
import { DuplicateList } from "@/components/DuplicateList";

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

const REL_GAP_LABEL: Record<RelationshipGapKind, { title: string; hint: string }> = {
  marriageWithoutPlace: { title: "Ehe ohne Ort", hint: "Heiratsort steht oft im Kirchenbuch oder Familienbuch" },
  partnershipUnknownStatus: {
    title: "Ehestand unbekannt",
    hint: "Partnerschaft ohne Angabe, ob verheiratet — meist aus einem Import",
  },
};

/** Überschriften der Plausibilitätsprüfung (lib/consistency.ts). */
const CONSISTENCY_LABEL: Record<ConsistencyKind, string> = {
  deathBeforeBirth: "Tod vor der Geburt",
  parentTooYoung: "Elternteil sehr jung",
  parentTooOld: "Elternteil sehr alt",
  bornAfterParentDeath: "Geboren nach dem Tod eines Elternteils",
  lifespanOver110: "Über 110 Jahre alt",
  partnershipTooYoung: "Partnerschaft in sehr jungem Alter",
  partnershipAfterDeath: "Partnerschaft nach dem Tod",
  overlappingMarriages: "Sich überschneidende Ehen",
  burialBeforeDeath: "Beerdigung vor dem Tod",
  eventBeforeBirth: "Ereignis vor der Geburt",
  eventAfterDeath: "Ereignis nach dem Tod",
};

const fullName = (p: PersonBrief) => [p.givenName, p.familyName].filter(Boolean).join(" ");

function PersonLink({ person, detail }: { person: PersonBrief; detail?: string }) {
  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-stone-100 max-md:py-3 dark:hover:bg-stone-800"
    >
      <span className="truncate font-medium">{fullName(person)}</span>
      <span className="ml-auto shrink-0 text-xs muted">{detail ?? lifeSpan(person)}</span>
    </Link>
  );
}

/** Beide Partner einer Beziehungslücke; nicht freigegebene als Platzhalter. */
function PairLink({ persons, relationshipId, detail }: { persons: PersonRef[]; relationshipId: string; detail?: string }) {
  const first = persons.find((p): p is PersonBrief => !p.restricted);
  const names = persons.map((p) => (p.restricted ? "Nicht freigegeben" : fullName(p))).join(" & ");
  const body = (
    <>
      <span className="truncate font-medium">{names}</span>
      {detail && <span className="ml-auto shrink-0 text-xs muted">{detail}</span>}
    </>
  );
  return first ? (
    <Link
      href={`/people/${first.id}?rel=${relationshipId}`}
      className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-stone-100 max-md:py-3 dark:hover:bg-stone-800"
    >
      {body}
    </Link>
  ) : (
    <span className="flex items-baseline gap-2 px-2 py-1 text-sm">{body}</span>
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
  const [stats, gaps, duplicates, consistency] = await Promise.all([
    getStatistics(scope),
    findDataGaps(scope, { limit: 25 }),
    listDuplicateCandidates(scope, { limit: 20 }),
    findInconsistencies(scope, { limit: 200 }),
  ]);

  const gapKinds = (Object.keys(GAP_LABEL) as DataGapKind[]).filter(
    (k) => gaps.counts[k] > 0,
  );
  const relGapKinds = RELATIONSHIP_GAP_KINDS.filter((k) => gaps.relationshipGaps.counts[k] > 0);
  const issueKinds = (Object.keys(CONSISTENCY_LABEL) as ConsistencyKind[]).filter((k) => consistency.counts[k] > 0);
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
          {scope.isAdmin && (
            <p className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-testid="research-connect">
              <span>Mehrere Importe? Personen, die in mehreren vorkommen, verbinden sie zu einem gemeinsamen Stammbaum.</span>
              <Link href="/research/connect" className="btn-secondary btn-sm">
                Importe verbinden
              </Link>
            </p>
          )}

          <div
            className="card flex flex-wrap items-center justify-between gap-3 border-accent-300 p-4 dark:border-accent-700"
            data-testid="research-progress"
          >
            <span className="min-w-0 flex-1 basis-64">
              <span className="block font-serif text-lg font-semibold">Forschungs-Fortschritt</span>
              <span className="block text-sm muted">
                Wie vollständig sind deine Vorfahren erforscht — je Generation und je Linie? Mit Vorschlägen, wo
                sich das Weitersuchen am meisten lohnt.
              </span>
            </span>
            <Link href="/progress" className="btn-primary" data-testid="research-progress-link">
              Fortschritt ansehen
            </Link>
          </div>

          <p className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-testid="research-kinship">
            <span>Wie hängen zwei Personen zusammen? Die App nennt die Verwandtschaft und zeichnet den Weg.</span>
            <Link href="/kinship" className="btn-secondary btn-sm">
              Wie sind wir verwandt?
            </Link>
          </p>

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
              {gapKinds.length === 0 && relGapKinds.length === 0 ? (
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
                  {relGapKinds.map((k) => (
                    <details key={k} className="card group" data-testid={`gap-${k}`}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{REL_GAP_LABEL[k].title}</span>
                          <span className="block text-xs muted">{REL_GAP_LABEL[k].hint}</span>
                        </span>
                        <span className="badge-accent tabular-nums">{gaps.relationshipGaps.counts[k]}</span>
                        <span aria-hidden className="text-xs muted transition group-open:rotate-90">▸</span>
                      </summary>
                      <ul className="border-t border-stone-200 p-2 dark:border-stone-800">
                        {gaps.relationshipGaps.items[k].map((item) => (
                          <li key={item.relationshipId}>
                            <PairLink persons={item.persons} relationshipId={item.relationshipId} detail={item.detail} />
                          </li>
                        ))}
                        {gaps.relationshipGaps.counts[k] > gaps.relationshipGaps.items[k].length && (
                          <li className="px-2 py-1 text-xs muted">
                            … und {gaps.relationshipGaps.counts[k] - gaps.relationshipGaps.items[k].length} weitere
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
                  Ähnliche Namen (auch Ehe- und Geburtsname), Daten und Verwandte — bitte prüfen, ob es dieselbe
                  Person ist, und dann zusammenführen oder als „kein Duplikat“ markieren.
                </p>
              </div>
              {duplicates.total === 0 ? (
                <p className="alert-success">Keine verdächtigen Doppelungen gefunden.</p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="tabular-nums">{duplicates.counts.high}</span> sicher ·{" "}
                    <span className="tabular-nums">{duplicates.counts.medium}</span> wahrscheinlich ·{" "}
                    <span className="tabular-nums">{duplicates.counts.low}</span> unklar ·{" "}
                    <Link href="/research/duplicates" className="font-medium underline" data-testid="research-duplicates-all">
                      alle {duplicates.total} prüfen
                    </Link>
                  </p>
                  <DuplicateList items={duplicates.items} />
                </>
              )}
            </section>
          </div>

          <section aria-labelledby="issues-h" className="space-y-3" data-testid="research-consistency">
            <div>
              <h2 id="issues-h" className="section-title">
                Widersprüche
              </h2>
              <p className="text-sm muted">
                Angaben, die sich für jede mögliche Lesart widersprechen — auch Lebensereignisse
                gegen Geburt und Tod. Ungenaue Daten zählen mit ihrem ganzen Zeitraum.
              </p>
            </div>
            {issueKinds.length === 0 ? (
              <p className="alert-success">Keine Widersprüche gefunden.</p>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {issueKinds.map((k) => {
                  const items = consistency.items.filter((i) => i.kind === k);
                  return (
                    <details key={k} className="card group" data-testid={`issue-${k}`}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                        <span className="min-w-0 flex-1 font-medium">{CONSISTENCY_LABEL[k]}</span>
                        <span className="badge-accent tabular-nums">{consistency.counts[k]}</span>
                        <span aria-hidden className="text-xs muted transition group-open:rotate-90">▸</span>
                      </summary>
                      <ul className="space-y-1 border-t border-stone-200 p-2 dark:border-stone-800">
                        {items.map((i, n) => (
                          <li key={n} className="rounded-md px-2 py-1 text-sm">
                            {i.persons[0] ? (
                              <Link href={`/people/${i.persons[0].id}`} className="font-medium hover:underline">
                                {fullName(i.persons[0])}
                              </Link>
                            ) : null}
                            <span className="block text-xs muted">{i.message}</span>
                          </li>
                        ))}
                        {consistency.counts[k] > items.length && (
                          <li className="px-2 py-1 text-xs muted">… und {consistency.counts[k] - items.length} weitere</li>
                        )}
                      </ul>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
