"use client";

import type { EdgeProps } from "reactflow";

import type { LineKey } from "@/lib/reference";
import { NODE_HEIGHT } from "@/lib/tree-layout";

export type ParentSubtype = "BIOLOGICAL" | "ADOPTIVE" | "STEP" | "FOSTER";

/**
 * Linienbild je Art der Elternschaft. Unterscheidung über Strichmuster UND
 * Farbe, damit sie auch ohne Farbsehen und im Ausdruck lesbar bleibt.
 */
export const PARENT_EDGE_STYLE: Record<ParentSubtype, { dash?: string; className: string }> = {
  BIOLOGICAL: { className: "stroke-stone-400 dark:stroke-stone-500" },
  ADOPTIVE: { dash: "7 4", className: "stroke-accent-500 dark:stroke-accent-300" },
  STEP: { dash: "2 4", className: "stroke-brass-500 dark:stroke-brass-400" },
  FOSTER: { dash: "9 3 2 3", className: "stroke-violet-500 dark:stroke-violet-300" },
};

export type ParentEdgeData = {
  /** "parent" = Abstammung, "event" = Anbindung an ein Hochzeitsereignis. */
  variant?: "parent" | "event";
  subtype?: ParentSubtype;
  /** Spur für das waagerechte Stück; trennt die Linien mehrerer Eltern. */
  lane?: number;
  /** Korridor durch übersprungene Ebenen (Linien über mehrere Generationen). */
  waypoints?: { x: number; y: number }[];
  dimmed?: boolean;
  /**
   * Ahnenlinie (Schalter „Linien“): Farbe der Linie statt grau. Das
   * Strichmuster der Elternschaftsart bleibt — Farbe ist nie das einzige
   * Merkmal (die Karten tragen zusätzlich Streifen und Kurzzeichen).
   */
  line?: LineKey;
};

/** Rechtwinkliger Pfad durch die Punkte, mit abgerundeten Ecken. */
function orthogonalPath(points: [number, number][], radius: number): string {
  // Aufeinanderfolgende gleiche Punkte entfernen — sie erzeugten sonst
  // Rundungen mit Radius 0 und dadurch sichtbare Knicke.
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1],
  );
  if (pts.length < 2) return "";

  let d = `M ${pts[0][0]} ${pts[0][1]}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];

    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);

    const ix = cx - Math.sign(cx - px) * r;
    const iy = cy - Math.sign(cy - py) * r;
    const ox = cx + Math.sign(nx - cx) * r;
    const oy = cy + Math.sign(ny - cy) * r;

    d += ` L ${ix} ${iy} Q ${cx} ${cy} ${ox} ${oy}`;
  }

  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/** Abstand des waagerechten Stücks unterhalb des Elternknotens. */
const BUS_DROP = 34;
/** Höhenversatz je Spur, damit sich Linien verschiedener Eltern nicht decken. */
const LANE_STEP = 20;
/** Anzahl der Spuren (siehe laneOf in lib/layout-generations.ts). */
const LANES = 4;
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

  const waypoints = data?.waypoints ?? [];

  // Platz bis zur nächsten Kartenreihe: bei Korridoren bis zur Reihe des
  // ersten Platzhalters, sonst bis zum Ziel. Die Spuren teilen sich diesen
  // Platz — bei engem Reihenabstand rücken sie zusammen, statt am unteren
  // Rand aufeinanderzufallen.
  const gap = waypoints.length > 0 ? waypoints[0].y - NODE_HEIGHT / 2 - sourceY : targetY - sourceY;
  const step = Math.max(6, Math.min(LANE_STEP, (gap - 20 - BUS_DROP) / (LANES - 1)));
  const drop = BUS_DROP + Math.min(data?.lane ?? 0, LANES - 1) * step;
  const busY = sourceY + Math.min(drop, Math.max(gap - 20, 12));

  const corners: [number, number][] = [
    [sourceX, sourceY],
    [sourceX, busY],
  ];

  if (waypoints.length > 0) {
    // Über die reservierten Korridore führen, statt quer durch die Ebenen
    // dazwischen. Je Korridor: waagerecht heran, dann senkrecht hindurch.
    let y = busY;
    for (const w of waypoints) {
      corners.push([w.x, y]);
      corners.push([w.x, w.y]);
      y = w.y;
    }
    // Kurz oberhalb des Ziels einschwenken.
    const approach = Math.max(y + 20, targetY - 30);
    corners.push([waypoints[waypoints.length - 1].x, approach]);
    corners.push([targetX, approach]);
  } else {
    corners.push([targetX, busY]);
  }

  corners.push([targetX, targetY]);

  const path =
    Math.abs(targetX - sourceX) < 1 && waypoints.length === 0
      ? // Kind sitzt direkt unter dem Elternteil — gerade Linie.
        `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
      : orthogonalPath(corners, RADIUS);

  const style = PARENT_EDGE_STYLE[data?.subtype ?? "BIOLOGICAL"] ?? PARENT_EDGE_STYLE.BIOLOGICAL;
  const line = !isEvent ? data?.line : undefined;

  return (
    <path
      id={id}
      d={path}
      fill="none"
      strokeWidth={line ? 2.5 : isEvent || style.dash ? 1.75 : 1.5}
      strokeLinecap="round"
      className={isEvent ? "stroke-rose-400" : line ? undefined : style.className}
      style={line ? { stroke: `var(--line-${line.toLowerCase()})` } : undefined}
      data-line={line}
      strokeDasharray={isEvent ? "5 4" : style.dash}
      opacity={data?.dimmed ? 0.15 : 1}
    />
  );
}
