import { describe, expect, it } from "vitest";

import { connectorUrlFromEnv } from "@/components/AiConnectGuide";

describe("Adresse des Connectors (MCP_CONNECTOR_URL)", () => {
  it("nimmt nur http(s)-Adressen", () => {
    expect(connectorUrlFromEnv("https://mcp.example.de/stammbaum")).toBe("https://mcp.example.de/stammbaum");
    expect(connectorUrlFromEnv("  https://mcp.example.de/  ")).toBe("https://mcp.example.de/");
    expect(connectorUrlFromEnv("http://192.0.2.1/mcp")).toBe("http://192.0.2.1/mcp");
  });

  it("leer, kaputt oder andere Schemata → keine Adresse", () => {
    expect(connectorUrlFromEnv(undefined)).toBeNull();
    expect(connectorUrlFromEnv("")).toBeNull();
    expect(connectorUrlFromEnv("   ")).toBeNull();
    expect(connectorUrlFromEnv("kein-link")).toBeNull();
    expect(connectorUrlFromEnv("javascript:alert(1)")).toBeNull();
    expect(connectorUrlFromEnv("ftp://example.de")).toBeNull();
  });
});
