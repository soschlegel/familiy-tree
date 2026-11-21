"use client";

import { createContext, type CSSProperties } from "react";

import { LINE_CODE, LINE_KEYS, LINE_LABEL, type LineKey, type ReferenceView } from "@/lib/reference";

/**
 * Bezugsperson im Baum: Verwandtschaft je Karte und die vier Ahnenlinien
 * (README, „Bezugsperson“). Als Kontext statt in den Knotendaten — so muss
 * React Flow beim Umschalten der Linien keine Knoten neu anlegen.
 */
export type TreeReference = {
  view: ReferenceView | null;
  /** Schalter „Linien“: Vorfahren nach Großeltern-Linie einfärben. */
  showLines: boolean;
};

export const ReferenceContext = createContext<TreeReference>({ view: null, showLines: false });

const color = (k: LineKey) => `var(--line-${k.toLowerCase()})`;
const onColor = (k: LineKey) => `var(--line-${k.toLowerCase()}-fg)`;

/**
 * Leichte Tönung der ganzen Karte in der Linienfarbe (wie bei MyHeritage),
 * bei mehreren Linien nebeneinander. Die Schrift bleibt lesbar: höchstens
 * 14 % Farbe über dem Kartenhintergrund, in beiden Farbschemata.
 */
export function lineTint(lines: LineKey[]): CSSProperties | undefined {
  if (lines.length === 0) return undefined;
  const tint = (k: LineKey) => `color-mix(in srgb, ${color(k)} 14%, rgb(var(--surface)))`;
  if (lines.length === 1) return { backgroundColor: tint(lines[0]) };
  const step = 100 / lines.length;
  return {
    backgroundImage: `linear-gradient(to right, ${lines.map((k, i) => `${tint(k)} ${i * step}% ${(i + 1) * step}%`).join(", ")})`,
  };
}

/** Senkrechter Farbstreifen am linken Kartenrand; mehrere Linien als Abschnitte. */
export function LineStripe({ lines }: { lines: LineKey[] }) {
  if (lines.length === 0) return null;
  const step = 100 / lines.length;
  const background =
    lines.length === 1
      ? color(lines[0])
      : `linear-gradient(to bottom, ${lines.map((k, i) => `${color(k)} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
  return (
    <span
      aria-hidden
      data-testid="tree-line-stripe"
      className="pointer-events-none absolute inset-y-2 left-0 w-1.5 rounded-r-full"
      style={{ background }}
    />
  );
}

/** Kurzzeichen der Linie(n) — damit die Zuordnung nie nur an der Farbe hängt. */
export function LineCodes({ lines, className = "" }: { lines: LineKey[]; className?: string }) {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 2);
  return (
    <span aria-hidden className={`flex gap-0.5 ${className}`} data-testid="tree-line-codes" data-lines={lines.join(" ")}>
      {shown.map((k) => (
        <LineCode key={k} line={k} />
      ))}
      {lines.length > shown.length && (
        <span className="rounded-full bg-surface px-1 text-[10px] font-semibold leading-4 ring-1 ring-stone-300 dark:ring-stone-600">
          +{lines.length - shown.length}
        </span>
      )}
    </span>
  );
}

export function LineCode({ line, style }: { line: LineKey; style?: CSSProperties }) {
  return (
    <span
      className="rounded-full px-1.5 text-[10px] font-semibold leading-4 tracking-wide shadow-sm"
      style={{ background: color(line), color: onColor(line), ...style }}
    >
      {LINE_CODE[line]}
    </span>
  );
}

/** Für Screenreader: „Linie Großvater väterlicherseits“. */
export function linesText(lines: LineKey[]): string {
  return lines.length === 0 ? "" : `Ahnenlinie ${lines.map((k) => LINE_LABEL[k]).join(" und ")}`;
}

/** Legende der Linien mit den Namen der vier Großeltern. */
export function LineLegend({ view }: { view: ReferenceView }) {
  return (
    <div data-testid="tree-line-legend" className="space-y-1">
      <p className="font-medium">Ahnenlinien von {view.name}</p>
      <ul className="space-y-1">
        {LINE_KEYS.map((k) => {
          const g = view.grandparents[k];
          return (
            <li key={k} className="flex items-center gap-2" data-line={k}>
              <span className="inline-flex w-7 justify-center">
                <LineCode line={k} />
              </span>
              <span className="min-w-0">
                <span className="muted">{LINE_LABEL[k]}:</span>{" "}
                {g ? <span className="font-medium">{g.name}</span> : <span className="muted">nicht erfasst</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="max-w-[16rem] text-[11px] muted">
        VV = Vater des Vaters, VM = Mutter des Vaters, MV = Vater der Mutter, MM = Mutter der Mutter.
        Alle anderen bleiben ohne Farbe.
      </p>
    </div>
  );
}
