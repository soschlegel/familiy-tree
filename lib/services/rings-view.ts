import type { RingsDirection } from "../ancestor-rings";
import type { Scope } from "../scope";
import { defaultRingsRootId, loadAncestorRings, type AncestorRingsDto } from "./ancestor-rings";
import { defaultDescendantRingsRootId, loadDescendantRings, type DescendantRingsDto } from "./descendant-rings";

/**
 * Ausgangsperson und Daten der Ansicht „Ringe“ — gemeinsam für die
 * Stammbaum-Seite (app/tree/page.tsx) und die Druckansicht
 * (app/tree/print/page.tsx), damit beide genau dieselben Personen nach
 * denselben Regeln zeigen.
 *
 * Reihenfolge wie in der Fokus-Ansicht: angefragte Person → weitere
 * Kandidaten (`bezug`, gemerkte Person, Bezugsperson) → Startperson. Eine
 * angefragte Person muss sichtbar sein; fehlt sie oder ist sie gesperrt,
 * heißt das Ergebnis `notFound` (beides gleich, damit sich die Existenz
 * gesperrter Personen nicht abfragen lässt). Rechte prüfen die Dienste
 * (lib/services/ancestor-rings.ts bzw. descendant-rings.ts).
 */
export async function loadRingsView(
  scope: Scope,
  {
    direction,
    generations,
    requested,
    candidates,
  }: { direction: RingsDirection; generations: number; requested: string | null; candidates: (string | null | undefined)[] },
): Promise<{ data: AncestorRingsDto | DescendantRingsDto | null; notFound: boolean }> {
  const load = (id: string) =>
    direction === "nachfahren" ? loadDescendantRings(scope, id, generations) : loadAncestorRings(scope, id, generations);
  if (requested) {
    const data = await load(requested);
    return { data, notFound: !data };
  }
  for (const id of candidates) {
    if (!id) continue;
    const data = await load(id);
    if (data) return { data, notFound: false };
  }
  const start = direction === "nachfahren" ? await defaultDescendantRingsRootId(scope) : await defaultRingsRootId(scope);
  return { data: start ? await load(start) : null, notFound: false };
}
