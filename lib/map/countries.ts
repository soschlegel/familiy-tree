/**
 * Ländergrenzen für die Karten im Browser (public/geo/countries.json, Natural
 * Earth, bereits wie lib/map/projection.ts projiziert): einmal je Seite
 * geladen und im Modul zwischengespeichert. Benutzt von MapExplorer und
 * LifePathMap.
 */
export type Country = { id: string; name: string; d: string };

let countriesCache: Promise<Country[]> | null = null;

export function loadCountries(): Promise<Country[]> {
  countriesCache ??= fetch("/geo/countries.json")
    .then((r) => (r.ok ? r.json() : { countries: [] }))
    .then((j: { countries: Country[] }) => j.countries)
    .catch(() => {
      countriesCache = null;
      return [];
    });
  return countriesCache;
}
