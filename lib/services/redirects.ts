import type { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { canViewPerson, type Scope } from "../scope";
import { conflictError, type ServiceError } from "./errors";

/**
 * Alte Kennung als Umleitung: Nach einem Zusammenführen zeigt die Kennung der
 * aufgegangenen Person auf die bleibende (Tabelle `PersonRedirect`). Links,
 * Lesezeichen und Kennungen, die eine KI sich gemerkt hat, führen so weiter
 * zum richtigen Eintrag.
 *
 * - **Anlegen** im Zusammenführen selbst (`recordPersonRedirect`, in dessen
 *   Transaktion): `X → K`, und alles, was bisher auf `X` zeigte, zeigt danach
 *   auf `K` — es gibt keine Ketten, ein Nachschlagen genügt.
 * - **Auflösen** nur, wenn der Benutzer die Zielperson sehen darf
 *   (`resolvePersonRedirects`). Sonst gibt es keine Antwort — genau wie bei
 *   einer unbekannten Kennung; eine Umleitung verriete sonst, dass es eine
 *   verborgene Person gibt.
 * - **Rückfüllung** für Zusammenführungen aus der Zeit vor dieser Tabelle aus
 *   dem Audit (`backfillPersonRedirects`): im Code statt in der Migration,
 *   damit das Ausrollen an keinen Daten scheitern kann; beliebig oft
 *   wiederholbar; läuft je Serverprozess einmal, beim ersten Nachschlagen
 *   ohne Treffer.
 *
 * Nur Personen: aufgegangene Beziehungen und Ereignisse bekommen keine
 * Umleitung.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Im Zusammenführen `fromId` (geht auf) → `toId` (bleibt) vermerken. Muss in
 * der Transaktion VOR dem Löschen der aufgehenden Person laufen: Einträge,
 * die auf sie zeigen, fielen sonst mit ihr weg (ON DELETE CASCADE).
 */
export async function recordPersonRedirect(db: Db, fromId: string, toId: string, now: Date): Promise<void> {
  if (fromId === toId) return;
  // Die bleibende Person ist keine alte Kennung (und zeigt nie auf sich selbst).
  await db.personRedirect.deleteMany({ where: { fromId: toId } });
  await db.personRedirect.updateMany({ where: { toId: fromId }, data: { toId } });
  await db.personRedirect.upsert({ where: { fromId }, create: { fromId, toId, createdAt: now }, update: { toId, createdAt: now } });
}

const usable = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 100;

async function lookup(ids: string[]) {
  return prisma.personRedirect.findMany({
    where: { fromId: { in: ids } },
    select: { fromId: true, toId: true, to: { select: { families: { select: { familyId: true } } } } },
  });
}

/**
 * Alte Kennungen auflösen: alte → heutige Kennung, nur für Ziele, die der
 * Benutzer sehen darf. Kennungen, zu denen es (noch) eine Person gibt, werden
 * nie umgeleitet. Der Scope darf als Funktion kommen — er wird dann nur
 * geladen, wenn es überhaupt eine Umleitung gibt (Stammbaum: ein
 * Schlüsselzugriff je Aufruf statt einer zweiten Anmeldungsprüfung).
 */
export async function resolvePersonRedirects(scope: Scope | (() => Promise<Scope>), ids: readonly unknown[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter(usable))];
  if (wanted.length === 0) return out;
  let rows = await lookup(wanted);
  if (rows.length < wanted.length && (await ensurePersonRedirectBackfill())) rows = await lookup(wanted);
  if (rows.length === 0) return out;
  const alive = new Set((await prisma.person.findMany({ where: { id: { in: rows.map((r) => r.fromId) } }, select: { id: true } })).map((p) => p.id));
  const s = typeof scope === "function" ? await scope() : scope;
  for (const r of rows) {
    if (alive.has(r.fromId)) continue;
    if (!canViewPerson(s, r.to.families.map((f) => f.familyId))) continue;
    out.set(r.fromId, r.toId);
  }
  return out;
}

/** Heutige Kennung zu einer alten — oder null (unbekannt, Ziel nicht sichtbar, Person gibt es noch). */
export async function resolvePersonRedirect(scope: Scope | (() => Promise<Scope>), id: string): Promise<string | null> {
  return (await resolvePersonRedirects(scope, [id])).get(id) ?? null;
}

/**
 * Für schreibende Aufrufe auf eine alte Kennung (PATCH/DELETE): Konflikt mit
 * `mergedInto` statt „nicht gefunden“ — aber nur, wenn die Zielperson sichtbar
 * ist; sonst null, und der Aufrufer bleibt bei „nicht gefunden“.
 */
export async function mergedIntoError(scope: Scope, id: string): Promise<ServiceError | null> {
  const to = await resolvePersonRedirect(scope, id);
  if (!to) return null;
  return conflictError("Diese Person wurde mit einer anderen zusammengeführt — bitte den bleibenden Eintrag verwenden.", { mergedInto: to });
}

// ---------------------------------------------------------------------------
// Rückfüllung aus dem Audit
// ---------------------------------------------------------------------------

export type RedirectBackfill = {
  /** Zusammenführungen im Audit (alte Kennung → bleibende Person). */
  found: number;
  /** Davon heute auflösbar: alte Person weg, Ziel (nach allen Ketten) vorhanden. */
  resolvable: number;
  /** Neu eingetragen (vorhandene Einträge bleiben unberührt). */
  created: number;
};

const CHUNK = 2000;

/**
 * Umleitungen für frühere Zusammenführungen nachtragen. Quelle ist das Audit:
 * je Zusammenführen ein `MERGE`-Eintrag (`diff.mergeId` → `entityId`), dazu die
 * Gruppen abgeschlossener Läufe von „Importe verbinden“ (`CONNECT`,
 * `diff.clusters`; ohne die dort als fehlgeschlagen vermerkten).
 *
 * Kann an keinen Daten scheitern:
 * - gelesen werden nur Zeilen mit den erwarteten Schlüsseln (`jsonb_typeof`),
 *   ohne Umwandlungen, die werfen könnten; alles Weitere prüft der Code;
 * - Ketten (A → B, B → C) werden zum Ende verfolgt, Kreise übersprungen;
 * - eingetragen wird nur, wenn es die alte Person nicht mehr und das Ziel noch
 *   gibt; vorhandene Einträge gewinnen (`ON CONFLICT DO NOTHING`);
 * - wird das Ziel genau währenddessen gelöscht, fällt nur diese eine Zeile weg.
 * Wiederholen ändert nichts.
 */
export async function backfillPersonRedirects(): Promise<RedirectBackfill> {
  const target = new Map<string, string>();

  // 1. Gruppen aus „Importe verbinden“ — schwächere Quelle, deshalb zuerst
  //    (ein MERGE-Eintrag für dieselbe Kennung überschreibt sie unten).
  const connects = await prisma.$queryRaw<{ clusters: unknown; failed: unknown }[]>`
    SELECT "diff"->'clusters' AS "clusters", "diff"->'failed' AS "failed"
    FROM "AuditLog"
    WHERE "action" = 'CONNECT' AND jsonb_typeof("diff") = 'object' AND jsonb_typeof("diff"->'clusters') = 'array'
    ORDER BY "createdAt", "id"`;
  for (const row of connects) {
    const failed = new Set<string>();
    if (Array.isArray(row.failed)) for (const f of row.failed) if (f && typeof f === "object" && usable((f as { names?: unknown }).names)) failed.add((f as { names: string }).names);
    if (!Array.isArray(row.clusters)) continue;
    for (const c of row.clusters) {
      if (!c || typeof c !== "object") continue;
      const { keep, merge } = c as { keep?: unknown; merge?: unknown };
      if (!usable(keep) || failed.has(keep) || !Array.isArray(merge)) continue;
      for (const m of merge) if (usable(m) && m !== keep) target.set(m, keep);
    }
  }

  // 2. Die Zusammenführungen selbst, in zeitlicher Reihenfolge.
  const merges = await prisma.$queryRaw<{ fromId: string | null; toId: string | null }[]>`
    SELECT "diff"->>'mergeId' AS "fromId", "entityId" AS "toId"
    FROM "AuditLog"
    WHERE "action" = 'MERGE' AND "entityType" = 'Person'
      AND jsonb_typeof("diff") = 'object' AND jsonb_typeof("diff"->'mergeId') = 'string'
    ORDER BY "createdAt", "id"`;
  for (const m of merges) if (usable(m.fromId) && usable(m.toId) && m.fromId !== m.toId) target.set(m.fromId, m.toId);

  const result: RedirectBackfill = { found: target.size, resolvable: 0, created: 0 };
  if (target.size === 0) return result;

  // 3. Ketten bis zum Ende verfolgen (A → B → C ergibt A → C und B → C).
  const finalOf = (start: string): string | null => {
    const seen = new Set([start]);
    let cur = target.get(start)!;
    while (target.has(cur)) {
      if (seen.has(cur)) return null; // Kreis in fehlerhaften Daten
      seen.add(cur);
      cur = target.get(cur)!;
    }
    return seen.has(cur) ? null : cur;
  };
  const pairs: { fromId: string; toId: string }[] = [];
  for (const fromId of target.keys()) {
    const toId = finalOf(fromId);
    if (toId) pairs.push({ fromId, toId });
  }

  // 4. Nur, wo es die alte Person nicht mehr und das Ziel noch gibt.
  const ids = [...new Set(pairs.flatMap((p) => [p.fromId, p.toId]))];
  const alive = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await prisma.person.findMany({ where: { id: { in: ids.slice(i, i + CHUNK) } }, select: { id: true } });
    for (const r of rows) alive.add(r.id);
  }
  const rows = pairs.filter((p) => !alive.has(p.fromId) && alive.has(p.toId));
  result.resolvable = rows.length;

  // 5. Eintragen; vorhandene Einträge bleiben (skipDuplicates = ON CONFLICT DO NOTHING).
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    try {
      result.created += (await prisma.personRedirect.createMany({ data: part, skipDuplicates: true })).count;
    } catch {
      // Ein Ziel wurde genau jetzt gelöscht (Fremdschlüssel): Zeile für Zeile, die betroffene entfällt.
      for (const row of part) {
        try {
          result.created += (await prisma.personRedirect.createMany({ data: [row], skipDuplicates: true })).count;
        } catch {
          // Ziel gibt es nicht mehr — dann auch keine Umleitung.
        }
      }
    }
  }
  return result;
}

// Je Serverprozess einmal; nach einem Fehler frühestens nach einer Minute erneut.
type BackfillState = { run: Promise<boolean>; done: boolean; failedAt?: number };
const state = globalThis as unknown as { __personRedirectBackfill?: BackfillState };
const RETRY_MS = 60_000;

/**
 * Rückfüllung einmal je Prozess anstoßen und abwarten. Liefert true, wenn sie
 * während DIESES Aufrufs fertig wurde (dann lohnt ein zweites Nachschlagen),
 * sonst false. Fehler landen im Server-Log und halten keinen Aufruf auf.
 */
export async function ensurePersonRedirectBackfill(): Promise<boolean> {
  const s = state.__personRedirectBackfill;
  if (s && !(s.failedAt && Date.now() - s.failedAt > RETRY_MS)) {
    if (s.done) return false;
    return s.run;
  }
  const entry: BackfillState = {
    done: false,
    run: backfillPersonRedirects().then(
      (r) => {
        entry.done = true;
        if (r.created > 0) console.log(`[umleitungen] ${r.created} alte Kennungen aus dem Audit nachgetragen (${r.found} Zusammenführungen gefunden).`);
        return true;
      },
      (err: unknown) => {
        console.error("[umleitungen] Rückfüllung fehlgeschlagen:", err);
        entry.done = true;
        entry.failedAt = Date.now();
        return false;
      },
    ),
  };
  state.__personRedirectBackfill = entry;
  return entry.run;
}
