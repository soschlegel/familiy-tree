import { maskPerson, type Scope } from "../scope";
import {
  bloodRelationTerm,
  describePath,
  findBloodRelation,
  type KinshipStep,
  type Sex,
  type Side,
} from "../kinship";
import { toPersonBrief, type PersonBrief, type PersonRef } from "./dto";
import { loadGraph, type LoadedGraph } from "./graph-data";
import { relationshipPathInGraph, type RelationshipPathResult } from "./research";

/**
 * Verwandtschaft zweier Personen mit deutscher Bezeichnung (siehe
 * lib/kinship.ts). Beschrieben wird, was `to` für `from` ist.
 *
 * Sichtbarkeit wie bei findRelationshipPath: beide Personen müssen sichtbar
 * sein, unterwegs liegende unsichtbare Personen erscheinen als Platzhalter,
 * und ihr Geschlecht fließt nicht in die Begriffe ein (sonst verriete etwa
 * "väterlicherseits" das Geschlecht eines verborgenen Elternteils).
 */
export type KinshipResult = {
  from: PersonBrief;
  to: PersonBrief;
  /** Beste Kurzbezeichnung: Blutsverwandtschaft vor Verbindungsweg. */
  summary: string | null;
  blood: {
    term: string;
    generationsUp: number;
    generationsDown: number;
    half: boolean;
    adoptive: boolean;
    side: Side;
    commonAncestors: PersonRef[];
  } | null;
  path: RelationshipPathResult & {
    /** Begriff für den Weg, null wenn keiner passt. */
    term: string | null;
    /** Schrittkette, jeweils aus Sicht der vorigen Person. */
    chain: string;
  };
};

function sexOf(graph: LoadedGraph, id: string): Sex {
  const p = graph.persons.get(id);
  return p?.visible ? p.gender : "UNKNOWN";
}

export function kinshipInGraph(
  graph: LoadedGraph,
  fromId: string,
  toId: string,
): KinshipResult | null {
  const path = relationshipPathInGraph(graph, fromId, toId);
  if (!path) return null;

  const target = graph.persons.get(toId)!;

  const rel = findBloodRelation(graph.index, fromId, toId);
  let blood: KinshipResult["blood"] = null;
  if (rel) {
    let side: Side = null;
    if (rel.lineParentId) {
      const sex = sexOf(graph, rel.lineParentId);
      side = sex === "MALE" ? "paternal" : sex === "FEMALE" ? "maternal" : null;
    }
    blood = {
      term: bloodRelationTerm({
        up: rel.up,
        down: rel.down,
        half: rel.half,
        adoptive: rel.adoptive,
        sex: target.gender,
        side,
      }),
      generationsUp: rel.up,
      generationsDown: rel.down,
      half: rel.half,
      adoptive: rel.adoptive,
      side,
      commonAncestors: rel.commonAncestorIds.map((id) => {
        const p = graph.persons.get(id);
        return p?.visible ? toPersonBrief(p) : maskPerson(id);
      }),
    };
  }

  const steps: KinshipStep[] = path.steps
    .filter((s) => s.edge !== null)
    .map((s) => ({
      relation: s.edge!.relation,
      subtype: s.edge!.subtype,
      sex: sexOf(graph, s.person.id),
    }));
  const described = path.found
    ? describePath(steps)
    : { term: null, chain: "" };
  // Ein reiner Abstammungsweg kennt keine Halbverwandtschaft und nur einen
  // der möglichen Wege — dann gilt der genauere Begriff der Blutsverwandtschaft.
  const lineageOnly =
    steps.length > 0 &&
    steps.every((s) => s.relation !== "partner" && (s.subtype === "BIOLOGICAL" || s.subtype === "ADOPTIVE"));
  if (blood && lineageOnly) described.term = blood.term;

  return {
    from: path.from,
    to: path.to,
    summary: blood?.term ?? described.term,
    blood,
    path: { ...path, ...described },
  };
}

/**
 * Verwandtschaft von `toId` aus Sicht von `fromId`. null, wenn eine der
 * beiden Personen nicht existiert oder nicht sichtbar ist.
 */
export async function getKinship(
  scope: Scope,
  fromId: string,
  toId: string,
): Promise<KinshipResult | null> {
  return kinshipInGraph(await loadGraph(scope), fromId, toId);
}
