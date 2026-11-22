import { fuzzyField } from "../dates";
import { ancestorDistances } from "../kinship";
import { buildMapData, type MapFactInput, type MapPayload, type MapPersonInput, type MapPlace } from "../map/build";
import { prisma } from "../prisma";
import { LINE_KEYS, relationsFromReference, type LineKey } from "../reference";
import type { Scope } from "../scope";
import { loadGraph } from "./graph-data";
import { resolveReference, visibleIndex, type ReferenceChoice } from "./reference";

/**
 * Karte „Wurzeln nach Jahr“ (README, „Karte und Orte“): Daten für eine
 * Ausgangsperson, einmal auf dem Server gerechnet.
 *
 * Datenschutz: Grundlage sind nur Personen, die der Benutzer sehen darf —
 * Vorfahren und Linien werden auf dem Graphen der sichtbaren Personen
 * gesucht (visibleIndex, wie bei der Bezugsperson), Ereignisse und Heiraten
 * nur für diese Personen gelesen. Gesperrte Personen tauchen weder auf der
 * Karte noch in einer Zahl auf. Koordinaten kommen aus der Tabelle Place;
 * die Ortstexte selbst und die Zuordnungsliste sieht nur ein Admin.
 */

export type MapMode = "ancestors" | "all";

export type MapView = {
  mode: MapMode;
  /** Ausgangsperson (Bezugsperson oder gewählte Person); null: keine. */
  person: { id: string; name: string; isSelf: boolean; source: ReferenceChoice["source"] } | null;
  grandparents: Record<LineKey, { id: string; name: string } | null> | null;
  payload: MapPayload;
  /** Personen der Auswahl (sichtbar), auch ohne Datum. */
  selected: number;
  ms: number;
};

const nameOf = (p: { givenName: string; familyName: string | null }) => [p.givenName, p.familyName].filter(Boolean).join(" ");

export async function loadMapView(
  scope: Scope,
  opts: { person?: string | null; cookie?: string | null; mode?: MapMode; currentYear?: number },
): Promise<MapView> {
  const started = Date.now();
  const graph = await loadGraph(scope);
  const visible = (id: string) => graph.persons.get(id)?.visible ?? false;
  const choice = await resolveReference(scope, { param: opts.person, cookie: opts.cookie }, visible);
  const refId = choice.id;
  // Ohne Angabe: Vorfahren der Ausgangsperson, ohne Ausgangsperson alle.
  const mode: MapMode = opts.mode ?? (refId ? "ancestors" : "all");

  const index = visibleIndex(graph);
  const sexOf = (id: string) => graph.persons.get(id)?.gender ?? "UNKNOWN";
  const ref = refId ? relationsFromReference(index, sexOf, refId) : null;

  // Auswahl: Vorfahren (samt Ausgangsperson) oder alle sichtbaren Personen.
  let ids: string[];
  if (mode === "ancestors") ids = refId ? [...ancestorDistances(index, refId).keys()].filter(visible) : [];
  else ids = [...graph.persons.values()].filter((p) => p.visible).map((p) => p.id);
  const selected = new Set(ids);

  const persons: MapPersonInput[] = ids.map((id) => {
    const p = graph.persons.get(id)!;
    return {
      id,
      name: nameOf(p),
      birth: fuzzyField(p, "birthDate"),
      birthPlace: p.birthPlace,
      death: fuzzyField(p, "deathDate"),
      deathPlace: p.deathPlace,
      lines: ref?.relatives.get(id)?.lines ?? [],
    };
  });

  // Heirat und Scheidung (Ort an der Beziehung) für beide Partner der Auswahl.
  const facts: MapFactInput[] = [];
  const relIds: string[] = [];
  for (const r of graph.relationships) {
    if (r.type !== "PARTNER_OF") continue;
    const inSel = [r.from, r.to].filter((id) => selected.has(id));
    if (!inSel.length) continue;
    relIds.push(r.id);
    const start = fuzzyField(r, "startDate");
    const end = fuzzyField(r, "endDate");
    for (const personId of inSel) {
      if (r.startPlace) facts.push({ personId, date: start, place: r.startPlace });
      if (r.endPlace) facts.push({ personId, date: end, place: r.endPlace });
    }
  }
  const partnersOf = new Map(
    graph.relationships.filter((r) => r.type === "PARTNER_OF").map((r) => [r.id, [r.from, r.to].filter((id) => selected.has(id))]),
  );

  // Ereignisse mit Ort: an Personen der Auswahl und an deren Partnerschaften.
  const eventWhere =
    mode === "all"
      ? { isAlternative: false, place: { not: null } }
      : {
          isAlternative: false,
          place: { not: null },
          OR: [{ personId: { in: ids } }, { relationshipId: { in: relIds } }],
        };
  const [events, coordRows] = await Promise.all([
    prisma.event.findMany({
      where: eventWhere,
      select: {
        personId: true,
        relationshipId: true,
        type: true,
        date: true,
        datePrecision: true,
        dateQualifier: true,
        dateTo: true,
        dateToPrecision: true,
        place: true,
      },
    }),
    prisma.place.findMany({
      where: { unresolvable: false, latitude: { not: null }, longitude: { not: null } },
      select: { key: true, latitude: true, longitude: true, label: true, precision: true, text: true },
    }),
  ]);
  for (const e of events) {
    const owners = e.personId ? (selected.has(e.personId) ? [e.personId] : []) : (partnersOf.get(e.relationshipId ?? "") ?? []);
    const date = fuzzyField(e, "date");
    const burial = e.type === "BURIAL" || e.type === "CREMATION";
    for (const personId of owners) facts.push({ personId, date, place: e.place, burial });
  }

  const coords = new Map<string, MapPlace>(
    coordRows.map((c) => [
      c.key,
      { label: c.label ?? c.text, lat: c.latitude!, lon: c.longitude!, precision: c.precision ?? "PLACE" },
    ]),
  );
  const payload = buildMapData({
    persons,
    facts,
    coords: (key) => coords.get(key) ?? null,
    currentYear: opts.currentYear ?? new Date().getUTCFullYear(),
  });

  const refPerson = refId ? graph.persons.get(refId)! : null;
  return {
    mode,
    person: refPerson
      ? { id: refPerson.id, name: nameOf(refPerson), isSelf: refId === choice.selfId, source: choice.source }
      : null,
    grandparents: ref
      ? (Object.fromEntries(
          LINE_KEYS.map((k) => {
            const g = ref.grandparents[k];
            const gp = g ? graph.persons.get(g) : null;
            return [k, gp && gp.visible ? { id: gp.id, name: nameOf(gp) } : null];
          }),
        ) as Record<LineKey, { id: string; name: string } | null>)
      : null,
    payload,
    selected: ids.length,
    ms: Date.now() - started,
  };
}
