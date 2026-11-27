/**
 * Verbindungen zweier Personen für die Seite „Wie sind wir verwandt?“ —
 * reine Funktionen ohne Datenbank und ohne Rechteprüfung (die maskiert der
 * Dienst lib/services/kinship-view.ts).
 *
 * Blutsverwandtschaft wird hier nicht neu definiert: Gezählt werden wie in
 * lib/kinship.ts leibliche und Adoptiv-Elternschaften (`ancestorDistances`).
 * Neu ist nur,
 *
 * - dass ALLE eigenständigen gemeinsamen Vorfahren(-paare) gesucht werden,
 *   nicht nur die nächsten (Ahnenschwund, doppelte Verwandtschaft), und
 * - dass zu jeder Verbindung die beiden Abstammungslinien als Personenkette
 *   gebaut werden (für die Zeichnung).
 *
 * Eigenständig heißt: Ein gemeinsamer Vorfahr X zählt nicht, wenn eines
 * seiner Kinder selbst gemeinsamer Vorfahr ist und auf BEIDEN Seiten genau
 * eine Generation näher liegt — dann ist X nur die Verlängerung dieser
 * Verbindung (die Eltern der gemeinsamen Großeltern sind keine eigene
 * Verbindung). Die nächste Verbindung ist damit immer dabei und entspricht
 * `findBloodRelation`.
 */
import type { GraphEdge, GraphIndex } from "./graph";
import { ancestorDistances, bloodRelationTerm, stepTerm, type Sex, type Side } from "./kinship";

/** Elternschaften, die eine Abstammungslinie begründen (wie lib/kinship.ts). */
const LINEAGE = new Set(["BIOLOGICAL", "ADOPTIVE"]);

const lineageParentEdges = (index: GraphIndex, id: string): GraphEdge[] =>
  (index.parentsOf.get(id) ?? [])
    .filter((e) => LINEAGE.has(e.subtype))
    // Leiblich vor adoptiv, sonst Reihenfolge der Daten — stabil.
    .sort((a, b) => Number(a.subtype !== "BIOLOGICAL") - Number(b.subtype !== "BIOLOGICAL"));

const lineageChildIds = (index: GraphIndex, id: string): string[] =>
  (index.childrenOf.get(id) ?? []).filter((e) => LINEAGE.has(e.subtype)).map((e) => e.to);

/**
 * Ein Schritt einer Abstammungslinie, von oben nach unten gelesen: die
 * Person und die Elternschaft zu der Person darüber.
 */
export type LineStep = {
  personId: string;
  /** Person eine Generation darüber (Elternteil). */
  parentId: string;
  /** Art der Elternschaft (BIOLOGICAL, ADOPTIVE). */
  subtype: string;
};

export type BloodConnection = {
  /** Generationen von A hinauf zu den gemeinsamen Vorfahren. */
  up: number;
  /** Generationen von den gemeinsamen Vorfahren hinab zu B. */
  down: number;
  /**
   * Die gemeinsamen Vorfahren dieser Verbindung (ein Paar oder eine
   * Person). Zuerst der, bei dem die Linie von A ankommt.
   */
  ancestorIds: string[];
  /** Nur ein gemeinsamer Vorfahr, obwohl beide Linien zwei Eltern kennen. */
  half: boolean;
  /** Keine der beiden Linien ist rein leiblich. */
  adoptive: boolean;
  /** Linie von den Vorfahren hinab zu A (letzter Schritt = A); leer, wenn A selbst der Vorfahr ist. */
  lineA: LineStep[];
  /** Linie von den Vorfahren hinab zu B (letzter Schritt = B); leer, wenn B selbst der Vorfahr ist. */
  lineB: LineStep[];
};

/**
 * Kürzeste Abstammungslinie von `startId` hinauf zu einer der Personen in
 * `targets` (Breitensuche nur über leibliche/Adoptiv-Eltern, leiblich
 * zuerst). Ergebnis von oben nach unten; null, wenn keine erreichbar ist.
 */
export function lineUp(
  index: GraphIndex,
  startId: string,
  targets: ReadonlySet<string>,
  maxDepth = 25,
): { top: string; steps: LineStep[] } | null {
  if (targets.has(startId)) return { top: startId, steps: [] };
  const via = new Map<string, { child: string; subtype: string }>();
  const seen = new Set([startId]);
  let frontier = [startId];
  for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of lineageParentEdges(index, id)) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        via.set(e.from, { child: id, subtype: e.subtype });
        if (targets.has(e.from)) {
          const steps: LineStep[] = [];
          let cursor = e.from;
          while (cursor !== startId) {
            const v = via.get(cursor)!;
            steps.push({ personId: v.child, parentId: cursor, subtype: v.subtype });
            cursor = v.child;
          }
          return { top: e.from, steps };
        }
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Alle eigenständigen Blutsverwandtschaften von A und B, die nächste zuerst
 * (Summe der Generationen, dann weniger Generationen über A, dann Kennung).
 * Leer, wenn es keine gemeinsamen Vorfahren gibt oder A gleich B ist.
 */
export function bloodConnections(
  index: GraphIndex,
  aId: string,
  bId: string,
  limit = 4,
  maxDepth = 25,
): BloodConnection[] {
  if (aId === bId || limit <= 0) return [];
  const ua = ancestorDistances(index, aId, maxDepth);
  const ub = ancestorDistances(index, bId, maxDepth);

  // Eigenständige gemeinsame Vorfahren.
  const own: string[] = [];
  for (const [id, a] of ua) {
    const b = ub.get(id);
    if (!b) continue;
    const extends_ = lineageChildIds(index, id).some(
      (c) => ua.get(c)?.distance === a.distance - 1 && ub.get(c)?.distance === b.distance - 1,
    );
    if (!extends_) own.push(id);
  }
  if (own.length === 0) return [];

  // Zu Verbindungen bündeln: gleiche Abstände und Paar (Partner oder
  // gemeinsames Kind) — so werden etwa Großvater und Großmutter eine
  // Verbindung, die Großelternpaare bei doppelter Cousinschaft zwei.
  const key = (id: string) => `${ua.get(id)!.distance}/${ub.get(id)!.distance}`;
  const parent = new Map(own.map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (x: string, y: string) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx < ry ? ry : rx, rx < ry ? rx : ry);
  };
  const ownSet = new Set(own);
  for (const id of own) {
    const partners = (index.partnersOf.get(id) ?? []).map((e) => (e.from === id ? e.to : e.from));
    const coParents = lineageChildIds(index, id).flatMap((c) => lineageParentEdges(index, c).map((e) => e.from));
    for (const other of [...partners, ...coParents]) {
      if (other !== id && ownSet.has(other) && key(other) === key(id)) union(id, other);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of own) {
    const r = find(id);
    const list = groups.get(r);
    if (list) list.push(id);
    else groups.set(r, [id]);
  }

  const result: BloodConnection[] = [];
  for (const members of groups.values()) {
    members.sort();
    const up = ua.get(members[0])!.distance;
    const down = ub.get(members[0])!.distance;
    const memberSet = new Set(members);
    const lineA = lineUp(index, aId, memberSet, maxDepth);
    const lineB = lineUp(index, bId, memberSet, maxDepth);
    if (!lineA || !lineB) continue; // nicht erwartbar: die Abstände stammen aus derselben Suche
    // Zuerst der Vorfahr, bei dem die Linie von A ankommt.
    const ancestorIds = [lineA.top, ...members.filter((m) => m !== lineA.top)];

    const adoptive = !members.some((id) => ua.get(id)!.biological && ub.get(id)!.biological);

    // Halb wie in findBloodRelation: ein Vorfahr, und direkt darunter kennen
    // beide Linien zwei Elternteile. Fehlt einer, ist es eine Datenlücke.
    let half = false;
    if (members.length === 1 && up >= 1 && down >= 1) {
      const belowA = lineA.steps[0]?.personId;
      const belowB = lineB.steps[0]?.personId;
      half =
        belowA !== undefined &&
        belowB !== undefined &&
        lineageParentEdges(index, belowA).length >= 2 &&
        lineageParentEdges(index, belowB).length >= 2;
    }

    result.push({ up, down, ancestorIds, half, adoptive, lineA: lineA.steps, lineB: lineB.steps });
  }

  result.sort(
    (x, y) =>
      x.up + x.down - (y.up + y.down) ||
      x.up - y.up ||
      (x.ancestorIds[0] < y.ancestorIds[0] ? -1 : x.ancestorIds[0] > y.ancestorIds[0] ? 1 : 0),
  );
  return result.slice(0, limit);
}

/**
 * Seite einer Linie aus Sicht der Person unten: über den Vater
 * „väterlicherseits“, über die Mutter „mütterlicherseits“. `sexOf` liefert
 * für nicht sichtbare Personen UNKNOWN — dann keine Seite.
 */
function sideOfLine(line: LineStep[], sexOf: (id: string) => Sex): Side {
  const last = line[line.length - 1];
  if (!last) return null;
  const sex = sexOf(last.parentId);
  return sex === "MALE" ? "paternal" : sex === "FEMALE" ? "maternal" : null;
}

/**
 * Bezeichnungen einer Verbindung aus beiden Blickrichtungen:
 * `bForA` = was B für A ist, `aForB` = was A für B ist.
 */
export function connectionTerms(
  conn: BloodConnection,
  aId: string,
  bId: string,
  sexOf: (id: string) => Sex,
): { bForA: string; aForB: string } {
  return {
    bForA: bloodRelationTerm({
      up: conn.up,
      down: conn.down,
      half: conn.half,
      adoptive: conn.adoptive,
      sex: sexOf(bId),
      side: sideOfLine(conn.lineA, sexOf),
    }),
    aForB: bloodRelationTerm({
      up: conn.down,
      down: conn.up,
      half: conn.half,
      adoptive: conn.adoptive,
      sex: sexOf(aId),
      side: sideOfLine(conn.lineB, sexOf),
    }),
  };
}

/**
 * Beschriftungen einer Eltern-Kind-Verbindung in beiden Richtungen:
 * `child` = was die untere Person für die obere ist („Tochter“,
 * „Adoptivsohn“), `parent` = was die obere für die untere ist („Vater“).
 */
export function parentChildLabels(
  subtype: string,
  parentSex: Sex,
  childSex: Sex,
): { child: string; parent: string } {
  return {
    child: stepTerm({ relation: "child", subtype, sex: childSex }),
    parent: stepTerm({ relation: "parent", subtype, sex: parentSex }),
  };
}
