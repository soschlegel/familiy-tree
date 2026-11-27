import { MAX_GENERATIONS, type LineageCounts, type LineageOptions } from "./export-lineage";

/**
 * Auswahl für den GEDCOM-Export — rein, ohne Datenbank, auch im Browser
 * nutzbar (Dialog in components/GedcomExportDialog.tsx). Dienst:
 * lib/services/export-selection.ts.
 *
 * Zwei Arten:
 * - „Nach Familien“ (`ExportSelection`): Eine Person gehört zum Export,
 *   sobald sie in mindestens einer gewählten Familie ist; „ohne Familie“
 *   (nur Administratoren) nimmt die Personen ohne jede Familienzuordnung dazu.
 * - „Ab einer Person“ (`PersonExportSelection`): die Person und ihre
 *   Vorfahren, je nach Kästchen mit Partnern, Geschwistern usw. (Regeln:
 *   lib/export-lineage.ts). Die Menge der Personen berechnet allein der
 *   Server aus Person und Schaltern.
 * Die Sichtbarkeitsgrenze des Exports gilt zusätzlich — eine Auswahl kann nur
 * einschränken, nie erweitern.
 */
export type ExportSelection = {
  familyIds: string[];
  withoutFamily: boolean;
};

export type PersonExportSelection = {
  kind: "person";
  personId: string;
  options: LineageOptions;
  /** Vom Server berechnet (nur sichtbare Personen). */
  personIds: string[];
  counts: LineageCounts;
};

export type AnyExportSelection = ExportSelection | PersonExportSelection;

/**
 * Suchparameter von /admin/data für den Einstieg von der Personenseite: Der
 * Dialog öffnet sich gleich „Ab einer Person“ mit dieser Person.
 */
export const GEDCOM_PERSON_PARAM = "gedcomPerson";

/** Adresse des Einstiegs von der Personenseite. */
export const gedcomPersonHref = (personId: string) => `/admin/data?${GEDCOM_PERSON_PARAM}=${encodeURIComponent(personId)}`;

/** Gewählte bzw. vorbelegte Person im Dialog (nur Sichtbares). */
export type ExportPersonCard = { id: string; name: string; lifespan: string };

export const isPersonSelection = (s: AnyExportSelection | null | undefined): s is PersonExportSelection =>
  Boolean(s && "kind" in s && s.kind === "person");

/** Schalter → Suchparameter (nur gesetzte; Reihenfolge fest). */
const OPTION_PARAMS: [keyof Omit<LineageOptions, "generations">, string][] = [
  ["partners", "partners"],
  ["siblings", "siblings"],
  ["siblingFamilies", "siblingFamilies"],
  ["descendants", "descendants"],
  ["allParents", "allParents"],
];

/** Suchparameter der Auswahl „Ab einer Person“ (ohne führendes `&`). */
export function personSelectionParams(personId: string, options: LineageOptions): string {
  const p = new URLSearchParams();
  p.set("person", personId);
  for (const [key, name] of OPTION_PARAMS) {
    if (!options[key]) continue;
    // „Partner und Kinder der Geschwister“ gilt nur zusammen mit „Geschwister“.
    if (key === "siblingFamilies" && !options.siblings) continue;
    p.set(name, "1");
  }
  if (options.generations !== null) p.set("generations", String(options.generations));
  return p.toString();
}

const flag = (v: string | null) => v === "1" || v === "true";

/** Schalter aus den Suchparametern; ungültige Generationenzahl → `"invalid"`. */
export function parseLineageOptions(params: URLSearchParams): LineageOptions | "invalid" {
  const siblings = flag(params.get("siblings"));
  const raw = params.get("generations");
  let generations: number | null = null;
  if (raw !== null && raw.trim() !== "") {
    if (!/^\d+$/.test(raw.trim())) return "invalid";
    const n = Number(raw.trim());
    if (n < 1) return "invalid";
    generations = n > MAX_GENERATIONS ? null : n;
  }
  return {
    partners: flag(params.get("partners")),
    siblings,
    siblingFamilies: siblings && flag(params.get("siblingFamilies")),
    descendants: flag(params.get("descendants")),
    allParents: flag(params.get("allParents")),
    generations,
  };
}

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

/**
 * Kurzer Zusatz für den Dateinamen — nur Anzahlen, keine Familien- oder
 * Personennamen (die Datei wandert z.B. zu MyHeritage oder per E-Mail).
 */
export function selectionFileSuffix(selection: AnyExportSelection | null): string {
  if (!selection) return "";
  if (isPersonSelection(selection)) {
    const n = selection.personIds.length;
    return `_auswahl-ab-person-${n === 1 ? "1-person" : `${n}-personen`}`;
  }
  const n = selection.familyIds.length;
  const parts: string[] = [];
  if (n) parts.push(n === 1 ? "1-familie" : `${n}-familien`);
  if (selection.withoutFamily) parts.push("ohne-familie");
  return `_auswahl-${parts.join("-und-")}`;
}
