/**
 * Verzeichnis der Einstellungen (lib/settings/registry.ts): Aufbau, Prüfung
 * der Werte nach Art, Rückfall auf die Umgebungsvariable. Ohne Datenbank —
 * Vorrang App vor Umgebung prüft tests/settings.db.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SETTING_LENGTH,
  SETTINGS,
  checkSettingValue,
  isSettingKey,
  settingDefinition,
  settingFromEnv,
} from "@/lib/settings/registry";

describe("Verzeichnis der Einstellungen", () => {
  it("Kennungen eindeutig, je Eintrag Bezeichnung und Erklärung", () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SETTINGS) {
      expect(s.key, s.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
      expect(s.label.length, s.key).toBeGreaterThan(3);
      expect(s.description.length, s.key).toBeGreaterThan(20);
    }
  });

  it("keine Geheimnisse: weder Kennung noch Umgebungsvariable klingen nach Zugangsdaten", () => {
    for (const s of SETTINGS) {
      const names = [s.key, "envVar" in s ? s.envVar : ""].join(" ");
      expect(names, s.key).not.toMatch(/secret|password|passwort|token|api_?key|credential/i);
    }
  });

  it("Connector-Adresse: erster Schlüssel, Rückfall MCP_CONNECTOR_URL", () => {
    const def = settingDefinition("mcpConnectorUrl");
    expect(def).toMatchObject({ kind: "httpUrl", envVar: "MCP_CONNECTOR_URL" });
    expect(isSettingKey("mcpConnectorUrl")).toBe(true);
    expect(settingDefinition("gibtEsNicht")).toBeNull();
    expect(isSettingKey("gibtEsNicht")).toBe(false);
  });
});

describe("Prüfung: http(s)-Adresse", () => {
  const url = { kind: "httpUrl" } as const;

  it("nimmt http(s)-Adressen und vereinheitlicht sie", () => {
    expect(checkSettingValue(url, "https://mcp.example.de/stammbaum")).toEqual({ ok: true, value: "https://mcp.example.de/stammbaum" });
    expect(checkSettingValue(url, "  https://mcp.example.de  ")).toEqual({ ok: true, value: "https://mcp.example.de/" });
    expect(checkSettingValue(url, "http://192.0.2.1/mcp")).toEqual({ ok: true, value: "http://192.0.2.1/mcp" });
  });

  it("leer, kaputt, andere Schemata, Zugangsdaten in der Adresse, zu lang → abgelehnt", () => {
    for (const bad of [undefined, null, 42, "", "   ", "kein-link", "javascript:alert(1)", "ftp://example.de", "data:text/html,x"]) {
      expect(checkSettingValue(url, bad).ok, String(bad)).toBe(false);
    }
    expect(checkSettingValue(url, "https://nutzer:geheim@mcp.example.de/")).toMatchObject({ ok: false, error: expect.stringMatching(/Passwort/) });
    expect(checkSettingValue(url, "https://nutzer@mcp.example.de/").ok).toBe(false);
    const long = `https://mcp.example.de/${"a".repeat(MAX_SETTING_LENGTH)}`;
    expect(checkSettingValue(url, long)).toMatchObject({ ok: false, error: expect.stringMatching(/Höchstens/) });
  });
});

describe("Rückfall auf die Umgebungsvariable", () => {
  const def = settingDefinition("mcpConnectorUrl")!;

  it("gültiger Wert wird übernommen, ungültiger oder fehlender gilt als nicht gesetzt", () => {
    expect(settingFromEnv(def, { MCP_CONNECTOR_URL: " https://mcp.example.de/stammbaum " })).toBe("https://mcp.example.de/stammbaum");
    expect(settingFromEnv(def, {})).toBeNull();
    expect(settingFromEnv(def, { MCP_CONNECTOR_URL: "" })).toBeNull();
    expect(settingFromEnv(def, { MCP_CONNECTOR_URL: "javascript:alert(1)" })).toBeNull();
  });

  it("ohne zugehörige Umgebungsvariable kein Rückfall", () => {
    expect(settingFromEnv({ ...def, envVar: undefined }, { MCP_CONNECTOR_URL: "https://mcp.example.de/" })).toBeNull();
  });
});
