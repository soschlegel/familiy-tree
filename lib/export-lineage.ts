/**
 * Auswahl „Ab einer Person“ für den GEDCOM-Export — rein, ohne Datenbank.
 * Dienst: lib/services/export-selection.ts (lädt den sichtbaren Graphen und
 * ruft `collectLineage` auf); Parameter und Dateiname: lib/export-selection.ts.
 *
 * Gesammelt wird nur über sichtbare Personen: Der Graph, den der Aufrufer
 * übergibt, enthält ausschließlich sie, und Kanten zu anderen Personen werden
 * hier zusätzlich verworfen. Eine gesperrte Person beendet damit die Linie —
 * was hinter ihr läge, wird weder gesammelt noch gezählt.
 *
 * Regeln (Kästchen im Dialog):
 * - immer: die Person und ihre Vorfahren — leibliche Eltern, deren Eltern
 *   usw. (mit `allParents` auch Adoptiv-, Stief- und Pflegeeltern samt deren
 *   Vorfahren), ohne Tiefengrenze außer `generations`;
 * - `partners`: alle Partner (Ehe, Partnerschaft, auch frühere) der Person
 *   und der Vorfahren, mit `descendants` auch die der Nachkommen;
 * - `siblings`: alle weiteren Kinder der Vorfahren, also Geschwister und
 *   Halbgeschwister der Person und jedes Vorfahren, soweit der gemeinsame
 *   Elternteil im Export ist;
 * - `siblingFamilies` (nur mit `siblings`): Partner und Kinder dieser
 *   Geschwister — eine Stufe, nicht weiter hinab;
 * - `descendants`: Kinder, Enkel usw. der Person.
 * Welche Eltern-Kind-Verbindungen zählen, bestimmt `allParents` überall
 * gleich: ohne nur leibliche, mit auch Adoptiv-, Stief- und Pflegekinder.
 */

export type LineageOptions = {
  partners: boolean;
  siblings: boolean;
  siblingFamilies: boolean;
  descendants: boolean;
  /** Auch Adoptiv-, Stief- und Pflegeeltern (bzw. -kinder) mitnehmen. */
  allParents: boolean;
  /** Höchstens so viele Generationen hinauf (1 = Eltern); null = alle. */
  generations: number | null;
};

export const DEFAULT_LINEAGE_OPTIONS: LineageOptions = {
  partners: false,
  siblings: false,
  siblingFamilies: false,
  descendants: false,
  allParents: false,
  generations: null,
};

export type LineageEdge = {
  type: "PARENT_OF" | "PARTNER_OF";
  subtype: string;
  /** PARENT_OF: Elternteil; PARTNER_OF: eine Seite. */
  from: string;
  /** PARENT_OF: Kind; PARTNER_OF: andere Seite. */
  to: string;
};

/** Anzahl je Gruppe; jede Person zählt einmal, in der ersten passenden Gruppe. */
export type LineageCounts = {
  person: number;
  ancestors: number;
  descendants: number;
  siblings: number;
  partners: number;
  siblingFamilies: number;
  total: number;
};

export const EMPTY_LINEAGE_COUNTS: LineageCounts = {
  person: 0,
  ancestors: 0,
  descendants: 0,
  siblings: 0,
  partners: 0,
  siblingFamilies: 0,
  total: 0,
};

/** Höchste erlaubte Generationenzahl in der Eingabe (größere = alle). */
export const MAX_GENERATIONS = 99;

export function collectLineage(
  visible: ReadonlySet<string>,
  edges: Iterable<LineageEdge>,
  startId: string,
  options: LineageOptions,
): { ids: Set<string>; counts: LineageCounts } {
  const counts = { ...EMPTY_LINEAGE_COUNTS };
  const ids = new Set<string>();
  if (!visible.has(startId)) return { ids, counts };

  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) {
      if (!list.includes(v)) list.push(v);
    } else m.set(k, [v]);
  };
  for (const e of edges) {
    if (e.from === e.to || !visible.has(e.from) || !visible.has(e.to)) continue;
    if (e.type === "PARTNER_OF") {
      push(partnersOf, e.from, e.to);
      push(partnersOf, e.to, e.from);
    } else if (e.type === "PARENT_OF" && (options.allParents || e.subtype === "BIOLOGICAL")) {
      push(parentsOf, e.to, e.from);
      push(childrenOf, e.from, e.to);
    }
  }

  const add = (id: string, group: Exclude<keyof LineageCounts, "total">): boolean => {
    if (ids.has(id)) return false;
    ids.add(id);
    counts[group]++;
    counts.total++;
    return true;
  };

  // Person und Vorfahren (Breitensuche; `ids` verhindert Kreise).
  add(startId, "person");
  const line: string[] = [startId];
  const ancestors: string[] = [];
  let level = [startId];
  for (let depth = 1; level.length && (options.generations === null || depth <= options.generations); depth++) {
    const next: string[] = [];
    for (const id of level) {
      for (const p of parentsOf.get(id) ?? []) {
        if (add(p, "ancestors")) {
          next.push(p);
          ancestors.push(p);
          line.push(p);
        }
      }
    }
    level = next;
  }

  // Nachkommen der Person (Breitensuche, ohne Grenze).
  const descendants: string[] = [];
  if (options.descendants) {
    const seen = new Set<string>([startId]);
    let wave = [startId];
    while (wave.length) {
      const next: string[] = [];
      for (const id of wave) {
        for (const c of childrenOf.get(id) ?? []) {
          if (seen.has(c)) continue;
          seen.add(c);
          next.push(c);
          descendants.push(c);
          add(c, "descendants");
        }
      }
      wave = next;
    }
  }

  // Geschwister: weitere Kinder der Vorfahren (Halbgeschwister eingeschlossen).
  const siblings: string[] = [];
  if (options.siblings) {
    for (const a of ancestors) {
      for (const c of childrenOf.get(a) ?? []) {
        if (add(c, "siblings")) siblings.push(c);
      }
    }
  }

  // Partner der Person, der Vorfahren und (mit Nachkommen) der Nachkommen.
  if (options.partners) {
    for (const id of [...line, ...descendants]) {
      for (const p of partnersOf.get(id) ?? []) add(p, "partners");
    }
  }

  // Familien der Geschwister: Partner und Kinder, eine Stufe.
  if (options.siblings && options.siblingFamilies) {
    for (const s of siblings) {
      for (const p of partnersOf.get(s) ?? []) add(p, "siblingFamilies");
      for (const c of childrenOf.get(s) ?? []) add(c, "siblingFamilies");
    }
  }

  return { ids, counts };
}
