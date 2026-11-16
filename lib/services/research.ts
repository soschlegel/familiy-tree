import { prisma } from "../prisma";
import { maskPerson, type Scope } from "../scope";
import {
  ancestorsOf,
  descendantsOf,
  shortestPath,
  type PathStep,
} from "../graph";
import { toPersonBrief, type PersonBrief, type PersonRef } from "./dto";
import { loadGraph, type GraphPerson, type LoadedGraph } from "./graph-data";

/**
 * Recherche-Werkzeuge über den Stammbaum: Vorfahren, Nachfahren,
 * Verwandtschaftswege, Statistik, Datenlücken und mögliche Dubletten.
 *
 * Alle Funktionen respektieren die Sichtbarkeit: Ausgangspersonen müssen
 * sichtbar sein (sonst null), unterwegs erreichte unsichtbare Personen
 * erscheinen als Platzhalter, und Auswertungen (Statistik, Lücken, Dubletten)
 * betrachten ausschließlich sichtbare Personen.
 */

export const MAX_GENERATIONS = 25;

const brief = (p: GraphPerson): PersonBrief => toPersonBrief(p);

function refOf(graph: LoadedGraph, id: string): PersonRef {
  const p = graph.persons.get(id);
  return p?.visible ? brief(p) : maskPerson(id);
}

function clampGenerations(generations: number | undefined, fallback: number) {
  const g = Math.floor(generations ?? fallback);
  if (!Number.isFinite(g) || g < 1) return 1;
  return Math.min(g, MAX_GENERATIONS);
}

// ---------------------------------------------------------------------------
// Vorfahren / Nachfahren
// ---------------------------------------------------------------------------

export type LineageResult = {
  root: PersonBrief;
  generations: number;
  entries: {
    person: PersonRef;
    /** 1 = Eltern/Kinder, 2 = Großeltern/Enkel, … */
    generation: number;
    /** Person, über die dieser Eintrag erreicht wurde. */
    viaPersonId: string;
    /** Art der Eltern-Kind-Beziehung (BIOLOGICAL, ADOPTIVE, …). Bei
     *  Platzhaltern ohne sichtbare Seite neutralisiert. */
    subtype: string;
    relationshipId: string;
  }[];
};

function lineage(
  graph: LoadedGraph,
  id: string,
  generations: number,
  direction: "up" | "down",
): LineageResult | null {
  const root = graph.persons.get(id);
  if (!root?.visible) return null;

  const raw =
    direction === "up"
      ? ancestorsOf(graph.index, id, generations)
      : descendantsOf(graph.index, id, generations);

  return {
    root: brief(root),
    generations,
    entries: raw.map((e) => {
      const anyVisible =
        (graph.persons.get(e.personId)?.visible ?? false) ||
        (graph.persons.get(e.viaPersonId)?.visible ?? false);
      return {
        person: refOf(graph, e.personId),
        generation: e.generation,
        viaPersonId: e.viaPersonId,
        subtype: anyVisible ? e.subtype : "BIOLOGICAL",
        relationshipId: e.relationshipId,
      };
    }),
  };
}

/** Vorfahren einer sichtbaren Person, ebenenweise (Standard: 4 Generationen). */
export async function getAncestors(
  scope: Scope,
  id: string,
  generations = 4,
): Promise<LineageResult | null> {
  const graph = await loadGraph(scope);
  return lineage(graph, id, clampGenerations(generations, 4), "up");
}

/** Nachfahren einer sichtbaren Person, ebenenweise (Standard: 4 Generationen). */
export async function getDescendants(
  scope: Scope,
  id: string,
  generations = 4,
): Promise<LineageResult | null> {
  const graph = await loadGraph(scope);
  return lineage(graph, id, clampGenerations(generations, 4), "down");
}

// ---------------------------------------------------------------------------
// Verwandtschaftsweg
// ---------------------------------------------------------------------------

export type RelationshipPathResult = {
  from: PersonBrief;
  to: PersonBrief;
  found: boolean;
  /** Anzahl der Kanten; 0 wenn nicht verbunden. */
  length: number;
  /**
   * Personenkette vom Start zum Ziel. `edge.relation` beschreibt die Rolle der
   * jeweiligen Person gegenüber der vorigen ("parent" = ist Elternteil der
   * vorigen Person).
   */
  steps: { person: PersonRef; edge: PathStep["edge"] }[];
};

/**
 * Kürzester Verbindungsweg zweier sichtbarer Personen über Eltern- und
 * Partnerkanten. Unterwegs liegende unsichtbare Personen erscheinen als
 * Platzhalter. null, wenn eine der beiden Personen nicht sichtbar ist.
 */
export async function findRelationshipPath(
  scope: Scope,
  aId: string,
  bId: string,
): Promise<RelationshipPathResult | null> {
  const graph = await loadGraph(scope);
  const a = graph.persons.get(aId);
  const b = graph.persons.get(bId);
  if (!a?.visible || !b?.visible) return null;

  const path = shortestPath(graph.index, aId, bId);
  if (!path) {
    return { from: brief(a), to: brief(b), found: false, length: 0, steps: [] };
  }

  return {
    from: brief(a),
    to: brief(b),
    found: true,
    length: path.length - 1,
    steps: path.map((step, i) => {
      const prev = i > 0 ? path[i - 1].personId : null;
      const anyVisible =
        (graph.persons.get(step.personId)?.visible ?? false) ||
        (prev ? (graph.persons.get(prev)?.visible ?? false) : false);
      return {
        person: refOf(graph, step.personId),
        edge:
          step.edge && !anyVisible
            ? {
                ...step.edge,
                subtype: step.edge.type === "PARENT_OF" ? "BIOLOGICAL" : "UNMARRIED",
              }
            : step.edge,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------

export type Statistics = {
  persons: {
    total: number;
    living: number;
    deceased: number;
    byGender: Record<"MALE" | "FEMALE" | "OTHER" | "UNKNOWN", number>;
    /** Nur für Administratoren aussagekräftig; sonst immer 0. */
    withoutFamily: number;
  };
  relationships: {
    /** Nur Beziehungen, deren beide Seiten sichtbar sind. */
    parentChild: number;
    partnerships: number;
    bySubtype: Record<string, number>;
  };
  families: { id: string; name: string; personCount: number }[];
  media: { personImages: number };
  missing: {
    birthDate: number;
    birthPlace: number;
    parents: number;
    gender: number;
    /** Vermutlich verstorben (über 100 Jahre), aber ohne Sterbedatum. */
    deathDateLikely: number;
  };
  birthYears: { earliest: number | null; latest: number | null };
};

const LIKELY_DECEASED_AGE = 100;

function probablyDeceased(p: GraphPerson, now: Date): boolean {
  if (p.deathDate || !p.birthDate) return false;
  return now.getUTCFullYear() - p.birthDate.getUTCFullYear() > LIKELY_DECEASED_AGE;
}

export async function getStatistics(scope: Scope): Promise<Statistics> {
  const graph = await loadGraph(scope);
  const now = new Date();
  const visible = [...graph.persons.values()].filter((p) => p.visible);
  const visibleIds = new Set(visible.map((p) => p.id));

  const byGender = { MALE: 0, FEMALE: 0, OTHER: 0, UNKNOWN: 0 };
  let deceased = 0;
  let withoutFamily = 0;
  const missing = { birthDate: 0, birthPlace: 0, parents: 0, gender: 0, deathDateLikely: 0 };
  const years: number[] = [];

  for (const p of visible) {
    byGender[p.gender]++;
    if (p.deathDate) deceased++;
    if (p.familyIds.length === 0) withoutFamily++;
    if (!p.birthDate) missing.birthDate++;
    else years.push(p.birthDate.getUTCFullYear());
    if (!p.birthPlace) missing.birthPlace++;
    if ((graph.index.parentsOf.get(p.id) ?? []).length === 0) missing.parents++;
    if (p.gender === "UNKNOWN") missing.gender++;
    if (probablyDeceased(p, now)) missing.deathDateLikely++;
  }

  const rels = graph.relationships.filter(
    (r) => visibleIds.has(r.from) && visibleIds.has(r.to),
  );
  const bySubtype: Record<string, number> = {};
  for (const r of rels) bySubtype[r.subtype] = (bySubtype[r.subtype] ?? 0) + 1;

  const families = await prisma.family.findMany({
    where: scope.isAdmin ? undefined : { id: { in: [...scope.families.keys()] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const perFamily = new Map<string, number>();
  for (const p of visible) {
    for (const f of p.familyIds) perFamily.set(f, (perFamily.get(f) ?? 0) + 1);
  }

  const personImages = await prisma.personMedia.count({
    where: { personId: { in: [...visibleIds] } },
  });

  return {
    persons: {
      total: visible.length,
      living: visible.length - deceased,
      deceased,
      byGender,
      withoutFamily: scope.isAdmin ? withoutFamily : 0,
    },
    relationships: {
      parentChild: rels.filter((r) => r.type === "PARENT_OF").length,
      partnerships: rels.filter((r) => r.type === "PARTNER_OF").length,
      bySubtype,
    },
    families: families.map((f) => ({
      id: f.id,
      name: f.name,
      personCount: perFamily.get(f.id) ?? 0,
    })),
    media: { personImages },
    missing,
    birthYears: {
      earliest: years.length ? Math.min(...years) : null,
      latest: years.length ? Math.max(...years) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Datenlücken
// ---------------------------------------------------------------------------

export type DataGapKind =
  | "missingBirthDate"
  | "missingBirthPlace"
  | "missingParents"
  | "missingGender"
  | "probablyDeceasedWithoutDeathDate"
  | "deathPlaceWithoutDeathDate"
  | "implausibleParentAge"
  | "isolated"
  | "withoutFamily";

export type DataGaps = {
  counts: Record<DataGapKind, number>;
  /** Je Art höchstens `limit` Personen (Standard 50), nach Name sortiert. */
  items: Record<DataGapKind, { person: PersonBrief; detail?: string }[]>;
};

const GAP_KINDS: DataGapKind[] = [
  "missingBirthDate",
  "missingBirthPlace",
  "missingParents",
  "missingGender",
  "probablyDeceasedWithoutDeathDate",
  "deathPlaceWithoutDeathDate",
  "implausibleParentAge",
  "isolated",
  "withoutFamily",
];

/**
 * Sucht unvollständige oder unplausible Angaben — Ansatzpunkte für die
 * weitere Recherche. Betrachtet nur sichtbare Personen; "withoutFamily" ist
 * nur für Administratoren befüllt (andere sehen solche Personen nicht).
 */
export async function findDataGaps(
  scope: Scope,
  options: { limit?: number } = {},
): Promise<DataGaps> {
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 50)));
  const graph = await loadGraph(scope);
  const now = new Date();

  const visible = [...graph.persons.values()]
    .filter((p) => p.visible)
    .sort(
      (a, b) =>
        (a.familyName ?? "").localeCompare(b.familyName ?? "") ||
        a.givenName.localeCompare(b.givenName) ||
        a.id.localeCompare(b.id),
    );

  const found = Object.fromEntries(
    GAP_KINDS.map((k) => [k, [] as { person: PersonBrief; detail?: string }[]]),
  ) as DataGaps["items"];
  const add = (kind: DataGapKind, p: GraphPerson, detail?: string) =>
    found[kind].push(detail ? { person: brief(p), detail } : { person: brief(p) });

  for (const p of visible) {
    const parents = graph.index.parentsOf.get(p.id) ?? [];
    const children = graph.index.childrenOf.get(p.id) ?? [];
    const partners = graph.index.partnersOf.get(p.id) ?? [];

    if (!p.birthDate) add("missingBirthDate", p);
    if (!p.birthPlace) add("missingBirthPlace", p);
    if (parents.length === 0) add("missingParents", p);
    if (p.gender === "UNKNOWN") add("missingGender", p);
    if (probablyDeceased(p, now)) {
      add(
        "probablyDeceasedWithoutDeathDate",
        p,
        `geboren ${p.birthDate!.getUTCFullYear()}`,
      );
    }
    if (p.deathPlace && !p.deathDate) add("deathPlaceWithoutDeathDate", p);
    if (parents.length + children.length + partners.length === 0) add("isolated", p);
    if (scope.isAdmin && p.familyIds.length === 0) add("withoutFamily", p);

    // Leibliche Eltern, die bei der Geburt unter 14 oder über 70 waren —
    // fast immer ein Erfassungsfehler.
    if (p.birthDate) {
      for (const e of parents) {
        if (e.subtype !== "BIOLOGICAL") continue;
        const parent = graph.persons.get(e.from);
        if (!parent?.visible || !parent.birthDate) continue;
        const age = p.birthDate.getUTCFullYear() - parent.birthDate.getUTCFullYear();
        if (age < 14 || age > 70) {
          add(
            "implausibleParentAge",
            p,
            `${parent.givenName} ${parent.familyName ?? ""}`.trim() +
              ` war bei der Geburt ${age} Jahre alt`,
          );
        }
      }
    }
  }

  const counts = Object.fromEntries(
    GAP_KINDS.map((k) => [k, found[k].length]),
  ) as DataGaps["counts"];
  const items = Object.fromEntries(
    GAP_KINDS.map((k) => [k, found[k].slice(0, limit)]),
  ) as DataGaps["items"];

  return { counts, items };
}

// ---------------------------------------------------------------------------
// Mögliche Dubletten
// ---------------------------------------------------------------------------

/** Vereinheitlicht Schreibweisen: Umlaute, ß, ph/f, th/t, Doppelbuchstaben. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, (m) => (m === "̈" ? "e" : ""))
    .replace(/ß/g, "ss")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export type DuplicateCandidate = {
  a: PersonBrief;
  b: PersonBrief;
  /** 0..1, höher = wahrscheinlicher dieselbe Person. */
  score: number;
  reasons: string[];
};

/**
 * Paare sichtbarer Personen, die vermutlich doppelt erfasst sind: gleicher
 * oder sehr ähnlicher Name und Geburtsjahr höchstens `maxYearDiff` Jahre
 * auseinander (oder bei einer Seite unbekannt). Direkt miteinander verbundene
 * Personen (Eltern/Kind, Partner) werden nicht gemeldet.
 */
export async function findPossibleDuplicates(
  scope: Scope,
  options: { maxYearDiff?: number; limit?: number } = {},
): Promise<DuplicateCandidate[]> {
  const maxYearDiff = Math.max(0, Math.min(10, options.maxYearDiff ?? 2));
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const graph = await loadGraph(scope);

  const visible = [...graph.persons.values()].filter((p) => p.visible);

  const linked = new Set<string>();
  for (const r of graph.relationships) {
    linked.add(`${r.from}|${r.to}`);
    linked.add(`${r.to}|${r.from}`);
  }

  // Vorab nach normalisiertem Vornamen gruppieren — vergleicht nur, was
  // überhaupt in Frage kommt, statt jedes Paar.
  const byGiven = new Map<string, GraphPerson[]>();
  for (const p of visible) {
    const key = normalizeName(p.givenName.split(/\s+/)[0]);
    const list = byGiven.get(key);
    if (list) list.push(p);
    else byGiven.set(key, [p]);
  }

  const result: DuplicateCandidate[] = [];

  for (const group of byGiven.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]].sort((x, y) => x.id.localeCompare(y.id));
        if (linked.has(`${a.id}|${b.id}`)) continue;
        if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) continue;

        const reasons: string[] = [];
        let score = 0;

        const famA = normalizeName(a.familyName);
        const famB = normalizeName(b.familyName);
        const birthA = normalizeName(a.birthName);
        const birthB = normalizeName(b.birthName);

        if (famA && famA === famB) {
          score += 0.4;
          reasons.push(
            a.familyName === b.familyName
              ? "gleicher Nachname"
              : `ähnliche Schreibweise (${a.familyName} / ${b.familyName})`,
          );
        } else if (famA && famB && levenshtein(famA, famB) <= 1) {
          score += 0.3;
          reasons.push(`ähnlicher Nachname (${a.familyName} / ${b.familyName})`);
        } else if ((birthA && birthA === famB) || (birthB && birthB === famA)) {
          score += 0.3;
          reasons.push("Geburtsname entspricht dem Nachnamen");
        } else {
          continue;
        }

        if (a.givenName.trim() === b.givenName.trim()) {
          score += 0.2;
          reasons.push("gleicher Vorname");
        } else {
          score += 0.1;
          reasons.push(`ähnlicher Vorname (${a.givenName} / ${b.givenName})`);
        }

        const ya = a.birthDate?.getUTCFullYear();
        const yb = b.birthDate?.getUTCFullYear();
        if (ya !== undefined && yb !== undefined) {
          const diff = Math.abs(ya - yb);
          if (diff > maxYearDiff) continue;
          score += diff === 0 ? 0.3 : 0.2;
          reasons.push(diff === 0 ? `gleiches Geburtsjahr (${ya})` : `Geburtsjahre ${ya} / ${yb}`);
          if (a.birthDate!.getTime() === b.birthDate!.getTime()) {
            score += 0.1;
            reasons.push("identisches Geburtsdatum");
          }
        } else if (ya === undefined && yb === undefined) {
          continue;
        } else {
          score += 0.05;
          reasons.push("Geburtsjahr nur bei einer Person bekannt");
        }

        if (a.birthPlace && b.birthPlace && a.birthPlace === b.birthPlace) {
          score += 0.1;
          reasons.push(`gleicher Geburtsort (${a.birthPlace})`);
        }

        result.push({
          a: brief(a),
          b: brief(b),
          score: Math.min(1, Math.round(score * 100) / 100),
          reasons,
        });
      }
    }
  }

  return result
    .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id))
    .slice(0, limit);
}
