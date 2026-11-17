import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Ablage der Bilddateien im Dateisystem.
 *
 * Alle Dateien liegen unterhalb von MEDIA_DIR; der Schlüssel aus der Datenbank
 * (MediaAsset.storageKey/thumbnailKey, z.B. "originals/<uuid>.webp") ist der
 * relative Pfad darunter. Ausgeliefert wird nur über die App
 * (GET /api/media/[id]) — der Ordner selbst ist nie öffentlich.
 *
 * MEDIA_DIR wird bei jedem Aufruf zur Laufzeit gelesen (nicht beim Build
 * eingesetzt): derselbe Build läuft lokal mit ./data/media, im Container mit
 * /data/media und im Mock mit ./data/media-mock.
 */

const DEFAULT_MEDIA_DIR = "data/media";
const MAX_KEY_LENGTH = 512;

/**
 * Die einzigen Unterordner, in die die App schreibt — Präfix jedes
 * Speicherschlüssels (lib/media-processing). Der Healthcheck prüft genau
 * diese Ordner; ein neues Präfix gehört deshalb hierher.
 */
export const MEDIA_SUBDIRS = {
  originals: "originals",
  thumbs: "thumbs",
} as const;

/** Absoluter Pfad des Medienordners. */
export function mediaDir(): string {
  const configured = process.env.MEDIA_DIR?.trim();
  return path.resolve(configured || DEFAULT_MEDIA_DIR);
}

export class InvalidStorageKeyError extends Error {
  constructor(key: unknown, reason: string) {
    super(`Ungültiger Speicherschlüssel ${JSON.stringify(key)}: ${reason}`);
    this.name = "InvalidStorageKeyError";
  }
}

/**
 * Prüft einen Schlüssel und liefert den absoluten Dateipfad. Erlaubt sind nur
 * relative Pfade aus "/"-getrennten, normalen Segmenten — nichts, womit man
 * aus MEDIA_DIR herauskäme: kein absoluter Pfad, kein "..", kein Backslash,
 * kein Laufwerksbuchstabe, kein NUL. Zum Schluss wird der aufgelöste Pfad noch
 * einmal gegen den Ordner geprüft.
 */
export function resolveKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidStorageKeyError(key, "leer");
  }
  if (key.length > MAX_KEY_LENGTH) throw new InvalidStorageKeyError(key, "zu lang");
  if (key.includes("\0")) throw new InvalidStorageKeyError(key, "enthält NUL");
  if (key.includes("\\")) throw new InvalidStorageKeyError(key, "enthält Backslash");
  // ":" deckt Laufwerksbuchstaben ("C:") und NTFS-Datenströme ("a:b") ab.
  if (key.includes(":")) throw new InvalidStorageKeyError(key, "enthält Doppelpunkt");
  if (key.startsWith("/")) throw new InvalidStorageKeyError(key, "absoluter Pfad");
  const segments = key.split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") {
      throw new InvalidStorageKeyError(key, "unzulässiges Pfadsegment");
    }
  }

  const root = mediaDir();
  const full = path.resolve(root, ...segments);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!full.startsWith(prefix)) {
    throw new InvalidStorageKeyError(key, "außerhalb des Medienordners");
  }
  return full;
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Schreibt eine Datei atomar: erst in eine temporäre Datei im selben Ordner,
 * dann per rename an ihren Platz. Ein Leser sieht also nie eine halbe Datei,
 * und ein Absturz mitten im Schreiben hinterlässt höchstens eine .tmp-Datei.
 * Ordner werden bei Bedarf angelegt.
 */
export async function putObject(key: string, body: Buffer | Uint8Array): Promise<void> {
  const target = resolveKey(key);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });

  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const fh = await open(tmp, "wx");
    try {
      await fh.writeFile(body);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export type StoredObject = {
  size: number;
  mtime: Date;
  /** Starker ETag aus Größe und Änderungszeit, in Anführungszeichen. */
  etag: string;
  /** Inhalt als Web-Stream. Schließt die Datei nach dem Lesen selbst. */
  stream(): ReadableStream<Uint8Array>;
  /** Datei schließen, ohne zu lesen (z.B. bei 304). */
  close(): Promise<void>;
};

/**
 * Öffnet eine Datei zum Streamen. Liefert null, wenn sie fehlt. Größe und
 * ETag stammen vom geöffneten Handle — passen also auch dann zum Inhalt,
 * wenn die Datei währenddessen ersetzt wird.
 *
 * Genau eines von stream() oder close() muss aufgerufen werden.
 */
export async function openObject(key: string): Promise<StoredObject | null> {
  const file = resolveKey(key);
  let fh;
  try {
    fh = await open(file, "r");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) {
      await fh.close();
      return null;
    }
    const handle = fh;
    return {
      size: st.size,
      mtime: st.mtime,
      etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      stream: () =>
        Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>,
      close: () => handle.close(),
    };
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}

/** Datei vollständig als Buffer, null wenn sie fehlt. */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const file = resolveKey(key);
  try {
    return await readFile(file);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Löscht eine Datei. Fehlt sie schon, ist das kein Fehler. */
export async function deleteObject(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}

export class MediaDirError extends Error {
  constructor(
    readonly dir: string,
    cause: unknown,
  ) {
    const reason = (cause as NodeJS.ErrnoException | undefined)?.code ?? String(cause);
    super(`${dir} nicht beschreibbar (${reason})`, { cause });
    this.name = "MediaDirError";
  }
}

/**
 * Prüft, ob der Medienordner und jeder Unterordner, in den die App schreibt
 * (MEDIA_SUBDIRS), existiert (legt ihn sonst an) und beschreibbar ist —
 * per Probedatei, die wieder gelöscht wird. Nur die Wurzel zu prüfen reicht
 * nicht: nach einer Wiederherstellung als root können originals/ und thumbs/
 * root gehören, während die Wurzel beschreibbar ist — Uploads schlügen dann
 * fehl, obwohl der Healthcheck "ok" meldet.
 *
 * Wirft MediaDirError mit dem betroffenen Ordner (Wurzel zuerst) — für den
 * Healthcheck, der den Grund nur ins Log schreibt.
 */
export async function checkMediaDir(): Promise<void> {
  const root = mediaDir();
  const dirs = [root, ...Object.values(MEDIA_SUBDIRS).map((sub) => path.join(root, sub))];
  for (const dir of dirs) {
    const probe = path.join(dir, `.health-${randomUUID()}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      const fh = await open(probe, "wx");
      await fh.close();
    } catch (err) {
      throw new MediaDirError(dir, err);
    } finally {
      await rm(probe, { force: true }).catch(() => {});
    }
  }
}
