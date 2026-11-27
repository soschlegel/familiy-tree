import { prisma } from "../prisma";
import { audit, auditActor, fieldChanges } from "../audit";
import type { Scope } from "../scope";
import { BUILTIN_HISTORY } from "../history/builtin";
import {
  checkHistoryInput,
  mergeHistory,
  type BuiltinHistoryEvent,
  type HistoryEvent,
  type HistoryInput,
} from "../history/events";
import { lifetimeHistory, type LifetimeHistory } from "../history/lifetime";
import { isDeceased } from "../biography";
import { biographyInputOf } from "../biography-input";
import { calendarDayIn } from "../today";
import type { PersonDetail } from "./persons";
import { forbiddenError, notFoundError, validationError } from "./errors";

/**
 * Zeitgeschichte („historischer Rahmen“, Oberfläche „Zeitgeschichte“):
 * mitgelieferte Liste (lib/history/builtin.ts) plus eigene Einträge der
 * Administratoren (Tabelle `HistoryEvent`), mitgelieferte einzeln
 * ausblendbar (Tabelle `HistoryHiddenBuiltin`).
 *
 * - Lesen (`listHistoryEvents`): für jeden angemeldeten Benutzer gleich —
 *   allgemeines Wissen, keine Personendaten.
 * - Pflegen (`historyAdminState`, anlegen, ändern, löschen, aus-/einblenden):
 *   nur Administratoren (Recht `history:manage`; hier `scope.isAdmin`).
 * - Jede Änderung kommt ins Protokoll (Audit „HistoryEvent“): eigene
 *   Einträge mit `c:`-freier Datenbank-Kennung, mitgelieferte mit ihrer
 *   Kennung aus builtin.ts (`diff.builtin = true`).
 */

export type HistoryAdminCustomDto = {
  id: string;
  title: string;
  yearFrom: number;
  yearTo: number | null;
  kind: string;
  description: string | null;
  region: string | null;
  updatedAt: string;
};

export type HistoryAdminBuiltinDto = BuiltinHistoryEvent & { hidden: boolean };

export type HistoryAdminState = {
  builtin: HistoryAdminBuiltinDto[];
  custom: HistoryAdminCustomDto[];
};

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Zeitgeschichte");
}

/** Alle sichtbaren Ereignisse (mitgeliefert ohne ausgeblendete, plus eigene), nach der Zeit sortiert. */
export async function listHistoryEvents(): Promise<HistoryEvent[]> {
  const [custom, hidden] = await Promise.all([
    prisma.historyEvent.findMany({ orderBy: [{ yearFrom: "asc" }, { title: "asc" }] }),
    prisma.historyHiddenBuiltin.findMany({ select: { builtinId: true } }),
  ]);
  return mergeHistory(BUILTIN_HISTORY, custom, hidden.map((h) => h.builtinId));
}

/**
 * Zeile „In diese Lebenszeit fielen“ im Lebenslauf: aus denselben Daten wie
 * der Lebenslauf (biographyInputOf, isDeceased) — ohne weitere Abfrage
 * außer den Ereignissen selbst. null: keine brauchbare Lebenszeit oder
 * nichts darin.
 */
export async function getLifetimeHistory(
  detail: PersonDetail,
  events?: HistoryEvent[],
  now: Date = new Date(),
): Promise<LifetimeHistory | null> {
  const today = calendarDayIn(now);
  const input = biographyInputOf(detail, [], today);
  const p = { birth: input.person.birth, death: input.person.death, deceased: isDeceased(input) };
  if (!p.birth) return null;
  return lifetimeHistory(events ?? (await listHistoryEvents()), p, today.year);
}

/** Zustand für die Verwaltungsseite — nur Administratoren. */
export async function historyAdminState(scope: Scope): Promise<HistoryAdminState> {
  assertAdmin(scope);
  const [custom, hidden] = await Promise.all([
    prisma.historyEvent.findMany({ orderBy: [{ yearFrom: "asc" }, { title: "asc" }] }),
    prisma.historyHiddenBuiltin.findMany({ select: { builtinId: true } }),
  ]);
  const hiddenIds = new Set(hidden.map((h) => h.builtinId));
  return {
    builtin: BUILTIN_HISTORY.map((b) => ({ ...b, hidden: hiddenIds.has(b.id) })),
    custom: custom.map((c) => ({
      id: c.id,
      title: c.title,
      yearFrom: c.yearFrom,
      yearTo: c.yearTo,
      kind: c.kind,
      description: c.description,
      region: c.region,
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
}

function checked(input: Record<string, unknown>, now: Date): HistoryInput {
  const check = checkHistoryInput(input, calendarDayIn(now).year);
  if (!check.ok) throw validationError(check.issues);
  return check.value;
}

function customDto(c: {
  id: string;
  title: string;
  yearFrom: number;
  yearTo: number | null;
  kind: string;
  description: string | null;
  region: string | null;
  updatedAt: Date;
}): HistoryAdminCustomDto {
  return { ...c, updatedAt: c.updatedAt.toISOString() };
}

/** Eigenes Ereignis anlegen. */
export async function createHistoryEvent(
  scope: Scope,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<HistoryAdminCustomDto> {
  assertAdmin(scope);
  const v = checked(input, now);
  const row = await prisma.historyEvent.create({ data: v });
  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "HistoryEvent",
    entityId: row.id,
    diff: { ...v },
  });
  return customDto(row);
}

/** Eigenes Ereignis ändern (alle Felder werden neu gesetzt). */
export async function updateHistoryEvent(
  scope: Scope,
  id: string,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<HistoryAdminCustomDto> {
  assertAdmin(scope);
  const before = await prisma.historyEvent.findUnique({ where: { id } });
  if (!before) throw notFoundError("Ereignis");
  const v = checked(input, now);
  const changes = fieldChanges(before, v);
  if (Object.keys(changes).length === 0) return customDto(before);
  const row = await prisma.historyEvent.update({ where: { id }, data: v });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "HistoryEvent",
    entityId: id,
    diff: { title: v.title, changes },
  });
  return customDto(row);
}

/** Eigenes Ereignis löschen. */
export async function deleteHistoryEvent(scope: Scope, id: string): Promise<void> {
  assertAdmin(scope);
  const before = await prisma.historyEvent.findUnique({ where: { id } });
  if (!before) throw notFoundError("Ereignis");
  await prisma.historyEvent.delete({ where: { id } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "HistoryEvent",
    entityId: id,
    diff: {
      title: before.title,
      yearFrom: before.yearFrom,
      yearTo: before.yearTo,
      kind: before.kind,
      description: before.description,
      region: before.region,
    },
  });
}

/**
 * Mitgelieferten Eintrag aus- bzw. wieder einblenden. Unbekannte Kennung →
 * NOT_FOUND; schon im gewünschten Zustand → nichts zu tun, kein Protokoll.
 */
export async function setBuiltinHidden(scope: Scope, builtinId: string, hidden: boolean): Promise<HistoryAdminBuiltinDto> {
  assertAdmin(scope);
  const def = BUILTIN_HISTORY.find((b) => b.id === builtinId);
  if (!def) throw notFoundError("Ereignis");
  const row = await prisma.historyHiddenBuiltin.findUnique({ where: { builtinId } });
  if (Boolean(row) === hidden) return { ...def, hidden };
  if (hidden) await prisma.historyHiddenBuiltin.create({ data: { builtinId } });
  else await prisma.historyHiddenBuiltin.delete({ where: { builtinId } });
  await audit({
    ...auditActor(scope),
    action: "UPDATE",
    entityType: "HistoryEvent",
    entityId: builtinId,
    diff: { title: def.title, builtin: true, changes: { hidden: { from: !hidden, to: hidden } } },
  });
  return { ...def, hidden };
}
