import type { Place, PlacePrecision, Prisma } from "@prisma/client";
import { z } from "zod";

import { auditActor, auditData, fieldChanges } from "../audit";
import { nameChangeSet } from "../change-sets";
import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { distanceKm, labelForText, nameKindOf, searchGazetteer, type GeoEntry, type NameKind } from "../places/gazetteer";
import { getGazetteer } from "../places/gazetteer-file";
import { matchPlace } from "../places/match";
import { normalizeForLookup, placeKey, splitPlaceText } from "../places/normalize";
import { canEditPerson, canEditRelationshipBetween, canViewPerson, editableFamilyIds, familyIdsOf } from "../scope";
import type { ChangeSetHandle } from "../change-sets";
import { forbiddenError, notFoundError, ServiceError, validationError } from "./errors";

/**
 * Ortszuordnung (docs/fachlich/karte-und-orte.md): Ortstexte → Koordinaten.
 *
 * Nur für Administratoren. Die Liste enthält die Ortstexte ALLER Personen,
 * auch gesperrter — deshalb prüft jede Funktion hier selbst `isAdmin`
 * (zusätzlich zur Route, lib/authz.ts „place:manage“).
 *
 * Grundsätze:
 * - Automatisch (Ortsverzeichnis) zugeordnet wird nur, was weder von Hand
 *   bestätigt noch von der KI gesetzt ist; MANUAL und AI werden von der
 *   Automatik nie überschrieben oder gelöscht. Die KI (MCP, assign_place)
 *   überschreibt AUTO und AI, nie MANUAL.
 * - Neue Ortstexte werden nach dem Speichern bzw. Importieren im Hintergrund
 *   automatisch zugeordnet (queuePlaceAutoAssign) — nur Texte ohne Zuordnung.
 * - Jede Änderung steht im AuditLog (entityType "Place"); die automatische
 *   Zuordnung bildet ein Paket „Orte automatisch zugeordnet“.
 */

function requireAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Orte zuordnen");
}

// ---------------------------------------------------------------------------
// Vorkommende Ortstexte
// ---------------------------------------------------------------------------

export type PlaceText = {
  key: string;
  /** Häufigste Schreibweise. */
  text: string;
  /** Wie oft der Text vorkommt (Geburt, Tod, Heirat, Scheidung, Ereignisse). */
  count: number;
  /** Anzahl unterschiedlicher Schreibweisen mit diesem Schlüssel. */
  variants: number;
};

/** Alle Ortstexte aller Personen, Beziehungen und Ereignisse, nach Schlüssel. */
export async function collectPlaceTexts(): Promise<Map<string, PlaceText>> {
  const rows = await prisma.$queryRaw<{ t: string; n: number }[]>`
    SELECT t, count(*)::int AS n FROM (
      SELECT "birthPlace" AS t FROM "Person" WHERE "birthPlace" IS NOT NULL
      UNION ALL SELECT "deathPlace" FROM "Person" WHERE "deathPlace" IS NOT NULL
      UNION ALL SELECT "startPlace" FROM "Relationship" WHERE "startPlace" IS NOT NULL
      UNION ALL SELECT "endPlace" FROM "Relationship" WHERE "endPlace" IS NOT NULL
      UNION ALL SELECT "place" FROM "Event" WHERE "place" IS NOT NULL
    ) s
    WHERE btrim(t) <> ''
    GROUP BY t`;
  const byKey = new Map<string, PlaceText & { best: number }>();
  for (const { t, n } of rows) {
    const key = placeKey(t);
    if (!key) continue;
    const e = byKey.get(key);
    if (!e) byKey.set(key, { key, text: t.trim(), count: n, variants: 1, best: n });
    else {
      e.count += n;
      e.variants += 1;
      if (n > e.best) {
        e.best = n;
        e.text = t.trim();
      }
    }
  }
  return new Map([...byKey].map(([k, { best: _best, ...v }]) => [k, v]));
}

// ---------------------------------------------------------------------------
// Liste für die Admin-Seite
// ---------------------------------------------------------------------------

export type PlaceStatus = "open" | "auto" | "ai" | "manual" | "unresolvable";
export const PLACE_STATUSES: readonly PlaceStatus[] = ["open", "auto", "ai", "manual", "unresolvable"];
export const PLACE_STATUS_LABEL: Record<PlaceStatus, string> = {
  open: "offen",
  auto: "automatisch",
  ai: "von KI",
  manual: "bestätigt",
  unresolvable: "nicht zuordenbar",
};

export type PlaceAssignmentDto = {
  source: "AUTO" | "MANUAL" | "AI";
  unresolvable: boolean;
  /** Begründung bzw. Notiz (v.a. der KI). */
  note: string | null;
  /** Als unsicher gesetzt — bitte prüfen. */
  uncertain: boolean;
  precision: PlacePrecision | null;
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  gazetteerId: string | null;
  updatedAt: string;
};

export type PlaceSuggestionDto = {
  gazetteerId: string;
  label: string;
  precision: PlacePrecision;
  latitude: number;
  longitude: number;
  matchedPart: string;
  /** Weitere, weit entfernte Orte gleichen Namens. */
  ambiguous: number;
};

export type PlaceRowDto = PlaceText & {
  status: PlaceStatus;
  assignment: PlaceAssignmentDto | null;
  /** Vorschlag aus dem Ortsverzeichnis (nicht für bestätigte Zeilen). */
  suggestion: PlaceSuggestionDto | null;
};

export type PlaceListDto = {
  rows: PlaceRowDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<PlaceStatus, number> & { all: number; occurrences: number };
};

/** KI-Zuordnungen zählen immer als „von KI“ (auch „nicht zuordenbar“), bis ein Admin bestätigt. */
const statusOf = (p: Place | undefined): PlaceStatus =>
  !p ? "open" : p.source === "AUTO" ? "auto" : p.source === "AI" ? "ai" : p.unresolvable ? "unresolvable" : "manual";

const toAssignment = (p: Place): PlaceAssignmentDto => ({
  source: p.source,
  unresolvable: p.unresolvable,
  note: p.note,
  uncertain: p.uncertain,
  precision: p.precision,
  latitude: p.latitude,
  longitude: p.longitude,
  label: p.label,
  gazetteerId: p.gazetteerId,
  updatedAt: p.updatedAt.toISOString(),
});

export const PLACE_PAGE_SIZE = 50;

export async function listPlaces(
  scope: Scope,
  opts: { status?: PlaceStatus | "all"; q?: string; page?: number } = {},
): Promise<PlaceListDto> {
  requireAdmin(scope);
  const [texts, places] = await Promise.all([collectPlaceTexts(), prisma.place.findMany()]);
  const byKey = new Map(places.map((p) => [p.key, p]));

  const counts = { open: 0, auto: 0, ai: 0, manual: 0, unresolvable: 0, all: texts.size, occurrences: 0 };
  for (const t of texts.values()) {
    counts[statusOf(byKey.get(t.key))]++;
    counts.occurrences += t.count;
  }

  const status = opts.status ?? "all";
  const q = opts.q?.trim() ? placeKey(opts.q) : null;
  const filtered = [...texts.values()]
    .filter((t) => status === "all" || statusOf(byKey.get(t.key)) === status)
    .filter((t) => !q || t.key.includes(q) || (byKey.get(t.key)?.label ?? "").toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "de"));

  const pageSize = PLACE_PAGE_SIZE;
  const page = Math.max(1, Math.min(opts.page ?? 1, Math.max(1, Math.ceil(filtered.length / pageSize))));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Vorschläge nur für die angezeigte Seite (das Verzeichnis wird dafür einmal geladen).
  const needsSuggestion = slice.some((t) => byKey.get(t.key)?.source !== "MANUAL");
  const gaz = needsSuggestion ? await getGazetteer() : null;

  const rows: PlaceRowDto[] = slice.map((t) => {
    const p = byKey.get(t.key);
    let suggestion: PlaceSuggestionDto | null = null;
    if (gaz && p?.source !== "MANUAL") {
      const m = matchPlace(gaz, t.text);
      if (m) {
        suggestion = {
          gazetteerId: m.entry.id,
          label: m.label,
          precision: m.precision,
          latitude: m.entry.lat,
          longitude: m.entry.lon,
          matchedPart: m.matchedPart,
          ambiguous: m.ambiguous,
        };
      }
    }
    return { ...t, status: statusOf(p), assignment: p ? toAssignment(p) : null, suggestion };
  });

  return { rows, total: filtered.length, page, pageSize, counts };
}

// ---------------------------------------------------------------------------
// Suche im Ortsverzeichnis
// ---------------------------------------------------------------------------

export type GazetteerHitDto = {
  gazetteerId: string;
  label: string;
  precision: PlacePrecision;
  latitude: number;
  longitude: number;
  countryCode: string;
  population: number;
};

const PRECISION_OF_KIND = { P: "PLACE", A: "REGION", H: "REGION", C: "COUNTRY" } as const;

export async function searchPlaceDirectory(scope: Scope, query: string): Promise<GazetteerHitDto[]> {
  requireAdmin(scope);
  const gaz = await getGazetteer();
  return searchGazetteer(gaz, query, 20).map((e) => ({
    gazetteerId: e.id,
    label: e.label,
    precision: PRECISION_OF_KIND[e.kind],
    latitude: e.lat,
    longitude: e.lon,
    countryCode: e.cc,
    population: e.pop,
  }));
}

// ---------------------------------------------------------------------------
// Von Hand zuordnen
// ---------------------------------------------------------------------------

export const placeAssignSchema = z.discriminatedUnion("action", [
  // Eintrag des Verzeichnisses übernehmen (auch: Vorschlag bestätigen).
  z.object({ action: z.literal("directory"), text: z.string().trim().min(1).max(500), gazetteerId: z.string().min(1).max(32) }),
  // Koordinaten von Hand.
  z.object({
    action: z.literal("coordinates"),
    text: z.string().trim().min(1).max(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    precision: z.enum(["PLACE", "REGION", "COUNTRY"]),
    label: z.string().trim().max(200).optional().nullable(),
  }),
  // Bestehende automatische Zuordnung so bestätigen.
  z.object({ action: z.literal("confirm"), text: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("unresolvable"), text: z.string().trim().min(1).max(500) }),
  // Bestätigung bzw. „nicht zuordenbar“ aufheben: der Text ist wieder offen.
  z.object({ action: z.literal("reset"), text: z.string().trim().min(1).max(500) }),
]);
export type PlaceAssignInput = z.infer<typeof placeAssignSchema>;

/** Felder einer Zeile, die das Audit vorher → nachher vergleicht. */
const AUDIT_FIELDS = [
  "source",
  "unresolvable",
  "precision",
  "latitude",
  "longitude",
  "label",
  "countryCode",
  "gazetteerId",
  "note",
  "uncertain",
] as const;
type PlaceFields = Pick<Place, (typeof AUDIT_FIELDS)[number]>;

const EMPTY: PlaceFields = {
  source: "AUTO",
  unresolvable: false,
  precision: null,
  latitude: null,
  longitude: null,
  label: null,
  countryCode: null,
  gazetteerId: null,
  note: null,
  uncertain: false,
};

function pick(p: Place | PlaceFields): PlaceFields {
  return Object.fromEntries(AUDIT_FIELDS.map((k) => [k, p[k]])) as PlaceFields;
}

export async function assignPlace(scope: Scope, input: PlaceAssignInput): Promise<PlaceRowDto["assignment"]> {
  requireAdmin(scope);
  const key = placeKey(input.text);
  if (!key) throw new ServiceError("VALIDATION", "Ortstext fehlt.");
  const existing = await prisma.place.findUnique({ where: { key } });
  nameChangeSet(scope, `Ort zugeordnet: „${input.text.slice(0, 80)}“`);

  if (input.action === "reset") {
    if (!existing) return null;
    await prisma.place.delete({ where: { key } });
    await prisma.auditLog.create({
      data: await auditData({
        ...auditActor(scope),
        action: "DELETE",
        entityType: "Place",
        entityId: existing.id,
        diff: { subject: existing.text, before: pick(existing) },
      }),
    });
    return null;
  }

  let next: PlaceFields;
  switch (input.action) {
    case "directory": {
      const gaz = await getGazetteer();
      const idx = gaz.entries.findIndex((e) => e.id === input.gazetteerId);
      if (idx < 0) throw notFoundError("Ort im Verzeichnis");
      const e = gaz.entries[idx];
      next = {
        source: "MANUAL",
        unresolvable: false,
        precision: PRECISION_OF_KIND[e.kind],
        latitude: e.lat,
        longitude: e.lon,
        label: labelForText(gaz, e, input.text),
        countryCode: e.cc || null,
        gazetteerId: e.id,
        note: null,
        uncertain: false,
      };
      break;
    }
    case "coordinates":
      next = {
        source: "MANUAL",
        unresolvable: false,
        precision: input.precision,
        latitude: Math.round(input.latitude * 1e5) / 1e5,
        longitude: Math.round(input.longitude * 1e5) / 1e5,
        label: input.label?.trim() || input.text.trim(),
        countryCode: null,
        gazetteerId: null,
        note: null,
        uncertain: false,
      };
      break;
    case "confirm":
      // Bestätigen übernimmt eine automatische oder KI-Zuordnung als von Hand
      // bestätigt; bei der KI auch ein „nicht zuordenbar“. Die Notiz bleibt.
      if (!existing || (existing.source !== "AI" && (existing.unresolvable || existing.latitude === null))) {
        throw new ServiceError("CONFLICT", "Keine Zuordnung zum Bestätigen — bitte einen Ort wählen.");
      }
      next = { ...pick(existing), source: "MANUAL", uncertain: false };
      break;
    case "unresolvable":
      next = { ...EMPTY, source: "MANUAL", unresolvable: true };
      break;
  }

  const saved = await upsertPlace(scope, key, input.text, existing, next);
  return toAssignment(saved);
}

async function upsertPlace(scope: Scope, key: string, text: string, existing: Place | null, next: PlaceFields): Promise<Place> {
  if (!existing) {
    const created = await prisma.place.create({ data: { key, text: text.trim(), ...next } });
    await prisma.auditLog.create({
      data: await auditData({
        ...auditActor(scope),
        action: "CREATE",
        entityType: "Place",
        entityId: created.id,
        diff: { subject: created.text, ...next },
      }),
    });
    return created;
  }
  const changes = fieldChanges(pick(existing), next as unknown as Record<string, unknown>);
  const updated = await prisma.place.update({ where: { key }, data: { text: text.trim(), ...next } });
  if (Object.keys(changes).length) {
    await prisma.auditLog.create({
      data: await auditData({
        ...auditActor(scope),
        action: "UPDATE",
        entityType: "Place",
        entityId: existing.id,
        diff: { subject: updated.text, changes },
      }),
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Automatisch zuordnen
// ---------------------------------------------------------------------------

export type AutoAssignResult = {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Ortstexte, für die das Verzeichnis nichts fand. */
  unmatched: number;
  /** Von Hand bestätigt bzw. „nicht zuordenbar“ — nicht angefasst. */
  manual: number;
  /** Von der KI gesetzt — nicht angefasst (ein Admin bestätigt oder ändert). */
  ai: number;
  ms: number;
};

const sameFields = (a: PlaceFields, b: PlaceFields) => AUDIT_FIELDS.every((k) => a[k] === b[k]);

/**
 * Ordnet alle nicht von Hand bestätigten Ortstexte neu aus dem Verzeichnis
 * zu: neue werden angelegt, geänderte Treffer aktualisiert, Texte ohne
 * Treffer (und nicht mehr vorkommende) verlieren ihre automatische Zuordnung.
 * Von Hand Bestätigtes bleibt unberührt.
 */
export async function autoAssignPlaces(scope: Scope): Promise<AutoAssignResult> {
  requireAdmin(scope);
  const started = Date.now();
  const [texts, places, gaz] = await Promise.all([collectPlaceTexts(), prisma.place.findMany(), getGazetteer()]);
  const byKey = new Map(places.map((p) => [p.key, p]));
  nameChangeSet(scope, "Orte automatisch zugeordnet");

  const result: AutoAssignResult = { created: 0, updated: 0, removed: 0, unchanged: 0, unmatched: 0, manual: 0, ai: 0, ms: 0 };
  const creates: Prisma.PlaceCreateManyInput[] = [];
  const updates: { existing: Place; text: string; next: PlaceFields }[] = [];
  const removals: Place[] = [];

  for (const t of texts.values()) {
    const existing = byKey.get(t.key);
    if (existing?.source === "MANUAL") {
      result.manual++;
      continue;
    }
    if (existing?.source === "AI") {
      result.ai++;
      continue;
    }
    const m = matchPlace(gaz, t.text);
    if (!m) {
      result.unmatched++;
      if (existing) removals.push(existing);
      continue;
    }
    const next = autoFields(m);
    if (!existing) creates.push({ key: t.key, text: t.text, ...next });
    else if (!sameFields(pick(existing), next)) updates.push({ existing, text: t.text, next });
    else result.unchanged++;
  }
  // Automatische Zuordnungen zu Texten, die nirgends mehr vorkommen.
  for (const p of places) if (p.source === "AUTO" && !texts.has(p.key)) removals.push(p);

  if (creates.length) await prisma.place.createMany({ data: creates, skipDuplicates: true });
  const createdRows = creates.length
    ? await prisma.place.findMany({ where: { key: { in: creates.map((c) => c.key) }, source: "AUTO" } })
    : [];
  for (const chunk of chunks(updates, 200)) {
    await prisma.$transaction(
      chunk.map((u) => prisma.place.update({ where: { id: u.existing.id }, data: { text: u.text, ...u.next } })),
    );
  }
  if (removals.length) await prisma.place.deleteMany({ where: { id: { in: removals.map((p) => p.id) }, source: "AUTO" } });

  result.created = createdRows.length;
  result.updated = updates.length;
  result.removed = removals.length;

  // Protokoll: ein Eintrag je geänderter Zuordnung, alle in einem Paket.
  const actor = auditActor(scope);
  const entries: Prisma.AuditLogUncheckedCreateInput[] = [];
  for (const p of createdRows) {
    entries.push(
      await auditData({ ...actor, action: "CREATE", entityType: "Place", entityId: p.id, diff: { subject: p.text, ...pick(p) } }),
    );
  }
  for (const u of updates) {
    entries.push(
      await auditData({
        ...actor,
        action: "UPDATE",
        entityType: "Place",
        entityId: u.existing.id,
        diff: { subject: u.text, changes: fieldChanges(pick(u.existing), u.next as unknown as Record<string, unknown>) },
      }),
    );
  }
  for (const p of removals) {
    entries.push(
      await auditData({ ...actor, action: "DELETE", entityType: "Place", entityId: p.id, diff: { subject: p.text, before: pick(p) } }),
    );
  }
  for (const chunk of chunks(entries, 1000)) await prisma.auditLog.createMany({ data: chunk });

  result.ms = Date.now() - started;
  return result;
}

const autoFields = (m: NonNullable<ReturnType<typeof matchPlace>>): PlaceFields => ({
  source: "AUTO",
  unresolvable: false,
  precision: m.precision,
  latitude: m.entry.lat,
  longitude: m.entry.lon,
  label: m.label,
  countryCode: m.entry.cc || null,
  gazetteerId: m.entry.id,
  note: null,
  uncertain: false,
});

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Neue Ortstexte nach dem Speichern automatisch zuordnen (im Hintergrund)
// ---------------------------------------------------------------------------

export type NewPlaceTextsResult = { checked: number; created: number; unmatched: number };

/**
 * Ordnet Ortstexte OHNE vorhandene Zuordnung aus dem Ortsverzeichnis zu —
 * `texts` angegeben: nur diese (nach Speichern einer Person, Beziehung,
 * eines Ereignisses), sonst alle offenen (nach einem Import). Vorhandene
 * Zuordnungen (automatisch, KI, von Hand) bleiben unberührt; Texte ohne
 * Treffer bleiben offen. Protokoll: Paket „Orte automatisch zugeordnet“ im
 * Namen dessen, der gespeichert hat (mit Kanal/Schlüssel bei MCP).
 *
 * Keine Rechteprüfung: Der Aufrufer hat gerade selbst gespeichert, und die
 * Zuordnung gibt niemandem etwas preis (die Tabelle sehen nur Admins).
 */
export async function assignNewPlaceTexts(
  actor: Pick<Scope, "userId" | "via">,
  texts?: string[],
): Promise<NewPlaceTextsResult> {
  const started = new Date();
  const wanted = new Map<string, string>();
  if (texts) {
    for (const t of texts) {
      const key = placeKey(t);
      if (key && !wanted.has(key)) wanted.set(key, t.trim());
    }
  } else {
    for (const t of (await collectPlaceTexts()).values()) wanted.set(t.key, t.text);
  }
  const result: NewPlaceTextsResult = { checked: 0, created: 0, unmatched: 0 };
  if (!wanted.size) return result;

  const existing = await prisma.place.findMany({
    where: texts ? { key: { in: [...wanted.keys()] } } : undefined,
    select: { key: true },
  });
  for (const p of existing) wanted.delete(p.key);
  result.checked = wanted.size;
  if (!wanted.size) return result;

  const gaz = await getGazetteer();
  const creates: Prisma.PlaceCreateManyInput[] = [];
  for (const [key, text] of wanted) {
    const m = matchPlace(gaz, text);
    if (m) creates.push({ key, text, ...autoFields(m) });
    else result.unmatched++;
  }
  if (!creates.length) return result;

  await prisma.place.createMany({ data: creates, skipDuplicates: true });
  // Nur selbst angelegte Zeilen protokollieren (ein paralleler Lauf kann
  // denselben Text schon angelegt haben).
  const createdRows = await prisma.place.findMany({
    where: { key: { in: creates.map((c) => c.key) }, source: "AUTO", createdAt: { gte: started } },
  });
  result.created = createdRows.length;

  const handle: ChangeSetHandle = { kind: "APP", title: "Orte automatisch zugeordnet" };
  const actorFields = auditActor({ userId: actor.userId, via: actor.via, changeSet: handle });
  const entries: Prisma.AuditLogUncheckedCreateInput[] = [];
  for (const p of createdRows) {
    entries.push(
      await auditData({ ...actorFields, action: "CREATE", entityType: "Place", entityId: p.id, diff: { subject: p.text, ...pick(p) } }),
    );
  }
  for (const chunk of chunks(entries, 1000)) await prisma.auditLog.createMany({ data: chunk });
  return result;
}

const queue = ((globalThis as unknown as { __placeAutoAssign?: { tail: Promise<void> } }).__placeAutoAssign ??= {
  tail: Promise.resolve(),
});

/** Abschaltbar für Tests (vitest.config.ts setzt PLACE_AUTO_ASSIGN=off). */
export const placeAutoAssignEnabled = () => process.env.PLACE_AUTO_ASSIGN !== "off";

/** So lange wartet ein einzelnes Speichern höchstens auf die Zuordnung. */
const SAVE_WAIT_MS = 1500;

/**
 * Stößt die automatische Zuordnung neuer Ortstexte an. Ein Fehler landet nur
 * im Server-Log und lässt das Speichern nie scheitern; Läufe werden
 * nacheinander ausgeführt.
 *
 * - Mit `texts` (Speichern einer Person, Beziehung, eines Ereignisses): Das
 *   Ergebnis ist ein Versprechen, das erfüllt ist, sobald dieser Lauf fertig
 *   ist — spätestens nach `SAVE_WAIT_MS`. Die Dienste warten darauf, damit
 *   die Seite nach dem Speichern den Ort gleich als Verweis zeigt (sonst
 *   stünde dort bis zum Neuladen der reine Text). Dauert es länger (erstes
 *   Laden des Ortsverzeichnisses), läuft die Zuordnung im Hintergrund weiter.
 * - Ohne `texts` (nach Importen: alle offenen Ortstexte): kehrt sofort zurück.
 *
 * Das Versprechen wird nie abgelehnt.
 */
export function queuePlaceAutoAssign(scope: Pick<Scope, "userId" | "via">, texts?: (string | null | undefined)[]): Promise<void> {
  try {
    if (!placeAutoAssignEnabled()) return Promise.resolve();
    const list = texts?.map((t) => t?.trim()).filter((t): t is string => Boolean(t));
    if (list && list.length === 0) return Promise.resolve();
    const actor = { userId: scope.userId, via: scope.via };
    const run = (queue.tail = queue.tail
      .then(() => assignNewPlaceTexts(actor, list))
      .then(
        () => undefined,
        (err: unknown) => console.error("[places] Automatische Zuordnung neuer Ortstexte fehlgeschlagen:", err),
      ));
    if (!list) return Promise.resolve();
    return Promise.race([run, new Promise<void>((resolve) => setTimeout(resolve, SAVE_WAIT_MS).unref?.())]);
  } catch (err) {
    console.error("[places] Automatische Zuordnung nicht gestartet:", err);
    return Promise.resolve();
  }
}

/** Wartet, bis alle angestoßenen Hintergrund-Zuordnungen fertig sind (Tests). */
export function placeAutoAssignIdle(): Promise<void> {
  return queue.tail;
}

// ---------------------------------------------------------------------------
// Eigene Orte (von Hand oder von der KI mit Koordinaten angelegt)
// ---------------------------------------------------------------------------

type OwnPlace = Pick<Place, "key" | "text" | "label" | "latitude" | "longitude" | "precision" | "source">;

/** Zuordnungen mit eigenen Koordinaten (nicht aus dem Verzeichnis): Wüstungen, Höfe, Weiler … */
async function loadOwnPlaces(): Promise<OwnPlace[]> {
  return prisma.place.findMany({
    where: { gazetteerId: null, unresolvable: false, latitude: { not: null }, longitude: { not: null } },
    select: { key: true, text: true, label: true, latitude: true, longitude: true, precision: true, source: true },
  });
}

/**
 * Hat das Verzeichnis den ersten (spezifischsten) Teil als Ort getroffen?
 * Sonst geht ein eigener Ort, der zu diesem Teil passt, vor („Hof Lindenau,
 * Amt Peine“: nicht Peine, sondern der eigene Hof).
 */
function matchesFirstPart(m: NonNullable<ReturnType<typeof matchPlace>>, text: string): boolean {
  return m.precision === "PLACE" && m.matchedPart === splitPlaceText(text)[0]?.raw;
}

const firstNameKey = (s: string) => normalizeForLookup(s.split(/[,;]/)[0].replace(/\([^)]*\)/g, " "));

/** Eigene Orte, deren Text bzw. Bezeichnung (erster Teil) zum ersten Teil des Ortstexts passt; gleicher Text zuerst. */
function matchOwnPlaces(own: OwnPlace[], text: string): { place: OwnPlace; exact: boolean }[] {
  const key = placeKey(text);
  const first = splitPlaceText(text)[0];
  const lookups = new Set([firstNameKey(text), ...(first ? [...first.lookups, ...first.fallbacks] : [])].filter(Boolean));
  return own
    .map((place) => ({ place, exact: place.key === key }))
    .filter(({ place, exact }) => exact || lookups.has(firstNameKey(place.text)) || (place.label ? lookups.has(firstNameKey(place.label)) : false))
    .sort((a, b) => Number(b.exact) - Number(a.exact));
}

// ---------------------------------------------------------------------------
// Vorschlag am Eingabefeld (Person, Ereignis, Beziehung)
// ---------------------------------------------------------------------------

export type PlaceHintDto = {
  /** found: ein Ort erkannt; ambiguous: erkannt, aber es gibt weitere gleichen Namens; none: nichts gefunden. */
  status: "found" | "ambiguous" | "none";
  /** Erkannt als eigener Ort (von Hand bzw. von der KI angelegt), nicht aus dem Verzeichnis. */
  own: boolean;
  label: string | null;
  precision: PlacePrecision | null;
  /** Teil des Texts, der erkannt wurde. */
  matchedPart: string | null;
  /** Erkannt über den früheren bzw. deutschen Namen („Breslau“ für Wrocław). */
  formerName: string | null;
  /** Erkannt über einen weiteren Namen (z.B. in anderer Sprache). */
  otherName: string | null;
  /** Zahl weiterer Orte gleichen Namens. */
  ambiguous: number;
};

const NONE: PlaceHintDto = {
  status: "none",
  own: false,
  label: null,
  precision: null,
  matchedPart: null,
  formerName: null,
  otherName: null,
  ambiguous: 0,
};

/** Wer irgendwo bearbeiten darf (Admin oder Bearbeiter einer Familie). */
function requireEditor(scope: Scope) {
  if (!scope.isAdmin && editableFamilyIds(scope).length === 0) throw forbiddenError("Ortsvorschläge");
}

/**
 * Welcher Ort zu einem eingegebenen Ortstext erkannt wird — dieselbe Regel
 * wie die automatische Zuordnung (matchPlace), dazu eigene Orte. Liefert nur
 * Daten des Verzeichnisses bzw. Bezeichnung und Genauigkeit eigener Orte,
 * nichts über Personen. Für Admins und Bearbeiter.
 */
export async function placeHint(scope: Scope, text: string): Promise<PlaceHintDto> {
  requireEditor(scope);
  const t = text.trim().slice(0, 500);
  if (normalizeForLookup(t).length < 2) return NONE;
  const [gaz, own] = await Promise.all([getGazetteer(), loadOwnPlaces()]);
  const owns = matchOwnPlaces(own, t);
  const ownHint = (o: OwnPlace, n: number): PlaceHintDto => ({
    ...NONE,
    status: n > 1 ? "ambiguous" : "found",
    own: true,
    label: o.label ?? o.text,
    precision: o.precision,
    matchedPart: t.split(/[,;]/)[0].trim(),
    ambiguous: n - 1,
  });
  if (owns[0]?.exact) return ownHint(owns[0].place, 1);
  const m = matchPlace(gaz, t);
  if (!m) return owns.length ? ownHint(owns[0].place, owns.length) : NONE;
  if (owns.length && !matchesFirstPart(m, t)) return ownHint(owns[0].place, owns.length);
  const name = nameKindOf(m.entry, m.matchedPart);
  const ambiguous = m.ambiguous + owns.length;
  return {
    status: ambiguous > 0 ? "ambiguous" : "found",
    own: false,
    label: m.label,
    precision: m.precision,
    matchedPart: m.matchedPart,
    formerName: name.kind === "historic" ? name.name : null,
    otherName: name.kind === "alternate" ? name.name : null,
    ambiguous,
  };
}

/** Lädt das Ortsverzeichnis vorab (beim Öffnen eines Formulars), ohne zu warten. */
export function warmPlaceDirectory(scope: Scope): void {
  requireEditor(scope);
  void getGazetteer().catch((err: unknown) => console.error("[places] Ortsverzeichnis nicht ladbar:", err));
}

// ---------------------------------------------------------------------------
// KI (MCP): Kandidaten, Liste mit Kontext, Zuordnung setzen
// ---------------------------------------------------------------------------

const KIND_LABEL = { P: "Ort", A: "Region", H: "historische Landschaft", C: "Land" } as const;

export type PlaceCandidateDto = {
  /** directory: mitgeliefertes Verzeichnis; own: eigener Ort (von Hand/KI mit Koordinaten angelegt). */
  source: "directory" | "own";
  gazetteerId: string | null;
  label: string;
  kind: string;
  precision: PlacePrecision | null;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  population: number | null;
  /** Name, über den der Kandidat gefunden wurde, und welche Art Name das ist. */
  matchedName: string | null;
  nameKind: NameKind | null;
  /** Entfernung zum empfohlenen Kandidaten. */
  distanceKm: number | null;
  recommended: boolean;
};

export type PlaceSuggestResult = {
  text: string;
  recommended: PlaceCandidateDto | null;
  /** Weitere, weit entfernte Orte gleichen Namens (wie „mehrdeutig“ auf /admin/places). */
  ambiguous: number;
  candidates: PlaceCandidateDto[];
  /** Vorhandene Zuordnung dieses Texts — nur für Administratoren. */
  current?: PlaceAssignmentDto & { status: PlaceStatus };
};

/**
 * Kandidaten für einen Ortstext: die automatische Wahl samt den übrigen
 * gleichnamigen Kandidaten, passende eigene Orte und — ohne Treffer — die
 * Präfixsuche im Verzeichnis. Liest nur das Verzeichnis und die eigenen Orte
 * (Bezeichnung, Koordinaten); die vorhandene Zuordnung des Texts nur für Admins.
 */
export async function suggestPlaces(scope: Scope, text: string): Promise<PlaceSuggestResult> {
  const t = text.trim().slice(0, 500);
  const [gaz, own] = await Promise.all([getGazetteer(), loadOwnPlaces()]);
  const m = t ? matchPlace(gaz, t) : null;
  const owns = t ? matchOwnPlaces(own, t) : [];

  const fromEntry = (e: GeoEntry, part: string | null, recommended: boolean): PlaceCandidateDto => {
    const name = part ? nameKindOf(e, part) : null;
    return {
      source: "directory",
      gazetteerId: e.id,
      label: part ? labelForText(gaz, e, part) : labelForText(gaz, e, ""),
      kind: KIND_LABEL[e.kind],
      precision: PRECISION_OF_KIND[e.kind],
      latitude: e.lat,
      longitude: e.lon,
      countryCode: e.cc || null,
      population: e.pop || null,
      matchedName: name?.name ?? null,
      nameKind: name?.kind ?? null,
      distanceKm: null,
      recommended,
    };
  };
  const ownCandidates = owns.map(({ place, exact }) => ({
    source: "own" as const,
    gazetteerId: null,
    label: place.label ?? place.text,
    kind: "eigener Ort",
    precision: place.precision,
    latitude: place.latitude!,
    longitude: place.longitude!,
    countryCode: null,
    population: null,
    matchedName: place.text,
    nameKind: null,
    distanceKm: null,
    recommended: exact,
  }));

  // Eigener Ort vor dem Verzeichnis, wenn dieses nur einen allgemeineren Teil traf.
  if (ownCandidates.length && !ownCandidates[0].recommended && (!m || !matchesFirstPart(m, t))) {
    ownCandidates[0].recommended = true;
  }
  let candidates: PlaceCandidateDto[];
  if (ownCandidates[0]?.recommended) {
    candidates = [...ownCandidates, ...(m ? [m.entry, ...m.others].map((e) => fromEntry(e, m.matchedPart, false)) : [])];
  } else if (m) {
    candidates = [fromEntry(m.entry, m.matchedPart, true), ...m.others.map((e) => fromEntry(e, m.matchedPart, false)), ...ownCandidates];
  } else {
    const first = splitPlaceText(t)[0]?.raw ?? t;
    candidates = [...ownCandidates, ...searchGazetteer(gaz, first, 10).map((e) => fromEntry(e, first, false))];
  }
  const recommended = candidates.find((c) => c.recommended) ?? null;
  if (recommended) {
    const from = { lat: recommended.latitude, lon: recommended.longitude };
    for (const c of candidates) {
      if (c !== recommended) c.distanceKm = Math.round(distanceKm(from, { lat: c.latitude, lon: c.longitude }));
    }
  }
  const result: PlaceSuggestResult = {
    text: t,
    recommended,
    ambiguous: (m?.ambiguous ?? 0) + owns.filter((o) => !o.exact).length,
    candidates,
  };
  if (scope.isAdmin && t) {
    const p = await prisma.place.findUnique({ where: { key: placeKey(t) } });
    if (p) result.current = { ...toAssignment(p), status: statusOf(p) };
  }
  return result;
}

export type PlaceContextDto = {
  /** Feldart → Anzahl: birth, death, marriage (Beginn einer Partnerschaft), divorce (Ende), event:<Ereignisart>. */
  fields: Record<string, number>;
  fromYear: number | null;
  toYear: number | null;
};

/**
 * Kontext zu Ortstexten für die KI (nur Admins): in welchen Feldarten und
 * welchem Zeitraum sie vorkommen — ohne Personen. Schlüssel = placeKey.
 */
export async function placeTextContext(scope: Scope, keys: string[]): Promise<Map<string, PlaceContextDto>> {
  requireAdmin(scope);
  const out = new Map<string, PlaceContextDto>();
  if (!keys.length) return out;
  const wanted = new Set(keys);
  const rows = await prisma.$queryRaw<{ t: string; kind: string; n: number; ymin: number | null; ymax: number | null }[]>`
    SELECT t, kind, count(*)::int AS n, min(y)::int AS ymin, max(y)::int AS ymax FROM (
      SELECT "birthPlace" AS t, 'birth' AS kind, extract(year FROM "birthDate") AS y FROM "Person" WHERE "birthPlace" IS NOT NULL
      UNION ALL SELECT "deathPlace", 'death', extract(year FROM "deathDate") FROM "Person" WHERE "deathPlace" IS NOT NULL
      UNION ALL SELECT "startPlace", 'marriage', extract(year FROM "startDate") FROM "Relationship" WHERE "startPlace" IS NOT NULL
      UNION ALL SELECT "endPlace", 'divorce', extract(year FROM "endDate") FROM "Relationship" WHERE "endPlace" IS NOT NULL
      UNION ALL SELECT "place", 'event:' || "type"::text, extract(year FROM "date") FROM "Event" WHERE "place" IS NOT NULL
    ) s
    WHERE btrim(t) <> ''
    GROUP BY t, kind`;
  for (const r of rows) {
    const key = placeKey(r.t);
    if (!wanted.has(key)) continue;
    let c = out.get(key);
    if (!c) out.set(key, (c = { fields: {}, fromYear: null, toYear: null }));
    c.fields[r.kind] = (c.fields[r.kind] ?? 0) + r.n;
    if (r.ymin !== null) c.fromYear = c.fromYear === null ? r.ymin : Math.min(c.fromYear, r.ymin);
    if (r.ymax !== null) c.toYear = c.toYear === null ? r.ymax : Math.max(c.toYear, r.ymax);
  }
  return out;
}

export const AI_ASSIGN_MAX = 50;

export const aiPlaceAssignSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    gazetteerId: z.string().min(1).max(32).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    label: z.string().trim().min(1).max(200).optional(),
    precision: z.enum(["PLACE", "REGION", "COUNTRY"]).optional(),
    unresolvable: z.literal(true).optional(),
    uncertain: z.boolean().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    const coords = v.latitude !== undefined || v.longitude !== undefined;
    const modes = [v.gazetteerId !== undefined, coords, v.unresolvable === true].filter(Boolean).length;
    if (modes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Genau eines angeben: gazetteer_id, latitude+longitude+label oder unresolvable.",
      });
    }
    if (coords && (v.latitude === undefined || v.longitude === undefined || !v.label)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Eigener Ort: latitude, longitude und label angeben." });
    }
  });
export type AiPlaceAssignInput = z.infer<typeof aiPlaceAssignSchema>;

export type AiPlaceAssignResult = {
  text: string;
  ok: boolean;
  status?: PlaceStatus;
  label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Vorherige Herkunft, falls überschrieben (AUTO bzw. AI). */
  replaced?: "AUTO" | "AI";
  error?: string;
};

/**
 * Zuordnungen des KI-Assistenten (MCP assign_place), bis AI_ASSIGN_MAX je
 * Aufruf: Verzeichniseintrag, eigener Ort mit Koordinaten oder „nicht
 * zuordenbar“, gekennzeichnet als Herkunft AI, optional unsicher und mit
 * Begründung. Überschreibt AUTO und AI, nie MANUAL (Eintrag mit Fehler,
 * die übrigen laufen weiter). Nur Administratoren, wie /admin/places.
 */
export async function assignPlacesByAi(scope: Scope, raw: unknown[]): Promise<AiPlaceAssignResult[]> {
  requireAdmin(scope);
  if (raw.length === 0 || raw.length > AI_ASSIGN_MAX) {
    throw validationError([{ path: "assignments", message: `1 bis ${AI_ASSIGN_MAX} Zuordnungen je Aufruf.` }]);
  }
  const items: AiPlaceAssignInput[] = [];
  const issues: { path: string; message: string }[] = [];
  raw.forEach((r, i) => {
    const parsed = aiPlaceAssignSchema.safeParse(r);
    if (parsed.success) items.push(parsed.data);
    else for (const is of parsed.error.issues) issues.push({ path: ["assignments", i, ...is.path].join("."), message: is.message });
  });
  if (issues.length) throw validationError(issues);

  const texts = await collectPlaceTexts();
  const gaz = items.some((i) => i.gazetteerId) ? await getGazetteer() : null;
  const byId = gaz ? new Map(items.filter((i) => i.gazetteerId).map((i) => [i.gazetteerId!, gaz.entries.find((e) => e.id === i.gazetteerId) ?? null])) : null;
  nameChangeSet(scope, items.length === 1 ? `Ort zugeordnet (KI): „${items[0].text.slice(0, 80)}“` : "Orte zugeordnet (KI)");

  const results: AiPlaceAssignResult[] = [];
  for (const it of items) {
    const key = placeKey(it.text);
    const existing = await prisma.place.findUnique({ where: { key } });
    if (existing?.source === "MANUAL") {
      results.push({ text: it.text, ok: false, status: statusOf(existing), label: existing.label, error: "Von Hand bestätigt — die KI ändert das nicht." });
      continue;
    }
    const occurring = texts.get(key);
    if (!occurring) {
      results.push({ text: it.text, ok: false, error: "Dieser Ortstext kommt in den Daten nicht vor (siehe list_places)." });
      continue;
    }
    const base = { source: "AI" as const, note: it.note || null, uncertain: it.uncertain ?? false };
    let next: PlaceFields;
    if (it.gazetteerId) {
      const e = byId!.get(it.gazetteerId);
      if (!e) {
        results.push({ text: it.text, ok: false, error: `Unbekannte gazetteer_id „${it.gazetteerId}“.` });
        continue;
      }
      next = {
        ...base,
        unresolvable: false,
        precision: PRECISION_OF_KIND[e.kind],
        latitude: e.lat,
        longitude: e.lon,
        label: labelForText(gaz!, e, occurring.text),
        countryCode: e.cc || null,
        gazetteerId: e.id,
      };
    } else if (it.unresolvable) {
      next = { ...EMPTY, ...base, unresolvable: true };
    } else {
      next = {
        ...base,
        unresolvable: false,
        precision: it.precision ?? "PLACE",
        latitude: Math.round(it.latitude! * 1e5) / 1e5,
        longitude: Math.round(it.longitude! * 1e5) / 1e5,
        label: it.label!.trim(),
        countryCode: null,
        gazetteerId: null,
      };
    }
    const saved = await upsertPlace(scope, key, occurring.text, existing, next);
    results.push({
      text: occurring.text,
      ok: true,
      status: statusOf(saved),
      label: saved.label,
      latitude: saved.latitude,
      longitude: saved.longitude,
      ...(existing ? { replaced: existing.source as "AUTO" | "AI" } : {}),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Ort im Eingabefeld auswählen (Bearbeiter)
// ---------------------------------------------------------------------------

export const placeChoiceSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    personId: z.string().min(1).max(64).optional(),
    eventId: z.string().min(1).max(64).optional(),
    relationshipId: z.string().min(1).max(64).optional(),
    gazetteerId: z.string().min(1).max(32).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    label: z.string().trim().min(1).max(200).optional(),
    precision: z.enum(["PLACE", "REGION", "COUNTRY"]).optional(),
  })
  .refine((v) => [v.personId, v.eventId, v.relationshipId].filter(Boolean).length === 1, {
    message: "Genau einen Eintrag angeben (personId, eventId oder relationshipId).",
  })
  .refine((v) => Boolean(v.gazetteerId) !== (v.latitude !== undefined && v.longitude !== undefined && Boolean(v.label)), {
    message: "Entweder gazetteerId oder latitude, longitude und label (eigener Ort).",
  });
export type PlaceChoiceInput = z.infer<typeof placeChoiceSchema>;

/** Ortstexte eines Eintrags, wenn der Benutzer ihn bearbeiten darf (sonst Fehler). */
async function editablePlaceTexts(scope: Scope, input: PlaceChoiceInput): Promise<string[]> {
  if (input.personId) {
    const p = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { birthPlace: true, deathPlace: true, families: { select: { familyId: true } } },
    });
    const fam = p?.families.map((f) => f.familyId) ?? [];
    if (!p || !canViewPerson(scope, fam)) throw notFoundError("Person");
    if (!canEditPerson(scope, fam)) throw forbiddenError("diese Person zu ändern");
    return [p.birthPlace, p.deathPlace].filter((t): t is string => Boolean(t));
  }
  const relAccess = async (fromId: string, toId: string) => {
    const fam = await familyIdsOf([fromId, toId]);
    const from = fam.get(fromId) ?? [];
    const to = fam.get(toId) ?? [];
    if (!canViewPerson(scope, from) && !canViewPerson(scope, to)) return "hidden";
    return canEditRelationshipBetween(scope, from, to) ? "edit" : "read";
  };
  if (input.relationshipId) {
    const r = await prisma.relationship.findUnique({ where: { id: input.relationshipId } });
    if (!r) throw notFoundError("Beziehung");
    const a = await relAccess(r.fromPersonId, r.toPersonId);
    if (a === "hidden") throw notFoundError("Beziehung");
    if (a === "read") throw forbiddenError("diese Beziehung zu ändern");
    return [r.startPlace, r.endPlace].filter((t): t is string => Boolean(t));
  }
  const e = await prisma.event.findUnique({
    where: { id: input.eventId! },
    select: { place: true, personId: true, relationship: { select: { fromPersonId: true, toPersonId: true } } },
  });
  if (!e) throw notFoundError("Ereignis");
  if (e.personId) {
    const fam = (await familyIdsOf([e.personId])).get(e.personId) ?? [];
    if (!canViewPerson(scope, fam)) throw notFoundError("Ereignis");
    if (!canEditPerson(scope, fam)) throw forbiddenError("dieses Ereignis zu ändern");
  } else if (e.relationship) {
    const a = await relAccess(e.relationship.fromPersonId, e.relationship.toPersonId);
    if (a === "hidden") throw notFoundError("Ereignis");
    if (a === "read") throw forbiddenError("dieses Ereignis zu ändern");
  }
  return e.place ? [e.place] : [];
}

/**
 * Auswahl im Ortsfeld: ordnet GENAU den Freitext dieses Eintrags dem
 * gewählten Ort zu (Verzeichniseintrag oder eigener Ort mit Koordinaten),
 * Herkunft „von Hand“. Der Freitext bleibt unverändert; die Verbindung läuft
 * wie immer über den normalisierten Text (kein Fremdschlüssel).
 *
 * Rechte: Wer den Eintrag (Person, Ereignis, Beziehung) bearbeiten darf —
 * bewusst nicht die Admin-Route `/api/places`, die alle Ortstexte zeigt.
 * Der Text muss an diesem Eintrag stehen. Eine von Hand bestätigte
 * Zuordnung desselben Texts mit anderem Ziel ändert nur ein Administrator
 * (CONFLICT) — sie gilt auch für Angaben anderer Personen. Andere Texte
 * werden nie berührt.
 */
export async function choosePlaceForEntry(scope: Scope, raw: unknown): Promise<PlaceAssignmentDto> {
  const parsed = placeChoiceSchema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues.map((i) => ({ path: i.path.join(".") || "text", message: i.message })));
  const input = parsed.data;
  const key = placeKey(input.text);
  const texts = await editablePlaceTexts(scope, input);
  const own = texts.find((t) => placeKey(t) === key);
  if (!own) throw validationError([{ path: "text", message: "Dieser Ortstext steht nicht an diesem Eintrag." }]);

  let next: PlaceFields;
  if (input.gazetteerId) {
    const gaz = await getGazetteer();
    const e = gaz.entries.find((x) => x.id === input.gazetteerId);
    if (!e) throw notFoundError("Ort im Verzeichnis");
    next = {
      source: "MANUAL",
      unresolvable: false,
      precision: PRECISION_OF_KIND[e.kind],
      latitude: e.lat,
      longitude: e.lon,
      label: labelForText(gaz, e, own),
      countryCode: e.cc || null,
      gazetteerId: e.id,
      note: null,
      uncertain: false,
    };
  } else {
    next = {
      source: "MANUAL",
      unresolvable: false,
      precision: input.precision ?? "PLACE",
      latitude: Math.round(input.latitude! * 1e5) / 1e5,
      longitude: Math.round(input.longitude! * 1e5) / 1e5,
      label: input.label!.trim(),
      countryCode: null,
      gazetteerId: null,
      note: null,
      uncertain: false,
    };
  }
  const existing = await prisma.place.findUnique({ where: { key } });
  if (existing?.source === "MANUAL" && !existing.unresolvable) {
    const same = existing.gazetteerId === next.gazetteerId && existing.latitude === next.latitude && existing.longitude === next.longitude;
    if (same) return toAssignment(existing);
    if (!scope.isAdmin) {
      throw new ServiceError(
        "CONFLICT",
        `„${existing.text}“ ist bereits von Hand ${existing.label ?? "einem Ort"} zugeordnet — das ändert nur ein Administrator (Orte zuordnen).`,
      );
    }
  }
  nameChangeSet(scope, `Ort ausgewählt: „${own.slice(0, 80)}“`);
  return toAssignment(await upsertPlace(scope, key, own, existing, next));
}
