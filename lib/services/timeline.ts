import { prisma } from "../prisma";
import { maskPerson, type Scope } from "../scope";
import { fullName, toPersonBrief, type PersonBrief, type PersonRef } from "./dto";
import { loadGraph, type GraphPerson, type GraphRelationship, type LoadedGraph } from "./graph-data";
import {
  formatFuzzyDate,
  fuzzyField,
  isPreciseDate,
  toFuzzyDate,
  yearsBetween,
  type DatePrecision,
  type DateQualifier,
  type FuzzyDate,
} from "../dates";

/**
 * Zeitleisten: Lebensereignisse einer Person bzw. einer Familie in
 * zeitlicher Reihenfolge.
 *
 * Sichtbarkeit: Geburt und Tod erscheinen nur für sichtbare Personen.
 * Beziehungsereignisse (Heirat, Scheidung, Adoption) erscheinen, sobald eine
 * Seite sichtbar ist — wie in der Baumansicht; die andere Seite steht dann
 * als Platzhalter darin.
 */

export type TimelineEventKind =
  | "birth"
  | "death"
  | "marriage"
  | "partnership"
  | "divorce"
  | "partnershipEnd"
  | "adoption"
  | "fostering"
  | "stepParent";

export type TimelineEvent = {
  /** Ankerpunkt (ISO) — zum Sortieren; angezeigt wird `dateText`. */
  date: string;
  datePrecision: DatePrecision;
  dateQualifier: DateQualifier;
  /** Deutsche Anzeige: „12.03.1850“, „um 1850“, „vor 1900“. */
  dateText: string;
  kind: TimelineEventKind;
  /** Deutsche Kurzbeschreibung, z.B. "Heirat von Anna Becker und Karl Müller". */
  label: string;
  /** Hauptbeteiligte (bei Beziehungen beide Seiten bzw. Elternteil und Kind). */
  persons: PersonRef[];
  place: string | null;
  relationshipId: string | null;
  /** Nur in der Personen-Zeitleiste: Rolle gegenüber der Person. */
  role?: "self" | "parent" | "child" | "partner" | "sibling";
  /** Nur in der Personen-Zeitleiste: Alter der Person beim Ereignis. */
  age?: number | null;
  /** Alter ist nur ungefähr (ungenaues Geburts- oder Ereignisdatum). */
  ageApproximate?: boolean;
};

/** Datumsfelder eines Ereignisses aus einem ungenauen Datum. */
function when(f: FuzzyDate): Pick<TimelineEvent, "date" | "datePrecision" | "dateQualifier" | "dateText"> {
  return {
    date: f.date.toISOString(),
    datePrecision: f.precision,
    dateQualifier: f.qualifier,
    dateText: formatFuzzyDate(f),
  };
}

const eventDate = (e: TimelineEvent) => toFuzzyDate(e.date, e.datePrecision, e.dateQualifier)!;

const ref = (graph: LoadedGraph, id: string): PersonRef => {
  const p = graph.persons.get(id);
  return p?.visible ? toPersonBrief(p) : maskPerson(id);
};

const label = (graph: LoadedGraph, id: string) => {
  const p = graph.persons.get(id);
  return p?.visible ? fullName(p) : "(nicht freigegeben)";
};

function lifeEvents(p: GraphPerson): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const birth = fuzzyField(p, "birthDate");
  const death = fuzzyField(p, "deathDate");
  if (birth) {
    events.push({
      ...when(birth),
      kind: "birth",
      label: `Geburt von ${fullName(p)}`,
      persons: [toPersonBrief(p)],
      place: p.birthPlace,
      relationshipId: null,
    });
  }
  if (death) {
    events.push({
      ...when(death),
      kind: "death",
      label: `Tod von ${fullName(p)}`,
      persons: [toPersonBrief(p)],
      place: p.deathPlace,
      relationshipId: null,
    });
  }
  return events;
}

function relationshipEvents(graph: LoadedGraph, r: GraphRelationship): TimelineEvent[] {
  const anyVisible =
    (graph.persons.get(r.from)?.visible ?? false) || (graph.persons.get(r.to)?.visible ?? false);
  if (!anyVisible) return [];
  const persons = [ref(graph, r.from), ref(graph, r.to)];
  const both = `${label(graph, r.from)} und ${label(graph, r.to)}`;
  const events: TimelineEvent[] = [];
  const base = { persons, place: null, relationshipId: r.id };

  const start = fuzzyField(r, "startDate");
  const end = fuzzyField(r, "endDate");
  if (r.type === "PARTNER_OF") {
    if (start) {
      const married = r.subtype === "MARRIED" || r.subtype === "DIVORCED";
      events.push({
        ...base,
        ...when(start),
        kind: married ? "marriage" : "partnership",
        label: married ? `Heirat von ${both}` : `Beginn der Partnerschaft von ${both}`,
      });
    }
    if (end) {
      const divorced = r.subtype === "DIVORCED";
      events.push({
        ...base,
        ...when(end),
        kind: divorced ? "divorce" : "partnershipEnd",
        label: divorced ? `Scheidung von ${both}` : `Ende der Partnerschaft von ${both}`,
      });
    }
  } else if (start && r.subtype !== "BIOLOGICAL") {
    const kind =
      r.subtype === "ADOPTIVE" ? "adoption" : r.subtype === "FOSTER" ? "fostering" : "stepParent";
    const text =
      kind === "adoption"
        ? `Adoption von ${label(graph, r.to)} durch ${label(graph, r.from)}`
        : kind === "fostering"
          ? `${label(graph, r.to)} kommt als Pflegekind zu ${label(graph, r.from)}`
          : `${label(graph, r.from)} wird Stiefelternteil von ${label(graph, r.to)}`;
    events.push({ ...base, ...when(start), kind, label: text });
  }
  return events;
}

const byDate = (a: TimelineEvent, b: TimelineEvent) =>
  a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label);

export type PersonTimeline = {
  person: PersonBrief;
  events: TimelineEvent[];
  /** Fehlende Daten, die für eine vollständige Zeitleiste nötig wären. */
  missing: string[];
};

/**
 * Zeitleiste einer sichtbaren Person: eigene Geburt und eigener Tod,
 * Partnerschaften (Beginn/Ende), Adoption/Pflege, Geburt und Tod der Kinder,
 * Tod der Eltern, Partner und Geschwister. null, wenn die Person nicht
 * sichtbar ist.
 */
export async function getPersonTimeline(
  scope: Scope,
  personId: string,
): Promise<PersonTimeline | null> {
  const graph = await loadGraph(scope);
  const self = graph.persons.get(personId);
  if (!self?.visible) return null;

  const events: TimelineEvent[] = [];
  const missing: string[] = [];
  const withRole = (list: TimelineEvent[], role: TimelineEvent["role"]) =>
    list.map((e) => ({ ...e, role }));

  events.push(...withRole(lifeEvents(self), "self"));
  const selfBirth = fuzzyField(self, "birthDate");
  const selfDeath = fuzzyField(self, "deathDate");
  if (!selfBirth) missing.push("Geburtsdatum");
  else if (!isPreciseDate(selfBirth)) missing.push(`genaues Geburtsdatum (bisher: ${formatFuzzyDate(selfBirth)})`);
  if (!selfDeath && self.deathPlace) missing.push("Sterbedatum (Sterbeort ist bekannt)");
  else if (selfDeath && !isPreciseDate(selfDeath)) missing.push(`genaues Sterbedatum (bisher: ${formatFuzzyDate(selfDeath)})`);

  const relById = new Map(graph.relationships.map((r) => [r.id, r]));

  for (const e of graph.index.partnersOf.get(personId) ?? []) {
    const r = relById.get(e.id)!;
    const otherId = r.from === personId ? r.to : r.from;
    events.push(...withRole(relationshipEvents(graph, r), "partner"));
    if (!r.startDate) {
      missing.push(
        `${r.subtype === "UNMARRIED" ? "Beginn der Partnerschaft" : "Heiratsdatum"} mit ${label(graph, otherId)}`,
      );
    }
    if (r.subtype === "DIVORCED" && !r.endDate) missing.push(`Scheidungsdatum (${label(graph, otherId)})`);
    const other = graph.persons.get(otherId);
    if (other?.visible) {
      events.push(...withRole(lifeEvents(other).filter((x) => x.kind === "death"), "partner"));
    }
  }

  for (const e of graph.index.parentsOf.get(personId) ?? []) {
    const r = relById.get(e.id)!;
    events.push(...withRole(relationshipEvents(graph, r), "parent"));
    const parent = graph.persons.get(e.from);
    if (parent?.visible) {
      events.push(...withRole(lifeEvents(parent).filter((x) => x.kind === "death"), "parent"));
    }
  }

  const siblingIds = new Set<string>();
  for (const e of graph.index.parentsOf.get(personId) ?? []) {
    for (const c of graph.index.childrenOf.get(e.from) ?? []) {
      if (c.to !== personId) siblingIds.add(c.to);
    }
  }
  for (const id of siblingIds) {
    const s = graph.persons.get(id);
    if (s?.visible) {
      events.push(...withRole(lifeEvents(s).filter((x) => x.kind === "death"), "sibling"));
    }
  }

  for (const e of graph.index.childrenOf.get(personId) ?? []) {
    const r = relById.get(e.id)!;
    events.push(...withRole(relationshipEvents(graph, r), "child"));
    const child = graph.persons.get(e.to);
    if (child?.visible) {
      events.push(...withRole(lifeEvents(child), "child"));
      if (!child.birthDate) missing.push(`Geburtsdatum des Kindes ${fullName(child)}`);
    }
  }

  // Doppelte Beziehungsereignisse vermeiden (z.B. Adoption als Kind und als
  // Elternteil kann hier nicht doppelt auftreten, Partnerschaften aber bei
  // Datenfehlern schon).
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.kind}|${e.date}|${e.relationshipId ?? e.persons[0]?.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Alter beim Ereignis. Bei ungenauen Daten ein Näherungswert
  // (ageApproximate), bei offenen Angaben („vor“/„nach“) keiner.
  for (const e of unique) {
    if (!selfBirth) {
      e.age = null;
      continue;
    }
    if (e.role === "self" && e.kind === "birth") {
      e.age = 0;
      continue;
    }
    const range = yearsBetween(selfBirth, eventDate(e));
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      e.age = null;
    } else {
      e.age = Math.floor((new Date(e.date).getTime() - selfBirth.date.getTime()) / (365.2425 * 24 * 3600 * 1000));
      if (!range.exact) e.ageApproximate = true;
    }
    if (self.deathDate && new Date(e.date) > self.deathDate && e.role !== "self") {
      // Ereignisse nach dem eigenen Tod behalten (z.B. Tod eines Kindes),
      // aber ohne Altersangabe.
      e.age = null;
      delete e.ageApproximate;
    }
  }

  return { person: toPersonBrief(self), events: unique.sort(byDate), missing };
}

export type FamilyTimeline = {
  family: { id: string; name: string };
  total: number;
  events: TimelineEvent[];
};

/**
 * Zeitleiste einer Familie: Geburten und Todesfälle der sichtbaren
 * Familienmitglieder sowie Partnerschaften und Adoptionen, an denen sie
 * beteiligt sind. Fremde Familien liefern null (wie bei der Suche: ihre
 * Existenz wird nicht bestätigt).
 */
export async function getFamilyTimeline(
  scope: Scope,
  familyId: string,
  options: { fromYear?: number; toYear?: number; limit?: number; offset?: number } = {},
): Promise<FamilyTimeline | null> {
  if (!scope.isAdmin && !scope.families.has(familyId)) return null;
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, name: true },
  });
  if (!family) return null;

  const graph = await loadGraph(scope);
  const members = [...graph.persons.values()].filter(
    (p) => p.visible && p.familyIds.includes(familyId),
  );
  const memberIds = new Set(members.map((p) => p.id));

  const events: TimelineEvent[] = members.flatMap(lifeEvents);
  for (const r of graph.relationships) {
    if (!memberIds.has(r.from) && !memberIds.has(r.to)) continue;
    events.push(...relationshipEvents(graph, r));
  }

  const from = options.fromYear;
  const to = options.toYear;
  const filtered = events
    .filter((e) => {
      const y = Number(e.date.slice(0, 4));
      return (from === undefined || y >= from) && (to === undefined || y <= to);
    })
    .sort(byDate);

  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)));

  return {
    family,
    total: filtered.length,
    events: filtered.slice(offset, offset + limit),
  };
}
