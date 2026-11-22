/**
 * Bezugsperson („in Scope“): Verwandtschaft aller Personen zu EINER Person
 * und die Zuordnung ihrer Vorfahren zu den vier Großeltern-Linien — reine
 * Funktionen ohne Datenbank, auch im Browser verwendbar (nur Typen und
 * Bezeichnungen).
 *
 * Statt für jede Person paarweise findBloodRelation aufzurufen, läuft hier
 * eine einzige Suche von der Bezugsperson aus:
 *
 * 1. Vorfahren der Bezugsperson mit kürzestem Abstand (ancestorDistances).
 * 2. Von allen Vorfahren gleichzeitig abwärts, geordnet nach (Abstand
 *    gesamt, Abstand hinauf) — genau die Reihenfolge, nach der
 *    findBloodRelation den nächsten gemeinsamen Vorfahren wählt. Jede Person
 *    wird beim ersten (besten) Erreichen festgeschrieben; gleich gute Wege
 *    werden zusammengeführt (mehrere gemeinsame Vorfahren, Halb-/Adoptiv-).
 * 3. Für alle übrigen eine Breitensuche über Eltern- und Partnerkanten in
 *    derselben Reihenfolge wie shortestPath, dann describePath — so entstehen
 *    „Schwägerin“, „Schwiegervater“, „angeheirateter Onkel“ usw.
 *
 * Das Ergebnis stimmt mit kinshipInGraph (lib/services/kinship.ts) überein;
 * tests/reference.test.ts prüft das für alle Paare der Mock-Daten.
 *
 * Der übergebene Graph muss bereits auf die Personen beschränkt sein, die der
 * Benutzer sehen darf (lib/services/reference.ts, visibleIndex) — Wege über
 * gesperrte Personen gibt es dann nicht, und über sie sickert nichts durch.
 */
import { ancestorDistances, bloodRelationTerm, describePath, type KinshipStep, type Sex, type Side } from "./kinship";
import type { GraphIndex } from "./graph";

/** Elternschaften, die eine Abstammungslinie begründen (wie lib/kinship.ts). */
const LINEAGE = new Set(["BIOLOGICAL", "ADOPTIVE"]);

/**
 * Die vier Großeltern-Linien: erster Buchstabe die Seite (Vater/Mutter der
 * Bezugsperson), zweiter der Großelternteil auf dieser Seite.
 */
export type LineKey = "FF" | "FM" | "MF" | "MM";
export const LINE_KEYS: readonly LineKey[] = ["FF", "FM", "MF", "MM"];

/** Kurzzeichen auf der Karte — damit die Linie nie nur an der Farbe hängt. */
export const LINE_CODE: Record<LineKey, string> = { FF: "VV", FM: "VM", MF: "MV", MM: "MM" };

/** Ausgeschriebene Bezeichnung (Legende, Screenreader). */
export const LINE_LABEL: Record<LineKey, string> = {
  FF: "Großvater väterlicherseits",
  FM: "Großmutter väterlicherseits",
  MF: "Großvater mütterlicherseits",
  MM: "Großmutter mütterlicherseits",
};

/** Cookie mit der vorübergehenden Bezugsperson (nur die Kennung). */
export const REFERENCE_COOKIE = "tree-bezug";
/** Cookie für den Schalter „Linien färben“ ("1" = an). */
export const LINES_COOKIE = "tree-lines";
/** Wert von `?bezug=`, der zur eigenen Person zurückführt. */
export const REFERENCE_SELF = "ich";
export const REFERENCE_ID_PATTERN = /^[\w-]{1,64}$/;

/** Was eine Person für die Bezugsperson ist — so viel, wie der Browser braucht. */
export type RelativeInfo = {
  /** Bezeichnung („Urgroßvater väterlicherseits“), null wenn keine passt. */
  term: string | null;
  /** Ahnenlinien, zu denen die Person gehört (leer: keine Vorfahrin der Bezugsperson). */
  lines: LineKey[];
};

/**
 * Farbe einer Eltern-Kind-Verbindung im Baum (Schalter „Linien“): die Linie,
 * die Eltern- und Kindseite gemeinsam haben — aber nur, wenn es GENAU EINE
 * ist. So färben sich die Ahnenketten der vier Großeltern; Verbindungen zu
 * Vater/Mutter/Bezugsperson (mehrere Linien) und zu Seitenverwandten (keine
 * Linie) bleiben neutral. Eine Seite kann mehrere Personen umfassen
 * (Paarkarte, Treffpunkt beider Eltern).
 */
export function edgeLine(
  relatives: Record<string, RelativeInfo>,
  parentIds: readonly string[],
  childIds: readonly string[],
): LineKey | null {
  const linesOf = (ids: readonly string[]) => new Set(ids.flatMap((id) => relatives[id]?.lines ?? []));
  const parents = linesOf(parentIds);
  const shared = [...linesOf(childIds)].filter((k) => parents.has(k));
  return shared.length === 1 ? shared[0] : null;
}

/** Woher die wirksame Bezugsperson kommt. */
export type ReferenceSource = "param" | "cookie" | "self";

/** Bezugsperson samt Verwandtschaft — was Baum und Personenseite anzeigen. */
export type ReferenceView = {
  id: string;
  name: string;
  gender: Sex;
  /** Die Bezugsperson ist die eigene Person des Benutzers. */
  isSelf: boolean;
  source: ReferenceSource;
  /** Der Benutzer hat eine (sichtbare) eigene Person — „zurück zu mir“ möglich. */
  hasSelf: boolean;
  /** Nur sichtbare Personen mit Bezeichnung oder Linie. */
  relatives: Record<string, RelativeInfo>;
  grandparents: Record<LineKey, { id: string; name: string } | null>;
};

/** Blutsverwandtschaft wie findBloodRelation, für alle Personen auf einmal. */
export type BloodHit = {
  up: number;
  down: number;
  commonAncestorIds: string[];
  half: boolean;
  adoptive: boolean;
  lineParentId: string | null;
};

type Route = { rBio: boolean; tBio: boolean; below: Set<string> };
type Reached = { up: number; down: number; sources: Map<string, Route> };
type Entry = { id: string; up: number; source: string; route: Route };

const lineageParentEdges = (index: GraphIndex, id: string) =>
  (index.parentsOf.get(id) ?? []).filter((e) => LINEAGE.has(e.subtype));

/**
 * Blutsverwandte der Bezugsperson samt Abstand. Ergebnis je Person wie
 * findBloodRelation(index, refId, person); nicht verwandte Personen fehlen.
 */
export function bloodRelationsFrom(
  index: GraphIndex,
  refId: string,
  maxDepth = 25,
): Map<string, BloodHit> {
  const ua = ancestorDistances(index, refId, maxDepth);

  // Eimer je Gesamtabstand; darin wird nach dem Abstand hinauf sortiert.
  const buckets: Entry[][] = [];
  const push = (sum: number, e: Entry) => (buckets[sum] ??= []).push(e);
  for (const [id, info] of ua) {
    push(info.distance, { id, up: info.distance, source: id, route: { rBio: info.biological, tBio: true, below: new Set() } });
  }

  const reached = new Map<string, Reached>();
  for (let sum = 0; sum < buckets.length; sum++) {
    const bucket = buckets[sum];
    if (!bucket) continue;
    bucket.sort((a, b) => a.up - b.up);
    const fresh: string[] = [];
    for (const e of bucket) {
      const down = sum - e.up;
      const r = reached.get(e.id);
      if (!r) {
        reached.set(e.id, { up: e.up, down, sources: new Map([[e.source, cloneRoute(e.route)]]) });
        fresh.push(e.id);
        continue;
      }
      // Nur ein gleich guter Weg wird zusammengeführt; spätere sind schlechter.
      if (r.up !== e.up || r.down !== down) continue;
      const known = r.sources.get(e.source);
      if (!known) r.sources.set(e.source, cloneRoute(e.route));
      else {
        known.tBio ||= e.route.tBio;
        for (const b of e.route.below) known.below.add(b);
      }
    }
    // Erst nach dem ganzen Eimer weitergeben: dann sind alle gleich guten
    // Wege einer Person beisammen.
    for (const id of fresh) {
      const r = reached.get(id)!;
      if (r.down >= maxDepth) continue;
      for (const edge of index.childrenOf.get(id) ?? []) {
        if (!LINEAGE.has(edge.subtype) || reached.has(edge.to)) continue;
        for (const [source, route] of r.sources) {
          push(sum + 1, {
            id: edge.to,
            up: r.up,
            source,
            route: {
              rBio: route.rBio,
              tBio: route.tBio && edge.subtype === "BIOLOGICAL",
              // Kind des gemeinsamen Vorfahren auf der Seite der Zielperson.
              below: r.down === 0 ? new Set([edge.to]) : route.below,
            },
          });
        }
      }
    }
  }

  // Seite (väterlicher-/mütterlicherseits): über welchen Elternteil der
  // Bezugsperson die gemeinsamen Vorfahren erreicht werden.
  const parentDist = lineageParentEdges(index, refId).map((e) => ({
    id: e.from,
    dist: ancestorDistances(index, e.from, maxDepth),
  }));
  const refParentCount = parentDist.length;

  const result = new Map<string, BloodHit>();
  for (const [id, r] of reached) {
    const common = [...r.sources.keys()].sort();
    const adoptive = ![...r.sources.values()].some((s) => s.rBio && s.tBio);

    let half = false;
    if (r.up >= 1 && r.down >= 1 && common.length === 1) {
      const g = common[0];
      const route = r.sources.get(g)!;
      const sideA =
        r.up === 1
          ? refId
          : ((index.childrenOf.get(g) ?? []).map((e) => e.to).find((c) => ua.get(c)?.distance === r.up - 1) ?? null);
      const sideB =
        r.down === 1
          ? id
          : ((index.childrenOf.get(g) ?? []).map((e) => e.to).find((c) => route.below.has(c)) ?? null);
      const parentsOf = (x: string) => (x === refId ? refParentCount : lineageParentEdges(index, x).length);
      half = sideA !== null && sideB !== null && parentsOf(sideA) >= 2 && parentsOf(sideB) >= 2;
    }

    let lineParentId: string | null = null;
    if (r.up >= 2) {
      const leading = parentDist.filter((p) => common.some((c) => p.dist.get(c)?.distance === r.up - 1));
      if (leading.length === 1) lineParentId = leading[0].id;
    }

    result.set(id, { up: r.up, down: r.down, commonAncestorIds: common, half, adoptive, lineParentId });
  }
  return result;
}

function cloneRoute(r: Route): Route {
  return { rBio: r.rBio, tBio: r.tBio, below: new Set(r.below) };
}

/**
 * Kürzeste Wege von der Bezugsperson zu allen erreichbaren Personen — eine
 * Breitensuche in derselben Reihenfolge wie shortestPath (Eltern, Kinder,
 * Partner), liefert also dieselben Wege wie Einzelaufrufe.
 */
function pathTree(index: GraphIndex, refId: string, maxDepth = 50) {
  const previous = new Map<string, { from: string; relation: KinshipStep["relation"]; subtype: string }>();
  const seen = new Set([refId]);
  let frontier = [refId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const visit = (other: string, relation: KinshipStep["relation"], subtype: string) => {
        if (seen.has(other)) return;
        seen.add(other);
        previous.set(other, { from: id, relation, subtype });
        next.push(other);
      };
      for (const e of index.parentsOf.get(id) ?? []) visit(e.from, "parent", e.subtype);
      for (const e of index.childrenOf.get(id) ?? []) visit(e.to, "child", e.subtype);
      for (const e of index.partnersOf.get(id) ?? []) visit(e.from === id ? e.to : e.from, "partner", e.subtype);
    }
    frontier = next;
  }
  return previous;
}

/** Vater und Mutter für die Linien: leiblich vor adoptiv, je Geschlecht. */
export function parentSlots(
  index: GraphIndex,
  sexOf: (id: string) => Sex,
  id: string,
): { father: string | null; mother: string | null } {
  const edges = lineageParentEdges(index, id);
  const pick = (sex: Sex) =>
    edges.find((e) => e.subtype === "BIOLOGICAL" && sexOf(e.from) === sex)?.from ??
    edges.find((e) => sexOf(e.from) === sex)?.from ??
    null;
  let father = pick("MALE");
  let mother = pick("FEMALE");
  // Genau zwei Elternteile, einer ohne bekanntes Geschlecht: er nimmt den
  // freien Platz ein. Sonst bleibt der Platz leer — geraten wird nicht.
  if (edges.length === 2 && (father === null) !== (mother === null)) {
    const other = edges.find((e) => e.from !== father && e.from !== mother && sexOf(e.from) !== "MALE" && sexOf(e.from) !== "FEMALE");
    if (other) {
      if (father === null) father = other.from;
      else mother = other.from;
    }
  }
  return { father, mother };
}

export type ReferenceResult = {
  refId: string;
  fatherId: string | null;
  motherId: string | null;
  grandparents: Record<LineKey, string | null>;
  /** Je erreichbarer Person (die Bezugsperson selbst eingeschlossen). */
  relatives: Map<string, RelativeInfo>;
};

/**
 * Verwandtschaft und Ahnenlinien aller Personen zur Bezugsperson.
 * `sexOf` liefert das Geschlecht (für die Begriffe und Vater/Mutter).
 */
export function relationsFromReference(
  index: GraphIndex,
  sexOf: (id: string) => Sex,
  refId: string,
): ReferenceResult {
  const blood = bloodRelationsFrom(index, refId);
  const relatives = new Map<string, RelativeInfo>();

  for (const [id, b] of blood) {
    if (id === refId) continue;
    let side: Side = null;
    if (b.lineParentId) {
      const s = sexOf(b.lineParentId);
      side = s === "MALE" ? "paternal" : s === "FEMALE" ? "maternal" : null;
    }
    relatives.set(id, {
      term: bloodRelationTerm({ up: b.up, down: b.down, half: b.half, adoptive: b.adoptive, sex: sexOf(id), side }),
      lines: [],
    });
  }

  // Alle übrigen über den kürzesten Weg (Schwägerschaft, Stiefverhältnisse).
  const previous = pathTree(index, refId);
  for (const id of previous.keys()) {
    if (blood.has(id)) continue;
    const steps: KinshipStep[] = [];
    for (let cursor = id; cursor !== refId; ) {
      const p = previous.get(cursor)!;
      steps.push({ relation: p.relation, subtype: p.subtype, sex: sexOf(cursor) });
      cursor = p.from;
    }
    steps.reverse();
    relatives.set(id, { term: describePath(steps).term, lines: [] });
  }

  // Ahnenlinien: Vorfahren jedes Großelternteils, Eltern auf ihrer Seite.
  const { father, mother } = parentSlots(index, sexOf, refId);
  const fp = father ? parentSlots(index, sexOf, father) : { father: null, mother: null };
  const mp = mother ? parentSlots(index, sexOf, mother) : { father: null, mother: null };
  const grandparents: Record<LineKey, string | null> = { FF: fp.father, FM: fp.mother, MF: mp.father, MM: mp.mother };

  const lineSets = new Map<string, Set<LineKey>>();
  const mark = (id: string, key: LineKey) => {
    if (id === refId) return; // Ahnenschwund im Kreis: die Bezugsperson bleibt sie selbst
    const set = lineSets.get(id) ?? new Set<LineKey>();
    set.add(key);
    lineSets.set(id, set);
  };
  for (const key of LINE_KEYS) {
    const g = grandparents[key];
    if (!g) continue;
    for (const ancestor of ancestorDistances(index, g).keys()) mark(ancestor, key);
  }
  if (father) (["FF", "FM"] as const).forEach((k) => mark(father, k));
  if (mother) (["MF", "MM"] as const).forEach((k) => mark(mother, k));

  for (const [id, set] of lineSets) {
    const info = relatives.get(id) ?? { term: null, lines: [] };
    info.lines = LINE_KEYS.filter((k) => set.has(k));
    relatives.set(id, info);
  }

  return { refId, fatherId: father, motherId: mother, grandparents, relatives };
}
