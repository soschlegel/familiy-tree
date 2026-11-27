import { ringRelationTerm } from "../ancestor-rings";
import { formatFuzzyDate, fuzzyField } from "../dates";
import { eventTitle, POSTHUMOUS_EVENT_TYPES, type EventTypeName } from "../events";
import type { Sex } from "../kinship";
import {
  buildLifePath,
  walkLines,
  type LifePath,
  type LineEnd,
  type LineKind,
  type LineParent,
  type PathPlace,
  type PlaceLookup,
  type StationInput,
} from "../map/life-path";
import { isMarriage } from "../partner-labels";
import { placeKey } from "../places/normalize";
import { prisma } from "../prisma";
import { canViewPerson, type Scope } from "../scope";
import { resolveReference, type ReferenceChoice } from "./reference";

/**
 * „Lebensweg“ auf der Karte (/map?mode=lebensweg, docs/fachlich/karte-und-orte.md):
 * die Orte eines Lebens bzw. die Geburtsorte einer Vater- oder Mutterlinie
 * als Weg. Die Regeln (Reihenfolge, Zusammenfassen, Linienwahl) stehen in
 * lib/map/life-path.ts.
 *
 * Laden — nie eine Abfrage je Station, nie der ganze Graph und nie die
 * Kartendaten „alle“:
 * - Person: die Person samt Partnerschaften (eine Abfrage), ihre Ereignisse
 *   und die ihrer sichtbaren Partnerschaften (eine), die Ortszuordnungen
 *   (eine).
 * - Linie: Generation für Generation EINE Abfrage der leiblichen Eltern der
 *   (höchstens zwei) aktuellen Personen beider Linien, dann eine für die
 *   Taufen ohne Geburtsort und eine für die Ortszuordnungen.
 *
 * Datenschutz: Die Ausgangsperson muss sichtbar sein (über resolveReference;
 * eine gesperrte Kennung fällt still auf die Bezugsperson zurück). Heirat,
 * Scheidung und Ereignisse einer Partnerschaft kommen nur, wenn der Partner
 * sichtbar ist — wie auf der Personenseite, die Ort und Datum der Ehe nur
 * an der Karte eines sichtbaren Partners zeigt. Ein nicht sichtbarer
 * Vorfahr beendet die Linie; weitergegeben wird nur, DASS sie dort endet
 * („restricted“) — ohne Kennung, Name, Geschlecht, Ort oder Jahr. Seine
 * Daten werden gar nicht erst behalten.
 */

export type LifePathKind = "person" | LineKind;

export type LifePathView = {
  kind: LifePathKind;
  /** Ausgangsperson (gewählte bzw. Bezugsperson); null: keine sichtbare. */
  person: { id: string; name: string; isSelf: boolean; source: ReferenceChoice["source"] } | null;
  path: LifePath | null;
  /** Nur bei Linien: warum die Linie oben endet. */
  lineEnd: LineEnd | null;
  ms: number;
};

const nameOf = (p: { givenName: string; familyName: string | null }) => [p.givenName, p.familyName].filter(Boolean).join(" ");

/** Ereignisse, deren Ort ersatzweise für den Geburtsort zählt (wie „Wurzeln“). */
const BAPTISM_TYPES = ["BAPTISM", "CHRISTENING"] as const;

const DATE_COLUMNS = (key: "birthDate" | "deathDate") =>
  ({
    [key]: true,
    [`${key}Precision`]: true,
    [`${key}Qualifier`]: true,
    [`${key}To`]: true,
    [`${key}ToPrecision`]: true,
  }) as const;

const PERSON_SELECT = {
  id: true,
  givenName: true,
  familyName: true,
  gender: true,
  birthPlace: true,
  deathPlace: true,
  ...DATE_COLUMNS("birthDate"),
  ...DATE_COLUMNS("deathDate"),
  families: { select: { familyId: true } },
} as const;

const PARTNER_SELECT = {
  id: true,
  subtype: true,
  startDate: true,
  startDatePrecision: true,
  startDateQualifier: true,
  startDateTo: true,
  startDateToPrecision: true,
  startPlace: true,
  endDate: true,
  endDatePrecision: true,
  endDateQualifier: true,
  endDateTo: true,
  endDateToPrecision: true,
  endPlace: true,
} as const;

const OTHER_SELECT = { id: true, givenName: true, familyName: true, families: { select: { familyId: true } } } as const;

/** Ortszuordnungen der Texte in einer Abfrage (Regeln wie die Karte: lib/services/map.ts). */
async function lookupPlaces(texts: (string | null | undefined)[]): Promise<PlaceLookup> {
  const keys = [...new Set(texts.filter((t): t is string => Boolean(t?.trim())).map(placeKey))];
  const rows = keys.length
    ? await prisma.place.findMany({
        where: { key: { in: keys } },
        select: { key: true, unresolvable: true, latitude: true, longitude: true, label: true, text: true, precision: true },
      })
    : [];
  const byKey = new Map<string, PathPlace | "unresolvable">();
  for (const r of rows) {
    if (r.unresolvable) byKey.set(r.key, "unresolvable");
    else if (r.latitude !== null && r.longitude !== null) {
      byKey.set(r.key, { label: r.label ?? r.text, lat: r.latitude, lon: r.longitude, precision: r.precision ?? "PLACE" });
    }
  }
  return (key) => byKey.get(key) ?? null;
}

/** Stationen eines Lebens (nur für eine sichtbare Person aufrufen). */
async function personStations(scope: Scope, personId: string): Promise<StationInput[] | null> {
  const p = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      ...PERSON_SELECT,
      relationsFrom: { where: { type: "PARTNER_OF" }, select: { ...PARTNER_SELECT, toPerson: { select: OTHER_SELECT } } },
      relationsTo: { where: { type: "PARTNER_OF" }, select: { ...PARTNER_SELECT, fromPerson: { select: OTHER_SELECT } } },
    },
  });
  if (!p || !canViewPerson(scope, p.families.map((f) => f.familyId))) return null;

  // Partnerschaften nur mit sichtbarem Partner (siehe Kopfkommentar).
  const partnerships = [
    ...p.relationsFrom.map((r) => ({ ...r, other: r.toPerson })),
    ...p.relationsTo.map((r) => ({ ...r, other: r.fromPerson })),
  ].filter((r) => canViewPerson(scope, r.other.families.map((f) => f.familyId)));
  const partnerName = new Map(partnerships.map((r) => [r.id, nameOf(r.other)]));

  const stations: StationInput[] = [];
  if (p.birthPlace?.trim()) {
    stations.push({ key: "birth", role: "start", date: fuzzyField(p, "birthDate"), place: p.birthPlace, title: "Geburt" });
  }
  if (p.deathPlace?.trim()) {
    stations.push({ key: "death", role: "end", endRank: 0, date: fuzzyField(p, "deathDate"), place: p.deathPlace, title: "Tod" });
  }
  for (const r of partnerships) {
    const who = nameOf(r.other);
    if (r.startPlace?.trim()) {
      stations.push({
        key: `rel-start-${r.id}`,
        role: "middle",
        date: fuzzyField(r, "startDate"),
        place: r.startPlace,
        title: isMarriage(r.subtype) ? `Heirat mit ${who}` : `Partnerschaft mit ${who}`,
      });
    }
    if (r.endPlace?.trim()) {
      stations.push({
        key: `rel-end-${r.id}`,
        role: "middle",
        date: fuzzyField(r, "endDate"),
        place: r.endPlace,
        title: r.subtype === "DIVORCED" ? `Scheidung von ${who}` : `Ende der Partnerschaft mit ${who}`,
      });
    }
  }

  const events = await prisma.event.findMany({
    where: {
      isAlternative: false,
      place: { not: null },
      OR: [{ personId }, { relationshipId: { in: partnerships.map((r) => r.id) } }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      relationshipId: true,
      type: true,
      label: true,
      value: true,
      place: true,
      date: true,
      datePrecision: true,
      dateQualifier: true,
      dateTo: true,
      dateToPrecision: true,
    },
  });
  for (const e of events) {
    if (!e.place?.trim()) continue;
    const type = e.type as EventTypeName;
    const posthumous = POSTHUMOUS_EVENT_TYPES.includes(type);
    const title = eventTitle({ type, label: e.label });
    stations.push({
      key: `event-${e.id}`,
      role: posthumous ? "end" : "middle",
      endRank: posthumous ? 1 : undefined,
      date: fuzzyField(e, "date"),
      place: e.place,
      title: e.relationshipId ? `${title} (mit ${partnerName.get(e.relationshipId)})` : title,
      detail: e.value,
    });
  }
  return stations;
}

type LinePerson = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: string;
  birthPlace: string | null;
  birth: ReturnType<typeof fuzzyField>;
};

type LineStations = { stations: StationInput[]; end: LineEnd };

/** Vater- und/oder Mutterlinie hinauf, in einem Durchgang; null, wenn die Person nicht sichtbar ist. */
async function lineStations(
  scope: Scope,
  rootId: string,
  kinds: LineKind[],
): Promise<Partial<Record<LineKind, LineStations>> | null> {
  const root = await prisma.person.findUnique({ where: { id: rootId }, select: PERSON_SELECT });
  if (!root || !canViewPerson(scope, root.families.map((f) => f.familyId))) return null;
  const toLine = (p: typeof root): LinePerson => ({
    id: p.id,
    givenName: p.givenName,
    familyName: p.familyName,
    gender: p.gender,
    birthPlace: p.birthPlace,
    birth: fuzzyField(p, "birthDate"),
  });
  // Nur sichtbare Personen werden behalten; von nicht sichtbaren nur, DASS es sie gibt.
  const rows = new Map<string, LinePerson>([[root.id, toLine(root)]]);

  const walk = await walkLines(
    root.id,
    async (ids) => {
      const rels = await prisma.relationship.findMany({
        where: { type: "PARENT_OF", subtype: "BIOLOGICAL", toPersonId: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { toPersonId: true, fromPerson: { select: PERSON_SELECT } },
      });
      const out = new Map<string, LineParent[]>(ids.map((id) => [id, []]));
      for (const r of rels) {
        const p = r.fromPerson;
        const visible = canViewPerson(scope, p.families.map((f) => f.familyId));
        if (visible && !rows.has(p.id)) rows.set(p.id, toLine(p));
        out.get(r.toPersonId)!.push({ id: p.id, visible, gender: visible ? p.gender : "UNKNOWN" });
      }
      return out;
    },
    kinds,
  );

  // Ort: Geburtsort, sonst Taufort (wie „Wurzeln“); Jahr ersatzweise der Taufe.
  const lineIds = [...new Set(kinds.flatMap((k) => walk[k]?.ids ?? []))];
  const withoutBirthPlace = lineIds.filter((id) => !rows.get(id)!.birthPlace?.trim());
  const baptismOf = new Map<string, { place: string; date: ReturnType<typeof fuzzyField> }>();
  if (withoutBirthPlace.length) {
    const baptisms = await prisma.event.findMany({
      where: { personId: { in: withoutBirthPlace }, type: { in: [...BAPTISM_TYPES] }, isAlternative: false, place: { not: null } },
      orderBy: [{ date: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { personId: true, place: true, date: true, datePrecision: true, dateQualifier: true, dateTo: true, dateToPrecision: true },
    });
    for (const e of baptisms) {
      const text = e.place?.trim();
      if (e.personId && text && !baptismOf.has(e.personId)) baptismOf.set(e.personId, { place: text, date: fuzzyField(e, "date") });
    }
  }

  const out: Partial<Record<LineKind, LineStations>> = {};
  for (const kind of kinds) {
    const line = walk[kind]!;
    const side = kind === "father" ? "paternal" : "maternal";
    const stations: StationInput[] = line.ids
    .map((id, generation) => {
      const p = rows.get(id)!;
      const baptism = p.birthPlace?.trim() ? null : (baptismOf.get(id) ?? null);
      const date = p.birth ?? baptism?.date ?? null;
      const fromBaptism = !p.birth && Boolean(baptism?.date);
      return {
        key: `person-${id}`,
        role: "middle" as const,
        date,
        dateLabel: date ? `${fromBaptism ? "getauft " : "geboren "}${formatFuzzyDate(date)}` : "",
        place: p.birthPlace?.trim() ? p.birthPlace : (baptism?.place ?? null),
        title: nameOf(p),
        detail: [
          generation === 0 ? "Ausgangsperson" : ringRelationTerm(generation, p.gender as Sex, side),
          baptism ? "Ort der Taufe" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        personId: id,
      };
    })
    .reverse();
    out[kind] = { stations, end: line.end };
  }
  return out;
}

async function linePath(line: LineStations): Promise<{ path: LifePath; lineEnd: LineEnd }> {
  const lookup = await lookupPlaces(line.stations.map((s) => s.place));
  return { path: buildLifePath(line.stations, lookup, { fixed: true }), lineEnd: line.end };
}

/** Weg einer sichtbaren Person; null, wenn sie nicht sichtbar ist. */
export async function loadLifePath(
  scope: Scope,
  personId: string,
  kind: LifePathKind,
): Promise<{ path: LifePath; lineEnd: LineEnd | null } | null> {
  if (kind === "person") {
    const stations = await personStations(scope, personId);
    if (!stations) return null;
    const lookup = await lookupPlaces(stations.map((s) => s.place));
    return { path: buildLifePath(stations, lookup), lineEnd: null };
  }
  const lines = await lineStations(scope, personId, [kind]);
  return lines ? linePath(lines[kind]!) : null;
}

/** Seite /map?mode=lebensweg: Ausgangsperson wie die Karte (Adresse, Cookie, „das bin ich“). */
export async function loadLifePathView(
  scope: Scope,
  opts: { person?: string | null; cookie?: string | null; kind?: LifePathKind },
): Promise<LifePathView> {
  const started = Date.now();
  const kind = opts.kind ?? "person";
  const choice = await resolveReference(scope, { param: opts.person, cookie: opts.cookie });
  if (!choice.id) return { kind, person: null, path: null, lineEnd: null, ms: Date.now() - started };
  const [p, loaded] = await Promise.all([
    prisma.person.findUnique({ where: { id: choice.id }, select: { id: true, givenName: true, familyName: true } }),
    loadLifePath(scope, choice.id, kind),
  ]);
  if (!p || !loaded) return { kind, person: null, path: null, lineEnd: null, ms: Date.now() - started };
  return {
    kind,
    person: { id: p.id, name: nameOf(p), isSelf: choice.id === choice.selfId, source: choice.source },
    path: loaded.path,
    lineEnd: loaded.lineEnd,
    ms: Date.now() - started,
  };
}

/**
 * Einstieg von der Personenseite: welche Art des Lebenswegs lohnt sich
 * (mindestens zwei Punkte auf der Karte)? Erst die Person selbst, nur
 * sonst die Vater-, dann die Mutterlinie. null: keine.
 */
export async function lifePathEntry(scope: Scope, personId: string): Promise<LifePathKind | null> {
  const own = await loadLifePath(scope, personId, "person");
  if (!own) return null;
  if (own.path.points.length >= 2) return "person";
  // Beide Linien in einem Durchgang (je Generation eine Abfrage).
  const lines = await lineStations(scope, personId, ["father", "mother"]);
  if (!lines) return null;
  for (const kind of ["father", "mother"] as const) {
    if ((await linePath(lines[kind]!)).path.points.length >= 2) return kind;
  }
  return null;
}
