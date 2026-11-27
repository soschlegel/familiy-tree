import {
  assignRingSlots,
  childSlot,
  parseRingsGeneration,
  ringRelationTerm,
  slotSide,
  type RingParent,
} from "../ancestor-rings";
import { groupAreaSlices } from "../chart-slices";
import type { Sex } from "../kinship";
import { placeKey } from "../places/normalize";
import { prisma } from "../prisma";
import { canViewPerson, personVisibilityFilter, type Scope } from "../scope";
import { formatDateOf, lifeSpan } from "../tree-layout";
import { iso } from "./dto";
import { placeAreasFor } from "./place-areas";

/**
 * Ansicht „Ringe“ der Stammbaum-Seite (components/AncestorRings.tsx):
 * Vorfahren einer Person auf festen Plätzen eines Vollkreises. Platzvergabe
 * und Geometrie in lib/ancestor-rings.ts.
 *
 * Laden: Generation für Generation eine Abfrage der leiblichen
 * Eltern-Kind-Beziehungen samt Eltern (höchstens N Abfragen), dann eine für
 * die Taufen ohne Geburtsort und eine für die Ortszuordnungen — nie eine
 * Abfrage je Vorfahr und nie der ganze Graph.
 *
 * Datenschutz wie im Abschnitt „Wurzeln“ (lib/services/roots.ts): Die
 * Ausgangsperson muss sichtbar sein (sonst null). Ein nicht sichtbarer
 * Vorfahr wird nur als Platz „nicht freigegeben“ ohne Kennung, Namen,
 * Daten und Ort weitergegeben; seine Eltern werden nicht gesucht. Sein
 * Geschlecht fließt nicht in die Platzvergabe ein.
 */

/** Ereignisse, deren Ort ersatzweise für den Geburtsort zählt (wie „Wurzeln“). */
const BAPTISM_TYPES = ["BAPTISM", "CHRISTENING"] as const;

export type RingPersonDto = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: Sex;
  /** Lebensjahre kurz („1850 – 1912“), leer ohne Daten. */
  lifeSpan: string;
  /** Geburt und Tod ausführlich („12.03.1850“, „um 1850“), leer ohne Angabe. */
  born: string;
  died: string;
};

export type RingSlotDto =
  | {
      generation: number;
      index: number;
      kind: "person";
      personId: string;
      /** Verwandtschaftsstufe aus Sicht der Ausgangsperson („Urgroßmutter väterlicherseits“). */
      term: string;
      /** Färbung „nach Wurzeln“: Schlüssel des Legendeneintrags. */
      area: string;
    }
  | { generation: number; index: number; kind: "restricted"; term: string };

export type RingAreaDto = { key: string; label: string; color: string; count: number; members?: string[] };

export type AncestorRingsDto = {
  root: RingPersonDto;
  generations: number;
  /** Sichtbare Personen der Plätze (und die Ausgangsperson) nach Kennung. */
  persons: Record<string, RingPersonDto>;
  /** Belegte Plätze, innen nach außen; leere Plätze fehlen. */
  slots: RingSlotDto[];
  /** Belegte Plätze (sichtbar und nicht freigegeben) bzw. davon nicht freigegebene. */
  known: number;
  restricted: number;
  /** Legende der Färbung „nach Wurzeln“ (Land des Geburtsorts), Zahl = Plätze. */
  areas: RingAreaDto[];
};

const PERSON_SELECT = {
  id: true,
  givenName: true,
  familyName: true,
  gender: true,
  birthDate: true,
  birthDatePrecision: true,
  birthDateQualifier: true,
  birthDateTo: true,
  birthDateToPrecision: true,
  birthDatePhrase: true,
  deathDate: true,
  deathDatePrecision: true,
  deathDateQualifier: true,
  deathDateTo: true,
  deathDateToPrecision: true,
  deathDatePhrase: true,
  birthPlace: true,
  families: { select: { familyId: true } },
} as const;

type Row = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: string;
  birthDate: Date | null;
  birthDatePrecision: string;
  birthDateQualifier: string;
  birthDateTo: Date | null;
  birthDateToPrecision: string;
  birthDatePhrase: string | null;
  deathDate: Date | null;
  deathDatePrecision: string;
  deathDateQualifier: string;
  deathDateTo: Date | null;
  deathDateToPrecision: string;
  deathDatePhrase: string | null;
  birthPlace: string | null;
};

function toDto(p: Row): RingPersonDto {
  return {
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    gender: p.gender as Sex,
    lifeSpan: lifeSpan({
      birthDate: iso(p.birthDate),
      birthDatePrecision: p.birthDatePrecision,
      birthDateQualifier: p.birthDateQualifier,
      birthDateTo: iso(p.birthDateTo),
      birthDateToPrecision: p.birthDateToPrecision,
      birthDatePhrase: p.birthDatePhrase,
      deathDate: iso(p.deathDate),
      deathDatePrecision: p.deathDatePrecision,
      deathDateQualifier: p.deathDateQualifier,
      deathDateTo: iso(p.deathDateTo),
      deathDateToPrecision: p.deathDateToPrecision,
      deathDatePhrase: p.deathDatePhrase,
    }),
    born: formatDateOf(p, "birthDate"),
    died: formatDateOf(p, "deathDate"),
  };
}

export async function loadAncestorRings(
  scope: Scope,
  rootId: string,
  generations: unknown = undefined,
): Promise<AncestorRingsDto | null> {
  const n = parseRingsGeneration(generations);
  const root = await prisma.person.findUnique({ where: { id: rootId }, select: PERSON_SELECT });
  if (!root || !canViewPerson(scope, root.families.map((f) => f.familyId))) return null;

  // Generation für Generation: Eltern nur von sichtbaren, noch nicht
  // gefragten Personen. Ahnenschwund und Zyklen fragen nichts doppelt.
  const rows = new Map<string, Row>([[root.id, root]]);
  const restricted = new Set<string>();
  const parents = new Map<string, RingParent[]>();
  let frontier = [root.id];
  for (let g = 1; g <= n && frontier.length; g++) {
    const rels = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", subtype: "BIOLOGICAL", toPersonId: { in: frontier } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { toPersonId: true, fromPerson: { select: PERSON_SELECT } },
    });
    for (const id of frontier) parents.set(id, []);
    const next: string[] = [];
    for (const r of rels) {
      const p = r.fromPerson;
      const known = rows.has(p.id) || restricted.has(p.id);
      const visible = known ? rows.has(p.id) : canViewPerson(scope, p.families.map((f) => f.familyId));
      // Geschlecht einer nicht sichtbaren Person verrät auch die Platzwahl nicht.
      parents.get(r.toPersonId)!.push({ id: p.id, gender: visible ? (p.gender as Sex) : "UNKNOWN" });
      if (known) continue;
      if (visible) {
        rows.set(p.id, p);
        next.push(p.id);
      } else {
        restricted.add(p.id);
      }
    }
    frontier = next;
  }

  const slots = assignRingSlots({
    rootId: root.id,
    generations: n,
    parentsOf: (id) => parents.get(id) ?? [],
    visible: (id) => rows.has(id),
  });

  // Seite nur, wenn der Elternplatz nachweislich Vater bzw. Mutter ist.
  const personAt = new Map<string, string>();
  for (const s of slots) if (s.kind === "person") personAt.set(`${s.generation}:${s.index}`, s.personId);
  const sideOf = (generation: number, index: number) => {
    if (generation < 2) return null;
    let slot = { generation, index };
    while (slot.generation > 1) slot = childSlot(slot.generation, slot.index);
    const parentId = personAt.get(`1:${slot.index}`);
    const sex = parentId ? rows.get(parentId)?.gender : undefined;
    const side = slotSide(generation, index);
    return (side === "paternal" && sex === "MALE") || (side === "maternal" && sex === "FEMALE") ? side : null;
  };

  // Ort je sichtbarem Vorfahren: Geburtsort, sonst Taufort (wie „Wurzeln“).
  const shown = [...new Set(slots.flatMap((s) => (s.kind === "person" ? [s.personId] : [])))];
  const placeOf = new Map<string, string>();
  const withoutBirthPlace: string[] = [];
  for (const id of shown) {
    const text = rows.get(id)?.birthPlace?.trim();
    if (text) placeOf.set(id, text);
    else withoutBirthPlace.push(id);
  }
  if (withoutBirthPlace.length) {
    const baptisms = await prisma.event.findMany({
      where: { personId: { in: withoutBirthPlace }, type: { in: [...BAPTISM_TYPES] }, isAlternative: false, place: { not: null } },
      orderBy: [{ date: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { personId: true, place: true },
    });
    for (const e of baptisms) {
      const text = e.place?.trim();
      if (e.personId && text && !placeOf.has(e.personId)) placeOf.set(e.personId, text);
    }
  }
  const areaMap = await placeAreasFor(placeOf.values(), "country");
  type Category = { kind: "area"; key: string; label: string } | { kind: "unassigned" } | { kind: "unknown" };
  const categoryOf = (id: string): Category => {
    const text = placeOf.get(id);
    if (!text) return { kind: "unknown" };
    const area = areaMap.get(placeKey(text));
    if (!area || area.kind === "unassigned") return { kind: "unassigned" };
    return { kind: "area", key: area.key, label: area.label };
  };

  // Legende: Plätze je Land (Ahnenschwund zählt mehrfach), dieselben Regeln
  // und Farben wie „Wurzeln“ und „Statistik“ (lib/chart-slices.ts).
  const areaCounts = new Map<string, { label: string; value: number }>();
  const gray = { unassigned: 0, unknown: 0, restricted: 0 };
  for (const s of slots) {
    if (s.kind === "restricted") {
      gray.restricted += 1;
      continue;
    }
    const c = categoryOf(s.personId);
    if (c.kind !== "area") gray[c.kind] += 1;
    else {
      const a = areaCounts.get(c.key);
      if (a) a.value += 1;
      else areaCounts.set(c.key, { label: c.label, value: 1 });
    }
  }
  const legend = groupAreaSlices(areaCounts, gray);
  const sliceOf = (id: string): string => {
    const c = categoryOf(id);
    if (c.kind !== "area") return c.kind;
    return legend.some((l) => l.key === `area:${c.key}`) ? `area:${c.key}` : "other";
  };

  const persons: Record<string, RingPersonDto> = { [root.id]: toDto(root) };
  for (const id of shown) persons[id] = toDto(rows.get(id)!);

  return {
    root: persons[root.id],
    generations: n,
    persons,
    slots: slots.map((s) =>
      s.kind === "person"
        ? {
            generation: s.generation,
            index: s.index,
            kind: "person" as const,
            personId: s.personId,
            term: ringRelationTerm(s.generation, persons[s.personId].gender, sideOf(s.generation, s.index)),
            area: sliceOf(s.personId),
          }
        : {
            generation: s.generation,
            index: s.index,
            kind: "restricted" as const,
            term: ringRelationTerm(s.generation, "UNKNOWN", sideOf(s.generation, s.index)),
          },
    ),
    known: slots.length,
    restricted: slots.filter((s) => s.kind === "restricted").length,
    areas: legend.map((l) => ({
      key: l.key,
      label: l.label,
      color: l.color,
      count: l.value,
      ...(l.members ? { members: l.members } : {}),
    })),
  };
}

/**
 * Ausgangsperson, wenn keine angefragt ist und keine gemerkte bzw.
 * Bezugsperson passt: eine sichtbare Person mit leiblichen Eltern, die
 * jüngste zuerst (eine Abfrage). null, wenn niemand sichtbar ist.
 */
export async function defaultRingsRootId(scope: Scope): Promise<string | null> {
  const withParents = await prisma.person.findFirst({
    where: { ...personVisibilityFilter(scope), relationsTo: { some: { type: "PARENT_OF", subtype: "BIOLOGICAL" } } },
    orderBy: [{ birthDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    select: { id: true },
  });
  if (withParents) return withParents.id;
  const any = await prisma.person.findFirst({ where: personVisibilityFilter(scope), orderBy: { id: "asc" }, select: { id: true } });
  return any?.id ?? null;
}
