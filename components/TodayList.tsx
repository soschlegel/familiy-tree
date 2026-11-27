import Link from "next/link";

import { anniversarySentence, roundLabel, SECTION_LIMIT, type Anniversary, type AnniversaryKind } from "@/lib/today";

/**
 * Bausteine der Startseite „Heute in der Familie“ (app/page.tsx): Liste von
 * Jahrestagen als Sätze, Personen als Links, runde Einträge mit Hinweis.
 * Mehr als SECTION_LIMIT Einträge stehen hinter „Weitere … anzeigen“ — ein
 * <details>, also ohne eigenes Skript (CSP).
 */

/** Genealogische Zeichen: * Geburt, ⚭ Hochzeit, † Tod, ~ Taufe/Ereignis. */
const SYMBOL: Record<AnniversaryKind, string> = {
  birth: "*",
  marriage: "⚭",
  partnership: "⚭",
  death: "†",
  event: "~",
};

const KIND_LABEL: Record<AnniversaryKind, string> = {
  birth: "Geburt",
  marriage: "Hochzeit",
  partnership: "Partnerschaft",
  death: "Todestag",
  event: "Ereignis",
};

/** Satz mit Personen als Links. */
export function AnniversarySentence({ item, isRealToday }: { item: Anniversary; isRealToday: boolean }) {
  return (
    <>
      {anniversarySentence(item, isRealToday).map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <Link
            key={i}
            href={`/people/${part.id}`}
            data-testid="today-person-link"
            // Inline-Link: der Innenabstand vergrößert unter md nur die
            // Tippfläche (44 px), nicht die Zeilenhöhe.
            className="font-medium text-accent-700 underline decoration-accent-300 underline-offset-2 hover:decoration-current max-md:py-3 dark:text-accent-300 dark:decoration-accent-700"
          >
            {part.name}
          </Link>
        ),
      )}
    </>
  );
}

function Item({ item, isRealToday, markToday }: { item: Anniversary; isRealToday: boolean; markToday: boolean }) {
  const label = roundLabel(item);
  const isDay = markToday && item.daysAway === 0;
  return (
    <li
      className={`flex items-start gap-3 py-2.5 ${isDay ? "-mx-2 rounded-lg bg-accent-50 px-2 dark:bg-accent-900/30" : ""}`}
      data-testid="today-item"
      data-kind={item.kind}
      data-round={item.round || undefined}
      data-days-away={item.daysAway}
    >
      <span
        aria-hidden
        title={KIND_LABEL[item.kind]}
        // ⚭ ist in den meisten Schriften klein gezeichnet — eine Stufe größer.
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-serif leading-none ${
          item.kind === "marriage" || item.kind === "partnership" ? "text-xl" : "text-base"
        } ${
          item.round
            ? "bg-brass-100 text-brass-700 ring-1 ring-brass-300 dark:bg-brass-700/20 dark:text-brass-300 dark:ring-brass-700"
            : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
        }`}
      >
        {SYMBOL[item.kind]}
      </span>
      <p className="min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">
        {isDay && (
          <>
            <span className="badge-accent align-middle font-semibold" data-testid="today-mark">
              {isRealToday ? "heute" : "an diesem Tag"}
            </span>{" "}
          </>
        )}
        <AnniversarySentence item={item} isRealToday={isRealToday} />
        {label && (
          <>
            {" "}
            <span className="badge-alt align-middle" data-testid="today-round">
              {label}
            </span>
          </>
        )}
      </p>
    </li>
  );
}

/**
 * Liste mit höchstens SECTION_LIMIT Einträgen, der Rest aufklappbar.
 * `markToday`: Einträge am gewählten Tag selbst farbig hinterlegen und mit
 * „heute“ (bzw. „an diesem Tag“) kennzeichnen — für die Karte „Geburtstage“.
 */
export function AnniversaryList({
  items,
  isRealToday,
  testId,
  label,
  markToday = false,
}: {
  items: Anniversary[];
  isRealToday: boolean;
  testId: string;
  label: string;
  markToday?: boolean;
}) {
  const shown = items.slice(0, SECTION_LIMIT);
  const rest = items.slice(SECTION_LIMIT);
  return (
    <div data-testid={testId}>
      <ul aria-label={label} className="divide-y divide-stone-200/80 dark:divide-stone-800">
        {shown.map((a) => (
          <Item key={a.key} item={a} isRealToday={isRealToday} markToday={markToday} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group" data-testid={`${testId}-more`}>
          <summary className="btn-link inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Weitere {rest.length} anzeigen</span>
            <span className="hidden group-open:inline">Weniger anzeigen</span>
          </summary>
          <ul aria-label={`${label} (weitere)`} className="divide-y divide-stone-200/80 border-t border-stone-200/80 dark:divide-stone-800 dark:border-stone-800">
            {rest.map((a) => (
              <Item key={a.key} item={a} isRealToday={isRealToday} markToday={markToday} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
