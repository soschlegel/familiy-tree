/**
 * Zwischenspeicher für das Ergebnis von /api/health (app/api/health/route.ts).
 *
 * Die Route ist ohne Anmeldung erreichbar, und jede Prüfung kostet eine
 * Datenbankabfrage und Probedateien im Medienordner. Das Ergebnis gilt
 * deshalb einige Sekunden: Viele Aufrufe von außen lösen höchstens eine
 * Prüfung je Zeitfenster aus; gleichzeitige Aufrufe teilen sich die laufende.
 *
 * Eigene Datei, weil eine Route-Datei in Next.js nur Handler und
 * Routen-Einstellungen exportieren darf.
 */
export const HEALTH_CACHE_MS = 5000;

let cached: { at: number; ok: Promise<boolean> } | null = null;

/** Ergebnis der letzten Prüfung, solange es jünger als HEALTH_CACHE_MS ist — sonst neu prüfen. */
export function cachedHealth(probe: () => Promise<boolean>, now = Date.now()): Promise<boolean> {
  if (!cached || now - cached.at >= HEALTH_CACHE_MS) cached = { at: now, ok: probe() };
  return cached.ok;
}

/** Nur für Tests. */
export function resetHealthCache(): void {
  cached = null;
}
