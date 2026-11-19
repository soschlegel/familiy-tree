/**
 * Zeilen → Datensatzbäume. Arbeitet Datensatz für Datensatz (Generator), ohne
 * die Datei in ein Zeilen-Array zu zerlegen: Für eine große Datei liegt nur
 * der dekodierte Text und der gerade gelesene Datensatz im Speicher, sofern
 * der Aufrufer die Bäume nicht selbst festhält.
 *
 * Nachsichtig gegenüber realen Fehlern — statt Ausnahmen gibt es Warnungen
 * mit Zeilennummer: Zeilen ohne Ebene (werden als Fortsetzung angehängt),
 * führende Leerzeichen, Tabs und mehrfache Leerzeichen als Trenner, fehlende
 * Trenner („1GEDC“, „0 @I1@INDI“), überlange Zeilen, Ebenensprünge, Zeiger mit
 * angehängtem Text, CONC in GEDCOM 7, fehlender HEAD bzw. TRLR.
 */

import type { GedcomNode, GedcomStats } from "./types";
import type { WarningSink } from "./warnings";

/** Tags, deren Wert ein Zeiger sein kann (für „@X1@ Kommentar“). */
const POINTER_TAGS = new Set([
  "FAMC", "FAMS", "HUSB", "WIFE", "CHIL", "SOUR", "NOTE", "SNOTE", "OBJE", "REPO", "SUBM", "SUBN",
  "ASSO", "ALIA", "ANCI", "DESI",
]);

export interface TokenizerState {
  /** 5 oder 7 — wird nach dem HEAD-Datensatz gesetzt (GEDC.VERS). */
  majorVersion: 5 | 7;
  stats: GedcomStats;
  sawHead: boolean;
  sawTrailer: boolean;
}

export function createTokenizerState(): TokenizerState {
  return {
    majorVersion: 5,
    sawHead: false,
    sawTrailer: false,
    stats: { lines: 0, continuationLines: 0, blankLines: 0, repairedLines: 0, skippedLines: 0, nodes: 0, records: {} },
  };
}

const MAX_LINE = 255;

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09;
}

/** `@@` auflösen: 5.5.1 überall, 7.0 nur am Anfang des Wertes. */
function unescapeAt(value: string, major: 5 | 7): string {
  if (!value.includes("@@")) return value;
  if (major === 7) return value.startsWith("@@") ? value.slice(1) : value;
  return value.replace(/@@/g, "@");
}

/**
 * Liest alle Datensätze (Ebene 0) aus `text`. `sink` sammelt Warnungen,
 * `state` die Statistik und die erkannte Version.
 */
export function* readRecords(text: string, sink: WarningSink, state: TokenizerState): Generator<GedcomNode> {
  const stack: GedcomNode[] = [];
  /** Letzter Knoten, an den eine Fortsetzung ohne Ebene angehängt werden kann. */
  let lastNode: GedcomNode | null = null;
  let current: GedcomNode | null = null;
  let lineNo = 0;
  let pos = 0;
  const len = text.length;
  let warnedLeading = false;
  let warnedExtra = false;
  let warnedTab = false;

  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  while (pos < len) {
    // Zeile abgrenzen: \r\n, \n, \r
    let end = pos;
    while (end < len) {
      const c = text.charCodeAt(end);
      if (c === 0x0a || c === 0x0d) break;
      end++;
    }
    let next = end;
    if (next < len) {
      if (text.charCodeAt(next) === 0x0d && text.charCodeAt(next + 1) === 0x0a) next += 2;
      else next += 1;
    }
    const line = text.slice(pos, end);
    pos = next;
    lineNo++;
    state.stats.lines++;

    if (line.trim() === "") {
      state.stats.blankLines++;
      continue;
    }
    if (line.length > MAX_LINE) {
      sink.add("LINE_TOO_LONG", `Zeile ist ${line.length} Zeichen lang (erlaubt sind ${MAX_LINE}).`, lineNo);
    }

    // --- Ebene
    let i = 0;
    while (i < line.length && isSpace(line.charCodeAt(i))) i++;
    if (i > 0 && !warnedLeading) {
      sink.add("LEADING_WHITESPACE", "Zeilen beginnen mit Leerzeichen oder Tabs (toleriert).", lineNo);
      warnedLeading = true;
    }
    const levelStart = i;
    while (i < line.length && line.charCodeAt(i) >= 0x30 && line.charCodeAt(i) <= 0x39) i++;
    if (i === levelStart || i - levelStart > 2) {
      // Keine Ebene: Text gehört vermutlich zur vorigen Zeile (z.B. ein
      // Zeilenumbruch in einer Notiz ohne CONT).
      if (lastNode) {
        lastNode.value = (lastNode.value ?? "") + "\n" + line;
        state.stats.repairedLines++;
        sink.add("LINE_WITHOUT_LEVEL", "Zeile ohne Ebenennummer — als Fortsetzung der vorigen Zeile übernommen.", lineNo);
      } else {
        state.stats.skippedLines++;
        sink.add("MALFORMED_LINE", "Zeile ohne Ebenennummer vor dem ersten Datensatz — übersprungen.", lineNo);
      }
      continue;
    }
    let level = Number(line.slice(levelStart, i));

    // --- Trenner
    let delim = i;
    while (i < line.length && isSpace(line.charCodeAt(i))) i++;
    const gap = line.slice(delim, i);
    if (gap.length === 0) {
      sink.add("MISSING_DELIMITER", "Fehlendes Leerzeichen nach der Ebene (toleriert).", lineNo);
    } else if (gap.length > 1 && !warnedExtra) {
      sink.add("EXTRA_WHITESPACE", "Mehrere Leerzeichen als Trenner (toleriert).", lineNo);
      warnedExtra = true;
    }
    if (gap.includes("\t") && !warnedTab) {
      sink.add("TAB_DELIMITER", "Tabulator als Trenner (toleriert).", lineNo);
      warnedTab = true;
    }

    // --- Xref
    let xref: string | undefined;
    if (line.charCodeAt(i) === 0x40 /* @ */) {
      const close = line.indexOf("@", i + 1);
      if (close > i + 1) {
        xref = line.slice(i + 1, close);
        i = close + 1;
        delim = i;
        while (i < line.length && isSpace(line.charCodeAt(i))) i++;
        if (i === delim) sink.add("MISSING_DELIMITER", "Fehlendes Leerzeichen nach der Kennung (toleriert).", lineNo);
      }
    }

    // --- Tag
    const tagStart = i;
    while (i < line.length && !isSpace(line.charCodeAt(i))) i++;
    let tag = line.slice(tagStart, i);
    const plausibleTag = /^_?[A-Za-z0-9_]{1,40}$/.test(tag);
    const looksLikeText = !plausibleTag || (level > stack.length && tag !== tag.toUpperCase());
    if (!tag || (looksLikeText && lastNode)) {
      if (lastNode && tag) {
        // „1850 zog er nach …“ in einer Notiz ohne CONT: Text, keine Zeile.
        lastNode.value = (lastNode.value ?? "") + "\n" + line;
        state.stats.repairedLines++;
        sink.add("LINE_WITHOUT_LEVEL", "Zeile ohne gültige Ebene/Tag — als Fortsetzung der vorigen Zeile übernommen.", lineNo);
        continue;
      }
      sink.add("MALFORMED_LINE", "Zeile ohne Tag — übersprungen.", lineNo);
      state.stats.skippedLines++;
      continue;
    }
    if (!tag.startsWith("_")) tag = tag.toUpperCase();

    // --- Wert: genau ein Trenner, der Rest unverändert (auch Leerzeichen).
    let value: string | undefined;
    if (i < line.length) {
      value = line.slice(i + 1);
      if (value === "" ) value = undefined;
    }

    // --- Ebene einordnen
    if (level > 0 && stack.length === 0) {
      sink.add("MALFORMED_LINE", "Zeile mit Ebene > 0 vor dem ersten Datensatz — übersprungen.", lineNo);
      state.stats.skippedLines++;
      continue;
    }
    if (level > stack.length) {
      sink.add("LEVEL_JUMP", `Ebene springt von ${stack.length - 1} auf ${level} — eingeordnet unter die vorige Zeile.`, lineNo);
      level = stack.length;
    }

    // --- CONC/CONT an den Elternknoten anhängen
    if ((tag === "CONC" || tag === "CONT") && level > 0) {
      const parent = stack[level - 1];
      const piece = value === undefined ? "" : unescapeAt(value, state.majorVersion);
      if (tag === "CONC" && state.majorVersion === 7) {
        sink.add("CONC_IN_V7", "CONC gibt es in GEDCOM 7 nicht mehr — trotzdem angehängt.", lineNo);
      }
      parent.value = (parent.value ?? "") + (tag === "CONT" ? "\n" : "") + piece;
      state.stats.continuationLines++;
      stack.length = level;
      lastNode = parent;
      continue;
    }

    const node: GedcomNode = { tag, line: lineNo, children: [] };
    if (xref !== undefined) node.xref = xref;
    if (value !== undefined) {
      const ptr = value.match(/^@([^@#][^@]*)@(.*)$/);
      if (ptr && (ptr[2] === "" || (POINTER_TAGS.has(tag) && /^\s/.test(ptr[2])))) {
        node.pointer = ptr[1];
        if (ptr[2].trim()) {
          sink.add("POINTER_WITH_TRAILING_TEXT", "Zeiger mit angehängtem Text — nur der Zeiger wird verwendet, der Text bleibt erhalten.", lineNo);
          node.children.push({ tag: "_TRAILING_TEXT", value: ptr[2].trim(), line: lineNo, children: [] });
        }
      } else {
        node.value = unescapeAt(value, state.majorVersion);
      }
    }
    state.stats.nodes++;

    if (level === 0) {
      if (current) yield finishRecord(current, state, sink);
      current = node;
      stack.length = 0;
      stack.push(node);
      if (state.sawTrailer) {
        sink.add("DATA_AFTER_TRLR", "Daten nach dem Dateiende (TRLR) — trotzdem gelesen.", lineNo);
      }
      if (tag === "HEAD") state.sawHead = true;
      else if (!state.sawHead && state.stats.nodes === 1) {
        sink.add("MISSING_HEAD", "Die Datei beginnt nicht mit HEAD.", lineNo);
      }
      if (tag === "TRLR") state.sawTrailer = true;
    } else {
      stack[level - 1].children.push(node);
      stack.length = level;
      stack.push(node);
    }
    lastNode = node;
  }
  if (current) yield finishRecord(current, state, sink);
  if (!state.sawTrailer) sink.add("MISSING_TRLR", "Die Datei endet ohne TRLR — möglicherweise unvollständig.");
}

function finishRecord(record: GedcomNode, state: TokenizerState, _sink: WarningSink): GedcomNode {
  state.stats.records[record.tag] = (state.stats.records[record.tag] ?? 0) + 1;
  if (record.tag === "HEAD") {
    const gedc = record.children.find((c) => c.tag === "GEDC");
    const vers = gedc?.children.find((c) => c.tag === "VERS")?.value?.trim();
    if (vers && /^7\./.test(vers)) state.majorVersion = 7;
  }
  return record;
}
