import type { Scope } from "../scope";
import type { Sex } from "../kinship";
import { stepTerm } from "../kinship";
import { bloodConnections, connectionTerms, parentChildLabels, type LineStep } from "../kinship-chain";
import { lifeSpan } from "../tree-layout";
import { toPersonBrief } from "./dto";
import { loadGraph, type LoadedGraph } from "./graph-data";
import { kinshipInGraph } from "./kinship";
import { storedSelfPersonId } from "./reference";

/**
 * Daten der Seite „Wie sind wir verwandt?“ (/kinship): Bezeichnung aus
 * beiden Blickrichtungen, die Verbindungen als Personenketten für die
 * Zeichnung und die Auswahlfelder.
 *
 * Rechte wie beim MCP-Werkzeug get_kinship (kinshipInGraph): Beide
 * gewählten Personen müssen sichtbar sein, sonst gelten sie als nicht
 * gefunden. Unterwegs liegende nicht sichtbare Personen erscheinen als
 * Karte „Nicht freigegeben“ — hier noch strenger als dort ganz ohne
 * Kennung, Namen, Daten und Geschlecht; die Art einer Verbindung zwischen
 * zwei nicht sichtbaren Personen wird neutralisiert.
 *
 * Ein einziger Ladevorgang des Graphen je Aufruf.
 */

/** Eine Person der Kette: sichtbar mit Name und Lebensjahren, sonst nur der Platzhalter. */
export type KinshipCard =
  | { restricted: false; id: string; name: string; lifespan: string }
  | { restricted: true };

/** Ein Schritt einer Abstammungslinie, von oben nach unten. */
export type KinshipLineStep = {
  card: KinshipCard;
  /** Was diese Person für die darüber ist („Tochter“, „Adoptivsohn“). */
  childLabel: string;
  /** Was die Person darüber für diese ist („Vater“, „Adoptivmutter“). */
  parentLabel: string;
  /** BIOLOGICAL oder ADOPTIVE (bei zwei nicht sichtbaren Enden neutral). */
  subtype: string;
};

export type KinshipConnectionView = {
  up: number;
  down: number;
  half: boolean;
  adoptive: boolean;
  /** Gemeinsame Vorfahren: eine Person oder ein Paar. */
  ancestors: KinshipCard[];
  /** Art der Partnerschaft des Vorfahrenpaars (MARRIED, DIVORCED, …), null ohne erfasste Partnerschaft. */
  pairSubtype: string | null;
  /** Linie hinab zu A (letzter Schritt = A). */
  lineA: KinshipLineStep[];
  /** Linie hinab zu B (letzter Schritt = B). */
  lineB: KinshipLineStep[];
  /** Was B für A ist. */
  bForA: string;
  /** Was A für B ist. */
  aForB: string;
};

/** Ein Schritt des kürzesten Wegs (auch über Partnerschaften). */
export type KinshipPathStep = {
  card: KinshipCard;
  /** Rolle dieser Person gegenüber der vorigen; null beim Start. */
  link: { relation: "parent" | "child" | "partner"; subtype: string; label: string } | null;
};

export type KinshipFound = {
  status: "found";
  a: KinshipCard & { restricted: false };
  b: KinshipCard & { restricted: false };
  /** Was B für A ist; null, wenn kein gängiger Begriff passt. */
  bForA: string | null;
  /** Was A für B ist; null, wenn kein gängiger Begriff passt. */
  aForB: string | null;
  /** Schrittkette von A aus („Mutter → Bruder → Ehefrau“). */
  chainFromA: string;
  /** Schrittkette von B aus. */
  chainFromB: string;
  /** blood: gemeinsame Vorfahren; inLaw: über Partnerschaften; other: nur über Stief-/Pflegeeltern. */
  kind: "blood" | "inLaw" | "other";
  /** Blutsverwandtschaften, die nächste zuerst (höchstens MAX_CONNECTIONS). */
  connections: KinshipConnectionView[];
  /** Weitere Verbindungen gab es über die Grenze hinaus. */
  moreConnections: boolean;
  /** Kürzester Weg über Eltern- und Partnerkanten (A zuerst). */
  path: KinshipPathStep[];
  /** Begriff des kürzesten Wegs, wenn er neben einer Blutsverwandtschaft etwas anderes sagt (z.B. Ehe unter Verwandten). */
  pathTerm: string | null;
};

export type KinshipResultView =
  | { status: "same"; person: KinshipCard & { restricted: false } }
  | { status: "none"; a: KinshipCard & { restricted: false }; b: KinshipCard & { restricted: false } }
  | KinshipFound;

/** Zustand eines Auswahlfelds. */
export type KinshipPick =
  | { state: "empty" }
  | { state: "notFound" }
  | { state: "ok"; card: KinshipCard & { restricted: false } };

export type KinshipPage = {
  a: KinshipPick;
  b: KinshipPick;
  /** Eigene Person („Das bin ich“), wenn gesetzt und sichtbar. */
  self: { id: string; name: string } | null;
  result: KinshipResultView | null;
};

/** Gezeigt werden die nächste Verbindung und bis zu drei weitere. */
export const MAX_CONNECTIONS = 4;

/** Zulässige Kennung in der Adresse (wie `focus` im Baum). */
export function parsePersonParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function visibleCard(graph: LoadedGraph, id: string): (KinshipCard & { restricted: false }) | null {
  const p = graph.persons.get(id);
  if (!p?.visible) return null;
  return {
    restricted: false,
    id: p.id,
    name: [p.givenName, p.familyName].filter(Boolean).join(" "),
    lifespan: lifeSpan(toPersonBrief(p)),
  };
}

const card = (graph: LoadedGraph, id: string): KinshipCard => visibleCard(graph, id) ?? { restricted: true };

/** Ergebnis für zwei gewählte Personen auf einem geladenen Graphen. null, wenn eine nicht sichtbar ist. */
export function kinshipViewInGraph(graph: LoadedGraph, aId: string, bId: string): KinshipResultView | null {
  const a = visibleCard(graph, aId);
  const b = visibleCard(graph, bId);
  if (!a || !b) return null;
  if (aId === bId) return { status: "same", person: a };

  const visible = (id: string) => graph.persons.get(id)?.visible ?? false;
  const sexOf = (id: string): Sex => {
    const p = graph.persons.get(id);
    return p?.visible ? p.gender : "UNKNOWN";
  };
  // Zwischen zwei nicht sichtbaren Personen verrät auch die Art nichts.
  const shownSubtype = (x: string, y: string, subtype: string, neutral: string) =>
    visible(x) || visible(y) ? subtype : neutral;

  const fromA = kinshipInGraph(graph, aId, bId)!;
  if (!fromA.path.found) return { status: "none", a, b };
  const fromB = kinshipInGraph(graph, bId, aId)!;

  const lineView = (line: LineStep[]): KinshipLineStep[] =>
    line.map((s) => {
      const subtype = shownSubtype(s.personId, s.parentId, s.subtype, "BIOLOGICAL");
      const labels = parentChildLabels(subtype, sexOf(s.parentId), sexOf(s.personId));
      return { card: card(graph, s.personId), childLabel: labels.child, parentLabel: labels.parent, subtype };
    });

  const all = bloodConnections(graph.index, aId, bId, MAX_CONNECTIONS + 1);
  const connections: KinshipConnectionView[] = all.slice(0, MAX_CONNECTIONS).map((c) => {
    const terms = connectionTerms(c, aId, bId, sexOf);
    let pairSubtype: string | null = null;
    if (c.ancestorIds.length === 2) {
      const [x, y] = c.ancestorIds;
      const edge = (graph.index.partnersOf.get(x) ?? []).find((e) => e.from === y || e.to === y);
      if (edge) pairSubtype = shownSubtype(x, y, edge.subtype, "UNMARRIED");
    }
    return {
      up: c.up,
      down: c.down,
      half: c.half,
      adoptive: c.adoptive,
      ancestors: c.ancestorIds.map((id) => card(graph, id)),
      pairSubtype,
      lineA: lineView(c.lineA),
      lineB: lineView(c.lineB),
      bForA: terms.bForA,
      aForB: terms.aForB,
    };
  });

  const path: KinshipPathStep[] = fromA.path.steps.map((s) => ({
    card: s.person.restricted ? { restricted: true } : card(graph, s.person.id),
    link: s.edge
      ? {
          relation: s.edge.relation,
          subtype: s.edge.subtype,
          label: stepTerm({ relation: s.edge.relation, subtype: s.edge.subtype, sex: sexOf(s.person.id) }),
        }
      : null,
  }));
  const viaPartner = path.some((s) => s.link?.relation === "partner");
  const kind: KinshipFound["kind"] = connections.length > 0 ? "blood" : viaPartner ? "inLaw" : "other";

  // Ehe unter Verwandten u.ä.: der kürzeste Weg sagt etwas anderes als die Abstammung.
  const lineageOnly = path.every((s) => !s.link || (s.link.relation !== "partner" && (s.link.subtype === "BIOLOGICAL" || s.link.subtype === "ADOPTIVE")));
  const pathTerm =
    kind === "blood" && !lineageOnly && fromA.path.term && fromA.path.term !== fromA.summary ? fromA.path.term : null;

  return {
    status: "found",
    a,
    b,
    bForA: fromA.summary,
    aForB: fromB.summary,
    chainFromA: fromA.path.chain,
    chainFromB: fromB.path.chain,
    kind,
    connections,
    moreConnections: all.length > MAX_CONNECTIONS,
    path,
    pathTerm,
  };
}

function pick(graph: LoadedGraph, raw: string | null, given: boolean): KinshipPick {
  if (!given) return { state: "empty" };
  const c = raw ? visibleCard(graph, raw) : null;
  return c ? { state: "ok", card: c } : { state: "notFound" };
}

/**
 * Alles für die Seite: beide Auswahlfelder, die eigene Person und das
 * Ergebnis. `aRaw`/`bRaw` sind die rohen Suchparameter (leer = nicht gewählt).
 */
export async function loadKinshipPage(
  scope: Scope,
  aRaw: string | undefined,
  bRaw: string | undefined,
): Promise<KinshipPage> {
  const [graph, selfId] = await Promise.all([loadGraph(scope), storedSelfPersonId(scope)]);
  const aId = parsePersonParam(aRaw);
  const bId = parsePersonParam(bRaw);
  const a = pick(graph, aId, Boolean(aRaw));
  const b = pick(graph, bId, Boolean(bRaw));
  const selfCard = selfId ? visibleCard(graph, selfId) : null;
  return {
    a,
    b,
    self: selfCard ? { id: selfCard.id, name: selfCard.name } : null,
    result: a.state === "ok" && b.state === "ok" ? kinshipViewInGraph(graph, a.card.id, b.card.id) : null,
  };
}
