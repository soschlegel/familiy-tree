/**
 * Neuigkeiten (Versions-Changelog für Anwender) aus `CHANGELOG.md`.
 *
 * Nicht zu verwechseln mit der Änderungsgeschichte der Daten
 * (`lib/change-sets.ts`, `/admin/changes`): hier geht es um neue Versionen
 * der App, nicht um geänderte Personen.
 *
 * Format je Release (neueste zuerst):
 *
 *     ## 2026-11-22.2 — Kurztitel
 *
 *     - Stichpunkt in Anwendersprache
 *       (Fortsetzung eingerückt)
 *
 * Die Kennung ist das Datum des Ausrollens plus laufende Nummer am Tag —
 * bewusst keine Commit-Kennung. Alles vor der ersten `## `-Überschrift
 * (Titel, Einleitung) und HTML-Kommentare werden übergangen.
 *
 * Reine Funktionen ohne Datei- oder Datenbankzugriff; den Inhalt der Datei
 * liefert `lib/release-notes-data.ts` (zur Build-Zeit eingebaut).
 */

export type Release = {
  /** Kennung „JJJJ-MM-TT.N“. */
  id: string;
  /** Datum „JJJJ-MM-TT“. */
  date: string;
  /** Laufende Nummer am Tag (ab 1). */
  seq: number;
  title: string;
  items: string[];
};

export type ParseResult = { releases: Release[]; errors: string[] };

const ID_RE = /^(\d{4})-(\d{2})-(\d{2})\.([1-9]\d{0,2})$/;
const HEADING_RE = /^##\s+(\S+)\s+[—–-]\s+(.+?)\s*$/;

/** Zerlegt eine Kennung; null bei falschem Format oder unmöglichem Datum. */
export function parseReleaseId(id: string): { date: string; seq: number } | null {
  const m = ID_RE.exec(id);
  if (!m) return null;
  const [, y, mo, d, n] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return { date: `${y}-${mo}-${d}`, seq: Number(n) };
}

/** Vergleicht zwei gültige Kennungen: < 0, wenn a älter ist als b. */
export function compareReleaseIds(a: string, b: string): number {
  const pa = parseReleaseId(a);
  const pb = parseReleaseId(b);
  if (!pa || !pb) throw new Error(`Ungültige Release-Kennung: ${!pa ? a : b}`);
  if (pa.date !== pb.date) return pa.date < pb.date ? -1 : 1;
  return pa.seq - pb.seq;
}

/**
 * Liest den Text von `CHANGELOG.md`. Fehlerhafte Stellen landen mit
 * Zeilennummer in `errors` (der Test der echten Datei verlangt eine leere
 * Liste); die App zeigt dann nur die einwandfreien Releases.
 */
export function parseReleaseNotes(text: string): ParseResult {
  const errors: string[] = [];
  const releases: Release[] = [];
  // HTML-Kommentare entfernen, Zeilenzahl dabei erhalten.
  const lines = text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, "")).split(/\r?\n/);

  let current: (Release & { line: number; valid: boolean }) | null = null;
  let lastItem = false;

  const finish = () => {
    if (!current) return;
    if (current.items.length === 0) errors.push(`Zeile ${current.line}: Release ${current.id} ohne Stichpunkte`);
    else if (current.valid) {
      const { line: _line, valid: _valid, ...release } = current;
      releases.push(release);
    }
    current = null;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("## ")) {
      finish();
      const m = HEADING_RE.exec(line);
      const parsed = m ? parseReleaseId(m[1]) : null;
      if (!m || !parsed) {
        errors.push(`Zeile ${lineNo}: Überschrift nicht im Format „## JJJJ-MM-TT.N — Titel“`);
        current = { id: m?.[1] ?? "?", date: "", seq: 0, title: "", items: [], line: lineNo, valid: false };
      } else {
        current = { id: m[1], ...parsed, title: m[2], items: [], line: lineNo, valid: true };
      }
      lastItem = false;
      return;
    }
    if (!current) return; // Einleitung vor dem ersten Release
    if (line.trim() === "") {
      lastItem = false;
      return;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      current.items.push(item[1].trim());
      lastItem = true;
      return;
    }
    if (/^\s+\S/.test(line) && lastItem) {
      const items = current.items;
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
      return;
    }
    errors.push(`Zeile ${lineNo}: nur Stichpunkte („- …“) unter einer Release-Überschrift erlaubt`);
  });
  finish();

  // Eindeutig und absteigend sortiert (neueste zuerst).
  const seen = new Set<string>();
  const unique: Release[] = [];
  for (const r of releases) {
    if (seen.has(r.id)) {
      errors.push(`Release ${r.id} doppelt`);
      continue;
    }
    seen.add(r.id);
    const prev = unique[unique.length - 1];
    if (prev && compareReleaseIds(r.id, prev.id) > 0) {
      errors.push(`Release ${r.id} steht unter dem älteren ${prev.id} — neueste zuerst`);
    }
    unique.push(r);
  }
  unique.sort((a, b) => compareReleaseIds(b.id, a.id));
  return { releases: unique, errors };
}

/** Höchstens so viele Releases zeigt das Fenster „Was ist neu?“. */
export const WHATS_NEW_LIMIT = 3;

/**
 * Welche Releases ein Benutzer im Fenster „Was ist neu?“ sieht.
 *
 * - Noch nichts gesehen (Feld leer, z.B. bestehende Benutzer beim ersten
 *   Ausrollen dieser Funktion) oder eine unlesbare Kennung: nur das neueste.
 * - Sonst alle neueren als das zuletzt gesehene, höchstens `limit`; die
 *   übrigen zählt `more` (Link auf die Seite „Neuigkeiten“).
 * - Nichts Neues: leere Liste — kein Fenster.
 */
export function releasesSince(
  releases: Release[],
  lastSeenId: string | null | undefined,
  limit = WHATS_NEW_LIMIT,
): { show: Release[]; more: number } {
  if (releases.length === 0) return { show: [], more: 0 };
  if (!lastSeenId || !parseReleaseId(lastSeenId)) return { show: releases.slice(0, 1), more: 0 };
  const newer = releases.filter((r) => compareReleaseIds(r.id, lastSeenId) > 0);
  const show = newer.slice(0, Math.max(1, limit));
  return { show, more: newer.length - show.length };
}

/** „22. November 2026“ — Datum einer Kennung für die Anzeige. */
export function formatReleaseDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
