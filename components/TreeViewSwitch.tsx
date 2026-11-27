"use client";

import type { TreeView } from "@/lib/focus-tree";

/**
 * Gemeinsame Teile der Werkzeugleiste aller Stammbaum-Ansichten
 * (components/FamilyTree.tsx und components/AncestorRings.tsx): der
 * Ansichtsumschalter und das Symbol des Vollbild-Knopfs.
 */

export const TREE_VIEWS: readonly (readonly [TreeView, string, string])[] = [
  ["focus", "Fokus", "Eine Person im Mittelpunkt mit Vorfahren und Nachkommen"],
  ["generations", "Generationen", "Ganzer Baum nach Generationen"],
  ["timeline", "Zeitstrahl", "Ganzer Baum auf einer Jahresachse"],
  ["rings", "Ringe", "Vorfahren einer Person als Kreis, von innen nach außen"],
];

/** Knopfgruppe „Fokus / Generationen / Zeitstrahl / Ringe“ mit `aria-pressed`. */
export function TreeViewSwitch({
  active,
  onSwitch,
  className = "",
}: {
  active: TreeView;
  onSwitch: (view: TreeView) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex overflow-hidden rounded-lg border border-stone-300 bg-surface text-sm dark:border-stone-700 ${className}`}
      role="group"
      aria-label="Ansicht"
    >
      {TREE_VIEWS.map(([value, label, title]) => (
        <button
          type="button"
          key={value}
          title={title}
          aria-pressed={active === value}
          data-testid={`tree-view-${value}`}
          onClick={() => onSwitch(value)}
          // Telefon: knapper Innenabstand, damit die vier Knöpfe neben
          // „Ehen“ bzw. „Alles zeigen“ in eine Zeile passen.
          className={`px-1.5 py-1.5 max-md:min-h-11 sm:px-3 transition ${
            active === value
              ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
              : "hover:bg-stone-100 dark:hover:bg-stone-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Pfeile nach außen (Vollbild) bzw. nach innen (Vollbild beenden). */
export function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0 md:h-3.5 md:w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {/* Diagonale Pfeile — die vier Ecken „Alles einpassen“ der Zoom-Knöpfe sind schon vergeben. */}
      {exit ? <path d="M14 2 9.5 6.5M9.5 3v3.5H13M2 14l4.5-4.5M6.5 13V9.5H3" /> : <path d="M9.5 6.5 14 2M10.5 2H14v3.5M6.5 9.5 2 14M5.5 14H2v-3.5" />}
    </svg>
  );
}

/** Klassen des Vollbild-Knopfs rechts oben in der Fläche (alle Ansichten gleich). */
export const FULLSCREEN_BUTTON_CLASS =
  "absolute right-3 top-3 z-20 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/95 px-3 text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-300 backdrop-blur transition hover:ring-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 md:min-h-0 md:px-2.5 md:py-1 md:text-xs md:font-normal dark:bg-stone-900/95 dark:text-stone-200 dark:ring-stone-700 dark:hover:ring-accent-500";
