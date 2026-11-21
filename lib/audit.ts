import type { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import type { Scope } from "./scope";
import { resolveChangeSetId, type ChangeSetHandle } from "./change-sets";
import { formatFuzzyDate, fuzzyField, type FuzzyKey } from "./dates";

export type AuditEntityType =
  | "Person"
  | "Relationship"
  | "MediaAsset"
  | "User"
  | "Family"
  | "Source"
  | "Citation"
  | "ApiToken"
  | "Event"
  | "PersonName"
  | "ImportBatch"
  | "ImportRawRecord";

export type AuditInput = {
  userId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | "MERGE" | "CONNECT";
  entityType: AuditEntityType;
  entityId: string;
  diff?: unknown;
  /** Kanal der Änderung; ohne Angabe Web-App. */
  channel?: "MCP" | null;
  /** Schlüssel, mit dem die Änderung kam (ApiToken.id, nie das Geheimnis). */
  apiTokenId?: string | null;
  /** Changelog-Paket (lib/change-sets.ts); kommt über auditActor(scope). */
  changeSet?: ChangeSetHandle | null;
  /**
   * Betroffene Personen bzw. Familien ZUSÄTZLICH zu denen, die sich aus dem
   * Datensatz ermitteln lassen. Nötig, wenn der Datensatz schon gelöscht ist
   * (Person löschen: deren Familien) oder mehrere Personen betroffen sind.
   */
  personIds?: string[];
  familyIds?: string[];
};

/**
 * Wer hat geändert, über welchen Kanal, in welchem Paket? Für alle Dienste,
 * die einen Scope haben: `audit({ ...auditActor(scope), action, … })`. So ist
 * jede Änderung über den KI-Zugang samt Schlüssel nachvollziehbar, ohne dass
 * die Dienste den Kanal selbst kennen müssen.
 */
export function auditActor(
  scope: Pick<Scope, "userId" | "via" | "changeSet">,
): Pick<AuditInput, "userId" | "channel" | "apiTokenId" | "changeSet"> {
  return {
    userId: scope.userId,
    channel: scope.via?.channel ?? null,
    apiTokenId: scope.via?.tokenId ?? null,
    changeSet: scope.changeSet ?? null,
  };
}

// ---------------------------------------------------------------------------
// Vorher → nachher
// ---------------------------------------------------------------------------

export type FieldChange = { from: unknown; to: unknown };

const DATE_KEYS: readonly FuzzyKey[] = ["birthDate", "deathDate", "startDate", "endDate", "date"];
const dateColumns = (k: string) => [k, `${k}Precision`, `${k}Qualifier`, `${k}To`, `${k}ToPrecision`];

function plain(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Geänderte Felder einer Teil-Änderung: `{ feld: { from, to } }`, nur Felder,
 * deren Wert sich wirklich ändert. Die Spalten eines ungenauen Datums
 * (Anker, Genauigkeit, Zusatz, Bereichsende) werden zu EINEM Feld in
 * Anzeigeform zusammengefasst („um 1850“ → „12.03.1850“).
 */
export function fieldChanges(before: object, patch: Record<string, unknown>): Record<string, FieldChange> {
  const b = before as Record<string, unknown>;
  const out: Record<string, FieldChange> = {};
  const handled = new Set<string>();
  for (const key of DATE_KEYS) {
    const cols = dateColumns(key);
    if (!cols.some((c) => patch[c] !== undefined)) continue;
    for (const c of cols) handled.add(c);
    const after = { ...b };
    for (const c of cols) if (patch[c] !== undefined) after[c] = patch[c];
    const from = formatFuzzyDate(fuzzyField(b, key)) || null;
    const to = formatFuzzyDate(fuzzyField(after, key)) || null;
    if (from !== to) out[key] = { from, to };
  }
  for (const [key, value] of Object.entries(patch)) {
    if (handled.has(key) || value === undefined) continue;
    const from = plain(b[key]);
    const to = plain(value);
    if (!same(from, to)) out[key] = { from, to };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Betroffene Personen und Familien
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Personen einer Beziehung (falls es sie noch gibt). */
async function relationshipPersons(db: Db, id: string | null): Promise<string[]> {
  if (!id) return [];
  const r = await db.relationship.findUnique({ where: { id }, select: { fromPersonId: true, toPersonId: true } });
  return r ? [r.fromPersonId, r.toPersonId] : [];
}

/** Personen, an denen ein Ereignis hängt (direkt oder über die Beziehung). */
async function eventPersons(db: Db, id: string | null): Promise<string[]> {
  if (!id) return [];
  const e = await db.event.findUnique({ where: { id }, select: { personId: true, relationshipId: true } });
  if (!e) return [];
  return e.personId ? [e.personId] : relationshipPersons(db, e.relationshipId);
}

/** Wie sich Person, Beziehung, Ereignis aus Feldern eines Eintrags ergeben. */
async function personsFromFields(db: Db, d: Record<string, unknown>): Promise<string[]> {
  const out: string[] = [];
  for (const k of ["personId", "fromPersonId", "toPersonId"]) {
    const v = str(d[k]);
    if (v) out.push(v);
  }
  out.push(...(await relationshipPersons(db, str(d.relationshipId))));
  if (!out.length) out.push(...(await eventPersons(db, str(d.eventId))));
  return out;
}

/** Höchstzahl der Personen, die ein Eintrag über eine Quelle mitführt. */
const SOURCE_PERSON_LIMIT = 1000;

async function derivedPersons(db: Db, input: AuditInput): Promise<string[]> {
  const d = input.diff && typeof input.diff === "object" ? (input.diff as Record<string, unknown>) : {};
  const id = input.entityId;
  switch (input.entityType) {
    case "Person":
      // CONNECT: entityId ist der Lauf, nicht eine Person.
      return input.action === "CONNECT" ? [] : [id];
    case "Relationship": {
      const now = await relationshipPersons(db, id);
      return now.length ? now : personsFromFields(db, d);
    }
    case "Event": {
      const now = await eventPersons(db, id);
      return now.length ? now : personsFromFields(db, d);
    }
    case "PersonName": {
      const n = await db.personName.findUnique({ where: { id }, select: { personId: true } });
      return n ? [n.personId] : personsFromFields(db, d);
    }
    case "Citation": {
      const c = await db.citation.findUnique({ where: { id }, select: { personId: true, relationshipId: true, eventId: true } });
      return personsFromFields(db, (c as Record<string, unknown> | null) ?? d);
    }
    case "MediaAsset": {
      const [persons, rels] = await Promise.all([
        db.personMedia.findMany({ where: { mediaId: id }, select: { personId: true } }),
        db.relationshipMedia.findMany({
          where: { mediaId: id },
          select: { relationship: { select: { fromPersonId: true, toPersonId: true } } },
        }),
      ]);
      // Bilder an Ereignissen und Belegen: deren Träger (Person bzw. beide
      // Seiten der Beziehung). Bilder an Quellen führen die belegten Personen
      // die Dienste ausdrücklich mit (lib/services/media-links.ts).
      const carrier = { personId: true, relationship: { select: { fromPersonId: true, toPersonId: true } } } as const;
      const [events, cites] = await Promise.all([
        db.eventMedia.findMany({ where: { mediaId: id }, select: { event: { select: carrier } } }),
        db.citationMedia.findMany({ where: { mediaId: id }, select: { citation: { select: carrier } } }),
      ]);
      const ofCarrier = (c: { personId: string | null; relationship: { fromPersonId: string; toPersonId: string } | null }) => [
        ...(c.personId ? [c.personId] : []),
        ...(c.relationship ? [c.relationship.fromPersonId, c.relationship.toPersonId] : []),
      ];
      const out = [
        ...persons.map((p) => p.personId),
        ...rels.flatMap((r) => [r.relationship.fromPersonId, r.relationship.toPersonId]),
        ...events.flatMap((e) => ofCarrier(e.event)),
        ...cites.flatMap((c) => ofCarrier(c.citation)),
      ];
      return out.length ? out : personsFromFields(db, d);
    }
    case "Source": {
      // Eine Quelle gehört keiner Person; betroffen sind die belegten Personen.
      if (input.action === "CREATE") return [];
      const cites = await db.citation.findMany({
        where: { sourceId: id },
        select: {
          personId: true,
          relationship: { select: { fromPersonId: true, toPersonId: true } },
          event: { select: { personId: true, relationship: { select: { fromPersonId: true, toPersonId: true } } } },
        },
        take: SOURCE_PERSON_LIMIT,
      });
      return cites.flatMap((c) => [
        ...(c.personId ? [c.personId] : []),
        ...(c.relationship ? [c.relationship.fromPersonId, c.relationship.toPersonId] : []),
        ...(c.event?.personId ? [c.event.personId] : []),
        ...(c.event?.relationship ? [c.event.relationship.fromPersonId, c.event.relationship.toPersonId] : []),
      ]);
    }
    default:
      return [];
  }
}

function derivedFamilies(input: AuditInput): string[] {
  const d = input.diff && typeof input.diff === "object" ? (input.diff as Record<string, unknown>) : {};
  if (input.entityType === "Family") return [input.entityId];
  if (input.entityType === "User" && str(d.familyId)) return [d.familyId as string];
  return [];
}

/**
 * Momentaufnahme: betroffene Personen (aus dem Datensatz bzw. den Feldern des
 * Eintrags, plus ausdrücklich angegebene) und deren Familien zum Zeitpunkt
 * der Änderung.
 */
export async function auditRefs(input: AuditInput, db: Db = prisma): Promise<{ personIds: string[]; familyIds: string[] }> {
  const personIds = [...new Set([...(input.personIds ?? []), ...(await derivedPersons(db, input))])];
  const families = personIds.length
    ? await db.personFamily.findMany({ where: { personId: { in: personIds } }, select: { familyId: true } })
    : [];
  const familyIds = [
    ...new Set([...(input.familyIds ?? []), ...derivedFamilies(input), ...families.map((f) => f.familyId)]),
  ];
  return { personIds, familyIds };
}

const ACTION_TITLE: Record<AuditInput["action"], string> = {
  CREATE: "angelegt",
  UPDATE: "geändert",
  DELETE: "gelöscht",
  MERGE: "zusammengeführt",
  CONNECT: "verbunden",
};

const ENTITY_TITLE: Record<AuditEntityType, string> = {
  Person: "Person",
  Relationship: "Beziehung",
  MediaAsset: "Bild",
  User: "Benutzer",
  Family: "Familie",
  Source: "Quelle",
  Citation: "Beleg",
  ApiToken: "KI-Schlüssel",
  Event: "Ereignis",
  PersonName: "Name",
  ImportBatch: "Import",
  ImportRawRecord: "Rohdaten",
};

/** Titel eines Pakets aus seinem ersten Eintrag („Person geändert“). */
export function defaultChangeSetTitle(input: Pick<AuditInput, "action" | "entityType">): string {
  if (input.action === "MERGE") return "Personen zusammengeführt";
  return `${ENTITY_TITLE[input.entityType] ?? input.entityType} ${ACTION_TITLE[input.action] ?? input.action}`;
}

/**
 * Fertige Zeile für prisma.auditLog.create — für Dienste, die den Eintrag
 * selbst in ihrer Transaktion schreiben (`db` sieht deren Stand).
 */
export async function auditData(
  input: AuditInput & { id?: string },
  db: Db = prisma,
): Promise<Prisma.AuditLogUncheckedCreateInput> {
  const refs = await auditRefs(input, db);
  const changeSetId = input.changeSet
    ? await resolveChangeSetId(
        input.changeSet,
        { userId: input.userId, channel: input.channel, apiTokenId: input.apiTokenId },
        defaultChangeSetTitle(input),
      )
    : null;
  return {
    ...(input.id ? { id: input.id } : {}),
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    diff: (input.diff ?? undefined) as never,
    channel: input.channel ?? null,
    apiTokenId: input.apiTokenId ?? null,
    changeSetId,
    personIds: refs.personIds,
    familyIds: refs.familyIds,
  };
}

/**
 * Schreibt einen Audit-Eintrag. Bewusst fehlertolerant: ein kaputtes Audit
 * darf die eigentliche Mutation nicht zurückrollen.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data: await auditData(input) });
  } catch (err) {
    console.error("[audit] Eintrag fehlgeschlagen:", err);
  }
}
