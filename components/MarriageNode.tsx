"use client";

import { Handle, Position, type NodeProps } from "reactflow";

import { formatDate, type MarriageEvent } from "@/lib/tree-layout";
import { PARTNER_SYMBOL, partnerMarkerLabel } from "@/lib/partner-labels";

export type MarriageNodeData = {
  date: string;
  datePrecision?: MarriageEvent["datePrecision"];
  dateQualifier?: MarriageEvent["dateQualifier"];
  dateTo?: string | null;
  dateToPrecision?: MarriageEvent["dateToPrecision"];
  subtype: string;
  primaryMediaId: string | null;
  partnerNames: string;
  dimmed: boolean;
};

/**
 * Treffpunkt zweier Elternteile. Bewusst ein kleiner Punkt: hier laufen beide
 * Elternlinien zusammen und teilen sich von dort auf die Kinder auf, statt dass
 * jeder Elternteil einzeln zu jedem Kind zieht.
 */
export function JunctionNode({ data }: NodeProps<{ dimmed: boolean }>) {
  return (
    <div
      className={`transition-opacity ${data.dimmed ? "opacity-25" : "opacity-100"}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1 !w-1 !border-0 !bg-stone-300 !opacity-0"
      />
      <div className="h-2 w-2 rounded-full bg-stone-400 dark:bg-stone-500" />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1 !w-1 !border-0 !bg-stone-300 !opacity-0"
      />
    </div>
  );
}

/** Jahreszahl auf der Zeitachse. Als Knoten, damit sie mitzoomt und -wandert. */
export function YearNode({ data }: NodeProps<{ year: number }>) {
  return (
    <div className="pointer-events-none flex items-center gap-2">
      <span className="text-xs font-medium tabular-nums text-stone-400">
        {data.year}
      </span>
      <span className="h-px w-8 bg-stone-200 dark:bg-stone-800" />
    </div>
  );
}

/**
 * Hochzeit als eigenständiges Ereignis auf der Zeitachse — bewusst rund und
 * deutlich kleiner als eine Personenkarte, damit auf einen Blick klar ist,
 * dass hier ein Ereignis steht und keine Person.
 */
export function MarriageNode({ data }: NodeProps<MarriageNodeData>) {
  const label = partnerMarkerLabel(data.subtype);
  const muted = data.subtype === "DIVORCED" || data.subtype === "PARTNER_UNKNOWN";
  const when = formatDate(data.date, data.datePrecision, data.dateQualifier, data.dateTo, data.dateToPrecision);

  return (
    <div
      className={`flex flex-col items-center transition-opacity ${
        data.dimmed ? "opacity-25" : "opacity-100"
      }`}
      title={`${label}: ${data.partnerNames} — ${when}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-rose-300"
      />

      {data.primaryMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${data.primaryMediaId}?variant=thumb`}
          alt=""
          className="h-14 w-14 rounded-full object-cover shadow-md ring-2 ring-rose-400"
        />
      ) : (
        <div
          data-subtype={data.subtype}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-lg shadow-sm ring-2 ${
            muted
              ? "bg-stone-50 text-stone-500 ring-stone-300 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-600"
              : "bg-rose-50 ring-rose-300 dark:bg-rose-950"
          }`}
        >
          {PARTNER_SYMBOL[data.subtype] ?? "♥"}
        </div>
      )}

      <div className="mt-1 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium tabular-nums text-stone-600 shadow-sm dark:bg-stone-900/90 dark:text-stone-300">
        {when}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-rose-300"
      />
    </div>
  );
}
