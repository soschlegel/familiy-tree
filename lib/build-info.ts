/**
 * Version des laufenden Builds für die Fußzeile („Build 2026.11.19 · 68c8471“).
 *
 * Die Werte kommen aus dem Build, nicht von der Uhr zur Laufzeit: die
 * GitHub-Action (.github/workflows/images.yml) übergibt Datum und Commit als
 * Docker-Build-Argumente, das Dockerfile reicht sie als NEXT_PUBLIC_BUILD_DATE
 * und NEXT_PUBLIC_BUILD_SHA an `next build` weiter, und Next.js setzt sie dort
 * fest in den Code ein (NEXT_PUBLIC_*: zur Buildzeit ersetzt, im
 * Standalone-Bundle enthalten). Ohne diese Variablen (npm run dev, Tests,
 * eigener Build ohne Argumente) heißt es „Build lokal“.
 *
 * Wichtig: process.env.NEXT_PUBLIC_… muss genau so ausgeschrieben bleiben —
 * Next.js ersetzt nur diese Schreibweise.
 */
export type BuildInfo = { date: string | null; sha: string | null };

export function buildInfo(): BuildInfo {
  const date = (process.env.NEXT_PUBLIC_BUILD_DATE ?? "").trim();
  const sha = (process.env.NEXT_PUBLIC_BUILD_SHA ?? "").trim().toLowerCase();
  return {
    date: /^\d{4}\.\d{2}\.\d{2}$/.test(date) ? date : null,
    sha: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : null,
  };
}

/**
 * Text der Fußzeile. Angemeldet mit Commit, sonst (Anmeldeseite, aus dem
 * Internet erreichbar) nur das Datum — der genaue Stand geht Fremde nichts an.
 */
export function buildLabel(info: BuildInfo, signedIn: boolean): string {
  if (!info.date) return "Build lokal";
  return signedIn && info.sha ? `Build ${info.date} · ${info.sha}` : `Build ${info.date}`;
}
