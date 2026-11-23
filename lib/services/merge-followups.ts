import { prisma } from "../prisma";
import { canEditPerson, type Scope } from "../scope";
import { lineageOf, scoreDuplicate, type Confidence, type DupPerson } from "../duplicates";
import { evidenceSentence, relaxedMatch } from "../import-linking";
import { fullName, toPersonBrief, type PersonBrief } from "./dto";
import { loadDuplicatePeople } from "./duplicates";
import { validationError } from "./errors";

/**
 * Folgedubletten nach einem Zusammenführen (Ergebnisseite): Sind zwei
 * Einträge einer Person eins geworden, hängen an der bleibenden Person oft
 * ihre Eltern, Partner und Kinder doppelt — je einmal aus jedem Eintrag.
 * Geprüft werden deshalb Eltern × Eltern, Partner × Partner und Kinder ×
 * Kinder der bleibenden Person(en).
 *
 * Bewusst vorsichtig:
 * - Die Klasse eines Paars ist genau die der Dublettenliste (`scoreDuplicate`
 *   mit derselben Abstammungsregel) — hier wird nichts hochgestuft. Der
 *   gemeinsame Verwandte zählt dort ohnehin („dasselbe Kind eingetragen“).
 * - `relaxedMatch` (lib/import-linking.ts) entscheidet nur, ob ein Paar
 *   überhaupt genannt wird (gleicher ganzer Vorname bzw. einer mehr, gleiches
 *   Geschlecht, vereinbare Daten). Paare, die nur danach passen, sind „unklar“.
 * - Passt jemand zu mehreren (gleichnamige Geschwister), sind alle diese Paare
 *   „unklar“.
 * - Zusammengeführt wird hier nichts: „sichere“ Folgedubletten gehen über die
 *   normale Vorschau des Sammel-Zusammenführens (merge-bulk.ts), die jedes
 *   Paar noch einmal selbst bewertet.
 *
 * Rechte: nur Paare, deren beide Personen der Benutzer bearbeiten darf; die
 * Abstammung läuft wie in der Liste nur über sichtbare Personen. Als „kein
 * Duplikat“ markierte Paare fehlen.
 */

export type FollowUpRelation = "parents" | "partners" | "children";

export type FollowUpDuplicate = {
  a: PersonBrief;
  b: PersonBrief;
  /** Über wen das Paar gefunden wurde: beide sind Eltern, Partner bzw. Kinder dieser Person. */
  via: { id: string; name: string; relation: FollowUpRelation };
  score: number;
  confidence: Confidence;
  reasons: string[];
  conflicts: string[];
  /** Die Gründe als ein Satz. */
  sentence: string;
};

export type FollowUpDuplicates = {
  items: FollowUpDuplicate[];
  /** Anzahl der Paare der Klasse „sicher“. */
  sure: number;
};

export const MAX_FOLLOW_UP_PERSONS = 20;
const MAX_ITEMS = 50;
const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Der gemeinsame Verwandte in den Worten der Dublettenbewertung. */
const SHARED_REASON: Record<FollowUpRelation, string> = {
  parents: "dasselbe Kind eingetragen",
  partners: "derselbe Partner eingetragen",
  children: "ein Elternteil derselbe",
};

export async function listFollowUpDuplicates(scope: Scope, personIds: unknown): Promise<FollowUpDuplicates> {
  const ids = Array.isArray(personIds) ? [...new Set(personIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100))] : [];
  if (ids.length === 0 || ids.length > MAX_FOLLOW_UP_PERSONS) {
    throw validationError([{ path: "ids", message: `Eine bis ${MAX_FOLLOW_UP_PERSONS} Personen angeben` }]);
  }
  const { graph, people } = await loadDuplicatePeople(scope);
  const byId = new Map(people.map((p) => [p.id, p]));
  const lineage = lineageOf(people);
  const editable = (id: string) => {
    const g = graph.persons.get(id);
    return Boolean(g?.visible) && canEditPerson(scope, g!.familyIds);
  };

  type Found = Omit<FollowUpDuplicate, "a" | "b" | "sentence"> & { a: string; b: string };
  const found = new Map<string, Found>();
  for (const baseId of ids) {
    const base = byId.get(baseId); // nur sichtbare Personen; unbekannt oder verborgen → nichts
    if (!base) continue;
    const kinds: [FollowUpRelation, string[]][] = [
      ["parents", base.parents],
      ["partners", base.partners],
      ["children", base.children],
    ];
    for (const [relation, relIds] of kinds) {
      const list = [...new Set(relIds)].map((id) => byId.get(id)).filter((p): p is DupPerson => Boolean(p) && editable(p!.id));
      const group: Found[] = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [x, y] = list[i].id < list[j].id ? [list[i], list[j]] : [list[j], list[i]];
          if (found.has(pairKey(x.id, y.id))) continue;
          // Miteinander verbunden (Eltern/Kind/Partner) oder Vorfahre/Nachkomme: nie dieselbe Person.
          if ([...x.parents, ...x.partners, ...x.children].includes(y.id) || lineage(x.id, y.id)) continue;
          if (!relaxedMatch(x, y).ok) continue;
          const s = scoreDuplicate(x, y, { lineage });
          group.push({
            a: x.id,
            b: y.id,
            via: { id: base.id, name: fullName(graph.persons.get(base.id)!), relation },
            score: s?.score ?? 0,
            confidence: s?.confidence ?? "low",
            reasons: s?.reasons ?? [`Vorname ${x.givenName} / ${y.givenName}`, SHARED_REASON[relation], "Nachname oder Lebensdaten passen nicht eindeutig"],
            conflicts: s?.conflicts ?? [],
          });
        }
      }
      // Eindeutigkeit: Wer zu mehreren passt, ist bei keinem „sicher“ oder „wahrscheinlich“.
      const uses = new Map<string, number>();
      for (const f of group) for (const id of [f.a, f.b]) uses.set(id, (uses.get(id) ?? 0) + 1);
      for (const f of group) {
        const rival = (uses.get(f.a) ?? 0) > 1 || (uses.get(f.b) ?? 0) > 1;
        found.set(
          pairKey(f.a, f.b),
          rival ? { ...f, confidence: "low", conflicts: [...f.conflicts, "mehrere Verwandte passen ähnlich gut (z.B. gleichnamige Geschwister)"] } : f,
        );
      }
    }
  }
  if (found.size === 0) return { items: [], sure: 0 };

  const involved = [...new Set([...found.values()].flatMap((f) => [f.a, f.b]))];
  const dismissed = new Set(
    (
      await prisma.duplicateDismissal.findMany({
        where: { personAId: { in: involved }, personBId: { in: involved } },
        select: { personAId: true, personBId: true },
      })
    ).map((d) => pairKey(d.personAId, d.personBId)),
  );
  const items = [...found.values()]
    .filter((f) => !dismissed.has(pairKey(f.a, f.b)))
    .sort((x, y) => RANK[x.confidence] - RANK[y.confidence] || y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, MAX_ITEMS)
    .map((f) => ({
      ...f,
      a: toPersonBrief(graph.persons.get(f.a)!),
      b: toPersonBrief(graph.persons.get(f.b)!),
      sentence: evidenceSentence(f.reasons),
    }));
  return { items, sure: items.filter((i) => i.confidence === "high").length };
}
