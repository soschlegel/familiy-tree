/**
 * Zeitgeschichte: Herkunft eigener Einträge („von Hand“ / „von KI“),
 * Bestätigung durch einen Administrator und Dublettenschutz — reine
 * Funktionen ohne Datenbank. Laden, Rechte und Protokoll:
 * lib/services/history.ts; die KI schreibt über die MCP-Werkzeuge
 * (mcp/tools.ts, add_history_event usw.).
 *
 * Regeln (Entscheidungen des Eigentümers):
 * - Einträge der KI sind sofort für alle sichtbar, tragen aber den Vermerk
 *   „von KI, ungeprüft“, bis ein Administrator sie bestätigt.
 * - Ändert die KI einen Eintrag inhaltlich (Titel, Jahre, Art,
 *   Beschreibung, Region, Geltungsbereich), ist er wieder unbestätigt; ein von Hand
 *   angelegter wird dabei „von KI geändert“. Die KI kann nichts bestätigen.
 * - Speichert ein Administrator einen unbestätigten KI-Eintrag von Hand,
 *   gilt er als bestätigt.
 * - Die KI legt nichts an, was es (mitgeliefert oder eigen) mit gleichem
 *   bzw. sehr ähnlichem Titel und überlappenden Jahren schon gibt.
 *
 * Wird auch im Browser benutzt (Verwaltungsseite) — ohne Abhängigkeiten.
 */

export const HISTORY_ORIGINS = ["MANUAL", "AI", "AI_EDITED"] as const;
export type HistoryOrigin = (typeof HISTORY_ORIGINS)[number];

export const HISTORY_ORIGIN_LABEL: Record<HistoryOrigin, string> = {
  MANUAL: "von Hand",
  AI: "von KI",
  AI_EDITED: "von KI geändert",
};

/** Vermerk an den Anzeigestellen (Zeitstrahl, Zeitreise, Lebenslauf). */
export const AI_UNCONFIRMED_LABEL = "von KI, ungeprüft";

/** Felder, deren Änderung durch die KI die Bestätigung aufhebt. */
export const HISTORY_CONTENT_FIELDS = ["title", "yearFrom", "yearTo", "kind", "description", "region", "areas"] as const;

/** Grenzen der Begründung bzw. Quelle der KI. */
export const AI_REASON_LIMITS = { min: 15, max: 1000, url: 500 } as const;

type OriginState = { origin: string; confirmedAt: Date | string | null };

/** Stammt der Eintrag (ganz oder in der letzten Änderung) von der KI? */
export const isAiOrigin = (origin: string): boolean => origin === "AI" || origin === "AI_EDITED";

/** Unbestätigter KI-Eintrag — trägt an den Anzeigestellen den Vermerk „von KI, ungeprüft“. */
export function isUnconfirmedAi(e: OriginState): boolean {
  return isAiOrigin(e.origin) && !e.confirmedAt;
}

/** Herkunft nach einer inhaltlichen Änderung durch die KI. */
export function originAfterAiEdit(origin: string): HistoryOrigin {
  return origin === "AI" ? "AI" : "AI_EDITED";
}

/**
 * Herkunfts- und Bestätigungsspalten nach einer Änderung durch die KI:
 * Hat sich ein Inhaltsfeld geändert, ist der Eintrag wieder unbestätigt
 * (von Hand angelegte werden „von KI geändert“) und die Begründung der KI
 * ersetzt die alte. Ohne Inhaltsänderung: nichts.
 */
export function aiEditEffect(
  before: OriginState,
  changedFields: readonly string[],
  reason: { aiReason: string; aiSourceUrl: string | null },
): { origin: HistoryOrigin; confirmedAt: null; confirmedById: null; aiReason: string; aiSourceUrl: string | null } | null {
  const content = changedFields.some((f) => (HISTORY_CONTENT_FIELDS as readonly string[]).includes(f));
  if (!content) return null;
  return { origin: originAfterAiEdit(before.origin), confirmedAt: null, confirmedById: null, ...reason };
}

/**
 * Speichert ein Administrator von Hand, ist ein unbestätigter KI-Eintrag
 * danach bestätigt — auch ohne Inhaltsänderung („geprüft und gespeichert“).
 * Von Hand angelegte und schon bestätigte bleiben, wie sie sind.
 */
export function confirmsOnManualSave(before: OriginState): boolean {
  return isUnconfirmedAi(before);
}

// ---------------------------------------------------------------------------
// Begründung / Quelle der KI
// ---------------------------------------------------------------------------

export type AiReasonCheck =
  | { ok: true; value: { aiReason: string; aiSourceUrl: string | null } }
  | { ok: false; issues: { path: string; message: string }[] };

/**
 * Begründung mit Quelle (Pflicht, woher stammt die Jahreszahl) und optional
 * eine Adresse `https://…`. Leerraum wird vereinheitlicht.
 */
export function checkAiReason(reason: unknown, url: unknown): AiReasonCheck {
  const issues: { path: string; message: string }[] = [];
  const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  if (text.length < AI_REASON_LIMITS.min) {
    issues.push({
      path: "reason",
      message: `Bitte eine Begründung mit Quelle angeben (woher stammt die Jahreszahl), mindestens ${AI_REASON_LIMITS.min} Zeichen.`,
    });
  } else if (text.length > AI_REASON_LIMITS.max) {
    issues.push({ path: "reason", message: `Höchstens ${AI_REASON_LIMITS.max} Zeichen.` });
  }
  let sourceUrl: string | null = null;
  if (url !== undefined && url !== null && url !== "") {
    const raw = typeof url === "string" ? url.trim() : "";
    let parsed: URL | null = null;
    try {
      parsed = raw.length <= AI_REASON_LIMITS.url ? new URL(raw) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      issues.push({ path: "source_url", message: `Nur eine Adresse https://… (höchstens ${AI_REASON_LIMITS.url} Zeichen).` });
    } else {
      sourceUrl = parsed.toString();
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { aiReason: text, aiSourceUrl: sourceUrl } };
}

// ---------------------------------------------------------------------------
// Dublettenschutz
// ---------------------------------------------------------------------------

/** Wörter ohne Unterscheidungskraft im Titelvergleich. */
const STOPWORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "und", "oder", "von", "vom", "zum", "zur",
  "im", "in", "an", "am", "auf", "aus", "bei", "mit", "nach", "fuer", "gegen", "ueber", "the", "of", "and",
]);

/** Titel vereinheitlichen: klein, Umlaute ausgeschrieben, nur Buchstaben/Ziffern, einfache Leerzeichen. */
export function normalizeHistoryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Grobe Grundform: häufige deutsche Endungen ab, damit „Erste“ und „Erster“ gleich zählen. */
const stem = (t: string) => (t.length >= 5 ? t.replace(/(ern|em|en|er|es|e|n|s)$/, "") : t);

function tokens(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map(stem),
  );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Gleicher oder sehr ähnlicher Titel? Gleich nach Vereinheitlichung; einer
 * enthält den anderen ganz (mindestens 5 Zeichen); fast dieselbe
 * Schreibweise (Tippfehler, ≥ 85 % gleich); oder dieselben
 * bedeutungstragenden Wörter (Jaccard ≥ 0,6).
 */
export function similarHistoryTitles(a: string, b: string): boolean {
  const x = normalizeHistoryTitle(a);
  const y = normalizeHistoryTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 5 && ` ${long} `.includes(` ${short} `)) return true;
  if (1 - levenshtein(x, y) / long.length >= 0.85) return true;
  const tx = tokens(x);
  const ty = tokens(y);
  // Ohne Füllwörter und Endungen gleich bzw. enthalten („Der Erste Weltkrieg“ = „Erster Weltkrieg“).
  const sx = [...tx].join(" ");
  const sy = [...ty].join(" ");
  if (sx && sx === sy) return true;
  if (tx.size === 0 || ty.size === 0) return false;
  let common = 0;
  for (const t of tx) if (ty.has(t)) common++;
  return common / (tx.size + ty.size - common) >= 0.6;
}

/** Überschneiden sich die Jahresspannen (einschließlich)? */
export function historyYearsOverlap(
  a: { from: number; to: number | null },
  b: { from: number; to: number | null },
): boolean {
  return a.from <= (b.to ?? b.from) && b.from <= (a.to ?? a.from);
}

export type HistoryDuplicateCandidate = {
  id: string;
  source: "builtin" | "custom";
  title: string;
  from: number;
  to: number | null;
  region?: string | null;
};

/**
 * Können zwei Regionen dasselbe meinen? Fehlt eine (mitgelieferte haben
 * keine), ja; sonst nur, wenn eine die andere enthält. So bleiben zwei
 * Hochwasser desselben Jahres in verschiedenen Gegenden möglich.
 */
export function historyRegionsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeHistoryTitle(a ?? "");
  const y = normalizeHistoryTitle(b ?? "");
  if (!x || !y) return true;
  return ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/** Meldung bei einer Dublette — nennt den vorhandenen Eintrag und den Weg über update_history_event. */
export function formatDuplicateHint(e: HistoryDuplicateCandidate): string {
  const years = e.to !== null && e.to !== e.from ? `${e.from}–${e.to}` : String(e.from);
  const how =
    e.source === "builtin"
      ? "Er ist mitgeliefert und lässt sich nicht ändern — nichts anlegen."
      : "Statt neu anzulegen, ggf. den vorhandenen mit update_history_event ändern.";
  return `Es gibt schon einen Eintrag „${e.title}“ (${years}, Kennung ${e.id}). ${how}`;
}

/**
 * Erster vorhandener Eintrag (mitgeliefert oder eigen, auch ausgeblendete
 * mitgelieferte) mit gleichem bzw. sehr ähnlichem Titel, überlappenden
 * Jahren und verträglicher Region — oder null. `exceptId` überspringt den
 * Eintrag selbst.
 */
export function findHistoryDuplicate<T extends HistoryDuplicateCandidate>(
  candidate: { title: string; from: number; to: number | null; region?: string | null },
  existing: readonly T[],
  exceptId?: string,
): T | null {
  for (const e of existing) {
    if (exceptId && e.id === exceptId) continue;
    if (
      historyYearsOverlap(candidate, e) &&
      historyRegionsCompatible(candidate.region, e.region) &&
      similarHistoryTitles(candidate.title, e.title)
    ) {
      return e;
    }
  }
  return null;
}
