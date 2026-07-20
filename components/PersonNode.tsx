"use client";

import Link from "next/link";
import { Handle, Position, type NodeProps } from "reactflow";

import {
  displayName,
  formatDate,
  lifeSpan,
  NODE_WIDTH,
  type TreePerson,
} from "@/lib/tree-layout";

export type PersonNodeData = {
  person: TreePerson;
  partner: TreePerson | null;
  marriage: {
    date: string | null;
    endDate: string | null;
    subtype: string;
    primaryMediaId: string | null;
  } | null;
  highlighted: boolean;
  dimmed: boolean;
  hasDescendants: boolean;
};

const ACCENT: Record<TreePerson["gender"], string> = {
  MALE: "bg-sky-400",
  FEMALE: "bg-rose-400",
  OTHER: "bg-violet-400",
  UNKNOWN: "bg-stone-300",
};

function initials(p: TreePerson) {
  return (
    p.givenName.slice(0, 1) + (p.familyName?.slice(0, 1) ?? "")
  ).toUpperCase();
}

function Card({
  person,
  highlighted,
  dimmed,
}: {
  person: TreePerson;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const span = lifeSpan(person);
  const deceased = Boolean(person.deathDate);

  return (
    <Link
      href={`/people/${person.id}`}
      style={{ width: NODE_WIDTH }}
      className={`group/card relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-white p-2.5 shadow-sm ring-1 transition-all dark:bg-stone-900 ${
        highlighted
          ? "shadow-lg ring-2 ring-amber-500"
          : "ring-stone-200 hover:shadow-md hover:ring-stone-300 dark:ring-stone-700 dark:hover:ring-stone-600"
      } ${dimmed ? "opacity-25" : "opacity-100"}`}
    >
      {/* Farbstreifen als Geschlechtsmarkierung — dezenter als ein Rahmen. */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${ACCENT[person.gender]}`}
      />

      {person.primaryMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${person.primaryMediaId}?variant=thumb`}
          alt=""
          className={`ml-1 h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-stone-800 ${
            deceased ? "grayscale-[35%]" : ""
          }`}
        />
      ) : (
        <div className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-500 ring-2 ring-white dark:bg-stone-800 dark:text-stone-400 dark:ring-stone-800">
          {initials(person)}
        </div>
      )}

      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-semibold">
          {displayName(person)}
        </div>
        {span && (
          <div className="mt-0.5 text-[11px] tabular-nums text-stone-500">
            {span}
          </div>
        )}
      </div>
    </Link>
  );
}

/** Verbindungsstück zwischen zwei Ehepartnern: Datum und Hochzeitsbild. */
function MarriageLink({
  marriage,
}: {
  marriage: NonNullable<PersonNodeData["marriage"]>;
}) {
  const divorced = marriage.subtype === "DIVORCED";
  const year = marriage.date ? new Date(marriage.date).getFullYear() : null;

  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center">
      {marriage.primaryMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${marriage.primaryMediaId}?variant=thumb`}
          alt=""
          title={
            marriage.date
              ? `Hochzeit am ${formatDate(marriage.date)}`
              : "Hochzeitsbild"
          }
          className="h-8 w-8 rounded-full object-cover ring-2 ring-rose-300"
        />
      ) : (
        <span
          className={`text-sm ${divorced ? "text-stone-400" : "text-rose-400"}`}
          title={divorced ? "geschieden" : "verheiratet"}
        >
          {divorced ? "⚯" : "♥"}
        </span>
      )}
      <div
        className={`mt-0.5 w-full border-t ${
          divorced
            ? "border-dashed border-stone-400"
            : "border-solid border-rose-300"
        }`}
      />
      {year && (
        <span className="mt-0.5 text-[10px] tabular-nums text-stone-400">
          {year}
        </span>
      )}
    </div>
  );
}

export function PersonNode({ data }: NodeProps<PersonNodeData>) {
  // Der Stiel setzt an der Ehe-Verbindung an — also zwischen beiden Partnern —
  // und führt von dort nach unten. Dadurch geht die Abstammungslinie sichtbar
  // aus dem Paar hervor und nicht aus einem der beiden Elternteile.
  const showStem = Boolean(data.partner) && data.hasDescendants;

  return (
    <div className="relative flex items-center">
      {showStem && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 top-1/2 w-px -translate-x-1/2 bg-stone-300"
        />
      )}

      {/* Eindeutige Kennungen sind Pflicht: hat ein Knoten mehrere Anschlüsse
          desselben Typs, greift sich React Flow bei einer Kante ohne Angabe
          irgendeinen davon — die Abstammungslinie startete dadurch unter dem
          rechten Partner statt in der Mitte. */}
      <Handle
        id="parents-target"
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-stone-300"
      />
      {/* Ehe-Anschlüsse sitzen unten: die Ehe-Kante führt unter der
          Kartenreihe herum, damit sie keine fremden Karten durchschneidet.
          Versetzt gegen den mittigen Abstammungs-Anschluss, damit sich die
          Linien am Kartenrand nicht überlagern. */}
      <Handle
        id="marriage-target"
        type="target"
        position={Position.Bottom}
        style={{ left: "30%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-rose-300 !opacity-0"
      />
      <Handle
        id="marriage-source"
        type="source"
        position={Position.Bottom}
        style={{ left: "70%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-rose-300 !opacity-0"
      />

      <Card
        person={data.person}
        highlighted={data.highlighted}
        dimmed={data.dimmed}
      />

      {data.partner && (
        <>
          {data.marriage ? (
            <MarriageLink marriage={data.marriage} />
          ) : (
            <div className="w-14 shrink-0 border-t border-stone-300" />
          )}
          <Card
            person={data.partner}
            highlighted={data.highlighted}
            dimmed={data.dimmed}
          />
        </>
      )}

      <Handle
        id="children-source"
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-stone-300"
      />
    </div>
  );
}
