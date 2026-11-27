import Link from "next/link";

import { requireScope } from "@/lib/session";
import { getFamilyStatistics } from "@/lib/services/statistics";
import { MIN_BASIS } from "@/lib/statistics";
import type { AreaSlice } from "@/lib/chart-slices";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { DonutChart, DonutLegend } from "@/components/DonutChart";
import { HelpLink } from "@/components/HelpLink";
import {
  AverageTable,
  BarList,
  basisText,
  EmptyHint,
  formatAverage,
  formatCount,
  KeyFigure,
  StatsCard,
} from "@/components/StatisticsCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Statistik" };

type Params = { family?: string; level?: string };

/** „25 %“; ein Stück unter einem halben Prozent heißt „unter 1 %“ (wie „Wurzeln“). */
function percentText(s: Pick<AreaSlice, "percent" | "share">): string {
  return s.percent === 0 && s.share > 0 ? "unter 1 %" : `${s.percent} %`;
}

function membersText(members: string[] | undefined): string | undefined {
  if (!members?.length) return undefined;
  const shown = members.slice(0, 4).join(", ");
  return members.length > 4 ? `${shown} und ${members.length - 4} weitere` : shown;
}

const persons = (n: number) => `${formatCount(n)} ${n === 1 ? "Person" : "Personen"}`;

/** Ring mit Legende; Legende nennt Prozent und Anzahl. */
function Ring({ slices, label, testId, center }: { slices: AreaSlice[]; label: string; testId: string; center: { value: string; caption: string } }) {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <DonutChart
        slices={slices.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          color: s.color,
          valueText: `${percentText(s)} (${persons(s.value)})`,
        }))}
        label={label}
        size={170}
        center={center}
        className="shrink-0"
        testId={`${testId}-chart`}
      />
      <div className="w-full min-w-0 flex-1">
        <DonutLegend
          caption={label}
          testId={`${testId}-legend`}
          items={slices.map((s) => ({
            key: s.key,
            label: s.label,
            color: s.color,
            valueText: percentText(s),
            detail: [persons(s.value), membersText(s.members)].filter(Boolean).join(" · "),
          }))}
        />
      </div>
    </div>
  );
}

/**
 * Familienstatistik in Diagrammen — nur über Personen, die der Benutzer
 * sehen darf, wahlweise für eine einzelne Familie. Rechnung und Regeln:
 * lib/statistics.ts, Laden und Rechte: lib/services/statistics.ts.
 */
export default async function StatisticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const stats = await getFamilyStatistics(scope, { familyId: params.family, level: params.level });
  const { totals } = stats;
  const level = stats.birthPlaces.level;
  const familyName = stats.families.find((f) => f.id === stats.familyId)?.name;

  const hrefFor = (next: { level?: string }) => {
    const sp = new URLSearchParams();
    if (stats.familyId) sp.set("family", stats.familyId);
    const l = next.level ?? level;
    if (l === "region") sp.set("level", "region");
    const s = sp.toString();
    return s ? `/statistics?${s}` : "/statistics";
  };

  const total = totals.persons;
  const unitLabel = stats.births.unit === "decade" ? "Jahrzehnt" : "Jahrhundert";

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Forschung</p>
        <h1 className="page-title">Statistik</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Zahlen und Diagramme über deinen Stammbaum — nur über die Personen, die für dich freigegeben sind.
          Einzelne Personen nennt diese Seite nicht.
        </p>
        <HelpLink to="statistik" className="mt-1" />
      </div>

      {stats.families.length > 1 && (
        <form
          aria-label="Statistik filtern"
          className="card flex flex-wrap items-end gap-3 p-3 max-sm:[&>div]:grow max-sm:[&_.field]:w-full"
          data-testid="stats-filter"
        >
          <div>
            <label htmlFor="stats-family" className="field-label">
              Familie
            </label>
            <AutoSubmitSelect id="stats-family" name="family" defaultValue={stats.familyId ?? ""} className="field">
              <option value="">Alle Familien</option>
              {stats.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </div>
          {level === "region" && <input type="hidden" name="level" value="region" />}
          <button className="btn-secondary">Anzeigen</button>
        </form>
      )}

      {total === 0 ? (
        <div className="card px-6 py-10 text-center" data-testid="stats-nothing">
          <p className="font-serif text-lg">Noch nichts auszuwerten.</p>
          <p className="mt-1 text-sm muted">
            {stats.familyId
              ? "In dieser Familie sind noch keine Personen erfasst."
              : "Sobald dir eine Familie freigegeben ist und Personen erfasst sind, erscheinen hier die Zahlen."}
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stats-key-figures">
            <KeyFigure
              label="Personen"
              value={formatCount(total)}
              sub={`${formatCount(totals.living)} lebend · ${formatCount(totals.deceased)} verstorben`}
              testId="stats-persons"
            />
            <KeyFigure
              label="Partnerschaften"
              value={formatCount(totals.partnerships)}
              sub={`${formatCount(totals.parentChild)} Eltern-Kind-Beziehungen`}
              testId="stats-partnerships"
            />
            <KeyFigure
              label="Frühestes Geburtsjahr"
              value={totals.earliestBirthYear === null ? "—" : String(totals.earliestBirthYear)}
              sub={basisText(totals.withBirthYear, total, "mit Geburtsjahr")}
              testId="stats-earliest"
            />
            <KeyFigure
              label="Spätestes Geburtsjahr"
              value={totals.latestBirthYear === null ? "—" : String(totals.latestBirthYear)}
              sub={familyName ? `nur ${familyName}` : "alle freigegebenen Familien"}
              testId="stats-latest"
            />
          </section>
          {totals.presumedDeceased > 0 && (
            <p className="-mt-3 text-xs muted" data-testid="stats-presumed">
              Als verstorben zählen auch {persons(totals.presumedDeceased)} ohne Sterbeangabe, die laut Geburtsdatum
              über 100 Jahre alt wären.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <StatsCard
              id="stats-places"
              title="Geburtsorte"
              testId="stats-places"
              basis={`${basisText(stats.birthPlaces.withPlace, total, "mit Geburts- oder Taufort")}; ${formatCount(stats.birthPlaces.assigned)} davon einem Ort zugeordnet`}
              actions={
                <div
                  role="group"
                  aria-label="Einteilung"
                  className="inline-flex overflow-hidden rounded-lg border border-stone-300 text-sm dark:border-stone-700"
                >
                  {(
                    [
                      { value: "country", label: "nach Land" },
                      { value: "region", label: "nach Region" },
                    ] as const
                  ).map((l) => (
                    <Link
                      key={l.value}
                      href={hrefFor({ level: l.value })}
                      aria-current={level === l.value ? "true" : undefined}
                      data-testid={`stats-level-${l.value}`}
                      scroll={false}
                      className={`px-3 py-1.5 transition max-md:inline-flex max-md:min-h-11 max-md:items-center ${
                        level === l.value
                          ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                          : "bg-surface hover:bg-stone-100 dark:hover:bg-stone-800"
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              }
            >
              <Ring
                slices={stats.birthPlaces.slices}
                label={`Geburtsorte nach ${level === "region" ? "Region" : "Land"}`}
                testId="stats-places"
                center={{ value: formatCount(total), caption: "Personen" }}
              />
            </StatsCard>

            <StatsCard
              id="stats-gender"
              title="Geschlecht"
              testId="stats-gender"
              basis={`aus allen ${persons(total)}; bei ${formatCount(total - stats.gender.known)} ist es nicht angegeben`}
            >
              <Ring
                slices={stats.gender.slices}
                label="Geschlecht"
                testId="stats-gender"
                center={{ value: formatCount(total), caption: "Personen" }}
              />
            </StatsCard>

            <StatsCard
              id="stats-surnames"
              title="Häufigste Nachnamen"
              testId="stats-surnames"
              basis={`${basisText(stats.surnames.withName, total, "mit Nachnamen")}, ${formatCount(stats.surnames.distinct)} verschiedene; gezählt wird der Geburtsname, sonst der Nachname`}
            >
              {stats.surnames.bars.length ? (
                <BarList bars={stats.surnames.bars} caption="Häufigste Nachnamen" labelHeader="Nachname" valueHeader="Personen" wideLabels />
              ) : (
                <EmptyHint>Noch keine Nachnamen erfasst.</EmptyHint>
              )}
            </StatsCard>

            <StatsCard
              id="stats-given"
              title="Häufigste Vornamen"
              testId="stats-given"
              basis={`${basisText(stats.givenNames.withName, total, "mit Vornamen")}, ${formatCount(stats.givenNames.distinct)} verschiedene; gezählt wird der erste Vorname`}
            >
              {stats.givenNames.bars.length ? (
                <BarList bars={stats.givenNames.bars} caption="Häufigste Vornamen" labelHeader="Vorname" valueHeader="Personen" wideLabels />
              ) : (
                <EmptyHint>Noch keine Vornamen erfasst.</EmptyHint>
              )}
            </StatsCard>

            <StatsCard
              id="stats-births"
              title={`Geburten je ${unitLabel}`}
              testId="stats-births"
              basis={basisText(stats.births.basis, total, "mit Geburtsjahr")}
            >
              {stats.births.bars.length ? (
                <BarList bars={stats.births.bars} caption={`Geburten je ${unitLabel}`} labelHeader={unitLabel} valueHeader="Geburten" />
              ) : (
                <EmptyHint>Noch keine Geburtsjahre erfasst.</EmptyHint>
              )}
            </StatsCard>

            <StatsCard
              id="stats-lifespan"
              title="Erreichtes Lebensalter"
              testId="stats-lifespan"
              basis={basisText(stats.lifespan.basis, total, "mit Geburts- und Sterbedatum")}
            >
              {stats.lifespan.basis === 0 ? (
                <EmptyHint>Noch keine Person mit Geburts- und Sterbedatum.</EmptyHint>
              ) : (
                <>
                  <p className="text-sm" data-testid="stats-lifespan-average">
                    {stats.lifespan.average === null
                      ? `Für einen Durchschnitt sind es zu wenige (unter ${MIN_BASIS} Personen).`
                      : `Im Durchschnitt ${formatAverage(stats.lifespan.average)} Jahre.`}
                  </p>
                  {stats.lifespan.byCentury.length > 0 && (
                    <AverageTable
                      rows={stats.lifespan.byCentury}
                      caption="Durchschnittliches Lebensalter je Geburtsjahrhundert"
                      labelHeader="Geboren"
                      averageHeader="Durchschnitt"
                      unit="Jahre"
                      testId="stats-lifespan-centuries"
                    />
                  )}
                  <div>
                    <h3 className="mb-1 text-sm font-medium">Altersklassen</h3>
                    <BarList bars={stats.lifespan.classes} caption="Erreichtes Lebensalter in Altersklassen" labelHeader="Alter" valueHeader="Personen" />
                  </div>
                </>
              )}
            </StatsCard>

            <StatsCard
              id="stats-children"
              title="Kinderzahl"
              testId="stats-children"
              basis={`${basisText(stats.children.parents, total, "mit mindestens einem Kind")}; gezählt werden leibliche und adoptierte Kinder`}
            >
              {stats.children.parents === 0 ? (
                <EmptyHint>Noch keine Eltern-Kind-Beziehungen erfasst.</EmptyHint>
              ) : (
                <>
                  <p className="text-sm" data-testid="stats-children-average">
                    {stats.children.average === null
                      ? `Für einen Durchschnitt sind es zu wenige (unter ${MIN_BASIS} Personen).`
                      : `Im Durchschnitt ${formatAverage(stats.children.average)} Kinder je Person mit Kindern.`}
                  </p>
                  {stats.children.byCentury.length > 0 && (
                    <AverageTable
                      rows={stats.children.byCentury}
                      caption="Durchschnittliche Kinderzahl nach Geburtsjahrhundert der Eltern"
                      labelHeader="Eltern geboren"
                      averageHeader="Kinder"
                      testId="stats-children-centuries"
                    />
                  )}
                  <div>
                    <h3 className="mb-1 text-sm font-medium">Verteilung</h3>
                    <BarList bars={stats.children.distribution} caption="Personen nach Zahl ihrer Kinder" labelHeader="Kinder" valueHeader="Personen" />
                  </div>
                </>
              )}
            </StatsCard>

            <StatsCard
              id="stats-marriage"
              title="Heiratsalter"
              testId="stats-marriage"
              basis={`${basisText(stats.marriageAge.basis, total, "mit Geburts- und Heiratsdatum")}; je Person die erste Ehe`}
            >
              {stats.marriageAge.basis === 0 ? (
                <EmptyHint>Noch keine Ehe mit Heiratsdatum erfasst.</EmptyHint>
              ) : (
                <>
                  {stats.marriageAge.byGender.length > 0 && (
                    <AverageTable
                      rows={stats.marriageAge.byGender}
                      caption="Durchschnittliches Alter bei der ersten Heirat"
                      labelHeader="Bei der ersten Heirat"
                      averageHeader="Durchschnitt"
                      unit="Jahre"
                      testId="stats-marriage-gender"
                    />
                  )}
                  <BarList bars={stats.marriageAge.classes} caption="Alter bei der ersten Heirat" labelHeader="Alter" valueHeader="Personen" />
                </>
              )}
            </StatsCard>

            <StatsCard
              id="stats-months"
              title="Geburtsmonate"
              testId="stats-months"
              basis={basisText(stats.birthMonths.basis, total, "mit genau bekanntem Geburtsmonat")}
            >
              {stats.birthMonths.basis === 0 ? (
                <EmptyHint>Noch keine Geburtsdaten mit Monat erfasst.</EmptyHint>
              ) : (
                <BarList bars={stats.birthMonths.bars} caption="Geburten je Monat" labelHeader="Monat" valueHeader="Geburten" />
              )}
            </StatsCard>
          </div>
        </>
      )}
    </div>
  );
}
