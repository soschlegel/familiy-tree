/**
 * Zeitgeschichte („historischer Rahmen“): reine Funktionen ohne Datenbank —
 * Zusammenführen der mitgelieferten Liste (lib/history/builtin.ts) mit den
 * eigenen Einträgen der Administratoren, Ausblenden, Auswahl für ein Jahr
 * bzw. eine Spanne, Rangfolge, Bahnen für den Zeitstrahl, Prüfung der
 * Eingaben. Laden, Rechte und Protokoll: lib/services/history.ts.
 *
 * Grundsätze:
 * - Ereignisse sind Hintergrund, nie eine Aussage über eine Person. Sie sind
 *   für alle angemeldeten Benutzer gleich und nennen keine Personen des
 *   Stammbaums.
 * - Jahreszahlen sind ganze Jahre: `from`, bei Zeiträumen zusätzlich `to`
 *   (einschließlich). Ein Ereignis „berührt“ ein Jahr, wenn das Jahr in
 *   [from, to ?? from] liegt.
 * - Das Modul wird auch im Browser benutzt (Zeitstrahl, Karte) — deshalb
 *   ohne Abhängigkeiten außer Typen und lib/history/origin.ts.
 */
import { isUnconfirmedAi } from "./origin";

/** Art eines Ereignisses — die Kennung steht so in der Datenbank. */
export const HISTORY_KINDS = ["krieg", "politik", "not", "wanderung", "sonstiges"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  krieg: "Krieg",
  politik: "Politik",
  not: "Seuche/Not",
  wanderung: "Wanderung",
  sonstiges: "Sonstiges",
};

/** 1 = großer Einschnitt, 2 = bedeutend, 3 = Ergänzung. */
export type HistoryRank = 1 | 2 | 3;

/** Rang eigener Einträge: Der Administrator hat sie bewusst ergänzt — sie gelten als wichtig. */
export const CUSTOM_RANK: HistoryRank = 1;

export type BuiltinHistoryEvent = {
  id: string;
  title: string;
  from: number;
  to: number | null;
  kind: HistoryKind;
  rank: HistoryRank;
  description: string;
};

/** Eigener Eintrag, wie er aus der Datenbank kommt (Tabelle HistoryEvent). */
export type CustomHistoryEvent = {
  id: string;
  title: string;
  yearFrom: number;
  yearTo: number | null;
  kind: string;
  description: string | null;
  region: string | null;
  /** Herkunft (lib/history/origin.ts); fehlt = von Hand. */
  origin?: string;
  /** Bestätigung durch einen Administrator; leer bei KI-Herkunft = ungeprüft. */
  confirmedAt?: Date | string | null;
};

/** Ein Ereignis zur Anzeige — mitgeliefert oder eigen, einheitlich. */
export type HistoryEvent = {
  /** Mitgeliefert: stabile Kennung aus builtin.ts; eigen: `c:` + Datenbank-Kennung. */
  id: string;
  source: "builtin" | "custom";
  title: string;
  from: number;
  to: number | null;
  kind: HistoryKind;
  description: string | null;
  /** Nur eigene Einträge: „gilt für Region/Ort“ (freier Text, nur Zusatz). */
  region: string | null;
  rank: HistoryRank;
  /**
   * Eigener Eintrag der KI, noch nicht von einem Administrator bestätigt —
   * die Anzeigestellen tragen dann den Vermerk „von KI, ungeprüft“.
   */
  aiUnconfirmed?: true;
};

/** Cookie für den Schalter „Zeitgeschichte“ (je Browser): "0" = aus, sonst an. */
export const HISTORY_COOKIE = "zeitgeschichte";

/** Ist die Zeitgeschichte laut Cookie eingeschaltet? Standard: an. */
export function historyEnabled(cookieValue: string | null | undefined): boolean {
  return cookieValue !== "0";
}

/** Cookie-Zeile zum Setzen im Browser (ein Jahr gültig). */
export function historyCookie(on: boolean): string {
  return on
    ? `${HISTORY_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${HISTORY_COOKIE}=0; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export const isHistoryKind = (v: unknown): v is HistoryKind =>
  typeof v === "string" && (HISTORY_KINDS as readonly string[]).includes(v);

/** Letztes Jahr eines Ereignisses (einschließlich). */
export const lastYear = (e: { from: number; to: number | null }) => e.to ?? e.from;

/** „1914–1918“ bzw. „1923“. */
export function formatHistoryYears(e: { from: number; to: number | null }): string {
  return e.to !== null && e.to !== e.from ? `${e.from}–${e.to}` : String(e.from);
}

/** Reihenfolge der Anzeige: nach Beginn, dann Ende, dann Titel. */
export function byTime(a: HistoryEvent, b: HistoryEvent): number {
  return a.from - b.from || lastYear(a) - lastYear(b) || a.title.localeCompare(b.title, "de");
}

/** Rangfolge: wichtigere zuerst, bei Gleichstand nach der Zeit. */
export function byRank(a: HistoryEvent, b: HistoryEvent): number {
  return a.rank - b.rank || byTime(a, b);
}

/**
 * Mitgelieferte und eigene Einträge zu einer Liste zusammenführen: Ausgeblendete
 * mitgelieferte fallen heraus; eigene mit unbekannter Art gelten als
 * „Sonstiges“. Ergebnis nach der Zeit sortiert.
 */
export function mergeHistory(
  builtin: readonly BuiltinHistoryEvent[],
  custom: readonly CustomHistoryEvent[],
  hiddenBuiltinIds: Iterable<string>,
): HistoryEvent[] {
  const hidden = new Set(hiddenBuiltinIds);
  const out: HistoryEvent[] = [];
  for (const b of builtin) {
    if (hidden.has(b.id)) continue;
    out.push({ id: b.id, source: "builtin", title: b.title, from: b.from, to: b.to, kind: b.kind, description: b.description, region: null, rank: b.rank });
  }
  for (const c of custom) {
    out.push({
      id: `c:${c.id}`,
      source: "custom",
      title: c.title,
      from: c.yearFrom,
      to: c.yearTo !== null && c.yearTo !== c.yearFrom ? c.yearTo : null,
      kind: isHistoryKind(c.kind) ? c.kind : "sonstiges",
      description: c.description?.trim() || null,
      region: c.region?.trim() || null,
      rank: CUSTOM_RANK,
      ...(c.origin && isUnconfirmedAi({ origin: c.origin, confirmedAt: c.confirmedAt ?? null }) ? { aiUnconfirmed: true as const } : {}),
    });
  }
  return out.sort(byTime);
}

/** Ereignisse, die die Spanne [from, to] (einschließlich) berühren — nach der Zeit. */
export function eventsInSpan(events: readonly HistoryEvent[], from: number, to: number): HistoryEvent[] {
  if (to < from) return [];
  return events.filter((e) => e.from <= to && lastYear(e) >= from).sort(byTime);
}

/** Ereignisse, die das Jahr berühren (Zeitraum schließt das Jahr ein, Einzeljahr = das Jahr). */
export function eventsInYear(events: readonly HistoryEvent[], year: number): HistoryEvent[] {
  return eventsInSpan(events, year, year);
}

/**
 * Die wichtigsten `limit` Ereignisse (nach Rang) und den Rest — beide Teile
 * nach der Zeit sortiert, damit sie sich wie eine Zeitleiste lesen.
 */
export function splitByRank(events: readonly HistoryEvent[], limit: number): { top: HistoryEvent[]; rest: HistoryEvent[] } {
  const ranked = [...events].sort(byRank);
  return { top: ranked.slice(0, Math.max(0, limit)).sort(byTime), rest: ranked.slice(Math.max(0, limit)).sort(byTime) };
}

/**
 * Bahnen für den Zeitstrahl: Ereignisse, die sich zeitlich überschneiden,
 * kommen in verschiedene Bahnen (0, 1, 2 …), damit sich die Bänder nicht
 * verdecken. Gierig nach Beginn — deterministisch, ohne Zufall.
 */
export function historyLanes(events: readonly HistoryEvent[]): { event: HistoryEvent; lane: number }[] {
  const ends: number[] = [];
  return [...events].sort(byTime).map((event) => {
    let lane = ends.findIndex((end) => end < event.from);
    if (lane === -1) {
      lane = ends.length;
      ends.push(lastYear(event));
    } else {
      ends[lane] = lastYear(event);
    }
    return { event, lane };
  });
}

// ---------------------------------------------------------------------------
// Prüfung eigener Einträge
// ---------------------------------------------------------------------------

export const HISTORY_LIMITS = {
  title: 120,
  description: 500,
  region: 120,
  /** Früheste erlaubte Jahreszahl. */
  minYear: 1000,
} as const;

export type HistoryInput = {
  title: string;
  yearFrom: number;
  yearTo: number | null;
  kind: HistoryKind;
  description: string | null;
  region: string | null;
};

export type HistoryCheck = { ok: true; value: HistoryInput } | { ok: false; issues: { path: string; message: string }[] };

const toYear = (v: unknown): number | null | "invalid" => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{1,4}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : "invalid";
};

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Eingabe eines eigenen Eintrags prüfen und vereinheitlichen: Titel Pflicht,
 * Jahr „von“ Pflicht (ganzes Jahr ab 1000, nicht in der Zukunft), „bis“
 * optional und nicht vor „von“ (gleich „von“ → Einzeljahr), Art aus der
 * Liste, Beschreibung und Region optional mit Höchstlänge.
 */
export function checkHistoryInput(input: Record<string, unknown>, currentYear: number): HistoryCheck {
  const issues: { path: string; message: string }[] = [];
  const title = text(input.title);
  if (!title) issues.push({ path: "title", message: "Bitte einen Titel angeben." });
  else if (title.length > HISTORY_LIMITS.title) issues.push({ path: "title", message: `Höchstens ${HISTORY_LIMITS.title} Zeichen.` });

  const from = toYear(input.yearFrom);
  const to = toYear(input.yearTo);
  const yearOk = (y: number) => y >= HISTORY_LIMITS.minYear && y <= currentYear;
  if (from === null) issues.push({ path: "yearFrom", message: "Bitte das Jahr angeben." });
  else if (from === "invalid" || !yearOk(from)) {
    issues.push({ path: "yearFrom", message: `Ein ganzes Jahr zwischen ${HISTORY_LIMITS.minYear} und ${currentYear}.` });
  }
  if (to === "invalid" || (typeof to === "number" && !yearOk(to))) {
    issues.push({ path: "yearTo", message: `Ein ganzes Jahr zwischen ${HISTORY_LIMITS.minYear} und ${currentYear}.` });
  } else if (typeof to === "number" && typeof from === "number" && to < from) {
    issues.push({ path: "yearTo", message: "„bis“ darf nicht vor „von“ liegen." });
  }

  const kind = input.kind;
  if (!isHistoryKind(kind)) issues.push({ path: "kind", message: "Bitte eine Art wählen." });

  const description = text(input.description);
  if (description.length > HISTORY_LIMITS.description) {
    issues.push({ path: "description", message: `Höchstens ${HISTORY_LIMITS.description} Zeichen.` });
  }
  const region = text(input.region);
  if (region.length > HISTORY_LIMITS.region) issues.push({ path: "region", message: `Höchstens ${HISTORY_LIMITS.region} Zeichen.` });

  if (issues.length > 0) return { ok: false, issues };
  const yearFrom = from as number;
  const yearTo = typeof to === "number" && to !== yearFrom ? to : null;
  return {
    ok: true,
    value: { title, yearFrom, yearTo, kind: kind as HistoryKind, description: description || null, region: region || null },
  };
}
