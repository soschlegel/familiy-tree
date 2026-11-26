/**
 * Zentrales Verzeichnis der Einstellungen, die Administratoren auf
 * „Einstellungen“ (/admin/settings) pflegen können.
 *
 * Ein neuer Schlüssel braucht nur einen Eintrag in SETTINGS — keine
 * Migration (Tabelle `AppSetting` speichert Schlüssel → Text) und keine
 * Änderung an der Seite (sie baut Auswahl, Beschriftung, Erklärung und
 * Prüfung aus diesem Verzeichnis). Gelesen wird ein Wert serverseitig mit
 * `getSetting` (lib/services/settings.ts): Wert aus der App vor
 * Umgebungsvariable.
 *
 * WICHTIG: Nur für Werte, die KEINE Geheimnisse sind. Zugangsdaten,
 * Schlüssel, Passwörter, Tokens gehören nicht hierher — die Seite zeigt jeden
 * Wert im Klartext, und die Änderungsgeschichte hält vorher → nachher fest.
 * Solche Werte bleiben Umgebungsvariablen der Server-Konfiguration.
 *
 * Rein (kein Prisma, kein next/*): Seite, Dienste, Tests und
 * Client-Komponenten können es gleichermaßen benutzen.
 */

/** Art eines Werts; bestimmt die Prüfung beim Speichern und beim Rückfall. */
export type SettingKind = "httpUrl";

export type SettingDefinition = {
  /** Feste Kennung, so in der Datenbank gespeichert. Nie umbenennen. */
  key: string;
  /** Deutsche Bezeichnung für die Oberfläche. */
  label: string;
  /** Erklärung für Administratoren: wozu, wo sichtbar, Beispiel. */
  description: string;
  kind: SettingKind;
  /** Umgebungsvariable als Rückfall, wenn in der App kein Wert gesetzt ist. */
  envVar?: string;
  /** Beispiel im Eingabefeld (erfunden, keine echten Adressen). */
  placeholder?: string;
};

export const SETTINGS = [
  {
    key: "mcpConnectorUrl",
    label: "Adresse des KI-Connectors",
    description:
      "Öffentliche Adresse des MCP-Gateways, über das Claude auf dem Handy, im Browser und in " +
      "Claude Desktop den Stammbaum erreicht. Sie erscheint auf der Seite „KI-Zugang“ in der " +
      "Anleitung zum Einrichten. Ohne Adresse verweist die Anleitung an einen Administrator.",
    kind: "httpUrl",
    envVar: "MCP_CONNECTOR_URL",
    placeholder: "https://mcp.example.de/stammbaum",
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTINGS)[number]["key"];

/** Höchstlänge eines Werts (Zeichen). */
export const MAX_SETTING_LENGTH = 2000;

const BY_KEY = new Map<string, SettingDefinition>(SETTINGS.map((s) => [s.key, s]));

/** Definition zu einer Kennung; unbekannte Kennungen ergeben `null`. */
export function settingDefinition(key: string): SettingDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}

export type SettingCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Prüft und vereinheitlicht einen Wert nach der Art des Schlüssels — beim
 * Speichern in der App und ebenso für den Rückfall aus der Umgebung
 * (ungültige Umgebungswerte gelten dann als „nicht gesetzt“).
 */
export function checkSettingValue(def: Pick<SettingDefinition, "kind">, raw: unknown): SettingCheck {
  if (typeof raw !== "string") return { ok: false, error: "Wert fehlt." };
  const v = raw.trim();
  if (!v) return { ok: false, error: "Wert fehlt." };
  if (v.length > MAX_SETTING_LENGTH) return { ok: false, error: `Höchstens ${MAX_SETTING_LENGTH} Zeichen.` };
  switch (def.kind) {
    case "httpUrl":
      return checkHttpUrl(v);
  }
}

function checkHttpUrl(v: string): SettingCheck {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, error: "Keine gültige Adresse — bitte vollständig mit https:// angeben." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "Nur Adressen mit http:// oder https:// sind erlaubt." };
  }
  // Zugangsdaten in der Adresse wären ein Geheimnis im Klartext.
  if (u.username || u.password) {
    return { ok: false, error: "Die Adresse darf keinen Benutzernamen und kein Passwort enthalten." };
  }
  return { ok: true, value: u.toString() };
}

/** Wert einer Umgebungsvariablen nach derselben Prüfung; ungültig/leer → `null`. */
export function settingFromEnv(def: SettingDefinition, env: Record<string, string | undefined> = process.env): string | null {
  if (!def.envVar) return null;
  const check = checkSettingValue(def, env[def.envVar]);
  return check.ok ? check.value : null;
}
