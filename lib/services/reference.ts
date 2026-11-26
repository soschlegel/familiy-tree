import { auditActor, audit } from "../audit";
import { buildGraphIndex, type GraphIndex } from "../graph";
import { prisma } from "../prisma";
import {
  LINE_KEYS,
  REFERENCE_ID_PATTERN,
  REFERENCE_SELF,
  relationsFromReference,
  type LineKey,
  type ReferenceSource,
  type ReferenceView,
  type RelativeInfo,
} from "../reference";
import { canViewPerson, familyIdsOfPerson, type Scope } from "../scope";
import { notFoundError } from "./errors";
import { loadGraph, type LoadedGraph } from "./graph-data";

/**
 * Bezugsperson eines Benutzers (docs/fachlich/bezugsperson.md).
 *
 * - „Das bin ich“: User.personId, vom Benutzer selbst (nur für Personen, die
 *   er sehen darf) oder von einem Administrator gesetzt.
 * - Vorübergehend eine andere Person: Adresse `?bezug=<id>`, im Browser per
 *   Cookie gemerkt (REFERENCE_COOKIE); `?bezug=ich` kehrt zur eigenen zurück.
 *
 * Datenschutz: Verwandtschaft und Linien werden nur über Personen berechnet,
 * die der Benutzer sehen darf (visibleIndex). Eine gesperrte Person ist nie
 * Bezugsperson, bekommt keine Bezeichnung und keine Linie, und kein Weg führt
 * über sie — so lässt sich aus den Angaben an sichtbaren Personen nichts über
 * gesperrte ableiten.
 */

/** Graph nur aus sichtbaren Personen und Kanten zwischen ihnen. */
export function visibleIndex(graph: LoadedGraph): GraphIndex {
  const visible = (id: string) => graph.persons.get(id)?.visible ?? false;
  return buildGraphIndex(graph.relationships.filter((r) => visible(r.from) && visible(r.to)));
}

/** Gespeicherte eigene Person — ungeprüft, ob sie (noch) sichtbar ist. */
export async function storedSelfPersonId(scope: Scope): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: scope.userId }, select: { personId: true } });
  return user?.personId ?? null;
}

async function isVisible(scope: Scope, personId: string): Promise<boolean> {
  const exists = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!exists) return false;
  return canViewPerson(scope, await familyIdsOfPerson(personId));
}

export type ReferenceChoice = {
  /** Wirksame Bezugsperson; null: keine (oder keine sichtbare). */
  id: string | null;
  source: ReferenceSource | null;
  /** Eigene Person, falls gesetzt UND sichtbar. */
  selfId: string | null;
};

/**
 * Wirksame Bezugsperson: Adresse vor Cookie vor eigener Person. Unbekannte
 * und gesperrte Kennungen fallen still weg — unbekannt und gesperrt sehen
 * gleich aus.
 */
export async function resolveReference(
  scope: Scope,
  input: { param?: string | null; cookie?: string | null },
  visible?: (id: string) => boolean,
): Promise<ReferenceChoice> {
  const check = async (id: string) => (visible ? visible(id) : isVisible(scope, id));
  const stored = await storedSelfPersonId(scope);
  const selfId = stored && (await check(stored)) ? stored : null;

  const param = input.param?.trim() || null;
  if (param && param !== REFERENCE_SELF && REFERENCE_ID_PATTERN.test(param) && (await check(param))) {
    return { id: param, source: param === selfId ? "self" : "param", selfId };
  }
  // „ich“ in der Adresse übergeht ein gemerktes Cookie.
  const cookie = param === REFERENCE_SELF ? null : input.cookie?.trim() || null;
  if (cookie && REFERENCE_ID_PATTERN.test(cookie) && (await check(cookie))) {
    return { id: cookie, source: cookie === selfId ? "self" : "cookie", selfId };
  }
  return { id: selfId, source: selfId ? "self" : null, selfId };
}

const nameOf = (graph: LoadedGraph, id: string) => {
  const p = graph.persons.get(id)!;
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
};

/**
 * Verwandtschaft und Linien für die Anzeige. `onlyIds`: nur diese Personen
 * ausliefern (Fokus-Ausschnitt, Personenseite) — berechnet wird trotzdem in
 * einem Durchgang von der Bezugsperson aus.
 */
export function referenceView(
  graph: LoadedGraph,
  choice: ReferenceChoice,
  onlyIds?: Iterable<string>,
): ReferenceView | null {
  const refId = choice.id;
  if (!refId || !graph.persons.get(refId)?.visible) return null;

  const index = visibleIndex(graph);
  const result = relationsFromReference(index, (id) => graph.persons.get(id)?.gender ?? "UNKNOWN", refId);

  const wanted = onlyIds ? new Set(onlyIds) : null;
  const relatives: Record<string, RelativeInfo> = {};
  for (const [id, info] of result.relatives) {
    if (wanted && !wanted.has(id)) continue;
    // Doppelte Absicherung: nur sichtbare Personen verlassen den Server.
    if (!graph.persons.get(id)?.visible) continue;
    if (info.term === null && info.lines.length === 0) continue;
    relatives[id] = info;
  }

  const grandparents = Object.fromEntries(
    LINE_KEYS.map((k) => {
      const g = result.grandparents[k];
      return [k, g ? { id: g, name: nameOf(graph, g) } : null];
    }),
  ) as Record<LineKey, { id: string; name: string } | null>;

  return {
    id: refId,
    name: nameOf(graph, refId),
    gender: graph.persons.get(refId)!.gender,
    isSelf: refId === choice.selfId,
    source: choice.source ?? "self",
    hasSelf: choice.selfId !== null,
    relatives,
    grandparents,
  };
}

/** Für die Personenseite: Graph laden, Bezugsperson auflösen, eine Person beschreiben. */
export async function loadReferenceFor(
  scope: Scope,
  input: { param?: string | null; cookie?: string | null },
  personId: string,
): Promise<{ choice: ReferenceChoice; view: ReferenceView | null; selfName: string | null }> {
  const graph = await loadGraph(scope);
  const choice = await resolveReference(scope, input, (id) => graph.persons.get(id)?.visible ?? false);
  const view = referenceView(graph, choice, [personId]);
  return { choice, view, selfName: choice.selfId ? nameOf(graph, choice.selfId) : null };
}

/**
 * „Das bin ich“ setzen oder aufheben. Nur Personen, die der Benutzer sehen
 * darf; sonst „nicht gefunden“ (wie überall).
 */
export async function setSelfPerson(scope: Scope, personId: string | null): Promise<{ personId: string | null }> {
  if (personId !== null && !(await isVisible(scope, personId))) throw notFoundError("Person");
  await prisma.user.update({ where: { id: scope.userId }, data: { personId } });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "User",
    entityId: scope.userId,
    diff: { personId },
  });
  return { personId };
}
