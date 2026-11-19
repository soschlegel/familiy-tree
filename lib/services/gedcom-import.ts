import { createHash } from "node:crypto";

import JSZip from "jszip";
import { z } from "zod";

import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { audit, auditActor } from "../audit";
import { getObjectBuffer, putObject } from "../storage";
import { EVENT_TYPE_LABEL, PERSON_NAME_TYPE_LABEL, type EventTypeName, type PersonNameTypeName } from "../events";
import { diagnoseGedcom, parseGedcom, verifyLossless, type GedcomHeader, type ParseResultWithTrace } from "../gedcom";
import {
  mapGedcomDocument,
  RAW_TYPES,
  recentWithoutDeath,
  type MappedImport,
} from "../gedcom-import/mapping";
import { suggestMatches, type Suggestion, type SuggestPerson } from "../gedcom-import/suggest";
import type { ImportEntity } from "../import-fingerprint";
import { conflictError, forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import { applyGenealogyImport, type GenealogyImportResult, type ImportAction } from "./import-apply";
import { createImportBatch, finishImportBatch, IMPORT_FILES_DIR, readImportBatchFile } from "./imports";
import { deleteCitation, deleteSource } from "./sources";
import { deleteEvent } from "./events";
import { deletePersonName } from "./names";
import { deletePerson } from "./persons";
import { deleteRelationship } from "./relationships";
import { downloadImportPhotos, type PhotoDownloadReport } from "./gedcom-photos";

/**
 * GEDCOM-Import mit Vorschau und Abgleich bei erneutem Import. Nur
 * Administratoren.
 *
 * Ablauf:
 * 1. `startGedcomImport`: Datei lesen (auch .zip mit einer .ged), Lauf
 *    anlegen (Originaldatei wird aufbewahrt), Vorschau berechnen. Die Vorschau
 *    schreibt sonst nichts: Sie lässt den echten Massenimport in einer
 *    Transaktion laufen, die am Ende zurückgerollt wird — die Ergebnisse
 *    (neu/geändert/unverändert/in der App geändert/ungültig samt Grund) sind
 *    also genau die, die der Import hätte. Der Plan liegt als JSON neben der
 *    Originaldatei (MEDIA_DIR/imports/<lauf>.plan.json).
 * 2. `getGedcomPlan` / `listGedcomPlanItems`: Zusammenfassung bzw. Einträge
 *    seitenweise (große Dateien bleiben bedienbar).
 * 3. `applyGedcomImport`: mit den Entscheidungen des Administrators in EINER
 *    Transaktion; doppeltes Absenden ändert nichts (Lauf ist dann
 *    abgeschlossen, das gespeicherte Ergebnis kommt zurück).
 *
 * Abgleich (je Datensatzart, nur innerhalb desselben Quell-Baums):
 * ImportLink.externalKey → ExternalId (_UID; nur wenn der Treffer noch keinem
 * anderen Quell-Baum gehört) → bei Beziehungen: dieselbe Beziehung zwischen
 * zwei zugeordneten Personen (in der App angelegte bleiben unangetastet) →
 * Quellen ohne Kennung: Xref + Titel, dann Titel + Autor (umnummeriert), dann
 * nur Xref. Ähnliche, von Hand angelegte Personen sind nur Vorschläge.
 */

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export const PLAN_KINDS = ["persons", "names", "relationships", "events", "sources", "citations"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_GROUPS = ["new", "changed", "unchanged", "edited", "missing", "existing", "invalid"] as const;
export type PlanGroup = (typeof PLAN_GROUPS)[number];

const KIND_ENTITY: Record<PlanKind, ImportEntity> = {
  persons: "PERSON",
  names: "PERSON_NAME",
  relationships: "RELATIONSHIP",
  events: "EVENT",
  sources: "SOURCE",
  citations: "CITATION",
};

export type PlanItem = {
  ref: string;
  kind: PlanKind;
  group: PlanGroup;
  label: string;
  /** Datensatz in der App (zugeordnet bzw. bei „missing“ der fehlende). */
  appId?: string;
  /** ImportLink (bei „missing“). */
  linkId?: string;
  /** Geänderte Felder (changed/edited). */
  fields?: string[];
  /** edited: Datei hat seit dem letzten Import ebenfalls etwas geändert. */
  conflict?: boolean;
  reason?: string;
  suggestions?: (Suggestion & { label: string })[];
};

export type TreeCandidate = {
  sourceTreeId: string;
  label: string;
  lastImportAt: string;
  batches: number;
  /** Personen der Datei, deren _UID schon in diesem Baum vorkommt. */
  uidOverlap: number;
};

export type GedcomPlan = {
  version: 1;
  batchId: string;
  fileName: string;
  createdAt: string;
  durationMs: number;
  sourceTreeId: string;
  treeMode: "detected" | "existing" | "overlap" | "new";
  detectedTreeId: string | null;
  isUpdate: boolean;
  treeCandidates: TreeCandidate[];
  header: { producer: string | null; producerName: string | null; version: string | null; gedcomVersion: string | null; charset: string | null; exportDate: string | null; dialect: string };
  counts: Record<PlanKind, Record<PlanGroup, number>>;
  items: PlanItem[];
  diagnostics: { code: string; severity: string; count: number; examples: string[] }[];
  warnings: { code: string; count: number; examples: string[] }[];
  mappingNotes: { code: string; count: number; examples: string[] }[];
  unknownTags: { tag: string; count: number; examplePath: string }[];
  lossless: { nodes: number; consumed: number; preserved: number; lost: number; linesBalanced: boolean };
  records: { persons: number; families: number; sources: number; notes: number; media: number; unknown: number };
  privacy: { marked: number; markedNew: number; recentWithoutDeath: number; recentWithoutDeathNew: number };
  photos: { total: number; newPersons: number; alreadyStored: number; localPaths: number };
  suggestions: number;
  otherTreeHits: number;
};

export type GedcomPlanSummary = Omit<GedcomPlan, "items">;

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Daten zu importieren");
}

const planKey = (batchId: string) => `${IMPORT_FILES_DIR}/${batchId}.plan.json`;

/** JSON mit sortierten Schlüsseln (jsonb ordnet Schlüssel um). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** .ged direkt oder die erste .ged-Datei eines ZIP-Archivs. */
export async function extractGedcom(fileName: string, bytes: Buffer): Promise<{ bytes: Buffer; innerName: string | null }> {
  if (bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.values(zip.files).find((f) => !f.dir && /\.ged$/i.test(f.name));
    if (!entry) throw validationError([{ path: "file", message: "Im Archiv liegt keine .ged-Datei" }]);
    return { bytes: await entry.async("nodebuffer"), innerName: entry.name };
  }
  return { bytes, innerName: null };
}

/** Quell-Baum aus dem Dateikopf (MyHeritage: _PROJECT_GUID, sonst Site-ID). */
export function detectSourceTreeId(header: GedcomHeader): string | null {
  const id = (t: string) => header.externalIds.find((x) => x.type === t)?.value?.trim();
  const producer = (header.sourceId ?? "GEDCOM").toUpperCase();
  const guid = id("PROJECT_GUID");
  if (guid) return `${producer}:PROJECT:${guid.toUpperCase()}`;
  const site = id("SITE_ID");
  if (site) return `${producer}:SITE:${site}`;
  return null;
}

function group<T extends { code: string; message: string }>(list: T[], examples = 10) {
  const m = new Map<string, { code: string; count: number; examples: string[] }>();
  for (const x of list) {
    const g = m.get(x.code) ?? { code: x.code, count: 0, examples: [] };
    g.count++;
    if (g.examples.length < examples) g.examples.push(x.message);
    m.set(x.code, g);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const emptyCounts = () =>
  Object.fromEntries(PLAN_KINDS.map((k) => [k, Object.fromEntries(PLAN_GROUPS.map((g) => [g, 0]))])) as GedcomPlan["counts"];

// ---------------------------------------------------------------------------
// Lesen + Abgleich (gemeinsam für Vorschau und Import)
// ---------------------------------------------------------------------------

type Parsed = { result: ParseResultWithTrace; mapped: MappedImport };

function parseAndMap(bytes: Buffer, keepRaw: boolean): Parsed {
  const result = parseGedcom(bytes, { keepRaw });
  const mapped = mapGedcomDocument(result.document);
  return { result, mapped };
}

type Match = {
  /** ref → vorhandene ID je Art. */
  ids: Record<PlanKind, Map<string, string>>;
  /** Beziehungen, die es (von Hand oder aus einem anderen Baum) schon gibt: nicht anfassen. */
  existingRels: Set<string>;
  /** Fehlende: Links des Baums ohne Gegenstück in der Datei. */
  missing: { kind: PlanKind; linkId: string; appId: string }[];
  otherTreeHits: number;
};

async function matchExisting(mapped: MappedImport, sourceTreeId: string, extraPersons: Record<string, string> = {}): Promise<Match> {
  const ids = Object.fromEntries(PLAN_KINDS.map((k) => [k, new Map<string, string>()])) as Match["ids"];
  const links = await prisma.importLink.findMany({
    where: { sourceTreeId },
    select: {
      id: true,
      entityType: true,
      externalKey: true,
      personId: true,
      relationshipId: true,
      eventId: true,
      personNameId: true,
      citationId: true,
      sourceId: true,
    },
  });
  const entityId = (l: (typeof links)[number]) =>
    l.personId ?? l.relationshipId ?? l.eventId ?? l.personNameId ?? l.citationId ?? l.sourceId ?? null;
  const byKey = new Map<string, (typeof links)[number]>();
  for (const l of links) if (l.externalKey) byKey.set(`${l.entityType}|${l.externalKey}`, l);
  const claimed = new Set<string>();
  const usedLinks = new Set<string>();
  const take = (kind: PlanKind, ref: string, id: string, linkId?: string) => {
    if (claimed.has(id)) return false;
    claimed.add(id);
    ids[kind].set(ref, id);
    if (linkId) usedLinks.add(linkId);
    return true;
  };

  for (const [ref, id] of Object.entries(extraPersons)) take("persons", ref, id);
  for (const kind of ["persons", "names", "events", "citations", "relationships"] as PlanKind[]) {
    for (const item of mapped[kind] as { ref: string }[]) {
      const l = byKey.get(`${KIND_ENTITY[kind]}|${item.ref}`);
      const id = l ? entityId(l) : null;
      if (l && id) take(kind, item.ref, id, l.id);
    }
  }

  // Personen über _UID (Fremdkennung), nur ohne fremden Baum
  let otherTreeHits = 0;
  const pending = mapped.personMeta.filter((m) => !ids.persons.has(m.ref) && m.uid);
  if (pending.length) {
    const hits = await prisma.externalId.findMany({
      where: { system: "UID", value: { in: pending.map((m) => m.uid!) }, personId: { not: null } },
      select: { value: true, personId: true, person: { select: { importLink: { select: { sourceTreeId: true, id: true } } } } },
    });
    const byUid = new Map<string, (typeof hits)[number]>();
    for (const h of hits) byUid.set(h.value.toUpperCase(), h);
    for (const m of pending) {
      const h = byUid.get(m.uid!.toUpperCase());
      if (!h?.personId) continue;
      const tree = h.person?.importLink?.sourceTreeId ?? null;
      if (tree && tree !== sourceTreeId) {
        otherTreeHits++;
        continue;
      }
      take("persons", m.ref, h.personId, h.person?.importLink?.id);
    }
  }

  // Beziehungen zwischen zugeordneten Personen
  const existingRels = new Set<string>();
  const appPersonIds = [...ids.persons.values()];
  if (appPersonIds.length) {
    const rels = await prisma.relationship.findMany({
      where: { fromPersonId: { in: appPersonIds }, toPersonId: { in: appPersonIds } },
      select: { id: true, type: true, fromPersonId: true, toPersonId: true, importLink: { select: { id: true, sourceTreeId: true } } },
    });
    const relKey = (type: string, a: string, b: string) => (type === "PARTNER_OF" ? `${type}|${[a, b].sort().join("|")}` : `${type}|${a}|${b}`);
    const byPair = new Map(rels.map((r) => [relKey(r.type, r.fromPersonId, r.toPersonId), r]));
    for (const r of mapped.relationships) {
      if (ids.relationships.has(r.ref)) continue;
      const a = ids.persons.get(r.fromRef);
      const b = ids.persons.get(r.toRef);
      if (!a || !b) continue;
      const hit = byPair.get(relKey(r.type, a, b));
      if (!hit || claimed.has(hit.id)) continue;
      if (hit.importLink && hit.importLink.sourceTreeId === sourceTreeId) take("relationships", r.ref, hit.id, hit.importLink.id);
      else {
        take("relationships", r.ref, hit.id);
        existingRels.add(r.ref);
      }
    }
  }

  // Quellen: Xref + Titel → Titel + Autor → Xref
  const sourceLinks = links.filter((l) => l.entityType === "SOURCE" && l.sourceId);
  if (sourceLinks.length) {
    const rows = await prisma.source.findMany({
      where: { id: { in: sourceLinks.map((l) => l.sourceId!) } },
      select: { id: true, title: true, author: true },
    });
    const info = new Map(rows.map((r) => [r.id, r]));
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const free = () => sourceLinks.filter((l) => !usedLinks.has(l.id) && !claimed.has(l.sourceId!));
    const metaBy = new Map(mapped.sourceMeta.map((m) => [m.ref, m]));
    const items = mapped.sources;
    // a) Schlüssel und Titel
    for (const s of items) {
      const l = byKey.get(`SOURCE|${s.ref}`);
      if (l?.sourceId && norm(info.get(l.sourceId)?.title) === norm(s.title)) take("sources", s.ref, l.sourceId, l.id);
    }
    // b) Titel + Autor eindeutig (umnummerierte Quelle)
    for (const s of items) {
      if (ids.sources.has(s.ref)) continue;
      const meta = metaBy.get(s.ref);
      const cands = free().filter(
        (l) => norm(info.get(l.sourceId!)?.title) === norm(s.title) && norm(info.get(l.sourceId!)?.author) === norm(meta?.author),
      );
      if (cands.length === 1) take("sources", s.ref, cands[0].sourceId!, cands[0].id);
    }
    // c) nur Schlüssel (Titel in der Quelle geändert)
    for (const s of items) {
      if (ids.sources.has(s.ref)) continue;
      const l = byKey.get(`SOURCE|${s.ref}`);
      if (l?.sourceId && !usedLinks.has(l.id)) take("sources", s.ref, l.sourceId, l.id);
    }
  }

  // Fehlende
  const missing: Match["missing"] = [];
  const kindOf = Object.fromEntries(PLAN_KINDS.map((k) => [KIND_ENTITY[k], k])) as Record<string, PlanKind>;
  for (const l of links) {
    const kind = kindOf[l.entityType];
    const id = entityId(l);
    if (!kind || !id || usedLinks.has(l.id) || claimed.has(id)) continue;
    missing.push({ kind, linkId: l.id, appId: id });
  }
  return { ids, existingRels, missing, otherTreeHits };
}

/** Familien, Entscheidungen usw. für den eigentlichen Lauf. */
export const applyDecisionsSchema = z.object({
  edited: z
    .object({
      default: z.enum(["keep", "file"]).default("keep"),
      overrides: z.record(z.enum(["keep", "file"])).default({}),
    })
    .default({}),
  missing: z.object({ delete: z.array(z.string().min(1)).max(100000).default([]) }).default({}),
  suggestions: z
    .record(z.object({ personId: z.string().min(1), mode: z.enum(["link", "update"]).default("link") }))
    .default({}),
  family: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("existing"), familyIds: z.array(z.string().min(1)).min(1).max(50) }),
      z.object({ mode: z.literal("new"), name: z.string().trim().min(1).max(120) }),
    ])
    .default({ mode: "none" }),
  privacyUnassigned: z.boolean().default(false),
  downloadPhotos: z.boolean().default(false),
});
export type ApplyDecisions = z.input<typeof applyDecisionsSchema>;

type BuildOptions = {
  plan?: GedcomPlan;
  decisions?: z.infer<typeof applyDecisionsSchema>;
  familyIds?: string[];
  forPreview: boolean;
};

/** Eingabe für applyGenealogyImport: Aktionen je Eintrag aus Abgleich (+ Entscheidungen). */
function buildInput(mapped: MappedImport, match: Match, batchId: string, sourceTreeId: string, opts: BuildOptions) {
  const editedRefs = new Set(opts.plan?.items.filter((i) => i.group === "edited").map((i) => `${i.kind}|${i.ref}`) ?? []);
  const d = opts.decisions;
  const suggestion = d?.suggestions ?? {};
  const privacyRefs = new Set(mapped.personMeta.filter((m) => m.privacyMarked).map((m) => m.ref));
  const act = (kind: PlanKind, ref: string): { action: ImportAction; id?: string } => {
    const id = match.ids[kind].get(ref);
    if (kind === "persons" && suggestion[ref]) {
      return { action: suggestion[ref].mode === "update" ? "update" : "link", id: suggestion[ref].personId };
    }
    if (!id) return { action: "create" };
    if (kind === "relationships" && match.existingRels.has(ref)) return { action: "skip", id };
    if (!opts.forPreview && editedRefs.has(`${kind}|${ref}`)) {
      const choice = d?.edited.overrides[ref] ?? d?.edited.default ?? "keep";
      return { action: choice === "file" ? "update" : "link", id };
    }
    return { action: "updateIfUnchanged", id };
  };
  const withAction = <T extends { ref: string }>(kind: PlanKind, list: T[]) =>
    list.map((x) => {
      const a = act(kind, x.ref);
      return { ...x, action: a.action, ...(a.id ? { id: a.id } : {}) };
    });
  return {
    batchId,
    sourceTreeId,
    familyIds: opts.familyIds ?? [],
    persons: withAction("persons", mapped.persons).map((p) =>
      opts.decisions?.privacyUnassigned && privacyRefs.has(p.ref) ? { ...p, familyIds: [] } : p,
    ),
    names: withAction("names", mapped.names),
    relationships: withAction("relationships", mapped.relationships),
    events: withAction("events", mapped.events),
    sources: withAction("sources", mapped.sources),
    citations: withAction("citations", mapped.citations),
    externalIds: [] as MappedImport["externalIds"],
    rawRecords: [] as MappedImport["rawRecords"],
  };
}

// ---------------------------------------------------------------------------
// Vorschau
// ---------------------------------------------------------------------------

const ROLLBACK = Symbol("rollback");

async function dryRun(scope: Scope, input: unknown): Promise<GenealogyImportResult> {
  let result: GenealogyImportResult | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        result = await applyGenealogyImport(scope, input, { tx, onInvalid: "skip", dryRun: true });
        throw ROLLBACK;
      },
      { timeout: 10 * 60_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return result!;
}

async function treeCandidates(mapped: MappedImport): Promise<TreeCandidate[]> {
  const batches = await prisma.importBatch.findMany({
    where: { status: "COMPLETED", sourceTreeId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { sourceTreeId: true, fileName: true, createdAt: true, sourceSystemName: true },
  });
  const by = new Map<string, TreeCandidate>();
  for (const b of batches) {
    const c = by.get(b.sourceTreeId!);
    if (c) c.batches++;
    else
      by.set(b.sourceTreeId!, {
        sourceTreeId: b.sourceTreeId!,
        label: `${b.fileName}${b.sourceSystemName ? ` (${b.sourceSystemName})` : ""}`,
        lastImportAt: b.createdAt.toISOString(),
        batches: 1,
        uidOverlap: 0,
      });
  }
  const uids = mapped.personMeta.map((m) => m.uid).filter((x): x is string => Boolean(x));
  if (uids.length && by.size) {
    for (let i = 0; i < uids.length; i += 5000) {
      const hits = await prisma.externalId.findMany({
        where: { system: "UID", value: { in: uids.slice(i, i + 5000) }, personId: { not: null } },
        select: { person: { select: { importLink: { select: { sourceTreeId: true } } } } },
      });
      for (const h of hits) {
        const t = h.person?.importLink?.sourceTreeId;
        const c = t ? by.get(t) : undefined;
        if (c) c.uidOverlap++;
      }
    }
  }
  return [...by.values()];
}

export type TreeChoice = { mode: "auto" } | { mode: "existing"; sourceTreeId: string } | { mode: "new" };
const treeChoiceSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto") }),
    z.object({ mode: z.literal("existing"), sourceTreeId: z.string().min(1).max(300) }),
    z.object({ mode: z.literal("new") }),
  ])
  .default({ mode: "auto" });

async function computePlan(scope: Scope, batch: { id: string; fileName: string }, bytes: Buffer, choiceInput: unknown): Promise<GedcomPlan> {
  const started = performance.now();
  const choice = parseOrThrow(treeChoiceSchema.safeParse(choiceInput ?? undefined));
  const { result, mapped } = parseAndMap(bytes, true);
  const doc = result.document;
  const detected = detectSourceTreeId(doc.header);
  const candidates = await treeCandidates(mapped);

  let sourceTreeId: string;
  let treeMode: GedcomPlan["treeMode"];
  if (choice.mode === "existing") {
    if (!candidates.some((c) => c.sourceTreeId === choice.sourceTreeId)) throw validationError([{ path: "sourceTreeId", message: "Unbekannter Baum" }]);
    sourceTreeId = choice.sourceTreeId;
    treeMode = "existing";
  } else if (choice.mode === "new") {
    sourceTreeId = `NEU:${batch.id}`;
    treeMode = "new";
  } else if (detected) {
    sourceTreeId = detected;
    treeMode = "detected";
  } else {
    const withUid = mapped.personMeta.filter((m) => m.uid).length;
    const best = [...candidates].sort((a, b) => b.uidOverlap - a.uidOverlap)[0];
    if (best && withUid > 0 && best.uidOverlap >= withUid * 0.5) {
      sourceTreeId = best.sourceTreeId;
      treeMode = "overlap";
    } else {
      sourceTreeId = `NEU:${batch.id}`;
      treeMode = "new";
    }
  }
  await prisma.importBatch.update({ where: { id: batch.id }, data: { sourceTreeId } });

  const match = await matchExisting(mapped, sourceTreeId);
  const input = buildInput(mapped, match, batch.id, sourceTreeId, { forPreview: true });
  const dry = await dryRun(scope, input);

  // --- Einträge ------------------------------------------------------------------
  const personLabel = new Map(mapped.personMeta.map((m) => [m.ref, m.label]));
  const relLabel = new Map(
    mapped.relationships.map((r) => [
      r.ref,
      `${personLabel.get(r.fromRef) ?? "?"} ${r.type === "PARTNER_OF" ? "⚭" : "→"} ${personLabel.get(r.toRef) ?? "?"}`,
    ]),
  );
  const ownerLabel = (ref: string) => personLabel.get(ref) ?? relLabel.get(ref) ?? "";
  const sourceTitle = new Map(mapped.sources.map((s) => [s.ref, s.title]));
  const labelOf = (kind: PlanKind, x: Record<string, unknown>): string => {
    switch (kind) {
      case "persons":
        return personLabel.get(x.ref as string) ?? String(x.givenName);
      case "relationships":
        return relLabel.get(x.ref as string) ?? "";
      case "names":
        return `${PERSON_NAME_TYPE_LABEL[x.type as PersonNameTypeName]}: ${[x.givenName, x.familyName].filter(Boolean).join(" ")} — ${ownerLabel(mapped.owners[x.ref as string])}`;
      case "events":
        return `${x.type === "CUSTOM" ? x.label : EVENT_TYPE_LABEL[x.type as EventTypeName]}${x.isAlternative ? " (abweichende Angabe)" : ""} — ${ownerLabel(mapped.owners[x.ref as string])}`;
      case "sources":
        return String(x.title);
      case "citations":
        return `Beleg „${sourceTitle.get(x.sourceRef as string) ?? "?"}“ — ${ownerLabel(mapped.owners[x.ref as string])}`;
    }
  };
  const OUTCOME_GROUP: Record<string, PlanGroup> = {
    created: "new",
    updated: "changed",
    unchanged: "unchanged",
    skippedEdited: "edited",
    skipped: "existing",
    invalid: "invalid",
  };
  const invalidReason = new Map<string, string>();
  for (const i of dry.invalid) if (!invalidReason.has(`${i.section}|${i.ref}`)) invalidReason.set(`${i.section}|${i.ref}`, i.message);

  const items: PlanItem[] = [];
  const counts = emptyCounts();
  const newPersons = new Set<string>();
  for (const kind of PLAN_KINDS) {
    for (const x of mapped[kind] as Record<string, unknown>[]) {
      const ref = x.ref as string;
      const outcome = dry.outcomes[kind][ref] ?? "invalid";
      const g = OUTCOME_GROUP[outcome];
      if (kind === "persons" && g === "new") newPersons.add(ref);
      const item: PlanItem = { ref, kind, group: g, label: labelOf(kind, x) };
      const appId = match.ids[kind].get(ref);
      if (appId) item.appId = appId;
      const ch = dry.changes[kind][ref];
      if (ch && (g === "changed" || g === "edited")) {
        item.fields = ch.fields;
        if (g === "edited") item.conflict = ch.fileChangedSinceImport;
      }
      if (g === "invalid") item.reason = invalidReason.get(`${kind}|${ref}`) ?? "ungültig";
      if (g === "existing") item.reason = "Gibt es in der App schon (nicht aus diesem Baum) — bleibt unverändert";
      counts[kind][g]++;
      items.push(item);
    }
  }

  // Fehlende: Bezeichnung aus der App, Untereinträge fehlender Personen nicht einzeln
  const missingIds = (k: PlanKind) => match.missing.filter((m) => m.kind === k).map((m) => m.appId);
  const missingPersons = new Set(missingIds("persons"));
  const labels = await appLabels(match.missing);
  for (const m of match.missing) {
    const info = labels.get(m.appId);
    if (!info) continue;
    if (m.kind !== "persons" && info.ownerPersonIds.some((p) => missingPersons.has(p))) continue;
    items.push({ ref: `MISSING:${m.linkId}`, kind: m.kind, group: "missing", label: info.label, appId: m.appId, linkId: m.linkId });
    counts[m.kind].missing++;
  }

  // Vorschläge für neue Personen (gegen von Hand angelegte)
  let suggestionCount = 0;
  if (newPersons.size) {
    const manual = await prisma.person.findMany({
      where: { importLink: null },
      select: {
        id: true,
        givenName: true,
        familyName: true,
        birthName: true,
        gender: true,
        birthDate: true,
        birthPlace: true,
        relationsTo: { where: { type: "PARENT_OF" }, select: { fromPerson: { select: { givenName: true } } } },
      },
    });
    if (manual.length) {
      const metaByRef = new Map(mapped.personMeta.map((m) => [m.ref, m]));
      const fromFile: SuggestPerson[] = [...newPersons].map((ref) => {
        const m = metaByRef.get(ref)!;
        return {
          id: ref,
          givenName: m.givenName,
          familyName: m.familyName,
          birthName: m.birthName,
          gender: m.gender,
          birthYear: m.birthYear,
          birthPlace: m.birthPlace,
          parentNames: m.parentRefs.map((p) => metaByRef.get(p)?.givenName ?? ""),
        };
      });
      const inApp: SuggestPerson[] = manual.map((p) => ({
        id: p.id,
        givenName: p.givenName,
        familyName: p.familyName,
        birthName: p.birthName,
        gender: p.gender,
        birthYear: p.birthDate ? p.birthDate.getUTCFullYear() : null,
        birthPlace: p.birthPlace,
        parentNames: p.relationsTo.map((r) => r.fromPerson.givenName),
      }));
      const found = suggestMatches(fromFile, inApp);
      const appLabel = new Map(
        manual.map((p) => [p.id, `${p.givenName} ${p.familyName ?? ""}`.trim() + (p.birthDate ? ` (*${p.birthDate.getUTCFullYear()})` : "")]),
      );
      for (const item of items) {
        if (item.kind !== "persons" || item.group !== "new") continue;
        const s = found.get(item.ref);
        if (!s) continue;
        item.suggestions = s.map((x) => ({ ...x, label: appLabel.get(x.personId) ?? x.personId }));
        suggestionCount++;
      }
    }
  }

  // Privatsphäre und Fotos
  const privacyMarked = mapped.personMeta.filter((m) => m.privacyMarked);
  const recentNew = recentWithoutDeath(mapped.personMeta.filter((m) => newPersons.has(m.ref)));
  const storedPhotos = await prisma.importLink.count({
    where: { sourceTreeId, entityType: "MEDIA", externalKey: { in: mapped.photos.map((p) => p.key) } },
  });

  const lossless = verifyLossless(result);
  const diagnostics = diagnoseGedcom(doc);
  const diagGroups = new Map<string, GedcomPlan["diagnostics"][number]>();
  for (const dg of diagnostics) {
    const g = diagGroups.get(dg.code) ?? { code: dg.code, severity: dg.severity, count: 0, examples: [] };
    g.count++;
    if (g.examples.length < 10) g.examples.push(dg.message);
    diagGroups.set(dg.code, g);
  }

  const h = doc.header;
  return {
    version: 1,
    batchId: batch.id,
    fileName: batch.fileName,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    sourceTreeId,
    treeMode,
    detectedTreeId: detected,
    isUpdate: candidates.some((c) => c.sourceTreeId === sourceTreeId),
    treeCandidates: candidates,
    header: {
      producer: h.sourceId ?? null,
      producerName: h.sourceName ?? null,
      version: h.sourceVersion ?? null,
      gedcomVersion: h.gedcomVersion ?? null,
      charset: result.encoding.encoding,
      exportDate: h.exportDate ?? null,
      dialect: h.dialect,
    },
    counts,
    items,
    diagnostics: [...diagGroups.values()],
    warnings: group(result.warnings),
    mappingNotes: group(mapped.notes),
    unknownTags: result.unknownTags.map((t) => ({ tag: t.tag, count: t.count, examplePath: t.examplePath })),
    lossless: { nodes: lossless.nodes, consumed: lossless.consumed, preserved: lossless.preserved, lost: lossless.lost.length, linesBalanced: lossless.linesBalanced },
    records: {
      persons: doc.persons.length,
      families: doc.families.length,
      sources: doc.sources.length,
      notes: doc.notes.length,
      media: doc.media.length,
      unknown: doc.unknownRecords.length,
    },
    privacy: {
      marked: privacyMarked.length,
      markedNew: privacyMarked.filter((m) => newPersons.has(m.ref)).length,
      recentWithoutDeath: recentWithoutDeath(mapped.personMeta),
      recentWithoutDeathNew: recentNew,
    },
    photos: {
      total: mapped.photos.length,
      newPersons: mapped.photos.filter((p) => newPersons.has(p.personRef)).length,
      alreadyStored: storedPhotos,
      localPaths: mapped.counts.localMediaPaths,
    },
    suggestions: suggestionCount,
    otherTreeHits: match.otherTreeHits,
  };
}

/** Bezeichnungen fehlender Datensätze aus der App (+ Träger-Personen). */
async function appLabels(missing: Match["missing"]): Promise<Map<string, { label: string; ownerPersonIds: string[] }>> {
  const out = new Map<string, { label: string; ownerPersonIds: string[] }>();
  const idsOf = (k: PlanKind) => missing.filter((m) => m.kind === k).map((m) => m.appId);
  const pName = (p: { givenName: string; familyName: string | null } | null) => (p ? `${p.givenName} ${p.familyName ?? ""}`.trim() : "?");
  for (const p of await prisma.person.findMany({ where: { id: { in: idsOf("persons") } }, select: { id: true, givenName: true, familyName: true } })) {
    out.set(p.id, { label: pName(p), ownerPersonIds: [] });
  }
  const sel = { givenName: true, familyName: true } as const;
  for (const r of await prisma.relationship.findMany({
    where: { id: { in: idsOf("relationships") } },
    select: { id: true, type: true, fromPersonId: true, toPersonId: true, fromPerson: { select: sel }, toPerson: { select: sel } },
  })) {
    out.set(r.id, { label: `${pName(r.fromPerson)} ${r.type === "PARTNER_OF" ? "⚭" : "→"} ${pName(r.toPerson)}`, ownerPersonIds: [r.fromPersonId, r.toPersonId] });
  }
  for (const e of await prisma.event.findMany({
    where: { id: { in: idsOf("events") } },
    select: { id: true, type: true, label: true, personId: true, person: { select: sel }, relationship: { select: { fromPersonId: true, toPersonId: true } } },
  })) {
    out.set(e.id, {
      label: `${e.type === "CUSTOM" ? e.label : EVENT_TYPE_LABEL[e.type as EventTypeName]} — ${pName(e.person)}`,
      ownerPersonIds: e.personId ? [e.personId] : e.relationship ? [e.relationship.fromPersonId, e.relationship.toPersonId] : [],
    });
  }
  for (const n of await prisma.personName.findMany({ where: { id: { in: idsOf("names") } }, select: { id: true, type: true, givenName: true, familyName: true, personId: true, person: { select: sel } } })) {
    out.set(n.id, { label: `${PERSON_NAME_TYPE_LABEL[n.type as PersonNameTypeName]}: ${[n.givenName, n.familyName].filter(Boolean).join(" ")} — ${pName(n.person)}`, ownerPersonIds: [n.personId] });
  }
  for (const c of await prisma.citation.findMany({
    where: { id: { in: idsOf("citations") } },
    select: { id: true, personId: true, relationship: { select: { fromPersonId: true, toPersonId: true } }, source: { select: { title: true } }, person: { select: sel } },
  })) {
    out.set(c.id, {
      label: `Beleg „${c.source.title}“ — ${pName(c.person)}`,
      ownerPersonIds: c.personId ? [c.personId] : c.relationship ? [c.relationship.fromPersonId, c.relationship.toPersonId] : [],
    });
  }
  for (const s of await prisma.source.findMany({ where: { id: { in: idsOf("sources") } }, select: { id: true, title: true } })) {
    out.set(s.id, { label: s.title, ownerPersonIds: [] });
  }
  return out;
}

async function savePlan(plan: GedcomPlan) {
  await putObject(planKey(plan.batchId), Buffer.from(JSON.stringify(plan), "utf8"));
}

async function loadPlan(batchId: string): Promise<GedcomPlan> {
  const buf = await getObjectBuffer(planKey(batchId));
  if (!buf) throw notFoundError("Importvorschau");
  return JSON.parse(buf.toString("utf8")) as GedcomPlan;
}

const summaryOf = (plan: GedcomPlan): GedcomPlanSummary => {
  const { items: _items, ...rest } = plan;
  return rest;
};

/**
 * Datei hochladen, Lauf anlegen (Original wird aufbewahrt), Vorschau
 * berechnen. Schreibt außer Lauf, Originaldatei und Plan nichts.
 */
export async function startGedcomImport(
  scope: Scope,
  file: { fileName: string; bytes: Buffer },
  choice?: TreeChoice,
): Promise<GedcomPlanSummary> {
  assertAdmin(scope);
  const { bytes } = await extractGedcom(file.fileName, file.bytes);
  const head = parseGedcom(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).document.header;
  if (!head.sourceId && !head.gedcomVersion && !/\.ged$/i.test(file.fileName) && !/\.zip$/i.test(file.fileName)) {
    throw validationError([{ path: "file", message: "Das ist keine GEDCOM-Datei" }]);
  }
  const batch = await createImportBatch(
    scope,
    {
      format: "GEDCOM",
      fileName: file.fileName,
      sourceTreeId: detectSourceTreeId(head),
      sourceSystem: head.sourceId,
      sourceSystemName: head.sourceName,
      sourceVersion: head.sourceVersion,
      gedcomVersion: head.gedcomVersion,
      charset: head.charset,
      header: { ...head, extensions: undefined },
    },
    file.bytes,
  );
  try {
    const plan = await computePlan(scope, batch, bytes, choice);
    await savePlan(plan);
    return summaryOf(plan);
  } catch (err) {
    await finishImportBatch(scope, batch.id, { status: "FAILED", notes: "Vorschau fehlgeschlagen" }).catch(() => {});
    throw err;
  }
}

async function pendingBatch(batchId: string) {
  const b = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!b || b.format !== "GEDCOM") throw notFoundError("Importlauf");
  return b;
}

async function batchBytes(scope: Scope, batchId: string, fileName: string): Promise<Buffer> {
  const buf = await readImportBatchFile(scope, batchId);
  if (!buf) throw notFoundError("Originaldatei des Laufs");
  return (await extractGedcom(fileName, buf)).bytes;
}

/** Vorschau mit anderer Wahl des Quell-Baums neu berechnen. */
export async function recomputeGedcomPreview(scope: Scope, batchId: string, choice: TreeChoice): Promise<GedcomPlanSummary> {
  assertAdmin(scope);
  const b = await pendingBatch(batchId);
  if (b.status !== "PENDING") throw conflictError("Dieser Import ist bereits abgeschlossen");
  const plan = await computePlan(scope, b, await batchBytes(scope, batchId, b.fileName), choice);
  await savePlan(plan);
  return summaryOf(plan);
}

export async function getGedcomPlan(scope: Scope, batchId: string): Promise<GedcomPlanSummary & { status: string; result: unknown }> {
  assertAdmin(scope);
  const b = await pendingBatch(batchId);
  return { ...summaryOf(await loadPlan(batchId)), status: b.status, result: b.status === "COMPLETED" ? b.counts : null };
}

/** Einträge einer Gruppe seitenweise. */
export async function listGedcomPlanItems(
  scope: Scope,
  batchId: string,
  query: { kind?: PlanKind; group?: PlanGroup; offset?: number; limit?: number; q?: string },
): Promise<{ total: number; items: PlanItem[] }> {
  assertAdmin(scope);
  await pendingBatch(batchId);
  const plan = await loadPlan(batchId);
  const q = query.q?.trim().toLowerCase();
  const list = plan.items.filter(
    (i) =>
      (!query.kind || i.kind === query.kind) &&
      (!query.group || i.group === query.group) &&
      (!q || i.label.toLowerCase().includes(q)),
  );
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, Math.min(500, query.limit ?? 50));
  return { total: list.length, items: list.slice(offset, offset + limit) };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type GedcomApplyResult = {
  batchId: string;
  alreadyApplied: boolean;
  durationMs: number;
  counts: Record<PlanKind, Record<string, number>>;
  invalid: number;
  externalIds: number;
  rawRecords: number;
  supersededRawRecords: number;
  markedMissing: number;
  deleted: { kind: PlanKind; count: number }[];
  deleteErrors: string[];
  familyId: string | null;
  photos: PhotoDownloadReport | null;
};

export async function applyGedcomImport(scope: Scope, batchId: string, decisionsInput: unknown): Promise<GedcomApplyResult> {
  assertAdmin(scope);
  const started = performance.now();
  const decisions = parseOrThrow(applyDecisionsSchema.safeParse(decisionsInput ?? {}));
  const b = await pendingBatch(batchId);
  if (b.status === "COMPLETED") return { ...(b.counts as unknown as GedcomApplyResult), alreadyApplied: true };
  if (b.status !== "PENDING") throw conflictError("Dieser Import ist fehlgeschlagen — bitte die Datei erneut hochladen");
  const plan = await loadPlan(batchId);
  const sourceTreeId = plan.sourceTreeId;

  // Vorschläge prüfen: jede App-Person höchstens einmal, nur von Hand angelegte
  const chosen = Object.values(decisions.suggestions).map((s) => s.personId);
  if (new Set(chosen).size !== chosen.length) throw validationError([{ path: "suggestions", message: "Eine Person der App ist mehrfach gewählt" }]);
  if (chosen.length) {
    const n = await prisma.person.count({ where: { id: { in: chosen }, importLink: null } });
    if (n !== chosen.length) throw validationError([{ path: "suggestions", message: "Zuordnung nur zu von Hand angelegten Personen" }]);
  }
  if (decisions.family.mode === "existing") {
    const n = await prisma.family.count({ where: { id: { in: decisions.family.familyIds } } });
    if (n !== decisions.family.familyIds.length) throw validationError([{ path: "family", message: "Unbekannte Familie" }]);
  }
  if (decisions.family.mode === "new" && (await prisma.family.count({ where: { name: decisions.family.name } }))) {
    throw validationError([{ path: "family", message: "Eine Familie mit diesem Namen gibt es schon" }]);
  }

  const { mapped } = parseAndMap(await batchBytes(scope, batchId, b.fileName), false);
  const plain = await matchExisting(mapped, sourceTreeId);
  for (const ref of Object.keys(decisions.suggestions)) {
    if (plain.ids.persons.has(ref)) delete decisions.suggestions[ref];
  }
  const match = await matchExisting(
    mapped,
    sourceTreeId,
    Object.fromEntries(Object.entries(decisions.suggestions).map(([ref, s]) => [ref, s.personId])),
  );

  // Fremdkennungen nur, wo sie fehlen
  const input = buildInput(mapped, match, batchId, sourceTreeId, { plan, decisions, forPreview: false });
  const targetId = (x: { personRef?: string; relationshipRef?: string; eventRef?: string; sourceRef?: string }) =>
    x.personRef
      ? (match.ids.persons.get(x.personRef) ?? decisions.suggestions[x.personRef]?.personId)
      : x.relationshipRef
        ? match.ids.relationships.get(x.relationshipRef)
        : x.eventRef
          ? match.ids.events.get(x.eventRef)
          : x.sourceRef
            ? match.ids.sources.get(x.sourceRef)
            : undefined;
  const existingTargets = mapped.externalIds.map(targetId).filter((x): x is string => Boolean(x));
  const have = new Set<string>();
  for (let i = 0; i < existingTargets.length; i += 5000) {
    const chunk = existingTargets.slice(i, i + 5000);
    const rows = await prisma.externalId.findMany({
      where: { OR: [{ personId: { in: chunk } }, { relationshipId: { in: chunk } }, { eventId: { in: chunk } }, { sourceId: { in: chunk } }] },
      select: { system: true, value: true, personId: true, relationshipId: true, eventId: true, sourceId: true },
    });
    for (const r of rows) have.add(`${r.system}|${r.value}|${r.personId ?? r.relationshipId ?? r.eventId ?? r.sourceId}`);
  }
  input.externalIds = mapped.externalIds.filter((x) => {
    const t = targetId(x);
    return !t || !have.has(`${x.system}|${x.value}|${t}`);
  });

  // Rohdaten nur, wo sie sich geändert haben (je Träger alle oder keine)
  input.rawRecords = await changedRawRecords(mapped, match, decisions, sourceTreeId);

  const deleteRefs = new Set(decisions.missing.delete);
  const missingItems = plan.items.filter((i) => i.group === "missing");
  const toDelete = missingItems.filter((i) => deleteRefs.has(i.ref));
  const toMark = missingItems.filter((i) => !deleteRefs.has(i.ref) && i.linkId);

  let familyId: string | null = null;
  const state: { applied: GenealogyImportResult | null; already: boolean } = { applied: null, already: false };
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batchId}))`;
      const fresh = await tx.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (fresh?.status !== "PENDING") {
        state.already = true;
        return;
      }
      let familyIds: string[] = [];
      if (decisions.family.mode === "existing") familyIds = decisions.family.familyIds;
      if (decisions.family.mode === "new") {
        const f = await tx.family.create({ data: { name: decisions.family.name, description: `Angelegt beim GEDCOM-Import ${b.fileName}` } });
        familyId = f.id;
        familyIds = [f.id];
      }
      input.familyIds = familyIds;
      state.applied = await applyGenealogyImport(scope, input, { tx, onInvalid: "skip" });
      if (toMark.length) {
        await tx.importLink.updateMany({ where: { id: { in: toMark.map((i) => i.linkId!) } }, data: { missingSinceBatchId: batchId } });
      }
      await tx.importBatch.update({ where: { id: batchId }, data: { status: "COMPLETED", finishedAt: new Date() } });
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
  if (state.already) {
    const done = await prisma.importBatch.findUnique({ where: { id: batchId } });
    return { ...(done?.counts as unknown as GedcomApplyResult), alreadyApplied: true };
  }
  const r = state.applied!;

  // Löschen nur auf ausdrücklichen Wunsch — über die normalen Dienste
  const deleted = new Map<PlanKind, number>();
  const deleteErrors: string[] = [];
  const order: PlanKind[] = ["citations", "names", "events", "relationships", "sources", "persons"];
  for (const kind of order) {
    for (const item of toDelete.filter((i) => i.kind === kind)) {
      try {
        const id = item.appId!;
        if (kind === "persons") await deletePerson(scope, id, { force: true });
        else if (kind === "relationships") await deleteRelationship(scope, id);
        else if (kind === "events") await deleteEvent(scope, id);
        else if (kind === "names") await deletePersonName(scope, id);
        else if (kind === "citations") await deleteCitation(scope, id);
        else await deleteSource(scope, id);
        deleted.set(kind, (deleted.get(kind) ?? 0) + 1);
      } catch (err) {
        // bereits mit dem Träger gelöscht (Cascade) zählt nicht als Fehler
        if ((err as { code?: string }).code !== "NOT_FOUND") deleteErrors.push(`${item.label}: ${(err as Error).message}`);
      }
    }
  }

  // Fotos (nach dem Import, außerhalb der Transaktion — Netz ist langsam)
  let photos: PhotoDownloadReport | null = null;
  if (decisions.downloadPhotos && mapped.photos.length) {
    const personIds = new Map<string, string>();
    for (const p of mapped.photos) {
      const id = r.ids.persons[p.personRef];
      if (id) personIds.set(p.personRef, id);
    }
    photos = await downloadImportPhotos(scope, { batchId, sourceTreeId, photos: mapped.photos, personIds });
  }

  const result: GedcomApplyResult = {
    batchId,
    alreadyApplied: false,
    durationMs: Math.round(performance.now() - started),
    counts: Object.fromEntries(PLAN_KINDS.map((k) => [k, r.counts[k]])) as GedcomApplyResult["counts"],
    invalid: r.invalid.length,
    externalIds: r.counts.externalIds,
    rawRecords: r.counts.rawRecords,
    supersededRawRecords: r.counts.supersededRawRecords,
    markedMissing: toMark.length,
    deleted: [...deleted.entries()].map(([kind, count]) => ({ kind, count })),
    deleteErrors,
    familyId,
    photos,
  };
  await finishImportBatch(scope, batchId, {
    status: "COMPLETED",
    counts: result,
    warnings: { invalid: r.invalid.slice(0, 500), photoErrors: photos?.failed.slice(0, 500) ?? [] },
  });
  await audit({ ...auditActor(scope), action: "CREATE", entityType: "ImportBatch", entityId: batchId, diff: { gedcom: true, invalid: r.invalid.length, deleted: toDelete.length } });
  return result;
}

/** Rohdaten nur schicken, wo sich der Inhalt gegenüber dem gültigen Stand ändert. */
async function changedRawRecords(
  mapped: MappedImport,
  match: Match,
  decisions: z.infer<typeof applyDecisionsSchema>,
  sourceTreeId: string,
): Promise<MappedImport["rawRecords"]> {
  const carrierId = (r: MappedImport["rawRecords"][number]) =>
    r.personRef
      ? (match.ids.persons.get(r.personRef) ?? decisions.suggestions[r.personRef]?.personId)
      : r.relationshipRef
        ? match.ids.relationships.get(r.relationshipRef)
        : r.sourceRef
          ? match.ids.sources.get(r.sourceRef)
          : undefined;
  const byCarrier = new Map<string, MappedImport["rawRecords"]>();
  const loose: MappedImport["rawRecords"] = [];
  const fresh: MappedImport["rawRecords"] = [];
  for (const r of mapped.rawRecords) {
    if (!r.personRef && !r.relationshipRef && !r.sourceRef) {
      loose.push(r);
      continue;
    }
    const id = carrierId(r);
    if (!id) {
      fresh.push(r);
      continue;
    }
    const list = byCarrier.get(id) ?? [];
    list.push(r);
    byCarrier.set(id, list);
  }
  const ids = [...byCarrier.keys()];
  const existing = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const rows = await prisma.importRawRecord.findMany({
      where: {
        supersededAt: null,
        OR: [{ personId: { in: chunk } }, { relationshipId: { in: chunk } }, { sourceId: { in: chunk } }],
      },
      select: { personId: true, relationshipId: true, sourceId: true, recordType: true, content: true },
    });
    for (const row of rows) {
      const id = (row.personId ?? row.relationshipId ?? row.sourceId)!;
      const set = existing.get(id) ?? new Set<string>();
      set.add(hashRaw(row.recordType, row.content));
      existing.set(id, set);
    }
  }
  const out = [...fresh];
  for (const [id, list] of byCarrier) {
    const have = existing.get(id);
    const same = have && have.size === list.length && list.every((r) => have.has(hashRaw(r.recordType, r.content)));
    if (!same) out.push(...list);
  }
  // Datensätze ohne Träger: nur, wenn nicht schon aus einem Lauf dieses Baums vorhanden
  if (loose.length) {
    const rows = await prisma.importRawRecord.findMany({
      where: { personId: null, relationshipId: null, sourceId: null, batch: { sourceTreeId }, recordType: { in: Object.values(RAW_TYPES) } },
      select: { recordType: true, content: true },
    });
    const have = new Set(rows.map((r) => hashRaw(r.recordType, r.content)));
    out.push(...loose.filter((r) => !have.has(hashRaw(r.recordType, r.content))));
  }
  return out;
}

const hashRaw = (type: string, content: unknown) =>
  createHash("sha256").update(type).update("\u0000").update(stableStringify(JSON.parse(JSON.stringify(content ?? null)))).digest("hex");

// ---------------------------------------------------------------------------
// Verlauf
// ---------------------------------------------------------------------------

export type ImportHistoryEntry = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  status: string;
  format: string;
  fileName: string;
  fileSizeBytes: number;
  hasFile: boolean;
  userName: string | null;
  sourceTreeId: string | null;
  sourceSystemName: string | null;
  summary: { created: number; updated: number; unchanged: number; skippedEdited: number; invalid: number } | null;
  rawRecords: number;
  supersededRawRecords: number;
};

export async function listImportHistory(scope: Scope, limit = 50): Promise<ImportHistoryEntry[]> {
  assertAdmin(scope);
  const rows = await prisma.importBatch.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: Math.max(1, Math.min(200, limit)),
    include: { user: { select: { name: true, email: true } }, _count: { select: { rawRecords: true } } },
  });
  const superseded = await prisma.importRawRecord.groupBy({
    by: ["batchId"],
    where: { batchId: { in: rows.map((r) => r.id) }, supersededAt: { not: null } },
    _count: true,
  });
  const supBy = new Map(superseded.map((s) => [s.batchId, s._count]));
  return rows.map((b) => {
    const c = b.counts as { counts?: Record<string, Record<string, number>>; invalid?: number } | null;
    let summary: ImportHistoryEntry["summary"] = null;
    if (c?.counts) {
      summary = { created: 0, updated: 0, unchanged: 0, skippedEdited: 0, invalid: c.invalid ?? 0 };
      for (const k of Object.values(c.counts)) {
        summary.created += k.created ?? 0;
        summary.updated += k.updated ?? 0;
        summary.unchanged += k.unchanged ?? 0;
        summary.skippedEdited += k.skippedEdited ?? 0;
      }
    }
    return {
      id: b.id,
      createdAt: b.createdAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
      status: b.status,
      format: b.format,
      fileName: b.fileName,
      fileSizeBytes: b.fileSizeBytes,
      hasFile: Boolean(b.storageKey),
      userName: b.user?.name ?? b.user?.email ?? null,
      sourceTreeId: b.sourceTreeId,
      sourceSystemName: b.sourceSystemName,
      summary,
      rawRecords: b._count.rawRecords,
      supersededRawRecords: supBy.get(b.id) ?? 0,
    };
  });
}

