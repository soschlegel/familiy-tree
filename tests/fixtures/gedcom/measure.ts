/**
 * Leistungsmessung (kein Test): erzeugt eine große Datei, liest sie und gibt
 * Zeit und Speicher aus. Für saubere Spitzenwerte je Lauf ein eigener Prozess:
 *
 *   npx tsx tests/fixtures/gedcom/measure.ts 100000 [datei.ged] [--parse-only]
 *
 * Mit Dateiname wird die Datei beim ersten Lauf erzeugt und danach gelesen.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { diagnoseGedcom } from "../../../lib/gedcom/diagnostics";
import { parseGedcom } from "../../../lib/gedcom/parse";
import { writeGedcom } from "../../../lib/gedcom/writer";

import { generateLargeGedcom } from "./generate";

const n = Number(process.argv[2] ?? 100_000);
const file = process.argv[3]?.startsWith("--") ? undefined : process.argv[3];
const parseOnly = process.argv.includes("--parse-only");
let bytes: Uint8Array;
if (file) {
  try {
    bytes = readFileSync(file);
  } catch {
    bytes = new TextEncoder().encode(generateLargeGedcom(n));
    writeFileSync(file, bytes);
  }
} else bytes = new TextEncoder().encode(generateLargeGedcom(n));

const mb = (x: number) => Math.round(x / 1024 / 1024);
const before = process.memoryUsage();
const t0 = performance.now();
const r = parseGedcom(bytes);
const parseMs = performance.now() - t0;
const afterParse = process.memoryUsage();
const peakAfterParseMb = Math.round(process.resourceUsage().maxRSS / 1024);
const t1 = performance.now();
const diag = parseOnly ? [] : diagnoseGedcom(r.document);
const diagMs = performance.now() - t1;
const t2 = performance.now();
const w = parseOnly ? { bytes: new Uint8Array() } : writeGedcom(r.document);
const writeMs = performance.now() - t2;
const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);

console.log(
  JSON.stringify(
    {
      individuals: r.document.persons.length,
      families: r.document.families.length,
      fileMb: +(bytes.length / 1024 / 1024).toFixed(1),
      lines: r.stats.lines,
      parseMs: Math.round(parseMs),
      diagnoseMs: Math.round(diagMs),
      writeMs: Math.round(writeMs),
      writtenMb: +(w.bytes.length / 1024 / 1024).toFixed(1),
      heapBeforeMb: mb(before.heapUsed),
      heapAfterParseMb: mb(afterParse.heapUsed),
      peakRssAfterParseMb: peakAfterParseMb,
      peakRssMb,
      warnings: r.warnings.length,
      diagnostics: diag.length,
    },
    null,
    2,
  ),
);
