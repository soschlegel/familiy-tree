/**
 * Die Neuigkeiten dieser Version: `CHANGELOG.md` wird zur Build-Zeit als
 * Text in den Server-Code eingebaut (Webpack-Regel `?raw` in
 * next.config.mjs, in Vitest nativ). So braucht das Standalone-Image die
 * Datei zur Laufzeit nicht, und es gibt keinen Pfad, der im Container
 * fehlen könnte. Im Dev-Server wirkt eine geänderte Datei sofort.
 *
 * Nur für Seiten und Route-Handler — die Dienstschicht (lib/services) bleibt
 * frei davon, weil sie auch in einfachen Node-Prozessen (MCP über stdio,
 * Skripte) läuft, die keinen `?raw`-Import kennen.
 */
import text from "../CHANGELOG.md?raw";
import { parseReleaseNotes, type Release } from "./release-notes";

let cached: Release[] | null = null;

/** Alle Releases, neueste zuerst. */
export function releaseNotes(): Release[] {
  if (!cached) {
    const { releases, errors } = parseReleaseNotes(text);
    if (errors.length > 0) console.warn("[neuigkeiten] CHANGELOG.md:", errors.join("; "));
    cached = releases;
  }
  return cached;
}

/** Kennung des neuesten Release, null ohne Einträge. */
export function latestReleaseId(): string | null {
  return releaseNotes()[0]?.id ?? null;
}
