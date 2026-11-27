/**
 * Ansicht „Ringe“, Richtung „Nachfahren“: die Nachkommen einer Person als
 * Vollkreis von innen nach außen — Mitte die Person, im ersten Ring ihre
 * Kinder, dann Enkel, Urenkel … Reine Funktionen ohne Datenbank und ohne
 * Rechteprüfung — Laden und Sichtbarkeit macht
 * lib/services/descendant-rings.ts, gezeichnet wird (gemeinsam mit den
 * Vorfahren) in components/AncestorRings.tsx. Geometrie und Beschriftung
 * teilen sich beide Richtungen (lib/ancestor-rings.ts). Fachliche Regeln:
 * docs/komponenten/bibliotheken.md („lib/descendant-rings.ts“).
 *
 * Aufteilung (Entscheidung des Eigentümers):
 * - Keine festen Plätze: Der Vollkreis wird unter den Kindern aufgeteilt,
 *   gewichtet nach der Größe ihres Teilbaums in der gezeigten Tiefe (die
 *   Person selbst plus ihre gezeigten Nachkommen — so zählt jede Person
 *   mindestens sich selbst, kinderlose Kinder bleiben sichtbar). Jede Person
 *   gibt ihren Bogen genauso vollständig an ihre Kinder weiter.
 * - Reihenfolge im Uhrzeigersinn ab 9 Uhr: Kinder nach Partnerschaft
 *   gruppiert (Gruppen in der Reihenfolge ihres ältesten Kindes), darin nach
 *   der Geburt; ohne Datum stabil nach Anlage. Zwischen zwei Gruppen bleibt
 *   eine kleine Lücke.
 * - Jeder Bogen ist mindestens MIN_SPAN_DEG breit, solange der Bogen der
 *   Eltern das hergibt — sehr schmale Flächen bleiben antippbar.
 * - Mehrfach-Nachkomme (Ehe unter Verwandten): erscheint an jeder Stelle,
 *   über die er Nachkomme ist. Zyklen (fehlerhafte Daten): ein Kind, das
 *   schon auf dem eigenen Weg zur Mitte liegt, wird übergangen.
 * - Nicht sichtbarer Nachkomme: eine Fläche „nicht freigegeben“ ohne
 *   Kennung; seine Kinder werden nicht gefragt, im Gewicht zählt er als eine
 *   Person.
 * - Obergrenze: Mehr als DESCENDANT_RINGS_MAX_SEGMENTS Flächen werden nicht
 *   gezeichnet — dann entfallen die äußeren Generationen ganz (die Kinder
 *   der Mitte immer gezeigt), und die Ansicht sagt es.
 */

import { bloodRelationTerm, type Sex } from "./kinship";

export const DESCENDANT_RINGS_DEFAULT_GENERATION = 4;
/** Höchstzahl gezeichneter Flächen (Leistung und Lesbarkeit). */
export const DESCENDANT_RINGS_MAX_SEGMENTS = 400;
/** Mindestbreite eines Bogens in Grad (soweit der Bogen der Eltern reicht). */
export const MIN_SPAN_DEG = 0.6;
/** Lücke zwischen den Kindergruppen zweier Partnerschaften in Grad (höchstens). */
export const GROUP_GAP_DEG = 1.6;

/** Kind in der Reihenfolge, wie es der Dienst liefert (sortiert nach Geburt, sonst Anlage). */
export type RingChild = {
  id: string;
  /** Adoptivkind (statt leiblich) dieses Elternteils. */
  adopted: boolean;
  /** Schlüssel der Partnerschaft: die übrigen Eltern des Kindes, sortiert (leer: unbekannt). */
  group: string;
};

export type DescendantGraph = {
  rootId: string;
  generations: number;
  /** Kinder einer sichtbaren Person, sortiert nach Geburt (ohne Datum nach Anlage). */
  childrenOf: (id: string) => readonly RingChild[];
  /** Darf der Benutzer diese Person sehen? */
  visible: (id: string) => boolean;
  /** Obergrenze der Flächen (Standard DESCENDANT_RINGS_MAX_SEGMENTS). */
  maxSegments?: number;
};

export type DescendantSegment = {
  /** Schlüssel `Generation:Nummer` — Nummer im Uhrzeigersinn innerhalb des Rings. */
  key: string;
  generation: number;
  /** Winkel in Grad (SVG, im Uhrzeigersinn, ab 180° = 9 Uhr). */
  start: number;
  end: number;
  /** Nummer des Kindes der Mitte, unter dem die Fläche liegt (Färbung „nach Linie“). */
  line: number;
  /** Schlüssel der Fläche des Elternteils (Generation 1: null). */
  parentKey: string | null;
  /** Adoptivkind des Elternteils. */
  adopted: boolean;
} & ({ kind: "person"; personId: string } | { kind: "restricted" });

export type DescendantLayout = {
  segments: DescendantSegment[];
  /** Gezeigte Tiefe: `generations`, bei greifender Obergrenze weniger. */
  shownGenerations: number;
  /** Tiefste Generation mit mindestens einer Fläche (0: keine Nachkommen). */
  deepest: number;
  /** Die Obergrenze hat Generationen abgeschnitten. */
  capped: boolean;
};

type Node = {
  generation: number;
  parent: Node | null;
  child: RingChild | null;
  visible: boolean;
  children: Node[];
  weight: number;
};

const onPath = (node: Node, id: string) => {
  for (let n: Node | null = node; n; n = n.parent) if (n.child ? n.child.id === id : false) return true;
  return false;
};

/**
 * Flächen der Nachfahren-Ringe, nach Generation und im Uhrzeigersinn
 * sortiert (innen nach außen). Regeln im Kopf dieser Datei.
 */
export function layoutDescendants(graph: DescendantGraph): DescendantLayout {
  const n = Math.max(1, Math.floor(graph.generations));
  const cap = Math.max(1, graph.maxSegments ?? DESCENDANT_RINGS_MAX_SEGMENTS);
  const root: Node = { generation: 0, parent: null, child: null, visible: true, children: [], weight: 1 };

  // Generation für Generation aufbauen; bricht die nächste die Obergrenze,
  // bleibt sie (und alles dahinter) weg.
  let frontier = [root];
  let total = 0;
  let shown = 0;
  let capped = false;
  for (let g = 1; g <= n && frontier.length; g++) {
    const next: Node[] = [];
    const pending: [Node, Node[]][] = [];
    for (const parent of frontier) {
      if (!parent.visible) continue;
      const seen = new Set<string>();
      const kids: Node[] = [];
      for (const c of groupChildren(graph.childrenOf(parent.child?.id ?? graph.rootId))) {
        // Doppelte Einträge zählen einmal; Zyklus: wer schon auf dem Weg liegt, fällt weg.
        if (seen.has(c.id) || c.id === graph.rootId || onPath(parent, c.id)) continue;
        seen.add(c.id);
        kids.push({ generation: g, parent, child: c, visible: graph.visible(c.id), children: [], weight: 1 });
      }
      pending.push([parent, kids]);
      next.push(...kids);
    }
    if (g > 1 && total + next.length > cap) {
      capped = next.length > 0;
      break;
    }
    for (const [parent, kids] of pending) parent.children = kids;
    total += next.length;
    if (next.length) shown = g;
    frontier = next;
  }

  // Gewicht: die Person selbst plus alle gezeigten Nachkommen.
  const weigh = (node: Node): number => {
    node.weight = 1 + node.children.reduce((s, c) => s + weigh(c), 0);
    return node.weight;
  };
  weigh(root);

  const segments: DescendantSegment[] = [];
  const counters = new Map<number, number>();
  const place = (node: Node, start: number, end: number, line: number, parentKey: string | null) => {
    const spans = splitArc(
      end - start,
      node.children.map((c) => ({ weight: c.weight, group: c.child!.group })),
    );
    node.children.forEach((c, i) => {
      const lineOf = node === root ? i : line;
      const ordinal = counters.get(c.generation) ?? 0;
      counters.set(c.generation, ordinal + 1);
      const key = `${c.generation}:${ordinal}`;
      const s = start + spans[i].start;
      const e = start + spans[i].end;
      const base = { key, generation: c.generation, start: s, end: e, line: lineOf, parentKey, adopted: c.child!.adopted };
      segments.push(c.visible ? { ...base, kind: "person", personId: c.child!.id } : { ...base, kind: "restricted" });
      place(c, s, e, lineOf, key);
    });
  };
  // Tiefensuche vergibt Nummern je Ring in Winkelreihenfolge, weil Kinder
  // immer innerhalb des Bogens ihrer Eltern und in deren Reihenfolge liegen.
  place(root, 180, 540, 0, null);
  segments.sort((a, b) => a.generation - b.generation || a.start - b.start);
  return { segments, shownGenerations: capped ? shown : n, deepest: shown, capped };
}

/**
 * Teilt einen Bogen (`span` Grad) unter Kindern auf: Gruppenlücken zwischen
 * verschiedenen Partnerschaften (nur wenn Platz ist), jedem Kind zuerst die
 * Mindestbreite, der Rest nach Gewicht. Reicht der Bogen nicht einmal für
 * die Mindestbreiten, wird gleichmäßig geteilt. Ergebnis: Anfang und Ende
 * relativ zum Bogenanfang, lückenlos bis auf die Gruppenlücken.
 */
export function splitArc(span: number, kids: readonly { weight: number; group: string }[]): { start: number; end: number }[] {
  const k = kids.length;
  if (k === 0) return [];
  let boundaries = 0;
  for (let i = 1; i < k; i++) if (kids[i].group !== kids[i - 1].group) boundaries++;
  // Lücke höchstens GROUP_GAP_DEG und zusammen höchstens ein Zehntel des Bogens.
  const gap = boundaries ? Math.min(GROUP_GAP_DEG, (span * 0.1) / boundaries) : 0;
  const usable = span - gap * boundaries;
  const totalWeight = kids.reduce((s, c) => s + Math.max(1, c.weight), 0);
  const floor = usable >= MIN_SPAN_DEG * k ? MIN_SPAN_DEG : 0;
  const rest = usable - floor * k;
  const out: { start: number; end: number }[] = [];
  let at = 0;
  kids.forEach((c, i) => {
    if (i > 0 && c.group !== kids[i - 1].group) at += gap;
    const width = floor + (rest * Math.max(1, c.weight)) / totalWeight;
    out.push({ start: at, end: at + width });
    at += width;
  });
  return out;
}

/**
 * Kinder nach Partnerschaft gruppieren: Gruppen in der Reihenfolge ihres
 * ersten (ältesten) Kindes, innerhalb der Gruppe die Eingabereihenfolge
 * (nach Geburt). Stabil.
 */
export function groupChildren<T extends { group: string }>(children: readonly T[]): T[] {
  const order: string[] = [];
  const byGroup = new Map<string, T[]>();
  for (const c of children) {
    const list = byGroup.get(c.group);
    if (list) list.push(c);
    else {
      byGroup.set(c.group, [c]);
      order.push(c.group);
    }
  }
  return order.flatMap((g) => byGroup.get(g)!);
}

/** Verwandtschaftsstufe aus Sicht der Mitte: „Tochter“, „Enkel“, „Urenkelin“ … */
export function descendantRelationTerm(generation: number, sex: Sex): string {
  return bloodRelationTerm({ up: 0, down: Math.max(1, generation), sex, side: null });
}

/**
 * Zusammenfassung unter dem Kreis: „47 Nachkommen in 4 Generationen“
 * (+ „, davon 2 nicht freigegeben“). `count` zählt jede Person einmal.
 */
export function descendantsSummary(count: number, generations: number, restricted: number): string {
  if (count === 0) return "Keine Nachkommen erfasst";
  const who = count === 1 ? "1 Nachkomme" : `${count} Nachkommen`;
  const gens = generations === 1 ? "1 Generation" : `${generations} Generationen`;
  const base = `${who} in ${gens}`;
  return restricted > 0 ? `${base}, davon ${restricted} nicht freigegeben` : base;
}

/** Hinweis, wenn die Obergrenze Generationen abgeschnitten hat. */
export function descendantsCapNotice(shown: number, requested: number): string {
  return `Sehr viele Nachkommen: Damit die Ansicht flüssig bleibt, siehst du ${shown} statt ${requested} Generationen.`;
}
