import { createHash } from "node:crypto";

import { prisma } from "../prisma";
import { DUPLICATE_VERDICTS, REVIEW_REASON_MAX, REVIEW_REASON_MIN, VERDICT_LABEL, type DuplicateVerdict } from "../duplicate-verdicts";

/**
 * KI-Vorprüfung möglicher Dubletten: Bausteine für die gespeicherte
 * Einschätzung je Paar (Tabelle DuplicateReview). Schreiben und Rechte liegen
 * in duplicates.ts (reviewDuplicate); hier nur Laden, „veraltet“ und die Form
 * für Oberfläche und MCP.
 *
 * Leitlinie: Eine Einschätzung ist nur ein Hinweis für den Menschen. Sie führt
 * nichts zusammen, blendet kein Paar aus, wählt nichts vor und ändert die
 * Klasse (sicher/wahrscheinlich/unklar) nicht.
 */

export { DUPLICATE_VERDICTS, REVIEW_REASON_MAX, REVIEW_REASON_MIN, VERDICT_LABEL, type DuplicateVerdict };

export type DuplicateReviewDto = {
  verdict: DuplicateVerdict;
  reason: string;
  /** Vorschlag, welcher Eintrag bleiben soll — nur Text, wählt nichts vor. */
  suggestedKeepId: string | null;
  /** ISO-Zeitpunkt der Einschätzung. */
  reviewedAt: string;
  /** Benutzer, über dessen KI-Zugang die Einschätzung kam (Name, sonst null). */
  userName: string | null;
  /** Name des KI-Schlüssels, solange es ihn gibt. */
  tokenName: string | null;
  /** Mindestens eine der beiden Personen wurde seit der Einschätzung geändert. */
  stale: boolean;
};

/**
 * Filter über die Vorprüfung: irgendeine (`any`), keine (`none`), offen für
 * die KI (`open` = keine oder veraltete) oder ein bestimmtes Urteil.
 */
export type ReviewFilter = "any" | "none" | "open" | DuplicateVerdict;

export const canonicalPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
export const reviewKey = (a: string, b: string) => canonicalPair(a, b).join("|");

/**
 * Stand je Person als Fingerabdruck: Stammdaten (updatedAt), Namensvarianten,
 * Lebensereignisse, Familien und Beziehungen — alles, worauf sich ein Urteil
 * über „dieselbe Person?“ stützt. Ändert sich davon etwas, weicht der
 * Fingerabdruck ab und die Einschätzung gilt als veraltet. Belege und Bilder
 * zählen bewusst nicht mit (sie ändern die Frage nicht).
 */
export async function personStates(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const [persons, rels] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        updatedAt: true,
        names: { select: { id: true }, orderBy: { id: "asc" } },
        events: { select: { id: true, updatedAt: true }, orderBy: { id: "asc" } },
        families: { select: { familyId: true }, orderBy: { familyId: "asc" } },
      },
    }),
    prisma.relationship.findMany({
      where: { OR: [{ fromPersonId: { in: unique } }, { toPersonId: { in: unique } }] },
      select: { id: true, type: true, subtype: true, fromPersonId: true, toPersonId: true, startDate: true, endDate: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const relsOf = new Map<string, string[]>();
  for (const r of rels) {
    const text = `${r.id}:${r.type}:${r.subtype}:${r.fromPersonId}:${r.toPersonId}:${r.startDate?.toISOString() ?? ""}:${r.endDate?.toISOString() ?? ""}`;
    for (const id of new Set([r.fromPersonId, r.toPersonId])) relsOf.set(id, [...(relsOf.get(id) ?? []), text]);
  }
  const out = new Map<string, string>();
  for (const p of persons) {
    const h = createHash("sha256");
    h.update(`${p.updatedAt.toISOString()}|`);
    h.update(`${p.names.map((n) => n.id).join(",")}|`);
    h.update(`${p.events.map((e) => `${e.id}@${e.updatedAt.toISOString()}`).join(",")}|`);
    h.update(`${p.families.map((f) => f.familyId).join(",")}|`);
    h.update((relsOf.get(p.id) ?? []).join(","));
    out.set(p.id, h.digest("hex").slice(0, 32));
  }
  return out;
}

/**
 * Gespeicherte Einschätzungen zu Paaren unter den angegebenen Personen, je
 * Paar-Schlüssel (reviewKey), fertig für die Anzeige samt „veraltet“.
 * `pairs` grenzt auf bestimmte Paare ein; ohne Angabe alle Paare, deren beide
 * Personen in `personIds` liegen. Wer die Einschätzung sehen darf, entscheidet
 * der Aufrufer (duplicates.ts: nur wer beide Personen bearbeiten darf).
 */
export async function loadDuplicateReviews(personIds: string[], pairs?: (a: string, b: string) => boolean): Promise<Map<string, DuplicateReviewDto>> {
  if (personIds.length === 0) return new Map();
  const rows = (
    await prisma.duplicateReview.findMany({
      where: { personAId: { in: personIds }, personBId: { in: personIds } },
      include: { user: { select: { name: true } } },
    })
  ).filter((r) => !pairs || pairs(r.personAId, r.personBId));
  if (rows.length === 0) return new Map();
  const tokenIds = [...new Set(rows.map((r) => r.apiTokenId).filter((x): x is string => Boolean(x)))];
  const [states, tokens] = await Promise.all([
    personStates(rows.flatMap((r) => [r.personAId, r.personBId])),
    tokenIds.length ? prisma.apiToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true } }) : [],
  ]);
  const tokenName = new Map(tokens.map((t) => [t.id, t.name]));
  const out = new Map<string, DuplicateReviewDto>();
  for (const r of rows) {
    out.set(reviewKey(r.personAId, r.personBId), {
      verdict: r.verdict,
      reason: r.reason,
      suggestedKeepId: r.suggestedKeepId,
      reviewedAt: r.reviewedAt.toISOString(),
      userName: r.user?.name ?? null,
      tokenName: r.apiTokenId ? (tokenName.get(r.apiTokenId) ?? null) : null,
      stale: states.get(r.personAId) !== r.stateA || states.get(r.personBId) !== r.stateB,
    });
  }
  return out;
}

/** Passt ein Paar (mit seiner sichtbaren Einschätzung oder ohne) zum Filter? */
export function matchesReviewFilter(review: DuplicateReviewDto | undefined, filter: ReviewFilter | undefined): boolean {
  if (!filter) return true;
  if (filter === "any") return Boolean(review);
  if (filter === "none") return !review;
  if (filter === "open") return !review || review.stale;
  return review?.verdict === filter;
}
