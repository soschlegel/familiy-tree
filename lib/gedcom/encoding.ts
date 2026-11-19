/**
 * Zeichensatz erkennen und Bytes in Text umwandeln.
 *
 * Reihenfolge: 1. BOM (UTF-8, UTF-16 LE/BE), 2. UTF-16 ohne BOM an
 * Nullbytes erkennen, 3. HEAD.CHAR lesen, 4. gegen die tatsächlichen Bytes
 * prüfen (viele Dateien behaupten ANSEL oder ANSI und sind in Wahrheit
 * UTF-8), 5. Rückfall: gültiges UTF-8, sonst Windows-1252.
 */

import { decodeAnsel } from "./ansel";
import type { GedcomEncodingInfo, GedcomWarning } from "./types";

export interface DecodeResult {
  text: string;
  info: GedcomEncodingInfo;
  warnings: GedcomWarning[];
}

const enc = (label: string) => new TextDecoder(label);

function hasUtf8Multibyte(bytes: Uint8Array, limit = bytes.length): boolean {
  for (let i = 0; i < limit; i++) if (bytes[i] >= 0x80) return true;
  return false;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Liest HEAD.CHAR aus dem Anfang der Datei (ASCII-kompatible Kodierungen). */
function sniffChar(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 16384)));
  // Nur im Kopf suchen: bis zum zweiten Datensatz der Ebene 0.
  const lines = head.split(/\r\n|\r|\n/);
  let inHead = false;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(\d+)\s*(@[^@]+@\s*)?(\S+)\s*(.*)$/);
    if (!m) continue;
    if (m[1] === "0") {
      if (inHead) break;
      inHead = m[3].toUpperCase() === "HEAD";
      continue;
    }
    if (inHead && m[1] === "1" && m[3].toUpperCase() === "CHAR") return m[4].trim();
  }
  return undefined;
}

type Target = GedcomEncodingInfo["encoding"];

function mapDeclared(declared: string): Target | "UTF-16" | undefined {
  const d = declared.toUpperCase().replace(/[\s_]+/g, " ").trim();
  if (/^UTF-?8$/.test(d) || d === "UTF8") return "UTF-8";
  if (d === "UNICODE" || /^UTF-?16$/.test(d)) return "UTF-16";
  if (d === "UTF-16LE") return "UTF-16LE";
  if (d === "UTF-16BE") return "UTF-16BE";
  if (d === "ANSEL") return "ANSEL";
  if (d === "ASCII" || d === "US-ASCII") return "WINDOWS-1252";
  if (d === "ANSI" || d === "IBM WINDOWS" || d === "WINDOWS" || /^(CP|WINDOWS-?)1252$/.test(d) || d === "IBMPC" || d === "IBM DOS")
    return "WINDOWS-1252";
  if (/^(ISO-?8859-?1|LATIN1|LATIN-1)$/.test(d)) return "ISO-8859-1";
  if (d === "MACINTOSH" || d === "MAC" || d === "MACROMAN") return "MACINTOSH";
  return undefined;
}

export function decodeGedcomBytes(bytes: Uint8Array): DecodeResult {
  const warnings: GedcomWarning[] = [];

  // 1. BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return finishUtf8(bytes.subarray(3), true, "BOM", sniffChar(bytes.subarray(3)), warnings);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = enc("utf-16le").decode(bytes.subarray(2));
    return { text, info: { encoding: "UTF-16LE", bom: true, declared: sniffCharText(text), detectedBy: "BOM" }, warnings };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = enc("utf-16be").decode(bytes.subarray(2));
    return { text, info: { encoding: "UTF-16BE", bom: true, declared: sniffCharText(text), detectedBy: "BOM" }, warnings };
  }
  // 2. UTF-16 ohne BOM: "0" gefolgt von einem Nullbyte bzw. umgekehrt.
  if (bytes.length >= 4) {
    if (bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0) {
      const text = enc("utf-16le").decode(bytes);
      return { text, info: { encoding: "UTF-16LE", bom: false, declared: sniffCharText(text), detectedBy: "HEURISTIC" }, warnings };
    }
    if (bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0) {
      const text = enc("utf-16be").decode(bytes);
      return { text, info: { encoding: "UTF-16BE", bom: false, declared: sniffCharText(text), detectedBy: "HEURISTIC" }, warnings };
    }
  }

  // 3. HEAD.CHAR
  const declared = sniffChar(bytes);
  const mapped = declared ? mapDeclared(declared) : undefined;
  const multibyte = hasUtf8Multibyte(bytes);
  const validUtf8 = multibyte ? isValidUtf8(bytes) : true;

  if (!declared) {
    if (validUtf8) return finishUtf8(bytes, false, "DEFAULT", undefined, warnings);
    warnings.push({
      code: "ENCODING_FALLBACK",
      message: "Kein Zeichensatz angegeben und kein gültiges UTF-8 — gelesen als Windows-1252.",
    });
    return single(bytes, "WINDOWS-1252", declared, "HEURISTIC", warnings);
  }
  if (!mapped || mapped === "UTF-16") {
    if (mapped !== "UTF-16") {
      warnings.push({
        code: "ENCODING_UNSUPPORTED",
        message: `Unbekannter Zeichensatz „${declared}“ — gelesen als ${validUtf8 ? "UTF-8" : "Windows-1252"}.`,
      });
    } else {
      warnings.push({
        code: "ENCODING_MISMATCH",
        message: `Zeichensatz „${declared}“ angegeben, aber die Datei ist nicht UTF-16 kodiert.`,
      });
    }
    return validUtf8
      ? finishUtf8(bytes, false, "HEURISTIC", declared, warnings)
      : single(bytes, "WINDOWS-1252", declared, "HEURISTIC", warnings);
  }
  if (mapped === "UTF-8") {
    if (validUtf8) return finishUtf8(bytes, false, "CHAR", declared, warnings);
    warnings.push({
      code: "ENCODING_MISMATCH",
      message: "Als UTF-8 angegeben, enthält aber ungültige UTF-8-Bytes — gelesen als Windows-1252.",
    });
    return single(bytes, "WINDOWS-1252", declared, "HEURISTIC", warnings);
  }
  // ANSEL/ANSI/ASCII angegeben, Bytes sind aber gültiges UTF-8 mit
  // Mehrbytezeichen: Das ist in der Praxis UTF-8 (falsch deklariert).
  if (multibyte && validUtf8 && looksLikeUtf8Text(bytes)) {
    warnings.push({
      code: "ENCODING_MISMATCH",
      message: `Zeichensatz „${declared}“ angegeben, Inhalt ist aber UTF-8 — als UTF-8 gelesen.`,
    });
    return finishUtf8(bytes, false, "HEURISTIC", declared, warnings);
  }
  if (mapped === "ANSEL") {
    const { text, invalid } = decodeAnsel(bytes);
    if (invalid > 0) {
      warnings.push({ code: "INVALID_BYTES", message: `${invalid} Bytes sind in ANSEL nicht belegt (als � übernommen).` });
    }
    return { text, info: { encoding: "ANSEL", bom: false, declared, detectedBy: "CHAR" }, warnings };
  }
  return single(bytes, mapped, declared, "CHAR", warnings);
}

/** Mindestens ein Mehrbytezeichen und gültig: echter UTF-8-Text. */
function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0xc2 && b <= 0xf4) return true;
  }
  return false;
}

function finishUtf8(
  bytes: Uint8Array,
  bom: boolean,
  detectedBy: GedcomEncodingInfo["detectedBy"],
  declared: string | undefined,
  warnings: GedcomWarning[],
): DecodeResult {
  const text = new TextDecoder("utf-8").decode(bytes);
  if (declared) {
    const mapped = mapDeclared(declared);
    if (mapped && mapped !== "UTF-8" && bom) {
      warnings.push({
        code: "ENCODING_MISMATCH",
        message: `Zeichensatz „${declared}“ angegeben, die Datei beginnt aber mit einer UTF-8-Kennung (BOM) — als UTF-8 gelesen.`,
      });
    }
  }
  return { text, info: { encoding: "UTF-8", bom, declared, detectedBy }, warnings };
}

function single(
  bytes: Uint8Array,
  encoding: "WINDOWS-1252" | "ISO-8859-1" | "MACINTOSH" | "UTF-16LE" | "UTF-16BE",
  declared: string | undefined,
  detectedBy: GedcomEncodingInfo["detectedBy"],
  warnings: GedcomWarning[],
): DecodeResult {
  const label =
    encoding === "WINDOWS-1252" ? "windows-1252" : encoding === "ISO-8859-1" ? "iso-8859-1" : encoding.toLowerCase();
  const text = new TextDecoder(label).decode(bytes);
  return { text, info: { encoding, bom: false, declared, detectedBy }, warnings };
}

function sniffCharText(text: string): string | undefined {
  const m = text.slice(0, 16384).match(/(?:^|[\r\n])\s*1\s+CHAR\s+([^\r\n]+)/);
  return m ? m[1].trim() : undefined;
}

/** Text als UTF-8-Bytes, optional mit BOM. */
export function encodeUtf8(text: string, bom = false): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
