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

/** Erkennt typische HTML-Fragmente (keine bloßen „<“ im Text). */
const HTML_HINT = /<\/?(?:p|br|b|i|u|em|strong|div|span|ul|ol|li|a|font|h[1-6]|table|tr|td|th|pre|code|blockquote|sup|sub|hr|img)\b[^>]*>|&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;

export function looksLikeHtml(text: string): boolean {
  return HTML_HINT.test(text);
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

/** HTML-Fragment → lesbarer Text (Absätze, Zeilenumbrüche, Listen). */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n• ");
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|pre)\s*>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|ul|ol|tr|table|blockquote|pre|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, label: string) => {
    const l = label.replace(/<[^>]*>/g, "").trim();
    return l && l !== href ? `${l} (${href})` : href;
  });
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+\n/g, "\n").replace(/\n[ \t ]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function noteContent(raw: string): GedcomNoteContent {
  if (looksLikeHtml(raw)) return { text: htmlToText(raw), original: raw, isHtml: true };
  return { text: raw, isHtml: false };
}
