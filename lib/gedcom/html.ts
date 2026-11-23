/**
 * HTML-Fragmente in Notizen (MyHeritage, Family Historian, Ancestry) sicher in
 * Text umwandeln. Es wird nichts ausgeführt oder gerendert: Tags werden
 * entfernt bzw. in Zeilenumbrüche übersetzt, Entities aufgelöst. Das
 * Original bleibt im Modell erhalten.
 */

import type { GedcomNoteContent } from "./types";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  copy: "©", reg: "®", deg: "°", euro: "€", sect: "§", middot: "·", bull: "•",
};

/**
 * Erkennt typische HTML-Fragmente (keine bloßen „<“ im Text).
 *
 * Bewusst in zwei Schritten statt eines Musters `<tag\b[^>]*>`: das liefe bei
 * vielen geöffneten, nie geschlossenen Tags quadratisch (ReDoS, der Text
 * stammt aus Importen und Eingaben). So ist es ein Durchlauf.
 */
const TAG_START = /<\/?(?:p|br|b|i|u|em|strong|div|span|ul|ol|li|a|font|h[1-6]|table|tr|td|th|pre|code|blockquote|sup|sub|hr|img)\b/gi;
const ENTITY_HINT = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;

export function looksLikeHtml(text: string): boolean {
  const lastClose = text.lastIndexOf(">");
  if (lastClose >= 0) {
    TAG_START.lastIndex = 0;
    const m = TAG_START.exec(text);
    // Der früheste Tag-Anfang entscheidet: folgt ihm irgendwo ein „>“, ist
    // es ein Tag (dazwischen kann wegen [^>]* kein weiteres „>“ stören).
    if (m && m.index < lastClose) return true;
  }
  return ENTITY_HINT.test(text);
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return String.fromCodePoint(cp);
      return all;
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? all;
  });
}

const BLOCK_CLOSE = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr", "table", "blockquote", "pre"]);
const BLOCK_OPEN = new Set([...BLOCK_CLOSE, "hr"]);
const TAG_NAME = /^(\/?)([a-z][a-z0-9]*)(?![a-z0-9_])/i;
const HREF = /href\s*=\s*["']([^"']+)["']/i;
const BR = /^br\s*\/?$/i;

/** Ende eines schließenden Tags `</name …>` ab `from`: [Anfang, Ende) oder null. */
function findClose(lower: string, name: string, from: number): [number, number] | null {
  const needle = `</${name}`;
  for (let at = lower.indexOf(needle, from); at >= 0; at = lower.indexOf(needle, at + 1)) {
    let end = at + needle.length;
    while (end < lower.length && /\s/.test(lower[end])) end++;
    if (lower[end] === ">") return [at, end + 1];
  }
  return null;
}

/**
 * Tags in Text übersetzen — EIN Durchlauf über die Zeichenkette (indexOf
 * statt verschachtelter Muster). Die frühere Fassung aus mehreren
 * `replace`-Mustern lief bei vielen `<a href=…`-Anfängen ohne Abschluss
 * kubisch und hielt den Server minutenlang an (ReDoS); der Text kommt aus
 * Importdateien und aus Eingaben (Quellen-Notizen, Belegtexte).
 */
function convertTags(html: string, allowLinks: boolean): string {
  const lower = html.toLowerCase();
  const out: string[] = [];
  // „Kein Abschluss mehr zu finden“ je Tag merken — sonst sucht jedes
  // weitere offene Tag erneut bis zum Textende.
  const noClose = new Set<string>();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) {
      // Kein „>“ mehr: der Rest ist Text.
      out.push(html.slice(lt));
      break;
    }
    const inner = html.slice(lt + 1, gt);
    i = gt + 1;
    const m = TAG_NAME.exec(inner);
    const closing = m?.[1] === "/";
    const name = m ? m[2].toLowerCase() : "";

    if (!closing && (name === "script" || name === "style") && !noClose.has(name)) {
      const close = findClose(lower, name, i);
      if (close) i = close[1];
      else noClose.add(name);
      continue;
    }
    if (BR.test(inner)) {
      out.push("\n");
      continue;
    }
    if (name === "li") {
      if (!closing) out.push("\n• ");
      continue;
    }
    if (closing ? BLOCK_CLOSE.has(name) && /^\/[a-z0-9]+\s*$/i.test(inner) : BLOCK_OPEN.has(name)) {
      out.push("\n");
      continue;
    }
    if (allowLinks && !closing && name === "a" && !noClose.has("a")) {
      const href = HREF.exec(inner)?.[1];
      if (href) {
        const close = findClose(lower, "a", i);
        if (!close) {
          noClose.add("a");
          continue;
        }
        const label = convertTags(html.slice(i, close[0]), false).trim();
        out.push(label && label !== href ? `${label} (${href})` : href);
        i = close[1];
      }
      continue;
    }
    // Jedes andere Tag entfällt ersatzlos.
  }
  return out.join("");
}

/** HTML-Fragment → lesbarer Text (Absätze, Zeilenumbrüche, Listen). */
export function htmlToText(html: string): string {
  let s = convertTags(html, true);
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n[ \t\u00a0]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function noteContent(raw: string): GedcomNoteContent {
  if (looksLikeHtml(raw)) return { text: htmlToText(raw), original: raw, isHtml: true };
  return { text: raw, isHtml: false };
}
