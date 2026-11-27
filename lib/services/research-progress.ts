import type { RingParent } from "../ancestor-rings";
import { fuzzyField } from "../dates";
import type { Sex } from "../kinship";
import { prisma } from "../prisma";
import { REFERENCE_ID_PATTERN, REFERENCE_SELF, type ReferenceSource } from "../reference";
import {
  computeProgress,
  parseProgressGeneration,
  type Evidence,
  type ProgressPerson,
  type ProgressResult,
} from "../research-progress";
import { canViewPerson, type Scope } from "../scope";
import { lifeSpan } from "../tree-layout";
import { iso } from "./dto";
import { resolveReference } from "./reference";

/**
 * Daten der Seite „Forschungs-Fortschritt“ (/progress): Vorfahren der
 * Ausgangsperson bis zur gewählten Tiefe laden, Belege dazu, und mit
 * computeProgress (lib/research-progress.ts) auswerten.
 *
 * Ausgangsperson: `person` aus der Adresse, sonst die Bezugsperson (Cookie
 * „Baum aus dieser Sicht“, sonst „Das bin ich“) — resolveReference.
 *
 * Laden: Generation für Generation eine Abfrage der leiblichen
 * Eltern-Kind-Beziehungen samt Eltern (höchstens Tiefe + 1 Abfragen — die
 * letzte nur, damit „beide Eltern erfasst“ auch für die äußerste Generation
 * stimmt), dann eine Abfrage der Geburts- und Sterbebelege. Nie eine Abfrage
 * je Vorfahr, nie der ganze Graph.
 *
 * Datenschutz: Die Ausgangsperson muss sichtbar sein. Ein nicht sichtbarer
 * Vorfahr geht nur als Platz „nicht freigegeben“ in die Zählung ein — ohne
 * Kennung, Namen, Daten oder Geschlecht; seine Eltern werden nicht gesucht,
 * seine Belege nicht gelesen. Die Antwort enthält Namen und Angaben nur von
 * sichtbaren Personen.
 */

const PERSON_SELECT = {
  id: true,
  givenName: true,
  familyName: true,
  gender: true,
  birthDate: true,
  birthDatePrecision: true,
  birthDateQualifier: true,
  birthDateTo: true,
  birthDateToPrecision: true,
  birthDatePhrase: true,
  birthPlace: true,
  deathDate: true,
  deathDatePrecision: true,
  deathDateQualifier: true,
  deathDateTo: true,
  deathDateToPrecision: true,
  deathDatePhrase: true,
  deathPlace: true,
  families: { select: { familyId: true } },
} as const;

type PersonRow = {
  id: string;
  givenName: string;
  familyName: string | null;
  gender: string;
  birthDate: Date | null;
  birthDatePrecision: string;
  birthDateQualifier: string;
  birthDateTo: Date | null;
  birthDateToPrecision: string;
  birthDatePhrase: string | null;
  birthPlace: string | null;
  deathDate: Date | null;
  deathDatePrecision: string;
  deathDateQualifier: string;
  deathDateTo: Date | null;
  deathDateToPrecision: string;
  deathDatePhrase: string | null;
  deathPlace: string | null;
  families: { familyId: string }[];
};

const fullName = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

function toProgressPerson(p: PersonRow): ProgressPerson {
  return {
    id: p.id,
    name: fullName(p),
    gender: p.gender as Sex,
    birth: fuzzyField(p, "birthDate"),
    birthPhrase: Boolean(p.birthDatePhrase?.trim()),
    birthPlace: p.birthPlace,
    death: fuzzyField(p, "deathDate"),
    deathPhrase: Boolean(p.deathDatePhrase?.trim()),
    deathPlace: p.deathPlace,
  };
}

function lifeSpanOf(p: PersonRow): string {
  return lifeSpan({
    birthDate: iso(p.birthDate),
    birthDatePrecision: p.birthDatePrecision,
    birthDateQualifier: p.birthDateQualifier,
    birthDateTo: iso(p.birthDateTo),
    birthDateToPrecision: p.birthDateToPrecision,
    birthDatePhrase: p.birthDatePhrase,
    deathDate: iso(p.deathDate),
    deathDatePrecision: p.deathDatePrecision,
    deathDateQualifier: p.deathDateQualifier,
    deathDateTo: iso(p.deathDateTo),
    deathDateToPrecision: p.deathDateToPrecision,
    deathDatePhrase: p.deathDatePhrase,
  });
}

export type ProgressRoot = {
  id: string;
  name: string;
  lifespan: string;
  /** Die eigene Person („Das bin ich“). */
  isSelf: boolean;
  /** Woher die Ausgangsperson kommt: Adresse, gemerkte Sicht oder eigene Person. */
  source: ReferenceSource;
};

export type ResearchProgressPage = {
  generations: number;
  root: ProgressRoot | null;
  /** In der Adresse stand eine Person, die es nicht gibt oder die nicht sichtbar ist. */
  notFound: boolean;
  /** Der Benutzer hat eine sichtbare eigene Person. */
  hasSelf: boolean;
  progress: ProgressResult | null;
};

/**
 * Alles für die Seite. `person`: roher Suchparameter (Kennung oder „ich“),
 * `cookie`: gemerkte Bezugsperson des Baums, `generations`: roh aus der
 * Adresse (4…10, Standard 6). `now` für Tests.
 */
export async function getResearchProgress(
  scope: Scope,
  input: { person?: string | null; cookie?: string | null; generations?: unknown; now?: Date },
): Promise<ResearchProgressPage> {
  const n = parseProgressGeneration(input.generations);
  const param = input.person?.trim() || null;
  const choice = await resolveReference(scope, { param, cookie: input.cookie ?? null });
  const notFound = Boolean(param && param !== REFERENCE_SELF && choice.id !== param);
  const empty = { generations: n, notFound, hasSelf: choice.selfId !== null };
  if (!choice.id || !REFERENCE_ID_PATTERN.test(choice.id)) return { ...empty, root: null, progress: null };

  const root = await prisma.person.findUnique({ where: { id: choice.id }, select: PERSON_SELECT });
  if (!root || !canViewPerson(scope, root.families.map((f) => f.familyId))) {
    return { ...empty, root: null, progress: null };
  }

  // Generation für Generation: Eltern nur von sichtbaren, noch nicht
  // gefragten Personen (Ahnenschwund und Zyklen fragen nichts doppelt). Die
  // Generation n+1 wird nur gezählt, nicht gezeigt.
  const rows = new Map<string, PersonRow>([[root.id, root]]);
  const restricted = new Set<string>();
  const parents = new Map<string, RingParent[]>();
  let frontier = [root.id];
  for (let g = 1; g <= n + 1 && frontier.length; g++) {
    const rels = await prisma.relationship.findMany({
      where: { type: "PARENT_OF", subtype: "BIOLOGICAL", toPersonId: { in: frontier } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { toPersonId: true, fromPerson: { select: PERSON_SELECT } },
    });
    for (const id of frontier) parents.set(id, []);
    const next: string[] = [];
    for (const r of rels) {
      const p = r.fromPerson;
      const known = rows.has(p.id) || restricted.has(p.id);
      const visible = known ? rows.has(p.id) : canViewPerson(scope, p.families.map((f) => f.familyId));
      // Geschlecht einer nicht sichtbaren Person verrät auch die Platzwahl nicht.
      parents.get(r.toPersonId)!.push({ id: p.id, gender: visible ? (p.gender as Sex) : "UNKNOWN" });
      if (known) continue;
      if (visible && g <= n) {
        rows.set(p.id, p);
        next.push(p.id);
      } else if (!visible) {
        restricted.add(p.id);
      }
    }
    frontier = next;
  }

  // Belege der Geburt und des Todes aller gezeigten Personen in einer Abfrage.
  const citations = await prisma.citation.findMany({
    where: { personId: { in: [...rows.keys()] }, fact: { in: ["BIRTH", "DEATH"] } },
    select: { personId: true, fact: true, source: { select: { kind: true } } },
  });
  const evidence = new Map<string, Evidence>();
  for (const c of citations) {
    const key = `${c.personId}|${c.fact}`;
    if (c.source.kind !== "ONLINE_TREE") evidence.set(key, "independent");
    else if (!evidence.has(key)) evidence.set(key, "hintOnly");
  }

  const persons = new Map([...rows.values()].map((p) => [p.id, toProgressPerson(p)]));
  const progress = computeProgress({
    rootId: root.id,
    generations: n,
    now: input.now ?? new Date(),
    person: (id) => persons.get(id),
    parentsOf: (id) => parents.get(id) ?? [],
    visible: (id) => rows.has(id),
    evidence: (id, fact) => evidence.get(`${id}|${fact}`) ?? "none",
  });

  return {
    ...empty,
    root: {
      id: root.id,
      name: fullName(root),
      lifespan: lifeSpanOf(root),
      isSelf: root.id === choice.selfId,
      source: choice.source ?? "self",
    },
    progress,
  };
}
