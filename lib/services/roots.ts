import { z } from "zod";

import type { AreaLevel } from "../places/area";
import { placeKey } from "../places/normalize";
import { prisma } from "../prisma";
import {
  ancestorShares,
  clampRootsGeneration,
  ROOTS_DEFAULT_GENERATION,
  ROOTS_MAX_GENERATION,
  ROOTS_MIN_GENERATION,
  rootsSlices,
  type RootsCategory,
  type RootsSlice,
} from "../roots";
import { canViewPerson, type Scope } from "../scope";
import { parseOrThrow } from "./errors";
import { placeAreasFor } from "./place-areas";

/**
 * Abschnitt „Wurzeln“ der Personenseite: Anteile der Länder bzw. Regionen,
 * aus denen die Vorfahren stammen (Rechnung in lib/roots.ts, Gebiete in
 * lib/places/area.ts).
 *
 * Laden: Generation für Generation eine Abfrage der leiblichen
 * Eltern-Kind-Beziehungen (höchstens N Abfragen mit je höchstens 2^g
 * Personen), dann eine für die Taufen, eine für die Ortszuordnungen — nie
 * eine Abfrage je Vorfahr und nie der ganze Graph.
 *
 * Datenschutz: Die Ausgangsperson muss sichtbar sein (sonst null). Von
 * nicht sichtbaren Vorfahren wird weder ein Ort gelesen noch werden ihre
 * Eltern gesucht; ihr Anteil heißt „nicht freigegeben“. Die Antwort enthält
 * nur Gebietsnamen, Anteile und Zählungen — keine Personen, keine Ortstexte.
 */

/** Ereignisse, deren Ort ersatzweise für den Geburtsort zählt. */
const BAPTISM_TYPES = ["BAPTISM", "CHRISTENING"] as const;

export type PersonRootsDto = {
  personId: string;
  generations: number;
  level: AreaLevel;
  slices: RootsSlice[];
  /** Plätze in Generation N (2^N) und davon mit sichtbaren Vorfahren besetzte. */
  slots: number;
  filledSlots: number;
  /** Leibliche Eltern der Ausgangsperson (auch nicht sichtbare). 0: Abschnitt entfällt. */
  parentCount: number;
};

const optionsSchema = z.object({
  generations: z.coerce
    .number()
    .int()
    .min(ROOTS_MIN_GENERATION, `Generation mindestens ${ROOTS_MIN_GENERATION}`)
    .max(ROOTS_MAX_GENERATION, `Generation höchstens ${ROOTS_MAX_GENERATION}`)
    .default(ROOTS_DEFAULT_GENERATION),
  level: z.enum(["country", "region"]).default("country"),
});

export type PersonRootsOptions = { generations?: unknown; level?: unknown };

/** Eingaben der API prüfen (Generation 2…8, Stufe Land/Region). */
export function parseRootsOptions(raw: PersonRootsOptions): { generations: number; level: AreaLevel } {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return parseOrThrow(optionsSchema.safeParse(clean));
}

type Loaded = { visible: boolean; birthPlace: string | null };

export async function getPersonRoots(
  scope: Scope,
  personId: string,
  opts: PersonRootsOptions = {},
): Promise<PersonRootsDto | null> {
  const { generations, level } = parseRootsOptions(opts);
  const n = clampRootsGeneration(generations);

  const root = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, families: { select: { familyId: true } } },
  });
  if (!root || !canViewPerson(scope, root.families.map((f) => f.familyId))) return null;

  // Generation für Generation: Eltern nur von sichtbaren, noch nicht
  // gefragten Personen. Ahnenschwund und Zyklen fragen nichts doppelt.
  const persons = new Map<string, Loaded>([[root.id, { visible: true, birthPlace: null }]]);
  const parents = new Map<string, string[]>();
  let frontier = [root.id];
  for (let g = 1; g <= n && frontier.length; g++) {
    const rels = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", subtype: "BIOLOGICAL", toPersonId: { in: frontier } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        toPersonId: true,
        fromPerson: { select: { id: true, birthPlace: true, families: { select: { familyId: true } } } },
      },
    });
    for (const id of frontier) parents.set(id, []);
    const next: string[] = [];
    for (const r of rels) {
      const p = r.fromPerson;
      parents.get(r.toPersonId)!.push(p.id);
      if (persons.has(p.id)) continue;
      const visible = canViewPerson(scope, p.families.map((f) => f.familyId));
      // Ort einer nicht sichtbaren Person gar nicht erst behalten.
      persons.set(p.id, { visible, birthPlace: visible ? p.birthPlace : null });
      if (visible) next.push(p.id);
    }
    frontier = next;
  }

  const shares = ancestorShares({
    rootId: root.id,
    generations: n,
    parentsOf: (id) => parents.get(id) ?? [],
    visible: (id) => persons.get(id)?.visible ?? false,
  });
  if (shares.parentCount === 0) {
    return { personId: root.id, generations: n, level, slices: [], slots: shares.slots, filledSlots: 0, parentCount: 0 };
  }

  // Ort je beitragendem (sichtbarem) Vorfahren: Geburtsort, sonst Taufort.
  const contributing = new Set<string>();
  for (const c of shares.contributions) if (c.kind === "person") contributing.add(c.personId);
  const placeOf = new Map<string, string>();
  const withoutBirthPlace: string[] = [];
  for (const id of contributing) {
    const text = persons.get(id)?.birthPlace?.trim();
    if (text) placeOf.set(id, text);
    else withoutBirthPlace.push(id);
  }
  if (withoutBirthPlace.length) {
    const baptisms = await prisma.event.findMany({
      where: {
        personId: { in: withoutBirthPlace },
        type: { in: [...BAPTISM_TYPES] },
        isAlternative: false,
        place: { not: null },
      },
      orderBy: [{ date: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { personId: true, place: true },
    });
    for (const e of baptisms) {
      const text = e.place?.trim();
      if (e.personId && text && !placeOf.has(e.personId)) placeOf.set(e.personId, text);
    }
  }

  const areas = await placeAreasFor(placeOf.values(), level);
  const categoryOf = (id: string): RootsCategory => {
    const text = placeOf.get(id);
    if (!text) return { kind: "unknown" };
    const area = areas.get(placeKey(text));
    if (!area || area.kind === "unassigned") return { kind: "unassigned" };
    return { kind: "area", key: area.key, label: area.label };
  };

  return {
    personId: root.id,
    generations: n,
    level,
    slices: rootsSlices(shares.contributions, categoryOf),
    slots: shares.slots,
    filledSlots: shares.filledSlots,
    parentCount: shares.parentCount,
  };
}
