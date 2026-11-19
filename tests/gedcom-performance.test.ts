import { describe, expect, it } from "vitest";

import { diagnoseGedcom } from "@/lib/gedcom/diagnostics";
import { verifyLossless } from "@/lib/gedcom/lossless";
import { parseGedcom } from "@/lib/gedcom/parse";
import { writeGedcom } from "@/lib/gedcom/writer";

import { generateLargeGedcom } from "./fixtures/gedcom/generate";

/**
 * Kleine Größe im normalen Testlauf; die eigentliche Messung (100 000
 * Personen, ~50 MB) läuft mit GEDCOM_PERF=1 bzw. über
 * `npx tsx lib/gedcom/perf.ts` — siehe lib/gedcom/README.md.
 */
const N = Number(process.env.GEDCOM_PERF_N ?? (process.env.GEDCOM_PERF ? 100_000 : 3_000));

describe(`Generierte Datei mit ${N} Personen`, () => {
  it("wird verlustfrei, ohne Warnungen und in vertretbarer Zeit gelesen und geschrieben", () => {
    const text = generateLargeGedcom(N);
    const bytes = new TextEncoder().encode(text);
    const t0 = performance.now();
    const r = parseGedcom(bytes, { keepRaw: true });
    const parseMs = performance.now() - t0;
    expect(r.document.persons).toHaveLength(N);
    expect(r.warnings).toEqual([]);
    expect(verifyLossless(r).lost).toHaveLength(0);
    const d = diagnoseGedcom(r.document);
    // Zufallsdaten: Geburtsjahre passen nicht zu den Eltern — nur strukturelle Fehler zählen.
    expect(d.filter((x) => x.severity === "error" && x.code !== "CHILD_BORN_BEFORE_PARENT")).toEqual([]);
    const t1 = performance.now();
    const w = writeGedcom(r.document);
    const writeMs = performance.now() - t1;
    expect(parseGedcom(w.bytes).document.persons).toHaveLength(N);
    // großzügige Grenze, damit langsame CI-Rechner nicht scheitern
    expect(parseMs).toBeLessThan(N * 2);
    expect(writeMs).toBeLessThan(N * 2);
  }, 600_000);
});
