import type { Place, Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { personVisibilityFilter, type Scope } from "../scope";
import { EVENT_TYPE_LABEL, type EventTypeName } from "../events";
import { entryLabel, type Gazetteer, type GeoEntry } from "../places/gazetteer";
import { getGazetteer } from "../places/gazetteer-file";
import { normalizeForLookup, placeKey } from "../places/normalize";

/**
 * Ortsseiten und Ortsverweise (README, „Karte und Orte“).
 *
 * **Ein Ort** = alle Zuordnungen (Tabelle Place) mit demselben Eintrag des
 * Ortsverzeichnisses (`gazetteerId`), bei eigenen Orten ohne Verzeichnis-
 * eintrag alle mit denselben Koordinaten (auf 5 Nachkommastellen, wie
 * gespeichert). Mehrere Ortstexte („Breslau“, „Breslau, Schlesien“,
 * „Wrocław“) zeigen so auf eine Seite. Kennung (`ref`): `g-<gazetteerId>`
 * bzw. `c-<Breite>_<Länge>`. „Nicht zuordenbar“ und Zeilen ohne Koordinaten
 * haben keine Seite.
 *
 * **Kein Fremdschlüssel:** Personen, Beziehungen und Ereignisse tragen den
 * Freitext; die Verbindung zum Ort entsteht nur über den normalisierten Text
 * (`placeKey` = Place.key).
 *
 * Rechte: Ortsseiten sieht jeder angemeldete Benutzer, aber nur mit
 * Einträgen sichtbarer Personen; Ortstexte, die nur bei unsichtbaren
 * Personen vorkommen, erscheinen nicht, und ein Ort ganz ohne sichtbare
 * Angabe gilt als nicht vorhanden (außer für Administratoren).
 */

type Coords = Pick<Place, "gazetteerId" | "latitude" | "longitude" | "unresolvable">;

export function placeRefOf(p: Coords): string | null {
  if (p.unresolvable || p.latitude === null || p.longitude === null) return null;
  if (p.gazetteerId) return `g-${p.gazetteerId}`;
  return `c-${p.latitude.toFixed(5)}_${p.longitude.toFixed(5)}`;
}

export type PlaceLinkDto = {
  ref: string;
  /** Anzeigename der Zuordnung („Wrocław (Breslau), Polen“). */
  label: string;
  /** Kurzform für den Zusatz am Freitext („Wrocław, Polen“): ohne Klammer. */
  short: string;
  /** Freitext nennt den Ort schon so (erster Teil gleich) — kein Zusatz nötig. */
  same: boolean;
  latitude: number;
  longitude: number;
};

const stripParen = (s: string) => s.replace(/\s*\([^)]*\)/g, "").replace(/\s+,/g, ",").trim();
const firstKey = (s: string) => normalizeForLookup(s.split(/[,;]/)[0].replace(/\([^)]*\)/g, " "));

/**
 * Verweise für Ortstexte einer Seite in EINER Abfrage: Schlüssel (placeKey)
 * → Ortsseite. Gibt nur Bezeichnung und Kennung zugeordneter Orte heraus —
 * die Texte selbst kennt der Aufrufer bereits.
 */
export async function placeLinksFor(texts: (string | null | undefined)[]): Promise<Record<string, PlaceLinkDto>> {
  const byKey = new Map<string, string>();
  for (const t of texts) if (t?.trim()) byKey.set(placeKey(t), t);
  if (!byKey.size) return {};
  const rows = await prisma.place.findMany({
    where: { key: { in: [...byKey.keys()] }, unresolvable: false, latitude: { not: null }, longitude: { not: null } },
    select: { key: true, gazetteerId: true, latitude: true, longitude: true, unresolvable: true, label: true, text: true },
  });
  const out: Record<string, PlaceLinkDto> = {};
  for (const r of rows) {
    const ref = placeRefOf(r);
    if (!ref) continue;
    const label = r.label ?? r.text;
    const short = stripParen(label);
    const text = byKey.get(r.key) ?? r.text;
    out[r.key] = { ref, label, short, same: firstKey(text) === firstKey(short), latitude: r.latitude!, longitude: r.longitude! };
  }
  return out;
}

/** Kennung der Ortsseite zu einem Ortstext (oder null ohne Zuordnung). */
export async function placeRefForText(text: string): Promise<string | null> {
  const row = await prisma.place.findUnique({ where: { key: placeKey(text) } });
  return row ? placeRefOf(row) : null;
}

// ---------------------------------------------------------------------------
// Ortsseite
// ---------------------------------------------------------------------------

export type PlaceEntryKind = "birth" | "death" | "marriage" | "divorce" | "event";

export type PlacePageEntry = {
  person: { id: string; name: string; birthYear: number | null; deathYear: number | null };
  kind: PlaceEntryKind;
  /** Deutsche Bezeichnung: „Geburt“, „Heirat“, „Taufe“ … */
  label: string;
  year: number | null;
  /** Freitext, wie er an der Angabe steht. */
  text: string;
  /** Abweichende Zweitangabe (Ereignis mit alternative). */
  alternative?: boolean;
};

export type PlacePageDto = {
  ref: string;
  label: string;
  /** Heutiger Name ohne Klammer. */
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  precision: string | null;
  /** Art im Verzeichnis (Ort, Region, historische Landschaft, Land) bzw. „eigener Ort“. */
  kind: string;
  population: number | null;
  /** Herkunft der Zuordnung(en): AUTO, AI, MANUAL (bei mehreren Zeilen alle vorkommenden). */
  sources: ("AUTO" | "AI" | "MANUAL")[];
  /** Begründungen bzw. Notizen — nur für Administratoren. */
  notes?: string[];
  /** Weitere Namen aus dem Verzeichnis (darunter der deutsche bzw. frühere). */
  otherNames: string[];
  /** Früherer bzw. deutscher Name laut Verzeichnis. */
  historicName: string | null;
  /** Vorkommende Freitexte mit Zahl der (sichtbaren) Angaben. */
  texts: { text: string; count: number }[];
  entries: PlacePageEntry[];
  total: number;
  page: number;
  pageSize: number;
};

export const PLACE_PAGE_ENTRIES = 50;

const KIND_LABEL = { P: "Ort", A: "Region", H: "historische Landschaft", C: "Land" } as const;

/** Zuordnungen eines Orts (siehe oben, „Ein Ort“). */
export async function placeRowsOf(ref: string): Promise<Place[]> {
  if (ref.startsWith("g-")) {
    const id = ref.slice(2);
    if (!/^[\w.-]{1,40}$/.test(id)) return [];
    return prisma.place.findMany({ where: { gazetteerId: id, unresolvable: false, latitude: { not: null } } });
  }
  const m = /^c-(-?\d{1,3}\.\d{5})_(-?\d{1,3}\.\d{5})$/.exec(ref);
  if (!m) return [];
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  const eps = 0.000006;
  return prisma.place.findMany({
    where: {
      gazetteerId: null,
      unresolvable: false,
      latitude: { gte: lat - eps, lte: lat + eps },
      longitude: { gte: lon - eps, lte: lon + eps },
    },
  });
}

/** Alle Schreibweisen in den Daten, deren Schlüssel zu `keys` gehört. */
async function rawTextsFor(keys: Set<string>): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ t: string }[]>`
    SELECT DISTINCT t FROM (
      SELECT "birthPlace" AS t FROM "Person" WHERE "birthPlace" IS NOT NULL
      UNION SELECT "deathPlace" FROM "Person" WHERE "deathPlace" IS NOT NULL
      UNION SELECT "startPlace" FROM "Relationship" WHERE "startPlace" IS NOT NULL
      UNION SELECT "endPlace" FROM "Relationship" WHERE "endPlace" IS NOT NULL
      UNION SELECT "place" FROM "Event" WHERE "place" IS NOT NULL
    ) s`;
  return rows.map((r) => r.t).filter((t) => keys.has(placeKey(t)));
}

const yearOf = (d: Date | null | undefined) => (d ? d.getUTCFullYear() : null);

function findEntry(gaz: Gazetteer, id: string): GeoEntry | null {
  return gaz.entries.find((e) => e.id === id) ?? null;
}

/**
 * Daten der Ortsseite: Ort, Herkunft, weitere Namen, vorkommende Freitexte
 * und die Angaben sichtbarer Personen (seitenweise). `null`: kein Ort mit
 * dieser Kennung oder (für Nicht-Admins) keine sichtbare Angabe.
 */
export async function getPlacePage(scope: Scope, ref: string, opts: { page?: number } = {}): Promise<PlacePageDto | null> {
  const rows = await placeRowsOf(ref);
  if (!rows.length) return null;
  const keys = new Set(rows.map((r) => r.key));
  const raw = await rawTextsFor(keys);
  const visible = personVisibilityFilter(scope) as Prisma.PersonWhereInput;

  const personSelect = { id: true, givenName: true, familyName: true, birthDate: true, deathDate: true } as const;
  type P = { id: string; givenName: string; familyName: string | null; birthDate: Date | null; deathDate: Date | null };
  const entries: PlacePageEntry[] = [];
  const add = (p: P, kind: PlaceEntryKind, label: string, year: number | null, text: string, alternative = false) =>
    entries.push({
      person: {
        id: p.id,
        name: [p.givenName, p.familyName].filter(Boolean).join(" "),
        birthYear: yearOf(p.birthDate),
        deathYear: yearOf(p.deathDate),
      },
      kind,
      label,
      year,
      text,
      ...(alternative ? { alternative } : {}),
    });

  if (raw.length) {
    const [persons, rels, events] = await Promise.all([
      prisma.person.findMany({
        where: { AND: [visible, { OR: [{ birthPlace: { in: raw } }, { deathPlace: { in: raw } }] }] },
        select: { ...personSelect, birthPlace: true, deathPlace: true },
      }),
      prisma.relationship.findMany({
        where: { type: "PARTNER_OF", OR: [{ startPlace: { in: raw } }, { endPlace: { in: raw } }] },
        select: {
          subtype: true,
          startPlace: true,
          endPlace: true,
          startDate: true,
          endDate: true,
          fromPerson: { select: { ...personSelect, families: { select: { familyId: true } } } },
          toPerson: { select: { ...personSelect, families: { select: { familyId: true } } } },
        },
      }),
      prisma.event.findMany({
        where: {
          place: { in: raw },
          OR: [{ person: visible }, { relationship: { OR: [{ fromPerson: visible }, { toPerson: visible }] } }],
        },
        select: {
          type: true,
          label: true,
          place: true,
          date: true,
          isAlternative: true,
          person: { select: { ...personSelect, families: { select: { familyId: true } } } },
          relationship: {
            select: {
              fromPerson: { select: { ...personSelect, families: { select: { familyId: true } } } },
              toPerson: { select: { ...personSelect, families: { select: { familyId: true } } } },
            },
          },
        },
      }),
    ]);
    const canSee = (p: { families: { familyId: string }[] }) => scope.isAdmin || p.families.some((f) => scope.families.has(f.familyId));
    for (const p of persons) {
      if (p.birthPlace && keys.has(placeKey(p.birthPlace))) add(p, "birth", "Geburt", yearOf(p.birthDate), p.birthPlace);
      if (p.deathPlace && keys.has(placeKey(p.deathPlace))) add(p, "death", "Tod", yearOf(p.deathDate), p.deathPlace);
    }
    for (const r of rels) {
      for (const who of [r.fromPerson, r.toPerson]) {
        if (!canSee(who)) continue;
        if (r.startPlace && keys.has(placeKey(r.startPlace))) {
          add(who, "marriage", r.subtype === "MARRIED" || r.subtype === "DIVORCED" ? "Heirat" : "Partnerschaft", yearOf(r.startDate), r.startPlace);
        }
        if (r.endPlace && keys.has(placeKey(r.endPlace))) add(who, "divorce", "Scheidung", yearOf(r.endDate), r.endPlace);
      }
    }
    for (const e of events) {
      const owners = e.person ? [e.person] : e.relationship ? [e.relationship.fromPerson, e.relationship.toPerson] : [];
      const label = e.label || EVENT_TYPE_LABEL[e.type as EventTypeName] || e.type;
      for (const who of owners) if (canSee(who)) add(who, "event", label, yearOf(e.date), e.place!, e.isAlternative);
    }
  }
  if (!entries.length && !scope.isAdmin) return null;

  entries.sort(
    (a, b) =>
      (a.year ?? 9999) - (b.year ?? 9999) || a.person.name.localeCompare(b.person.name, "de") || a.label.localeCompare(b.label, "de"),
  );
  const textCount = new Map<string, number>();
  for (const e of entries) textCount.set(e.text, (textCount.get(e.text) ?? 0) + 1);
  // Admins sehen auch Texte ohne sichtbare Angabe bzw. ohne Vorkommen (Zuordnung ohne Text).
  if (scope.isAdmin) for (const t of [...raw, ...rows.map((r) => r.text)]) if (!textCount.has(t)) textCount.set(t, 0);

  const first = rows[0];
  const gaz = first.gazetteerId ? await getGazetteer() : null;
  const e = gaz && first.gazetteerId ? findEntry(gaz, first.gazetteerId) : null;
  let region: string | null = null;
  let country: string | null = null;
  const otherNames: string[] = [];
  if (gaz && e) {
    if (e.kind === "P" && e.a1) {
      const r = gaz.regions.get(`${e.cc}.${e.a1}`);
      if (r !== undefined) region = gaz.entries[r].name;
    }
    if (e.kind !== "C") {
      const c = gaz.countries.get(e.cc);
      if (c !== undefined) country = gaz.entries[c].name;
    }
    const seen = new Set([normalizeForLookup(e.name)]);
    for (const n of [e.de, ...e.alt.split(";")]) {
      const k = normalizeForLookup(n ?? "");
      if (!n?.trim() || seen.has(k)) continue;
      seen.add(k);
      otherNames.push(n.trim());
    }
  }
  const pageSize = PLACE_PAGE_ENTRIES;
  const page = Math.max(1, Math.min(opts.page ?? 1, Math.max(1, Math.ceil(entries.length / pageSize))));
  const notes = rows.map((r) => r.note).filter((n): n is string => Boolean(n));
  return {
    ref,
    label: e && gaz ? entryLabel(gaz, e) : (first.label ?? first.text),
    name: e ? e.name : stripParen((first.label ?? first.text).split(",")[0]),
    region,
    country,
    latitude: first.latitude!,
    longitude: first.longitude!,
    precision: first.precision,
    kind: e ? KIND_LABEL[e.kind] : "eigener Ort",
    population: e?.pop || null,
    sources: [...new Set(rows.map((r) => r.source))],
    ...(scope.isAdmin ? { notes } : {}),
    otherNames,
    historicName: e?.de || null,
    texts: [...textCount].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "de")),
    entries: entries.slice((page - 1) * pageSize, page * pageSize),
    total: entries.length,
    page,
    pageSize,
  };
}
