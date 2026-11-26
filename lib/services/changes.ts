import { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, type Scope } from "../scope";
import { formatFuzzyDate, fuzzyField, type FuzzyKey } from "../dates";
import { EVENT_TYPE_LABEL, PERSON_NAME_TYPE_LABEL } from "../events";
import { CITATION_FACT_LABEL, CONFIDENCE_LABEL, SOURCE_KIND_LABEL } from "../source-labels";
import { PARTNER_SUBTYPE_LABEL } from "../partner-labels";
import { forbiddenError, notFoundError, validationError } from "./errors";
import { plural } from "../plural";
import { VERDICT_LABEL, type DuplicateVerdict } from "../duplicate-verdicts";

/**
 * Changelog lesen: Verlauf einer Person (für ihre Bearbeiter) und Übersicht
 * der Pakete (nur Administratoren). Grundlage ist das AuditLog mit Paket und
 * Momentaufnahme der betroffenen Personen und Familien (lib/audit.ts,
 * lib/change-sets.ts). Ältere Einträge (vor dem Changelog) haben weder Paket
 * noch Momentaufnahme; der Personenverlauf findet sie über die Kennungen der
 * Person und ihrer heutigen Ereignisse, Namen, Belege und Beziehungen, die
 * Übersicht zeigt sie als Einzeländerung (ohne Familienfilter).
 *
 * Datenschutz: Werte, die auf Personen oder Familien verweisen, die der
 * Betrachter nicht sehen darf, erscheinen als „nicht freigegeben“.
 */

export const RESTRICTED = "nicht freigegeben";

export type ChangeFieldDto = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
  /** Älterer Eintrag ohne Vorher-Wert: nur der neue Wert ist bekannt. */
  onlyNew?: boolean;
};

export type ChangeEntryDto = {
  id: string;
  at: string;
  action: string;
  /** Kurzbeschreibung: „Ereignis „Taufe“ geändert“. */
  what: string;
  user: string | null;
  channel: "APP" | "MCP";
  /** Name des KI-Schlüssels (nur bei MCP); bei gelöschten aus dem Protokoll, sonst null. */
  tokenName: string | null;
  /** Der Schlüssel ist inzwischen gelöscht (nur bei MCP). */
  tokenDeleted: boolean;
  changeSet: { id: string; title: string } | null;
  fields: ChangeFieldDto[];
  /** Ergänzung, z.B. beim Import mit angelegten Ereignissen und Belegen. */
  note: string | null;
};

export type ChangePage<T> = { items: T[]; nextCursor: string | null };

const PAGE_DEFAULT = 20;
const PAGE_MAX = 100;

// ---------------------------------------------------------------------------
// Beschriftungen
// ---------------------------------------------------------------------------

const ENTITY: Record<string, [string, string]> = {
  Person: ["Person", "Personen"],
  Relationship: ["Beziehung", "Beziehungen"],
  Event: ["Ereignis", "Ereignisse"],
  PersonName: ["Name", "Namen"],
  Citation: ["Beleg", "Belege"],
  Source: ["Quelle", "Quellen"],
  MediaAsset: ["Bild", "Bilder"],
  Family: ["Familie", "Familien"],
  User: ["Benutzer", "Benutzer"],
  ApiToken: ["KI-Schlüssel", "KI-Schlüssel"],
  ImportBatch: ["Import", "Importe"],
  ImportRawRecord: ["Rohdaten", "Rohdaten"],
  Place: ["Ortszuordnung", "Ortszuordnungen"],
};

const SECTION_NOUN: Record<string, [string, string]> = {
  persons: ENTITY.Person,
  relationships: ENTITY.Relationship,
  events: ENTITY.Event,
  names: ENTITY.PersonName,
  citations: ENTITY.Citation,
  sources: ENTITY.Source,
};

const ACTION: Record<string, string> = {
  CREATE: "angelegt",
  UPDATE: "geändert",
  DELETE: "gelöscht",
  MERGE: "zusammengeführt",
  CONNECT: "verbunden",
};

const count = (n: number, [one, many]: [string, string]) => plural(n, one, many);

const GENDER: Record<string, string> = { MALE: "männlich", FEMALE: "weiblich", OTHER: "divers", UNKNOWN: "unbekannt" };
const REL_TYPE: Record<string, string> = { PARENT_OF: "Eltern-Kind", PARTNER_OF: "Partnerschaft" };
const REL_SUBTYPE: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "adoptiert",
  STEP: "Stief",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
  PARTNER_UNKNOWN: PARTNER_SUBTYPE_LABEL.PARTNER_UNKNOWN ?? "Ehestand unbekannt",
};
const ROLE: Record<string, string> = {
  ADMIN: "Administrator",
  EDITOR: "Bearbeiter",
  VIEWER: "Betrachter",
};
const STATUS: Record<string, string> = {
  INVITED: "eingeladen",
  ACTIVE: "aktiv",
  BLOCKED: "gesperrt",
  PENDING: "offen",
  COMPLETED: "abgeschlossen",
  FAILED: "fehlgeschlagen",
};
const AI: Record<string, string> = { NONE: "kein Zugang", READ: "lesen", WRITE: "lesen und schreiben" };
const PLACE_PRECISION: Record<string, string> = { PLACE: "Ort", REGION: "Region", COUNTRY: "Land" };

/** Feldbeschriftungen je Art; nur diese Felder werden angezeigt (keine Kennungen). */
const COMMON_FIELDS: Record<string, string> = {
  notes: "Notizen",
};
const FIELDS: Record<string, Record<string, string>> = {
  Person: {
    givenName: "Vorname",
    familyName: "Nachname",
    birthName: "Geburtsname",
    nickname: "Rufname",
    namePrefix: "Titel",
    nameSuffix: "Namenszusatz",
    gender: "Geschlecht",
    birthDate: "Geburt",
    birthDatePhrase: "Geburt (Wortlaut)",
    birthPlace: "Geburtsort",
    deathDate: "Tod",
    deathDatePhrase: "Tod (Wortlaut)",
    deathPlace: "Sterbeort",
    deathCause: "Todesursache",
    families: "Familien",
    familyIds: "Familien",
  },
  Relationship: {
    type: "Art",
    subtype: "Form",
    fromPersonId: "Person",
    toPersonId: "Person",
    startDate: "Beginn",
    startDatePhrase: "Beginn (Wortlaut)",
    startPlace: "Ort (Beginn)",
    endDate: "Ende",
    endDatePhrase: "Ende (Wortlaut)",
    endPlace: "Ort (Ende)",
  },
  Event: {
    type: "Art",
    label: "Bezeichnung",
    isAlternative: "Abweichende Angabe",
    date: "Datum",
    datePhrase: "Datum (Wortlaut)",
    place: "Ort",
    address: "Anschrift",
    value: "Wert",
    cause: "Ursache",
    age: "Alter",
    agency: "Zuständige Stelle",
  },
  PersonName: {
    type: "Namensart",
    givenName: "Vorname",
    familyName: "Nachname",
    prefix: "Titel",
    suffix: "Zusatz",
    nickname: "Rufname",
    label: "Bezeichnung",
  },
  Citation: {
    sourceId: "Quelle",
    fact: "Angabe",
    detail: "Fundstelle",
    url: "Adresse",
    confidence: "Verlässlichkeit",
    text: "Abschrift",
  },
  Source: {
    title: "Titel",
    kind: "Art",
    kindLabel: "Art (Text)",
    provider: "Anbieter",
    author: "Verfasser",
    repository: "Archiv",
    callNumber: "Signatur",
    url: "Adresse",
    date: "Datum",
    datePhrase: "Datum (Wortlaut)",
  },
  MediaAsset: { caption: "Bildunterschrift", isPrimary: "Hauptbild", fileName: "Datei" },
  Family: { name: "Name", description: "Beschreibung" },
  User: { name: "Name", email: "E-Mail", role: "Rolle", status: "Status", aiAccess: "KI-Zugang" },
  ApiToken: { name: "Name", level: "Stufe", expiresAt: "Gültig bis", revokedAt: "Widerrufen" },
  ImportBatch: { status: "Status" },
  Place: {
    source: "Herkunft",
    unresolvable: "Nicht zuordenbar",
    precision: "Genauigkeit",
    latitude: "Breite",
    longitude: "Länge",
    label: "Zugeordnet zu",
    note: "Begründung",
    uncertain: "Unsicher",
  },
};

const DATE_KEYS: readonly FuzzyKey[] = ["birthDate", "deathDate", "startDate", "endDate", "date"];
const PERSON_REF_FIELDS = new Set(["personId", "fromPersonId", "toPersonId"]);
const MAX_TEXT = 300;

// ---------------------------------------------------------------------------
// Auflösen von Verweisen (mit Maskierung)
// ---------------------------------------------------------------------------

type Row = Prisma.AuditLogGetPayload<{
  include: {
    user: { select: { name: true; email: true } };
    changeSet: { select: { id: true; title: true; kind: true; userId: true } };
  };
}>;

type Ctx = {
  scope: Scope;
  persons: Map<string, { name: string; visible: boolean }>;
  families: Map<string, string>;
  sources: Map<string, string>;
  relationships: Map<string, { type: string; subtype: string; fromPersonId: string; toPersonId: string }>;
  tokens: Map<string, TokenLabel>;
};

type TokenLabel = { name: string | null; deleted: boolean };

/**
 * Namen der KI-Schlüssel zu apiTokenIds. Protokoll und Pakete verweisen ohne
 * Fremdschlüssel auf Schlüssel; ein gelöschter Schlüssel (endgültig gelöscht
 * oder mit seinem Benutzer entfernt) bekommt seinen Namen aus dem letzten
 * eigenen Protokolleintrag (Anlegen/Löschen tragen `name`) und das Kennzeichen
 * `deleted` — die Änderungsgeschichte bleibt so lesbar.
 */
async function tokenLabels(ids: Iterable<string>): Promise<Map<string, TokenLabel>> {
  const wanted = [...new Set(ids)];
  const out = new Map<string, TokenLabel>();
  if (!wanted.length) return out;
  const rows = await prisma.apiToken.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  for (const r of rows) out.set(r.id, { name: r.name, deleted: false });
  const gone = wanted.filter((id) => !out.has(id));
  if (gone.length) {
    const audits = await prisma.auditLog.findMany({
      where: { entityType: "ApiToken", entityId: { in: gone }, action: { in: ["CREATE", "DELETE"] } },
      select: { entityId: true, diff: true },
      orderBy: { createdAt: "desc" },
    });
    for (const id of gone) {
      const named = audits.find((a) => a.entityId === id && strOf(obj(a.diff).name));
      out.set(id, { name: named ? (obj(named.diff).name as string) : null, deleted: true });
    }
  }
  return out;
}

function tokenFields(label: TokenLabel | undefined): Pick<ChangeEntryDto, "tokenName" | "tokenDeleted"> {
  if (!label) return { tokenName: null, tokenDeleted: false };
  return { tokenName: label.name, tokenDeleted: label.deleted };
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const strOf = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function personRefsOf(row: Row): string[] {
  const d = obj(row.diff);
  const out = new Set<string>(row.personIds);
  if (row.entityType === "Person" && row.action !== "CONNECT") out.add(row.entityId);
  for (const k of ["personId", "fromPersonId", "toPersonId", "keepId", "mergeId", "notDuplicateOf", "notDuplicateOfRemoved"]) {
    const v = strOf(d[k]);
    if (v) out.add(v);
  }
  const reviewed = strOf(obj(d.duplicateReview).with);
  if (reviewed) out.add(reviewed);
  return [...out];
}

async function buildCtx(scope: Scope, rows: Row[]): Promise<Ctx> {
  const personIds = new Set<string>();
  const familyIds = new Set<string>();
  const sourceIds = new Set<string>();
  const relIds = new Set<string>();
  const tokenIds = new Set<string>();
  for (const r of rows) {
    for (const p of personRefsOf(r)) personIds.add(p);
    const d = obj(r.diff);
    for (const key of ["families", "familyIds"]) {
      const v = d[key];
      if (Array.isArray(v)) for (const f of v) if (typeof f === "string") familyIds.add(f);
      const ch = obj(obj(d.changes)[key]);
      for (const side of [ch.from, ch.to]) if (Array.isArray(side)) for (const f of side) if (typeof f === "string") familyIds.add(f);
    }
    if (r.entityType === "Family") familyIds.add(r.entityId);
    if (strOf(d.familyId)) familyIds.add(d.familyId as string);
    if (strOf(d.sourceId)) sourceIds.add(d.sourceId as string);
    if (r.entityType === "Source") sourceIds.add(r.entityId);
    if (r.entityType === "Relationship") relIds.add(r.entityId);
    if (r.apiTokenId) tokenIds.add(r.apiTokenId);
  }
  // Beziehungen zuerst: ihre Personen gehören zu den aufzulösenden.
  const rels = relIds.size
    ? await prisma.relationship.findMany({
        where: { id: { in: [...relIds] } },
        select: { id: true, type: true, subtype: true, fromPersonId: true, toPersonId: true },
      })
    : [];
  for (const r of rels) for (const p of [r.fromPersonId, r.toPersonId]) personIds.add(p);
  const [people, fams, sources, tokens] = await Promise.all([
    personIds.size
      ? prisma.person.findMany({
          where: { id: { in: [...personIds] } },
          select: { id: true, givenName: true, familyName: true, families: { select: { familyId: true } } },
        })
      : [],
    familyIds.size ? prisma.family.findMany({ where: { id: { in: [...familyIds] } }, select: { id: true, name: true } }) : [],
    sourceIds.size ? prisma.source.findMany({ where: { id: { in: [...sourceIds] } }, select: { id: true, title: true } }) : [],
    tokenLabels(tokenIds),
  ]);
  const persons = new Map(
    people.map((p) => [
      p.id,
      {
        name: [p.givenName, p.familyName].filter(Boolean).join(" ") || "ohne Namen",
        visible: canViewPerson(scope, p.families.map((f) => f.familyId)),
      },
    ]),
  );
  return {
    scope,
    persons,
    families: new Map(fams.map((f) => [f.id, f.name])),
    sources: new Map(sources.map((s) => [s.id, s.title])),
    relationships: new Map(rels.map((r) => [r.id, r])),
    tokens,
  };
}

function personName(ctx: Ctx, id: string | null | undefined): string {
  if (!id) return "unbekannte Person";
  const p = ctx.persons.get(id);
  if (!p) return "gelöschte Person";
  return p.visible ? p.name : RESTRICTED;
}

function familyName(ctx: Ctx, id: string): string {
  const visible = ctx.scope.isAdmin || ctx.scope.families.has(id);
  if (!visible) return RESTRICTED;
  return ctx.families.get(id) ?? "gelöschte Familie";
}

// ---------------------------------------------------------------------------
// Werte und Felder
// ---------------------------------------------------------------------------

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function shorten(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)} …` : s;
}

function enumLabel(entityType: string, field: string, v: string): string {
  if (field === "gender") return GENDER[v] ?? v;
  if (field === "subtype") return REL_SUBTYPE[v] ?? v;
  if (field === "type") {
    if (entityType === "Relationship") return REL_TYPE[v] ?? v;
    if (entityType === "Event") return (EVENT_TYPE_LABEL as Record<string, string>)[v] ?? v;
    if (entityType === "PersonName") return (PERSON_NAME_TYPE_LABEL as Record<string, string>)[v] ?? v;
  }
  if (field === "fact") return (CITATION_FACT_LABEL as Record<string, string>)[v] ?? v;
  if (field === "confidence") return (CONFIDENCE_LABEL as Record<string, string>)[v] ?? v;
  if (field === "kind") return (SOURCE_KIND_LABEL as Record<string, string>)[v] ?? v;
  if (field === "role") return ROLE[v] ?? v;
  if (field === "status") return STATUS[v] ?? v;
  if (field === "aiAccess" || field === "level") return AI[v] ?? v;
  if (entityType === "Place" && field === "source") return v === "MANUAL" ? "von Hand" : v === "AI" ? "KI-Vorschlag" : "automatisch";
  if (entityType === "Place" && field === "precision") return PLACE_PRECISION[v] ?? v;
  return v;
}

function formatValue(ctx: Ctx, entityType: string, field: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (field === "families" || field === "familyIds") {
      return v.length ? v.map((f) => familyName(ctx, String(f))).join(", ") : null;
    }
    return v.map((x) => formatValue(ctx, entityType, field, x) ?? "—").join(", ");
  }
  if (typeof v === "string") {
    if (PERSON_REF_FIELDS.has(field)) return personName(ctx, v);
    if (field === "sourceId") return ctx.sources.get(v) ?? "gelöschte Quelle";
    if (ISO_TS.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("de-DE", { timeZone: "UTC" });
    }
    return shorten(enumLabel(entityType, field, v));
  }
  return shorten(JSON.stringify(v));
}

function labelOf(entityType: string, field: string): string | null {
  return FIELDS[entityType]?.[field] ?? COMMON_FIELDS[field] ?? null;
}

/** {feld: {from, to}} — neue Einträge (und ältere mit dieser Form, z.B. KI-Zugang). */
function fromChanges(ctx: Ctx, entityType: string, changes: Record<string, unknown>): ChangeFieldDto[] {
  const out: ChangeFieldDto[] = [];
  for (const [field, c] of Object.entries(changes)) {
    const label = labelOf(entityType, field);
    if (!label) continue;
    const { from, to } = obj(c);
    out.push({ field, label, from: formatValue(ctx, entityType, field, from), to: formatValue(ctx, entityType, field, to) });
  }
  return out;
}

/** Flache Werte (Anlegen, Löschen, ältere Änderungen): Datumsfelder zusammengefasst. */
function fromValues(ctx: Ctx, entityType: string, values: Record<string, unknown>): { field: string; label: string; value: string | null }[] {
  const out: { field: string; label: string; value: string | null }[] = [];
  const handled = new Set<string>();
  for (const key of DATE_KEYS) {
    if (!(key in values) && !(`${key}Precision` in values)) continue;
    for (const s of ["", "Precision", "Qualifier", "To", "ToPrecision"]) handled.add(key + s);
    const label = labelOf(entityType, key);
    if (!label) continue;
    out.push({ field: key, label, value: formatFuzzyDate(fuzzyField(values, key)) || null });
  }
  for (const [field, v] of Object.entries(values)) {
    if (handled.has(field)) continue;
    const label = labelOf(entityType, field);
    if (!label) continue;
    out.push({ field, label, value: formatValue(ctx, entityType, field, v) });
  }
  return out;
}

/** Je Feld eine Zeile; bei Changes vorher → nachher, sonst je nach Aktion. */
function fieldsOf(ctx: Ctx, row: Row): ChangeFieldDto[] {
  const d = obj(row.diff);
  if (d.changes && typeof d.changes === "object") return fromChanges(ctx, row.entityType, obj(d.changes));
  if (row.action === "MERGE" || row.action === "CONNECT" || d.import !== undefined) return [];
  // Ältere Form „feld: { from, to }“ ohne changes (z.B. KI-Zugang).
  const pairs = Object.entries(d).filter(([, v]) => {
    const o = obj(v);
    return "from" in o && "to" in o && Object.keys(o).length === 2;
  });
  if (pairs.length) return fromChanges(ctx, row.entityType, Object.fromEntries(pairs));
  const values = fromValues(ctx, row.entityType, d);
  if (row.action === "DELETE") return values.filter((v) => v.value !== null).map((v) => ({ field: v.field, label: v.label, from: v.value, to: null }));
  if (row.action === "CREATE") return values.filter((v) => v.value !== null).map((v) => ({ field: v.field, label: v.label, from: null, to: v.value }));
  // UPDATE älterer Einträge: nur die neuen Werte sind bekannt.
  return values.map((v) => ({ field: v.field, label: v.label, from: null, to: v.value, onlyNew: true }));
}

// ---------------------------------------------------------------------------
// Beschreibung eines Eintrags
// ---------------------------------------------------------------------------

function relationText(ctx: Ctx, rel: { type?: unknown; subtype?: unknown; fromPersonId?: unknown; toPersonId?: unknown }): string {
  const a = personName(ctx, strOf(rel.fromPersonId));
  const b = personName(ctx, strOf(rel.toPersonId));
  if (rel.type === "PARENT_OF") return `Eltern-Kind: ${a} → ${b}`;
  if (rel.type === "PARTNER_OF") return `Partnerschaft: ${a} und ${b}`;
  return `${a} und ${b}`;
}

function tallyText(t: unknown): string | null {
  const parts = Object.entries(obj(t))
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([k, n]) => count(n as number, SECTION_NOUN[k] ?? [k, k]));
  return parts.length ? parts.join(", ") : null;
}

function describe(ctx: Ctx, row: Row): { what: string; note: string | null } {
  const d = obj(row.diff);
  const act = ACTION[row.action] ?? row.action;
  const subject = strOf(d.subject);
  switch (row.entityType) {
    case "Person": {
      if (row.action === "MERGE") {
        const merged = obj(d.merged);
        const person = obj(merged.person);
        const fams = Array.isArray(merged.familyIds) ? (merged.familyIds as string[]) : [];
        const otherVisible = ctx.scope.isAdmin || fams.some((f) => ctx.scope.families.has(f));
        const otherName = otherVisible
          ? [person.givenName, person.familyName].filter((x) => typeof x === "string" && x).join(" ") || "ohne Namen"
          : RESTRICTED;
        return { what: `Zusammengeführt: ${otherName} in ${personName(ctx, row.entityId)}`, note: null };
      }
      if (row.action === "CONNECT") {
        const merged = typeof d.merged === "number" ? d.merged : 0;
        return { what: `Importe verbunden: ${count(merged, ["Zusammenführung", "Zusammenführungen"])}`, note: null };
      }
      if (d.import !== undefined) {
        const created = tallyText(d.created);
        const updated = tallyText(d.updated);
        const note = [created && `angelegt: ${created}`, updated && `geändert: ${updated}`].filter(Boolean).join("; ") || null;
        const what =
          d.person === "created" ? "Beim Import angelegt" : d.person === "updated" ? "Beim Import aktualisiert" : "Beim Import ergänzt";
        return { what: `${what}: ${personName(ctx, row.entityId)}`, note };
      }
      if (strOf(d.notDuplicateOf)) {
        return { what: `Als „keine Dublette“ markiert: ${personName(ctx, row.entityId)} und ${personName(ctx, d.notDuplicateOf as string)}`, note: null };
      }
      // KI-Vorprüfung (MCP review_duplicate): nur eine Einschätzung, keine Änderung an den Personen.
      const review = obj(d.duplicateReview);
      if (strOf(review.with)) {
        const verdict = VERDICT_LABEL[review.verdict as DuplicateVerdict] ?? String(review.verdict);
        const names = [personName(ctx, row.entityId), personName(ctx, review.with as string)];
        // Die Begründung kann Einzelheiten beider Personen nennen — nur zeigen, wenn beide sichtbar sind.
        return {
          what: `Mögliche Dublette vorgeprüft („${verdict}“): ${names[0]} und ${names[1]}`,
          note: names.includes(RESTRICTED) ? null : strOf(review.reason),
        };
      }
      if (strOf(d.notDuplicateOfRemoved)) {
        return { what: `Markierung „keine Dublette“ aufgehoben: ${personName(ctx, row.entityId)} und ${personName(ctx, d.notDuplicateOfRemoved as string)}`, note: null };
      }
      if (row.action === "DELETE") {
        // Neuere Einträge: die gespeicherten Familien der Person; ältere: die
        // Familien des Eintrags (beim Löschen ebenfalls die der Person).
        const visible = row.subjectFamiliesKnown
          ? canViewPerson(ctx.scope, row.subjectFamilyIds)
          : canViewPerson(ctx.scope, row.familyIds);
        return { what: `Person gelöscht: ${visible ? (subject ?? "ohne Namen") : RESTRICTED}`, note: null };
      }
      if (row.action === "UPDATE" && ("families" in d)) return { what: `Familien geändert: ${personName(ctx, row.entityId)}`, note: null };
      return { what: `Person ${act}: ${personName(ctx, row.entityId)}`, note: null };
    }
    case "Relationship": {
      const rel = ctx.relationships.get(row.entityId) ?? d;
      return { what: `Beziehung ${act} (${relationText(ctx, rel)})`, note: null };
    }
    case "Event": {
      const title = subject ?? strOf(d.title) ?? (strOf(d.type) ? enumLabel("Event", "type", d.type as string) : null);
      return { what: `Ereignis${title ? ` „${title}“` : ""} ${act}`, note: null };
    }
    case "PersonName": {
      const name = subject ?? strOf(d.display) ?? ([d.givenName, d.familyName].filter((x) => typeof x === "string" && x).join(" ") || null);
      return { what: `Name${name ? ` „${name}“` : ""} ${act}`, note: null };
    }
    case "Citation": {
      const src = strOf(d.sourceId) ? ctx.sources.get(d.sourceId as string) : null;
      return { what: `Beleg${src ? ` aus „${shorten(src)}“` : ""} ${act}`, note: null };
    }
    case "Source": {
      const title = subject ?? strOf(d.title) ?? ctx.sources.get(row.entityId) ?? null;
      return { what: `Quelle${title ? ` „${shorten(title)}“` : ""} ${act}`, note: null };
    }
    case "MediaAsset": {
      if (row.action === "UPDATE" && d.isPrimary === true) return { what: "Bild als Hauptbild festgelegt", note: null };
      const verb = row.action === "CREATE" ? "hochgeladen" : act;
      return { what: `Bild${subject ? ` „${subject}“` : ""} ${verb}`, note: null };
    }
    case "Family": {
      const name = familyName(ctx, row.entityId);
      const shown = name === "gelöschte Familie" && strOf(d.name) ? (d.name as string) : name;
      return { what: `Familie „${shown}“ ${act}`, note: null };
    }
    case "User":
      if (strOf(d.familyId)) return { what: `Familienrecht geändert (${familyName(ctx, d.familyId as string)})`, note: null };
      return { what: `Benutzer ${act}`, note: null };
    case "ApiToken":
      return { what: `KI-Schlüssel ${d.revoked ? "widerrufen" : act}${strOf(d.name) ? ` „${d.name}“` : ""}`, note: null };
    case "ImportBatch": {
      if (d.renamed) {
        const to = strOf(obj(obj(d.changes).displayName).to);
        return { what: to ? `Import ${strOf(d.letter) ?? ""} benannt: „${to}“`.replace("  ", " ") : `Name des Imports ${strOf(d.letter) ?? ""} entfernt`.trimEnd(), note: null };
      }
      if (d.exchange) return { what: "Daten eingespielt (Austauschformat)", note: null };
      if (d.gedcom) return { what: "GEDCOM-Import abgeschlossen", note: null };
      if (d.counts) {
        const counts = obj(d.counts);
        const created = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, obj(v).created]));
        const updated = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, obj(v).updated]));
        const note = [tallyText(created) && `angelegt: ${tallyText(created)}`, tallyText(updated) && `geändert: ${tallyText(updated)}`]
          .filter(Boolean)
          .join("; ");
        return { what: "Import ausgeführt", note: note || null };
      }
      return { what: `Import ${act}`, note: null };
    }
    case "Place": {
      // Ortszuordnung (lib/services/places.ts) — nur in /admin/changes sichtbar.
      const changes = obj(d.changes);
      const label = strOf(d.label) ?? strOf(obj(changes.label).to);
      const text = shorten(subject ?? "");
      if (row.action === "DELETE") return { what: `Ortszuordnung entfernt: „${text}“`, note: null };
      if (d.unresolvable === true || obj(changes.unresolvable).to === true) {
        return { what: `Ort als nicht zuordenbar markiert: „${text}“`, note: null };
      }
      return { what: `Ort zugeordnet: „${text}“${label ? ` → ${shorten(label)}` : ""}`, note: null };
    }
    default:
      return { what: `${ENTITY[row.entityType]?.[0] ?? row.entityType} ${act}`, note: null };
  }
}

function userLabel(u: { name: string | null; email: string } | null): string | null {
  if (!u) return null;
  return u.name?.trim() || u.email.split("@")[0];
}

/**
 * Darf der Betrachter die Person sehen, um die es in einem Personeneintrag
 * geht? Gibt es sie noch, entscheiden ihre heutigen Familien (wie überall).
 * Gibt es sie nicht mehr (gelöscht oder aufgegangen), entscheiden die im
 * Eintrag gespeicherten Familien zum Zeitpunkt des Eintrags
 * (`subjectFamilyIds`, lib/audit.ts) — mit derselben Prüffunktion
 * `canViewPerson`, also auch „ohne Familie = nur Admins“. Ältere Einträge
 * ohne diese Angabe: nur Admins (im Zweifel verbergen). Eine später
 * gelöschte Familie gibt nichts frei: Ihre Mitgliedschaften verschwinden mit
 * ihr, die gespeicherte Kennung passt dann zu niemandem mehr.
 */
function subjectVisible(ctx: Ctx, row: Row): boolean {
  const subject = ctx.persons.get(row.entityId);
  if (subject) return subject.visible;
  if (row.subjectFamiliesKnown) return canViewPerson(ctx.scope, row.subjectFamilyIds);
  return ctx.scope.isAdmin;
}

function toEntry(ctx: Ctx, row: Row): ChangeEntryDto {
  const { what, note } = describe(ctx, row);
  // Eintrag über eine Person, die der Betrachter nicht sehen darf (z.B.
  // Zusammenführen eines Verwandten aus fremder Familie, oder eine gelöschte
  // Person, deren Familien er nicht kannte): keine Feldwerte.
  const hiddenPerson = row.entityType === "Person" && row.action !== "CONNECT" && !subjectVisible(ctx, row);
  const ownToken = ctx.scope.isAdmin || (row.userId !== null && row.userId === ctx.scope.userId);
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    what,
    user: userLabel(row.user),
    channel: row.channel === "MCP" ? "MCP" : "APP",
    // Den Namen eines KI-Schlüssels sehen nur sein Besitzer und Admins.
    ...tokenFields(row.channel === "MCP" && row.apiTokenId && ownToken ? ctx.tokens.get(row.apiTokenId) : undefined),
    // Den Titel eines Pakets sehen Admins und wer es selbst angelegt hat.
    changeSet: row.changeSet
      ? {
          id: row.changeSet.id,
          title:
            ctx.scope.isAdmin || (row.changeSet.userId !== null && row.changeSet.userId === ctx.scope.userId)
              ? row.changeSet.title
              : neutralChangeSetTitle(row.changeSet.title, row.changeSet.kind),
        }
      : null,
    fields: hiddenPerson ? [] : fieldsOf(ctx, row),
    note: hiddenPerson ? null : note,
  };
}

/**
 * Paket-Titel für Nicht-Admins (außer für den Urheber des Pakets). Titel können Dinge nennen, die ein
 * Bearbeiter sonst nicht sähe: den Dateinamen eines Imports (sonst nur für
 * Admins, `importLabel`), einen frei gewählten Text der KI
 * (`begin_change_set` — das Paket kann Personen mehrerer Familien berühren),
 * den Namen eines fremden KI-Schlüssels oder einen Ortstext. Bearbeiter
 * sehen deshalb nur die Art des Pakets; alles ab dem ersten Anführungszeichen
 * entfällt.
 */
export function neutralChangeSetTitle(title: string, kind: string): string {
  if (kind === "IMPORT") return "Import";
  if (kind === "MCP" || kind === "MCP_AUTO") return "KI-Änderungen";
  const cut = title.search(/[„“”"‚‘’'«»]/);
  const head = (cut >= 0 ? title.slice(0, cut) : title).replace(/[\s:(–-]+$/, "").trim();
  return head || "Änderungen";
}

const ROW_INCLUDE = {
  user: { select: { name: true, email: true } },
  changeSet: { select: { id: true, title: true, kind: true, userId: true } },
} as const;

async function loadEntries(scope: Scope, ids: string[]): Promise<ChangeEntryDto[]> {
  if (!ids.length) return [];
  const rows = await prisma.auditLog.findMany({ where: { id: { in: ids } }, include: ROW_INCLUDE });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const ctx = await buildCtx(scope, rows);
  return rows.map((r) => toEntry(ctx, r));
}

function pageSize(limit: number | undefined): number {
  return Math.min(PAGE_MAX, Math.max(1, Math.floor(limit ?? PAGE_DEFAULT)));
}

// ---------------------------------------------------------------------------
// Verlauf einer Person
// ---------------------------------------------------------------------------

/** Arten älterer Einträge, die zu einer Person gehören können (Index entityType, entityId). */
const LEGACY_TYPES = ["Person", "Event", "PersonName", "Citation", "Relationship", "MediaAsset"];

/**
 * Änderungen an einer Person, neueste zuerst, seitenweise (Cursor = Kennung
 * des letzten Eintrags). Nur für Bearbeiter der Person; sonst NOT_FOUND
 * (unsichtbar) bzw. FORBIDDEN.
 */
export async function listPersonChanges(
  scope: Scope,
  personId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ChangePage<ChangeEntryDto>> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      families: { select: { familyId: true } },
      events: { select: { id: true } },
      names: { select: { id: true } },
      citations: { select: { id: true } },
      relationsFrom: { select: { id: true, events: { select: { id: true } }, citations: { select: { id: true } } } },
      relationsTo: { select: { id: true, events: { select: { id: true } }, citations: { select: { id: true } } } },
      media: { select: { mediaId: true } },
    },
  });
  const fams = person?.families.map((f) => f.familyId) ?? [];
  if (!person || !canViewPerson(scope, fams)) throw notFoundError("Person");
  if (!canEditPerson(scope, fams)) throw forbiddenError("den Verlauf dieser Person zu sehen");

  // Ältere Einträge ohne Momentaufnahme: über die heutigen Kennungen.
  const rels = [...person.relationsFrom, ...person.relationsTo];
  const legacyIds = [
    person.id,
    ...person.events.map((e) => e.id),
    ...person.names.map((n) => n.id),
    ...person.citations.map((c) => c.id),
    ...person.media.map((m) => m.mediaId),
    ...rels.flatMap((r) => [r.id, ...r.events.map((e) => e.id), ...r.citations.map((c) => c.id)]),
  ];
  const limit = pageSize(options.limit);
  const cursor = options.cursor
    ? Prisma.sql`AND ("createdAt", id) < (SELECT "createdAt", id FROM "AuditLog" WHERE id = ${options.cursor})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AuditLog"
    WHERE ("personIds" @> ARRAY[${person.id}]::text[]
           OR (cardinality("personIds") = 0 AND "entityType" = ANY(${LEGACY_TYPES}::text[]) AND "entityId" = ANY(${legacyIds}::text[])))
      ${cursor}
    ORDER BY "createdAt" DESC, id DESC
    LIMIT ${limit + 1}`;
  const ids = rows.slice(0, limit).map((r) => r.id);
  return { items: await loadEntries(scope, ids), nextCursor: rows.length > limit ? ids[ids.length - 1] : null };
}

// ---------------------------------------------------------------------------
// Übersicht für Administratoren
// ---------------------------------------------------------------------------

export type ChangeFilter = {
  familyId?: string | null;
  userId?: string | null;
  channel?: "APP" | "MCP" | null;
  /** JJJJ-MM-TT, einschließlich. */
  from?: string | null;
  to?: string | null;
};

export type ChangeSetSummaryDto = {
  /** Paket-Kennung bzw. „e:<Eintrag>“ für ältere Einzeländerungen. */
  key: string;
  title: string;
  first: string;
  last: string;
  entries: number;
  user: string | null;
  channel: "APP" | "MCP";
  tokenName: string | null;
  tokenDeleted: boolean;
  /** „12 Personen angelegt · 30 Belege angelegt“. */
  summary: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("die Änderungsübersicht zu sehen");
}

function filterSql(f: ChangeFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.familyId) parts.push(Prisma.sql`a."familyIds" @> ARRAY[${f.familyId}]::text[]`);
  if (f.userId) parts.push(Prisma.sql`a."userId" = ${f.userId}`);
  if (f.channel === "MCP") parts.push(Prisma.sql`a.channel IS NOT NULL`);
  if (f.channel === "APP") parts.push(Prisma.sql`a.channel IS NULL`);
  if (f.from) {
    if (!DAY.test(f.from)) throw validationError([{ path: "from", message: "Datum als JJJJ-MM-TT" }]);
    parts.push(Prisma.sql`a."createdAt" >= ${f.from}::date`);
  }
  if (f.to) {
    if (!DAY.test(f.to)) throw validationError([{ path: "to", message: "Datum als JJJJ-MM-TT" }]);
    parts.push(Prisma.sql`a."createdAt" < (${f.to}::date + 1)`);
  }
  return Prisma.join(parts, " AND ");
}

const groupKey = Prisma.sql`COALESCE(a."changeSetId", 'e:' || a.id)`;

function summaryText(groups: { entityType: string; action: string; n: number }[], importCounts: Record<string, unknown> | null): string {
  const byAction = new Map<string, string[]>();
  const add = (action: string, text: string) => byAction.set(action, [...(byAction.get(action) ?? []), text]);
  if (importCounts) {
    // Feste Reihenfolge: Personen, Beziehungen, Ereignisse, Namen, Belege, Quellen.
    for (const [section, noun] of Object.entries(SECTION_NOUN)) {
      const c = importCounts[section];
      const created = Number(obj(c).created ?? 0);
      const updated = Number(obj(c).updated ?? 0);
      if (created) add("CREATE", count(created, noun));
      if (updated) add("UPDATE", count(updated, noun));
    }
  }
  for (const g of groups) {
    // Beim Import stehen die Zählungen im Import-Eintrag; die Einträge je
    // Person würden sie nur doppelt (und unvollständig) zählen.
    if (importCounts && (g.entityType === "Person" || g.entityType === "ImportBatch")) continue;
    if (g.action === "MERGE") {
      add("MERGE", count(g.n, ["Zusammenführung", "Zusammenführungen"]));
      continue;
    }
    if (g.action === "CONNECT") continue;
    add(g.action, count(g.n, ENTITY[g.entityType] ?? [g.entityType, g.entityType]));
  }
  const order = ["CREATE", "UPDATE", "DELETE", "MERGE"];
  return [...byAction.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([action, texts]) => (action === "MERGE" ? texts.join(", ") : `${texts.join(", ")} ${ACTION[action] ?? action}`))
    .join(" · ");
}

/** Pakete (bzw. ältere Einzeländerungen), neueste zuerst; Seite ab 1. */
export async function listChangeSets(
  scope: Scope,
  filter: ChangeFilter = {},
  options: { page?: number; limit?: number } = {},
): Promise<{ items: ChangeSetSummaryDto[]; page: number; hasMore: boolean }> {
  assertAdmin(scope);
  const limit = pageSize(options.limit);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const where = filterSql(filter);
  const groups = await prisma.$queryRaw<
    { key: string; first: Date; last: Date; n: number; userId: string | null; mcp: boolean; apiTokenId: string | null }[]
  >`
    SELECT ${groupKey} AS key, min(a."createdAt") AS first, max(a."createdAt") AS last, count(*)::int AS n,
           (array_agg(a."userId" ORDER BY a."createdAt"))[1] AS "userId",
           bool_or(a.channel IS NOT NULL) AS mcp,
           (array_agg(a."apiTokenId" ORDER BY a."createdAt"))[1] AS "apiTokenId"
    FROM "AuditLog" a
    WHERE ${where}
    GROUP BY 1
    ORDER BY last DESC, key DESC
    LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`;
  const shown = groups.slice(0, limit);
  const setIds = shown.filter((g) => !g.key.startsWith("e:")).map((g) => g.key);
  const entryIds = shown.filter((g) => g.key.startsWith("e:")).map((g) => g.key.slice(2));

  const [counts, sets, singles, imports, users, tokens] = await Promise.all([
    shown.length
      ? prisma.$queryRaw<{ key: string; entityType: string; action: string; n: number }[]>`
          SELECT ${groupKey} AS key, a."entityType", a.action, count(*)::int AS n
          FROM "AuditLog" a
          WHERE ${where} AND (a."changeSetId" = ANY(${setIds}::text[]) OR a.id = ANY(${entryIds}::text[]))
          GROUP BY 1, 2, 3`
      : [],
    setIds.length ? prisma.changeSet.findMany({ where: { id: { in: setIds } }, select: { id: true, title: true } }) : [],
    entryIds.length ? prisma.auditLog.findMany({ where: { id: { in: entryIds } }, include: ROW_INCLUDE }) : [],
    setIds.length
      ? prisma.auditLog.findMany({
          where: { changeSetId: { in: setIds }, entityType: "ImportBatch", action: "CREATE" },
          select: { changeSetId: true, diff: true },
        })
      : [],
    prisma.user.findMany({
      where: { id: { in: [...new Set(shown.map((g) => g.userId).filter((x): x is string => Boolean(x)))] } },
      select: { id: true, name: true, email: true },
    }),
    tokenLabels(shown.filter((g) => g.mcp && g.apiTokenId).map((g) => g.apiTokenId as string)),
  ]);
  const titleOf = new Map(sets.map((s) => [s.id, s.title]));
  const userOf = new Map(users.map((u) => [u.id, userLabel(u)]));
  const importOf = new Map<string, Record<string, unknown>>();
  for (const i of imports) {
    const c = obj(obj(i.diff).counts);
    if (i.changeSetId && Object.keys(c).length) importOf.set(i.changeSetId, c);
  }
  const ctx = singles.length ? await buildCtx(scope, singles) : null;
  const singleOf = new Map(singles.map((r) => [r.id, r]));

  const items = shown.map((g): ChangeSetSummaryDto => {
    const own = counts.filter((c) => c.key === g.key);
    let title = titleOf.get(g.key);
    if (!title) {
      const row = singleOf.get(g.key.slice(2));
      title = row && ctx ? describe(ctx, row).what : "Änderung";
    }
    return {
      key: g.key,
      title,
      first: g.first.toISOString(),
      last: g.last.toISOString(),
      entries: g.n,
      user: g.userId ? (userOf.get(g.userId) ?? null) : null,
      channel: g.mcp ? "MCP" : "APP",
      ...tokenFields(g.mcp && g.apiTokenId ? tokens.get(g.apiTokenId) : undefined),
      summary: summaryText(own, importOf.get(g.key) ?? null),
    };
  });
  return { items, page, hasMore: groups.length > limit };
}

/** Einträge eines Pakets (bzw. eine ältere Einzeländerung), seitenweise. */
export async function listChangeSetEntries(
  scope: Scope,
  key: string,
  filter: ChangeFilter = {},
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ChangePage<ChangeEntryDto>> {
  assertAdmin(scope);
  const limit = pageSize(options.limit);
  const match = key.startsWith("e:") ? Prisma.sql`a.id = ${key.slice(2)}` : Prisma.sql`a."changeSetId" = ${key}`;
  const cursor = options.cursor
    ? Prisma.sql`AND (a."createdAt", a.id) < (SELECT "createdAt", id FROM "AuditLog" WHERE id = ${options.cursor})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "AuditLog" a
    WHERE ${match} AND ${filterSql(filter)} ${cursor}
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT ${limit + 1}`;
  const ids = rows.slice(0, limit).map((r) => r.id);
  return { items: await loadEntries(scope, ids), nextCursor: rows.length > limit ? ids[ids.length - 1] : null };
}

/** Auswahllisten für die Filter der Übersicht. */
export async function changeFilterOptions(scope: Scope): Promise<{
  families: { id: string; name: string }[];
  users: { id: string; label: string }[];
}> {
  assertAdmin(scope);
  const [families, users] = await Promise.all([
    prisma.family.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } }),
  ]);
  return {
    families,
    users: users.map((u) => ({ id: u.id, label: u.name ? `${u.name} (${u.email})` : u.email })),
  };
}

/** Filter aus Suchparametern (Seite /admin/changes und API). */
export function changeFilterFrom(params: URLSearchParams | Record<string, string | string[] | undefined>): ChangeFilter {
  const get = (k: string): string | null => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : null;
  };
  const channel = get("channel");
  const day = (k: string) => {
    const v = get(k);
    return v && DAY.test(v) ? v : null;
  };
  return {
    familyId: get("family"),
    userId: get("user"),
    channel: channel === "APP" || channel === "MCP" ? channel : null,
    from: day("from"),
    to: day("to"),
  };
}
