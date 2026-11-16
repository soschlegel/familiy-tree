import {
  defaultFocusId,
  FOCUS_DEPTH,
  focusSubgraph,
  type FocusTreeData,
} from "../focus-tree";
import { maskPerson, visibleFamilyIds, type Scope } from "../scope";
import type { TreeData } from "../tree-layout";
import { iso } from "./dto";
import { loadGraph, type LoadedGraph } from "./graph-data";

/**
 * Kompletter Graph für die Baumansicht — sichtbare Personen mit Angaben, alle
 * übrigen als anonymer Platzhalter. Dadurch bleibt der Baum zusammenhängend
 * und Kinder stehen nicht ohne sichtbare Eltern da, während Name, Daten und
 * Bilder verborgen bleiben.
 *
 * Die Beziehungsstruktur selbst wird nicht verschleiert — dass an einer Stelle
 * jemand steht, ist am Platzhalter ohnehin ablesbar. Art, Datum und Bild einer
 * Beziehung erscheinen aber nur, wenn wenigstens eine Seite sichtbar ist.
 */
export async function loadTree(scope: Scope): Promise<TreeData> {
  return maskTree(scope, await loadGraph(scope));
}

export type TreeCounts = {
  /** Personen, die der Benutzer sehen darf. */
  visible: number;
  /** Personen, die nur als Platzhalter erscheinen. */
  hidden: number;
  relationships: number;
};

export type FocusTreeResult = {
  /** null: angefragte Person gibt es nicht, sie ist gesperrt, oder es ist niemand sichtbar. */
  tree: FocusTreeData | null;
  /** Die ausdrücklich angefragte Person wurde nicht gefunden (bzw. ist gesperrt). */
  notFound: boolean;
  counts: TreeCounts;
};

/**
 * Ausschnitt für die Fokus-Ansicht: nur die Personen rund um `focusId` statt
 * des ganzen Graphen. Baut auf demselben maskierten Graphen auf wie loadTree,
 * kann also nichts zeigen, was dort nicht ohnehin steht.
 *
 * - `focusId` gesetzt und sichtbar: dieser Ausschnitt.
 * - `focusId` unbekannt oder gesperrt: `notFound` — außer `fallback` ist
 *   gesetzt (z.B. bei einer gemerkten Person aus einem Cookie), dann gilt
 *   die Startperson. Unbekannt und gesperrt sehen gleich aus, damit sich die
 *   Existenz gesperrter Personen nicht abfragen lässt.
 * - ohne `focusId`: Startperson (defaultFocusId).
 */
export async function loadFocusTree(
  scope: Scope,
  options: { focusId?: string | null; up?: number; down?: number; fallback?: boolean } = {},
): Promise<FocusTreeResult> {
  const data = await loadTree(scope);
  const depth = {
    up: options.up ?? FOCUS_DEPTH.up,
    down: options.down ?? FOCUS_DEPTH.down,
  };
  const visible = data.persons.filter((p) => !p.restricted).length;
  const counts: TreeCounts = {
    visible,
    hidden: data.persons.length - visible,
    relationships: data.relationships.length,
  };

  if (options.focusId) {
    const tree = focusSubgraph(data, options.focusId, depth);
    if (tree) return { tree, notFound: false, counts };
    if (!options.fallback) return { tree: null, notFound: true, counts };
  }

  const start = defaultFocusId(data, depth);
  return {
    tree: start ? focusSubgraph(data, start, depth) : null,
    notFound: false,
    counts,
  };
}

function maskTree(scope: Scope, graph: LoadedGraph): TreeData {

  const persons = [...graph.persons.values()].map((p) => {
    if (!p.visible) return maskPerson(p.id);
    return {
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: iso(p.birthDate),
      deathDate: iso(p.deathDate),
      birthDatePrecision: p.birthDatePrecision,
      birthDateQualifier: p.birthDateQualifier,
      deathDatePrecision: p.deathDatePrecision,
      deathDateQualifier: p.deathDateQualifier,
      primaryMediaId: p.primaryMediaId,
      restricted: false as const,
      familyIds: visibleFamilyIds(scope, p.familyIds),
    };
  });

  const visible = (id: string) => graph.persons.get(id)?.visible ?? false;

  return {
    persons,
    relationships: graph.relationships.map((r) => {
      const anyVisible = visible(r.from) || visible(r.to);
      return {
        id: r.id,
        type: r.type,
        // Neutraler Platzhalter passend zum Typ, damit auch maskierte
        // Beziehungen eine gültige Kombination tragen.
        subtype: anyVisible
          ? r.subtype
          : r.type === "PARENT_OF"
            ? "BIOLOGICAL"
            : "UNMARRIED",
        fromPersonId: r.from,
        toPersonId: r.to,
        startDate: anyVisible ? iso(r.startDate) : null,
        startDatePrecision: anyVisible ? r.startDatePrecision : "DAY",
        startDateQualifier: anyVisible ? r.startDateQualifier : "EXACT",
        endDate: anyVisible ? iso(r.endDate) : null,
        endDatePrecision: anyVisible ? r.endDatePrecision : "DAY",
        endDateQualifier: anyVisible ? r.endDateQualifier : "EXACT",
        primaryMediaId: anyVisible ? r.primaryMediaId : null,
      };
    }),
  };
}
