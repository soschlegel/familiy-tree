import type { Person, Relationship } from "@prisma/client";

import type { DatePrecision, DateQualifier } from "../dates";
import { maskPerson, visibleFamilyIds, type MaskedPerson, type Scope } from "../scope";

/**
 * Serialisierbare Darstellungen, die die Dienste zurückgeben. Datumswerte
 * stehen als ISO-String darin, damit das Ergebnis ohne Umweg als JSON
 * verschickt werden kann (Route-Handler, Server-Components, MCP).
 *
 * Ungenaue Daten: der ISO-String ist der Ankerpunkt (siehe lib/dates.ts),
 * daneben stehen Genauigkeit (`…Precision`) und Zusatz (`…Qualifier`).
 * Anzeigen bitte immer über formatFuzzyDate/lifeSpan, nie direkt über den
 * ISO-String — „1850“ ist sonst „01.01.1850“.
 */

export type Gender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

/** Genauigkeit und Zusatz der Lebensdaten. */
export type LifeDatePrecision = {
  birthDatePrecision: DatePrecision;
  birthDateQualifier: DateQualifier;
  deathDatePrecision: DatePrecision;
  deathDateQualifier: DateQualifier;
};

/**
 * Bereichsende und Wortlaut der Lebensdaten (siehe lib/dates.ts). Ende nur
 * bei Bereichen (BETWEEN/PERIOD), sonst null.
 */
export type LifeDateExtras = {
  birthDateTo: string | null;
  birthDateToPrecision: DatePrecision;
  birthDatePhrase: string | null;
  deathDateTo: string | null;
  deathDateToPrecision: DatePrecision;
  deathDatePhrase: string | null;
};

/** Vollständige Angaben einer sichtbaren Person. */
export type PersonSummary = LifeDatePrecision &
  LifeDateExtras & {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  nickname: string | null;
  namePrefix: string | null;
  nameSuffix: string | null;
  gender: Gender;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
  deathCause: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  primaryMediaId: string | null;
  /** Nur Familien, die der Benutzer selbst kennt. */
  familyIds: string[];
  restricted: false;
};

/** Kurzform für Listen in Recherche-Ergebnissen. */
export type PersonBrief = LifeDatePrecision & {
  id: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: Gender;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  /** Nur bei Datumsbereichen gesetzt (Ende, siehe lib/dates.ts). */
  birthDateTo?: string;
  birthDateToPrecision?: DatePrecision;
  deathDateTo?: string;
  deathDateToPrecision?: DatePrecision;
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
  startDatePrecision: DatePrecision;
  startDateQualifier: DateQualifier;
  endDate: string | null;
  endDatePrecision: DatePrecision;
  endDateQualifier: DateQualifier;
  startDateTo: string | null;
  startDateToPrecision: DatePrecision;
  startDatePhrase: string | null;
  startPlace: string | null;
  endDateTo: string | null;
  endDateToPrecision: DatePrecision;
  endDatePhrase: string | null;
  endPlace: string | null;
  notes: string | null;
  createdAt: string;
};

export const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

/** Genauigkeit/Zusatz aus einem (Teil-)Datensatz; fehlend = tagesgenau. */
export function lifeDatePrecision(p: Partial<LifeDatePrecision>): LifeDatePrecision {
  return {
    birthDatePrecision: p.birthDatePrecision ?? "DAY",
    birthDateQualifier: p.birthDateQualifier ?? "EXACT",
    deathDatePrecision: p.deathDatePrecision ?? "DAY",
    deathDateQualifier: p.deathDateQualifier ?? "EXACT",
  };
}

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
    nickname: p.nickname,
    namePrefix: p.namePrefix,
    nameSuffix: p.nameSuffix,
    gender: p.gender,
    birthDate: iso(p.birthDate),
    birthPlace: p.birthPlace,
    deathDate: iso(p.deathDate),
    deathPlace: p.deathPlace,
    deathCause: p.deathCause,
    ...lifeDatePrecision(p),
    birthDateTo: iso(p.birthDateTo),
    birthDateToPrecision: p.birthDateToPrecision,
    birthDatePhrase: p.birthDatePhrase,
    deathDateTo: iso(p.deathDateTo),
    deathDateToPrecision: p.deathDateToPrecision,
    deathDatePhrase: p.deathDatePhrase,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    primaryMediaId: extra.primaryMediaId,
    familyIds: visibleFamilyIds(scope, extra.familyIds),
    restricted: false,
  };
}

export function toPersonBrief(
  p: {
    id: string;
    givenName: string;
    familyName: string | null;
    birthName: string | null;
    gender: Gender;
    birthDate: Date | string | null;
    birthPlace: string | null;
    deathDate: Date | string | null;
    birthDateTo?: Date | string | null;
    birthDateToPrecision?: DatePrecision;
    deathDateTo?: Date | string | null;
    deathDateToPrecision?: DatePrecision;
  } & Partial<LifeDatePrecision>,
): PersonBrief {
  const s = (d: Date | string | null) =>
    d === null ? null : typeof d === "string" ? d : d.toISOString();
  const birthTo = p.birthDateTo ? s(p.birthDateTo)! : null;
  const deathTo = p.deathDateTo ? s(p.deathDateTo)! : null;
  return {
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    birthName: p.birthName,
    gender: p.gender,
    birthDate: s(p.birthDate),
    birthPlace: p.birthPlace,
    deathDate: s(p.deathDate),
    ...lifeDatePrecision(p),
    ...(birthTo ? { birthDateTo: birthTo, birthDateToPrecision: p.birthDateToPrecision ?? "DAY" } : {}),
    ...(deathTo ? { deathDateTo: deathTo, deathDateToPrecision: p.deathDateToPrecision ?? "DAY" } : {}),
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
    startDatePrecision: r.startDatePrecision,
    startDateQualifier: r.startDateQualifier,
    endDate: iso(r.endDate),
    endDatePrecision: r.endDatePrecision,
    endDateQualifier: r.endDateQualifier,
    startDateTo: iso(r.startDateTo),
    startDateToPrecision: r.startDateToPrecision,
    startDatePhrase: r.startDatePhrase,
    startPlace: r.startPlace,
    endDateTo: iso(r.endDateTo),
    endDateToPrecision: r.endDateToPrecision,
    endDatePhrase: r.endDatePhrase,
    endPlace: r.endPlace,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

export const fullName = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");
