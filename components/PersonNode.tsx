"use client";

import Link from "next/link";
import { createContext, useContext, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import {
  displayName,
  formatDate,
  lifeSpan,
  NODE_WIDTH,
  type MarriageInfo,
  type TreePerson,
} from "@/lib/tree-layout";
import {
  PARTNER_SUBTYPE_LABEL,
  PARTNER_SYMBOL,
  partnerLineStyle,
  partnerMarkerLabel,
  shortYear,
} from "@/lib/partner-labels";
import { LineCodes, LineStripe, lineTint, linesText, ReferenceContext } from "./ReferenceLines";
import { GENDER_INITIALS_BG, GENDER_RING } from "./gender-style";
import { plural } from "@/lib/plural";

/** Was jenseits des Ausschnitts liegt (nur Fokus-Ansicht). */
export type HiddenKin = { parents: number; children: number };

export type PersonNodeData = {
  person: TreePerson;
  partner: TreePerson | null;
  marriage: MarriageInfo | null;
  highlighted: boolean;
  dimmed: boolean;
  hasDescendants: boolean;
  /** Je Person der Karte: Eltern/Kinder außerhalb des Ausschnitts. */
  hidden?: Record<string, HiddenKin>;
};

/**
 * Wie eine Karte auf Klick reagiert — für alle Karten gleich, deshalb als
 * Kontext statt in jedem Knoten:
 *
 * - Gesamtbaum: Karte öffnet die Personenseite (wie bisher), die kleine
 *   Schaltfläche in der Ecke stellt die Person in die Fokus-Ansicht.
 * - Fokus-Ansicht: Karte stellt die Person in den Mittelpunkt, die Ecke
 *   öffnet die Personenseite. Die Karte der Fokusperson selbst öffnet die
 *   Personenseite — sie steht ja schon in der Mitte.
 */
export type TreeNav = {
  mode: "focus" | "full";
  focusId: string | null;
  focusHref: (personId: string) => string;
  /** Klick auf einen Fokus-Verweis; übernimmt die Navigation (mit Übergang). */
  onFocusClick: (event: MouseEvent<HTMLAnchorElement>, personId: string) => void;
};

export const TreeNavContext = createContext<TreeNav>({
  mode: "full",
  focusId: null,
  focusHref: (id) => `/tree?focus=${encodeURIComponent(id)}`,
  onFocusClick: () => {},
});

export function FocusIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10" cy="10" r="5.5" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
    </svg>
  );
}

export function OpenIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
      <path d="M11 3.5h5.5V9M16.5 3.5 9.5 10.5" />
    </svg>
  );
}

/**
 * Mitte der linken bzw. rechten Karte einer Doppelkarte, in Prozent der
 * Gesamtbreite. Aufbau: 180px Karte + 56px Verbindungsstück + 180px Karte.
 */
const LEFT_CARD = `${((NODE_WIDTH / 2) / (NODE_WIDTH * 2 + 56)) * 100}%`;
const RIGHT_CARD = `${((NODE_WIDTH + 56 + NODE_WIDTH / 2) / (NODE_WIDTH * 2 + 56)) * 100}%`;

function initials(p: TreePerson) {
  return (
    p.givenName.slice(0, 1) + (p.familyName?.slice(0, 1) ?? "")
  ).toUpperCase();
}

export function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
    </svg>
  );
}

function Card({
  person,
  highlighted,
  dimmed,
  hidden,
}: {
  person: TreePerson;
  highlighted: boolean;
  dimmed: boolean;
  hidden?: HiddenKin;
}) {
  const nav = useContext(TreeNavContext);
  const reference = useContext(ReferenceContext);
  const span = lifeSpan(person);
  const deceased = Boolean(person.deathDate);

  // Gesperrte Person: Platzhalter ohne Verweis. Der Baum bleibt zusammenhängend,
  // aber es gibt weder Namen noch eine Seite, die sich öffnen ließe — und sie
  // kann auch nicht in den Fokus rücken.
  if (person.restricted) {
    return (
      <div
        style={{ width: NODE_WIDTH }}
        data-testid="tree-person"
        data-person-id={person.id}
        data-restricted="true"
        title="Diese Person gehört zu einer Familie, für die du keine Freigabe hast."
        className={`flex items-center gap-2.5 rounded-2xl border border-dashed border-stone-300 bg-paper/70 p-2.5 dark:border-stone-700 ${
          dimmed ? "opacity-25" : "opacity-100"
        }`}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <LockIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-medium text-stone-500 dark:text-stone-400">
            Nicht freigegeben
          </div>
          <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-500">
            keine Angaben
          </div>
        </div>
      </div>
    );
  }

  const name = displayName(person);
  const isFocus = nav.mode === "focus" && nav.focusId === person.id;

  // Bezugsperson: Verwandtschaft unter der Karte, Ahnenlinie am Rand.
  const refView = reference.view;
  const isRef = refView?.id === person.id;
  const relative = refView?.relatives[person.id];
  const kinship = isRef ? (refView.isSelf ? "ich · Bezugsperson" : "Bezugsperson") : (relative?.term ?? null);
  const lines = reference.showLines && relative ? relative.lines : [];
  // In der Fokus-Ansicht stellt ein Klick die Person in den Mittelpunkt.
  const refocus = nav.mode === "focus" && !isFocus;
  const personHref = `/people/${person.id}`;

  const hiddenParents = hidden?.parents ?? 0;
  const hiddenChildren = hidden?.children ?? 0;
  const beyond = [
    hiddenParents > 0 ? "weitere Vorfahren" : null,
    hiddenChildren > 0 ? plural(hiddenChildren, "weiteres Kind", "weitere Kinder") : null,
  ].filter(Boolean);

  // Zweite Aktion in der Kartenecke: immer das, was der Klick auf die Karte
  // gerade NICHT tut. Bei der Fokusperson entfällt sie — dort führt die Karte
  // bereits zur Personenseite.
  const secondary =
    nav.mode === "full"
      ? {
          href: nav.focusHref(person.id),
          label: `${name} in der Fokus-Ansicht zeigen`,
          title: "In der Fokus-Ansicht zeigen",
          testId: "tree-person-focus",
          icon: <FocusIcon />,
          onClick: (e: MouseEvent<HTMLAnchorElement>) => nav.onFocusClick(e, person.id),
        }
      : refocus
        ? {
            href: personHref,
            label: `Personenseite von ${name} öffnen`,
            title: "Personenseite öffnen",
            testId: "tree-person-open",
            icon: <OpenIcon />,
            onClick: undefined,
          }
        : null;

  return (
    <div
      className="relative"
      style={{ width: NODE_WIDTH }}
      data-testid="tree-person"
      data-person-id={person.id}
      data-focus={isFocus ? "true" : undefined}
      data-reference={isRef ? "true" : undefined}
      data-kinship={relative?.term ?? undefined}
    >
    <Link
      href={refocus ? nav.focusHref(person.id) : personHref}
      onClick={refocus ? (e) => nav.onFocusClick(e, person.id) : undefined}
      data-person-id={person.id}
      data-testid="tree-person-main"
      aria-current={isFocus ? "true" : undefined}
      style={lineTint(lines)}
      className={`group/card relative flex items-center gap-2.5 rounded-2xl border bg-surface p-2.5 transition-[box-shadow,transform,opacity] duration-150 ${
        isFocus
          ? "border-accent-600 shadow-lift ring-4 ring-accent-500/30 dark:border-accent-300 dark:ring-accent-300/30"
          : highlighted
            ? "border-brass-400 shadow-lift ring-4 ring-brass-300/50 dark:border-brass-400 dark:ring-brass-500/30"
            : "border-stone-200 shadow-card hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-lift dark:border-stone-700 dark:hover:border-accent-600"
      } ${isRef ? "outline-dashed outline-2 outline-offset-[3px] outline-brass-500 dark:outline-brass-400" : ""} ${
        dimmed ? "opacity-25" : "opacity-100"
      }`}
    >
      <LineStripe lines={lines} />
      {person.primaryMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${person.primaryMediaId}?variant=thumb`}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          className={`h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-offset-2 ring-offset-surface ${GENDER_RING[person.gender]} ${
            deceased ? "grayscale-[45%] sepia-[20%]" : ""
          }`}
        />
      ) : (
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-serif text-sm font-semibold ring-2 ring-offset-2 ring-offset-surface ${GENDER_RING[person.gender]} ${GENDER_INITIALS_BG[person.gender]}`}
        >
          {initials(person)}
        </div>
      )}

      {/* Nur die erste Zeile weicht der Schaltfläche in der Ecke aus — die
          übrigen behalten die volle Breite, sonst bräche „um 1831 – vor 1900“
          um und die Karte würde höher als die Zeile. */}
      <div className="min-w-0 flex-1 leading-tight">
        <div className={`truncate text-[13.5px] font-semibold text-stone-900 dark:text-stone-50 ${secondary ? "pr-5" : ""}`}>
          {person.givenName}
        </div>
        {person.familyName && (
          <div className="truncate text-[12px] text-stone-600 dark:text-stone-300">
            {person.familyName}
          </div>
        )}
        {span && (
          // Auf getönter Karte (Linien) eine Stufe dunkler — sonst reicht der Kontrast nicht.
          <div
            className={`mt-0.5 truncate text-[11px] tabular-nums ${
              lines.length > 0 ? "text-stone-600 dark:text-stone-300" : "text-stone-500 dark:text-stone-400"
            }`}
          >
            {span}
            {deceased && !span.startsWith("†") && (
              <span aria-hidden title="verstorben" className="ml-1 font-serif text-stone-400 dark:text-stone-500">
                †
              </span>
            )}
          </div>
        )}
      </div>

      {/* Für Screenreader: was der Klick tut und was jenseits des Ausschnitts liegt. */}
      <span className="sr-only">
        {refocus ? " — in den Mittelpunkt stellen" : isFocus ? " — im Mittelpunkt; Personenseite öffnen" : ""}
        {beyond.length > 0 ? ` (${beyond.join(", ")})` : ""}
        {kinship ? ` — ${isRef ? kinship : `für ${refView!.name}: ${kinship}`}` : ""}
        {lines.length > 0 ? ` — ${linesText(lines)}` : ""}
      </span>

      {isFocus && (
        <span
          aria-hidden
          className="absolute -top-2.5 left-3 rounded-full bg-accent-700 px-1.5 py-px text-[10px] font-medium leading-4 text-white shadow-sm dark:bg-accent-300 dark:text-stone-950"
        >
          Im Fokus
        </span>
      )}
      {hiddenParents > 0 && (
        <span
          aria-hidden
          data-testid="tree-more-ancestors"
          title="Weitere Vorfahren — anklicken, um sie zu zeigen"
          className="absolute -top-2.5 left-3 rounded-full bg-surface px-1.5 py-px text-[10px] font-medium leading-4 text-stone-600 shadow-sm ring-1 ring-stone-300 dark:text-stone-300 dark:ring-stone-600"
        >
          ▲ Vorfahren
        </span>
      )}
      {hiddenChildren > 0 && (
        <span
          aria-hidden
          data-testid="tree-more-descendants"
          title={`${plural(hiddenChildren, "weiteres Kind", "weitere Kinder")} — anklicken, um sie zu zeigen`}
          className="absolute -bottom-2.5 left-3 rounded-full bg-surface px-1.5 py-px text-[10px] font-medium leading-4 text-stone-600 shadow-sm ring-1 ring-stone-300 dark:text-stone-300 dark:ring-stone-600"
        >
          ▼ +{plural(hiddenChildren, "Kind", "Kinder")}
        </span>
      )}
      <LineCodes lines={lines} className="absolute -top-2.5 right-8" />
    </Link>

    {kinship && (
      <span
        aria-hidden
        data-testid="tree-kinship"
        title={isRef ? kinship : `Für ${refView!.name}: ${kinship}`}
        className={`absolute left-1/2 top-full z-[1] mt-3 max-w-[176px] -translate-x-1/2 truncate rounded-full px-2 py-px text-[10.5px] font-medium leading-4 shadow-sm ring-1 ${
          isRef
            ? "bg-brass-100 text-brass-700 ring-brass-300 dark:bg-brass-700/40 dark:text-brass-300 dark:ring-brass-700"
            : "bg-surface text-stone-700 ring-stone-300 dark:text-stone-200 dark:ring-stone-600"
        } ${dimmed ? "opacity-25" : ""}`}
      >
        {kinship}
      </span>
    )}

    {secondary && (
      <Link
        href={secondary.href}
        onClick={secondary.onClick}
        data-person-id={person.id}
        data-testid={secondary.testId}
        aria-label={secondary.label}
        title={secondary.title}
        className="absolute right-1 top-1 z-[1] flex h-6 w-6 items-center max-md:before:absolute max-md:before:-inset-2.5 max-md:before:content-[''] justify-center rounded-full text-stone-400 transition hover:bg-accent-50 hover:text-accent-700 focus-visible:text-accent-700 dark:text-stone-500 dark:hover:bg-accent-900/50 dark:hover:text-accent-300"
      >
        {secondary.icon}
      </Link>
    )}
    </div>
  );
}

/**
 * Verbindungsstück zwischen zwei Ehepartnern: Datum und Hochzeitsbild.
 * Führt auf die Personenseite und öffnet dort direkt die Bildergalerie
 * dieser Ehe — sonst wäre der Marker eine Sackgasse.
 */
function MarriageLink({
  marriage,
}: {
  marriage: NonNullable<PersonNodeData["marriage"]>;
}) {
  const subtype = marriage.subtype;
  const muted = subtype === "DIVORCED" || subtype === "PARTNER_UNKNOWN";
  const label = partnerMarkerLabel(subtype);
  const when = marriage.date
    ? formatDate(marriage.date, marriage.datePrecision, marriage.dateQualifier, marriage.dateTo, marriage.dateToPrecision)
    : null;
  const year = marriage.date
    ? shortYear(marriage.date, marriage.datePrecision, marriage.dateQualifier, marriage.dateTo, marriage.dateToPrecision)
    : null;
  const line = partnerLineStyle(subtype);

  return (
    <Link
      href={`/people/${marriage.personId}?rel=${marriage.relationshipId}`}
      title={when ? `${label}: ${when} — Details ansehen` : `${label} — Details ansehen`}
      data-subtype={subtype}
      className="group/marriage flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-1 transition hover:bg-rose-50 dark:hover:bg-rose-950/40"
    >
      {marriage.primaryMediaId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${marriage.primaryMediaId}?variant=thumb`}
          alt=""
          title={when ? `${label}: ${when}` : `Bild zur ${subtype === "MARRIED" || subtype === "DIVORCED" ? "Ehe" : "Partnerschaft"}`}
          className="h-8 w-8 rounded-full object-cover ring-2 ring-rose-300"
        />
      ) : (
        <span
          className={`text-sm ${muted ? "text-stone-400" : "text-rose-400"}`}
          title={PARTNER_SUBTYPE_LABEL[subtype] ?? label}
        >
          {PARTNER_SYMBOL[subtype] ?? "♥"}
        </span>
      )}
      <svg aria-hidden className="mt-0.5 block h-1 w-full" preserveAspectRatio="none">
        <line x1="0" y1="1" x2="100%" y2="1" strokeWidth="1.5" stroke={line.stroke} strokeDasharray={line.dash} strokeLinecap={line.lineCap} />
      </svg>
      {year && (
        <span className="mt-0.5 text-[10px] tabular-nums text-stone-500 group-hover/marriage:text-stone-700 dark:text-stone-400 dark:group-hover/marriage:text-stone-300">
          {year}
        </span>
      )}
    </Link>
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
          className="pointer-events-none absolute bottom-0 left-1/2 top-1/2 w-px -translate-x-1/2 bg-stone-400 dark:bg-stone-500"
        />
      )}

      {/* Eindeutige Kennungen sind Pflicht: hat ein Knoten mehrere Anschlüsse
          desselben Typs, greift sich React Flow bei einer Kante ohne Angabe
          irgendeinen davon — die Abstammungslinie startete dadurch unter dem
          rechten Partner statt in der Mitte.

          Bei einer Doppelkarte gibt es zusätzlich je einen Anschluss über und
          unter jeder Hälfte: eine Linie zur Mitte würde behaupten, das Kind
          stamme vom Paar, obwohl nur einer der beiden Elternteil ist. */}
      <Handle
        id="parents-target"
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-stone-300"
      />
      {data.partner && (
        <>
          <Handle
            id="parents-target-left"
            type="target"
            position={Position.Top}
            style={{ left: LEFT_CARD }}
            className="!h-1.5 !w-1.5 !border-0 !bg-stone-300 !opacity-0"
          />
          <Handle
            id="parents-target-right"
            type="target"
            position={Position.Top}
            style={{ left: RIGHT_CARD }}
            className="!h-1.5 !w-1.5 !border-0 !bg-stone-300 !opacity-0"
          />
          <Handle
            id="children-source-left"
            type="source"
            position={Position.Bottom}
            style={{ left: LEFT_CARD }}
            className="!h-1.5 !w-1.5 !border-0 !bg-stone-300 !opacity-0"
          />
          <Handle
            id="children-source-right"
            type="source"
            position={Position.Bottom}
            style={{ left: RIGHT_CARD }}
            className="!h-1.5 !w-1.5 !border-0 !bg-stone-300 !opacity-0"
          />
        </>
      )}
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
        hidden={data.hidden?.[data.person.id]}
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
            hidden={data.hidden?.[data.partner.id]}
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
