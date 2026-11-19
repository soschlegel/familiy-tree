/**
 * Muss als ERSTES Modul des MCP-Servers geladen werden.
 *
 * 1. stdout gehört allein dem MCP-Protokoll. Alles andere, was auf stdout
 *    schreiben würde (console.log, Prisma-Meldungen, Bibliotheken), wird auf
 *    stderr umgeleitet. Der Transport bekommt mit `protocolOut` einen eigenen
 *    Zugang zum echten stdout.
 * 2. .env aus dem Projektverzeichnis laden — unabhängig vom Arbeits-
 *    verzeichnis, aus dem der MCP-Client den Prozess startet. Bereits gesetzte
 *    Umgebungsvariablen (z.B. aus der Client-Konfiguration) haben Vorrang.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

const realStdoutWrite = process.stdout.write.bind(process.stdout);

/** Einziger Weg auf das echte stdout — nur für den MCP-Transport. */
export const protocolOut = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    realStdoutWrite(chunk, (err) => callback(err ?? null));
  },
});

const toStderr = ((chunk: unknown, encoding?: unknown, cb?: unknown) =>
  (process.stderr.write as (...args: unknown[]) => boolean)(chunk, encoding, cb)) as typeof process.stdout.write;
process.stdout.write = toStderr;
console.log = console.error;
console.info = console.error;
console.debug = console.error;

export const projectRoot = path.resolve(__dirname, "..");

const envFile = path.join(projectRoot, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.error("[mcp] .env konnte nicht gelesen werden:", (err as Error).message);
  }
}
