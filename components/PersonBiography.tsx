"use client";

import Link from "next/link";
import { useState } from "react";

import { HelpLink } from "@/components/HelpLink";
import type { Biography } from "@/lib/biography";
import { formatHistoryYears, HISTORY_KIND_LABEL, type HistoryEvent } from "@/lib/history/events";
import type { LifetimeHistory } from "@/lib/history/lifetime";
import { HistoryToggle, useHistoryToggle } from "./HistoryToggle";
import { HistoryAiNote } from "./HistoryAiNote";

/**
 * Abschnitt „Lebenslauf“ der Personenseite: der aus den erfassten Daten
 * gebaute Text (lib/biography.ts), Namen anderer Personen als Link, dazu
 * „Text kopieren“ (reiner Text ohne Links). Der Text kommt fertig vom
 * Server und nennt nur Personen, die der Benutzer sehen darf.
 *
 * Darunter, abgesetzt und NICHT Teil des Texts (auch nicht von „Text
 * kopieren“): die Zeile „In diese Lebenszeit fielen: …“ mit Ereignissen der
 * Zeitgeschichte (lib/history/lifetime.ts) — Hintergrund, ausdrücklich
 * keine Aussage, die Person sei betroffen gewesen. Schalter
 * „Zeitgeschichte“ wie im Zeitstrahl und auf der Karte (Cookie).
 */
export function PersonBiography({
  biography,
  history = null,
  initialHistory = true,
}: {
  biography: Biography;
  /** Ereignisse der Lebenszeit; null ohne brauchbare Lebenszeit oder ohne Ereignisse darin. */
  history?: LifetimeHistory | null;
  initialHistory?: boolean;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [historyOn, setHistoryOn] = useHistoryToggle(initialHistory);

  async function copy() {
    try {
      await navigator.clipboard.writeText(biography.text);
      setCopied("ok");
    } catch {
      // Ohne Zwischenablage-Recht: Text markieren, damit Strg+C reicht.
      const el = document.getElementById("biography-text");
      const selection = window.getSelection();
      if (el && selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopied("fail");
    }
  }

  return (
    <section aria-labelledby="biography-h" className="card space-y-3 p-5" data-testid="person-biography">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="biography-h" className="section-title">
          Lebenslauf
        </h2>
        <button type="button" className="btn-secondary" onClick={copy} data-testid="biography-copy">
          Text kopieren
        </button>
      </div>
      <div id="biography-text" className="space-y-3 font-serif text-[1.05rem] leading-relaxed" data-testid="biography-text">
        {biography.paragraphs.map((paragraph, i) => (
          <p key={i}>
            {paragraph.map((seg, j) =>
              seg.personId ? (
                <Link
                  key={j}
                  href={`/people/${seg.personId}`}
                  className="text-accent-800 underline decoration-accent-300 underline-offset-2 hover:decoration-accent-600 dark:text-accent-200 dark:decoration-accent-700 dark:hover:decoration-accent-400"
                  data-testid="biography-person-link"
                >
                  {seg.text}
                </Link>
              ) : (
                <span key={j}>{seg.text}</span>
              ),
            )}
          </p>
        ))}
      </div>
      {history && historyOn && <LifetimeHistoryLine history={history} />}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs muted" data-testid="biography-note">
        <span>Automatisch aus den erfassten Daten erstellt.</span>
        <HelpLink to="lebenslauf" label="Wie entsteht der Text?" className="text-xs" />
        {history && <HistoryToggle on={historyOn} onChange={setHistoryOn} testId="biography-history-toggle" />}
        {copied === "ok" && (
          <span role="status" className="font-medium text-accent-700 dark:text-accent-300">
            Text kopiert.
          </span>
        )}
        {copied === "fail" && (
          <span role="status" className="font-medium">
            Kopieren nicht möglich — der Text ist markiert, kopiere ihn mit Strg+C.
          </span>
        )}
      </p>
    </section>
  );
}

function EventItem({ event: e }: { event: HistoryEvent }) {
  const detail = [
    HISTORY_KIND_LABEL[e.kind],
    e.region ? `gilt für ${e.region}` : null,
    e.near ? `Bezug: ${e.near}` : null,
    e.description,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span title={detail} data-testid="biography-history-item" data-near={e.near || undefined}>
      {e.title}{" "}
      <span className="whitespace-nowrap tabular-nums muted">
        ({formatHistoryYears(e)}
        {e.near && <span data-testid="biography-history-near"> · {e.near}</span>})
      </span>
      {e.aiUnconfirmed && <HistoryAiNote testId="biography-history-ai" className="ml-1" />}
    </span>
  );
}

const joined = (events: HistoryEvent[]) =>
  events.map((e, i) => (
    <span key={e.id}>
      <EventItem event={e} />
      {i < events.length - 1 && <span aria-hidden> · </span>}
    </span>
  ));

/**
 * Abgesetzte Zeile unter dem Text: Ereignisse zwischen Geburts- und
 * Sterbejahr (bei Lebenden bis heute). Mit regionalem Bezug stehen
 * Ereignisse aus der Gegend der Person vorn; solche anderer Gegenden nur
 * unter „weitere Ereignisse“ (lib/history/lifetime.ts).
 */
function LifetimeHistoryLine({ history }: { history: LifetimeHistory }) {
  const more = history.rest.length + history.other.length;
  return (
    <aside
      aria-label="Zeitgeschichte"
      className="space-y-1 border-l-2 border-amber-300 pl-3 text-sm dark:border-amber-700"
      data-testid="biography-history"
    >
      {history.top.length > 0 ? (
        <p>
          <span className="font-medium text-amber-800 dark:text-amber-300">In diese Lebenszeit fielen:</span> {joined(history.top)}
        </p>
      ) : (
        <p data-testid="biography-history-none-near">
          <span className="font-medium text-amber-800 dark:text-amber-300">In diese Lebenszeit fielen</span> keine Ereignisse
          aus der Gegend der erfassten Orte.
        </p>
      )}
      {more > 0 && (
        <details data-testid="biography-history-more">
          <summary className="cursor-pointer text-accent-700 max-md:py-2.5 dark:text-accent-300">
            {more === 1 ? "1 weiteres Ereignis" : `${more} weitere Ereignisse`}
          </summary>
          {history.rest.length > 0 && <p className="mt-1">{joined(history.rest)}</p>}
          {history.other.length > 0 && (
            <p className="mt-1" data-testid="biography-history-other">
              <span className="muted">Andere Gegenden: </span>
              {joined(history.other)}
            </p>
          )}
        </details>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs muted">
        <span>
          Allgemeine Zeitgeschichte {history.from}–{history.living ? "heute" : history.to}, keine Angabe über die Person
          {history.regional ? " — Ereignisse aus der Gegend der erfassten Orte zuerst." : "."}
        </span>
        <HelpLink to="zeitgeschichteLebenslauf" compact label="Was zeigt die Zeitgeschichte im Lebenslauf?" />
      </p>
    </aside>
  );
}
