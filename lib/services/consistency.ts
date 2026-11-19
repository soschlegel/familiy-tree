import { prisma } from "../prisma";
import type { Scope } from "../scope";
import {
  CONSISTENCY_KINDS,
  findConsistencyIssues,
  type ConsistencyEvent,
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
    /** Betroffene Lebensereignisse (Event.id). */
    eventIds: string[];
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
  const [graph, eventRows] = await Promise.all([
    loadGraph(scope),
    prisma.event.findMany({
      where: { personId: { not: null }, isAlternative: false, date: { not: null } },
      select: {
        id: true,
        personId: true,
        type: true,
        label: true,
        isAlternative: true,
        date: true,
        datePrecision: true,
        dateQualifier: true,
        dateTo: true,
        dateToPrecision: true,
      },
    }),
  ]);
  const visible = [...graph.persons.values()].filter((p) => p.visible);
  const visibleIds = new Set(visible.map((p) => p.id));
  const eventsOf = new Map<string, ConsistencyEvent[]>();
  for (const { personId, ...e } of eventRows) {
    if (!personId || !visibleIds.has(personId)) continue;
    const list = eventsOf.get(personId) ?? [];
    list.push(e);
    eventsOf.set(personId, list);
  }

  let issues = findConsistencyIssues(
    visible.map((p) => ({ ...p, events: eventsOf.get(p.id) ?? [] })),
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
      eventIds: i.eventIds ?? [],
    })),
  };
}
