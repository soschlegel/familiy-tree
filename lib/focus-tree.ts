import {
  ancestorsOf,
  buildGraphIndex,
  descendantsOf,
  siblingsOf,
  type GraphEdge,
  type GraphIndex,
} from "./graph";
import { layoutGenerations } from "./layout-generations";
import type { TreeData, TreePerson } from "./tree-layout";

/**
 * Fokus-Ansicht: eine Person in der Mitte, darüber N Generationen Vorfahren,
 * darunter N Generationen Nachkommen. Statt eines Gesamtbildes, das mit jeder
 * Person breiter wird, bleibt der Ausschnitt klein — gewandert wird per Klick.
 *
 * Alles hier arbeitet auf bereits maskierten Baumdaten (loadTree): gesperrte
 * Personen sind Platzhalter ohne Angaben, und der Ausschnitt kann nichts
 * preisgeben, was der Gesamtbaum nicht ohnehin zeigt.
 */

/**
 * Ansichten der Baumseite; „focus“ ist die Fokus-Ansicht, „rings“ die
 * Vorfahren als Vollkreis (components/AncestorRings.tsx).
 */
export type TreeView = "focus" | "generations" | "timeline" | "rings";

/** Cookie mit der zuletzt fokussierten Person — Einstieg beim nächsten Öffnen. */
export const FOCUS_COOKIE = "tree-focus";

/** Erlaubte Tiefe je Richtung — klein gehalten, sonst wäre es wieder der Gesamtbaum. */
export const FOCUS_DEPTH = { min: 1, max: 4, up: 2, down: 2 } as const;

export type FocusDepth = { up: number; down: number };

/** Tiefe aus einem URL-Parameter; Unsinn fällt auf den Standard zurück. */
export function parseDepth(raw: string | null | undefined, fallback: number): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isInteger(n)) return fallback;
  return Math.min(FOCUS_DEPTH.max, Math.max(FOCUS_DEPTH.min, n));
}

/**
 * Warum eine Person im Ausschnitt steht:
 * - focus: die Person im Mittelpunkt
 * - ancestor: Eltern, Großeltern, … (leiblich, adoptiv, Stief-, Pflege-)
 * - sibling: Geschwister und Halbgeschwister der Fokusperson
 * - descendant: Kinder, Enkel, …
 * - partner: Partner der Fokusperson bzw. eines Nachkommen sowie weitere
 *   Elternteile von Nachkommen (auch ohne erfasste Partnerschaft)
 */
export type FocusRole = "focus" | "ancestor" | "sibling" | "descendant" | "partner";

export type FocusMember = {
  role: FocusRole;
  /** Generation relativ zur Fokusperson: −1 Eltern, +1 Kinder. */
  generation: number;
  /** Eltern bzw. Kinder, die außerhalb des Ausschnitts liegen. */
  hiddenParents: number;
  hiddenChildren: number;
};

export type FocusTreeData = TreeData & {
  focusId: string;
  up: number;
  down: number;
  members: Record<string, FocusMember>;
};

function toIndex(data: TreeData): GraphIndex {
  const edges: GraphEdge[] = data.relationships.map((r) => ({
    id: r.id,
    type: r.type,
    subtype: r.subtype,
    from: r.fromPersonId,
    to: r.toPersonId,
  }));
  return buildGraphIndex(edges);
}

/** Mitglieder samt Rolle und relativer Generation (ohne Zählungen). */
function collectMembers(
  index: GraphIndex,
  byId: Map<string, TreePerson>,
  focusId: string,
  { up, down }: FocusDepth,
): Map<string, { role: FocusRole; generation: number }> {
  const members = new Map<string, { role: FocusRole; generation: number }>();
  // Die erste Zuordnung gewinnt: wer Vorfahre ist, bleibt Vorfahre, auch
  // wenn er zusätzlich als Partner erreichbar wäre.
  const add = (id: string, role: FocusRole, generation: number) => {
    if (!members.has(id) && byId.has(id)) members.set(id, { role, generation });
  };

  add(focusId, "focus", 0);
  for (const e of ancestorsOf(index, focusId, up)) add(e.personId, "ancestor", -e.generation);
  const descendants = descendantsOf(index, focusId, down);
  for (const e of descendants) add(e.personId, "descendant", e.generation);
  // Geschwister hängen an den Eltern — ohne sichtbare Eltern stünden sie
  // unverbunden daneben.
  if (up >= 1) for (const s of siblingsOf(index, focusId)) add(s.personId, "sibling", 0);

  // Partner der Fokusperson und der Nachkommen: sie erklären, woher die
  // nächste Generation kommt.
  for (const id of [focusId, ...descendants.map((d) => d.personId)]) {
    const own = members.get(id);
    if (!own) continue;
    for (const e of index.partnersOf.get(id) ?? []) {
      add(e.from === id ? e.to : e.from, "partner", own.generation);
    }
  }
  // Weitere Elternteile der Nachkommen, auch ohne erfasste Partnerschaft
  // (und Stief-/Adoptiveltern der Enkel).
  for (const d of descendants) {
    const own = members.get(d.personId);
    if (!own) continue;
    for (const e of index.parentsOf.get(d.personId) ?? []) add(e.from, "partner", own.generation - 1);
  }

  // Bei Ahnenschwund (dieselbe Person auf zwei Wegen) können Eltern und Kind
  // sonst auf einer Ebene landen. Kinder nach unten, Vorfahren nach oben
  // schieben, bis jede Linie abwärts zeigt — mit Obergrenze gegen Zyklen.
  for (let round = 0; round < members.size; round++) {
    let changed = false;
    for (const [childId, child] of members) {
      for (const e of index.parentsOf.get(childId) ?? []) {
        const parent = members.get(e.from);
        if (!parent || parent.generation < child.generation) continue;
        if (child.role === "ancestor" || child.role === "focus") parent.generation = child.generation - 1;
        else child.generation = parent.generation + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return members;
}

/**
 * Ausschnitt rund um eine Person. Liefert null, wenn es die Person nicht gibt
 * oder sie ein Platzhalter ist — gesperrte Personen können nicht in den Fokus
 * rücken.
 */
export function focusSubgraph(
  data: TreeData,
  focusId: string,
  depth: FocusDepth = { up: FOCUS_DEPTH.up, down: FOCUS_DEPTH.down },
  index: GraphIndex = toIndex(data),
): FocusTreeData | null {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const focus = byId.get(focusId);
  if (!focus || focus.restricted) return null;

  const members = collectMembers(index, byId, focusId, depth);

  const count = (edges: GraphEdge[] | undefined, pick: (e: GraphEdge) => string) =>
    new Set((edges ?? []).map(pick).filter((id) => !members.has(id))).size;

  const info: Record<string, FocusMember> = {};
  for (const [id, m] of members) {
    info[id] = {
      role: m.role,
      generation: m.generation,
      hiddenParents: count(index.parentsOf.get(id), (e) => e.from),
      hiddenChildren: count(index.childrenOf.get(id), (e) => e.to),
    };
  }

  return {
    focusId,
    up: depth.up,
    down: depth.down,
    // Reihenfolge der Eingangsdaten beibehalten — sie ist sortiert, und das
    // Layout hängt davon ab (Determinismus).
    persons: data.persons.filter((p) => members.has(p.id)),
    relationships: data.relationships.filter(
      (r) => members.has(r.fromPersonId) && members.has(r.toPersonId),
    ),
    members: info,
  };
}

/**
 * Startperson, wenn niemand vorgegeben ist: die sichtbare Person, deren
 * Ausschnitt die meisten Generationen und darin die meisten sichtbaren
 * Verwandten zeigt — also jemand aus der Mitte des Bestands statt eines
 * Stammvaters ganz oben oder eines Kindes ganz unten. Gleichstand entscheidet
 * die Reihenfolge der Daten, das Ergebnis ist also stabil.
 */
export function defaultFocusId(data: TreeData, depth: FocusDepth): string | null {
  const index = toIndex(data);
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  let best: { id: string; rows: number; visible: number } | null = null;

  for (const p of data.persons) {
    if (p.restricted) continue;
    const members = collectMembers(index, byId, p.id, depth);
    const rows = new Set<number>();
    let visible = 0;
    for (const [id, m] of members) {
      if (byId.get(id)?.restricted) continue;
      visible++;
      rows.add(m.generation);
    }
    if (
      !best ||
      rows.size > best.rows ||
      (rows.size === best.rows && visible > best.visible)
    ) {
      best = { id: p.id, rows: rows.size, visible };
    }
  }
  return best?.id ?? null;
}

/** Abstand zwischen den Kartenreihen in der Fokus-Ansicht. */
export const FOCUS_ROW_GAP = 92;

/**
 * Layout des Ausschnitts: dieselbe Engine wie die Generationenansicht, aber
 * mit fest vorgegebenen Ebenen (relative Generation statt Schätzung aus
 * Geburtsjahren) — die Fokusperson steht so immer in ihrer eigenen Zeile,
 * Eltern direkt darüber, Kinder direkt darunter.
 *
 * Ohne Ehen (Schalter „Ehen zeigen“) bleibt die reine Abstammung: Partner
 * ohne gemeinsames Kind im Ausschnitt fallen weg.
 */
export function layoutFocus(data: FocusTreeData, { showMarriages = true } = {}) {
  let persons = data.persons;
  let relationships = data.relationships;

  if (!showMarriages) {
    relationships = relationships.filter((r) => r.type !== "PARTNER_OF");
    const linked = new Set<string>();
    for (const r of relationships) {
      linked.add(r.fromPersonId);
      linked.add(r.toPersonId);
    }
    persons = persons.filter(
      (p) => data.members[p.id]?.role !== "partner" || linked.has(p.id),
    );
  }

  const generations = new Map<string, number>();
  for (const p of persons) generations.set(p.id, data.members[p.id]?.generation ?? 0);

  return layoutGenerations({ persons, relationships }, { generations, rowGap: FOCUS_ROW_GAP });
}
