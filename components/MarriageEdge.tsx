"use client";

import Link from "next/link";
import { EdgeLabelRenderer, type EdgeProps } from "reactflow";

import { formatDate, type MarriageInfo } from "@/lib/tree-layout";
import { PARTNER_SYMBOL, partnerLineStyle, partnerMarkerLabel, shortYear } from "@/lib/partner-labels";

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

  const subtype = data?.subtype ?? "MARRIED";
  const muted = subtype === "DIVORCED" || subtype === "PARTNER_UNKNOWN";
  const line = partnerLineStyle(subtype);
  const year = data?.date
    ? shortYear(data.date, data.datePrecision, data.dateQualifier, data.dateTo, data.dateToPrecision)
    : null;
  const midX = (sourceX + targetX) / 2;

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        strokeWidth={1.5}
        stroke={line.stroke}
        strokeDasharray={line.dash}
        strokeLinecap={line.lineCap}
        data-subtype={subtype}
        opacity={data?.dimmed ? 0.15 : 1}
      />

      <EdgeLabelRenderer>
        {/* EdgeLabelRenderer schaltet Zeigerereignisse pauschal ab — für einen
            anklickbaren Marker muss das hier gezielt zurückgenommen werden. */}
        <Link
          href={
            data
              ? `/people/${data.personId}?rel=${data.relationshipId}`
              : "#"
          }
          style={{
            transform: `translate(-50%, -50%) translate(${midX}px, ${bottom}px)`,
          }}
          className={`pointer-events-auto absolute flex items-center gap-1.5 rounded-full bg-white/95 px-2 py-1 shadow-sm ring-1 backdrop-blur transition hover:shadow-md dark:bg-stone-900/95 ${
            muted
              ? "ring-stone-200 hover:ring-stone-300"
              : "ring-rose-200 hover:ring-rose-300"
          } ${data?.dimmed ? "opacity-15" : "opacity-100"}`}
          title={
            data?.date
              ? `${partnerMarkerLabel(subtype)}: ${formatDate(data.date, data.datePrecision, data.dateQualifier, data.dateTo, data.dateToPrecision)} — Details ansehen`
              : `${partnerMarkerLabel(subtype)} — Details ansehen`
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
                muted ? "text-stone-400" : "text-rose-400"
              }`}
            >
              {PARTNER_SYMBOL[subtype] ?? "♥"}
            </span>
          )}
          {year && (
            <span className="text-[11px] font-medium tabular-nums text-stone-500">
              {year}
            </span>
          )}
        </Link>
      </EdgeLabelRenderer>
    </>
  );
}
