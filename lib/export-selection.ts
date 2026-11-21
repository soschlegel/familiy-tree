/**
 * Familienauswahl für den GEDCOM-Export — rein, ohne Datenbank, auch im
 * Browser nutzbar (Dialog in components/GedcomExportDialog.tsx). Dienst:
 * lib/services/export-selection.ts.
 *
 * Eine Person gehört zum Export, sobald sie in mindestens einer gewählten
 * Familie ist; „ohne Familie“ (nur Administratoren) nimmt die Personen ohne
 * jede Familienzuordnung dazu. Die Sichtbarkeitsgrenze des Exports gilt
 * zusätzlich — eine Auswahl kann nur einschränken, nie erweitern.
 */
export type ExportSelection = {
  familyIds: string[];
  withoutFamily: boolean;
};

export type ExportFamilyOverview = {
  families: { id: string; name: string }[];
  /**
   * Personenzahlen je Kombination sichtbarer Familien, damit der Dialog die
   * Zahl einer Auswahl genau berechnen kann (Personen mit mehreren Familien
   * zählen einmal) — ohne Personenkennungen und ohne fremde Familien: Eine
   * Person zählt nur mit den Familien, die der Benutzer selbst sieht.
   */
  groups: { familyIds: string[]; persons: number }[];
  /** Personen ohne Familie — nur für Administratoren, sonst null. */
  withoutFamily: number | null;
};

/** Personenzahl einer Auswahl aus der Übersicht. */
export function countSelection(
  overview: Pick<ExportFamilyOverview, "groups" | "withoutFamily">,
  familyIds: Iterable<string>,
  withoutFamily: boolean,
): number {
  const chosen = new Set(familyIds);
  let n = 0;
  for (const g of overview.groups) if (g.familyIds.some((id) => chosen.has(id))) n += g.persons;
  if (withoutFamily && overview.withoutFamily) n += overview.withoutFamily;
  return n;
}

/** Suchparameter für /api/export (leer = alles Sichtbare wie bisher). */
export function selectionQuery(selection: ExportSelection | null): string {
  if (!selection) return "";
  const p = new URLSearchParams();
  if (selection.familyIds.length) p.set("families", selection.familyIds.join(","));
  if (selection.withoutFamily) p.set("withoutFamily", "1");
  const s = p.toString();
  return s ? `&${s}` : "";
}

/** Kurzer Zusatz für den Dateinamen — nur Anzahlen, keine Familiennamen. */
export function selectionFileSuffix(selection: ExportSelection | null): string {
  if (!selection) return "";
  const n = selection.familyIds.length;
  const parts: string[] = [];
  if (n) parts.push(n === 1 ? "1-familie" : `${n}-familien`);
  if (selection.withoutFamily) parts.push("ohne-familie");
  return `_auswahl-${parts.join("-und-")}`;
}
