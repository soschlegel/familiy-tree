/**
 * Reine Graph-Algorithmen über Eltern- und Partnerkanten — ohne Datenbank,
 * ohne Rechteprüfung. Die Dienste in lib/services laden die Daten, rufen diese
 * Funktionen auf und maskieren das Ergebnis; dadurch sind die Algorithmen
 * selbst ohne Datenbank testbar.
 *
 * Alle Durchläufe sind iterativ und merken sich besuchte Knoten — fehlerhafte
 * Daten mit Zyklen dürfen nicht zu Endlosschleifen führen.
 */

export type GraphEdge = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  /** PARENT_OF: Elternteil; PARTNER_OF: eine der beiden Seiten. */
  from: string;
  /** PARENT_OF: Kind; PARTNER_OF: die andere Seite. */
  to: string;
};

export type GraphIndex = {
  parentsOf: Map<string, GraphEdge[]>;
  childrenOf: Map<string, GraphEdge[]>;
  partnersOf: Map<string, GraphEdge[]>;
};

export function buildGraphIndex(edges: GraphEdge[]): GraphIndex {
  const parentsOf = new Map<string, GraphEdge[]>();
  const childrenOf = new Map<string, GraphEdge[]>();
  const partnersOf = new Map<string, GraphEdge[]>();
  const push = (m: Map<string, GraphEdge[]>, k: string, e: GraphEdge) => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };

  for (const e of edges) {
    if (e.type === "PARENT_OF") {
      push(parentsOf, e.to, e);
      push(childrenOf, e.from, e);
    } else {
      push(partnersOf, e.from, e);
      push(partnersOf, e.to, e);
    }
  }
  return { parentsOf, childrenOf, partnersOf };
}

export type LineageEntry = {
  personId: string;
  /** 1 = Eltern bzw. Kinder, 2 = Großeltern bzw. Enkel, … */
  generation: number;
  /** Person, über die dieser Eintrag erreicht wurde (eine Generation näher). */
  viaPersonId: string;
  subtype: string;
  relationshipId: string;
};

function walk(
  index: GraphIndex,
  startId: string,
  generations: number,
  direction: "up" | "down",
): LineageEntry[] {
  const result: LineageEntry[] = [];
  const seen = new Set<string>([startId]);
  let frontier = [startId];

  for (let g = 1; g <= generations && frontier.length > 0; g++) {
    const next: string[] = [];
    for (const id of frontier) {
      const edges =
        direction === "up"
          ? (index.parentsOf.get(id) ?? [])
          : (index.childrenOf.get(id) ?? []);
      for (const e of edges) {
        const other = direction === "up" ? e.from : e.to;
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
        result.push({
          personId: other,
          generation: g,
          viaPersonId: id,
          subtype: e.subtype,
          relationshipId: e.id,
        });
      }
    }
    frontier = next;
  }

  return result;
}

/** Vorfahren bis zur angegebenen Generationentiefe (Breitensuche). */
export function ancestorsOf(
  index: GraphIndex,
  personId: string,
  generations: number,
): LineageEntry[] {
  return walk(index, personId, generations, "up");
}

/** Nachfahren bis zur angegebenen Generationentiefe (Breitensuche). */
export function descendantsOf(
  index: GraphIndex,
  personId: string,
  generations: number,
): LineageEntry[] {
  return walk(index, personId, generations, "down");
}

/** Wie die nächste Person im Pfad mit der vorigen verbunden ist. */
export type PathStep = {
  personId: string;
  /** null beim Startpunkt. */
  edge: null | {
    relationshipId: string;
    type: "PARENT_OF" | "PARTNER_OF";
    subtype: string;
    /**
     * Rolle DIESER Person gegenüber der vorigen: "parent" = ist Elternteil der
     * vorigen, "child" = ist Kind der vorigen, "partner" = ist Partner.
     */
    relation: "parent" | "child" | "partner";
  };
};

/**
 * Kürzester Verbindungsweg zweier Personen über Eltern- und Partnerkanten
 * (ungewichtete Breitensuche). Liefert null, wenn keine Verbindung besteht.
 * Bei gleich langen Wegen entscheidet die Reihenfolge der Kanten — das
 * Ergebnis ist für gleiche Daten also stabil.
 */
export function shortestPath(
  index: GraphIndex,
  fromId: string,
  toId: string,
  maxDepth = 50,
): PathStep[] | null {
  if (fromId === toId) return [{ personId: fromId, edge: null }];

  const previous = new Map<string, { from: string; step: PathStep }>();
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbours: PathStep[] = [
        ...(index.parentsOf.get(id) ?? []).map((e) => ({
          personId: e.from,
          edge: { relationshipId: e.id, type: e.type, subtype: e.subtype, relation: "parent" as const },
        })),
        ...(index.childrenOf.get(id) ?? []).map((e) => ({
          personId: e.to,
          edge: { relationshipId: e.id, type: e.type, subtype: e.subtype, relation: "child" as const },
        })),
        ...(index.partnersOf.get(id) ?? []).map((e) => ({
          personId: e.from === id ? e.to : e.from,
          edge: { relationshipId: e.id, type: e.type, subtype: e.subtype, relation: "partner" as const },
        })),
      ];

      for (const step of neighbours) {
        if (seen.has(step.personId)) continue;
        seen.add(step.personId);
        previous.set(step.personId, { from: id, step });
        if (step.personId === toId) {
          const path: PathStep[] = [];
          let cursor: string = toId;
          while (cursor !== fromId) {
            const entry = previous.get(cursor)!;
            path.push(entry.step);
            cursor = entry.from;
          }
          path.push({ personId: fromId, edge: null });
          return path.reverse();
        }
        next.push(step.personId);
      }
    }
    frontier = next;
  }

  return null;
}

/**
 * Würde die Kante parent -> child einen Zyklus erzeugen? Das ist der Fall,
 * wenn parent bereits Nachfahre von child ist (oder beide gleich sind).
 */
export function wouldCreateCycle(
  index: GraphIndex,
  parentId: string,
  childId: string,
): boolean {
  if (parentId === childId) return true;
  const seen = new Set<string>([childId]);
  const stack = [childId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of index.childrenOf.get(id) ?? []) {
      if (e.to === parentId) return true;
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}

export type SiblingEntry = {
  personId: string;
  /** full = alle Eltern gemeinsam (mind. zwei), half = nur ein Teil. */
  kind: "full" | "half";
  sharedParentIds: string[];
};

/** Geschwister: Personen mit mindestens einem gemeinsamen Elternteil. */
export function siblingsOf(index: GraphIndex, personId: string): SiblingEntry[] {
  const ownParents = new Set(
    (index.parentsOf.get(personId) ?? []).map((e) => e.from),
  );
  const shared = new Map<string, Set<string>>();

  for (const parentId of ownParents) {
    for (const e of index.childrenOf.get(parentId) ?? []) {
      if (e.to === personId) continue;
      const set = shared.get(e.to) ?? new Set<string>();
      set.add(parentId);
      shared.set(e.to, set);
    }
  }

  return [...shared.entries()].map(([id, parents]) => {
    const theirParents = new Set(
      (index.parentsOf.get(id) ?? []).map((e) => e.from),
    );
    const full =
      parents.size >= 2 &&
      parents.size === ownParents.size &&
      parents.size === theirParents.size;
    return {
      personId: id,
      kind: full ? "full" : "half",
      sharedParentIds: [...parents].sort(),
    };
  });
}
