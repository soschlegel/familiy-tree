import { prisma } from "../prisma";
import { audit, auditActor } from "../audit";
import type { Scope } from "../scope";
import {
  SETTINGS,
  checkSettingValue,
  settingDefinition,
  settingFromEnv,
  type SettingDefinition,
  type SettingKey,
} from "../settings/registry";
import { conflictError, forbiddenError, notFoundError, validationError } from "./errors";

/**
 * Einstellungen der Installation (Seite /admin/settings, Tabelle
 * `AppSetting`). Welche Schlüssel es gibt, steht allein im Verzeichnis
 * lib/settings/registry.ts — nur für Werte, die keine Geheimnisse sind.
 *
 * Vorrang: Wert aus der App vor Umgebungsvariable; ohne Eintrag gilt die
 * Umgebungsvariable (bestehende Installationen ändern sich nicht).
 * Jede Änderung kommt ins Protokoll (Audit „Setting“, vorher → nachher).
 */

/** Woher der wirksame Wert kommt. */
export type SettingSource = "app" | "env" | "none";

export type SettingStateDto = {
  key: string;
  label: string;
  description: string;
  kind: SettingDefinition["kind"];
  envVar: string | null;
  placeholder: string | null;
  /** In der App gesetzter Wert (oder null). */
  appValue: string | null;
  /** Gültiger Wert der Umgebungsvariablen (oder null). */
  envValue: string | null;
  /** Wirksamer Wert nach Vorrang. */
  effective: string | null;
  source: SettingSource;
  updatedAt: string | null;
};

/**
 * Wirksamer Wert einer Einstellung — serverseitig dort lesen, wo er gebraucht
 * wird. Ein gespeicherter Wert wird erneut geprüft (falls sich die Prüfung
 * verschärft hat); ist er nicht mehr gültig, gilt die Umgebung.
 */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const def = settingDefinition(key);
  if (!def) return null;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) {
    const check = checkSettingValue(def, row.value);
    if (check.ok) return check.value;
  }
  return settingFromEnv(def);
}

function assertAdmin(scope: Scope) {
  if (!scope.isAdmin) throw forbiddenError("Einstellungen");
}

function knownDefinition(key: string): SettingDefinition {
  const def = settingDefinition(key);
  if (!def) throw validationError([{ path: "key", message: "Unbekannte Einstellung." }]);
  return def;
}

/** Alle Einstellungen des Verzeichnisses mit Zustand — nur Administratoren. */
export async function listSettings(scope: Scope): Promise<SettingStateDto[]> {
  assertAdmin(scope);
  const rows = await prisma.appSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTINGS.map((def): SettingStateDto => {
    const row = byKey.get(def.key);
    const stored = row ? checkSettingValue(def, row.value) : null;
    const appValue = stored?.ok ? stored.value : null;
    const envValue = settingFromEnv(def);
    const source: SettingSource = appValue ? "app" : envValue ? "env" : "none";
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      kind: def.kind,
      envVar: def.envVar ?? null,
      placeholder: def.placeholder ?? null,
      appValue,
      envValue,
      effective: appValue ?? envValue,
      source,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
}

function checked(def: SettingDefinition, value: unknown): string {
  const check = checkSettingValue(def, value);
  if (!check.ok) throw validationError([{ path: "value", message: check.error }]);
  return check.value;
}

/** Neuen Eintrag anlegen; vorhandener Schlüssel → CONFLICT. */
export async function createSetting(scope: Scope, key: string, value: unknown): Promise<SettingStateDto> {
  assertAdmin(scope);
  const def = knownDefinition(key);
  const v = checked(def, value);
  if (await prisma.appSetting.findUnique({ where: { key } })) {
    throw conflictError("Diese Einstellung ist schon gesetzt — bitte dort ändern.");
  }
  await prisma.appSetting.create({ data: { key, value: v } });
  await audit({
    ...auditActor(scope),
    action: "CREATE",
    entityType: "Setting",
    entityId: key,
    diff: { label: def.label, value: v },
  });
  return stateOf(scope, key);
}

/** Wert eines gesetzten Eintrags ändern; nicht gesetzt → NOT_FOUND. */
export async function updateSetting(scope: Scope, key: string, value: unknown): Promise<SettingStateDto> {
  assertAdmin(scope);
  const def = knownDefinition(key);
  const v = checked(def, value);
  const before = await prisma.appSetting.findUnique({ where: { key } });
  if (!before) throw notFoundError("Einstellung");
  if (before.value !== v) {
    await prisma.appSetting.update({ where: { key }, data: { value: v } });
    await audit({
      ...auditActor(scope),
      action: "UPDATE",
      entityType: "Setting",
      entityId: key,
      diff: { label: def.label, changes: { value: { from: before.value, to: v } } },
    });
  }
  return stateOf(scope, key);
}

/** Eintrag entfernen — danach gilt wieder die Umgebungsvariable. */
export async function deleteSetting(scope: Scope, key: string): Promise<SettingStateDto> {
  assertAdmin(scope);
  const def = knownDefinition(key);
  const before = await prisma.appSetting.findUnique({ where: { key } });
  if (!before) throw notFoundError("Einstellung");
  await prisma.appSetting.delete({ where: { key } });
  await audit({
    ...auditActor(scope),
    action: "DELETE",
    entityType: "Setting",
    entityId: key,
    diff: { label: def.label, value: before.value },
  });
  return stateOf(scope, key);
}

async function stateOf(scope: Scope, key: string): Promise<SettingStateDto> {
  return (await listSettings(scope)).find((s) => s.key === key)!;
}
