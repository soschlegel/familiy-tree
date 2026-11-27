import { AI_UNCONFIRMED_LABEL } from "@/lib/history/origin";

/**
 * Vermerk „von KI, ungeprüft“ an einem Ereignis der Zeitgeschichte, das der
 * KI-Assistent eingetragen und noch kein Administrator bestätigt hat
 * (lib/history/origin.ts). Dezent, aber als Text — nicht nur über die
 * Farbe. Benutzt im Zeitstrahl (TimelineHistory), in der Zeitreise der
 * Karte (MapExplorer) und im Lebenslauf (PersonBiography).
 */
export function HistoryAiNote({ testId, className = "" }: { testId: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center whitespace-nowrap rounded border border-dashed border-stone-400 px-1 py-px align-baseline text-[10px] font-normal leading-tight text-stone-600 dark:border-stone-500 dark:text-stone-300 ${className}`}
    >
      {AI_UNCONFIRMED_LABEL}
    </span>
  );
}
