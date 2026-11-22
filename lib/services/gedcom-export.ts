import JSZip from "jszip";

import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { getObjectBuffer } from "../storage";
import {
  familiesFromRelationships,
  formatGedcomDate,
  parseGedcomDate,
  writeGedcom,
  type GedcomCitation,
  type GedcomDate,
  type GedcomDatePoint,
  type GedcomDocument,
  type GedcomEvent,
  type GedcomEventType,
  type GedcomExtension,
  type GedcomFamily,
  type GedcomMediaLink,
  type GedcomName,
  type GedcomNode,
  type GedcomNoteRef,
  type GedcomPartnerStatus,
  type GedcomPerson,
  type GedcomPrivacy,
  type GedcomRepository,
  type GedcomSource,
  type GedcomChildKind,
} from "../gedcom";
import {
  RAW_FORMAT,
  RAW_TYPES,
  UNKNOWN_GIVEN_NAME,
  indexOriginalFamily,
  indexOriginalPerson,
  resolveNames,
  type OriginalIndex,
} from "../gedcom-import/mapping";
import type { EventTypeName } from "../events";
import { buildExport } from "./exchange-export";
import { selectionFileSuffix, type ExportSelection } from "../export-selection";
import { REJECTED_RAW_SUFFIX } from "./import-apply";

/**
 * GEDCOM-Export (5.5.1, UTF-8) aus dem sichtbaren Bestand — dieselbe Grenze
 * wie der JSON/ZIP-Export (buildExport): unsichtbare Personen fehlen, Beziehungen
 * zu ihnen ebenso. Die App-Werte sind maßgeblich; aus dem beim Import
 * aufbewahrten Originaldatensatz (Rohdaten) kommt zurück, was die App nicht
 * abbildet — fremde Tags (z.B. MyHeritage `_UPD`, `_PHOTO_RIN`),
 * Koordinaten, strukturierte Anschriften, Fotoverweise, Privatsphäre-Angaben,
 * genaue QUAY-Werte. Verweise in solchen Rohdaten auf nicht exportierte
 * Datensätze werden entfernt (sonst zeigten sie ins Leere bzw. verrieten sie).
 * Notizen werden als Text geschrieben (HTML des Originals nur, wenn der Text
 * in der App unverändert ist).
 *
 * Teil-Export (`selection`, Familienauswahl im Dialog auf /admin/data):
 * dieselbe Grenze, nur enger — Verweise entstehen nur auf mitexportierte
 * Datensätze (FAMC/FAMS aus Beziehungen zwischen exportierten Personen, SOUR
 * nur auf zitierte und damit exportierte Quellen, Rohdaten-Zeiger wie oben
 * umgeschrieben bzw. entfernt).
 */

type Row = Record<string, unknown>;

const PRIVACY_NONE: GedcomPrivacy = { restrictions: [], livingMarked: false, placeholderName: false, markers: [] };

const EVENT_OUT: Partial<Record<EventTypeName, GedcomEventType>> = {
  TITLE: "NOBILITY_TITLE",
  MARRIAGE_BANNS: "MARRIAGE_BANN",
  CUSTOM: "CUSTOM_EVENT",
  MILITARY_SERVICE: "CUSTOM_EVENT",
};

const NAME_TYPE_OUT: Record<string, GedcomName["type"] | undefined> = {
  BIRTH: "BIRTH",
  MARRIED: "MARRIED",
  ALIAS: "AKA",
  RELIGIOUS: "RELIGIOUS",
  IMMIGRANT: "IMMIGRANT",
  VARIANT: undefined,
  OTHER: "OTHER",
};

const KIND_OUT: Record<string, GedcomChildKind> = { BIOLOGICAL: "BIOLOGICAL", ADOPTIVE: "ADOPTIVE", STEP: "STEP", FOSTER: "FOSTER" };
const STATUS_OUT: Record<string, GedcomPartnerStatus> = {
  MARRIED: "MARRIED",
  DIVORCED: "DIVORCED",
  UNMARRIED: "UNMARRIED",
  PARTNER_UNKNOWN: "UNKNOWN",
};

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

function point(iso: string, precision: unknown): GedcomDatePoint {
  const d = new Date(iso);
  const p: GedcomDatePoint = { calendar: "GREGORIAN", year: d.getUTCFullYear() };
  if (precision === "MONTH" || precision === "DAY") p.month = d.getUTCMonth() + 1;
  if (precision === "DAY") p.day = d.getUTCDate();
  return p;
}

/** Datumsspalten der App → GEDCOM-Datum (Wortlaut hat Vorrang, wenn er ein gültiges GEDCOM-Datum ist). */
export function appDateToGedcom(row: Row, key: string): GedcomDate | undefined {
  const iso = row[key] as string | Date | null | undefined;
  const value = iso instanceof Date ? iso.toISOString() : iso;
  const phrase = (row[`${key}Phrase`] as string | null | undefined)?.trim() || null;
  if (phrase) {
    const p = parseGedcomDate(phrase);
    if (p.kind !== "INVALID" && (p.kind !== "PHRASE" || !value)) return p;
  }
  if (!value) {
    if (!phrase) return undefined;
    const d: GedcomDate = { original: "", kind: "PHRASE", phrase: phrase.replace(/[()]/g, "") };
    d.original = formatGedcomDate(d);
    return d;
  }
  const start = point(value, row[`${key}Precision`]);
  const toRaw = row[`${key}To`] as string | Date | null | undefined;
  const to = toRaw ? point(toRaw instanceof Date ? toRaw.toISOString() : toRaw, row[`${key}ToPrecision`]) : undefined;
  const q = String(row[`${key}Qualifier`] ?? "EXACT");
  const kind: GedcomDate["kind"] =
    q === "ABOUT"
      ? "ABOUT"
      : q === "BEFORE"
        ? "BEFORE"
        : q === "AFTER"
          ? "AFTER"
          : q === "ESTIMATED"
            ? "ESTIMATED"
            : q === "CALCULATED"
              ? "CALCULATED"
              : q === "BETWEEN" && to
                ? "BETWEEN"
                : q === "PERIOD"
                  ? to
                    ? "FROM_TO"
                    : "FROM"
                  : q === "UNTIL"
                    ? "TO"
                    : phrase
                      ? "INTERPRETED"
                      : "EXACT";
  const d: GedcomDate = { original: "", kind, start };
  if (to && (kind === "BETWEEN" || kind === "FROM_TO")) d.end = to;
  if (kind === "INTERPRETED" && phrase) d.phrase = phrase.replace(/[()]/g, "");
  d.original = formatGedcomDate(d);
  return d;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const ev = (type: GedcomEventType, extra: Partial<GedcomEvent> = {}): GedcomEvent => ({
  type,
  notes: [],
  citations: [],
  media: [],
  externalIds: [],
  extensions: [],
  ...extra,
});

const inlineNote = (text: string | null | undefined): GedcomNoteRef[] =>
  text?.trim() ? [{ content: { text, isHtml: false }, citations: [], extensions: [] }] : [];

type RawContent = { format?: string; record?: Record<string, unknown>; notes?: { id: string; content: { text: string; original?: string; isHtml: boolean } }[]; repositories?: GedcomRepository[] };

/** Notizverweise des Originals in eingebettete Notizen umwandeln (geteilte Notizen aus der Kopie im Rohdatensatz). */
function inlineNotes(refs: GedcomNoteRef[] | undefined, raw: RawContent): GedcomNoteRef[] {
  return (refs ?? []).map((r) => {
    if (!r.noteId) return r;
    const n = raw.notes?.find((x) => x.id === r.noteId);
    return { content: n?.content ?? { text: "", isHtml: false }, citations: r.citations ?? [], extensions: r.extensions ?? [] };
  });
}
const notesText = (refs: GedcomNoteRef[], raw: RawContent) =>
  inlineNotes(refs, raw)
    .map((r) => r.content?.text ?? "")
    .filter(Boolean)
    .join("\n\n");

function overlayEvent(base: GedcomEvent, orig: GedcomEvent | undefined, raw: RawContent, appNotes: string | null | undefined): GedcomEvent {
  if (!orig) return base;
  base.extensions = orig.extensions ?? [];
  base.media = (orig.media ?? []).filter((m) => !m.mediaId);
  if (orig.privacy) base.privacy = orig.privacy;
  if (orig.partnerAges) base.partnerAges = orig.partnerAges;
  if (orig.religion !== undefined) base.religion = orig.religion;
  if (orig.adoption) base.adoption = { by: orig.adoption.by };
  if (orig.changed) base.changed = orig.changed;
  if (orig.updated) base.updated = orig.updated;
  if (orig.preferred !== undefined) base.preferred = orig.preferred;
  if (!base.externalIds.length) base.externalIds = orig.externalIds ?? [];
  if (orig.place && base.place && orig.place.name === base.place.name) base.place = { ...orig.place, notes: inlineNotes(orig.place.notes, raw) };
  if (orig.address && base.address) {
    const emails = orig.address.emails ?? [];
    base.address = { ...orig.address, emails, phones: orig.address.phones ?? [], faxes: orig.address.faxes ?? [], urls: orig.address.urls ?? [] };
  }
  if (base.age === undefined && orig.age !== undefined) base.age = orig.age;
  if (base.agency === undefined && orig.agency !== undefined) base.agency = orig.agency;
  if (appNotes === undefined) base.notes = inlineNotes(orig.notes, raw);
  else if (appNotes && notesText(orig.notes ?? [], raw) === appNotes) base.notes = inlineNotes(orig.notes, raw);
  return base;
}

function overlayCitation(base: GedcomCitation, orig: GedcomCitation | undefined, appText: string | null, raw: RawContent): GedcomCitation {
  if (!orig) return base;
  if (orig.quality !== undefined && orig.confidence === base.confidence) base.quality = orig.quality;
  if (orig.eventType !== undefined) base.eventType = orig.eventType;
  if (orig.role !== undefined) base.role = orig.role;
  if (orig.date) base.date = orig.date;
  base.media = (orig.media ?? []).filter((m) => !m.mediaId);
  base.extensions = orig.extensions ?? [];
  base.externalIds = orig.externalIds ?? [];
  const mapped = [...(orig.texts ?? []).map((t) => t.trim()).filter(Boolean), notesText(orig.notes ?? [], raw)].filter(Boolean).join("\n\n");
  if ((appText ?? "") === mapped) {
    base.texts = orig.texts ?? [];
    base.notes = inlineNotes(orig.notes, raw);
  }
  return base;
}

/** Alle Erweiterungsknoten eines Objekts (rekursiv) — für das Umschreiben der Verweise. */
function forEachExtensionList(value: unknown, fn: (list: GedcomExtension[]) => GedcomExtension[], seen = new Set<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((v) => forEachExtensionList(v, fn, seen));
    return;
  }
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (/[eE]xtensions$/.test(k) && Array.isArray(v)) o[k] = fn(v as GedcomExtension[]);
    else forEachExtensionList(v, fn, seen);
  }
}

/** Zeiger auf Datensätze umschreiben; unbekannte Ziele samt Knoten entfernen. */
function remapNode(n: GedcomNode, map: Map<string, string>): GedcomNode | null {
  if (n.pointer !== undefined) {
    const t = map.get(n.pointer);
    if (!t) return null;
    n = { ...n, pointer: t };
  }
  return { ...n, children: n.children.map((c) => remapNode(c, map)).filter((c): c is GedcomNode => c !== null) };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type GedcomExportResult = {
  text: string;
  bytes: Uint8Array;
  fileName: string;
  /** Bilddateien für die ZIP-Variante: Name im Archiv → Speicherschlüssel. */
  mediaFiles: Map<string, string>;
  stats: { persons: number; families: number; sources: number; events: number; media: number; extensionsFromRaw: number; droppedPointers: number; rejectedFamilies: number };
  warnings: number;
};

export async function buildGedcomExport(
  scope: Scope,
  options: { mediaPrefix?: string; selection?: ExportSelection | null } = {},
): Promise<GedcomExportResult> {
  const { data, keyByFileName } = await buildExport(scope, options.selection ?? null);
  const d = data as unknown as {
    persons: (Row & { id: string; media: { mediaId: string; isPrimary: boolean }[] })[];
    relationships: (Row & { id: string; type: string; subtype: string; fromPersonId: string; toPersonId: string; media?: { mediaId: string; isPrimary: boolean }[] })[];
    media: { id: string; fileName: string; caption: string | null; mimeType: string }[];
    sources: (Row & { id: string; title: string; mediaId?: string | null; media?: { mediaId: string }[] })[];
    citations: (Row & { id: string; sourceId: string; personId: string | null; relationshipId: string | null; eventId: string | null; fact: string; url?: string | null; media?: { mediaId: string }[] })[];
    events: (Row & { id: string; personId: string | null; relationshipId: string | null; type: EventTypeName; isAlternative: boolean; media?: { mediaId: string }[] })[];
    personNames: (Row & { id: string; personId: string; type: string })[];
    externalIds: { id: string; system: string; value: string; personId: string | null; relationshipId: string | null; eventId: string | null; sourceId: string | null; mediaId: string | null }[];
    rawRecords: { id: string; personId: string | null; relationshipId: string | null; sourceId: string | null; recordType: string; xref: string | null; content: unknown; superseded: boolean }[];
  };
  const prefix = options.mediaPrefix ?? "media/";

  // Herkunft: Schlüssel der Quelle für Personen, Beziehungen, Ereignisse, Belege
  const ids = (list: { id: string }[]) => list.map((x) => x.id);
  const links = await prisma.importLink.findMany({
    where: {
      OR: [
        { personId: { in: ids(d.persons) } },
        { relationshipId: { in: ids(d.relationships) } },
        { eventId: { in: ids(d.events) } },
        { citationId: { in: ids(d.citations) } },
      ],
    },
    select: { personId: true, relationshipId: true, eventId: true, citationId: true, externalKey: true, sourceTreeId: true, mergedFromId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // Zusammengeführte Datensätze haben mehrere Links (README, „Dubletten
  // zusammenführen“). Maßgeblich für Schlüssel, Originaldatensatz und _UID ist
  // der ursprüngliche Link des Datensatzes (ohne mergedFromId), sonst der
  // älteste. Die Kennungen der anderen Bäume bleiben in der App (Herkunft,
  // Fremdkennungen, Rohdaten) und im JSON-Export erhalten.
  const keyOf = new Map<string, string>();
  const primaryTree = new Map<string, string | null>();
  const treesOf = new Map<string, Set<string | null>>();
  const primaryRank = new Map<string, number>();
  for (const l of links) {
    const id = l.personId ?? l.relationshipId ?? l.eventId ?? l.citationId;
    if (!id) continue;
    treesOf.set(id, new Set([...(treesOf.get(id) ?? []), l.sourceTreeId]));
    const rank = l.mergedFromId ? 1 : 0;
    if (primaryRank.has(id) && primaryRank.get(id)! <= rank) continue;
    primaryRank.set(id, rank);
    primaryTree.set(id, l.sourceTreeId);
    if (l.externalKey) keyOf.set(id, l.externalKey);
    else keyOf.delete(id);
  }
  /** Nur bei Datensätzen aus mehreren Bäumen: Lauf → Baum (für Rohdaten und _UID). */
  const multiTree = new Set([...treesOf].filter(([, t]) => t.size > 1).map(([id]) => id));
  const batchTree = new Map<string, string | null>();
  if (multiTree.size) {
    const rawIds = d.rawRecords.filter((r) => multiTree.has(r.personId ?? r.relationshipId ?? "")).map((r) => r.id);
    const extIds = d.externalIds.filter((x) => multiTree.has(x.personId ?? x.relationshipId ?? x.eventId ?? "")).map((x) => x.id);
    for (const r of await prisma.importRawRecord.findMany({ where: { id: { in: rawIds } }, select: { id: true, batch: { select: { sourceTreeId: true } } } })) {
      batchTree.set(r.id, r.batch?.sourceTreeId ?? null);
    }
    for (const x of await prisma.externalId.findMany({ where: { id: { in: extIds } }, select: { id: true, batch: { select: { sourceTreeId: true } } } })) {
      batchTree.set(x.id, x.batch?.sourceTreeId ?? null);
    }
  }
  /** Gehört ein Rohdatensatz bzw. eine Kennung zu einem anderen als dem maßgeblichen Baum? */
  const fromOtherTree = (carrier: string, rowId: string | undefined) =>
    multiTree.has(carrier) && rowId !== undefined && batchTree.has(rowId) && batchTree.get(rowId) !== primaryTree.get(carrier);

  // Originaldatensätze (gültiger Stand) je Träger
  const rawBy = new Map<string, RawContent>();
  const xrefMap = new Map<string, string>();
  const xrefAmbiguous = new Set<string>();
  for (const r of d.rawRecords) {
    if (r.superseded) continue;
    const c = r.content as RawContent;
    if (c?.format !== RAW_FORMAT) continue;
    const carrier = r.personId ?? r.relationshipId ?? r.sourceId;
    if (!carrier) continue;
    const primaryKind =
      (r.recordType === RAW_TYPES.person && r.personId) ||
      (r.recordType === RAW_TYPES.family && r.relationshipId) ||
      (r.recordType === RAW_TYPES.source && r.sourceId);
    if (primaryKind && fromOtherTree(carrier, r.id)) continue;
    if (primaryKind) rawBy.set(`${r.recordType}|${carrier}`, c);
    if (r.xref && primaryKind) {
      if (xrefMap.has(r.xref) && xrefMap.get(r.xref) !== carrier) xrefAmbiguous.add(r.xref);
      xrefMap.set(r.xref, carrier);
    }
  }
  for (const x of xrefAmbiguous) xrefMap.delete(x);

  const extIdsOf = new Map<string, { type: string; value: string }[]>();
  for (const x of d.externalIds) {
    const t = x.personId ?? x.relationshipId ?? x.eventId ?? x.sourceId;
    if (!t || x.mediaId) continue;
    if (fromOtherTree(t, x.id)) continue;
    const list = extIdsOf.get(t) ?? [];
    list.push({ type: x.system, value: x.value });
    extIdsOf.set(t, list);
  }
  const mediaById = new Map(d.media.map((m) => [m.id, m]));
  const mediaUrlsOf = new Map<string, Set<string>>();
  for (const x of d.externalIds) if (x.mediaId && x.system === "MEDIA_URL") mediaUrlsOf.set(x.mediaId, new Set([...(mediaUrlsOf.get(x.mediaId) ?? []), x.value]));
  /**
   * Verweis auf eine mitexportierte Bilddatei (im ZIP unter media/). Personen,
   * Partnerschaften und Quellen nutzen dieselbe Form — sonst läge ein Bild im
   * Archiv, auf das die .ged-Datei nirgends verweist.
   */
  const appMediaLink = (mediaId: string, primary: boolean): GedcomMediaLink | null => {
    const asset = mediaById.get(mediaId);
    if (!asset) return null;
    return {
      primary,
      extensions: [],
      inline: {
        files: [{ location: `${prefix}${asset.fileName}`, isUrl: false, format: asset.mimeType.split("/")[1] ?? "webp" }],
        ...(asset.caption ? { title: asset.caption } : {}),
        notes: [],
        citations: [],
        externalIds: [],
        extensions: [],
      },
    };
  };

  /**
   * Bilder der App an Ereignissen und Belegen (GEDCOM 5.5.1: OBJE unter
   * EVENT_DETAIL bzw. SOURCE_CITATION) vor die Verweise des Originals setzen.
   */
  const withAppMedia = <T extends { media: GedcomMediaLink[] }>(target: T, links: { mediaId: string }[] | undefined): T => {
    const app = (links ?? []).map((m) => appMediaLink(m.mediaId, false)).filter((m): m is GedcomMediaLink => m !== null);
    if (app.length) target.media = [...app, ...(target.media ?? [])];
    return target;
  };
  const citationsBy = (field: "personId" | "relationshipId" | "eventId", id: string) => d.citations.filter((c) => c[field] === id);
  const citationOf = (c: (typeof d.citations)[number], idx: OriginalIndex | null, raw: RawContent): GedcomCitation => {
    const base: GedcomCitation = { sourceId: c.sourceId, texts: c.text ? [String(c.text)] : [], notes: [], media: [], externalIds: [], extensions: [] };
    // Fundstelle und Adresse des Eintrags stehen in GEDCOM gemeinsam in PAGE.
    const page = [c.detail, c.url].filter(Boolean).join(", ");
    if (page) base.page = String(page);
    if (c.confidence) {
      base.confidence = c.confidence as GedcomCitation["confidence"];
      base.quality = c.confidence === "HIGH" ? 3 : c.confidence === "MEDIUM" ? 2 : 1;
    }
    const k = keyOf.get(c.id);
    return withAppMedia(overlayCitation(base, k && idx ? idx.citations.get(k) : undefined, (c.text as string | null) ?? null, raw), c.media);
  };
  const eventsOfPerson = new Map<string, typeof d.events>();
  const eventsOfRel = new Map<string, typeof d.events>();
  for (const e of d.events) {
    if (e.personId) eventsOfPerson.set(e.personId, [...(eventsOfPerson.get(e.personId) ?? []), e]);
    if (e.relationshipId) eventsOfRel.set(e.relationshipId, [...(eventsOfRel.get(e.relationshipId) ?? []), e]);
  }
  const appEvent = (e: (typeof d.events)[number], idx: OriginalIndex | null, raw: RawContent): GedcomEvent => {
    const type: GedcomEventType = EVENT_OUT[e.type] ?? (e.type as GedcomEventType);
    const g = ev(type);
    if (e.type === "MILITARY_SERVICE") g.label = (e.label as string) || "Militärdienst";
    else if (e.label) g.label = String(e.label);
    if (e.value) g.value = String(e.value);
    const date = appDateToGedcom(e, "date");
    if (date) g.date = date;
    if (e.place) g.place = { name: String(e.place), parts: String(e.place).split(",").map((s) => s.trim()), notes: [], citations: [], extensions: [] };
    if (e.address) g.address = { text: String(e.address), phones: [], emails: [], faxes: [], urls: [] };
    if (e.cause) g.cause = String(e.cause);
    if (e.age) g.age = String(e.age);
    if (e.agency) g.agency = String(e.agency);
    g.notes = inlineNote(e.notes as string | null);
    g.externalIds = extIdsOf.get(e.id) ?? [];
    g.citations = citationsBy("eventId", e.id).map((c) => citationOf(c, idx, raw));
    const k = keyOf.get(e.id);
    return withAppMedia(overlayEvent(g, k && idx ? idx.events.get(k) : undefined, raw, (e.notes as string | null) ?? null), e.media);
  };

  let extensionsFromRaw = 0;
  let rejectedFamilies = 0;

  // --- Personen ---------------------------------------------------------------
  const persons: GedcomPerson[] = d.persons.map((p) => {
    const raw = rawBy.get(`${RAW_TYPES.person}|${p.id}`) ?? {};
    const orig = raw.record as unknown as GedcomPerson | undefined;
    const pk = keyOf.get(p.id);
    const idx = orig && pk ? indexOriginalPerson(orig, pk) : null;
    const origPrimary = orig?.names?.find((n) => n.preferred) ?? orig?.names?.[0];

    const given = p.givenName === UNKNOWN_GIVEN_NAME && origPrimary && !origPrimary.given ? undefined : String(p.givenName);
    const birthName = (p.birthName as string | null) ?? null;
    const familyName = (p.familyName as string | null) ?? null;
    const surname = birthName ?? familyName ?? undefined;
    const primary: GedcomName = {
      full: [given, surname].filter(Boolean).join(" "),
      original: `${given ?? ""} /${surname ?? ""}/`.trim(),
      marriedSurnames: birthName && familyName ? [familyName] : [],
      aliases: [],
      variants: [],
      notes: [],
      citations: [],
      extensions: origPrimary?.extensions ?? [],
    };
    if (given) primary.given = given;
    if (surname) primary.surname = surname;
    if (p.namePrefix) primary.prefix = String(p.namePrefix);
    if (p.nameSuffix) primary.suffix = String(p.nameSuffix);
    if (p.nickname) primary.nickname = String(p.nickname);
    // Hauptname in der App unverändert seit dem Import → Original (mit _MARNM, SPFX …) schreiben
    if (origPrimary && orig) {
      const derived = resolveNames(orig.names);
      if (derived.givenName === p.givenName && derived.familyName === familyName && derived.birthName === birthName) {
        const keep = { ...origPrimary, notes: inlineNotes(origPrimary.notes, raw), citations: [] as GedcomCitation[] };
        for (const k of ["prefix", "suffix", "nickname"] as const) delete keep[k];
        if (p.namePrefix) keep.prefix = String(p.namePrefix);
        if (p.nameSuffix) keep.suffix = String(p.nameSuffix);
        if (p.nickname && p.nickname !== origPrimary.callName) keep.nickname = String(p.nickname);
        for (const k of ["given", "surname", "prefix", "suffix", "nickname"] as const) delete primary[k];
        Object.assign(primary, keep);
      }
    }
    const names: GedcomName[] = [primary];
    for (const n of d.personNames.filter((x) => x.personId === p.id)) {
      const g = n.givenName ? String(n.givenName) : undefined;
      const s = n.familyName ? String(n.familyName) : undefined;
      const name: GedcomName = {
        full: [g, s].filter(Boolean).join(" "),
        original: `${g ?? ""} /${s ?? ""}/`.trim(),
        marriedSurnames: [],
        aliases: [],
        variants: [],
        notes: inlineNote(n.notes as string | null),
        citations: [],
        extensions: [],
      };
      if (g) name.given = g;
      if (s) name.surname = s;
      if (n.prefix) name.prefix = String(n.prefix);
      if (n.suffix) name.suffix = String(n.suffix);
      if (n.nickname) name.nickname = String(n.nickname);
      const t = NAME_TYPE_OUT[n.type];
      if (t) name.type = t;
      if (n.label) {
        name.typeLabel = String(n.label);
        name.type ??= "OTHER";
      }
      names.push(name);
    }

    const events: GedcomEvent[] = [];
    const personCitations: GedcomCitation[] = [];
    for (const c of citationsBy("personId", p.id).filter((c) => !c.eventId)) {
      if (c.fact === "NAME") primary.citations.push(citationOf(c, idx, raw));
      else if (c.fact !== "BIRTH" && c.fact !== "DEATH") personCitations.push(citationOf(c, idx, raw));
    }
    for (const [type, key, place, fact] of [
      ["BIRTH", "birthDate", "birthPlace", "BIRTH"],
      ["DEATH", "deathDate", "deathPlace", "DEATH"],
    ] as const) {
      const date = appDateToGedcom(p, key);
      const cites = citationsBy("personId", p.id).filter((c) => !c.eventId && c.fact === fact);
      const main = idx?.main[type];
      if (!date && !p[place] && !(type === "DEATH" && p.deathCause) && !cites.length && !main) continue;
      const g = ev(type);
      if (date) g.date = date;
      if (p[place]) g.place = { name: String(p[place]), parts: String(p[place]).split(",").map((s) => s.trim()), notes: [], citations: [], extensions: [] };
      if (type === "DEATH" && p.deathCause) g.cause = String(p.deathCause);
      if (!date && !g.place && !g.cause) g.value = "Y";
      g.citations = cites.map((c) => citationOf(c, idx, raw));
      if (main) {
        g.externalIds = main.externalIds ?? [];
        overlayEvent(g, main, raw, undefined);
        if (main.address && !g.address) g.address = main.address;
      }
      events.push(g);
    }
    for (const e of (eventsOfPerson.get(p.id) ?? []).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))) {
      events.push(appEvent(e, idx, raw));
    }

    const media: GedcomMediaLink[] = [];
    const downloadedUrls = new Set<string>();
    for (const m of p.media) {
      const link = appMediaLink(m.mediaId, m.isPrimary);
      if (!link) continue;
      for (const u of mediaUrlsOf.get(m.mediaId) ?? []) downloadedUrls.add(u);
      media.push(link);
    }
    for (const l of orig?.media ?? []) {
      if (l.mediaId || !l.inline) continue;
      if (l.inline.files?.some((f) => downloadedUrls.has(f.location))) continue;
      media.push(l);
    }

    const person: GedcomPerson = {
      id: p.id,
      names,
      sex: (p.gender as GedcomPerson["sex"]) ?? "UNKNOWN",
      events,
      notes: inlineNote(p.notes as string | null),
      citations: personCitations,
      media,
      externalIds: extIdsOf.get(p.id) ?? [],
      privacy: orig?.privacy ?? PRIVACY_NONE,
      parentFamilies: [],
      spouseFamilies: [],
      extensions: orig?.extensions ?? [],
    };
    if (orig?.updated) person.updated = orig.updated;
    if (orig?.changed) person.changed = orig.changed;
    if (person.notes.length && orig && notesText(orig.notes ?? [], raw) === p.notes) person.notes = inlineNotes(orig.notes, raw);
    if (orig) extensionsFromRaw++;
    return person;
  });
  const personIds = new Set(persons.map((p) => p.id));

  // --- Familien ---------------------------------------------------------------
  const partnerships = d.relationships.filter((r) => r.type === "PARTNER_OF" && personIds.has(r.fromPersonId) && personIds.has(r.toPersonId));
  const famInput = partnerships.map((r) => {
    const raw = rawBy.get(`${RAW_TYPES.family}|${r.id}`) ?? {};
    const orig = raw.record as unknown as GedcomFamily | undefined;
    const rk = keyOf.get(r.id);
    const idx = orig && rk ? indexOriginalFamily(orig, rk) : null;
    const events: GedcomEvent[] = [];
    const cites = citationsBy("relationshipId", r.id).filter((c) => !c.eventId);
    const start = appDateToGedcom(r, "startDate");
    const end = appDateToGedcom(r, "endDate");
    const married = r.subtype === "MARRIED" || r.subtype === "DIVORCED";
    if (start || r.startPlace || (married && idx?.main.MARRIAGE)) {
      const g = ev(married ? "MARRIAGE" : "CUSTOM_EVENT", married ? {} : { label: "Beginn der Partnerschaft" });
      if (start) g.date = start;
      if (r.startPlace) g.place = { name: String(r.startPlace), parts: String(r.startPlace).split(",").map((s) => s.trim()), notes: [], citations: [], extensions: [] };
      if (!start && !g.place) g.value = "Y";
      if (married) {
        g.citations = cites.filter((c) => c.fact === "PARTNERSHIP").map((c) => citationOf(c, idx, raw));
        if (idx?.main.MARRIAGE) overlayEvent(g, idx.main.MARRIAGE, raw, undefined);
      }
      events.push(g);
    }
    if (end || r.endPlace) {
      const div = r.subtype === "DIVORCED";
      const g = ev(div ? "DIVORCE" : "CUSTOM_EVENT", div ? {} : { label: "Ende der Partnerschaft" });
      if (end) g.date = end;
      if (r.endPlace) g.place = { name: String(r.endPlace), parts: String(r.endPlace).split(",").map((s) => s.trim()), notes: [], citations: [], extensions: [] };
      if (div && idx?.main.DIVORCE) overlayEvent(g, idx.main.DIVORCE, raw, undefined);
      events.push(g);
    }
    for (const e of (eventsOfRel.get(r.id) ?? []).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))) events.push(appEvent(e, idx, raw));
    return { r, raw, orig, idx, events, cites, married };
  });
  const families: GedcomFamily[] = familiesFromRelationships({
    persons: persons.map((p) => ({ id: p.id, sex: p.sex })),
    partnerships: famInput.map((f) => ({
      id: f.r.id,
      personIds: [f.r.fromPersonId, f.r.toPersonId] as [string, string],
      status: STATUS_OUT[f.r.subtype] ?? "UNKNOWN",
      events: f.events,
    })),
    parentChild: d.relationships
      .filter((r) => r.type === "PARENT_OF" && personIds.has(r.fromPersonId) && personIds.has(r.toPersonId))
      .map((r) => ({ parentId: r.fromPersonId, childId: r.toPersonId, kind: KIND_OUT[r.subtype] ?? "BIOLOGICAL" })),
  });
  const famById = new Map(families.map((f) => [f.id, f]));
  for (const f of famInput) {
    const fam = famById.get(f.r.id);
    if (!fam) continue;
    fam.notes = inlineNote(f.r.notes as string | null);
    fam.citations = f.cites.filter((c) => !(f.married && c.fact === "PARTNERSHIP" && f.events.some((e) => e.type === "MARRIAGE"))).map((c) => citationOf(c, f.idx, f.raw));
    fam.externalIds = extIdsOf.get(f.r.id) ?? [];
    const famMedia = (f.r.media ?? []).map((m) => appMediaLink(m.mediaId, m.isPrimary)).filter((m): m is GedcomMediaLink => m !== null);
    fam.media = famMedia;
    if (f.orig) {
      fam.extensions = f.orig.extensions ?? [];
      fam.media = [...famMedia, ...(f.orig.media ?? []).filter((m) => !m.mediaId)];
      if (f.orig.privacy) fam.privacy = f.orig.privacy;
      if (f.orig.updated) fam.updated = f.orig.updated;
      if (f.orig.changed) fam.changed = f.orig.changed;
      if (fam.notes.length && notesText(f.orig.notes ?? [], f.raw) === f.r.notes) fam.notes = inlineNotes(f.orig.notes, f.raw);
      extensionsFromRaw++;
    }
  }
  // Abgelehnte Familien (Beziehung verstieß beim Import gegen eine Regel der
  // App, z.B. Paar zugleich Eltern und Kind): ihr Original liegt in den
  // Rohdaten einer beteiligten Person. Wieder als FAM ausgeben, damit ein
  // Hin- und Rückweg die Familie behält — Partner und Ereignisse, Notizen und
  // Belege; Kinder nicht (ihre Abstammung steht bei den übrigen Familien,
  // ein zweites FAMC wäre doppelt). Nur wenn beide Partner exportiert werden.
  const personXref = new Map<string, string>();
  for (const r of d.rawRecords) if (!r.superseded && r.recordType === RAW_TYPES.person && r.personId && r.xref) personXref.set(r.personId, r.xref);
  const exportedSources = new Set(d.sources.map((s) => s.id));
  /** Belege des Originals auf exportierte Quellen umbiegen; nicht auffindbare entfallen (sie stehen im Original). */
  const remapCitations = (list: GedcomCitation[] | undefined, sourceIds: Record<string, string>) =>
    (list ?? []).flatMap((c) => {
      if (!c.sourceId) return [c];
      const id = sourceIds[c.sourceId] ?? xrefMap.get(c.sourceId);
      return id && exportedSources.has(id) ? [{ ...c, sourceId: id }] : [];
    });
  for (const r of d.rawRecords) {
    if (r.superseded || r.recordType !== `${RAW_TYPES.family}${REJECTED_RAW_SUFFIX}` || !r.personId) continue;
    const c = r.content as RawContent & { rejected?: { type: string; reason: string; personIds?: string[]; sourceIds?: Record<string, string> } };
    if (c?.format !== RAW_FORMAT || !c.rejected || c.rejected.type !== "PARTNER_OF") continue;
    const orig = c.record as unknown as GedcomFamily | undefined;
    if (!orig) continue;
    // Partner über die Xref ihres eigenen Originaldatensatzes zuordnen (eindeutig
    // je Person, auch wenn mehrere Bäume dieselben Xrefs benutzen).
    const involved = c.rejected.personIds ?? [];
    const partners = orig.partners.map((x) => involved.find((id) => personXref.get(id) === x) ?? xrefMap.get(x));
    if (partners.length !== 2 || partners.some((p) => !p || !personIds.has(p))) continue;
    const id = `REJ-${r.personId}-${r.xref ?? families.length}`;
    if (famById.has(id)) continue;
    const fam: GedcomFamily = {
      ...orig,
      id,
      partners: partners as string[],
      children: [],
      events: orig.events.map((e) => ({ ...e, citations: remapCitations(e.citations, c.rejected!.sourceIds ?? {}), media: (e.media ?? []).filter((m) => !m.mediaId), notes: inlineNotes(e.notes, c) })),
      notes: inlineNotes(orig.notes, c),
      citations: remapCitations(orig.citations, c.rejected.sourceIds ?? {}),
      media: (orig.media ?? []).filter((m) => !m.mediaId),
    };
    families.push(fam);
    famById.set(id, fam);
    rejectedFamilies++;
  }

  // Belege zur Abstammung: am Kind (GEDCOM kennt keinen Ort dafür an der Familie)
  const personById = new Map(persons.map((p) => [p.id, p]));
  for (const r of d.relationships.filter((x) => x.type === "PARENT_OF")) {
    const child = personById.get(r.toPersonId);
    if (!child) continue;
    for (const c of citationsBy("relationshipId", r.id)) child.citations.push(citationOf(c, null, {}));
  }

  // --- Quellen und Archive -------------------------------------------------------
  const repositories: GedcomRepository[] = [];
  const repoByName = new Map<string, string>();
  const sources: GedcomSource[] = d.sources.map((s) => {
    const raw = rawBy.get(`${RAW_TYPES.source}|${s.id}`) ?? {};
    const orig = raw.record as unknown as GedcomSource | undefined;
    const src: GedcomSource = {
      id: s.id,
      title: s.title,
      urls: s.url ? [String(s.url)] : [],
      dataEvents: [],
      repositories: [],
      notes: [],
      media: [],
      externalIds: extIdsOf.get(s.id) ?? [],
      extensions: [],
    };
    const srcMedia = s.mediaId ? appMediaLink(s.mediaId, false) : null;
    if (s.author) src.author = String(s.author);
    if (s.kindLabel) src.sourceType = String(s.kindLabel);
    const appNotes = (s.notes as string | null) ?? "";
    if (orig) {
      for (const k of ["abbreviation", "publication", "dataAgency", "medium", "changed", "updated"] as const) {
        if (orig[k] !== undefined) (src as unknown as Record<string, unknown>)[k] = orig[k];
      }
      if (orig.sourceType !== undefined) src.sourceType = orig.sourceType;
      src.dataEvents = orig.dataEvents ?? [];
      src.extensions = orig.extensions ?? [];
      src.media = (orig.media ?? []).filter((m) => !m.mediaId);
      if (!src.urls.length) src.urls = orig.urls ?? [];
      const mapped = [orig.text?.trim(), notesText(orig.notes ?? [], raw)].filter(Boolean).join("\n\n");
      if (mapped === appNotes) {
        if (orig.text !== undefined) src.text = orig.text;
        src.notes = inlineNotes(orig.notes, raw);
      } else src.notes = inlineNote(appNotes);
      extensionsFromRaw++;
    } else src.notes = inlineNote(appNotes);
    // Hauptscan zuerst, dann die weiteren Bilder der Quelle (OBJE unter SOUR).
    const more = (s.media ?? [])
      .filter((m) => m.mediaId !== s.mediaId)
      .map((m) => appMediaLink(m.mediaId, false))
      .filter((m): m is GedcomMediaLink => m !== null);
    src.media.unshift(...(srcMedia ? [srcMedia] : []), ...more);
    if (s.repository) {
      const name = String(s.repository);
      let rid = repoByName.get(name);
      if (!rid) {
        rid = `R${repositories.length + 1}`;
        const origRepo = raw.repositories?.find((r) => r.name === name);
        repositories.push({ id: rid, name, notes: [], externalIds: [], extensions: [], ...(origRepo?.address ? { address: origRepo.address } : {}) });
        repoByName.set(name, rid);
      }
      src.repositories.push({ repositoryId: rid, callNumbers: s.callNumber ? [String(s.callNumber)] : [], notes: [], extensions: [] });
    }
    return src;
  });

  const doc: GedcomDocument = {
    header: { dialect: "UNKNOWN", majorVersion: 5, externalIds: [], extensions: [] },
    persons,
    families,
    sources,
    repositories,
    notes: [],
    media: [],
    submitters: [],
    unknownRecords: [],
  };

  // Verweise in Rohdaten: Original-Xref → exportierte Kennung, sonst entfernen
  const targets = new Map<string, string>();
  const exported = new Set([...persons.map((p) => p.id), ...families.map((f) => f.id), ...sources.map((s) => s.id)]);
  for (const [xref, carrier] of xrefMap) if (exported.has(carrier)) targets.set(xref, carrier);
  let droppedPointers = 0;
  forEachExtensionList(doc, (list) =>
    list
      .map((e) => {
        const n = remapNode(e.node, targets);
        if (!n) droppedPointers++;
        return n ? { path: e.path, node: n } : null;
      })
      .filter((e): e is GedcomExtension => e !== null),
  );

  const result = writeGedcom(doc, { sourceId: "STAMMBAUM", sourceName: "Stammbaum", submitterName: "Stammbaum-Export" });
  const mediaFiles = new Map<string, string>();
  for (const [name, key] of keyByFileName) mediaFiles.set(name, key);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    text: result.text,
    bytes: result.bytes,
    fileName: `stammbaum_${stamp}${selectionFileSuffix(options.selection ?? null)}.ged`,
    mediaFiles,
    stats: {
      persons: persons.length,
      families: families.length,
      sources: sources.length,
      events: persons.reduce((n, p) => n + p.events.length, 0) + families.reduce((n, f) => n + f.events.length, 0),
      media: mediaFiles.size,
      extensionsFromRaw,
      rejectedFamilies,
      droppedPointers,
    },
    warnings: result.warnings.length,
  };
}

/** ZIP: stammbaum.ged + media/<Datei> (wie der ZIP-Export). */
export async function buildGedcomZip(scope: Scope, selection: ExportSelection | null = null): Promise<{ buffer: Buffer; fileName: string; missing: number }> {
  const g = await buildGedcomExport(scope, { mediaPrefix: "media/", selection });
  const zip = new JSZip();
  zip.file("stammbaum.ged", g.bytes);
  const folder = zip.folder("media")!;
  let missing = 0;
  for (const [name, key] of g.mediaFiles) {
    const buf = await getObjectBuffer(key).catch(() => null);
    if (buf) folder.file(name, buf);
    else missing++;
  }
  if (missing) {
    zip.file(
      "HINWEIS.txt",
      missing === 1
        ? "1 Bilddatei konnte nicht gelesen werden und fehlt in diesem Archiv.\n"
        : `${missing} Bilddateien konnten nicht gelesen werden und fehlen in diesem Archiv.\n`,
    );
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  return { buffer, fileName: g.fileName.replace(/\.ged$/, ".zip"), missing };
}
