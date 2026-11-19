/**
 * Zwei gelesene Dokumente auf Datensatzebene vergleichen — Grundlage für eine
 * Aktualisierungsvorschau, wenn ein neuer Export desselben Stammbaums kommt.
 *
 * Wiedererkannt wird je Datensatz über den stabilsten vorhandenen Schlüssel:
 * _UID (bzw. 7.0 UID) → RIN → Xref. Verweise zwischen Datensätzen (Familie →
 * Person, Beleg → Quelle …) werden vor dem Vergleich über die gefundene
 * Zuordnung übersetzt, damit eine bloße Umnummerierung nicht als Änderung
 * zählt. Änderungsstempel (CHAN, _UPD) zählen getrennt.
 */

import type { GedcomDocument, GedcomExternalId } from "./types";

export type DiffKey = { by: "UID" | "RIN" | "XREF"; value: string };

export interface RecordChange {
  key: DiffKey;
  idA: string;
  idB: string;
  /** Felder der obersten Ebene, die sich unterscheiden (ohne Stempel). */
  fields: string[];
}

export interface RecordDiff {
  added: { key: DiffKey; id: string }[];
  removed: { key: DiffKey; id: string }[];
  changed: RecordChange[];
  /** Nur CHAN/_UPD geändert, Inhalt gleich. */
  touched: { key: DiffKey; idA: string; idB: string }[];
  unchanged: number;
}

export interface DocumentDiff {
  persons: RecordDiff;
  families: RecordDiff;
  sources: RecordDiff;
  repositories: RecordDiff;
  notes: RecordDiff;
  media: RecordDiff;
}

type Rec = { id?: string; externalIds: GedcomExternalId[] };

export function identityKey(r: Rec, xrefMap?: Record<string, string>): DiffKey {
  const uid = r.externalIds.find((e) => e.type === "UID");
  if (uid?.value) return { by: "UID", value: uid.value.toUpperCase() };
  const rin = r.externalIds.find((e) => e.type === "RIN");
  if (rin?.value) return { by: "RIN", value: rin.value };
  return { by: "XREF", value: (r.id && xrefMap?.[r.id]) ?? r.id ?? "" };
}

const keyString = (k: DiffKey) => `${k.by}:${k.value}`;

const REF_KEYS = new Set(["sourceId", "noteId", "mediaId", "repositoryId", "familyId", "childId", "partners", "parentFamilies", "submitterId"]);
const STAMP_KEYS = new Set(["changed", "updated"]);

function mapRefs(v: unknown, map: Map<string, string>, key?: string, ignoreDateText = false): unknown {
  if (Array.isArray(v)) return v.map((x) => mapRefs(x, map, key, ignoreDateText));
  if (typeof v === "string") return key && REF_KEYS.has(key) ? (map.get(v) ?? v) : v;
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  // Schlüssel sortiert: Reihenfolge der Eigenschaften ist keine Änderung.
  for (const [k, x] of Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (k === "line") continue;
    if (ignoreDateText && (k === "original" || k === "lenient") && "kind" in v) continue;
    out[k] = mapRefs(x, map, k, ignoreDateText);
  }
  return out;
}

function diffList<T extends Rec>(
  a: T[],
  b: T[],
  map: Map<string, string>,
  xrefMap?: Record<string, string>,
  ignoreDateText = false,
): RecordDiff {
  const result: RecordDiff = { added: [], removed: [], changed: [], touched: [], unchanged: 0 };
  const byKeyA = new Map(a.map((r) => [keyString(identityKey(r, xrefMap)), r]));
  const seen = new Set<string>();
  for (const rb of b) {
    const key = identityKey(rb);
    const ks = keyString(key);
    const ra = byKeyA.get(ks);
    if (!ra || seen.has(ks)) {
      result.added.push({ key, id: rb.id ?? "" });
      continue;
    }
    seen.add(ks);
    const na = mapRefs(ra, new Map(), undefined, ignoreDateText) as Record<string, unknown>;
    const nb = mapRefs(rb, map, undefined, ignoreDateText) as Record<string, unknown>;
    const fields: string[] = [];
    let stamps = false;
    for (const k of new Set([...Object.keys(na), ...Object.keys(nb)])) {
      if (k === "id") continue;
      if (JSON.stringify(na[k]) === JSON.stringify(nb[k])) continue;
      if (STAMP_KEYS.has(k)) stamps = true;
      else fields.push(k);
    }
    if (fields.length) result.changed.push({ key, idA: ra.id ?? "", idB: rb.id ?? "", fields });
    else if (stamps) result.touched.push({ key, idA: ra.id ?? "", idB: rb.id ?? "" });
    else result.unchanged++;
  }
  for (const [ks, ra] of byKeyA) if (!seen.has(ks)) result.removed.push({ key: identityKey(ra, xrefMap), id: ra.id ?? "" });
  return result;
}

/**
 * Vergleicht `a` (bisheriger Stand) mit `b` (neuer Export). `xrefMap`
 * (Kennung in a → Kennung in b, z.B. die idMap des Writers) hilft, wenn
 * Datensätze nur über die Xref wiedererkannt werden können.
 */
export function diffDocuments(
  a: GedcomDocument,
  b: GedcomDocument,
  options: { xrefMap?: Record<string, string>; ignoreDateText?: boolean } = {},
): DocumentDiff {
  const xrefMap = options.xrefMap;
  const idt = !!options.ignoreDateText;
  // Zuordnung Kennung in b → Kennung in a über die Identitätsschlüssel.
  const map = new Map<string, string>();
  const lists: [Rec[], Rec[]][] = [
    [a.persons, b.persons],
    [a.families, b.families],
    [a.sources, b.sources],
    [a.repositories, b.repositories],
    [a.notes, b.notes],
    [a.media, b.media],
  ];
  for (const [la, lb] of lists) {
    const byKey = new Map(la.map((r) => [keyString(identityKey(r, xrefMap)), r.id]));
    for (const r of lb) {
      const ida = byKey.get(keyString(identityKey(r)));
      if (ida && r.id) map.set(r.id, ida);
    }
  }
  return {
    persons: diffList(a.persons, b.persons, map, xrefMap, idt),
    families: diffList(a.families, b.families, map, xrefMap, idt),
    sources: diffList(a.sources, b.sources, map, xrefMap, idt),
    repositories: diffList(a.repositories, b.repositories, map, xrefMap, idt),
    notes: diffList(a.notes, b.notes, map, xrefMap, idt),
    media: diffList(a.media, b.media, map, xrefMap, idt),
  };
}
