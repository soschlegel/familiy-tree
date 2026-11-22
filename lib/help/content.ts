import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { HELP_FILE, parseHelpMarkdown, type HelpDoc } from "./markdown";

/**
 * Anwender-Hilfe: je Thema eine Datei `docs/anwender/NN-thema.md`. Die
 * Nummer bestimmt die Reihenfolge, der Rest die Adresse (`/hilfe/thema`).
 * Ein neues Thema = eine neue Datei, kein Code. Andere Dateien im Ordner
 * (README.md) gehören nicht zur Hilfe.
 *
 * Gelesen wird zur Laufzeit von der Platte; next.config.mjs nimmt den Ordner
 * über outputFileTracingIncludes ins Standalone-Image mit (und .dockerignore
 * lässt ihn in den Build-Kontext).
 */
export const HELP_DIR = path.join(process.cwd(), "docs", "anwender");

export type HelpTopic = { slug: string; order: number; file: string; title: string; summary: string };

type Cache = { topics: HelpTopic[]; docs: Map<string, HelpDoc> };
let cache: Cache | null = null;

function load(dir: string): Cache {
  const files = readdirSync(dir)
    .map((file) => ({ file, m: HELP_FILE.exec(file) }))
    .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => a.file.localeCompare(b.file));
  const docs = new Map<string, HelpDoc>();
  const topics: HelpTopic[] = [];
  for (const { file, m } of files) {
    const doc = parseHelpMarkdown(readFileSync(path.join(dir, file), "utf8"));
    docs.set(m[2], doc);
    topics.push({ slug: m[2], order: Number(m[1]), file, title: doc.title, summary: doc.summary });
  }
  return { topics, docs };
}

/**
 * Im Betrieb einmal gelesen (die Dateien ändern sich nur mit einem neuen
 * Image); in der Entwicklung bei jedem Aufruf, damit Änderungen sofort
 * sichtbar sind.
 */
function current(dir = HELP_DIR): Cache {
  if (process.env.NODE_ENV !== "production" || dir !== HELP_DIR) return load(dir);
  cache ??= load(dir);
  return cache;
}

export function listHelpTopics(dir?: string): HelpTopic[] {
  return current(dir).topics;
}

export function getHelpTopic(slug: string, dir?: string): { topic: HelpTopic; doc: HelpDoc } | null {
  const c = current(dir);
  const topic = c.topics.find((t) => t.slug === slug);
  const doc = topic ? c.docs.get(slug) : undefined;
  return topic && doc ? { topic, doc } : null;
}
