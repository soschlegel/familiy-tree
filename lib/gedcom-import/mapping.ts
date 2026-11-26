/**
 * GEDCOM-Zwischenmodell (lib/gedcom) → Eingabe für applyGenealogyImport
 * (lib/services/import-apply.ts). Rein: keine Datenbank, keine Netzwerk-
 * zugriffe — Abgleich mit dem Bestand, Vorschau und Schreiben übernimmt
 * lib/services/gedcom-import.ts.
 *
 * Alle Einträge haben `action: "create"`; die `ref` ist zugleich der
 * Schlüssel in der Quelle (ImportLink.externalKey), siehe `personKey` usw.
 * Regeln (welche Angabe wohin) und Begründungen: docs/fachlich/gedcom.md und
 * docs/komponenten/bibliotheken.md (lib/gedcom-import).
 */
import { createHash } from "node:crypto";

import { eventTypeAllowed, type EventTypeName, type PersonNameTypeName } from "../events";
import { DERIVED_SOURCE_KINDS } from "../source-labels";
import type { SourceKindName } from "../validation";
import { classifySource, plainText, safeHttpUrl, splitCitationPage } from "../source-classify";
import { deriveRelationships } from "../gedcom/relationships";
import type {
  GedcomChildKind,
  GedcomCitation,
  GedcomDocument,
  GedcomEvent,
  GedcomEventType,
  GedcomFamily,
  GedcomMediaLink,
  GedcomMediaObject,
  GedcomName,
  GedcomNoteRef,
  GedcomPerson,
  GedcomPlace,
  GedcomSource,
  GedcomAddress,
} from "../gedcom/types";
import { certainlyBefore } from "../dates";
import { PRESUMED_LIFESPAN } from "../consistency";
import { bulkToFuzzy, convertEventDate, convertLifeDates, type BulkDateValue, type DateConversion } from "./dates";

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

type Common = { ref: string; action: "create"; externalKey: string; sourceStamp?: string | null };

export type MappedPerson = Common & {
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  nickname: string | null;
  namePrefix: string | null;
  nameSuffix: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birth: BulkDateValue | null;
  birthPlace: string | null;
  death: BulkDateValue | null;
  deathPlace: string | null;
  deathCause: string | null;
  notes: string | null;
};

export type MappedName = Common & {
  personRef: string;
  type: PersonNameTypeName;
  givenName: string | null;
  familyName: string | null;
  prefix: string | null;
  suffix: string | null;
  nickname: string | null;
  label: string | null;
  notes: string | null;
  sortOrder: number;
};

export type MappedRelationship = Common & {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: "BIOLOGICAL" | "ADOPTIVE" | "STEP" | "FOSTER" | "MARRIED" | "UNMARRIED" | "DIVORCED" | "PARTNER_UNKNOWN";
  fromRef: string;
  toRef: string;
  start: BulkDateValue | null;
  startPlace: string | null;
  end: BulkDateValue | null;
  endPlace: string | null;
  notes: string | null;
};

export type MappedEvent = Common & {
  personRef?: string;
  relationshipRef?: string;
  type: EventTypeName;
  label: string | null;
  isAlternative: boolean;
  date: BulkDateValue | null;
  place: string | null;
  address: string | null;
  value: string | null;
  cause: string | null;
  age: string | null;
  agency: string | null;
  notes: string | null;
  sortOrder: number;
};

export type MappedSource = Common & {
  title: string;
  kind: SourceKindName;
  kindLabel: string | null;
  /** Anbieter (MyHeritage, Ancestry …), lib/source-classify.ts. */
  provider: string | null;
  author: string | null;
  repository: string | null;
  callNumber: string | null;
  url: string | null;
  date: null;
  notes: string | null;
};

export type MappedCitation = Common & {
  sourceRef: string;
  personRef?: string;
  relationshipRef?: string;
  eventRef?: string;
  fact: "NAME" | "BIRTH" | "DEATH" | "PARTNERSHIP" | "PARENTAGE" | "OTHER" | "EVENT";
  detail: string | null;
  /** Internetadresse aus PAGE (nur http/https, geprüft). */
  url: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  text: string | null;
};

export type MappedExternalId = {
  system: string;
  value: string;
  personRef?: string;
  relationshipRef?: string;
  eventRef?: string;
  sourceRef?: string;
};

export type MappedRawRecord = {
  recordType: string;
  xref: string | null;
  content: unknown;
  reason: string;
  personRef?: string;
  relationshipRef?: string;
  sourceRef?: string;
  replace: boolean;
};

/** Personendaten für Abgleich, Vorschläge und Vorschau (ohne Datenbank). */
export type PersonMeta = {
  ref: string;
  xref: string;
  label: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: MappedPerson["gender"];
  birthYear: number | null;
  birthPlace: string | null;
  hasDeath: boolean;
  /** Stabile Kennungen aus der Datei. */
  uid: string | null;
  /** Elternteile (refs) laut Datei. */
  parentRefs: string[];
  privacyMarked: boolean;
};

export type SourceMeta = { ref: string; xref: string; title: string; author: string | null; inline: boolean };

export type PhotoRef = {
  personRef: string;
  /** Stabiler Schlüssel: PHOTO:<_PHOTO_RIN> oder URL:<url>. */
  key: string;
  url: string;
  primary: boolean;
  title: string | null;
};

export type MappingNoteCode =
  | "DATE_LOSSY"
  | "DATE_REJECTED"
  | "NAME_MISSING"
  | "DUPLICATE_KEY"
  | "FAMILY_WITHOUT_PARTNERS"
  | "SINGLE_PARENT_FAMILY_EVENTS"
  | "DUPLICATE_COUPLE"
  | "EVENT_TYPE_ADJUSTED"
  | "LOCAL_MEDIA_PATH"
  | "OTHER_CHILD_KIND";

export type MappingNote = { code: MappingNoteCode; ref?: string; message: string };

export interface MappedImport {
  persons: MappedPerson[];
  names: MappedName[];
  relationships: MappedRelationship[];
  events: MappedEvent[];
  sources: MappedSource[];
  citations: MappedCitation[];
  externalIds: MappedExternalId[];
  rawRecords: MappedRawRecord[];
  personMeta: PersonMeta[];
  sourceMeta: SourceMeta[];
  photos: PhotoRef[];
  notes: MappingNote[];
  /** Eigentümer jedes Untereintrags (Name/Ereignis/Beleg) → Person- bzw. Beziehungs-ref. */
  owners: Record<string, string>;
  counts: { localMediaPaths: number; urlMedia: number };
}

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/** Name für Personen ohne Vornamen (nomen nescio). */
export const UNKNOWN_GIVEN_NAME = "N.N.";

/** recordType der Rohdaten je Träger — Grundlage für das Zurückschreiben beim Export. */
export const RAW_TYPES = {
  person: "GEDCOM_INDI",
  family: "GEDCOM_FAM",
  source: "GEDCOM_SOUR",
  unknown: "GEDCOM_RECORD",
  submitter: "GEDCOM_SUBM",
  note: "GEDCOM_NOTE",
  repository: "GEDCOM_REPO",
  media: "GEDCOM_OBJE",
} as const;
export const RAW_FORMAT = "gedcom-original/1";

const EVENT_TYPE_MAP: Partial<Record<GedcomEventType, EventTypeName>> = {
  BIRTH: "BIRTH",
  CHRISTENING: "CHRISTENING",
  BAPTISM: "BAPTISM",
  DEATH: "DEATH",
  BURIAL: "BURIAL",
  CREMATION: "CREMATION",
  ADOPTION: "ADOPTION",
  ADULT_CHRISTENING: "ADULT_CHRISTENING",
  BAR_MITZVAH: "BAR_MITZVAH",
  BAS_MITZVAH: "BAS_MITZVAH",
  BLESSING: "BLESSING",
  CONFIRMATION: "CONFIRMATION",
  FIRST_COMMUNION: "FIRST_COMMUNION",
  ORDINATION: "ORDINATION",
  NATURALIZATION: "NATURALIZATION",
  EMIGRATION: "EMIGRATION",
  IMMIGRATION: "IMMIGRATION",
  CENSUS: "CENSUS",
  PROBATE: "PROBATE",
  WILL: "WILL",
  GRADUATION: "GRADUATION",
  RETIREMENT: "RETIREMENT",
  CASTE: "CASTE",
  PHYSICAL_DESCRIPTION: "PHYSICAL_DESCRIPTION",
  EDUCATION: "EDUCATION",
  ID_NUMBER: "ID_NUMBER",
  NATIONALITY: "NATIONALITY",
  CHILDREN_COUNT: "CHILDREN_COUNT",
  MARRIAGE_COUNT: "MARRIAGE_COUNT",
  OCCUPATION: "OCCUPATION",
  PROPERTY: "PROPERTY",
  RELIGION: "RELIGION",
  RESIDENCE: "RESIDENCE",
  SOCIAL_SECURITY_NUMBER: "ID_NUMBER",
  NOBILITY_TITLE: "TITLE",
  ANNULMENT: "ANNULMENT",
  DIVORCE: "DIVORCE",
  DIVORCE_FILED: "DIVORCE_FILED",
  ENGAGEMENT: "ENGAGEMENT",
  MARRIAGE_BANN: "MARRIAGE_BANNS",
  MARRIAGE_CONTRACT: "MARRIAGE_CONTRACT",
  MARRIAGE: "MARRIAGE",
  MARRIAGE_LICENSE: "MARRIAGE_LICENSE",
  MARRIAGE_SETTLEMENT: "MARRIAGE_SETTLEMENT",
  CUSTOM_EVENT: "CUSTOM",
  CUSTOM_ATTRIBUTE: "CUSTOM",
};

const GERMAN_TYPE: Partial<Record<GedcomEventType, string>> = {
  SOCIAL_SECURITY_NUMBER: "Sozialversicherungsnummer",
  CHILDREN_COUNT: "Zahl der Kinder",
};

/** EVEN-Angabe eines allgemeinen Belegs → Fakt. */
const PERSON_EVENT_FACT: Record<string, MappedCitation["fact"]> = { BIRT: "BIRTH", CHR: "BIRTH", BAPM: "BIRTH", DEAT: "DEATH", BURI: "DEATH", CREM: "DEATH", NAME: "NAME" };
const FAMILY_EVENT_FACT: Record<string, MappedCitation["fact"]> = { MARR: "PARTNERSHIP", MARB: "PARTNERSHIP", ENGA: "PARTNERSHIP", DIV: "PARTNERSHIP" };

const SOURCE_KIND_PATTERNS: [RegExp, SourceKindName][] = [
  [/kirch|church|pfarr|parish|tauf|bapt/i, "CHURCH_BOOK"],
  [/standesamt|civil|vital|personenstand|registry|register/i, "CIVIL_REGISTRY"],
  [/census|volksz|zensus|einwohner/i, "CENSUS"],
  [/grab|grave|cemetery|friedhof|tomb/i, "GRAVESTONE"],
  [/web|online|internet|site/i, "WEBSITE"],
  [/mündlich|oral|interview|erzähl/i, "ORAL"],
  [/famili|brief|letter|bibel|bible|tagebuch|diary/i, "FAMILY_DOCUMENT"],
];

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const clean = (s: string | undefined | null, max = 2000): string | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
};

/**
 * Ortstext beim Import. Der eigene GEDCOM-Export schreibt für zugeordnete
 * Orte die heutige Form in PLAC und den Freitext der App als NOTE
 * „Originaltext: …“ darunter (lib/services/place-export.ts) — dieser geht
 * vor, damit der Wiederimport der eigenen Datei nichts als geändert meldet.
 */
export function originalPlaceText(p: GedcomPlace | undefined): string | null {
  if (!p) return null;
  for (const n of p.notes ?? []) {
    const t = n.content?.text?.trim();
    if (t?.startsWith(ORIGINAL_PLACE_PREFIX)) return clean(t.slice(ORIGINAL_PLACE_PREFIX.length));
  }
  return clean(p.name);
}
const ORIGINAL_PLACE_PREFIX = "Originaltext: ";

/** JSON-sauber (undefined in Listen → null), wie es in der Datenbank landet. */
export const jsonClean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

function idOf(list: { type: string; value: string }[], type: string): string | null {
  const v = list.find((x) => x.type === type)?.value?.trim();
  return v ? v : null;
}

function addressText(a: GedcomAddress | undefined): string | null {
  if (!a) return null;
  const lines: string[] = [];
  if (a.text) lines.push(...a.text.split(/\r?\n/));
  else if (a.lines?.length) lines.push(...a.lines);
  const cityLine = [a.postalCode, a.city].filter(Boolean).join(" ");
  if (cityLine && !lines.some((l) => l.includes(cityLine))) lines.push(cityLine);
  for (const x of [a.state, a.country]) if (x && !lines.some((l) => l.includes(x))) lines.push(x);
  return clean(lines.map((l) => l.trim()).filter(Boolean).join("\n"));
}

/** Hauptangabe einer Art: bevorzugte (_PRIM Y), sonst die erste. */
export function pickMain<T extends { type: string; preferred?: boolean }>(events: T[], type: string): T | undefined {
  const list = events.filter((e) => e.type === type);
  return list.find((e) => e.preferred) ?? list[0];
}

/** Hauptname: bevorzugter (_PRIM Y), sonst der erste. */
export function pickPrimaryName(names: GedcomName[]): GedcomName | undefined {
  return names.find((n) => n.preferred) ?? names[0];
}

/** Nachname samt Namenszusatz (SPFX „von“), ohne ihn zu verdoppeln. */
function fullSurname(n: GedcomName | undefined): string | null {
  if (!n) return null;
  const sur = n.surname?.trim() ?? "";
  const pre = n.surnamePrefix?.trim() ?? "";
  if (pre && sur && !sur.toLowerCase().startsWith(pre.toLowerCase())) return clean(`${pre} ${sur}`, 200);
  return clean(sur || pre, 200);
}

/**
 * Namen nach App-Konvention: `familyName` ist der heutige Name (bei
 * MyHeritage `_MARNM`, sonst ein NAME mit TYPE married), `birthName` der
 * Geburtsname — nur gesetzt, wenn er vom heutigen abweicht.
 */
export function resolveNames(names: GedcomName[]): {
  primary: GedcomName | undefined;
  givenName: string;
  givenMissing: boolean;
  familyName: string | null;
  birthName: string | null;
  /** Der als heutiger Name verwendete NAME-Eintrag (wird keine eigene Variante). */
  usedMarriedName: GedcomName | undefined;
  /** Index des als heutiger Name verwendeten _MARNM (0) oder -1. */
  usedMarnmIndex: number;
} {
  const primary = pickPrimaryName(names);
  const given = clean(primary?.given, 200) ?? clean(primary && !primary.surname ? primary.full : null, 200);
  let familyName: string | null;
  let birthName: string | null = null;
  let usedMarriedName: GedcomName | undefined;
  let usedMarnmIndex = -1;
  if (primary?.type === "MARRIED") {
    familyName = fullSurname(primary);
    const birth = names.find((n) => n !== primary && (n.type === "BIRTH" || n.type === "MAIDEN"));
    birthName = fullSurname(birth);
  } else {
    const birthSurname = fullSurname(primary);
    const marnm = clean(primary?.marriedSurnames[0], 200);
    if (marnm) {
      familyName = marnm;
      usedMarnmIndex = 0;
    } else {
      usedMarriedName = names.find((n) => n !== primary && n.type === "MARRIED" && fullSurname(n));
      familyName = usedMarriedName ? fullSurname(usedMarriedName) : birthSurname;
    }
    birthName = familyName !== birthSurname ? birthSurname : null;
  }
  if (birthName && birthName === familyName) birthName = null;
  return {
    primary,
    givenName: given ?? UNKNOWN_GIVEN_NAME,
    givenMissing: !given,
    familyName,
    birthName,
    usedMarriedName,
    usedMarnmIndex,
  };
}

const NAME_TYPE: Record<string, PersonNameTypeName> = {
  BIRTH: "BIRTH",
  MAIDEN: "BIRTH",
  MARRIED: "MARRIED",
  AKA: "ALIAS",
  NICKNAME: "ALIAS",
  IMMIGRANT: "IMMIGRANT",
  RELIGIOUS: "RELIGIOUS",
  PROFESSIONAL: "OTHER",
  OTHER: "OTHER",
};

function splitNameText(s: string): { given: string | null; surname: string | null } {
  const m = s.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
  if (m) return { given: clean(m[1], 200), surname: clean(m[2], 200) };
  return { given: clean(s, 200), surname: null };
}

export function sourceKind(type: string | undefined, title: string | undefined): { kind: SourceKindName; kindLabel: string | null } {
  const label = clean(type, 200);
  for (const [re, kind] of SOURCE_KIND_PATTERNS) {
    if (label && re.test(label)) return { kind, kindLabel: null };
  }
  if (!label && title) {
    for (const [re, kind] of SOURCE_KIND_PATTERNS.slice(0, 4)) if (re.test(title)) return { kind, kindLabel: null };
  }
  return { kind: "OTHER", kindLabel: label };
}

// ---------------------------------------------------------------------------
// Schlüssel
// ---------------------------------------------------------------------------

/** Schlüssel einer Person: _UID, sonst RIN, sonst Xref. */
export function personKey(p: { id: string; externalIds: { type: string; value: string }[] }): string {
  const uid = idOf(p.externalIds, "UID");
  if (uid) return `UID:${uid.toUpperCase()}`;
  const rin = idOf(p.externalIds, "RIN");
  if (rin) return `RIN:${rin}`;
  return `XREF:${p.id}`;
}

export const pairKey = (a: string, b: string) => `PAIR:${[a, b].sort().join("|")}`;
export const parentKey = (parent: string, child: string) => `PARENT:${parent}>${child}`;

/**
 * Schlüssel der Ereignisse eines Trägers in Dateireihenfolge: eigene _UID,
 * sonst `<Träger>/<Art>#<n>` (n = laufende Nummer je Art beim Träger).
 */
export function eventKeys(events: GedcomEvent[], ownerKey: string, taken?: Set<string>): string[] {
  const count = new Map<string, number>();
  return events.map((e) => {
    const n = (count.get(e.type) ?? 0) + 1;
    count.set(e.type, n);
    const uid = idOf(e.externalIds, "UID");
    const byUid = uid ? `UID:${uid.toUpperCase()}` : null;
    if (byUid && !taken?.has(byUid)) {
      taken?.add(byUid);
      return byUid;
    }
    const key = `${ownerKey}/${e.type}#${n}`;
    taken?.add(key);
    return key;
  });
}

// ---------------------------------------------------------------------------
// Abbildung
// ---------------------------------------------------------------------------

export type MapOptions = { now?: Date };

export function mapGedcomDocument(doc: GedcomDocument, options: MapOptions = {}): MappedImport {
  const now = options.now ?? new Date();
  const out: MappedImport = {
    persons: [],
    names: [],
    relationships: [],
    events: [],
    sources: [],
    citations: [],
    externalIds: [],
    rawRecords: [],
    personMeta: [],
    sourceMeta: [],
    photos: [],
    notes: [],
    owners: {},
    counts: { localMediaPaths: 0, urlMedia: 0 },
  };
  const notesById = new Map(doc.notes.map((n) => [n.id, n]));
  const mediaById = new Map(doc.media.filter((m) => m.id).map((m) => [m.id!, m]));
  const reposById = new Map(doc.repositories.map((r) => [r.id, r]));
  const usedNotes = new Set<string>();
  const usedMedia = new Set<string>();
  const usedRepos = new Set<string>();
  const takenKeys = new Set<string>();
  const note = (code: MappingNoteCode, message: string, ref?: string) => out.notes.push({ code, message, ...(ref ? { ref } : {}) });

  const noteText = (refs: GedcomNoteRef[]): string | null => {
    const parts: string[] = [];
    for (const r of refs) {
      if (r.noteId) {
        usedNotes.add(r.noteId);
        const n = notesById.get(r.noteId);
        if (n?.content.text) parts.push(n.content.text);
      } else if (r.content?.text) parts.push(r.content.text);
    }
    return clean(parts.join("\n\n"), 50000);
  };

  const dateNote = (c: DateConversion, ref: string, what: string) => {
    if (c.rejected) note("DATE_REJECTED", `${what}: ${c.rejected} — nur als Wortlaut übernommen`, ref);
    else if (c.lossy && c.value) note("DATE_LOSSY", `${what}: Originalangabe als Wortlaut erhalten`, ref);
  };

  // --- Quellen ------------------------------------------------------------------
  // Fundstellen der Belege je Quelle (Beispiele) — verraten oft den Anbieter.
  const pagesBySource = new Map<string, string[]>();
  const collectPages = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== "object" || depth > 12) return;
    if (Array.isArray(v)) return v.forEach((x) => collectPages(x, depth + 1));
    const o = v as Record<string, unknown>;
    if (typeof o.sourceId === "string" && typeof o.page === "string") {
      const list = pagesBySource.get(o.sourceId) ?? [];
      if (list.length < 20) list.push(o.page);
      pagesBySource.set(o.sourceId, list);
    }
    for (const x of Object.values(o)) if (x && typeof x === "object") collectPages(x, depth + 1);
  };
  collectPages([doc.persons, doc.families]);
  /** Quellen ohne unabhängigen Beweiswert (Online-Stammbäume), je ref. */
  const derivedSource = new Set<string>();
  const sourceRefById = new Map<string, string>();
  const sourceKeyTaken = new Set<string>();
  for (const s of doc.sources) {
    let key = `XREF:${s.id}`;
    if (sourceKeyTaken.has(key)) key = `XREF:${s.id}#${sha(JSON.stringify(s.title ?? ""))}`;
    sourceKeyTaken.add(key);
    sourceRefById.set(s.id, key);
    out.sources.push(mapSource(s, key));
    if (DERIVED_SOURCE_KINDS.includes(out.sources[out.sources.length - 1].kind)) derivedSource.add(key);
    out.sourceMeta.push({ ref: key, xref: s.id, title: out.sources[out.sources.length - 1].title, author: clean(s.author), inline: false });
    for (const x of s.externalIds) {
      if (x.value?.trim()) out.externalIds.push({ system: x.type, value: x.value.trim().slice(0, 500), sourceRef: key });
    }
    const repos = s.repositories.map((r) => r.repositoryId).filter((x): x is string => Boolean(x));
    repos.forEach((r) => usedRepos.add(r));
    for (const n of s.notes) if (n.noteId) usedNotes.add(n.noteId);
    out.rawRecords.push({
      recordType: RAW_TYPES.source,
      xref: s.id,
      sourceRef: key,
      replace: true,
      reason: "Originaldatensatz der Quelle (GEDCOM) — Grundlage für den Export",
      content: jsonClean({
        format: RAW_FORMAT,
        record: s,
        repositories: repos.map((id) => reposById.get(id)).filter(Boolean),
        notes: s.notes.map((n) => (n.noteId ? notesById.get(n.noteId) : null)).filter(Boolean),
      }),
    });
  }

  function mapSource(s: GedcomSource, key: string): MappedSource {
    const repoRef = s.repositories[0];
    const repoName = repoRef?.repositoryId ? reposById.get(repoRef.repositoryId)?.name : repoRef?.name;
    const cls = classifySource({
      title: s.title,
      type: s.sourceType,
      medium: s.medium,
      author: s.author,
      publication: s.publication,
      repository: repoName,
      text: [s.text, noteText(s.notes)].filter(Boolean).join("\n"),
      urls: s.urls,
      citationPages: pagesBySource.get(s.id),
    });
    // Allgemeine Muster (sourceKind) nur, wenn die Einordnung nichts Besseres weiß
    const fallback = sourceKind(plainText(s.sourceType) ?? undefined, plainText(s.title) ?? undefined);
    const kind = cls.kind === "OTHER" ? fallback.kind : cls.kind;
    const kindLabel = cls.kind === "OTHER" ? fallback.kindLabel : cls.kindLabel;
    const notesText = [plainText(clean(s.text, 50000)), plainText(noteText(s.notes)), s.publication ? `Veröffentlichung: ${plainText(s.publication)}` : null]
      .filter(Boolean)
      .join("\n\n");
    return {
      ref: key,
      action: "create",
      externalKey: key,
      sourceStamp: clean(s.updated ?? s.changed, 200),
      title: clean(plainText(s.title), 300) ?? clean(plainText(s.abbreviation), 300) ?? `Quelle ${s.id}`,
      kind,
      kindLabel,
      provider: cls.provider,
      author: clean(plainText(s.author)),
      repository: clean(repoName),
      callNumber: clean(repoRef?.callNumbers[0]),
      url: safeHttpUrl(s.urls.find((u) => /^https?:\/\/\S+$/i.test(u.trim()))?.trim()) ?? safeHttpUrl(cls.url),
      date: null,
      notes: clean(notesText, 50000),
    };
  }

  /** Eingebettete Quelle (5.5.1 „1 SOUR Text“) → eigene Quelle je Text. */
  const inlineSource = (text: string): string => {
    const key = `INLINE:${sha(text)}`;
    if (!sourceRefById.has(key)) {
      sourceRefById.set(key, key);
      out.sources.push({
        ref: key,
        action: "create",
        externalKey: key,
        sourceStamp: null,
        title: clean(text.split(/\r?\n/)[0], 300) ?? "Eingebettete Quelle",
        kind: "OTHER",
        kindLabel: null,
        provider: null,
        author: null,
        repository: null,
        callNumber: null,
        url: null,
        date: null,
        notes: text.length > 300 || text.includes("\n") ? clean(text, 50000) : null,
      });
      out.sourceMeta.push({ ref: key, xref: "", title: clean(text, 300) ?? "Eingebettete Quelle", author: null, inline: true });
    }
    return key;
  };

  const citations = (
    list: GedcomCitation[],
    ownerKey: string,
    target: { personRef?: string; relationshipRef?: string; eventRef?: string },
    fact: MappedCitation["fact"],
    ownerRef: string,
  ) => {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      const sourceRef = c.sourceId ? sourceRefById.get(c.sourceId) : c.inlineText?.trim() ? inlineSource(c.inlineText.trim()) : undefined;
      if (!sourceRef) return; // verwaister Verweis: steht im Originaldatensatz (Rohdaten)
      const key = `${ownerKey}/SOUR#${i + 1}`;
      const text = [...c.texts.map((t) => plainText(t.trim())).filter(Boolean), plainText(noteText(c.notes))].filter(Boolean).join("\n\n");
      const page = splitCitationPage(c.page);
      const url = safeHttpUrl(page.url);
      // Allgemeiner Beleg, der sein Ereignis nennt (EVEN BIRT …): diesem Fakt zuordnen.
      const named = fact === "OTHER" && c.eventType ? (target.relationshipRef ? FAMILY_EVENT_FACT : PERSON_EVENT_FACT)[c.eventType.trim().toUpperCase()] : undefined;
      const f = named ?? fact;
      // Derselbe Beleg zweimal am selben Träger (kommt in Exporten vor): einmal.
      const dedupe = JSON.stringify([sourceRef, f, page.detail, url, text]);
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      out.citations.push({
        ref: key,
        action: "create",
        externalKey: key,
        sourceRef,
        ...target,
        fact: f,
        detail: clean(page.detail ?? (url ? null : c.page)),
        url,
        // Stammbäume anderer Nutzer: die Verlässlichkeit der Datei (MyHeritage
        // schreibt QUAY 3 an automatische Treffer) wird nicht übernommen.
        confidence: derivedSource.has(sourceRef) ? null : (c.confidence ?? null),
        text: clean(text, 20000),
      });
      out.owners[key] = ownerRef;
    });
  };

  // --- Personen -----------------------------------------------------------------
  const refById = new Map<string, string>();
  for (const p of doc.persons) {
    let key = personKey(p);
    if (takenKeys.has(key)) {
      note("DUPLICATE_KEY", `Kennung ${key} doppelt — Person @${p.id}@ wird über ihre Xref zugeordnet`, key);
      key = `XREF:${p.id}`;
    }
    takenKeys.add(key);
    refById.set(p.id, key);
  }

  const derived = deriveRelationships(doc);
  const parentRefsOf = new Map<string, string[]>();
  for (const pc of derived.parentChild) {
    const pr = refById.get(pc.parentId);
    const cr = refById.get(pc.childId);
    if (!pr || !cr) continue;
    const list = parentRefsOf.get(cr) ?? [];
    if (!list.includes(pr)) list.push(pr);
    parentRefsOf.set(cr, list);
  }

  for (const p of doc.persons) {
    const key = refById.get(p.id)!;
    const names = resolveNames(p.names);
    if (names.givenMissing) note("NAME_MISSING", `Person @${p.id}@ ohne Vornamen — als „${UNKNOWN_GIVEN_NAME}“ übernommen`, key);
    const mainBirth = pickMain(p.events, "BIRTH");
    const mainDeath = pickMain(p.events, "DEATH");
    const life = convertLifeDates(mainBirth?.date, mainDeath?.date, now);
    dateNote(life.birth, key, `Geburt @${p.id}@`);
    dateNote(life.death, key, `Tod @${p.id}@`);
    const primary = names.primary;
    const person: MappedPerson = {
      ref: key,
      action: "create",
      externalKey: key,
      sourceStamp: clean(p.updated ?? p.changed, 200),
      givenName: names.givenName,
      familyName: names.familyName,
      birthName: names.birthName,
      nickname: clean(primary?.nickname ?? primary?.callName, 200),
      namePrefix: clean(primary?.prefix, 200),
      nameSuffix: clean(primary?.suffix, 200),
      gender: p.sex,
      birth: life.birth.value,
      birthPlace: originalPlaceText(mainBirth?.place),
      death: life.death.value,
      deathPlace: originalPlaceText(mainDeath?.place),
      deathCause: clean(mainDeath?.cause),
      notes: noteText(p.notes),
    };
    out.persons.push(person);
    const birthYear = person.birth?.date ? Number(person.birth.date.slice(0, 4)) : null;
    const privacyMarked = p.privacy.restrictions.length > 0 || p.privacy.livingMarked || p.privacy.placeholderName;
    out.personMeta.push({
      ref: key,
      xref: p.id,
      label: [person.givenName, person.familyName].filter(Boolean).join(" ") + (birthYear ? ` (*${birthYear})` : ""),
      givenName: person.givenName,
      familyName: person.familyName,
      birthName: person.birthName,
      gender: person.gender,
      birthYear,
      birthPlace: person.birthPlace,
      hasDeath: Boolean(mainDeath),
      uid: idOf(p.externalIds, "UID"),
      parentRefs: parentRefsOf.get(key) ?? [],
      privacyMarked,
    });

    // Fremdkennungen
    for (const x of p.externalIds) {
      if (x.value?.trim()) out.externalIds.push({ system: x.type, value: x.value.trim().slice(0, 500), personRef: key });
    }

    // Weitere Namen
    let sort = 0;
    const addName = (n: Omit<MappedName, "ref" | "action" | "externalKey" | "personRef" | "sortOrder">, k: string) => {
      if (!n.givenName && !n.familyName && !n.nickname) return;
      out.names.push({ ref: k, action: "create", externalKey: k, personRef: key, sortOrder: sort++, ...n });
      out.owners[k] = key;
    };
    p.names.forEach((n, i) => {
      const nk = `${key}/NAME#${i + 1}`;
      if (n !== primary && n !== names.usedMarriedName) {
        addName(
          {
            type: n.type ? NAME_TYPE[n.type] ?? "OTHER" : "VARIANT",
            givenName: clean(n.given ?? (n.surname ? null : n.full), 200),
            familyName: fullSurname(n),
            prefix: clean(n.prefix, 200),
            suffix: clean(n.suffix, 200),
            nickname: clean(n.nickname ?? n.callName, 200),
            label: n.type === "OTHER" || n.type === "PROFESSIONAL" || n.type === "NICKNAME" ? clean(n.typeLabel, 200) : null,
            notes: noteText(n.notes),
          },
          nk,
        );
      }
      n.marriedSurnames.forEach((m, j) => {
        if (n === primary && j === names.usedMarnmIndex) return;
        addName(
          {
            type: "MARRIED",
            givenName: clean(n.given, 200),
            familyName: clean(m, 200),
            prefix: null,
            suffix: null,
            nickname: null,
            label: null,
            notes: null,
          },
          `${nk}/MARNM#${j + 1}`,
        );
      });
      n.aliases.forEach((a, j) => {
        const parts = splitNameText(a);
        addName(
          { type: "ALIAS", givenName: parts.given, familyName: parts.surname, prefix: null, suffix: null, nickname: null, label: null, notes: null },
          `${nk}/AKA#${j + 1}`,
        );
      });
      n.variants.forEach((v, j) => {
        const parts = splitNameText(v.value);
        addName(
          {
            type: "VARIANT",
            givenName: parts.given,
            familyName: parts.surname,
            prefix: null,
            suffix: null,
            nickname: null,
            label: clean(`${v.kind === "phonetic" ? "phonetisch" : "romanisiert"}${v.method ? ` (${v.method})` : ""}`, 200),
            notes: null,
          },
          `${nk}/${v.kind === "phonetic" ? "FONE" : "ROMN"}#${j + 1}`,
        );
      });
      citations(n.citations, nk, { personRef: key }, "NAME", key);
    });

    // Ereignisse
    const keys = eventKeys(p.events, key, takenKeys);
    p.events.forEach((e, i) => {
      const ek = keys[i];
      if (e === mainBirth || e === mainDeath) {
        citations(e.citations, ek, { personRef: key }, e === mainBirth ? "BIRTH" : "DEATH", key);
        for (const n of e.notes) if (n.noteId) usedNotes.add(n.noteId);
        return;
      }
      mapEvent(e, ek, { personRef: key }, false, i);
    });

    citations(p.citations, key, { personRef: key }, "OTHER", key);

    // Fotos
    collectMedia(p.media, key);

    // Originaldatensatz
    out.rawRecords.push({
      recordType: RAW_TYPES.person,
      xref: p.id,
      personRef: key,
      replace: true,
      reason: "Originaldatensatz der Person (GEDCOM) — Grundlage für den Export",
      content: jsonClean({ format: RAW_FORMAT, record: p, ...referenced(p) }),
    });
  }

  function referenced(rec: unknown): { notes: unknown[]; media: GedcomMediaObject[] } {
    const noteIds = new Set<string>();
    const mediaIds = new Set<string>();
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(walk);
      const o = v as Record<string, unknown>;
      if (typeof o.noteId === "string") noteIds.add(o.noteId);
      if (typeof o.mediaId === "string") mediaIds.add(o.mediaId);
      for (const [k, x] of Object.entries(o)) if (k !== "extensions") walk(x);
    };
    walk(rec);
    noteIds.forEach((id) => usedNotes.add(id));
    mediaIds.forEach((id) => usedMedia.add(id));
    return {
      notes: [...noteIds].map((id) => notesById.get(id)).filter(Boolean),
      media: [...mediaIds].map((id) => mediaById.get(id)).filter((m): m is GedcomMediaObject => Boolean(m)),
    };
  }

  function collectMedia(links: GedcomMediaLink[], personRef: string) {
    for (const l of links) {
      const obj = l.inline ?? (l.mediaId ? mediaById.get(l.mediaId) : undefined);
      if (!obj) continue;
      for (const f of obj.files) {
        if (!f.isUrl) {
          out.counts.localMediaPaths++;
          continue;
        }
        const url = f.location.trim();
        if (!/^https?:\/\//i.test(url)) continue;
        out.counts.urlMedia++;
        const rin = idOf(obj.externalIds, "PHOTO_RIN");
        out.photos.push({
          personRef,
          key: rin ? `PHOTO:${rin}` : `URL:${url}`,
          url,
          primary: l.primary,
          title: clean(l.title ?? obj.title ?? f.title, 500),
        });
      }
    }
  }

  function mapEvent(
    e: GedcomEvent,
    ek: string,
    owner: { personRef?: string; relationshipRef?: string },
    isFamily: boolean,
    index: number,
    alternative = false,
  ) {
    let type = EVENT_TYPE_MAP[e.type] ?? "CUSTOM";
    let label = clean(e.label, 200);
    const ownerRef = owner.personRef ?? owner.relationshipRef!;
    if (type === "CUSTOM" && label && /^(military|militär|_milt)/i.test(label)) type = "MILITARY_SERVICE";
    if (e.type === "SOCIAL_SECURITY_NUMBER" && !label) label = GERMAN_TYPE.SOCIAL_SECURITY_NUMBER!;
    // Art passt nicht zum Träger → frei benanntes Ereignis
    // Dieselbe Regel wie in der App (FAM = Partnerschaft, INDI = Person).
    const allowed = eventTypeAllowed(type, isFamily ? { kind: "relationship", type: "PARTNER_OF" } : { kind: "person" });
    if (!allowed) {
      note("EVENT_TYPE_ADJUSTED", `Ereignis ${e.type} passt nicht an ${isFamily ? "eine Partnerschaft" : "eine Person"} — als sonstiges Ereignis übernommen`, ek);
      label = label ?? GERMAN_TYPE[e.type] ?? e.type;
      type = "CUSTOM";
    }
    if (type === "CUSTOM" && !label) label = e.type === "CUSTOM_ATTRIBUTE" ? "Merkmal" : "Ereignis";
    const isAlt = alternative || ["BIRTH", "DEATH", "MARRIAGE", "DIVORCE"].includes(type);
    const date = convertEventDate(e.date, now);
    dateNote(date, ek, `Ereignis ${e.type}`);
    const value = e.value && e.value.trim().toUpperCase() !== "Y" ? clean(e.value) : null;
    out.events.push({
      ref: ek,
      action: "create",
      externalKey: ek,
      sourceStamp: clean(e.updated ?? e.changed, 200),
      ...owner,
      type,
      label,
      isAlternative: isAlt,
      date: date.value,
      place: originalPlaceText(e.place),
      address: addressText(e.address),
      value,
      cause: clean(e.cause),
      age: clean(e.age, 60),
      agency: clean(e.agency),
      notes: noteText(e.notes),
      sortOrder: index,
    });
    out.owners[ek] = ownerRef;
    for (const x of e.externalIds) {
      if (x.value?.trim()) out.externalIds.push({ system: x.type, value: x.value.trim().slice(0, 500), eventRef: ek });
    }
    citations(e.citations, ek, { eventRef: ek }, "EVENT", ownerRef);
  }

  // --- Familien -------------------------------------------------------------------
  const famById = new Map(doc.families.map((f) => [f.id, f]));
  const pairSeen = new Map<string, string>();
  for (const pship of derived.partnerships) {
    const f = famById.get(pship.familyId)!;
    const a = refById.get(pship.personIds[0]);
    const b = refById.get(pship.personIds[1]);
    if (!a || !b || a === b) {
      out.rawRecords.push(familyRaw(f, {}));
      continue;
    }
    const key = pairKey(a, b);
    const famKey = f.externalIds.length ? personKey(f) : `XREF:${f.id}`;
    if (pairSeen.has(key)) {
      // Dasselbe Paar in einer zweiten Familie: Ereignisse als weitere bzw.
      // abweichende Angaben an derselben Partnerschaft.
      note("DUPLICATE_COUPLE", `Familie @${f.id}@ beschreibt dasselbe Paar wie @${pairSeen.get(key)}@ — Ereignisse werden ergänzt`, key);
      const keys = eventKeys(f.events, `${key}/${famKey}`, takenKeys);
      f.events.forEach((e, i) => mapEvent(e, keys[i], { relationshipRef: key }, true, i, ["MARRIAGE", "DIVORCE"].includes(e.type)));
      citations(f.citations, `${key}/${famKey}`, { relationshipRef: key }, "OTHER", key);
      out.rawRecords.push(familyRaw(f, { relationshipRef: key }));
      continue;
    }
    pairSeen.set(key, f.id);
    const marr = pickMain(f.events, "MARRIAGE");
    const div = pickMain(f.events, "DIVORCE");
    const start = convertEventDate(marr?.date, now);
    let end = convertEventDate(div?.date, now);
    dateNote(start, key, `Heirat @${f.id}@`);
    dateNote(end, key, `Scheidung @${f.id}@`);
    // Ende vor Beginn → Ende nur als Wortlaut
    const sf = bulkToFuzzy(start.value);
    const ef = bulkToFuzzy(end.value);
    if (sf && ef && div?.date && certainlyBefore(ef, sf)) {
      end = { value: { phrase: div.date.original }, lossy: true, rejected: "Ende liegt vor dem Beginn" };
      dateNote(end, key, `Scheidung @${f.id}@`);
    }
    const subtype =
      pship.status === "MARRIED" ? "MARRIED" : pship.status === "DIVORCED" ? "DIVORCED" : pship.status === "UNMARRIED" ? "UNMARRIED" : "PARTNER_UNKNOWN";
    out.relationships.push({
      ref: key,
      action: "create",
      externalKey: key,
      sourceStamp: clean(f.updated ?? f.changed, 200),
      type: "PARTNER_OF",
      subtype,
      fromRef: a,
      toRef: b,
      start: start.value,
      startPlace: originalPlaceText(marr?.place),
      end: end.value,
      endPlace: originalPlaceText(div?.place),
      notes: noteText(f.notes),
    });
    for (const x of f.externalIds) {
      if (x.value?.trim()) out.externalIds.push({ system: x.type, value: x.value.trim().slice(0, 500), relationshipRef: key });
    }
    const keys = eventKeys(f.events, key, takenKeys);
    f.events.forEach((e, i) => {
      if (e === marr || e === div) {
        citations(e.citations, keys[i], { relationshipRef: key }, "PARTNERSHIP", key);
        return;
      }
      mapEvent(e, keys[i], { relationshipRef: key }, true, i);
    });
    citations(f.citations, key, { relationshipRef: key }, "OTHER", key);
    out.rawRecords.push(familyRaw(f, { relationshipRef: key }));
  }
  for (const famId of derived.singleParentFamilies) {
    const f = famById.get(famId)!;
    const parentRef = refById.get(f.partners[0]);
    if (f.events.length) note("SINGLE_PARENT_FAMILY_EVENTS", `Familie @${f.id}@ mit einem Elternteil: ${f.events.length === 1 ? "1 Familienereignis" : `${f.events.length} Familienereignisse`} nur in den Rohdaten`, parentRef);
    out.rawRecords.push(familyRaw(f, parentRef ? { personRef: parentRef } : {}));
  }
  for (const f of doc.families) {
    if (f.partners.length === 0) {
      note("FAMILY_WITHOUT_PARTNERS", `Familie @${f.id}@ ohne Partner — Kinder ohne Elternverbindung, Daten in den Rohdaten`);
      out.rawRecords.push(familyRaw(f, {}));
    }
  }

  function familyRaw(f: GedcomFamily, carrier: { personRef?: string; relationshipRef?: string }): MappedRawRecord {
    // Quellen, auf die die Familie verweist (Xref → ref): wird die Beziehung
    // beim Import abgelehnt, hält applyGenealogyImport damit fest, welche
    // App-Quelle gemeint ist — der Export braucht das für die Belege.
    const sourceRefs: Record<string, string> = {};
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(walk);
      const o = v as Record<string, unknown>;
      if (typeof o.sourceId === "string" && sourceRefById.has(o.sourceId)) sourceRefs[o.sourceId] = sourceRefById.get(o.sourceId)!;
      Object.values(o).forEach(walk);
    };
    if (carrier.relationshipRef) walk(f);
    return {
      recordType: RAW_TYPES.family,
      xref: f.id,
      ...carrier,
      replace: true,
      reason: "Originaldatensatz der Familie (GEDCOM) — Grundlage für den Export",
      content: jsonClean({ format: RAW_FORMAT, record: f, ...referenced(f), ...(Object.keys(sourceRefs).length ? { sourceRefs } : {}) }),
    };
  }

  // Eltern-Kind (je Paar Elternteil→Kind nur einmal)
  const SUBTYPE: Record<GedcomChildKind, MappedRelationship["subtype"]> = {
    BIOLOGICAL: "BIOLOGICAL",
    ADOPTIVE: "ADOPTIVE",
    FOSTER: "FOSTER",
    STEP: "STEP",
    OTHER: "BIOLOGICAL",
  };
  const seenParent = new Set<string>();
  for (const pc of derived.parentChild) {
    const pr = refById.get(pc.parentId);
    const cr = refById.get(pc.childId);
    if (!pr || !cr || pr === cr) continue;
    const key = parentKey(pr, cr);
    if (seenParent.has(key)) continue;
    seenParent.add(key);
    if (pc.kind === "OTHER") note("OTHER_CHILD_KIND", `Eltern-Kind-Art „${pc.kindLabel ?? "?"}“ (@${pc.familyId}@) als leiblich übernommen; Original in den Rohdaten`, key);
    out.relationships.push({
      ref: key,
      action: "create",
      externalKey: key,
      sourceStamp: null,
      type: "PARENT_OF",
      subtype: SUBTYPE[pc.kind],
      fromRef: pr,
      toRef: cr,
      start: null,
      startPlace: null,
      end: null,
      endPlace: null,
      notes: null,
    });
  }

  // --- Rest ohne Träger -------------------------------------------------------------
  for (const r of doc.unknownRecords) {
    out.rawRecords.push({ recordType: RAW_TYPES.unknown, xref: r.xref ?? null, content: jsonClean({ format: RAW_FORMAT, node: r }), reason: `Unbekannte Datensatzart ${r.tag}`, replace: false });
  }
  for (const s of doc.submitters) {
    out.rawRecords.push({ recordType: RAW_TYPES.submitter, xref: s.id, content: jsonClean({ format: RAW_FORMAT, record: s }), reason: "Einsender (SUBM)", replace: false });
  }
  for (const n of doc.notes) {
    if (!usedNotes.has(n.id)) out.rawRecords.push({ recordType: RAW_TYPES.note, xref: n.id, content: jsonClean({ format: RAW_FORMAT, record: n }), reason: "Notiz ohne Verweis", replace: false });
  }
  for (const r of doc.repositories) {
    if (!usedRepos.has(r.id)) out.rawRecords.push({ recordType: RAW_TYPES.repository, xref: r.id, content: jsonClean({ format: RAW_FORMAT, record: r }), reason: "Archiv ohne Verweis", replace: false });
  }
  for (const m of doc.media) {
    if (m.id && !usedMedia.has(m.id)) out.rawRecords.push({ recordType: RAW_TYPES.media, xref: m.id, content: jsonClean({ format: RAW_FORMAT, record: m }), reason: "Medium ohne Verweis", replace: false });
  }
  if (out.counts.localMediaPaths) {
    note("LOCAL_MEDIA_PATH", out.counts.localMediaPaths === 1 ? "1 Medienverweis auf einen lokalen Dateipfad — wird nie gelesen, bleibt in den Rohdaten" : `${out.counts.localMediaPaths} Medienverweise auf lokale Dateipfade — werden nie gelesen, bleiben in den Rohdaten`);
  }

  return out;
}

/** Personen ohne Sterbeangabe, die vor weniger als `years` Jahren geboren sind (nur Information). */
export function recentWithoutDeath(meta: PersonMeta[], now = new Date(), years = PRESUMED_LIFESPAN): number {
  const limit = now.getUTCFullYear() - years;
  return meta.filter((m) => !m.hasDeath && m.birthYear !== null && m.birthYear >= limit).length;
}

// ---------------------------------------------------------------------------
// Für den Export: Originaldatensatz nach denselben Schlüsseln erschließen
// ---------------------------------------------------------------------------

export type OriginalIndex = {
  /** Ereignisse nach Schlüssel (wie ImportLink.externalKey der Event-Zeilen). */
  events: Map<string, GedcomEvent>;
  /** Belege nach Schlüssel (wie ImportLink.externalKey der Citation-Zeilen). */
  citations: Map<string, GedcomCitation>;
  /** Hauptangaben (Geburt/Tod bzw. Heirat/Scheidung). */
  main: Partial<Record<"BIRTH" | "DEATH" | "MARRIAGE" | "DIVORCE", GedcomEvent>>;
};

function indexEvents(events: GedcomEvent[], ownerKey: string, idx: OriginalIndex) {
  const keys = eventKeys(events, ownerKey);
  events.forEach((e, i) => {
    idx.events.set(keys[i], e);
    e.citations.forEach((c, j) => idx.citations.set(`${keys[i]}/SOUR#${j + 1}`, c));
  });
}

export function indexOriginalPerson(p: GedcomPerson, key: string): OriginalIndex {
  const idx: OriginalIndex = { events: new Map(), citations: new Map(), main: {} };
  indexEvents(p.events, key, idx);
  idx.main.BIRTH = pickMain(p.events, "BIRTH");
  idx.main.DEATH = pickMain(p.events, "DEATH");
  p.names.forEach((n, i) => n.citations.forEach((c, j) => idx.citations.set(`${key}/NAME#${i + 1}/SOUR#${j + 1}`, c)));
  p.citations.forEach((c, j) => idx.citations.set(`${key}/SOUR#${j + 1}`, c));
  return idx;
}

export function indexOriginalFamily(f: GedcomFamily, key: string): OriginalIndex {
  const idx: OriginalIndex = { events: new Map(), citations: new Map(), main: {} };
  indexEvents(f.events, key, idx);
  idx.main.MARRIAGE = pickMain(f.events, "MARRIAGE");
  idx.main.DIVORCE = pickMain(f.events, "DIVORCE");
  f.citations.forEach((c, j) => idx.citations.set(`${key}/SOUR#${j + 1}`, c));
  return idx;
}
