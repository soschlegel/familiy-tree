import { parseRingsGeneration } from "../ancestor-rings";
import { chartColor } from "../chart-slices";
import {
  DESCENDANT_RINGS_DEFAULT_GENERATION,
  DESCENDANT_RINGS_MAX_SEGMENTS,
  descendantRelationTerm,
  layoutDescendants,
  type RingChild,
} from "../descendant-rings";
import type { Sex } from "../kinship";
import { prisma } from "../prisma";
import { canViewPerson, personVisibilityFilter, type Scope } from "../scope";
import {
  RING_PERSON_SELECT,
  ringPlaceLegend,
  toRingPersonDto,
  type RingAreaDto,
  type RingPersonDto,
  type RingPersonRow,
} from "./ancestor-rings";

/**
 * Ansicht „Ringe“, Richtung „Nachfahren“ (components/AncestorRings.tsx):
 * die Nachkommen einer Person, der Vollkreis nach der Größe der Teilbäume
 * aufgeteilt. Aufteilung und Obergrenze in lib/descendant-rings.ts.
 *
 * Kinder: `PARENT_OF` mit Untertyp `BIOLOGICAL` oder `ADOPTIVE` (wie die
 * Seite „Statistik“), keine Stief- und Pflegekinder.
 *
 * Laden: Generation für Generation eine Abfrage der Kinder der zuletzt
 * gefundenen sichtbaren Personen samt deren Angaben (höchstens N Abfragen,
 * Mehrfach-Nachkommen und Zyklen fragen nichts doppelt; reißt eine
 * Generation die Obergrenze der Flächen, wird nicht tiefer geladen). Danach
 * eine Abfrage der übrigen Eltern aller geladenen Kinder (für die Gruppen
 * nach Partnerschaft und die Partner in den Angaben), eine der
 * Partnerschaften der gezeigten Personen und die zwei der Färbung „nach
 * Wurzeln“ — nie eine Abfrage je Person und nie der ganze Graph.
 *
 * Datenschutz wie bei den Vorfahren und den anderen Baumansichten: Die
 * Mitte muss sichtbar sein (sonst null). Ein nicht sichtbares Kind
 * erscheint — wie der Platzhalter in den Ansichten Fokus und Generationen —
 * als Fläche „nicht freigegeben“ ohne Kennung, Namen, Daten, Ort und
 * Geschlecht; nach seinem Geburtsdatum wird nicht sortiert (es steht wie
 * ein Kind ohne Datum nach Anlage), seine Kinder werden nicht gesucht.
 * Partner werden nur genannt, wenn sie sichtbar sind.
 */

const CHILD_SUBTYPES = ["BIOLOGICAL", "ADOPTIVE"] as const;

export type DescendantSegmentDto = {
  key: string;
  generation: number;
  start: number;
  end: number;
  /** Nummer des Kindes der Mitte (Färbung „nach Linie“). */
  line: number;
  /** Fläche des Elternteils (Generation 1: null). */
  parentKey: string | null;
  /** Verwandtschaftsstufe aus Sicht der Mitte („Enkelin“). */
  term: string;
} & (
  | {
      kind: "person";
      personId: string;
      /** Adoptivkind des Elternteils. */
      adopted: boolean;
      /** Färbung „nach Wurzeln“: Schlüssel des Legendeneintrags. */
      area: string;
    }
  | { kind: "restricted" }
);

/** Linie = ein Kind der Mitte mit seiner Farbe und der Zahl seiner gezeigten Nachkommen (samt sich selbst). */
export type DescendantLineDto = {
  line: number;
  personId: string | null;
  color: string;
  count: number;
};

export type DescendantRingsDto = {
  direction: "nachfahren";
  root: RingPersonDto;
  /** Gewählte Tiefe (3…7). */
  generations: number;
  /** Gezeigte Tiefe — kleiner als `generations`, wenn die Obergrenze greift. */
  shownGenerations: number;
  /** Tiefste Generation mit Nachkommen (0: keine). */
  deepest: number;
  capped: boolean;
  /** Sichtbare Personen der Flächen (und die Mitte) nach Kennung. */
  persons: Record<string, RingPersonDto>;
  /** Sichtbare Partner (Namen) je sichtbarer Person der Flächen und der Mitte. */
  partners: Record<string, string[]>;
  /** Flächen, innen nach außen, im Uhrzeigersinn. */
  segments: DescendantSegmentDto[];
  /** Verschiedene Nachkommen (jede Person einmal) bzw. davon nicht freigegebene Flächen. */
  count: number;
  restricted: number;
  lines: DescendantLineDto[];
  /** Legende der Färbung „nach Wurzeln“, Zahl = Flächen. */
  areas: RingAreaDto[];
};

type ChildRow = RingPersonRow & { createdAt: Date; families: { familyId: string }[] };

const personName = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

export async function loadDescendantRings(
  scope: Scope,
  rootId: string,
  generations: unknown = undefined,
  maxSegments: number = DESCENDANT_RINGS_MAX_SEGMENTS,
): Promise<DescendantRingsDto | null> {
  const n = parseRingsGeneration(generations, DESCENDANT_RINGS_DEFAULT_GENERATION);
  const root = await prisma.person.findUnique({ where: { id: rootId }, select: RING_PERSON_SELECT });
  if (!root || !canViewPerson(scope, root.families.map((f) => f.familyId))) return null;

  const rows = new Map<string, RingPersonRow>([[root.id, root]]);
  const restricted = new Set<string>();
  const children = new Map<string, { id: string; adopted: boolean; birth: number | null; created: number }[]>();
  // Flächen je Person (Mehrfach-Nachkommen mehrfach) — nur für den Abbruch
  // beim Laden; die genaue Obergrenze setzt layoutDescendants.
  const appearances = new Map<string, number>([[root.id, 1]]);
  let segmentCount = 0;
  let frontier = [root.id];
  for (let g = 1; g <= n && frontier.length; g++) {
    const rels = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", subtype: { in: [...CHILD_SUBTYPES] }, fromPersonId: { in: frontier } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { fromPersonId: true, subtype: true, toPerson: { select: { ...RING_PERSON_SELECT, createdAt: true } } },
    });
    for (const id of frontier) children.set(id, []);
    const next: string[] = [];
    for (const r of rels) {
      const c = r.toPerson as ChildRow;
      const known = rows.has(c.id) || restricted.has(c.id);
      const visible = known ? rows.has(c.id) : canViewPerson(scope, c.families.map((f) => f.familyId));
      const list = children.get(r.fromPersonId)!;
      const twin = list.find((x) => x.id === c.id);
      // Leiblich und adoptiert zugleich (doppelt erfasst): leiblich gewinnt.
      if (twin) {
        if (r.subtype === "BIOLOGICAL") twin.adopted = false;
        continue;
      }
      list.push({
        id: c.id,
        adopted: r.subtype === "ADOPTIVE",
        // Ein nicht sichtbares Kind verrät auch über die Reihenfolge nichts von seinem Geburtsdatum.
        birth: visible && c.birthDate ? c.birthDate.getTime() : null,
        created: c.createdAt.getTime(),
      });
      const times = appearances.get(r.fromPersonId) ?? 1;
      appearances.set(c.id, (appearances.get(c.id) ?? 0) + times);
      segmentCount += times;
      if (known) continue;
      if (visible) {
        rows.set(c.id, c);
        next.push(c.id);
      } else {
        restricted.add(c.id);
      }
    }
    frontier = next;
    // Die Obergrenze ist gerissen: tiefer zu laden lohnt nicht.
    if (g > 1 && segmentCount > maxSegments) break;
  }
  // Ältere zuerst, ohne Datum danach; gleich: nach Anlage.
  for (const list of children.values()) {
    list.sort(
      (a, b) =>
        (a.birth === null ? 1 : 0) - (b.birth === null ? 1 : 0) ||
        (a.birth ?? 0) - (b.birth ?? 0) ||
        a.created - b.created ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  // Übrige Eltern aller geladenen Kinder: Gruppe nach Partnerschaft und
  // Mit-Eltern als Partner der Angaben.
  const childIds = [...new Set([...children.values()].flatMap((l) => l.map((c) => c.id)))];
  const parentRels = childIds.length
    ? await prisma.relationship.findMany({
        where: { type: "PARENT_OF", subtype: { in: [...CHILD_SUBTYPES] }, toPersonId: { in: childIds } },
        select: {
          fromPersonId: true,
          toPersonId: true,
          fromPerson: { select: { id: true, givenName: true, familyName: true, families: { select: { familyId: true } } } },
        },
      })
    : [];
  const parentsOf = new Map<string, Set<string>>();
  type Named = { id: string; givenName: string; familyName: string | null; families: { familyId: string }[] };
  const named = new Map<string, Named>();
  for (const r of parentRels) {
    const set = parentsOf.get(r.toPersonId) ?? new Set<string>();
    set.add(r.fromPersonId);
    parentsOf.set(r.toPersonId, set);
    named.set(r.fromPerson.id, r.fromPerson);
  }
  const groupOf = (parentId: string, childId: string) =>
    [...(parentsOf.get(childId) ?? [])].filter((p) => p !== parentId).sort().join(",");

  const layout = layoutDescendants({
    rootId: root.id,
    generations: n,
    maxSegments,
    visible: (id) => rows.has(id),
    childrenOf: (id): RingChild[] =>
      (children.get(id) ?? []).map((c) => ({ id: c.id, adopted: c.adopted, group: groupOf(id, c.id) })),
  });

  const shownIds = [...new Set(layout.segments.flatMap((s) => (s.kind === "person" ? [s.personId] : [])))];

  // Partner: Partnerschaften der gezeigten sichtbaren Personen und der Mitte
  // sowie die Mit-Eltern ihrer gezeigten Kinder — genannt nur, wenn sichtbar.
  const partnerIds = new Map<string, Set<string>>();
  const addPartner = (a: string, b: string) => {
    if (a === b) return;
    const set = partnerIds.get(a) ?? new Set<string>();
    set.add(b);
    partnerIds.set(a, set);
  };
  const withPartners = [root.id, ...shownIds];
  const partnerRels = await prisma.relationship.findMany({
    where: { type: "PARTNER_OF", OR: [{ fromPersonId: { in: withPartners } }, { toPersonId: { in: withPartners } }] },
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      fromPerson: { select: { id: true, givenName: true, familyName: true, families: { select: { familyId: true } } } },
      toPerson: { select: { id: true, givenName: true, familyName: true, families: { select: { familyId: true } } } },
    },
  });
  for (const r of partnerRels) {
    named.set(r.fromPerson.id, r.fromPerson);
    named.set(r.toPerson.id, r.toPerson);
    addPartner(r.fromPerson.id, r.toPerson.id);
    addPartner(r.toPerson.id, r.fromPerson.id);
  }
  const segmentByKey = new Map(layout.segments.map((s) => [s.key, s]));
  for (const s of layout.segments) {
    const parent = s.parentKey ? segmentByKey.get(s.parentKey) : null;
    const parentId = parent ? (parent.kind === "person" ? parent.personId : null) : root.id;
    if (!parentId || s.kind !== "person") continue;
    for (const other of parentsOf.get(s.personId) ?? []) addPartner(parentId, other);
  }
  const visibleNamed = (id: string) => {
    if (rows.has(id)) return true;
    const p = named.get(id);
    return Boolean(p && canViewPerson(scope, p.families.map((f) => f.familyId)));
  };
  const partners: Record<string, string[]> = {};
  for (const id of withPartners) {
    const names = [...(partnerIds.get(id) ?? [])]
      .filter((p) => visibleNamed(p))
      .map((p) => personName(rows.get(p) ?? named.get(p)!));
    if (names.length) partners[id] = [...new Set(names)];
  }

  const { areas, areaOf } = await ringPlaceLegend(
    rows,
    layout.segments.map((s) => (s.kind === "person" ? s.personId : null)),
  );

  const persons: Record<string, RingPersonDto> = { [root.id]: toRingPersonDto(root) };
  for (const id of shownIds) persons[id] = toRingPersonDto(rows.get(id)!);

  const lines: DescendantLineDto[] = layout.segments
    .filter((s) => s.generation === 1)
    .map((s) => ({
      line: s.line,
      personId: s.kind === "person" ? s.personId : null,
      color: chartColor(s.line),
      count: layout.segments.filter((t) => t.line === s.line).length,
    }));

  const distinct = new Set<string>();
  let restrictedCount = 0;
  for (const s of layout.segments) {
    if (s.kind === "person") distinct.add(s.personId);
    else restrictedCount += 1;
  }

  return {
    direction: "nachfahren",
    root: persons[root.id],
    generations: n,
    shownGenerations: layout.shownGenerations,
    deepest: layout.deepest,
    capped: layout.capped,
    persons,
    partners,
    segments: layout.segments.map((s) => {
      const base = {
        key: s.key,
        generation: s.generation,
        start: Math.round(s.start * 1000) / 1000,
        end: Math.round(s.end * 1000) / 1000,
        line: s.line,
        parentKey: s.parentKey,
      };
      return s.kind === "person"
        ? {
            ...base,
            kind: "person" as const,
            personId: s.personId,
            adopted: s.adopted,
            area: areaOf(s.personId),
            term: descendantRelationTerm(s.generation, persons[s.personId].gender as Sex),
          }
        : { ...base, kind: "restricted" as const, term: descendantRelationTerm(s.generation, "UNKNOWN") };
    }),
    // Nicht sichtbare Nachkommen haben keine Kennung in der Antwort: jede
    // Fläche „nicht freigegeben“ zählt als eine Person.
    count: distinct.size + restrictedCount,
    restricted: restrictedCount,
    lines,
    areas,
  };
}

/**
 * Mitte der Nachfahren-Ringe, wenn nichts anderes passt: eine sichtbare
 * Person mit (leiblichen oder adoptierten) Kindern, die älteste zuerst — so
 * zeigt der Kreis gleich viele Generationen (eine Abfrage). Sonst irgendeine
 * sichtbare Person; ohne sichtbare Person null.
 */
export async function defaultDescendantRingsRootId(scope: Scope): Promise<string | null> {
  const withChildren = await prisma.person.findFirst({
    where: { ...personVisibilityFilter(scope), relationsFrom: { some: { type: "PARENT_OF", subtype: { in: [...CHILD_SUBTYPES] } } } },
    orderBy: [{ birthDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true },
  });
  if (withChildren) return withChildren.id;
  const any = await prisma.person.findFirst({ where: personVisibilityFilter(scope), orderBy: { id: "asc" }, select: { id: true } });
  return any?.id ?? null;
}
