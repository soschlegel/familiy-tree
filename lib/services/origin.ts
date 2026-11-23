import { z } from "zod";

import { audit, auditActor } from "../audit";
import { nameChangeSet } from "../change-sets";
import {
  importLetter,
  MANUAL_KEY,
  MANUAL_ORIGIN,
  originColor,
  UNKNOWN_KEY,
  type OriginChipMap,
  type OriginEntry,
  type TreeOrigin,
} from "../origin";
import { prisma } from "../prisma";
import { canEditPerson, canViewPerson, editableFamilyIds, type Scope } from "../scope";
import { forbiddenError, notFoundError, parseOrThrow, validationError } from "./errors";
import type { LoadedGraph } from "./graph-data";

/**
 * Herkunft sichtbar machen (UEBERGABE, Paket 2): Welche Importe haben eine
 * Person bzw. einen Eintrag geliefert? Regeln für Buchstaben und Farben:
 * lib/origin.ts.
 *
 * Leitlinie: Die App ist die Wahrheit, Importe sind Quellen — Herkunft ist
 * Zusatzinformation. Hier wird deshalb nur gelesen (einzige Ausnahme: der
 * Anzeigename eines Imports).
 *
 * Rechte, an einer Stelle:
 * - Herkunft gibt es nur für Personen, die der Benutzer BEARBEITEN darf
 *   (Administrator oder Bearbeiter einer ihrer Familien) — im Baum, auf der
 *   Personenseite, in der Übersicht und über den KI-Zugang gleich. Alle
 *   Zahlen zählen nur diese Personen.
 * - Der Dateiname eines Imports bleibt Administratoren vorbehalten; alle
 *   anderen sehen den Anzeigenamen bzw. „Import vom <Datum>“.
 * - Die Kennung des Quell-Baums (`sourceTreeId`) verlässt den Dienst nur für
 *   Administratoren (Importverwaltung); sonst steht der Buchstabe dafür.
 */

const DATE = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });

export type ImportSourceInfo = {
  sourceTreeId: string;
  /** Position in der Reihenfolge des ersten Imports (0 = A). */
  index: number;
  letter: string;
  /** Vom Administrator vergebener Name; null = Standard. */
  displayName: string | null;
  firstImportAt: Date | null;
  lastImportAt: Date | null;
  /** Datei des letzten abgeschlossenen Laufs — nur für Administratoren ausgeben. */
  fileName: string | null;
  lastBatchId: string | null;
  batches: number;
};

export type ImportDirectory = {
  sources: ImportSourceInfo[];
  get(sourceTreeId: string | null | undefined): ImportSourceInfo | undefined;
  /** Anzeigename ohne Buchstaben. */
  name(scope: Pick<Scope, "isAdmin">, sourceTreeId: string | null | undefined): string;
  /** Bezeichnung in Fließtext und Listen: „A · Name“. */
  label(scope: Pick<Scope, "isAdmin">, sourceTreeId: string | null | undefined): string;
  /** Chip bzw. Legendeneintrag. */
  entry(scope: Pick<Scope, "isAdmin">, sourceTreeId: string | null | undefined): OriginEntry;
};

const UNKNOWN_NAME = "Import ohne Kennung";

/**
 * Verzeichnis aller Importe (Quell-Bäume) mit Buchstabe, Farbe und Namen.
 *
 * Reihenfolge = Zeitpunkt des ersten abgeschlossenen Laufs; so behält ein
 * Import seinen Buchstaben, wenn später weitere dazukommen oder ein neuer
 * Stand desselben Baums eingelesen wird. Quell-Bäume, zu denen es keinen
 * abgeschlossenen Lauf (mehr) gibt, folgen danach in der Reihenfolge ihres
 * ältesten Herkunftsvermerks — diese teurere Abfrage läuft nur, wenn unter
 * `treeIds` (den Kennungen, die der Aufrufer gleich nachschlagen will) eine
 * unbekannte ist.
 */
export async function loadImportDirectory(treeIds?: Iterable<string | null | undefined>): Promise<ImportDirectory> {
  const [batches, named] = await Promise.all([
    prisma.importBatch.findMany({
      where: { status: "COMPLETED", sourceTreeId: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sourceTreeId: true, fileName: true, createdAt: true },
    }),
    prisma.importSource.findMany({ select: { sourceTreeId: true, displayName: true } }),
  ]);
  const nameOf = new Map(named.map((n) => [n.sourceTreeId, n.displayName]));
  const by = new Map<string, ImportSourceInfo>();
  const add = (id: string, at: Date | null) => {
    const info: ImportSourceInfo = {
      sourceTreeId: id,
      index: by.size,
      letter: importLetter(by.size),
      displayName: nameOf.get(id) ?? null,
      firstImportAt: at,
      lastImportAt: at,
      fileName: null,
      lastBatchId: null,
      batches: 0,
    };
    by.set(id, info);
    return info;
  };
  for (const b of batches) {
    const info = by.get(b.sourceTreeId!) ?? add(b.sourceTreeId!, b.createdAt);
    info.lastImportAt = b.createdAt;
    info.fileName = b.fileName;
    info.lastBatchId = b.id;
    info.batches++;
  }
  let missing = false;
  if (treeIds) for (const id of treeIds) if (id && !by.has(id)) missing = true;
  if (missing) {
    const rest = await prisma.importLink.groupBy({
      by: ["sourceTreeId"],
      where: { sourceTreeId: { not: null } },
      _min: { createdAt: true },
    });
    rest
      .filter((r) => !by.has(r.sourceTreeId!))
      .sort((a, b) => (a._min.createdAt?.getTime() ?? 0) - (b._min.createdAt?.getTime() ?? 0) || a.sourceTreeId!.localeCompare(b.sourceTreeId!))
      .forEach((r) => add(r.sourceTreeId!, r._min.createdAt));
  }

  const get = (id: string | null | undefined) => (id ? by.get(id) : undefined);
  const name: ImportDirectory["name"] = (scope, id) => {
    const info = get(id);
    if (!info) return UNKNOWN_NAME;
    if (info.displayName) return info.displayName;
    if (scope.isAdmin && info.fileName && info.lastImportAt) return `„${info.fileName}“ (${DATE(info.lastImportAt)})`;
    return info.firstImportAt ? `Import vom ${DATE(info.firstImportAt)}` : `Import ${info.letter}`;
  };
  return {
    sources: [...by.values()],
    get,
    name,
    label: (scope, id) => (get(id) ? `${get(id)!.letter} · ${name(scope, id)}` : "importiert"),
    entry: (scope, id) => {
      const info = get(id);
      if (!info) return { key: UNKNOWN_KEY, letter: UNKNOWN_KEY, name: UNKNOWN_NAME, color: null, fg: null, colorName: null, manual: false };
      const c = originColor(info.index);
      return { key: info.letter, letter: info.letter, name: name(scope, id), color: c.bg, fg: c.fg, colorName: c.name, manual: false };
    },
  };
}

/** Herkunft sehen nur Administratoren und Bearbeiter (mindestens einer Familie). */
export function canSeeOrigin(scope: Scope): boolean {
  return scope.isAdmin || editableFamilyIds(scope).length > 0;
}

/** Kennungen der Importe einer Person in der Reihenfolge der Buchstaben; ohne Import „H“. */
function keysOf(dir: ImportDirectory, trees: Iterable<string | null>): string[] {
  const seen = new Map<string, number>();
  for (const t of trees) {
    const info = dir.get(t);
    seen.set(info ? info.letter : UNKNOWN_KEY, info ? info.index : Number.MAX_SAFE_INTEGER);
  }
  return seen.size ? [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k) : [MANUAL_KEY];
}

const isImportKey = (k: string) => k !== MANUAL_KEY;

/**
 * Herkunft der Personen einer Baumansicht — nur aufrufen, wenn der Schalter
 * `?herkunft=1` gesetzt ist. `personIds` begrenzt auf einen Ausschnitt
 * (Fokus-Ansicht); ohne Angabe alle Personen des Graphen.
 */
export async function loadTreeOrigin(scope: Scope, graph: LoadedGraph, personIds?: string[]): Promise<TreeOrigin | null> {
  if (!canSeeOrigin(scope)) return null;
  const editable = (id: string) => {
    const p = graph.persons.get(id);
    return Boolean(p && canEditPerson(scope, p.familyIds));
  };
  const ids = (personIds ?? [...graph.persons.keys()]).filter(editable);
  const links = ids.length
    ? await prisma.importLink.findMany({
        where: { entityType: "PERSON", personId: personIds ? { in: ids } : { not: null } },
        select: { personId: true, sourceTreeId: true },
      })
    : [];
  const dir = await loadImportDirectory(links.map((l) => l.sourceTreeId));
  const treesOf = new Map<string, (string | null)[]>();
  for (const l of links) treesOf.set(l.personId!, [...(treesOf.get(l.personId!) ?? []), l.sourceTreeId]);

  const byPerson: Record<string, string[]> = {};
  const count = new Map<string, number>();
  let connecting = 0;
  for (const id of ids) {
    const keys = keysOf(dir, treesOf.get(id) ?? []);
    byPerson[id] = keys;
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    if (keys.filter(isImportKey).length > 1) connecting++;
  }
  return { entries: entriesFor(scope, dir, count), byPerson, connecting };
}

/** Legendeneinträge zu den vorkommenden Kennungen, Importe zuerst, „von Hand“ zuletzt. */
function entriesFor(scope: Scope, dir: ImportDirectory, count: Map<string, number>): TreeOrigin["entries"] {
  const out: TreeOrigin["entries"] = [];
  for (const s of dir.sources) if (count.has(s.letter)) out.push({ ...dir.entry(scope, s.sourceTreeId), persons: count.get(s.letter)! });
  if (count.has(UNKNOWN_KEY)) out.push({ ...dir.entry(scope, null), persons: count.get(UNKNOWN_KEY)! });
  if (count.has(MANUAL_KEY)) out.push({ ...MANUAL_ORIGIN, persons: count.get(MANUAL_KEY)! });
  return out;
}

// ---------------------------------------------------------------------------
// Personenseite und KI-Zugang
// ---------------------------------------------------------------------------

export type PersonOriginImport = OriginEntry & {
  /** Erster bzw. letzter Import dieser Person aus diesem Import (ISO). */
  firstImportedAt: string | null;
  lastImportedAt: string | null;
  /** Einträge der Quelle, die in dieser Person aufgegangen sind (nach Zusammenführen mehrere). */
  records: number;
  /** Kam ausschließlich beim Zusammenführen mit einer anderen Person dazu. */
  viaMerge: boolean;
};


export type PersonOrigin = {
  imports: PersonOriginImport[];
  /** Kein Import: von Hand (oder über den KI-Zugang) in der App erfasst. */
  manual: boolean;
  /** Aus dem Protokoll: Die Person ist aus mehreren Einträgen zusammengeführt. */
  merged: { entries: number; firstAt: string | null; lastAt: string | null } | null;
  chips: OriginChipMap;
};

/** Wie viele Stufen früherer Zusammenführungen mitgezählt werden (Kette A→B→C). */
const MERGE_DEPTH = 6;

/**
 * Aus wie vielen Einträgen besteht die Person? Jeder `MERGE`-Eintrag im
 * Protokoll steht für einen aufgegangenen Eintrag; war der seinerseits schon
 * ein Ergebnis, zählen dessen Vorgänger mit. Zusammenführungen aus der Zeit
 * vor dem Protokoll bleiben über `ImportLink.mergedFromId` erkennbar.
 */
async function mergeHistory(personId: string, linkMergedFrom: Set<string>, linkMergedAt: Date | null): Promise<PersonOrigin["merged"]> {
  const absorbed = new Set<string>();
  const dates: Date[] = [];
  let frontier = [personId];
  for (let depth = 0; depth < MERGE_DEPTH && frontier.length; depth++) {
    const rows = await prisma.auditLog.findMany({
      where: { action: "MERGE", entityType: "Person", entityId: { in: frontier } },
      select: { createdAt: true, diff: true },
    });
    const next: string[] = [];
    for (const r of rows) {
      const id = (r.diff as { mergeId?: unknown } | null)?.mergeId;
      if (typeof id !== "string" || !id || id === personId || absorbed.has(id)) continue;
      absorbed.add(id);
      dates.push(r.createdAt);
      next.push(id);
    }
    frontier = next;
  }
  for (const id of linkMergedFrom) absorbed.add(id);
  if (absorbed.size === 0) return null;
  if (dates.length === 0 && linkMergedAt) dates.push(linkMergedAt);
  const times = dates.map((d) => d.getTime());
  return {
    entries: absorbed.size + 1,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/**
 * Herkunft einer Person: Importe, Zusammenführungen und die Herkunft ihrer
 * Ereignisse, weiteren Namen, Beziehungen und Belege. `null`, wenn der
 * Benutzer die Person nicht bearbeiten darf (oder es sie nicht gibt).
 *
 * Für die Hauptangaben (Name, Geburt, Tod) gibt es bewusst keine Aussage je
 * Feld: Der Import schreibt sie, die App ändert sie, und eine Geschichte je
 * Feld gibt es erst seit dem Changelog.
 */
export async function getPersonOrigin(scope: Scope, personId: string): Promise<PersonOrigin | null> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, families: { select: { familyId: true } } } });
  if (!person || !canEditPerson(scope, person.families.map((f) => f.familyId))) return null;

  const [links, rels, names] = await Promise.all([
    prisma.importLink.findMany({
      where: { entityType: "PERSON", personId },
      select: { sourceTreeId: true, createdAt: true, importedAt: true, mergedFromId: true, mergedAt: true },
    }),
    prisma.relationship.findMany({
      where: { OR: [{ fromPersonId: personId }, { toPersonId: personId }] },
      select: {
        id: true,
        fromPersonId: true,
        toPersonId: true,
        fromPerson: { select: { families: { select: { familyId: true } } } },
        toPerson: { select: { families: { select: { familyId: true } } } },
      },
    }),
    prisma.personName.findMany({ where: { personId }, select: { id: true } }),
  ]);
  // Beziehungen nur, wenn auch die andere Seite sichtbar ist — sonst verriete
  // der Chip etwas über eine nicht freigegebene Person.
  const relIds = rels
    .filter((r) => canViewPerson(scope, (r.fromPersonId === personId ? r.toPerson : r.fromPerson).families.map((f) => f.familyId)))
    .map((r) => r.id);
  const events = await prisma.event.findMany({
    where: { OR: [{ personId }, { relationshipId: { in: relIds } }] },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  const citations = await prisma.citation.findMany({
    where: { OR: [{ personId }, { relationshipId: { in: relIds } }, { eventId: { in: eventIds } }] },
    select: { id: true },
  });
  const nameIds = names.map((n) => n.id);
  const citationIds = citations.map((c) => c.id);
  const subLinks =
    relIds.length + eventIds.length + nameIds.length + citationIds.length
      ? await prisma.importLink.findMany({
          where: {
            OR: [
              { relationshipId: { in: relIds } },
              { eventId: { in: eventIds } },
              { personNameId: { in: nameIds } },
              { citationId: { in: citationIds } },
            ],
          },
          select: { relationshipId: true, eventId: true, personNameId: true, citationId: true, sourceTreeId: true },
        })
      : [];

  const dir = await loadImportDirectory([...links, ...subLinks].map((l) => l.sourceTreeId));
  const entries: Record<string, OriginEntry> = {};
  const remember = (tree: string | null) => {
    const e = dir.entry(scope, tree);
    entries[e.key] = e;
    return e;
  };

  // Importe der Person
  const perTree = new Map<string, { tree: string | null; rows: typeof links }>();
  for (const l of links) {
    const key = remember(l.sourceTreeId).key;
    const g = perTree.get(key) ?? { tree: l.sourceTreeId, rows: [] };
    g.rows.push(l);
    perTree.set(key, g);
  }
  const imports: PersonOriginImport[] = keysOf(dir, links.map((l) => l.sourceTreeId))
    .filter(isImportKey)
    .map((key) => {
      const g = perTree.get(key)!;
      const first = Math.min(...g.rows.map((r) => r.createdAt.getTime()));
      const last = Math.max(...g.rows.map((r) => r.importedAt.getTime()));
      return {
        ...entries[key],
        firstImportedAt: new Date(first).toISOString(),
        lastImportedAt: new Date(last).toISOString(),
        records: g.rows.length,
        viaMerge: g.rows.every((r) => Boolean(r.mergedFromId)),
      };
    });

  // Chips je Eintrag — nur Importe; ohne Herkunftsvermerk bleibt der Eintrag
  // ohne Chip (er ist in der App entstanden: von Hand, über den KI-Zugang oder
  // beim Zusammenführen als Zweitangabe).
  const collect = (pick: (l: (typeof subLinks)[number]) => string | null) => {
    const trees = new Map<string, (string | null)[]>();
    for (const l of subLinks) {
      const id = pick(l);
      if (id) trees.set(id, [...(trees.get(id) ?? []), l.sourceTreeId]);
    }
    const out: Record<string, string[]> = {};
    for (const [id, list] of trees) {
      for (const t of list) remember(t);
      out[id] = keysOf(dir, list);
    }
    return out;
  };

  const mergedAts = links.map((l) => l.mergedAt?.getTime()).filter((t): t is number => typeof t === "number");
  const merged = await mergeHistory(
    personId,
    new Set(links.map((l) => l.mergedFromId).filter((x): x is string => Boolean(x))),
    mergedAts.length ? new Date(Math.max(...mergedAts)) : null,
  );
  if (imports.length === 0) entries[MANUAL_KEY] = MANUAL_ORIGIN;

  return {
    imports,
    manual: imports.length === 0,
    merged,
    chips: {
      entries,
      events: collect((l) => l.eventId),
      names: collect((l) => l.personNameId),
      relationships: collect((l) => l.relationshipId),
      citations: collect((l) => l.citationId),
    },
  };
}

// ---------------------------------------------------------------------------
// Übersicht: Importe als Kreise, Verbindungspersonen als Kanten
// ---------------------------------------------------------------------------

export type OriginOverview = {
  /** Importe (und „von Hand erfasst“) mit der Zahl ihrer Personen. */
  nodes: (OriginEntry & { persons: number })[];
  /** Je Paar von Importen: Personen, die in beiden vorkommen. */
  edges: { a: string; b: string; persons: number }[];
  /** Personen, die in mehr als einem Import vorkommen. */
  connecting: number;
  /** Alle gezählten Personen. */
  total: number;
};

/** Personen je Import und Verbindungspersonen je Import-Paar — nur bearbeitbare Personen. */
export async function originOverview(scope: Scope): Promise<OriginOverview> {
  if (!canSeeOrigin(scope)) throw forbiddenError("die Herkunft zu sehen");
  const persons = await prisma.person.findMany({
    where: scope.isAdmin ? {} : { families: { some: { familyId: { in: editableFamilyIds(scope) } } } },
    select: { id: true, importLinks: { where: { entityType: "PERSON" }, select: { sourceTreeId: true } } },
  });
  const dir = await loadImportDirectory(persons.flatMap((p) => p.importLinks.map((l) => l.sourceTreeId)));
  const count = new Map<string, number>();
  const pairs = new Map<string, number>();
  let connecting = 0;
  for (const p of persons) {
    const keys = keysOf(dir, p.importLinks.map((l) => l.sourceTreeId));
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    const imports = keys.filter(isImportKey);
    if (imports.length > 1) connecting++;
    for (let i = 0; i < imports.length; i++) {
      for (let j = i + 1; j < imports.length; j++) {
        const k = `${imports[i]}|${imports[j]}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
    }
  }
  const nodes = entriesFor(scope, dir, count);
  const order = new Map(nodes.map((n, i) => [n.key, i]));
  const edges = [...pairs.entries()]
    .map(([k, n]) => ({ a: k.split("|")[0], b: k.split("|")[1], persons: n }))
    .sort((x, y) => order.get(x.a)! - order.get(y.a)! || order.get(x.b)! - order.get(y.b)!);
  return { nodes, edges, connecting, total: persons.length };
}

// ---------------------------------------------------------------------------
// Importverwaltung: Importe auflisten und benennen (nur Administratoren)
// ---------------------------------------------------------------------------

export type ImportSourceDto = OriginEntry & {
  sourceTreeId: string;
  /** Vergebener Name; null = Standard. */
  displayName: string | null;
  /** Name ohne eigene Benennung, wie ihn Bearbeiter sehen. */
  defaultName: string;
  fileName: string | null;
  firstImportAt: string | null;
  lastImportAt: string | null;
  batches: number;
  persons: number;
};

export const IMPORT_NAME_MAX = 60;

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Importe zu verwalten");
}

/** Alle Importe mit Buchstabe, Farbe, Namen und Zahl der Personen. */
export async function listImportSources(scope: Scope): Promise<ImportSourceDto[]> {
  assertAdmin(scope);
  // Personen zählen, nicht Vermerke: Nach dem Zusammenführen innerhalb eines
  // Imports trägt eine Person zwei Vermerke desselben Baums.
  const links = await prisma.importLink.findMany({
    where: { entityType: "PERSON", sourceTreeId: { not: null }, personId: { not: null } },
    distinct: ["sourceTreeId", "personId"],
    select: { sourceTreeId: true },
  });
  const personsOf = new Map<string, number>();
  for (const l of links) personsOf.set(l.sourceTreeId!, (personsOf.get(l.sourceTreeId!) ?? 0) + 1);
  const dir = await loadImportDirectory(personsOf.keys());
  return dir.sources.map((s) => ({
    ...dir.entry(scope, s.sourceTreeId),
    sourceTreeId: s.sourceTreeId,
    displayName: s.displayName,
    defaultName: s.firstImportAt ? `Import vom ${DATE(s.firstImportAt)}` : `Import ${s.letter}`,
    fileName: s.fileName,
    firstImportAt: s.firstImportAt?.toISOString() ?? null,
    lastImportAt: s.lastImportAt?.toISOString() ?? null,
    batches: s.batches,
    persons: personsOf.get(s.sourceTreeId) ?? 0,
  }));
}
const renameInput = z.object({
  sourceTreeId: z.string().min(1).max(300),
  /** Leer = eigene Benennung entfernen (es gilt wieder „Import vom <Datum>“). */
  displayName: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(IMPORT_NAME_MAX, `Höchstens ${IMPORT_NAME_MAX} Zeichen`)),
});

/**
 * Anzeigenamen eines Imports setzen oder (leer) entfernen. Der Name erscheint
 * überall, wo der Import genannt wird, auch für Bearbeiter — er sollte also
 * nichts enthalten, was nur Administratoren wissen dürfen.
 */
export async function renameImportSource(scope: Scope, input: unknown): Promise<ImportSourceDto> {
  assertAdmin(scope);
  const data = parseOrThrow(renameInput.safeParse(input));
  const dir = await loadImportDirectory([data.sourceTreeId]);
  const info = dir.get(data.sourceTreeId);
  if (!info) throw notFoundError("Import");
  const next = data.displayName || null;
  if (next) {
    const taken = dir.sources.some((s) => s.sourceTreeId !== info.sourceTreeId && s.displayName?.toLocaleLowerCase("de") === next.toLocaleLowerCase("de"));
    if (taken) throw validationError([{ path: "displayName", message: "So heißt schon ein anderer Import" }]);
  }
  if (next !== info.displayName) {
    nameChangeSet(scope, next ? `Import ${info.letter} benannt: „${next}“` : `Name des Imports ${info.letter} entfernt`, "APP");
    if (next) {
      await prisma.importSource.upsert({
        where: { sourceTreeId: info.sourceTreeId },
        create: { sourceTreeId: info.sourceTreeId, displayName: next },
        update: { displayName: next },
      });
    } else {
      await prisma.importSource.deleteMany({ where: { sourceTreeId: info.sourceTreeId } });
    }
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "ImportBatch",
      entityId: info.lastBatchId ?? info.sourceTreeId,
      diff: { renamed: true, letter: info.letter, changes: { displayName: { from: info.displayName, to: next } } },
    });
  }
  const list = await listImportSources(scope);
  return list.find((s) => s.sourceTreeId === info.sourceTreeId)!;
}
