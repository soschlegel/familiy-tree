import type { Scope } from "../scope";
import {
  CONSISTENCY_KINDS,
  findConsistencyIssues,
  type ConsistencyKind,
  type ConsistencySeverity,
} from "../consistency";
import { toPersonBrief, type PersonBrief } from "./dto";
import { loadGraph } from "./graph-data";

export type ConsistencyReport = {
  counts: Record<ConsistencyKind, number>;
  /** Höchstens `limit` Meldungen, Fehler vor Warnungen. */
  items: {
    kind: ConsistencyKind;
    severity: ConsistencySeverity;
    message: string;
    persons: PersonBrief[];
    relationshipIds: string[];
  }[];
  total: number;
};

/**
 * Widersprüche in Lebens- und Beziehungsdaten (siehe lib/consistency.ts).
 * Betrachtet ausschließlich sichtbare Personen und Beziehungen zwischen
 * ihnen — eine Meldung über eine verborgene Person würde deren Daten
 * preisgeben.
 */
export async function findInconsistencies(
  scope: Scope,
  options: { kinds?: ConsistencyKind[]; personId?: string; limit?: number } = {},
): Promise<ConsistencyReport> {
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 50)));
  const graph = await loadGraph(scope);
  const visible = [...graph.persons.values()].filter((p) => p.visible);
  const visibleIds = new Set(visible.map((p) => p.id));

  let issues = findConsistencyIssues(
    visible,
    graph.relationships.filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to)),
  );
  if (options.kinds?.length) {
    const wanted = new Set(options.kinds);
    issues = issues.filter((i) => wanted.has(i.kind));
  }
  if (options.personId) issues = issues.filter((i) => i.personIds.includes(options.personId!));

  const counts = Object.fromEntries(CONSISTENCY_KINDS.map((k) => [k, 0])) as Record<ConsistencyKind, number>;
  for (const i of issues) counts[i.kind]++;

  return {
    counts,
    total: issues.length,
    items: issues.slice(0, limit).map((i) => ({
      kind: i.kind,
      severity: i.severity,
      message: i.message,
      persons: i.personIds.map((id) => toPersonBrief(graph.persons.get(id)!)),
      relationshipIds: i.relationshipIds,
    })),
  };
}
