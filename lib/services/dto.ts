import type { Person, Relationship } from "@prisma/client";

import { maskPerson, visibleFamilyIds, type MaskedPerson, type Scope } from "../scope";

/**
 * Serialisierbare Darstellungen, die die Dienste zurückgeben. Datumswerte
 * stehen als ISO-String darin, damit das Ergebnis ohne Umweg als JSON
 * verschickt werden kann (Route-Handler, Server-Components, MCP).
 */

export type Gender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

/** Vollständige Angaben einer sichtbaren Person. */
export type PersonSummary = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  primaryMediaId: string | null;
  /** Nur Familien, die der Benutzer selbst kennt. */
  familyIds: string[];
  restricted: false;
};

/** Kurzform für Listen in Recherche-Ergebnissen. */
export type PersonBrief = {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  restricted: false;
};

/** Sichtbare Person oder anonymer Platzhalter. */
export type PersonRef = PersonBrief | MaskedPerson;

export type RelationshipDto = {
  id: string;
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  fromPersonId: string;
  toPersonId: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
};

export const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

export function toPersonSummary(
  scope: Scope,
  p: Person,
  extra: { familyIds: string[]; primaryMediaId: string | null },
): PersonSummary {
  return {
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    birthName: p.birthName,
    gender: p.gender,
    birthDate: iso(p.birthDate),
    birthPlace: p.birthPlace,
    deathDate: iso(p.deathDate),
    deathPlace: p.deathPlace,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    primaryMediaId: extra.primaryMediaId,
    familyIds: visibleFamilyIds(scope, extra.familyIds),
    restricted: false,
  };
}

export function toPersonBrief(p: {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birthDate: Date | string | null;
  birthPlace: string | null;
  deathDate: Date | string | null;
}): PersonBrief {
  const s = (d: Date | string | null) =>
    d === null ? null : typeof d === "string" ? d : d.toISOString();
  return {
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    birthName: p.birthName,
    gender: p.gender,
    birthDate: s(p.birthDate),
    birthPlace: p.birthPlace,
    deathDate: s(p.deathDate),
    restricted: false,
  };
}

/** Sichtbare Person als Kurzform, unsichtbare als Platzhalter. */
export function toPersonRef(
  visible: boolean,
  p: Parameters<typeof toPersonBrief>[0],
): PersonRef {
  return visible ? toPersonBrief(p) : maskPerson(p.id);
}

export function toRelationshipDto(r: Relationship): RelationshipDto {
  return {
    id: r.id,
    type: r.type,
    subtype: r.subtype,
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
    startDate: iso(r.startDate),
    endDate: iso(r.endDate),
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

export const fullName = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");
