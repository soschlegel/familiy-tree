import Link from "next/link";

import type { KinshipCard, KinshipConnectionView, KinshipPathStep } from "@/lib/services/kinship-view";

/**
 * Zeichnung der Verbindung auf „Wie sind wir verwandt?“ — reines HTML/CSS,
 * ohne Skript und ohne Bibliothek (läuft als Server-Komponente).
 *
 * - Blutsverwandte (`KinshipBloodDiagram`): oben die gemeinsamen Vorfahren,
 *   darunter links die Linie hinab zur ersten, rechts die zur zweiten
 *   Person. Auf dem Telefon dieselbe Kette als eine Spalte von der ersten
 *   Person hinauf und wieder hinab.
 * - Angeheiratete und andere Wege (`KinshipPathDiagram`): eine Spalte mit
 *   den Schritten des kürzesten Wegs, Ehe-Schritte eigens gekennzeichnet.
 *
 * Jede Verbindung trägt ihre Bezeichnung als Text („Tochter“, „Ehefrau“);
 * die Linienart (durchgezogen, gestrichelt, doppelt) ist nur Zusatz. Die
 * Kette steht außerdem als Textliste für Screenreader da.
 */

export type Roles = { a: string; b: string };

type Step = { card: KinshipCard; label: string | null; style: LinkStyle };
type LinkStyle = "blood" | "other" | "partner";

const styleOf = (relation: "parent" | "child" | "partner", subtype: string): LinkStyle =>
  relation === "partner" ? "partner" : subtype === "BIOLOGICAL" ? "blood" : "other";

const STEM: Record<LinkStyle, string> = {
  blood: "border-l-2 border-solid border-stone-400 dark:border-stone-500",
  other: "border-l-2 border-dashed border-stone-400 dark:border-stone-500",
  partner: "border-l-4 border-double border-accent-600 dark:border-accent-400",
};

function PersonCard({ card, role }: { card: KinshipCard; role?: string }) {
  if (card.restricted) {
    return (
      <div
        className="kinship-restricted w-full max-w-[15rem] rounded-xl border border-dashed border-stone-400 px-3 py-2 text-center text-sm dark:border-stone-600"
        data-testid="kinship-card-restricted"
      >
        <span className="rounded bg-surface px-1.5 py-0.5 text-stone-700 dark:text-stone-300">Nicht freigegeben</span>
      </div>
    );
  }
  return (
    <Link
      href={`/people/${card.id}`}
      className={`block w-full max-w-[15rem] rounded-xl border bg-surface px-3 py-2 text-center shadow-card transition hover:border-accent-500 max-md:min-h-11 ${
        role ? "border-brass-500 ring-1 ring-brass-400 dark:border-brass-400" : "border-stone-200 dark:border-stone-700"
      }`}
      data-testid="kinship-card"
    >
      {role && <span className="eyebrow block">{role}</span>}
      <span className="block break-words font-medium leading-snug">{card.name}</span>
      {card.lifespan && <span className="block text-xs muted">{card.lifespan}</span>}
    </Link>
  );
}

function Connector({ label, style }: { label: string | null; style: LinkStyle }) {
  return (
    <div className="flex flex-col items-center" data-testid="kinship-link">
      <span aria-hidden className={`h-3 w-0 ${STEM[style]}`} />
      {label && (
        <span className="rounded-full border border-stone-200 bg-paper px-2 py-0.5 text-xs dark:border-stone-700">
          {style === "partner" && (
            <span aria-hidden className="mr-1">
              ⚭
            </span>
          )}
          {label}
        </span>
      )}
      <span aria-hidden className={`h-3 w-0 ${STEM[style]}`} />
    </div>
  );
}

/** Senkrechte Kette: Karte, Verbindung, Karte … */
function Column({ steps, roles }: { steps: Step[]; roles?: Map<number, string> }) {
  return (
    <div className="flex flex-col items-center">
      {steps.map((s, i) => (
        <div key={i} className="flex w-full flex-col items-center">
          {i > 0 && <Connector label={s.label} style={s.style} />}
          <PersonCard card={s.card} role={roles?.get(i)} />
        </div>
      ))}
    </div>
  );
}

const cardText = (c: KinshipCard) => (c.restricted ? "nicht freigegebene Person" : `${c.name}${c.lifespan ? ` (${c.lifespan})` : ""}`);

function SrList({ items }: { items: string[] }) {
  return (
    <div className="sr-only">
      <p>Die Verbindung als Liste:</p>
      <ol>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </div>
  );
}

function pairText(subtype: string | null): string {
  if (subtype === "MARRIED") return "verheiratet";
  if (subtype === "DIVORCED") return "geschieden";
  if (subtype) return "Paar";
  return "gemeinsame Eltern";
}

function AncestorRow({ conn, roles, aIsTop, bIsTop }: { conn: KinshipConnectionView; roles: Roles; aIsTop: boolean; bIsTop: boolean }) {
  const [first, second] = conn.ancestors;
  const role = (i: number) => (i === 0 && aIsTop ? roles.a : i === 0 && bIsTop ? roles.b : undefined);
  return (
    <div className="flex flex-col items-center">
      <p className="eyebrow mb-1">{conn.ancestors.length > 1 ? "Gemeinsame Vorfahren" : aIsTop || bIsTop ? "Vorfahr" : "Gemeinsamer Vorfahr"}</p>
      <div className="flex w-full flex-col items-center justify-center gap-1 sm:flex-row sm:gap-2">
        <PersonCard card={first} role={role(0)} />
        {second && (
          <>
            <span className="text-sm muted" title={pairText(conn.pairSubtype)}>
              {conn.pairSubtype === "MARRIED" ? (
                <>
                  <span aria-hidden>⚭</span>
                  <span className="sr-only">verheiratet mit</span>
                </>
              ) : (
                "und"
              )}
            </span>
            <PersonCard card={second} />
          </>
        )}
      </div>
    </div>
  );
}

/** Kette als eine Spalte: erste Person hinauf zu den Vorfahren, dann hinab zur zweiten. */
function bloodChain(conn: KinshipConnectionView): { up: Step[]; down: Step[] } {
  // Hinauf: A zuerst; die Verbindung zur nächsthöheren Person trägt deren Rolle („Vater“).
  const up: Step[] = [];
  const lineA = [...conn.lineA].reverse();
  lineA.forEach((s, i) => {
    up.push({ card: s.card, label: i === 0 ? null : lineA[i - 1].parentLabel, style: styleOf("parent", lineA[i - 1]?.subtype ?? "BIOLOGICAL") });
  });
  const down: Step[] = conn.lineB.map((s) => ({ card: s.card, label: s.childLabel, style: styleOf("child", s.subtype) }));
  return { up, down };
}

export function KinshipBloodDiagram({ conn, roles, testId = "kinship-diagram" }: { conn: KinshipConnectionView; roles: Roles; testId?: string }) {
  const aIsTop = conn.lineA.length === 0;
  const bIsTop = conn.lineB.length === 0;
  const colA: Step[] = conn.lineA.map((s) => ({ card: s.card, label: s.childLabel, style: styleOf("child", s.subtype) }));
  const colB: Step[] = conn.lineB.map((s) => ({ card: s.card, label: s.childLabel, style: styleOf("child", s.subtype) }));
  const lastRole = (n: number, role: string) => new Map([[n - 1, role]]);
  const { up, down } = bloodChain(conn);
  const topLink = conn.lineA[0];

  const sr: string[] = [];
  for (const [i, s] of up.entries()) sr.push(i === 0 ? `${roles.a}: ${cardText(s.card)}` : `${s.label}: ${cardText(s.card)}`);
  const ancestorsText = conn.ancestors.map(cardText).join(" und ");
  if (aIsTop) sr.push(`${roles.a}: ${ancestorsText}`);
  else if (bIsTop) sr.push(`${topLink.parentLabel}: ${ancestorsText} — ${roles.b}`);
  else sr.push(`${topLink.parentLabel}, ${conn.ancestors.length > 1 ? "gemeinsame Vorfahren" : "gemeinsamer Vorfahr"}: ${ancestorsText}`);
  for (const [i, s] of down.entries()) {
    sr.push(`${s.label}: ${cardText(s.card)}${i === down.length - 1 ? ` — ${roles.b}` : ""}`);
  }

  const both = colA.length > 0 && colB.length > 0;
  return (
    <div data-testid={testId}>
      {/* Breite Ansicht: Gabel mit zwei Linien */}
      <div className="hidden sm:block" role="group" aria-label="Zeichnung der Verbindung">
        <AncestorRow conn={conn} roles={roles} aIsTop={aIsTop} bIsTop={bIsTop} />
        {both ? (
          <>
            <div aria-hidden className="relative h-5">
              <span className={`absolute left-1/2 top-0 h-2.5 w-0 ${STEM.blood}`} />
              <span className="absolute left-1/4 right-1/4 top-2.5 border-t-2 border-stone-400 dark:border-stone-500" />
              <span className={`absolute left-1/4 top-2.5 h-2.5 w-0 ${STEM.blood}`} />
              <span className={`absolute left-3/4 top-2.5 h-2.5 w-0 ${STEM.blood}`} />
            </div>
            <div className="grid grid-cols-2 items-start gap-4">
              <ColumnWithLead steps={colA} roles={lastRole(colA.length, roles.a)} />
              <ColumnWithLead steps={colB} roles={lastRole(colB.length, roles.b)} />
            </div>
          </>
        ) : (
          <ColumnWithLead
            steps={colA.length > 0 ? colA : colB}
            roles={colA.length > 0 ? lastRole(colA.length, roles.a) : lastRole(colB.length, roles.b)}
          />
        )}
      </div>

      {/* Schmale Ansicht: eine Spalte */}
      <div className="sm:hidden" role="group" aria-label="Zeichnung der Verbindung">
        {up.length > 0 && <Column steps={up} roles={new Map([[0, roles.a]])} />}
        {up.length > 0 && <Connector label={topLink.parentLabel} style={styleOf("parent", topLink.subtype)} />}
        <AncestorRow conn={conn} roles={roles} aIsTop={aIsTop} bIsTop={bIsTop} />
        {down.length > 0 && <ColumnWithLead steps={down} roles={lastRole(down.length, roles.b)} />}
      </div>

      <SrList items={sr} />
    </div>
  );
}

/** Spalte, deren erste Karte schon eine Verbindung nach oben hat. */
function ColumnWithLead({ steps, roles }: { steps: Step[]; roles?: Map<number, string> }) {
  return (
    <div className="flex flex-col items-center">
      {steps.map((s, i) => (
        <div key={i} className="flex w-full flex-col items-center">
          <Connector label={s.label} style={s.style} />
          <PersonCard card={s.card} role={roles?.get(i)} />
        </div>
      ))}
    </div>
  );
}

export function KinshipPathDiagram({ path, roles }: { path: KinshipPathStep[]; roles: Roles }) {
  const steps: Step[] = path.map((s) => ({
    card: s.card,
    label: s.link?.label ?? null,
    style: s.link ? styleOf(s.link.relation, s.link.subtype) : "blood",
  }));
  const sr = steps.map((s, i) =>
    i === 0 ? `${roles.a}: ${cardText(s.card)}` : `${s.label}: ${cardText(s.card)}${i === steps.length - 1 ? ` — ${roles.b}` : ""}`,
  );
  return (
    <div data-testid="kinship-diagram">
      <div role="group" aria-label="Zeichnung der Verbindung" className="mx-auto max-w-sm">
        <Column steps={steps} roles={new Map([[0, roles.a], [steps.length - 1, roles.b]])} />
      </div>
      <SrList items={sr} />
    </div>
  );
}

/** Zeichenerklärung — die Bezeichnungen an den Verbindungen sagen dasselbe in Worten. */
export function KinshipLegend({ partner }: { partner: boolean }) {
  const item = (style: LinkStyle, text: string) => (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`inline-block h-4 w-0 ${STEM[style]}`} />
      {text}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs muted" aria-label="Zeichenerklärung">
      {item("blood", "leibliche Eltern und Kinder")}
      {item("other", "Adoptiv-, Stief- oder Pflegeeltern")}
      {partner && item("partner", "Ehe oder Partnerschaft (⚭ = verheiratet)")}
      <li className="flex items-center gap-2">
        <span aria-hidden className="kinship-restricted inline-block h-4 w-6 rounded border border-dashed border-stone-400" />
        nicht freigegebene Person
      </li>
    </ul>
  );
}
