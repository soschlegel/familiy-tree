import type { Place, PlacePrecision, Prisma } from "@prisma/client";
import { z } from "zod";

import { auditActor, auditData, fieldChanges } from "../audit";
import { nameChangeSet } from "../change-sets";
import { prisma } from "../prisma";
import type { Scope } from "../scope";
import { entryLabel, searchGazetteer } from "../places/gazetteer";
import { getGazetteer } from "../places/gazetteer-file";
import { matchPlace } from "../places/match";
import { placeKey } from "../places/normalize";
import { forbiddenError, notFoundError, ServiceError } from "./errors";

/**
 * Ortszuordnung (README, „Karte und Orte“): Ortstexte → Koordinaten.
 *
 * Nur für Administratoren. Die Liste enthält die Ortstexte ALLER Personen,
 * auch gesperrter — deshalb prüft jede Funktion hier selbst `isAdmin`
 * (zusätzlich zur Route, lib/authz.ts „place:manage“).
 *
 * Grundsätze:
 * - Automatisch (Ortsverzeichnis) zugeordnet wird nur, was nicht von Hand
 *   bestätigt ist; MANUAL wird nie überschrieben oder gelöscht.
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

export type PlaceStatus = "open" | "auto" | "manual" | "unresolvable";
export const PLACE_STATUS_LABEL: Record<PlaceStatus, string> = {
  open: "offen",
  auto: "automatisch",
  manual: "bestätigt",
  unresolvable: "nicht zuordenbar",
};

export type PlaceAssignmentDto = {
  source: "AUTO" | "MANUAL";
  unresolvable: boolean;
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

const statusOf = (p: Place | undefined): PlaceStatus =>
  !p ? "open" : p.source === "AUTO" ? "auto" : p.unresolvable ? "unresolvable" : "manual";

const toAssignment = (p: Place): PlaceAssignmentDto => ({
  source: p.source,
  unresolvable: p.unresolvable,
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

  const counts = { open: 0, auto: 0, manual: 0, unresolvable: 0, all: texts.size, occurrences: 0 };
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
const AUDIT_FIELDS = ["source", "unresolvable", "precision", "latitude", "longitude", "label", "countryCode", "gazetteerId"] as const;
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
        label: entryLabel(gaz, e),
        countryCode: e.cc || null,
        gazetteerId: e.id,
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
      };
      break;
    case "confirm":
      if (!existing || existing.unresolvable || existing.latitude === null) {
        throw new ServiceError("CONFLICT", "Keine Zuordnung zum Bestätigen — bitte einen Ort wählen.");
      }
      next = { ...pick(existing), source: "MANUAL" };
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

  const result: AutoAssignResult = { created: 0, updated: 0, removed: 0, unchanged: 0, unmatched: 0, manual: 0, ms: 0 };
  const creates: Prisma.PlaceCreateManyInput[] = [];
  const updates: { existing: Place; text: string; next: PlaceFields }[] = [];
  const removals: Place[] = [];

  for (const t of texts.values()) {
    const existing = byKey.get(t.key);
    if (existing?.source === "MANUAL") {
      result.manual++;
      continue;
    }
    const m = matchPlace(gaz, t.text);
    if (!m) {
      result.unmatched++;
      if (existing) removals.push(existing);
      continue;
    }
    const next: PlaceFields = {
      source: "AUTO",
      unresolvable: false,
      precision: m.precision,
      latitude: m.entry.lat,
      longitude: m.entry.lon,
      label: m.label,
      countryCode: m.entry.cc || null,
      gazetteerId: m.entry.id,
    };
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

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
