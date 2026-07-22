"use client";

import type { EdgeProps } from "reactflow";

export type ParentEdgeData = {
  /** "parent" = Abstammung, "event" = Anbindung an ein Hochzeitsereignis. */
  variant?: "parent" | "event";
  /** Spur für das waagerechte Stück; trennt die Linien mehrerer Eltern. */
  lane?: number;
  /** Korridor durch übersprungene Ebenen (Linien über mehrere Generationen). */
  waypoints?: { x: number; y: number }[];
  dimmed?: boolean;
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
  const drop = BUS_DROP + (data?.lane ?? 0) * LANE_STEP;
  const busY = sourceY + Math.min(drop, Math.max(gap - 20, 12));

  const waypoints = data?.waypoints ?? [];
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
