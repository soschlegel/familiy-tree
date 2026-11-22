/**
 * Vergleichsformen für Namen und Orte — gemeinsam für Dublettensuche,
 * Zusammenführen und Importvorschläge. Rein, ohne Datenbank.
 */

/**
 * Vergleichsform eines Namens: klein, ohne Akzente, ä→ae (wie „Mueller“ =
 * „Müller“), ß→ss, ph→f, th→t, Doppelbuchstaben einfach, nur Buchstaben und
 * Leerzeichen. „Müller“, „Mueller“ und „Muller“ ergeben nicht alle dasselbe —
 * „Muller“ bleibt bewusst verschieden (Ähnlichkeit: editDistance).
 */
export function nameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, (m) => (m === "̈" ? "e" : ""))
    .replace(/ß/g, "ss")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/[^a-z ]+/g, " ")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Erster Vorname in Vergleichsform („Anna Maria“ → „ana“). */
export function firstGivenKey(given: string | null | undefined): string {
  return nameKey(given).split(" ")[0] ?? "";
}

/**
 * Vergleichsform eines Ortes: nur der erste Teil vor dem Komma („Probstadt,
 * Kreis X“ → „probstadt“). Nicht zu verwechseln mit `placeKey` in
 * lib/places/normalize.ts (vollständiger Schlüssel der Tabelle Place).
 */
export function placeCompareKey(place: string | null | undefined): string {
  if (!place) return "";
  return nameKey(place.split(",")[0]);
}

export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = placeCompareKey(a);
  return Boolean(x) && x === placeCompareKey(b);
}

/** Levenshtein-Abstand (klein gehalten: Namen sind kurz). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
