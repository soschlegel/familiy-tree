/**
 * Familien ↔ Beziehungen in App-Begriffen.
 *
 * - `deriveRelationships`: Familien des Modells → Partnerschaften und
 *   Eltern-Kind-Verbindungen (je Elternteil mit Art), wie die App sie
 *   speichert (PARTNER_OF / PARENT_OF mit Untertyp).
 * - `familiesFromRelationships`: umgekehrt für den Export — die App kennt
 *   keine Familien, GEDCOM braucht sie.
 */

import type {
  GedcomChildKind,
  GedcomDate,
  GedcomDocument,
  GedcomEvent,
  GedcomFamily,
  GedcomPartnerStatus,
  GedcomSex,
} from "./types";
import { computeFamilyStatus } from "./status";

/** Wert, mit dem der Writer „ausdrücklich unverheiratet“ schreibt (_STAT). */
export const UNMARRIED_MARKER = "Unmarried";

export interface DerivedPartnership {
  familyId: string;
  personIds: [string, string];
  status: GedcomPartnerStatus;
  statusEvidence: NonNullable<GedcomFamily["statusEvidence"]>;
  /** Datum der (ersten) Heirat bzw. Verlobung als Beginn, falls vorhanden. */
  start?: GedcomDate;
  /** Datum der Scheidung/Annullierung als Ende, falls vorhanden. */
  end?: GedcomDate;
  /** Alle Familienereignisse (Heirat, Verlobung, Scheidung, frei benannte …). */
  events: GedcomEvent[];
}

export interface DerivedParentChild {
  familyId: string;
  parentId: string;
  childId: string;
  kind: GedcomChildKind;
  /** Rohwert (PEDI/_FREL/_MREL), falls angegeben. */
  kindLabel?: string;
  explicit: boolean;
}

export interface DerivedRelationships {
  partnerships: DerivedPartnership[];
  parentChild: DerivedParentChild[];
  /** Familien mit genau einem Partner (Ein-Eltern-Familien). */
  singleParentFamilies: string[];
  /** Familien ganz ohne Partner und Kinder. */
  emptyFamilies: string[];
}

const START_TYPES = ["MARRIAGE", "ENGAGEMENT"];
const END_TYPES = ["DIVORCE", "ANNULMENT"];

export function deriveRelationships(doc: GedcomDocument): DerivedRelationships {
  const out: DerivedRelationships = { partnerships: [], parentChild: [], singleParentFamilies: [], emptyFamilies: [] };
  for (const f of doc.families) {
    if (f.partners.length === 2) {
      const startEv = START_TYPES.map((t) => f.events.find((e) => e.type === t && e.date)).find(Boolean);
      const endEv = f.events.find((e) => END_TYPES.includes(e.type) && e.date);
      const p: DerivedPartnership = {
        familyId: f.id,
        personIds: [f.partners[0], f.partners[1]],
        status: f.status ?? "UNKNOWN",
        statusEvidence: f.statusEvidence ?? "NO_MARRIAGE_EVENT",
        events: f.events,
      };
      if (startEv?.date) p.start = startEv.date;
      if (endEv?.date) p.end = endEv.date;
      out.partnerships.push(p);
    } else if (f.partners.length === 1) out.singleParentFamilies.push(f.id);
    else if (f.children.length === 0) out.emptyFamilies.push(f.id);

    for (const c of f.children) {
      f.partners.forEach((parentId, i) => {
        const link: DerivedParentChild = {
          familyId: f.id,
          parentId,
          childId: c.childId,
          kind: c.kinds[i] ?? "BIOLOGICAL",
          explicit: c.explicit,
        };
        const label = c.kindLabels[i];
        if (label !== undefined) link.kindLabel = label;
        out.parentChild.push(link);
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export: Beziehungen → Familien
// ---------------------------------------------------------------------------

export interface RelationshipsInput {
  persons: { id: string; sex: GedcomSex }[];
  partnerships: {
    /** Wird zur Familien-Kennung, wenn angegeben. */
    id?: string;
    personIds: [string, string];
    status?: GedcomPartnerStatus;
    events?: GedcomEvent[];
  }[];
  parentChild: { parentId: string; childId: string; kind?: GedcomChildKind }[];
}

const emptyFamily = (id: string): GedcomFamily => ({
  id,
  partners: [],
  partnerRoles: [],
  children: [],
  events: [],
  notes: [],
  citations: [],
  media: [],
  externalIds: [],
  privacy: { restrictions: [], livingMarked: false, placeholderName: false, markers: [] },
  extensions: [],
});

/**
 * Rollen: Mann → HUSB, Frau → WIFE. Bei gleichem oder unbekanntem
 * Geschlecht entscheidet die Reihenfolge (erster HUSB, zweiter WIFE) — so
 * schreiben es Gramps und GEDCOM 7 (HUSB/WIFE = Partner 1/2); zwei HUSB- oder
 * zwei WIFE-Zeilen lesen viele Programme nicht.
 */
export function assignRoles(a: { id: string; sex: GedcomSex }, b: { id: string; sex: GedcomSex }): { partners: string[]; roles: ("HUSB" | "WIFE")[] } {
  if (a.sex === "FEMALE" && b.sex === "MALE") return { partners: [b.id, a.id], roles: ["HUSB", "WIFE"] };
  return { partners: [a.id, b.id], roles: ["HUSB", "WIFE"] };
}

/**
 * Baut Familien aus Partnerschaften und Eltern-Kind-Verbindungen:
 * 1. Jede Partnerschaft wird eine Familie (mit Ereignissen; MARR → verheiratet).
 * 2. Ein Kind kommt in jede Familie, deren beide Partner Eltern des Kindes
 *    sind (Art je Elternteil).
 * 3. Übrige Eltern eines Kindes: zwei übrige gleicher Art bilden eine
 *    gemeinsame Familie ohne Ereignisse (übliche Praxis — beim Wiedereinlesen
 *    erscheinen sie als unverheiratete Partner); sonst je Elternteil eine
 *    Ein-Eltern-Familie (je Elternteil nur eine).
 */
export function familiesFromRelationships(input: RelationshipsInput): GedcomFamily[] {
  const sexOf = new Map(input.persons.map((p) => [p.id, p.sex]));
  const families: GedcomFamily[] = [];
  const used = new Set(input.partnerships.map((p) => p.id).filter(Boolean) as string[]);
  let n = 0;
  const nextId = () => {
    let id: string;
    do id = `F${++n}`;
    while (used.has(id));
    used.add(id);
    return id;
  };

  for (const p of input.partnerships) {
    const f = emptyFamily(p.id ?? nextId());
    const roles = assignRoles(
      { id: p.personIds[0], sex: sexOf.get(p.personIds[0]) ?? "UNKNOWN" },
      { id: p.personIds[1], sex: sexOf.get(p.personIds[1]) ?? "UNKNOWN" },
    );
    f.partners = roles.partners;
    f.partnerRoles = roles.roles;
    f.events = [...(p.events ?? [])];
    if (p.status === "MARRIED" && !f.events.some((e) => e.type === "MARRIAGE")) {
      f.events.unshift({ type: "MARRIAGE", value: "Y", notes: [], citations: [], media: [], externalIds: [], extensions: [] });
    }
    if (p.status === "DIVORCED" && !f.events.some((e) => e.type === "DIVORCE" || e.type === "ANNULMENT")) {
      f.events.push({ type: "DIVORCE", value: "Y", notes: [], citations: [], media: [], externalIds: [], extensions: [] });
    }
    // Ausdrücklich unverheiratet: Markierung, die der Writer als _STAT schreibt.
    if (p.status === "UNMARRIED") f.statusMarker = { tag: "_STAT", value: UNMARRIED_MARKER };
    families.push(f);
  }

  const parentsOf = new Map<string, { parentId: string; kind: GedcomChildKind }[]>();
  for (const l of input.parentChild) {
    let list = parentsOf.get(l.childId);
    if (!list) parentsOf.set(l.childId, (list = []));
    if (!list.some((x) => x.parentId === l.parentId)) list.push({ parentId: l.parentId, kind: l.kind ?? "BIOLOGICAL" });
  }

  const singleOf = new Map<string, GedcomFamily>();
  const addChild = (f: GedcomFamily, childId: string, kindFor: (parentId: string) => GedcomChildKind) => {
    const kinds = f.partners.map(kindFor);
    f.children.push({
      childId,
      kinds,
      kindLabels: kinds.map(() => undefined),
      explicit: kinds.some((k) => k !== "BIOLOGICAL"),
      notes: [],
      childSideExtensions: [],
      familySideExtensions: [],
    });
  };

  for (const [childId, parents] of parentsOf) {
    const remaining = new Map(parents.map((p) => [p.parentId, p.kind]));
    for (const f of families) {
      if (f.partners.length === 2 && f.partners.every((id) => parents.some((p) => p.parentId === id))) {
        const kinds = new Map(parents.map((p) => [p.parentId, p.kind]));
        addChild(f, childId, (id) => kinds.get(id)!);
        for (const id of f.partners) remaining.delete(id);
      }
    }
    const rest = [...remaining.entries()];
    if (rest.length === 2 && rest[0][1] === rest[1][1]) {
      const f = emptyFamily(nextId());
      const roles = assignRoles({ id: rest[0][0], sex: sexOf.get(rest[0][0]) ?? "UNKNOWN" }, { id: rest[1][0], sex: sexOf.get(rest[1][0]) ?? "UNKNOWN" });
      f.partners = roles.partners;
      f.partnerRoles = roles.roles;
      families.push(f);
      addChild(f, childId, (id) => remaining.get(id)!);
      continue;
    }
    for (const [parentId, kind] of rest) {
      let f = singleOf.get(parentId);
      if (!f) {
        f = emptyFamily(nextId());
        f.partners = [parentId];
        f.partnerRoles = [sexOf.get(parentId) === "FEMALE" ? "WIFE" : "HUSB"];
        singleOf.set(parentId, f);
        families.push(f);
      }
      addChild(f, childId, () => kind);
    }
  }
  for (const f of families) computeFamilyStatus(f);
  return families;
}

export type { GedcomDate };
