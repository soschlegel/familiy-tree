/**
 * Dateiablage (lib/storage): Schlüsselprüfung gegen Pfad-Ausbrüche,
 * atomares Schreiben, Lesen/Streamen, tolerantes Löschen, Healthcheck.
 * Läuft in einem eigenen temporären Ordner, nie im echten Medienordner.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  InvalidStorageKeyError,
  MEDIA_SUBDIRS,
  MediaDirError,
  checkMediaDir,
  deleteObject,
  getObjectBuffer,
  mediaDir,
  openObject,
  putObject,
  resolveKey,
} from "@/lib/storage";

let base: string;
let root: string;
const previous = process.env.MEDIA_DIR;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "familytree-storage-"));
  root = path.join(base, "media");
  process.env.MEDIA_DIR = root;
});

afterAll(async () => {
  if (previous === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = previous;
  await rm(base, { recursive: true, force: true });
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const c of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
  return Buffer.concat(chunks);
}

describe("resolveKey", () => {
  it("liest MEDIA_DIR zur Laufzeit und löst Schlüssel darunter auf", () => {
    expect(mediaDir()).toBe(path.resolve(root));
    expect(resolveKey("originals/abc.webp")).toBe(path.join(root, "originals", "abc.webp"));
    expect(resolveKey("test/cleanup-x/own-thumb")).toBe(path.join(root, "test", "cleanup-x", "own-thumb"));
  });

  it("fällt ohne MEDIA_DIR auf ./data/media zurück", () => {
    const saved = process.env.MEDIA_DIR;
    delete process.env.MEDIA_DIR;
    try {
      expect(mediaDir()).toBe(path.resolve("data/media"));
    } finally {
      process.env.MEDIA_DIR = saved;
    }
  });

  it.each([
    ["leer", ""],
    ["Elternordner", "../geheim.txt"],
    ["Elternordner in der Mitte", "originals/../../geheim.txt"],
    ["nur ..", ".."],
    ["Elternordner am Ende", "originals/.."],
    ["Punktsegment", "./originals/a.webp"],
    ["leeres Segment", "originals//a.webp"],
    ["abschließender Schrägstrich", "originals/"],
    ["absoluter Pfad", "/etc/passwd"],
    ["Backslash", "originals\\a.webp"],
    ["Backslash-Ausbruch", "..\\..\\geheim.txt"],
    ["Windows-Laufwerk", "C:/Windows/win.ini"],
    ["Windows-Laufwerk relativ", "C:geheim.txt"],
    ["UNC-Pfad", "//server/share/a"],
    ["NUL-Byte", "originals/a.webp\0.png"],
    ["NTFS-Datenstrom", "originals/a.webp:stream"],
    ["zu lang", "a".repeat(600)],
  ])("lehnt ab: %s", (_name, key) => {
    expect(() => resolveKey(key)).toThrow(InvalidStorageKeyError);
  });

  it("alle Dateifunktionen prüfen den Schlüssel", async () => {
    await expect(putObject("../ausbruch.txt", Buffer.from("x"))).rejects.toThrow(InvalidStorageKeyError);
    await expect(getObjectBuffer("../ausbruch.txt")).rejects.toThrow(InvalidStorageKeyError);
    await expect(openObject("/etc/passwd")).rejects.toThrow(InvalidStorageKeyError);
    await expect(deleteObject("a/../../x")).rejects.toThrow(InvalidStorageKeyError);
    expect(await readdir(base)).not.toContain("ausbruch.txt");
  });
});

describe("Dateien", () => {
  it("schreibt atomar, legt Ordner an und hinterlässt keine Temp-Dateien", async () => {
    await putObject("originals/eins.webp", Buffer.from("erster Inhalt"));
    await putObject("originals/eins.webp", Buffer.from("zweiter"));
    expect((await getObjectBuffer("originals/eins.webp"))?.toString()).toBe("zweiter");
    expect(await readdir(path.join(root, "originals"))).toEqual(["eins.webp"]);
  });

  it("parallele Schreibvorgänge auf denselben Schlüssel hinterlassen eine vollständige Datei", async () => {
    const a = Buffer.alloc(200_000, "a");
    const b = Buffer.alloc(200_000, "b");
    await Promise.all([putObject("thumbs/race.webp", a), putObject("thumbs/race.webp", b)]);
    const got = await getObjectBuffer("thumbs/race.webp");
    expect(got?.equals(a) || got?.equals(b)).toBe(true);
    expect(await readdir(path.join(root, "thumbs"))).toEqual(["race.webp"]);
  });

  it("fehlende Datei: Buffer und Stream liefern null", async () => {
    expect(await getObjectBuffer("originals/fehlt.webp")).toBeNull();
    expect(await openObject("originals/fehlt.webp")).toBeNull();
    expect(await openObject("gibtsnicht/ordner/fehlt.webp")).toBeNull();
  });

  it("ein Ordner unter dem Schlüssel gilt als fehlende Datei", async () => {
    await putObject("ordner/datei.webp", Buffer.from("x"));
    expect(await openObject("ordner")).toBeNull();
  });

  it("streamt Inhalt mit Größe und stabilem ETag", async () => {
    const content = Buffer.alloc(150_000, 7);
    await putObject("originals/zwei.webp", content);
    const first = await openObject("originals/zwei.webp");
    expect(first).not.toBeNull();
    expect(first!.size).toBe(content.length);
    expect(first!.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect((await readAll(first!.stream())).equals(content)).toBe(true);

    const second = await openObject("originals/zwei.webp");
    expect(second!.etag).toBe(first!.etag);
    await second!.close();
  });

  it("löschen ist idempotent", async () => {
    await putObject("originals/drei.webp", Buffer.from("x"));
    await deleteObject("originals/drei.webp");
    expect(await getObjectBuffer("originals/drei.webp")).toBeNull();
    await expect(deleteObject("originals/drei.webp")).resolves.toBeUndefined();
    await expect(deleteObject("nie/da.webp")).resolves.toBeUndefined();
  });
});

describe("checkMediaDir", () => {
  it("legt Ordner und Unterordner an und hinterlässt keine Probedatei", async () => {
    const saved = process.env.MEDIA_DIR;
    const dir = path.join(base, "neu", "media");
    process.env.MEDIA_DIR = dir;
    try {
      await checkMediaDir();
      const subdirs = Object.values(MEDIA_SUBDIRS);
      expect((await readdir(dir)).sort()).toEqual([...subdirs].sort());
      for (const sub of subdirs) expect(await readdir(path.join(dir, sub))).toEqual([]);
    } finally {
      process.env.MEDIA_DIR = saved;
    }
  });

  it.each(Object.values(MEDIA_SUBDIRS))(
    "schlägt fehl und nennt den Ordner, wenn %s/ nicht beschreibbar ist",
    async (sub) => {
      // Eine Datei an Stelle des Unterordners — unbeschreibbar auf jedem
      // Betriebssystem (chmod wirkt unter Windows nicht).
      const saved = process.env.MEDIA_DIR;
      const dir = path.join(base, `blockiert-${sub}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, sub), "x");
      process.env.MEDIA_DIR = dir;
      try {
        const err = await checkMediaDir().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(MediaDirError);
        expect((err as MediaDirError).dir).toBe(path.join(dir, sub));
        expect((err as MediaDirError).message).toContain(path.join(dir, sub));
        // Auch in den übrigen Ordnern bleibt keine Probedatei liegen.
        expect((await readdir(dir)).filter((n) => n.startsWith(".health-"))).toEqual([]);
      } finally {
        process.env.MEDIA_DIR = saved;
      }
    },
  );

  it("schlägt fehl, wenn MEDIA_DIR nicht als Ordner beschreibbar ist", async () => {
    const saved = process.env.MEDIA_DIR;
    const file = path.join(base, "keinordner");
    await writeFile(file, "x");
    process.env.MEDIA_DIR = file;
    try {
      await expect(checkMediaDir()).rejects.toMatchObject({ name: "MediaDirError", dir: file });
    } finally {
      process.env.MEDIA_DIR = saved;
    }
  });
});
