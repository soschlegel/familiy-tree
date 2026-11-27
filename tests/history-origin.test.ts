/**
 * Zeitgeschichte: Herkunft „von KI“, Bestätigung, Begründung und
 * Dublettenschutz (lib/history/origin.ts) — reine Funktionen.
 */
import { describe, expect, it } from "vitest";

import {
  aiEditEffect,
  checkAiReason,
  confirmsOnManualSave,
  findHistoryDuplicate,
  formatDuplicateHint,
  historyRegionsCompatible,
  historyYearsOverlap,
  isUnconfirmedAi,
  normalizeHistoryTitle,
  originAfterAiEdit,
  similarHistoryTitles,
} from "@/lib/history/origin";
import { mergeHistory } from "@/lib/history/events";

const REASON = { aiReason: "Ortschronik Beispielstadt (1910), S. 12", aiSourceUrl: null };

describe("Herkunft und Bestätigung", () => {
  it("unbestätigt heißt: von KI und ohne Bestätigung", () => {
    expect(isUnconfirmedAi({ origin: "AI", confirmedAt: null })).toBe(true);
    expect(isUnconfirmedAi({ origin: "AI_EDITED", confirmedAt: null })).toBe(true);
    expect(isUnconfirmedAi({ origin: "AI", confirmedAt: new Date() })).toBe(false);
    expect(isUnconfirmedAi({ origin: "MANUAL", confirmedAt: null })).toBe(false);
  });

  it("KI ändert Inhalt: wieder unbestätigt, von Hand angelegte werden „von KI geändert“", () => {
    expect(originAfterAiEdit("AI")).toBe("AI");
    expect(originAfterAiEdit("MANUAL")).toBe("AI_EDITED");
    expect(originAfterAiEdit("AI_EDITED")).toBe("AI_EDITED");
    const confirmed = { origin: "AI", confirmedAt: new Date("2026-11-01") };
    expect(aiEditEffect(confirmed, ["title"], REASON)).toEqual({ origin: "AI", confirmedAt: null, confirmedById: null, ...REASON });
    expect(aiEditEffect({ origin: "MANUAL", confirmedAt: null }, ["region"], REASON)).toMatchObject({ origin: "AI_EDITED", confirmedAt: null });
    // Ohne Inhaltsänderung: nichts.
    expect(aiEditEffect(confirmed, [], REASON)).toBeNull();
    expect(aiEditEffect(confirmed, ["updatedAt"], REASON)).toBeNull();
  });

  it("Speichern von Hand bestätigt nur unbestätigte KI-Einträge", () => {
    expect(confirmsOnManualSave({ origin: "AI", confirmedAt: null })).toBe(true);
    expect(confirmsOnManualSave({ origin: "AI_EDITED", confirmedAt: null })).toBe(true);
    expect(confirmsOnManualSave({ origin: "AI", confirmedAt: "2026-11-01T00:00:00.000Z" })).toBe(false);
    expect(confirmsOnManualSave({ origin: "MANUAL", confirmedAt: null })).toBe(false);
  });

  it("Anzeigeliste: nur unbestätigte KI-Einträge tragen den Vermerk", () => {
    const list = mergeHistory(
      [],
      [
        { id: "a", title: "Hochwasser", yearFrom: 1882, yearTo: null, kind: "not", description: null, region: null, origin: "AI", confirmedAt: null },
        { id: "b", title: "Stadtbrand", yearFrom: 1842, yearTo: null, kind: "not", description: null, region: null, origin: "AI", confirmedAt: new Date() },
        { id: "c", title: "Markt", yearFrom: 1850, yearTo: null, kind: "sonstiges", description: null, region: null, origin: "MANUAL", confirmedAt: null },
        { id: "d", title: "Ohne Herkunft", yearFrom: 1860, yearTo: null, kind: "sonstiges", description: null, region: null },
      ],
      [],
    );
    expect(Object.fromEntries(list.map((e) => [e.id, e.aiUnconfirmed ?? false]))).toEqual({ "c:a": true, "c:b": false, "c:c": false, "c:d": false });
  });
});

describe("Begründung mit Quelle", () => {
  it("Pflicht, Mindestlänge, Leerraum vereinheitlicht", () => {
    expect(checkAiReason("  Ortschronik  Beispielstadt, S. 12 ", undefined)).toEqual({
      ok: true,
      value: { aiReason: "Ortschronik Beispielstadt, S. 12", aiSourceUrl: null },
    });
    for (const bad of [undefined, "", "kurz", 42]) {
      const r = checkAiReason(bad, undefined);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe("reason");
    }
    expect(checkAiReason("x".repeat(1001), undefined).ok).toBe(false);
  });

  it("Adresse nur https", () => {
    expect(checkAiReason("Ortschronik Beispielstadt, S. 12", "https://example.org/chronik#s12")).toMatchObject({
      ok: true,
      value: { aiSourceUrl: "https://example.org/chronik#s12" },
    });
    for (const url of ["http://example.org", "javascript:alert(1)", "ftp://example.org/a", "keine adresse", "https://user:pw@example.org/"]) {
      const r = checkAiReason("Ortschronik Beispielstadt, S. 12", url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe("source_url");
    }
    expect(checkAiReason("Ortschronik Beispielstadt, S. 12", "").ok).toBe(true);
  });
});

describe("Dublettenschutz", () => {
  it("Titel vereinheitlichen", () => {
    expect(normalizeHistoryTitle("  Großer Stadtbrand – Übergang!  ")).toBe("grosser stadtbrand uebergang");
    expect(normalizeHistoryTitle("Révolution")).toBe("revolution");
  });

  it("ähnliche Titel", () => {
    expect(similarHistoryTitles("Erster Weltkrieg", "erster  weltkrieg")).toBe(true);
    expect(similarHistoryTitles("Weltkrieg", "Erster Weltkrieg")).toBe(true); // enthalten
    expect(similarHistoryTitles("Hochwaser an der Beispel", "Hochwasser an der Beispel")).toBe(true); // Tippfehler
    expect(similarHistoryTitles("Hochwasser der Beispel", "Beispel-Hochwasser")).toBe(true); // gleiche Wörter
    expect(similarHistoryTitles("Großer Stadtbrand", "Grosser Stadtbrand")).toBe(true);
    expect(similarHistoryTitles("Der Erste Weltkrieg", "Erster Weltkrieg")).toBe(true); // Füllwort und Endung
    expect(similarHistoryTitles("Erster Weltkrieg", "Zweiter Weltkrieg")).toBe(false); // unterscheidendes Wort
    expect(similarHistoryTitles("Hochwasser", "Stadtbrand")).toBe(false);
    expect(similarHistoryTitles("Cholera", "Hungersnot")).toBe(false);
    expect(similarHistoryTitles("Krieg", "Deutscher Krieg")).toBe(true);
    expect(similarHistoryTitles("Pest", "Pestkreuz errichtet")).toBe(false); // zu kurz und kein ganzes Wort
  });

  it("überlappende Jahre", () => {
    expect(historyYearsOverlap({ from: 1914, to: 1918 }, { from: 1918, to: null })).toBe(true);
    expect(historyYearsOverlap({ from: 1914, to: 1918 }, { from: 1919, to: 1920 })).toBe(false);
    expect(historyYearsOverlap({ from: 1882, to: null }, { from: 1882, to: null })).toBe(true);
    expect(historyYearsOverlap({ from: 1882, to: null }, { from: 1883, to: null })).toBe(false);
  });

  it("findet den vorhandenen Eintrag — Titel UND Jahre müssen passen; der eigene zählt nicht", () => {
    const existing = [
      { id: "erster-weltkrieg", source: "builtin" as const, title: "Erster Weltkrieg", from: 1914, to: 1918 },
      { id: "zweiter-weltkrieg", source: "builtin" as const, title: "Zweiter Weltkrieg", from: 1939, to: 1945 },
      { id: "c:x1", source: "custom" as const, title: "Hochwasser an der Beispel", from: 1882, to: null },
    ];
    expect(findHistoryDuplicate({ title: "Weltkrieg", from: 1916, to: null }, existing)?.id).toBe("erster-weltkrieg");
    expect(findHistoryDuplicate({ title: "Zweiter Weltkrieg", from: 1939, to: 1945 }, existing)?.id).toBe("zweiter-weltkrieg");
    expect(findHistoryDuplicate({ title: "Hochwasser an der Beispel", from: 1890, to: null }, existing)).toBeNull();
    expect(findHistoryDuplicate({ title: "hochwasser an der beispel", from: 1880, to: 1882 }, existing)?.id).toBe("c:x1");
    expect(findHistoryDuplicate({ title: "Hochwasser an der Beispel", from: 1882, to: null }, existing, "c:x1")).toBeNull();
    expect(findHistoryDuplicate({ title: "Stadtbrand", from: 1916, to: null }, existing)).toBeNull();
  });

  it("Region: verschiedene Gegenden sind keine Dublette, fehlende Region passt immer", () => {
    expect(historyRegionsCompatible("Beispieltal", "Nachbarland")).toBe(false);
    expect(historyRegionsCompatible("Beispieltal", "beispieltal")).toBe(true);
    expect(historyRegionsCompatible("Unteres Beispieltal", "Beispieltal")).toBe(true);
    expect(historyRegionsCompatible(null, "Beispieltal")).toBe(true);
    const existing = [{ id: "c:x1", source: "custom" as const, title: "Hochwasser", from: 1882, to: null, region: "Beispieltal" }];
    expect(findHistoryDuplicate({ title: "Hochwasser", from: 1882, to: null, region: "Nachbarland" }, existing)).toBeNull();
    expect(findHistoryDuplicate({ title: "Hochwasser", from: 1882, to: null, region: null }, existing)?.id).toBe("c:x1");
  });

  it("Hinweis nennt den vorhandenen Eintrag und den Weg", () => {
    expect(formatDuplicateHint({ id: "c:x1", source: "custom", title: "Hochwasser", from: 1882, to: null })).toMatch(
      /„Hochwasser“ \(1882, Kennung c:x1\).*update_history_event/,
    );
    expect(formatDuplicateHint({ id: "erster-weltkrieg", source: "builtin", title: "Erster Weltkrieg", from: 1914, to: 1918 })).toMatch(
      /1914–1918.*mitgeliefert/,
    );
  });
});
