import sharp from "sharp";
import { randomUUID } from "node:crypto";

import { MEDIA_SUBDIRS, putObject } from "./storage";

/** Formate, die beim Upload angenommen werden (laut sharp-Metadaten). */
export const ALLOWED_IMAGE_FORMATS = new Set([
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "tiff",
]);

export class ImageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFormatError";
  }
}

/**
 * Bildformat anhand der Bytes (sharp), nicht anhand einer Angabe. Wirft
 * ImageFormatError, wenn die Datei kein erlaubtes Bild ist.
 */
export async function detectImageFormat(input: Buffer): Promise<string> {
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw new ImageFormatError("Datei ist kein lesbares Bild");
  }
  if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
    throw new ImageFormatError(`Bildformat nicht erlaubt: ${format ?? "unbekannt"}`);
  }
  return format;
}

/** Inhaltsart (MIME) → sharp-Format; nur die Bildtypen, die der Upload annimmt. */
export const IMAGE_MIME_FORMAT: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

export type StoredImage = {
  storageKey: string;
  thumbnailKey: string;
  mimeType: "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
};

/**
 * Prüft ein Bild, erzeugt Original (max. 2000px) und Vorschau (320px) als
 * WebP und legt beide im Medienordner (MEDIA_DIR) ab. Gemeinsame Verarbeitung für
 * Upload, Import und Mock-Daten, damit alle Bilder gleich aussehen.
 *
 * `.rotate()` wendet die EXIF-Orientierung an, bevor die Metadaten wegfallen —
 * sonst liegen Handyfotos später auf der Seite. Das Entfernen der übrigen
 * EXIF-Daten (u.a. GPS) ist beabsichtigt.
 *
 * Wirft ImageFormatError, wenn die Datei kein (erlaubtes) Bild ist.
 */
export async function processAndStoreImage(
  input: Buffer,
  options: { checkFormat?: boolean; keyBase?: string } = {},
): Promise<StoredImage> {
  if (options.checkFormat !== false) await detectImageFormat(input);

  const id = options.keyBase ?? randomUUID();
  const storageKey = `${MEDIA_SUBDIRS.originals}/${id}.webp`;
  const thumbnailKey = `${MEDIA_SUBDIRS.thumbs}/${id}.webp`;

  const pipeline = sharp(input).rotate();
  const [original, thumbnail] = await Promise.all([
    pipeline
      .clone()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true }),
    pipeline.clone().resize(320, 320, { fit: "cover" }).webp({ quality: 75 }).toBuffer(),
  ]);

  await Promise.all([
    putObject(storageKey, original.data),
    putObject(thumbnailKey, thumbnail),
  ]);

  return {
    storageKey,
    thumbnailKey,
    mimeType: "image/webp",
    sizeBytes: original.data.byteLength,
    width: original.info.width,
    height: original.info.height,
  };
}
