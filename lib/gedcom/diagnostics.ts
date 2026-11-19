/**
 * Strukturprüfungen für die Importvorschau — lesen nur, ändern nichts.
 * Meldungen auf Deutsch, ohne Namen (nur Kennungen), damit sie auch in
 * Protokollen stehen dürfen.
 */

import { toAppDate, type AppDate, type SimpleDate } from "./dates";
import { deriveRelationships } from "./relationships";
import type { GedcomDocument, GedcomEvent, GedcomPerson } from "./types";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "MISSING_RECORD"
  | "OWN_ANCESTOR"
  | "CHILD_BORN_BEFORE_PARENT"
  | "CHILD_BORN_AFTER_PARENT_DEATH"
  | "DEATH_BEFORE_BIRTH"
  | "EMPTY_FAMILY"
  | "TOO_MANY_BIOLOGICAL_PARENTS"
  | "SELF_RELATION"
  | "DUPLICATE_UID"
  | "PERSON_WITHOUT_NAME"
  | "PRIVACY_MARKED";

export interface GedcomDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  personIds?: string[];
  familyId?: string;
  recordId?: string;
}

// ---------------------------------------------------------------------------
// Zeiträume (Tage seit 1.1.0001, grob genügt)
// ---------------------------------------------------------------------------

const ABOUT_YEARS = 2;

function dayNumber(y: number, m = 1, d = 1): number {
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function endOf(s: SimpleDate): number {
  if (s.day !== undefined) return dayNumber(s.year, s.month, s.day) + 1;
  if (s.month !== undefined) return s.month === 12 ? dayNumber(s.year + 1, 1, 1) : dayNumber(s.year, s.month + 1, 1);
  return dayNumber(s.year + 1, 1, 1);
}

/** Zeitraum [start, end) aller möglichen Lesarten eines Datums. */
export function dateRange(d: AppDate | null): { start: number; end: number } | null {
  if (!d) return null;
  const start = dayNumber(d.start.year, d.start.month, d.start.day);
  const end = d.end ? endOf(d.end) : endOf(d.start);
  if (d.range === "PERIOD" && !d.end) return null; // FROM/TO allein: zu offen
  switch (d.qualifier) {
    case "ABOUT":
      return { start: start - ABOUT_YEARS * 365, end: end + ABOUT_YEARS * 365 };
    case "BEFORE":
      return { start: -Infinity, end: start };
    case "AFTER":
      return { start: endOf(d.start), end: Infinity };
    default:
      return { start, end };
  }
}

const eventRange = (e: GedcomEvent | undefined) => (e ? dateRange(toAppDate(e.date)) : null);
const firstEvent = (p: GedcomPerson, ...types: string[]) =>
  types.map((t) => p.events.find((e) => e.type === t && e.date && toAppDate(e.date))).find(Boolean);

// ---------------------------------------------------------------------------

export function diagnoseGedcom(doc: GedcomDocument): GedcomDiagnostic[] {
  const out: GedcomDiagnostic[] = [];
  const persons = new Map(doc.persons.map((p) => [p.id, p]));
  const ids = {
    SOUR: new Set(doc.sources.map((s) => s.id)),
    NOTE: new Set(doc.notes.map((n) => n.id)),
    OBJE: new Set(doc.media.map((m) => m.id)),
    REPO: new Set(doc.repositories.map((r) => r.id)),
  };

  // --- Verweise auf fehlende Datensätze
  for (const f of doc.families) {
    for (const id of [...f.partners, ...f.children.map((c) => c.childId)]) {
      if (!persons.has(id)) {
        out.push({
          code: "MISSING_RECORD",
          severity: "error",
          message: `Familie @${f.id}@ verweist auf die Person @${id}@, die in der Datei fehlt.`,
          familyId: f.id,
          recordId: id,
        });
      }
    }
  }
  const families = new Set(doc.families.map((f) => f.id));
  for (const p of doc.persons) {
    for (const fid of [...p.parentFamilies, ...p.spouseFamilies.map((s) => s.familyId)]) {
      if (!families.has(fid)) {
        out.push({ code: "MISSING_RECORD", severity: "error", message: `Person @${p.id}@ verweist auf die Familie @${fid}@, die in der Datei fehlt.`, personIds: [p.id], recordId: fid });
      }
    }
  }
  const walk = (v: unknown, owner: string) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, owner);
      return;
    }
    const o = v as Record<string, unknown>;
    const check = (key: string, set: Set<string | undefined>, label: string) => {
      const id = o[key];
      if (typeof id === "string" && !set.has(id)) {
        out.push({ code: "MISSING_RECORD", severity: "error", message: `@${owner}@ verweist auf ${label} @${id}@, die bzw. der in der Datei fehlt.`, recordId: id });
      }
    };
    check("sourceId", ids.SOUR, "die Quelle");
    check("noteId", ids.NOTE, "die Notiz");
    check("mediaId", ids.OBJE, "das Medium");
    check("repositoryId", ids.REPO, "das Archiv");
    for (const [k, x] of Object.entries(o)) if (k !== "extensions" && typeof x === "object") walk(x, owner);
  };
  for (const list of [doc.persons, doc.families, doc.sources, doc.notes, doc.media]) {
    for (const r of list as { id?: string }[]) walk(r, r.id ?? "?");
  }

  const rel = deriveRelationships(doc);

  // --- Familien ohne Mitglieder, Selbstbezüge
  for (const f of doc.families) {
    if (f.partners.length === 0 && f.children.length === 0) {
      out.push({ code: "EMPTY_FAMILY", severity: "warning", message: `Familie @${f.id}@ hat weder Partner noch Kinder.`, familyId: f.id });
    }
    if (f.partners.length === 2 && f.partners[0] === f.partners[1]) {
      out.push({ code: "SELF_RELATION", severity: "error", message: `Familie @${f.id}@ nennt dieselbe Person zweimal als Partner.`, familyId: f.id, personIds: [f.partners[0]] });
    }
    for (const c of f.children) {
      if (f.partners.includes(c.childId)) {
        out.push({ code: "SELF_RELATION", severity: "error", message: `Person @${c.childId}@ ist in Familie @${f.id}@ zugleich Partner und Kind.`, familyId: f.id, personIds: [c.childId] });
      }
    }
  }

  // --- Mehr als zwei leibliche Eltern
  const bioParents = new Map<string, Set<string>>();
  const parentsOf = new Map<string, Set<string>>();
  for (const l of rel.parentChild) {
    if (l.parentId === l.childId) continue;
    let all = parentsOf.get(l.childId);
    if (!all) parentsOf.set(l.childId, (all = new Set()));
    all.add(l.parentId);
    if (l.kind !== "BIOLOGICAL") continue;
    let set = bioParents.get(l.childId);
    if (!set) bioParents.set(l.childId, (set = new Set()));
    set.add(l.parentId);
  }
  for (const [childId, set] of bioParents) {
    if (set.size > 2) {
      out.push({
        code: "TOO_MANY_BIOLOGICAL_PARENTS",
        severity: "error",
        message: `Person @${childId}@ hat ${set.size} leibliche Eltern (höchstens zwei möglich) — Adoptiv-, Stief- oder Pflegeverhältnisse sind vermutlich nicht als solche markiert.`,
        personIds: [childId, ...set],
      });
    }
  }

  // --- Zyklen: niemand ist sein eigener Vorfahre (iterative Tiefensuche)
  const state = new Map<string, 1 | 2>(); // 1 = in Arbeit, 2 = fertig
  const reported = new Set<string>();
  for (const startId of parentsOf.keys()) {
    if (state.has(startId)) continue;
    const stack: { id: string; parents: string[]; i: number }[] = [{ id: startId, parents: [...(parentsOf.get(startId) ?? [])], i: 0 }];
    const path: string[] = [startId];
    state.set(startId, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i >= top.parents.length) {
        state.set(top.id, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const next = top.parents[top.i++];
      const st = state.get(next);
      if (st === 1) {
        const cycle = path.slice(path.indexOf(next));
        const key = [...cycle].sort().join(",");
        if (!reported.has(key)) {
          reported.add(key);
          out.push({
            code: "OWN_ANCESTOR",
            severity: "error",
            message: `Zirkelbezug: ${cycle.map((id) => `@${id}@`).join(" → ")} → @${next}@ — eine Person wäre ihr eigener Vorfahre.`,
            personIds: cycle,
          });
        }
      } else if (!st) {
        state.set(next, 1);
        path.push(next);
        stack.push({ id: next, parents: [...(parentsOf.get(next) ?? [])], i: 0 });
      }
    }
  }

  // --- Daten: Kind vor Elternteil, nach Tod des Elternteils, Tod vor Geburt
  for (const p of doc.persons) {
    const birth = eventRange(firstEvent(p, "BIRTH", "CHRISTENING", "BAPTISM"));
    const death = eventRange(firstEvent(p, "DEATH", "BURIAL", "CREMATION"));
    if (birth && death && death.end <= birth.start) {
      out.push({ code: "DEATH_BEFORE_BIRTH", severity: "warning", message: `Person @${p.id}@: Tod liegt sicher vor der Geburt.`, personIds: [p.id] });
    }
  }
  for (const l of rel.parentChild) {
    if (l.kind !== "BIOLOGICAL") continue;
    const child = persons.get(l.childId);
    const parent = persons.get(l.parentId);
    if (!child || !parent) continue;
    const cb = eventRange(firstEvent(child, "BIRTH", "CHRISTENING", "BAPTISM"));
    const pb = eventRange(firstEvent(parent, "BIRTH", "CHRISTENING", "BAPTISM"));
    if (cb && pb && cb.end <= pb.start) {
      out.push({
        code: "CHILD_BORN_BEFORE_PARENT",
        severity: "error",
        message: `Kind @${child.id}@ ist sicher vor seinem Elternteil @${parent.id}@ geboren.`,
        personIds: [child.id, parent.id],
        familyId: l.familyId,
      });
      continue;
    }
    const pd = eventRange(firstEvent(parent, "DEATH"));
    // Ein Vater kann bis ~10 Monate vor der Geburt sterben; Spielraum 1 Jahr.
    if (cb && pd && cb.start >= pd.end + 366) {
      out.push({
        code: "CHILD_BORN_AFTER_PARENT_DEATH",
        severity: "warning",
        message: `Kind @${child.id}@ ist mehr als ein Jahr nach dem Tod des Elternteils @${parent.id}@ geboren.`,
        personIds: [child.id, parent.id],
        familyId: l.familyId,
      });
    }
  }

  // --- Doppelte _UID (stört das Wiedererkennen bei späteren Importen)
  const uidOwners = new Map<string, string[]>();
  for (const r of [...doc.persons, ...doc.families, ...doc.sources]) {
    for (const e of r.externalIds) {
      if (e.type !== "UID") continue;
      const list = uidOwners.get(e.value) ?? [];
      list.push(r.id);
      uidOwners.set(e.value, list);
    }
  }
  for (const [, owners] of uidOwners) {
    if (owners.length > 1) {
      out.push({
        code: "DUPLICATE_UID",
        severity: "warning",
        message: `Dieselbe _UID steht an ${owners.length} Datensätzen (${owners.map((o) => `@${o}@`).join(", ")}) — Wiedererkennen bei späteren Importen ist dort unsicher.`,
        recordId: owners[0],
      });
    }
  }

  // --- Hinweise
  const nameless = doc.persons.filter((p) => !p.names.some((n) => n.full.trim()));
  if (nameless.length) {
    out.push({
      code: "PERSON_WITHOUT_NAME",
      severity: "info",
      message: `${nameless.length} Person(en) ohne Namen.`,
      personIds: nameless.map((p) => p.id),
    });
  }
  const priv = doc.persons.filter((p) => p.privacy.markers.length || p.privacy.restrictions.length);
  if (priv.length) {
    out.push({
      code: "PRIVACY_MARKED",
      severity: "info",
      message: `${priv.length} Person(en) mit Privatsphäre-Markierung (RESN, Platzhaltername o.ä.) — beim Import entscheiden, wie damit umgegangen wird.`,
      personIds: priv.map((p) => p.id),
    });
  }
  return out;
}
