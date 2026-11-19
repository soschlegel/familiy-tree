import { decodeGedcomBytes } from "./encoding";
import { Interpreter } from "./interpret";
import { createTokenizerState, readRecords } from "./tokenizer";
import type { GedcomEncodingInfo, GedcomNode, GedcomParseResult, GedcomStats, GedcomWarning } from "./types";
import { WarningSink } from "./warnings";

export type GedcomInput = Uint8Array | ArrayBuffer | string;

export interface ParseOptions {
  /**
   * Rohbaum und die Menge der verstandenen Knoten mitliefern (für Tests und
   * Fehlersuche). Kostet Speicher; für den Import nicht nötig.
   */
  keepRaw?: boolean;
  /** Höchstzahl gespeicherter Warnungen je Art (Rest wird gezählt). */
  warningCap?: number;
}

function toText(input: GedcomInput, sink: WarningSink): { text: string; encoding: GedcomEncodingInfo } {
  if (typeof input === "string") {
    return { text: input, encoding: { encoding: "STRING", bom: input.charCodeAt(0) === 0xfeff, detectedBy: "STRING" } };
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const decoded = decodeGedcomBytes(bytes);
  sink.addAll(decoded.warnings);
  return { text: decoded.text, encoding: decoded.info };
}

/**
 * Nur Tokenizer: Bytes/Text → Datensatzbäume (CONC/CONT zusammengesetzt),
 * ohne Interpretation.
 */
export function readGedcomTree(
  input: GedcomInput,
  options: { warningCap?: number } = {},
): { records: GedcomNode[]; warnings: GedcomWarning[]; encoding: GedcomEncodingInfo; stats: GedcomStats; majorVersion: 5 | 7 } {
  const sink = new WarningSink(options.warningCap);
  const { text, encoding } = toText(input, sink);
  const state = createTokenizerState();
  const records = [...readRecords(text, sink, state)];
  return { records, warnings: sink.result(), encoding, stats: state.stats, majorVersion: state.majorVersion };
}

export interface ParseResultWithTrace extends GedcomParseResult {
  /** Mit keepRaw: alle verstandenen Knoten. */
  consumed?: Set<GedcomNode>;
}

/**
 * GEDCOM lesen und ins Zwischenmodell übersetzen. Wirft nie wegen des
 * Dateiinhalts — Probleme stehen in `warnings`.
 */
export function parseGedcom(input: GedcomInput, options: ParseOptions = {}): ParseResultWithTrace {
  const sink = new WarningSink(options.warningCap);
  const { text, encoding } = toText(input, sink);
  const state = createTokenizerState();
  const interp = new Interpreter(sink, { trace: options.keepRaw });
  const raw: GedcomNode[] | undefined = options.keepRaw ? [] : undefined;
  for (const record of readRecords(text, sink, state)) {
    raw?.push(record);
    interp.record(record);
  }
  interp.finish();
  if (!encoding.declared && interp.doc.header.charset) encoding.declared = interp.doc.header.charset;
  const result: ParseResultWithTrace = {
    document: interp.doc,
    warnings: sink.result(),
    unknownTags: interp.unknownTags(),
    encoding,
    stats: state.stats,
  };
  if (raw) {
    result.raw = raw;
    result.consumed = interp.consumed;
  }
  return result;
}
