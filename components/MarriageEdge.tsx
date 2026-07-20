"use client";

import { EdgeLabelRenderer, type EdgeProps } from "reactflow";

import { formatDate, type MarriageInfo } from "@/lib/tree-layout";

export type MarriageEdgeData = MarriageInfo & { dimmed: boolean };

/** Wie weit die Kante unter die Kartenreihe absinkt. */
const DROP = 54;
const RADIUS = 12;

/**
 * Ehe zwischen zwei eigenständigen Knoten. Läuft bewusst UNTER der
 * Kartenreihe herum statt waagerecht auf gleicher Höhe: Ehepartner stehen
 * häufig in verschiedenen Familiensträngen, und eine gerade Verbindung würde
 * quer durch alle dazwischenliegenden Karten schneiden.
 *
 * In der Mitte sitzt derselbe Marker wie beim Verbindungsstück eines
 * absorbierten Paares — Hochzeitsbild, sonst Herz, dazu das Jahr.
 */
export function MarriageEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<MarriageEdgeData>) {
  const bottom = Math.max(sourceY, targetY) + DROP;
  const dir = targetX > sourceX ? 1 : -1;

  // Abgerundete Ecken, damit die Führung nicht wie ein Schaltplan wirkt.
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX} ${bottom - RADIUS}`,
    `Q ${sourceX} ${bottom} ${sourceX + RADIUS * dir} ${bottom}`,
    `L ${targetX - RADIUS * dir} ${bottom}`,
    `Q ${targetX} ${bottom} ${targetX} ${bottom - RADIUS}`,
    `L ${targetX} ${targetY}`,
  ].join(" ");

  const divorced = data?.subtype === "DIVORCED";
  const year = data?.date ? new Date(data.date).getFullYear() : null;
  const midX = (sourceX + targetX) / 2;

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        strokeWidth={1.5}
        stroke={divorced ? "#a8a29e" : "#fb7185"}
        strokeDasharray={divorced ? "5 4" : undefined}
        opacity={data?.dimmed ? 0.15 : 1}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${midX}px, ${bottom}px)`,
          }}
          className={`pointer-events-none absolute flex items-center gap-1.5 rounded-full bg-white/95 px-2 py-1 shadow-sm ring-1 backdrop-blur transition-opacity dark:bg-stone-900/95 ${
            divorced ? "ring-stone-200" : "ring-rose-200"
          } ${data?.dimmed ? "opacity-15" : "opacity-100"}`}
          title={
            data?.date
              ? `${divorced ? "Ehe geschieden" : "Hochzeit"} am ${formatDate(data.date)}`
              : divorced
                ? "geschieden"
                : "verheiratet"
          }
        >
          {data?.primaryMediaId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/${data.primaryMediaId}?variant=thumb`}
              alt=""
              className="h-7 w-7 rounded-full object-cover ring-1 ring-rose-300"
            />
          ) : (
            <span
              className={`text-sm leading-none ${
                divorced ? "text-stone-400" : "text-rose-400"
              }`}
            >
              {divorced ? "⚯" : "♥"}
            </span>
          )}
          {year && (
            <span className="text-[11px] font-medium tabular-nums text-stone-500">
              {year}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
