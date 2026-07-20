import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";

export type TreePerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birthDate: string | null;
  deathDate: string | null;
  primaryMediaId: string | null;
};

export type TreeRelationship = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  fromPersonId: string;
  toPersonId: string;
  startDate: string | null;
  endDate: string | null;
  primaryMediaId: string | null;
};

/** Hochzeit als eigenständiges Ereignis auf der Zeitachse. */
export type MarriageEvent = {
  id: string;
  relationshipId: string;
  date: string;
  subtype: string;
  primaryMediaId: string | null;
  partnerAId: string;
  partnerBId: string;
  /** Knoten, an denen die Partner gezeichnet werden — Ziel der Verbindungen.
   *  Bei einem absorbierten Paar sind beide gleich. */
  anchorAId: string;
  anchorBId: string;
  partnerNames: string;
};

export type TreeData = {
  persons: TreePerson[];
  relationships: TreeRelationship[];
};

export type LayoutNode = {
  person: TreePerson;
  x: number;
  y: number;
  /** Partner, der als zweite Karte direkt daneben gezeichnet wird. */
  partner: TreePerson | null;
  /** Ehe zwischen person und partner — für Datum und Bild am Verbindungsstück. */
  marriage: {
    date: string | null;
    endDate: string | null;
    subtype: string;
    primaryMediaId: string | null;
  } | null;
  /** Gehen von diesem Knoten Abstammungslinien aus? Steuert den Stiel, der
   *  die Ehe-Verbindung nach unten mit den Kindern zusammenführt. */
  hasDescendants: boolean;
};

export type MarriageInfo = {
  date: string | null;
  endDate: string | null;
  subtype: string;
  primaryMediaId: string | null;
};

export type LayoutEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "parent" | "partner";
  /** Nur bei kind === "partner": Daten für Beschriftung und Bild der Kante. */
  marriage?: MarriageInfo;
};

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 96;
const H_GAP = 40;
const V_GAP = 130;

type Index = {
  byId: Map<string, TreePerson>;
  childrenOf: Map<string, string[]>;
  parentsOf: Map<string, string[]>;
  partnersOf: Map<string, string[]>;
};

export function indexTree(data: TreeData): Index {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();

  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };

  for (const r of data.relationships) {
    if (r.type === "PARENT_OF") {
      push(childrenOf, r.fromPersonId, r.toPersonId);
      push(parentsOf, r.toPersonId, r.fromPersonId);
    } else {
      push(partnersOf, r.fromPersonId, r.toPersonId);
      push(partnersOf, r.toPersonId, r.fromPersonId);
    }
  }

  return { byId, childrenOf, parentsOf, partnersOf };
}

/**
 * Wurzeln sind Personen ohne Eltern — mit einer Ausnahme: Wer eingeheiratet
 * hat (keine eigenen Eltern, aber ein Partner mit Eltern) wird bewusst NICHT
 * zur Wurzel. Sonst bekäme diese Person einen eigenen Strang am Rand, bevor
 * der Partner sie als zweite Karte aufnehmen kann, und stünde losgelöst von
 * der Familie, in die sie gehört.
 *
 * Wer dadurch unplatziert bliebe, wird in layoutForest nachträglich als
 * eigener Strang ergänzt.
 */
export function findRoots(data: TreeData, idx: Index): string[] {
  return data.persons
    .filter((p) => {
      if (idx.parentsOf.has(p.id)) return false;
      const marriedIn = (idx.partnersOf.get(p.id) ?? []).some((pid) =>
        idx.parentsOf.has(pid),
      );
      return !marriedIn;
    })
    .map((p) => p.id);
}

type Raw = { id: string; children: Raw[] };

/**
 * Positioniert einen Strang. Ein Kind hat zwei Elternteile, würde also unter
 * beiden auftauchen — deshalb wird jede Person global nur einmal platziert
 * (placed) und der zweite Elternteil als Partnerkarte danebengestellt.
 *
 * Absorbiert wird aber NUR ein Partner ohne eigene Eltern. Sonst verlöre die
 * absorbierte Person ihren Platz unter den eigenen Eltern — genau der Fall
 * "Person A verliert die Kante zu ihren Eltern, sobald sie mit B verheiratet
 * ist". Haben beide Partner Eltern, bleiben beide eigenständige Knoten und die
 * Ehe wird als waagerechte Kante zwischen ihnen gezeichnet.
 */
function layoutStrand(
  idx: Index,
  rootId: string,
  placed: Set<string>,
  anchorOf: Map<string, string>,
  partnerOfNode: Map<string, TreePerson | null>,
): { nodes: LayoutNode[]; width: number } {
  const build = (personId: string): Raw | null => {
    if (placed.has(personId)) return null;
    placed.add(personId);
    anchorOf.set(personId, personId);

    const partnerId = (idx.partnersOf.get(personId) ?? []).find(
      (pid) => !placed.has(pid) && !idx.parentsOf.has(pid),
    );
    if (partnerId) {
      placed.add(partnerId);
      // Der absorbierte Partner wird an derselben Stelle gezeichnet — seine
      // Kanten setzen deshalb am Knoten des Gastgebers an.
      anchorOf.set(partnerId, personId);
    }
    partnerOfNode.set(
      personId,
      partnerId ? (idx.byId.get(partnerId) ?? null) : null,
    );

    const childIds = new Set([
      ...(idx.childrenOf.get(personId) ?? []),
      ...(partnerId ? (idx.childrenOf.get(partnerId) ?? []) : []),
    ]);

    const children: Raw[] = [];
    for (const childId of childIds) {
      const sub = build(childId);
      if (sub) children.push(sub);
    }

    return { id: personId, children };
  };

  const raw = build(rootId);
  if (!raw) return { nodes: [], width: 0 };

  const root = d3tree<Raw>().nodeSize([
    NODE_WIDTH * 2 + H_GAP,
    NODE_HEIGHT + V_GAP,
  ])(hierarchy<Raw>(raw, (d) => d.children));

  const nodes: LayoutNode[] = [];
  let minX = Infinity;
  let maxX = -Infinity;

  root.each((n: HierarchyPointNode<Raw>) => {
    const person = idx.byId.get(n.data.id);
    if (!person) return;

    const partner = partnerOfNode.get(n.data.id) ?? null;
    const hasDescendants =
      (idx.childrenOf.get(n.data.id)?.length ?? 0) > 0 ||
      (partner ? (idx.childrenOf.get(partner.id)?.length ?? 0) > 0 : false);

    nodes.push({
      person,
      x: n.x,
      y: n.y,
      partner,
      marriage: null,
      hasDescendants,
    });

    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + NODE_WIDTH * (partner ? 2 : 1));
  });

  for (const node of nodes) node.x -= minX;

  return { nodes, width: maxX - minX };
}

/**
 * Layoutet alle Familienstränge nebeneinander und leitet die Kanten aus den
 * echten Beziehungsdaten ab — nicht aus der Baumstruktur. Nur so bleibt jede
 * Eltern-Kind-Verbindung sichtbar, auch wenn der Baum sie strukturell nicht
 * abbilden kann (Ehe zwischen zwei Personen, die beide eigene Eltern haben).
 */
export function layoutForest(data: TreeData) {
  const idx = indexTree(data);
  const placed = new Set<string>();
  const anchorOf = new Map<string, string>();
  const partnerOfNode = new Map<string, TreePerson | null>();

  const nodes: LayoutNode[] = [];
  let offsetX = 0;

  const addStrand = (rootId: string) => {
    const strand = layoutStrand(idx, rootId, placed, anchorOf, partnerOfNode);
    if (strand.nodes.length === 0) return;
    for (const node of strand.nodes) node.x += offsetX;
    nodes.push(...strand.nodes);
    offsetX += strand.width + NODE_WIDTH * 2;
  };

  for (const rootId of findRoots(data, idx)) addStrand(rootId);

  // Rückfallebene: Personen, die von keiner Wurzel erreichbar sind (etwa in
  // einem Beziehungsring), bekommen einen eigenen Strang statt zu verschwinden.
  for (const person of data.persons) {
    if (!placed.has(person.id)) addStrand(person.id);
  }

  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();

  for (const r of data.relationships) {
    const source = anchorOf.get(r.fromPersonId);
    const target = anchorOf.get(r.toPersonId);
    if (!source || !target) continue;

    // Gleicher Anker = die beiden teilen sich einen Knoten (absorbiertes
    // Ehepaar). Deren Ehe zeigt die Doppelkarte, deren gemeinsame Kinder
    // bekommen nur eine Kante statt zwei deckungsgleicher.
    if (source === target) continue;

    if (r.type === "PARENT_OF") {
      const id = `parent:${source}->${target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, sourceId: source, targetId: target, kind: "parent" });
    } else {
      const [a, b] = source < target ? [source, target] : [target, source];
      const id = `partner:${a}-${b}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        sourceId: a,
        targetId: b,
        kind: "partner",
        marriage: {
          date: r.startDate,
          endDate: r.endDate,
          subtype: r.subtype,
          primaryMediaId: r.primaryMediaId,
        },
      });
    }
  }

  // Ehedaten an die Doppelkarten hängen, damit Datum und Hochzeitsbild direkt
  // am Verbindungsstück zwischen den beiden Karten stehen können.
  const byPair = new Map<string, TreeRelationship>();
  for (const r of data.relationships) {
    if (r.type !== "PARTNER_OF") continue;
    const [a, b] =
      r.fromPersonId < r.toPersonId
        ? [r.fromPersonId, r.toPersonId]
        : [r.toPersonId, r.fromPersonId];
    byPair.set(`${a}|${b}`, r);
  }

  for (const node of nodes) {
    if (!node.partner) continue;
    const [a, b] =
      node.person.id < node.partner.id
        ? [node.person.id, node.partner.id]
        : [node.partner.id, node.person.id];
    const rel = byPair.get(`${a}|${b}`);
    if (!rel) continue;
    node.marriage = {
      date: rel.startDate,
      endDate: rel.endDate,
      subtype: rel.subtype,
      primaryMediaId: rel.primaryMediaId,
    };
  }

  return { nodes, edges };
}

// --- Zeitstrahl-Ansicht -----------------------------------------------------

const PX_PER_YEAR = 16;
const TIMELINE_TOP = 60;

const yearOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? y : null;
};

/**
 * Zeitliche Ansicht: die Höhe ergibt sich aus dem Jahr, nicht aus der
 * Generation. Die waagerechte Position wird aus der Generationenansicht
 * übernommen — so bleiben Familienstränge als Spalten beieinander, statt dass
 * Verwandte quer über die Fläche verstreut werden.
 *
 * Personen ohne Geburtsdatum haben auf einer Zeitachse keinen Platz; sie
 * kommen in ein eigenes Band unterhalb der Achse, statt stillschweigend bei
 * Jahr 0 zu landen.
 */
export function layoutTimeline(data: TreeData) {
  const base = layoutForest(data);
  const idx = indexTree(data);

  const years = data.persons
    .map((p) => yearOf(p.birthDate))
    .filter((y): y is number => y !== null);

  const marriageYears = data.relationships
    .filter((r) => r.type === "PARTNER_OF")
    .map((r) => yearOf(r.startDate))
    .filter((y): y is number => y !== null);

  const allYears = [...years, ...marriageYears];
  const minYear = allYears.length ? Math.min(...allYears) : 1900;
  const maxYear = allYears.length ? Math.max(...allYears) : 2000;

  const toY = (year: number) => TIMELINE_TOP + (year - minYear) * PX_PER_YEAR;

  const undatedBandY = toY(maxYear) + NODE_HEIGHT + 140;

  const nodes: LayoutNode[] = [];
  const undated: LayoutNode[] = [];

  for (const node of base.nodes) {
    // Bei einer Doppelkarte bestimmt der frühere der beiden Geburtsjahrgänge
    // die Höhe — sonst säße das Paar willkürlich beim Erstgenannten.
    const own = yearOf(node.person.birthDate);
    const partner = node.partner ? yearOf(node.partner.birthDate) : null;
    const year =
      own !== null && partner !== null
        ? Math.min(own, partner)
        : (own ?? partner);

    if (year === null) {
      undated.push({ ...node, y: undatedBandY });
      continue;
    }
    nodes.push({ ...node, y: toY(year) });
  }

  // Undatierte nebeneinander in ihr Band legen.
  undated.forEach((node, i) => {
    nodes.push({ ...node, x: i * (NODE_WIDTH * 2 + H_GAP) });
  });

  // Überlappungen auflösen: Personen aus demselben Familienstrang können
  // jahrgangsnah sein und säßen dann übereinander. Wer kollidiert, rückt nach
  // rechts, bis er freisteht.
  const placedBoxes: { x: number; y: number; w: number }[] = [];
  const step = NODE_WIDTH + H_GAP;

  nodes.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const node of nodes) {
    const w = NODE_WIDTH * (node.partner ? 2 : 1) + H_GAP;
    let guard = 0;
    while (
      guard++ < 200 &&
      placedBoxes.some(
        (box) =>
          Math.abs(box.y - node.y) < NODE_HEIGHT + 12 &&
          node.x < box.x + box.w &&
          box.x < node.x + w,
      )
    ) {
      node.x += step;
    }
    placedBoxes.push({ x: node.x, y: node.y, w });
  }

  // Hochzeiten als eigene Ereignisse einsortieren.
  const anchorX = new Map<string, number>();
  const anchorNode = new Map<string, string>();
  for (const node of nodes) {
    anchorX.set(node.person.id, node.x);
    anchorNode.set(node.person.id, node.person.id);
    if (node.partner) {
      anchorX.set(node.partner.id, node.x + NODE_WIDTH);
      anchorNode.set(node.partner.id, node.person.id);
    }
  }

  const events: MarriageEvent[] = [];
  for (const r of data.relationships) {
    if (r.type !== "PARTNER_OF" || !r.startDate) continue;
    const year = yearOf(r.startDate);
    if (year === null) continue;

    const ax = anchorX.get(r.fromPersonId);
    const bx = anchorX.get(r.toPersonId);
    if (ax === undefined || bx === undefined) continue;

    const a = idx.byId.get(r.fromPersonId);
    const b = idx.byId.get(r.toPersonId);

    events.push({
      id: `event:${r.id}`,
      relationshipId: r.id,
      date: r.startDate,
      subtype: r.subtype,
      primaryMediaId: r.primaryMediaId,
      partnerAId: r.fromPersonId,
      partnerBId: r.toPersonId,
      anchorAId: anchorNode.get(r.fromPersonId)!,
      anchorBId: anchorNode.get(r.toPersonId)!,
      partnerNames: [a, b]
        .filter((p): p is TreePerson => Boolean(p))
        .map((p) => p.givenName)
        .join(" ♥ "),
    });
  }

  const eventPositions = new Map<string, { x: number; y: number }>();
  for (const ev of events) {
    const ax = anchorX.get(ev.partnerAId)!;
    const bx = anchorX.get(ev.partnerBId)!;
    eventPositions.set(ev.id, {
      x: (ax + bx) / 2,
      y: toY(yearOf(ev.date)!),
    });
  }

  const axis = {
    minYear,
    maxYear,
    toY,
    ticks: [] as { year: number; y: number }[],
    undatedY: undated.length > 0 ? undatedBandY : null,
  };

  // Beschriftung alle 10 Jahre, auf glatte Jahrzehnte gerundet.
  for (let y = Math.floor(minYear / 10) * 10; y <= maxYear + 10; y += 10) {
    if (y < minYear - 10) continue;
    axis.ticks.push({ year: y, y: toY(y) });
  }

  return { nodes, edges: base.edges, events, eventPositions, axis };
}

/** Einheitliches Datumsformat für die gesamte Oberfläche: 01.08.1984 */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function displayName(p: TreePerson): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}

export function lifeSpan(p: {
  birthDate: string | null;
  deathDate: string | null;
}): string {
  const year = (d: string | null) => (d ? new Date(d).getFullYear() : null);
  const b = year(p.birthDate);
  const d = year(p.deathDate);
  if (!b && !d) return "";
  if (b && d) return `${b} – ${d}`;
  if (b) return `* ${b}`;
  return `† ${d}`;
}
