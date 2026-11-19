/**
 * Nachweis der Verlustfreiheit: Jeder Knoten des Rohbaums ist entweder vom
 * Interpreter verstanden worden oder steckt (samt Unterbaum) unverändert in
 * einer Erweiterung bzw. einem unbekannten Datensatz des Modells. Dazu die
 * Zeilenbilanz: Dateizeilen = Knoten + CONC/CONT + Leerzeilen + reparierte +
 * verworfene Zeilen.
 */

import type { ParseResultWithTrace } from "./parse";
import type { GedcomNode } from "./types";

export interface LosslessReport {
  /** Knoten im Rohbaum, die aus einer Dateizeile stammen. */
  nodes: number;
  consumed: number;
  preserved: number;
  /** Weder verstanden noch erhalten — muss leer sein. */
  lost: { line?: number; path: string }[];
  /** Zeilenbilanz geht auf (alle Dateizeilen sind zugeordnet). */
  linesBalanced: boolean;
  lines: number;
  skippedLines: number;
}

function collectPreserved(value: unknown, out: Set<GedcomNode>, seen = new Set<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const v of value) collectPreserved(v, out, seen);
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (/[eE]xtensions$/.test(key) && Array.isArray(v)) {
      for (const e of v as { node: GedcomNode }[]) addTree(e.node, out);
    } else if (key === "unknownRecords" && Array.isArray(v)) {
      for (const n of v as GedcomNode[]) addTree(n, out);
    } else collectPreserved(v, out, seen);
  }
}

function addTree(node: GedcomNode, out: Set<GedcomNode>): void {
  out.add(node);
  for (const c of node.children) addTree(c, out);
}

export function verifyLossless(result: ParseResultWithTrace): LosslessReport {
  if (!result.raw || !result.consumed) throw new Error("verifyLossless braucht parseGedcom(…, { keepRaw: true }).");
  const preservedSet = new Set<GedcomNode>();
  collectPreserved(result.document, preservedSet);
  const report: LosslessReport = {
    nodes: 0,
    consumed: 0,
    preserved: 0,
    lost: [],
    linesBalanced: false,
    lines: result.stats.lines,
    skippedLines: result.stats.skippedLines,
  };
  let synthetic = 0;
  const walk = (n: GedcomNode, path: string) => {
    const p = path ? `${path}.${n.tag}` : n.tag;
    const isSynthetic = n.tag === "_TRAILING_TEXT";
    if (isSynthetic) synthetic++;
    else report.nodes++;
    if (result.consumed!.has(n)) {
      if (!isSynthetic) report.consumed++;
    } else if (preservedSet.has(n)) {
      if (!isSynthetic) report.preserved++;
    } else report.lost.push({ line: n.line, path: p });
    for (const c of n.children) walk(c, p);
  };
  for (const r of result.raw) walk(r, "");
  const s = result.stats;
  report.linesBalanced =
    s.lines === report.nodes + s.continuationLines + s.blankLines + s.repairedLines + s.skippedLines && s.nodes === report.nodes;
  void synthetic;
  return report;
}
