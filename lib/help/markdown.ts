/**
 * Schlanker Markdown-Leser für die Anwender-Hilfe (docs/anwender/*.md).
 *
 * Bewusst nur das Subset, das die Hilfetexte brauchen — und bewusst ohne
 * rohes HTML: Das Ergebnis ist ein Syntaxbaum aus Text, den
 * components/help-render.ts als React-Elemente ausgibt (React maskiert jeden
 * Text). Ein `<script>` im Markdown bleibt so sichtbarer Text.
 *
 * Blöcke: Überschriften `#`–`####`, Absätze, Listen (`- ` und `1. `, eine
 * Ebene; eingerückte Folgezeilen gehören zum Punkt), Hinweiskästen (`> `),
 * Tabellen (`| a | b |` mit Trennzeile), Codeblöcke (```), Trennlinie (`---`).
 * Inline: `**fett**`, `*kursiv*`, `` `Code` ``, `[Text](Ziel)`, `\` maskiert.
 *
 * Linkziele (resolveHref): andere Hilfethemen als `NN-thema.md#anker`
 * (so funktionieren sie auch auf GitHub), Seiten der App als `/pfad`,
 * Anker als `#anker`, externe Seiten nur mit `https://`. Alles andere
 * (javascript:, data:, //fremd …) wird kein Link, sondern bleibt Text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: HelpHref; children: Inline[] };

export type HelpHref =
  | { kind: "help"; slug: string; hash: string | null }
  | { kind: "app"; path: string }
  | { kind: "anchor"; hash: string }
  | { kind: "external"; url: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; id: string; text: string; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "note"; children: Block[] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string }
  | { type: "rule" };

export type HelpDoc = {
  /** Text der ersten Überschrift `# …` (ohne Auszeichnung). */
  title: string;
  /** Erster Absatz als Klartext — Kurzbeschreibung für die Themenliste. */
  summary: string;
  /** Blöcke ohne die Titelzeile. */
  blocks: Block[];
};

/** Anker aus einer Überschrift: „Wie wird gezählt?“ → „wie-wird-gezaehlt“. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Dateiname eines Hilfethemas: `05-karte.md` → `karte`. */
export const HELP_FILE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

const SAFE_HASH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Linkziel prüfen und einordnen; null = kein Link (wird Text). */
export function resolveHref(raw: string): HelpHref | null {
  const target = raw.trim();
  const help = /^(?:\.\/)?(\d{2}-[a-z0-9-]+\.md)(?:#(.*))?$/.exec(target);
  if (help) {
    const m = HELP_FILE.exec(help[1]);
    if (!m) return null;
    const hash = help[2] ?? null;
    if (hash !== null && !SAFE_HASH.test(hash)) return null;
    return { kind: "help", slug: m[2], hash };
  }
  if (target.startsWith("#")) {
    const hash = target.slice(1);
    return SAFE_HASH.test(hash) ? { kind: "anchor", hash } : null;
  }
  // Eigene Seiten: absoluter Pfad, kein „//“ (das wäre ein fremder Server),
  // kein Backslash, keine Leerzeichen oder Steuerzeichen.
  if (/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%#]*$/.test(target)) return { kind: "app", path: target };
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(target)) {
    try {
      const url = new URL(target);
      return url.protocol === "https:" && url.hostname ? { kind: "external", url: url.toString() } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Inline-Auszeichnung lesen. Unvollständige Auszeichnung bleibt Text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && /[\\`*_[\]()#>|-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === "*" && src[i + 1] !== "*" && src[i + 1] !== " ") {
      const end = findSingleStar(src, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "em", children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === "[") {
      const close = findClosingBracket(src, i);
      if (close > i && src[close + 1] === "(") {
        const end = src.indexOf(")", close + 2);
        if (end > close + 1) {
          const label = src.slice(i + 1, close);
          const href = resolveHref(src.slice(close + 2, end));
          flush();
          if (href) out.push({ type: "link", href, children: parseInline(label) });
          else out.push(...parseInline(label));
          i = end + 1;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function findSingleStar(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "*" && src[j + 1] !== "*" && src[j - 1] !== " ") return j;
  }
  return -1;
}

function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "[") depth++;
    if (src[j] === "]" && --depth === 0) return j;
  }
  return -1;
}

/** Inline-Inhalt als Klartext (für Anker, Titel und Kurzbeschreibung). */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.text : plainText(n.children)))
    .join("");
}

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Blöcke lesen; `ids` sorgt seitenweit für eindeutige Anker. */
function parseBlocks(lines: string[], ids: Map<string, number>): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const isBlank = (l: string | undefined) => l === undefined || l.trim() === "";
  const startsBlock = (l: string) =>
    HEADING.test(l) || BULLET.test(l) || ORDERED.test(l) || l.startsWith(">") || l.startsWith("```") || /^---+\s*$/.test(l) || l.trimStart().startsWith("|");

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const children = parseInline(h[2]);
      const text = plainText(children);
      const base = slugify(text) || "abschnitt";
      const n = (ids.get(base) ?? 0) + 1;
      ids.set(base, n);
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3 | 4, id: n === 1 ? base : `${base}-${n}`, text, children });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) inner.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "note", children: parseBlocks(inner, ids) });
      continue;
    }
    if (line.trimStart().startsWith("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const m = pattern.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
        } else if (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else if (isBlank(lines[i]) && pattern.test(lines[i + 1] ?? "")) {
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered: isOrdered, items: items.map(parseInline) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++].trim());
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
  }
  return blocks;
}

/** Ein Hilfethema lesen: Titel, Kurzbeschreibung, Blöcke. */
export function parseHelpMarkdown(source: string): HelpDoc {
  const lines = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  const all = parseBlocks(lines, new Map());
  const titleIdx = all.findIndex((b) => b.type === "heading" && b.level === 1);
  const title = titleIdx >= 0 ? (all[titleIdx] as Extract<Block, { type: "heading" }>).text : "Hilfe";
  const blocks = titleIdx >= 0 ? all.filter((_, i) => i !== titleIdx) : all;
  const first = blocks.find((b) => b.type === "paragraph") as Extract<Block, { type: "paragraph" }> | undefined;
  return { title, summary: first ? plainText(first.children) : "", blocks };
}

/** Alle Anker (Überschriften) eines Themas — für Tests der Kontexthilfe-Links. */
export function headingIds(doc: HelpDoc): string[] {
  const out: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "heading") out.push(b.id);
      if (b.type === "note") walk(b.children);
    }
  };
  walk(doc.blocks);
  return out;
}

/** Alle Links eines Themas — für Tests (Ziele vorhanden?). */
export function collectLinks(doc: HelpDoc): HelpHref[] {
  const out: HelpHref[] = [];
  const inl = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === "link") out.push(n.href);
      if (n.type === "strong" || n.type === "em" || n.type === "link") inl(n.children);
    }
  };
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "heading" || b.type === "paragraph") inl(b.children);
      if (b.type === "list") b.items.forEach(inl);
      if (b.type === "table") [b.head, ...b.rows].forEach((r) => r.forEach(inl));
      if (b.type === "note") walk(b.children);
    }
  };
  walk(doc.blocks);
  return out;
}
