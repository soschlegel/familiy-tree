/**
 * Rückportierung der React-Korrektur gegen den Hydration-Fehler #418
 * (lib/next-patches/react-hydration-replay-fix.cjs): passt die Stelle im
 * installierten Next.js noch, wird sie eindeutig ersetzt, und bleibt das
 * Ergebnis gültiges JavaScript? Schlägt nach einer Next-/React-Aktualisierung
 * an, bevor der Fehler still zurückkommt.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fix = require("../lib/next-patches/react-hydration-replay-fix.cjs") as {
  applyHydrationReplayFix: (source: string) => { code: string; status: "patched" | "upstream" };
  TARGET: RegExp;
};

const CJS = path.join(path.dirname(require.resolve("next/package.json")), "dist", "compiled", "react-dom", "cjs");
const FILES = ["react-dom-client.production.js", "react-dom-client.development.js"];

describe("React-Korrektur für die Hydration (Rückportierung)", () => {
  for (const name of FILES) {
    const file = path.join(CJS, name);

    it(`${name}: die Regel trifft die Datei, die Korrektur greift genau einmal`, () => {
      expect(existsSync(file)).toBe(true);
      expect(fix.TARGET.test(file)).toBe(true);

      const source = readFileSync(file, "utf8");
      const { code, status } = fix.applyHydrationReplayFix(source);
      // „upstream“ hieße: React enthält die Korrektur selbst — dann Loader,
      // Regel in next.config.mjs und diesen Test entfernen.
      expect(status).toBe("patched");
      expect(code).not.toBe(source);
      expect(code.match(/Rückportierung facebook\/react#35494/g)).toHaveLength(1);
      expect(code).toMatch(/=== hydrationParentFiber &&\s*\(isHydrating\s*\? \(popToNextHostParent\(/);
      // Syntaxprüfung, ohne den Code auszuführen.
      expect(() => new vm.Script(code, { filename: name })).not.toThrow();
      // Zweimal anwenden ändert nichts mehr (gilt dann als schon korrigiert).
      expect(fix.applyHydrationReplayFix(code)).toEqual({ code, status: "upstream" });
    });
  }

  it("andere Dateien trifft die Regel nicht", () => {
    expect(fix.TARGET.test(path.join(CJS, "react-dom-server.node.production.js"))).toBe(false);
    expect(fix.TARGET.test(path.join("node_modules", "react-dom", "cjs", "react-dom-client.production.js"))).toBe(false);
  });

  it("unbekannter Stand bricht mit klarer Meldung ab", () => {
    expect(() => fix.applyHydrationReplayFix("function replayBeginWork() {}")).toThrow(/nicht \(eindeutig\) gefunden/);
  });
});
