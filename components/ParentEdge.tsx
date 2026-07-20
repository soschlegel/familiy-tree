"use client";

import type { EdgeProps } from "reactflow";

export type ParentEdgeData = {
  /** "parent" = Abstammung, "event" = Anbindung an ein Hochzeitsereignis. */
  variant?: "parent" | "event";
  dimmed?: boolean;
};

/** Abstand des waagerechten Stücks unterhalb des Elternknotens. */
const BUS_DROP = 38;
const RADIUS = 10;

/**
 * Abstammungslinie im klassischen Stammbaumstil: senkrecht ein Stück nach
 * unten, dann waagerecht, dann senkrecht ins Kind.
 *
 * Entscheidend ist die Höhe des waagerechten Stücks — es sitzt dicht unter dem
 * ELTERNKNOTEN, nicht auf halber Strecke. Dadurch teilen sich alle Geschwister
 * automatisch dieselbe waagerechte Linie (gleicher Elternknoten, gleiche
 * Höhe), und von dieser Sammelschiene führt je ein senkrechter Strich direkt
 * in ein Kind. Auf halber Strecke — der Standardverlauf — hängt das
 * waagerechte Stück dagegen zwischen den Ebenen und lässt sich weder Eltern
 * noch Kind zuordnen; bei der Zeitstrahlansicht mit großen Abständen wird das
 * vollends unlesbar.
 */
export function ParentEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<ParentEdgeData>) {
  const isEvent = data?.variant === "event";

  // Genug Platz lassen, wenn Ziel und Quelle dicht beieinander liegen.
  const gap = targetY - sourceY;
  const busY = sourceY + Math.min(BUS_DROP, Math.max(gap / 2, 12));

  const dx = targetX - sourceX;
  const dir = dx >= 0 ? 1 : -1;
  const r = Math.min(RADIUS, Math.abs(dx) / 2, Math.abs(busY - sourceY));

  const path =
    Math.abs(dx) < 1
      ? // Kind sitzt direkt unter dem Elternteil — gerade Linie.
        `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
      : [
          `M ${sourceX} ${sourceY}`,
          `L ${sourceX} ${busY - r}`,
          `Q ${sourceX} ${busY} ${sourceX + r * dir} ${busY}`,
          `L ${targetX - r * dir} ${busY}`,
          `Q ${targetX} ${busY} ${targetX} ${busY + r}`,
          `L ${targetX} ${targetY}`,
        ].join(" ");

  return (
    <path
      id={id}
      d={path}
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      stroke={isEvent ? "#fb7185" : "#c7c2be"}
      strokeDasharray={isEvent ? "5 4" : undefined}
      opacity={data?.dimmed ? 0.15 : 1}
    />
  );
}
