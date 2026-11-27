import Link from "next/link";

import { requireScope } from "@/lib/session";
import { getToday } from "@/lib/services/today";
import { addDays, calendarDayIn, daysBetween, formatDayMonth, formatIsoDay, formatLongDay, parseIsoDay, UPCOMING_DAYS, type CalendarDay } from "@/lib/today";
import { HelpLink } from "@/components/HelpLink";
import { AnniversaryList, AnniversarySentence } from "@/components/TodayList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Heute in der Familie" };

type Params = { datum?: string };

/** Einstieg in die wichtigsten Bereiche. */
const ENTRIES = [
  { href: "/tree", title: "Stammbaum", text: "Vorfahren und Nachkommen, Generationen, Zeitstrahl und Ringe", testId: "start-tree" },
  { href: "/map", title: "Karte", text: "Wo die Familie in einem Jahr lebte", testId: "start-map" },
  { href: "/people", title: "Personen", text: "Alle Personen mit Suche nach Namen und Orten", testId: "start-people" },
  { href: "/statistics", title: "Statistik", text: "Namen, Orte, Lebensalter und Kinderzahl in Zahlen", testId: "start-statistics" },
  { href: "/records", title: "Rekorde", text: "Die Ältesten, die längste Ehe, die meisten Nachkommen — mit Namen", testId: "start-records" },
] as const;

/** Adresse eines Tages: der wirkliche heutige Tag ohne Parameter. */
const dayHref = (d: CalendarDay, realToday: CalendarDay) =>
  daysBetween(realToday, d) === 0 ? "/" : `/?datum=${formatIsoDay(d)}`;

const dayNavClass =
  "btn-secondary btn-sm max-md:min-h-11 max-md:px-3";

/**
 * Startseite „Heute in der Familie“: Jahrestage des Tages, Geburtstage und
 * runde Jahrestage der nächsten Wochen, Einstieg in die Bereiche. Nur über
 * Personen, die der Benutzer sehen darf. Regeln: lib/today.ts, Laden und
 * Rechte: lib/services/today.ts. Ein anderer Tag per `?datum=JJJJ-MM-TT`.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const now = new Date();
  const realToday = calendarDayIn(now);
  const data = await getToday(scope, { day: parseIsoDay(params.datum), now });
  const { day, isRealToday } = data;
  const hasFamily = scope.isAdmin || scope.families.size > 0;
  const dayName = isRealToday ? "Heute" : `Am ${formatDayMonth(day)}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow" data-testid="today-date">
          {formatLongDay(day)}
        </p>
        <h1 className="page-title">{isRealToday ? "Heute in der Familie" : `Der ${formatDayMonth(day)} in der Familie`}</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Geburtstage, Hochzeiten und andere Jahrestage aus deinem Stammbaum — nur von Personen, die für dich freigegeben
          sind.
        </p>
        <HelpLink to="startseite" className="mt-1" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!hasFamily ? (
            <section className="card px-6 py-10 text-center" data-testid="today-no-family">
              <h2 className="section-title">Noch keine Familie freigegeben</h2>
              <p className="mt-1 text-sm muted">
                Sobald dir ein Administrator eine Familie freigibt, erscheinen hier Geburtstage und Jahrestage.
              </p>
            </section>
          ) : (
            <>
              <section aria-labelledby="today-h" className="card p-4 sm:p-5" data-testid="today-section">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="today-h" className="section-title">
                    {dayName}
                  </h2>
                  <nav aria-label="Anderer Tag" className="flex flex-wrap gap-2">
                    <Link href={dayHref(addDays(day, -1), realToday)} className={dayNavClass} data-testid="today-prev" scroll={false}>
                      <span aria-hidden>‹</span> Vortag
                    </Link>
                    {!isRealToday && (
                      <Link href="/" className={dayNavClass} data-testid="today-back">
                        Heute
                      </Link>
                    )}
                    <Link href={dayHref(addDays(day, 1), realToday)} className={dayNavClass} data-testid="today-next" scroll={false}>
                      Folgetag <span aria-hidden>›</span>
                    </Link>
                  </nav>
                </div>
                {data.today.length > 0 ? (
                  <div className="mt-2">
                    <AnniversaryList items={data.today} isRealToday={isRealToday} testId="today-list" label={`Jahrestage ${dayName.toLowerCase()}`} />
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg bg-stone-50 px-4 py-5 dark:bg-stone-800/40" data-testid="today-empty">
                    <p className="font-serif text-lg">
                      {isRealToday ? "Heute" : `Am ${formatDayMonth(day)}`} steht kein Jahrestag im Stammbaum.
                    </p>
                    <p className="mt-1 text-sm muted">
                      Gezählt werden nur Daten, die auf den Tag genau bekannt sind.
                    </p>
                    {data.next && (
                      <p className="mt-3 text-sm" data-testid="today-next-anniversary">
                        <span className="font-medium">Der nächste: </span>
                        <AnniversarySentence item={data.next} isRealToday={isRealToday} />
                        .{" "}
                        <Link href={dayHref(data.next.on, realToday)} className="btn-link" data-testid="today-next-link">
                          Diesen Tag ansehen
                        </Link>
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section aria-labelledby="soon-h" className="card p-4 sm:p-5" data-testid="soon-section">
                <h2 id="soon-h" className="section-title">
                  Demnächst
                </h2>
                <p className="text-xs muted">in den nächsten {UPCOMING_DAYS} Tagen</p>
                <div className="mt-3 grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold">Geburtstage</h3>
                    {data.birthdays.length > 0 ? (
                      <AnniversaryList items={data.birthdays} isRealToday={isRealToday} testId="soon-birthdays" label="Geburtstage demnächst" />
                    ) : (
                      <p className="mt-2 text-sm muted" data-testid="soon-birthdays-empty">
                        In den nächsten {UPCOMING_DAYS} Tagen hat niemand Geburtstag.
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Runde Jahrestage</h3>
                    {data.upcoming.length > 0 ? (
                      <AnniversaryList items={data.upcoming} isRealToday={isRealToday} testId="soon-round" label="Runde Jahrestage demnächst" />
                    ) : (
                      <p className="mt-2 text-sm muted" data-testid="soon-round-empty">
                        In den nächsten {UPCOMING_DAYS} Tagen steht kein runder Jahrestag an.
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <nav aria-labelledby="start-h" data-testid="start-entries">
          <h2 id="start-h" className="section-title mb-3">
            Einstieg
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {ENTRIES.map((e) => (
              <li key={e.href}>
                <Link
                  href={e.href}
                  data-testid={e.testId}
                  className="card group flex min-h-11 items-center justify-between gap-3 px-4 py-3 transition hover:border-accent-300 dark:hover:border-accent-700"
                >
                  <span className="min-w-0">
                    <span className="block font-serif text-lg font-semibold">{e.title}</span>
                    <span className="block text-sm muted">{e.text}</span>
                  </span>
                  <span aria-hidden className="text-accent-700 transition group-hover:translate-x-0.5 dark:text-accent-300">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
