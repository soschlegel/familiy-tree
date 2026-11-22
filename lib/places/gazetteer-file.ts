import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { parseGazetteer, type Gazetteer } from "./gazetteer";

/**
 * Lädt das mitgelieferte Ortsverzeichnis (nur Server). Gebraucht wird es nur
 * von der Admin-Seite „Orte zuordnen“ (Vorschläge, Suche, automatische
 * Zuordnung) — die Karte liest die fertigen Koordinaten aus der Tabelle
 * Place. Deshalb wird es erst beim ersten Bedarf geladen (rund 1–2 s, gut
 * 100 MB im Speicher) und nach IDLE_MS ohne Benutzung wieder freigegeben.
 *
 * Der Pfad steht in next.config.mjs unter outputFileTracingIncludes, damit
 * die Datei im Standalone-Build (Docker-Image) mitkommt.
 */
export const GAZETTEER_FILE = path.join(process.cwd(), "geo", "gazetteer.tsv.gz");
const IDLE_MS = 10 * 60_000;

let cached: Gazetteer | null = null;
let loading: Promise<Gazetteer> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function touch() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    cached = null;
    timer = null;
  }, IDLE_MS);
  // Der Zeitgeber soll einen Prozess (Tests, Skripte) nicht am Beenden hindern.
  timer.unref?.();
}

export function loadGazetteerSync(file = GAZETTEER_FILE): Gazetteer {
  return parseGazetteer(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

export async function getGazetteer(): Promise<Gazetteer> {
  if (cached) {
    touch();
    return cached;
  }
  loading ??= (async () => {
    const buf = await fs.promises.readFile(GAZETTEER_FILE);
    const text = await new Promise<string>((resolve, reject) =>
      zlib.gunzip(buf, (err, out) => (err ? reject(err) : resolve(out.toString("utf8")))),
    );
    return parseGazetteer(text);
  })();
  try {
    cached = await loading;
  } finally {
    loading = null;
  }
  touch();
  return cached;
}
