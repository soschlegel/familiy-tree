/**
 * HTML-Fragmente aus Importen und Eingaben (lib/gedcom/html.ts): Verhalten
 * und Laufzeit bei bösartig gebauten Texten (ReDoS). Die frühere Fassung aus
 * verschachtelten regulären Ausdrücken brauchte für die Eingaben unten
 * Sekunden bis Minuten.
 */
import { describe, expect, it } from "vitest";

import { htmlToText, looksLikeHtml } from "@/lib/gedcom/html";

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

describe("htmlToText", () => {
  it("übersetzt Absätze, Umbrüche, Listen, Links und entfernt Skripte", () => {
    const html =
      '<p>Erster Absatz</p><p>Zweiter<br/>Teil</p><ul><li>eins</li><li>zwei</li></ul>' +
      '<a href="https://beispiel.example/x">Eintrag</a> <script>alert(1)</script><b>fett</b> &amp; mehr';
    expect(htmlToText(html)).toBe("Erster Absatz\n\nZweiter\nTeil\n\n• eins\n• zwei\nEintrag (https://beispiel.example/x) fett & mehr");
  });

  it("unvollständige Tags bleiben Text bzw. entfallen wie bisher", () => {
    expect(htmlToText("a < b und c")).toBe("a < b und c");
    expect(htmlToText('<a href="https://x.example">ohne Ende')).toBe("ohne Ende");
    expect(htmlToText("<script>bleibt sichtbar")).toBe("bleibt sichtbar");
  });

  it("viele Link-Anfänge ohne „>“: linear statt kubisch", () => {
    const evil = '<a href="x" '.repeat(1500);
    const { value, ms } = timed(() => htmlToText(evil));
    expect(value).toBe(evil.trim());
    expect(ms).toBeLessThan(1000);
  });

  it("viele Link- und Listen-Anfänge ohne Abschluss: linear", () => {
    expect(timed(() => htmlToText('<a href="x">y'.repeat(30_000))).ms).toBeLessThan(1000);
    expect(timed(() => htmlToText("<li ".repeat(30_000))).ms).toBeLessThan(1000);
    expect(timed(() => htmlToText("<script>".repeat(20_000) + "Text")).ms).toBeLessThan(1000);
  });
});

describe("looksLikeHtml", () => {
  it("erkennt Tags und Entitäten, nicht bloße Kleiner-Zeichen", () => {
    expect(looksLikeHtml("<p>Text</p>")).toBe(true);
    expect(looksLikeHtml("Fisch &amp; Brot")).toBe(true);
    expect(looksLikeHtml("1 < 2 > 0")).toBe(false);
    expect(looksLikeHtml("<p")).toBe(false);
  });

  it("viele Tag-Anfänge ohne „>“: linear", () => {
    const evil = "<p ".repeat(50_000) + "x";
    const { value, ms } = timed(() => looksLikeHtml(evil));
    expect(value).toBe(false);
    expect(ms).toBeLessThan(1500);
  });
});
