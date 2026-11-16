import { maskPerson, visibleFamilyIds, type Scope } from "../scope";
import type { TreeData } from "../tree-layout";
import { iso } from "./dto";
import { loadGraph } from "./graph-data";

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
  const graph = await loadGraph(scope);

  const persons = [...graph.persons.values()].map((p) => {
    if (!p.visible) return maskPerson(p.id);
    return {
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: iso(p.birthDate),
      deathDate: iso(p.deathDate),
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
        endDate: anyVisible ? iso(r.endDate) : null,
        primaryMediaId: anyVisible ? r.primaryMediaId : null,
      };
    }),
  };
}
