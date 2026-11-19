/**
 * Werkzeuge des MCP-Servers. Jedes Werkzeug läuft über die Dienstschicht
 * (lib/services) mit dem Scope des konfigurierten Benutzers — Sichtbarkeit,
 * Maskierung, Rechte und Audit gelten also genau wie in der Web-App.
 *
 * Ergebnisse: kompaktes JSON als Text und zusätzlich als structuredContent
 * (mit Ausgabeschema). Personen erscheinen einheitlich als Ref (format.ts).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Scope } from "../lib/scope";
import {
  createCitation,
  createEvent,
  createPersonName,
  deleteEvent,
  listPersonEvents,
  listRelationshipEvents,
  updateEvent,
  createPerson,
  createRelationship,
  createSource,
  getSource,
  listSources,
  deleteRelationship,
  findDataGaps,
  findInconsistencies,
  findPossibleDuplicates,
  getAncestors,
  getDescendants,
  getFamilyTimeline,
  getKinship,
  getPersonDetail,
  getPersonTimeline,
  getStatistics,
  listFamilies,
  notFoundError,
  searchPersons,
  ServiceError,
  setPersonFamilies,
  updatePerson,
  updateRelationship,
  validationError,
  type AiAuthResult,
  type AiLevel,
  type CitationTarget,
  type DataGapKind,
  type PersonNameDto,
  type RelationshipGapKind,
  type LineageResult,
  type PersonCitation,
  type SourceDto,
  type EventDto,
  type PersonDetail,
  type PersonRelation,
  type RelationshipDto,
  type TimelineEvent,
} from "../lib/services";
import { CONSISTENCY_KINDS, type ConsistencyKind } from "../lib/consistency";
import { isPreciseDate, toFuzzyDate, toIsoPartial } from "../lib/dates";
import { CITATION_FACT_LABEL, SOURCE_KIND_LABEL } from "../lib/source-labels";
import { CITATION_CONFIDENCES, CITATION_FACTS, SOURCE_KINDS } from "../lib/validation";
import { ALTERNATIVE_ONLY_TYPES, EVENT_TYPES, PERSON_NAME_TYPES } from "../lib/events";
import { appendResearchNote, dateFields, isoDay, ref, type PersonLike } from "./format";

export type ToolContext = {
  /** Wer zugreift — nur für Meldungen (E-Mail bzw. Schlüssel-Präfix). */
  label: string;
  /** Schreibwerkzeuge sind registriert (steuert auch den Hinweis in den Prompts). */
  allowWrite: boolean;
  /**
   * Wächter pro Aufruf (lib/services/ai-access.ts, authorizeAiCall): prüft
   * den Zugang jedes Mal neu und verlangt die nötige Stufe. Liefert den Scope
   * samt KI-Kanal fürs Audit oder einen Grund für die Ablehnung.
   */
  authorize: (need: AiLevel) => Promise<AiAuthResult>;
};

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------

type Data = Record<string, unknown>;

function textResult(data: Data): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function serviceErrorText(err: ServiceError): string {
  const issues = err.issues ?? [];
  const detail =
    issues.length > 1
      ? ` (${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`
      : issues.length === 1 && issues[0].path.length
        ? ` (Feld: ${issues[0].path.join(".")})`
        : "";
  return `${err.message}${detail} [${err.code}]`;
}

/**
 * Hüllt ein Werkzeug: Zugang bei jedem Aufruf frisch prüfen (Widerruf,
 * Sperre, Rechte- und Rollenänderungen wirken sofort), die nötige KI-Stufe
 * verlangen und ServiceError in eine isError-Antwort übersetzen.
 */
function run<A>(ctx: ToolContext, fn: (scope: Scope, args: A) => Promise<Data>, need: AiLevel = "READ") {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const auth = await ctx.authorize(need);
      if (!auth.ok) {
        return errorResult(`Zugriff verweigert (${ctx.label}): ${auth.message} [${auth.reason}]`);
      }
      return textResult(await fn(auth.scope, args));
    } catch (err) {
      if (err instanceof ServiceError) return errorResult(serviceErrorText(err));
      console.error("[mcp] Werkzeugfehler:", err);
      return errorResult(`Interner Fehler: ${(err as Error).message ?? String(err)}`);
    }
  };
}

/** Wie run, verlangt aber die Stufe WRITE. */
function runWrite<A>(ctx: ToolContext, fn: (scope: Scope, args: A) => Promise<Data>) {
  return run(ctx, fn, "WRITE");
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const personId = z.string().min(1).describe("Person ID (as returned by search_persons or other tools).");

/**
 * Datum in jeder Form, die lib/dates.ts versteht; geprüft wird in der
 * Dienstschicht (deutsche Fehlermeldung). Genauigkeit und Zusatz werden
 * gespeichert, wie angegeben — „1850“ bleibt ein Jahr, „um 1850“ ungefähr.
 */
const dateInput = z
  .string()
  .max(60)
  .describe(
    "Date in its real precision: YYYY-MM-DD, YYYY-MM or YYYY (German forms 12.03.1850 / 03.1850 also work). " +
      "Optional prefix for uncertain dates: 'um'/'ca.'/'ABT' = about, 'vor'/'BEF' = before, 'nach'/'AFT' = after, " +
      "'geschätzt'/'EST' = estimated, 'errechnet'/'CAL' = calculated (e.g. from an age) " +
      "(e.g. 'um 1850', 'vor 1900', 'nach 1723', 'errechnet 1801'). Ranges: 'zwischen 1850 und 1855' (BET … AND …, " +
      "the event happened once somewhere in that span), 'von 1901 bis 1910' (FROM … TO …, a state that lasted), " +
      "'ab 1901', 'bis 1910'. Do not invent day or month when only the year is known.",
  );

const refSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lifespan: z.string().optional(),
    restricted: z.literal(true).optional(),
  })
  .passthrough();

const GENDER = ["MALE", "FEMALE", "OTHER", "UNKNOWN"] as const;

/** Datum für kompakte Listen: ISO in Genauigkeit, bei ungenauen Daten mit Text. */
function compactDate(
  prefix: string,
  iso: string | null,
  precision?: string,
  qualifier?: string,
  extra: { to?: string | null; toPrecision?: string | null; phrase?: string | null } = {},
) {
  const f = toFuzzyDate(iso, precision, qualifier, extra.to, extra.toPrecision);
  if (!f) return extra.phrase ? { [`${prefix}Text`]: extra.phrase } : {};
  return isPreciseDate(f) && !extra.phrase
    ? { [prefix]: toIsoPartial(f) }
    : dateFields(prefix, iso, precision, qualifier, extra);
}

/** Lebensereignis kompakt. */
function storedEventOut(e: EventDto) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    ...(e.label && e.type !== "CUSTOM" ? { label: e.label } : {}),
    ...(e.isAlternative ? { alternative: true } : {}),
    ...compactDate("date", e.date, e.datePrecision, e.dateQualifier, {
      to: e.dateTo,
      toPrecision: e.dateToPrecision,
      phrase: e.datePhrase,
    }),
    ...(e.place ? { place: e.place } : {}),
    ...(e.value ? { value: e.value } : {}),
    ...(e.cause ? { cause: e.cause } : {}),
    ...(e.age ? { age: e.age } : {}),
    ...(e.agency ? { agency: e.agency } : {}),
    ...(e.address ? { address: e.address } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
  };
}

function nameOut(n: PersonNameDto) {
  return {
    id: n.id,
    type: n.type,
    typeLabel: n.typeLabel,
    name: n.display,
    ...(n.givenName ? { givenName: n.givenName } : {}),
    ...(n.familyName ? { familyName: n.familyName } : {}),
    ...(n.prefix ? { prefix: n.prefix } : {}),
    ...(n.suffix ? { suffix: n.suffix } : {}),
    ...(n.nickname ? { nickname: n.nickname } : {}),
    ...(n.label ? { label: n.label } : {}),
    ...(n.notes ? { notes: n.notes } : {}),
  };
}

function relationOut(r: PersonRelation) {
  return {
    ...ref(r.other),
    relationshipId: r.relationshipId,
    subtype: r.subtype,
    ...compactDate("startDate", r.startDate, r.startDatePrecision, r.startDateQualifier, {
      to: r.startDateTo,
      toPrecision: r.startDateToPrecision,
      phrase: r.startDatePhrase,
    }),
    ...(r.startPlace ? { startPlace: r.startPlace } : {}),
    ...compactDate("endDate", r.endDate, r.endDatePrecision, r.endDateQualifier, {
      to: r.endDateTo,
      toPrecision: r.endDateToPrecision,
      phrase: r.endDatePhrase,
    }),
    ...(r.endPlace ? { endPlace: r.endPlace } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.media.length ? { mediaCount: r.media.length } : {}),
    ...(r.events.length ? { events: r.events.map(storedEventOut) } : {}),
  };
}

/** Beleg kompakt: Quelle, Angabe, Fundstelle, Verlässlichkeit (+ Bezug bei Beziehungen). */
function personCitationOut(c: PersonCitation) {
  return {
    id: c.id,
    sourceId: c.source.id,
    source: c.source.title,
    kind: c.source.kind,
    fact: c.fact,
    ...(c.detail ? { detail: c.detail } : {}),
    ...(c.confidence ? { confidence: c.confidence } : {}),
    ...(c.relationshipId ? { relationshipId: c.relationshipId } : {}),
    ...(c.eventId ? { eventId: c.eventId, ...(c.eventTitle ? { event: c.eventTitle } : {}) } : {}),
    ...(c.relationship ? { relation: { role: c.relationship.role, subtype: c.relationship.subtype, with: ref(c.relationship.other) } } : {}),
  };
}

function personDetailOut(d: PersonDetail): Data {
  const p = d.person;
  return {
    person: {
      ...ref(p),
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      ...(p.nickname ? { nickname: p.nickname } : {}),
      ...(p.namePrefix ? { namePrefix: p.namePrefix } : {}),
      ...(p.nameSuffix ? { nameSuffix: p.nameSuffix } : {}),
      gender: p.gender,
      ...dateFields("birthDate", p.birthDate, p.birthDatePrecision, p.birthDateQualifier, {
        to: p.birthDateTo,
        toPrecision: p.birthDateToPrecision,
        phrase: p.birthDatePhrase,
      }),
      birthPlace: p.birthPlace,
      ...dateFields("deathDate", p.deathDate, p.deathDatePrecision, p.deathDateQualifier, {
        to: p.deathDateTo,
        toPrecision: p.deathDateToPrecision,
        phrase: p.deathDatePhrase,
      }),
      deathPlace: p.deathPlace,
      ...(p.deathCause ? { deathCause: p.deathCause } : {}),
      notes: p.notes,
      updatedAt: isoDay(p.updatedAt),
    },
    canEdit: d.canEdit,
    families: d.families,
    parents: d.parents.map(relationOut),
    partners: d.partners.map(relationOut),
    children: d.children.map(relationOut),
    siblings: d.siblings.map((s) => ({ ...ref(s.person), kind: s.kind })),
    media: d.media.map((m) => ({
      mediaId: m.mediaId,
      caption: m.caption,
      isPrimary: m.isPrimary,
      width: m.width,
      height: m.height,
    })),
    citations: d.citations.map(personCitationOut),
    ...(d.events.length ? { events: d.events.map(storedEventOut) } : {}),
    ...(d.names.length
      ? { otherNames: d.names.map(nameOut) }
      : {}),
  };
}

function relationshipOut(r: RelationshipDto) {
  return {
    id: r.id,
    type: r.type,
    subtype: r.subtype,
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
    ...dateFields("startDate", r.startDate, r.startDatePrecision, r.startDateQualifier, {
      to: r.startDateTo,
      toPrecision: r.startDateToPrecision,
      phrase: r.startDatePhrase,
    }),
    ...(r.startPlace ? { startPlace: r.startPlace } : {}),
    ...dateFields("endDate", r.endDate, r.endDatePrecision, r.endDateQualifier, {
      to: r.endDateTo,
      toPrecision: r.endDateToPrecision,
      phrase: r.endDatePhrase,
    }),
    ...(r.endPlace ? { endPlace: r.endPlace } : {}),
    notes: r.notes,
  };
}

function sourceOut(s: SourceDto) {
  return {
    id: s.id,
    title: s.title,
    kind: s.kind,
    kindLabel: SOURCE_KIND_LABEL[s.kind],
    ...(s.author ? { author: s.author } : {}),
    ...(s.repository ? { repository: s.repository } : {}),
    ...(s.callNumber ? { callNumber: s.callNumber } : {}),
    ...(s.url ? { url: s.url } : {}),
    ...(s.date ? dateFields("date", s.date, s.datePrecision, s.dateQualifier) : {}),
    ...(s.mediaId ? { scanMediaId: s.mediaId } : {}),
  };
}

function citationTargetOut(t: CitationTarget) {
  if (t.kind === "person") return { person: ref(t.person) };
  return {
    relationship: {
      id: t.relationshipId,
      type: t.type,
      subtype: t.subtype,
      from: ref(t.from),
      to: ref(t.to),
    },
  };
}

function generationLabel(n: number, direction: "up" | "down"): string {
  const base = direction === "up" ? ["Eltern", "Großeltern"] : ["Kinder", "Enkel"];
  if (n <= 2) return base[n - 1];
  if (n > 6) return `${n}. Generation`;
  return "Ur" + "ur".repeat(n - 3) + (direction === "up" ? "großeltern" : "enkel");
}

function lineageOut(r: LineageResult, direction: "up" | "down", limit: number): Data {
  const entries = r.entries.slice(0, limit);
  const groups = new Map<number, unknown[]>();
  for (const e of entries) {
    const list = groups.get(e.generation) ?? [];
    list.push({
      ...ref(e.person),
      viaPersonId: e.viaPersonId,
      ...(e.subtype !== "BIOLOGICAL" ? { subtype: e.subtype } : {}),
    });
    groups.set(e.generation, list);
  }
  return {
    root: ref(r.root),
    generationsRequested: r.generations,
    total: r.entries.length,
    truncated: entries.length < r.entries.length,
    generations: [...groups.entries()].map(([generation, persons]) => ({
      generation,
      label: generationLabel(generation, direction),
      persons,
    })),
  };
}

function eventOut(e: TimelineEvent) {
  const f = toFuzzyDate(e.date, e.datePrecision, e.dateQualifier, e.dateTo, e.dateToPrecision);
  return {
    date: f ? toIsoPartial(f) : isoDay(e.date),
    ...(f && !isPreciseDate(f)
      ? { datePrecision: e.datePrecision, dateQualifier: e.dateQualifier, dateText: e.dateText }
      : {}),
    kind: e.kind,
    label: e.label,
    persons: e.persons.map(ref),
    ...(e.place ? { place: e.place } : {}),
    ...(e.relationshipId ? { relationshipId: e.relationshipId } : {}),
    ...(e.eventId ? { eventId: e.eventId, eventType: e.eventType } : {}),
    ...(e.role ? { role: e.role } : {}),
    ...(e.age !== undefined && e.age !== null ? { age: e.age } : {}),
    ...(e.ageApproximate ? { ageApproximate: true } : {}),
  };
}

const notFound = (what = "Person") =>
  notFoundError(`${what} (oder für diesen Benutzer nicht sichtbar)`);

// ---------------------------------------------------------------------------
// Lesende Werkzeuge
// ---------------------------------------------------------------------------

const GAP_KINDS = [
  "missingBirthDate",
  "missingBirthPlace",
  "missingParents",
  "missingGender",
  "probablyDeceasedWithoutDeathDate",
  "deathPlaceWithoutDeathDate",
  "implausibleParentAge",
  "isolated",
  "withoutFamily",
  "unsourced",
] as const satisfies readonly DataGapKind[];
const REL_GAP_KINDS = ["marriageWithoutPlace", "partnershipUnknownStatus"] as const satisfies readonly RelationshipGapKind[];

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "search_persons",
    {
      title: "Personen suchen",
      description:
        "Search persons visible to the configured user. All filters are combined (AND). " +
        "`query`: every word must occur in given, family, birth name or nickname, or in one of the person's other names " +
        "(married name, spelling variant, alias …; case-insensitive substring). " +
        "Use this first to find person IDs. Results are paginated (default 20, max 100); check `hasMore`.",
      inputSchema: {
        query: z.string().optional().describe("Name words, e.g. 'Anna Becker'."),
        family_id: z.string().optional().describe("Only persons of this family (see list_families)."),
        born_from: z
          .number()
          .int()
          .optional()
          .describe("Birth year from (inclusive). Excludes persons without birth date. Uncertain dates count by their anchor year ('um 1850' = 1850, 'vor 1900' = 1900)."),
        born_to: z.number().int().optional().describe("Birth year to (inclusive)."),
        place: z
          .string()
          .optional()
          .describe(
            "Substring of any place of the person: birth or death place, place of one of their life events (baptism, " +
              "residence, burial …), or of one of their marriages/divorces and partnership events, e.g. 'Hannover'.",
          ),
        gender: z.enum(GENDER).optional(),
        deceased: z.boolean().optional().describe("true = only with death date, false = only without."),
        sort: z.enum(["name", "birth_date", "birth_date_desc", "updated_at"]).optional().describe("Default: name."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
        persons: z.array(refSchema),
      },
      annotations: { title: "Personen suchen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const limit = a.limit ?? 20;
      const offset = a.offset ?? 0;
      const sortMap = {
        name: "name",
        birth_date: "birthDate",
        birth_date_desc: "birthDateDesc",
        updated_at: "updatedAt",
      } as const;
      const r = await searchPersons(scope, {
        q: a.query,
        familyId: a.family_id,
        bornFrom: a.born_from,
        bornTo: a.born_to,
        place: a.place,
        gender: a.gender,
        deceased: a.deceased,
        sort: a.sort ? sortMap[a.sort] : "name",
        limit,
        offset,
      });
      return {
        total: r.total,
        offset,
        hasMore: offset + r.items.length < r.total,
        persons: r.items.map((p) => ({
          ...ref(p),
          gender: p.gender,
          ...(p.birthPlace ? { birthPlace: p.birthPlace } : {}),
          ...(p.deathPlace ? { deathPlace: p.deathPlace } : {}),
          familyIds: p.familyIds,
          relationCount: p.relationCount,
          hasNotes: Boolean(p.notes),
        })),
      };
    }),
  );

  server.registerTool(
    "get_person",
    {
      title: "Person abrufen",
      description:
        "Full record of one person: all fields incl. research notes, families, and direct relatives grouped as " +
        "parents, partners (with marriage/divorce dates), children and siblings (full/half), plus image metadata and " +
        "`citations` (sources backing the person's facts and relationships: fact NAME/BIRTH/DEATH/PARTNERSHIP/PARENTAGE/OTHER, " +
        "detail = page/entry, confidence HIGH/MEDIUM/LOW). Dates carry `…Precision` (DAY/MONTH/YEAR), `…Qualifier` " +
        "(EXACT/ABOUT/BEFORE/AFTER/ESTIMATED/CALCULATED/BETWEEN/PERIOD/UNTIL), for ranges `…To`, a German `…Text`, and " +
        "the verbatim wording in `…Text` when the source date could not be structured. " +
        "`events`: stored life events (baptism, occupation, residence, burial …; `alternative: true` = a second, " +
        "contradicting record, NOT the main fact); partners carry their own `events` (engagement, banns …) and " +
        "`startPlace`/`endPlace` (marriage/divorce place). `otherNames`: married names, spelling variants, aliases. " +
        "Use list_events for all fields of the events. " +
        "Relatives the user may not see appear as {restricted: true} placeholders. " +
        "`subtype` on relatives: BIOLOGICAL/ADOPTIVE/STEP/FOSTER for parents/children, MARRIED/UNMARRIED/DIVORCED/PARTNER_UNKNOWN (marital status unknown) for partners.",
      inputSchema: { person_id: personId },
      outputSchema: {
        person: refSchema,
        canEdit: z.boolean(),
        families: z.array(z.object({ id: z.string(), name: z.string() })),
        parents: z.array(refSchema),
        partners: z.array(refSchema),
        children: z.array(refSchema),
        siblings: z.array(refSchema),
        media: z.array(z.object({ mediaId: z.string() }).passthrough()),
        citations: z.array(z.object({ id: z.string(), sourceId: z.string(), fact: z.string() }).passthrough()),
        // Lebensereignisse (Taufe, Beruf, Beerdigung …) und weitere Namen — nur, wenn vorhanden.
        events: z.array(z.object({ id: z.string(), type: z.string(), title: z.string() }).passthrough()).optional(),
        otherNames: z.array(z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough()).optional(),
      },
      annotations: { title: "Person abrufen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const d = await getPersonDetail(scope, a.person_id);
      if (!d) throw notFound();
      return personDetailOut(d);
    }),
  );

  const lineageInput = {
    person_id: personId,
    generations: z.number().int().min(1).max(12).optional().describe("Depth, default 4, max 12."),
    limit: z.number().int().min(1).max(500).optional().describe("Max. entries, default 200."),
  };
  const lineageOutput = {
    root: refSchema,
    generationsRequested: z.number(),
    total: z.number(),
    truncated: z.boolean(),
    generations: z.array(
      z.object({ generation: z.number(), label: z.string(), persons: z.array(refSchema) }),
    ),
  };

  server.registerTool(
    "get_ancestors",
    {
      title: "Vorfahren",
      description:
        "Ancestors of a person, grouped by generation (1 = parents, 2 = grandparents, …). " +
        "Each entry has `viaPersonId` (the child through whom it was reached) so lines can be reconstructed; " +
        "`subtype` is only present for non-biological links (ADOPTIVE, STEP, FOSTER).",
      inputSchema: lineageInput,
      outputSchema: lineageOutput,
      annotations: { title: "Vorfahren", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const r = await getAncestors(scope, a.person_id, a.generations ?? 4);
      if (!r) throw notFound();
      return lineageOut(r, "up", a.limit ?? 200);
    }),
  );

  server.registerTool(
    "get_descendants",
    {
      title: "Nachfahren",
      description:
        "Descendants of a person, grouped by generation (1 = children, 2 = grandchildren, …). " +
        "`viaPersonId` is the parent through whom the entry was reached.",
      inputSchema: lineageInput,
      outputSchema: lineageOutput,
      annotations: { title: "Nachfahren", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const r = await getDescendants(scope, a.person_id, a.generations ?? 4);
      if (!r) throw notFound();
      return lineageOut(r, "down", a.limit ?? 200);
    }),
  );

  server.registerTool(
    "get_kinship",
    {
      title: "Verwandtschaft bestimmen",
      description:
        "How `other_person_id` is related to `person_id`, with a German kinship term describing what the OTHER " +
        "person is for the first one (e.g. 'Großmutter väterlicherseits', 'Cousin 1. Grades', 'Schwager'). " +
        "`blood` = consanguinity via nearest common ancestors (biological or adoptive lines), " +
        "`path` = shortest connection over parent/partner links with a term where one applies and a step chain " +
        "('Mutter → Bruder → Ehefrau'). `summary` prefers the blood term.",
      inputSchema: {
        person_id: personId.describe("Reference person (the term is from this person's point of view)."),
        other_person_id: personId.describe("The person whose relationship is described."),
      },
      outputSchema: {
        from: refSchema,
        to: refSchema,
        summary: z.string().nullable(),
        blood: z
          .object({ term: z.string(), commonAncestors: z.array(refSchema) })
          .passthrough()
          .nullable(),
        path: z
          .object({
            found: z.boolean(),
            length: z.number(),
            term: z.string().nullable(),
            chain: z.string(),
            steps: z.array(z.object({ person: refSchema }).passthrough()),
          })
          .passthrough(),
      },
      annotations: { title: "Verwandtschaft bestimmen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const k = await getKinship(scope, a.person_id, a.other_person_id);
      if (!k) throw notFound();
      return {
        from: ref(k.from),
        to: ref(k.to),
        summary: k.summary ?? (k.path.found ? null : "keine Verbindung im Stammbaum gefunden"),
        blood: k.blood
          ? {
              term: k.blood.term,
              generationsUp: k.blood.generationsUp,
              generationsDown: k.blood.generationsDown,
              half: k.blood.half,
              adoptive: k.blood.adoptive,
              side: k.blood.side,
              commonAncestors: k.blood.commonAncestors.map(ref),
            }
          : null,
        path: {
          found: k.path.found,
          length: k.path.length,
          term: k.path.term,
          chain: k.path.chain,
          steps: k.path.steps.map((s) => ({
            person: ref(s.person),
            ...(s.edge ? { relation: s.edge.relation, subtype: s.edge.subtype, relationshipId: s.edge.relationshipId } : {}),
          })),
        },
      };
    }),
  );

  server.registerTool(
    "list_families",
    {
      title: "Familien",
      description:
        "Families (permission groups / family branches) the user can see, with person counts and the user's role. " +
        "Use the IDs for search_persons(family_id), get_timeline(family_id) and write tools.",
      inputSchema: {},
      outputSchema: {
        families: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
      },
      annotations: { title: "Familien", ...READ_ONLY },
    },
    run(ctx, async (scope) => ({ families: await listFamilies(scope) })),
  );

  server.registerTool(
    "get_statistics",
    {
      title: "Statistik",
      description:
        "Overview of the visible tree: person counts (living/deceased, by gender), relationship counts by subtype, " +
        "persons per family, number of images, counts of missing data, earliest/latest birth year. Good first call.",
      inputSchema: {},
      outputSchema: {
        persons: z.object({ total: z.number() }).passthrough(),
        relationships: z.object({}).passthrough(),
        families: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
        media: z.object({ personImages: z.number() }),
        missing: z.object({}).passthrough(),
        birthYears: z.object({}).passthrough(),
      },
      annotations: { title: "Statistik", ...READ_ONLY },
    },
    run(ctx, async (scope) => (await getStatistics(scope)) as unknown as Data),
  );

  server.registerTool(
    "find_data_gaps",
    {
      title: "Datenlücken",
      description:
        "Research starting points: persons with missing or implausible data. Kinds: missingBirthDate, missingBirthPlace, " +
        "missingParents, missingGender, probablyDeceasedWithoutDeathDate (born > 100 years ago), deathPlaceWithoutDeathDate, " +
        "implausibleParentAge (biological parent < 14 or > 70 by birth year), isolated (no relations), withoutFamily (admins only), " +
        "unsourced (birth or death recorded but no citation for that fact — good targets for cite_source). " +
        "Partnership gaps (in `relationshipGaps`, items are pairs with relationshipId): marriageWithoutPlace (married/" +
        "divorced without marriage place), partnershipUnknownStatus (partnership whose marital status is unknown — " +
        "fix with update_relationship subtype MARRIED/UNMARRIED once known). " +
        "`counts` always covers all kinds; `items` lists up to `limit` persons per requested kind.",
      inputSchema: {
        kinds: z
          .array(z.enum([...GAP_KINDS, ...REL_GAP_KINDS]))
          .optional()
          .describe("Restrict to these kinds; default all."),
        limit: z.number().int().min(1).max(200).optional().describe("Persons per kind, default 15."),
      },
      outputSchema: {
        counts: z.record(z.number()),
        items: z.record(z.array(refSchema)),
        relationshipGaps: z.object({
          counts: z.record(z.number()),
          items: z.record(
            z.array(z.object({ relationshipId: z.string(), persons: z.array(refSchema) }).passthrough()),
          ),
        }),
      },
      annotations: { title: "Datenlücken", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const gaps = await findDataGaps(scope, { limit: a.limit ?? 15 });
      const requested: readonly string[] = a.kinds?.length ? a.kinds : [...GAP_KINDS, ...REL_GAP_KINDS];
      const kinds = GAP_KINDS.filter((k) => requested.includes(k));
      const relKinds = REL_GAP_KINDS.filter((k) => requested.includes(k));
      return {
        counts: gaps.counts,
        items: Object.fromEntries(
          kinds.map((k) => [
            k,
            gaps.items[k].map((i) => ({ ...ref(i.person), ...(i.detail ? { detail: i.detail } : {}) })),
          ]),
        ),
        relationshipGaps: {
          counts: gaps.relationshipGaps.counts,
          items: Object.fromEntries(
            relKinds.map((k) => [
              k,
              gaps.relationshipGaps.items[k].map((i) => ({
                relationshipId: i.relationshipId,
                persons: i.persons.map(ref),
                ...(i.detail ? { detail: i.detail } : {}),
              })),
            ]),
          ),
        },
      };
    }),
  );

  server.registerTool(
    "find_possible_duplicates",
    {
      title: "Mögliche Dubletten",
      description:
        "Pairs of persons that are probably recorded twice (similar normalized names incl. spelling variants such as " +
        "ph/f, th/t, umlauts; birth years close). Directly linked persons are never reported. Score 0..1, higher = more likely; " +
        "`reasons` explains the match (German). Verify with get_person before treating as duplicate.",
      inputSchema: {
        min_score: z.number().min(0).max(1).optional().describe("Default 0.5."),
        max_year_diff: z.number().int().min(0).max(10).optional().describe("Max. birth year difference, default 2."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
      },
      outputSchema: {
        total: z.number(),
        candidates: z.array(z.object({ a: refSchema, b: refSchema, score: z.number() }).passthrough()),
      },
      annotations: { title: "Mögliche Dubletten", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const minScore = a.min_score ?? 0.5;
      const all = (await findPossibleDuplicates(scope, { maxYearDiff: a.max_year_diff, limit: 500 })).filter(
        (d) => d.score >= minScore,
      );
      const side = (p: (typeof all)[number]["a"]) => ({
        ...ref(p),
        ...(p.birthPlace ? { birthPlace: p.birthPlace } : {}),
      });
      return {
        total: all.length,
        candidates: all.slice(0, a.limit ?? 20).map((d) => ({
          a: side(d.a),
          b: side(d.b),
          score: d.score,
          reasons: d.reasons,
        })),
      };
    }),
  );

  server.registerTool(
    "check_consistency",
    {
      title: "Plausibilitätsprüfung",
      description:
        "Contradictions between recorded dates (complements find_data_gaps, which reports missing data): " +
        "deathBeforeBirth, parentTooYoung (< 12 at child's birth), parentTooOld (father > 70, mother > 50), " +
        "bornAfterParentDeath (mother died before birth, father > ~10 months before), lifespanOver110, " +
        "partnershipTooYoung (< 14 at start), partnershipAfterDeath, overlappingMarriages, burialBeforeDeath, " +
        "eventBeforeBirth / eventAfterDeath (stored life events outside the lifetime; burial, cremation and probate may " +
        "follow death; alternative records are ignored — affected events in `eventIds`). Errors first, then warnings. " +
        "Only biological parent links are checked for age limits. Uncertain dates (year only, 'um', 'vor', 'nach') are " +
        "compared by the whole range they cover; only contradictions that hold for every reading are reported.",
      inputSchema: {
        kinds: z.array(z.enum(CONSISTENCY_KINDS as [ConsistencyKind, ...ConsistencyKind[]])).optional(),
        person_id: z.string().optional().describe("Only issues involving this person."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 30."),
      },
      outputSchema: {
        total: z.number(),
        counts: z.record(z.number()),
        items: z.array(
          z.object({ kind: z.string(), severity: z.string(), message: z.string(), persons: z.array(refSchema) }).passthrough(),
        ),
      },
      annotations: { title: "Plausibilitätsprüfung", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const r = await findInconsistencies(scope, {
        kinds: a.kinds,
        personId: a.person_id,
        limit: a.limit ?? 30,
      });
      return {
        total: r.total,
        counts: r.counts,
        items: r.items.map((i) => ({
          kind: i.kind,
          severity: i.severity,
          message: i.message,
          persons: i.persons.map(ref),
          relationshipIds: i.relationshipIds,
          ...(i.eventIds.length ? { eventIds: i.eventIds } : {}),
        })),
      };
    }),
  );

  server.registerTool(
    "get_timeline",
    {
      title: "Zeitleiste",
      description:
        "Chronological events (birth, death, marriage, partnership, divorce, partnershipEnd, adoption, fostering, stepParent, event = stored life event such as baptism/burial/occupation) " +
        "for ONE person (own life events plus births/deaths of children, deaths of parents/partners/siblings, with `role` and " +
        "the person's `age`; `missing` lists dates needed for a complete timeline) or for ONE family (all visible members). " +
        "Give exactly one of person_id / family_id.",
      inputSchema: {
        person_id: z.string().optional(),
        family_id: z.string().optional(),
        from_year: z.number().int().optional(),
        to_year: z.number().int().optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        subject: z.object({ type: z.enum(["person", "family"]) }).passthrough(),
        total: z.number(),
        hasMore: z.boolean(),
        events: z.array(z.object({ date: z.string().nullable(), kind: z.string(), label: z.string() }).passthrough()),
        // ungenaue Daten: datePrecision/dateQualifier/dateText, Alter ggf. ageApproximate
        missing: z.array(z.string()).optional().describe("Person timeline only: dates still missing."),
      },
      annotations: { title: "Zeitleiste", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      if (Boolean(a.person_id) === Boolean(a.family_id)) {
        throw validationError([{ path: "person_id", message: "Genau eines von person_id und family_id angeben" }]);
      }
      const limit = a.limit ?? 100;
      const offset = a.offset ?? 0;
      const inRange = (e: TimelineEvent) => {
        // Nach Ankerjahr (wie bei der Suche).
        const y = Number(e.date.slice(0, 4));
        return (a.from_year === undefined || y >= a.from_year) && (a.to_year === undefined || y <= a.to_year);
      };

      if (a.person_id) {
        const t = await getPersonTimeline(scope, a.person_id);
        if (!t) throw notFound();
        const events = t.events.filter(inRange);
        return {
          subject: { type: "person", person: ref(t.person) },
          total: events.length,
          hasMore: offset + limit < events.length,
          events: events.slice(offset, offset + limit).map(eventOut),
          missing: t.missing,
        };
      }

      const t = await getFamilyTimeline(scope, a.family_id!, {
        fromYear: a.from_year,
        toYear: a.to_year,
        limit,
        offset,
      });
      if (!t) throw notFound("Familie");
      return {
        subject: { type: "family", ...t.family },
        total: t.total,
        hasMore: offset + t.events.length < t.total,
        events: t.events.map(eventOut),
      };
    }),
  );

  server.registerTool(
    "list_events",
    {
      title: "Lebensereignisse",
      description:
        "All stored life events of ONE person (person_id) or ONE relationship (relationship_id, e.g. engagement or banns " +
        "of a partnership) with every field: type, title (German), date (with …Precision/…Qualifier/…To/…Text; wording " +
        "that could not be structured is in dateText only), place, address, value (occupation, religion …), cause, age, " +
        "agency, notes, sortOrder, alternative (second, contradicting record — not the main fact) and canEdit. Chronological; " +
        "undated events last. Birth, death, marriage and divorce themselves are NOT events — they are fields of the person " +
        "/ relationship (get_person).",
      inputSchema: {
        person_id: z.string().optional(),
        relationship_id: z.string().optional(),
      },
      outputSchema: {
        events: z.array(z.object({ id: z.string(), type: z.string(), title: z.string() }).passthrough()),
      },
      annotations: { title: "Lebensereignisse", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      if (Boolean(a.person_id) === Boolean(a.relationship_id)) {
        throw validationError([{ path: "person_id", message: "Genau eines von person_id und relationship_id angeben" }]);
      }
      const list = a.person_id
        ? await listPersonEvents(scope, a.person_id)
        : await listRelationshipEvents(scope, a.relationship_id!);
      if (!list) throw notFound(a.person_id ? "Person" : "Beziehung");
      return {
        events: list.map((e) => ({
          ...storedEventOut(e),
          ...(e.personId ? { personId: e.personId } : {}),
          ...(e.relationshipId ? { relationshipId: e.relationshipId } : {}),
          sortOrder: e.sortOrder,
          canEdit: e.canEdit,
        })),
      };
    }),
  );

  server.registerTool(
    "search_sources",
    {
      title: "Quellen suchen",
      description:
        "Sources (church books, civil registry records, census lists, gravestones, family documents, oral tradition, " +
        "websites/databases) visible to the user. `query`: every word must occur in title, author, repository or call number. " +
        "`citationCount` counts only citations the user can see. Use get_source for transcription notes and what a source is cited for.",
      inputSchema: {
        query: z.string().optional(),
        kind: z.enum(SOURCE_KINDS).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
        sources: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string() }).passthrough()),
      },
      annotations: { title: "Quellen suchen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const limit = a.limit ?? 20;
      const offset = a.offset ?? 0;
      const r = await listSources(scope, { q: a.query, kind: a.kind, limit, offset });
      return {
        total: r.total,
        offset,
        hasMore: offset + r.items.length < r.total,
        sources: r.items.map((x) => ({ ...sourceOut(x), citationCount: x.citationCount })),
      };
    }),
  );

  server.registerTool(
    "get_source",
    {
      title: "Quelle abrufen",
      description:
        "One source with all details (incl. transcription/notes) and every fact it is cited for: persons " +
        "(fact NAME/BIRTH/DEATH/OTHER), relationships (PARTNERSHIP, PARENTAGE) and life events (fact EVENT with " +
        "`eventId` and `event` title). Citations attached to persons the user " +
        "may not see are not listed — only counted in `hiddenCitationCount`.",
      inputSchema: { source_id: z.string().min(1).describe("Source ID (from search_sources or get_person citations).") },
      outputSchema: {
        source: z.object({ id: z.string(), title: z.string() }).passthrough(),
        canEdit: z.boolean(),
        citations: z.array(z.object({ id: z.string(), fact: z.string() }).passthrough()),
        hiddenCitationCount: z.number(),
      },
      annotations: { title: "Quelle abrufen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const d = await getSource(scope, a.source_id);
      if (!d) throw notFound("Quelle");
      return {
        source: { ...sourceOut(d.source), ...(d.source.notes ? { notes: d.source.notes } : {}) },
        canEdit: d.canEdit,
        citations: d.citations.map((c) => ({
          id: c.id,
          fact: c.fact,
          factLabel: CITATION_FACT_LABEL[c.fact],
          ...(c.detail ? { detail: c.detail } : {}),
          ...(c.confidence ? { confidence: c.confidence } : {}),
          ...(c.eventId ? { eventId: c.eventId, ...(c.eventTitle ? { event: c.eventTitle } : {}) } : {}),
          ...citationTargetOut(c.target),
        })),
        hiddenCitationCount: d.hiddenCitationCount,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Schreibende Werkzeuge (nur bei wirksamer KI-Stufe WRITE: Schlüssel und
// Benutzerrecht „lesen und schreiben“; im stdio-Testmodus zusätzlich
// MCP_ALLOW_WRITE=true)
// ---------------------------------------------------------------------------

const personFieldsInput = {
  family_name: z.string().max(120).nullable().optional(),
  birth_name: z.string().max(120).nullable().optional().describe("Maiden/birth name if different from family name."),
  gender: z.enum(GENDER).optional(),
  birth_date: dateInput.nullable().optional(),
  birth_place: z.string().max(200).nullable().optional(),
  death_date: dateInput.nullable().optional(),
  death_place: z.string().max(200).nullable().optional(),
  death_cause: z.string().max(2000).nullable().optional(),
  nickname: z.string().max(200).nullable().optional().describe("Call name / nickname (Rufname)."),
  name_prefix: z.string().max(200).nullable().optional().describe("Title or prefix before the name, e.g. 'Dr.', 'Freiherr'."),
  name_suffix: z.string().max(200).nullable().optional().describe("Suffix after the name, e.g. 'jun.', 'III.'."),
};

/** snake_case-Eingabe -> Felder der Dienstschicht (undefined = unverändert). */
function personFields(a: {
  given_name?: string;
  family_name?: string | null;
  birth_name?: string | null;
  gender?: (typeof GENDER)[number];
  birth_date?: string | null;
  birth_place?: string | null;
  death_date?: string | null;
  death_place?: string | null;
  death_cause?: string | null;
  nickname?: string | null;
  name_prefix?: string | null;
  name_suffix?: string | null;
}) {
  const fields: Record<string, unknown> = {
    deathCause: a.death_cause,
    nickname: a.nickname,
    namePrefix: a.name_prefix,
    nameSuffix: a.name_suffix,
    givenName: a.given_name,
    familyName: a.family_name,
    birthName: a.birth_name,
    gender: a.gender,
    birthDate: a.birth_date,
    birthPlace: a.birth_place,
    deathDate: a.death_date,
    deathPlace: a.death_place,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

const summaryOut = (p: PersonLike & Record<string, unknown>) => ({
  ...ref(p),
  givenName: p.givenName,
  familyName: p.familyName,
  birthName: p.birthName ?? null,
  gender: p.gender,
  ...dateFields("birthDate", p.birthDate, p.birthDatePrecision, p.birthDateQualifier, {
    to: p.birthDateTo as string | null | undefined,
    toPrecision: p.birthDateToPrecision as string | null | undefined,
    phrase: p.birthDatePhrase as string | null | undefined,
  }),
  birthPlace: p.birthPlace ?? null,
  ...dateFields("deathDate", p.deathDate, p.deathDatePrecision, p.deathDateQualifier, {
    to: p.deathDateTo as string | null | undefined,
    toPrecision: p.deathDateToPrecision as string | null | undefined,
    phrase: p.deathDatePhrase as string | null | undefined,
  }),
  deathPlace: p.deathPlace ?? null,
  ...(p.deathCause ? { deathCause: p.deathCause } : {}),
  ...(p.nickname ? { nickname: p.nickname } : {}),
  ...(p.namePrefix ? { namePrefix: p.namePrefix } : {}),
  ...(p.nameSuffix ? { nameSuffix: p.nameSuffix } : {}),
  notes: p.notes ?? null,
  familyIds: p.familyIds,
});

const WRITE_NOTE =
  "Acts with the configured user's permissions; every change is written to the audit log.";

export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_person",
    {
      title: "Person anlegen",
      description:
        "Create a new person. Search first (search_persons, find_possible_duplicates) to avoid duplicates. " +
        "`note` becomes a dated research note (with optional `source`). Without family_ids a non-admin's person goes " +
        `into the first family they can edit. Link relatives afterwards with create_relationship. ${WRITE_NOTE}`,
      inputSchema: {
        given_name: z.string().min(1).max(120),
        ...personFieldsInput,
        family_ids: z.array(z.string()).max(50).optional(),
        note: z.string().max(5000).optional().describe("Research note (findings, uncertainties)."),
        source: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Free-text source hint appended to the note only. To record a real, reusable source use create_source + cite_source instead.",
          ),
      },
      outputSchema: { person: refSchema },
      annotations: {
        title: "Person anlegen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const p = await createPerson(scope, {
        ...personFields(a),
        familyIds: a.family_ids,
        notes: a.note ? appendResearchNote(null, a.note, { source: a.source }) : undefined,
      });
      return { person: summaryOut(p) };
    }),
  );

  server.registerTool(
    "update_person",
    {
      title: "Person ändern",
      description:
        "Correct or complete fields of a person. Omitted fields stay unchanged; null clears a field. " +
        "Notes are never overwritten: `append_note` adds a dated research note (with optional free-text `source`) below the " +
        "existing notes. When a finding comes from a document, ALSO record it as a citation (search_sources / create_source, " +
        `then cite_source) so it shows up in the person's sources. ${WRITE_NOTE}`,
      inputSchema: {
        person_id: personId,
        given_name: z.string().min(1).max(120).optional(),
        ...personFieldsInput,
        append_note: z.string().max(5000).optional(),
        source: z.string().max(500).optional().describe("Free-text source hint for append_note (not a citation)."),
      },
      outputSchema: { person: refSchema, changed: z.array(z.string()) },
      annotations: {
        title: "Person ändern",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const patch: Record<string, unknown> = personFields(a);
      if (a.append_note) {
        const current = await getPersonDetail(scope, a.person_id);
        if (!current) throw notFound();
        patch.notes = appendResearchNote(current.person.notes, a.append_note, { source: a.source });
      }
      if (Object.keys(patch).length === 0) {
        throw validationError([{ path: "person_id", message: "Keine Änderung angegeben" }]);
      }
      const p = await updatePerson(scope, a.person_id, patch);
      return { person: summaryOut(p), changed: Object.keys(patch) };
    }),
  );

  server.registerTool(
    "create_relationship",
    {
      title: "Beziehung anlegen",
      description:
        "Link two persons. PARENT_OF: from_person_id is the PARENT, to_person_id the CHILD; subtype BIOLOGICAL (default), " +
        "ADOPTIVE, STEP or FOSTER (max. 2 biological parents). PARTNER_OF: undirected; subtype MARRIED (default), UNMARRIED " +
        "DIVORCED or PARTNER_UNKNOWN (partners, marital status not known); start_date/start_place = wedding (or start), " +
        "end_date/end_place = divorce (or end). Engagement, banns etc. are events of the relationship (add_event). " +
        "Cycles and duplicates are rejected. " +
        WRITE_NOTE,
      inputSchema: {
        type: z.enum(["PARENT_OF", "PARTNER_OF"]),
        from_person_id: z.string().min(1),
        to_person_id: z.string().min(1),
        subtype: z.enum(["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER", "MARRIED", "UNMARRIED", "DIVORCED", "PARTNER_UNKNOWN"]).optional(),
        start_date: dateInput.optional(),
        start_place: z.string().max(2000).optional().describe("Marriage place (partners)."),
        end_date: dateInput.optional(),
        end_place: z.string().max(2000).optional().describe("Divorce place (partners)."),
        notes: z.string().max(2000).optional().describe("Free-text remark. Back the link with cite_source (fact PARTNERSHIP / PARENTAGE)."),
      },
      outputSchema: { relationship: z.object({ id: z.string() }).passthrough() },
      annotations: {
        title: "Beziehung anlegen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const r = await createRelationship(scope, {
        type: a.type,
        subtype: a.subtype,
        fromPersonId: a.from_person_id,
        toPersonId: a.to_person_id,
        startDate: a.start_date,
        startPlace: a.start_place,
        endDate: a.end_date,
        endPlace: a.end_place,
        notes: a.notes,
      });
      return { relationship: relationshipOut(r) };
    }),
  );

  server.registerTool(
    "update_relationship",
    {
      title: "Beziehung ändern",
      description:
        "Correct subtype, dates, places (start_place = marriage place, end_place = divorce place) or notes of a " +
        "relationship (relationshipId from get_person). PARTNER_UNKNOWN = partners whose marital status is unknown; set " +
        "MARRIED/UNMARRIED once a source settles it. The linked persons cannot be " +
        "changed — to fix a wrong link, delete it (delete_relationship) and create the correct one. null clears a field; " +
        `notes replace the relationship's notes. ${WRITE_NOTE}`,
      inputSchema: {
        relationship_id: z.string().min(1),
        subtype: z.enum(["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER", "MARRIED", "UNMARRIED", "DIVORCED", "PARTNER_UNKNOWN"]).optional(),
        start_date: dateInput.nullable().optional(),
        start_place: z.string().max(2000).nullable().optional(),
        end_date: dateInput.nullable().optional(),
        end_place: z.string().max(2000).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      },
      outputSchema: { relationship: z.object({ id: z.string() }).passthrough() },
      annotations: {
        title: "Beziehung ändern",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const patch = Object.fromEntries(
        Object.entries({
          subtype: a.subtype,
          startDate: a.start_date,
          startPlace: a.start_place,
          endDate: a.end_date,
          endPlace: a.end_place,
          notes: a.notes,
        }).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(patch).length === 0) {
        throw validationError([{ path: "relationship_id", message: "Keine Änderung angegeben" }]);
      }
      const r = await updateRelationship(scope, a.relationship_id, patch);
      return { relationship: relationshipOut(r) };
    }),
  );

  server.registerTool(
    "delete_relationship",
    {
      title: "Beziehung löschen",
      description:
        "Remove ONE wrong link between two persons (e.g. a child attached to the wrong parent). Persons themselves are " +
        "never deleted by this server. Only use for correcting clear mistakes; the deleted link is kept in the audit log. " +
        WRITE_NOTE,
      inputSchema: { relationship_id: z.string().min(1) },
      outputSchema: { deleted: z.boolean(), relationshipId: z.string() },
      annotations: {
        title: "Beziehung löschen",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      await deleteRelationship(scope, a.relationship_id);
      return { deleted: true, relationshipId: a.relationship_id };
    }),
  );

  server.registerTool(
    "set_person_families",
    {
      title: "Familien zuordnen",
      description:
        "Set the families (permission groups) a person belongs to — the full list, not a delta. Families the user does not " +
        "know are kept automatically; non-admins can only add/remove families they edit. Note: removing a family hides the " +
        `person from users of that family. ${WRITE_NOTE}`,
      inputSchema: {
        person_id: personId,
        family_ids: z.array(z.string().min(1)).max(50),
      },
      outputSchema: { personId: z.string(), familyIds: z.array(z.string()) },
      annotations: {
        title: "Familien zuordnen",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const r = await setPersonFamilies(scope, a.person_id, a.family_ids);
      return { personId: a.person_id, familyIds: r.familyIds };
    }),
  );

  server.registerTool(
    "create_source",
    {
      title: "Quelle anlegen",
      description:
        "Record a source document once, then cite it for any number of facts with cite_source. Search first " +
        "(search_sources) — one church book volume or one census list is ONE source, the page/entry goes into the citation. " +
        "kind: CHURCH_BOOK, CIVIL_REGISTRY, CENSUS, GRAVESTONE, FAMILY_DOCUMENT, ORAL, WEBSITE, OTHER. Until it is cited, " +
        `only the configured user and admins can see it. ${WRITE_NOTE}`,
      inputSchema: {
        title: z.string().min(1).max(300).describe("E.g. 'Kirchenbuch St. Marien Celle, Taufen 1850–1870'."),
        kind: z.enum(SOURCE_KINDS).optional().describe("Default OTHER."),
        author: z.string().max(2000).optional().describe("Author or origin (e.g. parish priest, informant)."),
        repository: z.string().max(2000).optional().describe("Archive / where it is kept."),
        call_number: z.string().max(2000).optional().describe("Call number / shelf mark."),
        url: z.string().max(2000).optional().describe("Full http(s) URL for online sources."),
        date: dateInput.optional().describe("Date of the source itself (same formats as person dates)."),
        notes: z.string().max(50000).optional().describe("Transcription or notes."),
      },
      outputSchema: { source: z.object({ id: z.string(), title: z.string() }).passthrough() },
      annotations: {
        title: "Quelle anlegen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const s = await createSource(scope, {
        title: a.title,
        kind: a.kind,
        author: a.author,
        repository: a.repository,
        callNumber: a.call_number,
        url: a.url,
        date: a.date,
        notes: a.notes,
      });
      return { source: sourceOut(s) };
    }),
  );

  server.registerTool(
    "cite_source",
    {
      title: "Quelle zitieren",
      description:
        "Attach a source to ONE fact of ONE person (person_id; fact NAME, BIRTH, DEATH or OTHER) or of ONE relationship " +
        "(relationship_id from get_person; fact PARTNERSHIP for partners, PARENTAGE for parent–child, or OTHER) or of ONE " +
        "life event (event_id from get_person/list_events; fact EVENT, may be omitted). Give exactly one of the three IDs. " +
        "`detail` = exact place in the source (page, entry number). confidence: HIGH (original record), MEDIUM (derived/" +
        `index), LOW (hearsay, unclear reading). Requires edit rights on the person/relationship. ${WRITE_NOTE}`,
      inputSchema: {
        source_id: z.string().min(1),
        person_id: z.string().min(1).optional(),
        relationship_id: z.string().min(1).optional(),
        event_id: z.string().min(1).optional().describe("Cite a life event (baptism, burial, occupation …)."),
        fact: z.enum(CITATION_FACTS).optional().describe("Required for persons/relationships; EVENT for events."),
        detail: z.string().max(2000).optional().describe("E.g. 'Taufen 1858, Nr. 12, S. 34'."),
        confidence: z.enum(CITATION_CONFIDENCES).optional(),
      },
      outputSchema: {
        citation: z.object({ id: z.string(), sourceId: z.string(), fact: z.string() }).passthrough(),
      },
      annotations: {
        title: "Quelle zitieren",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      if (!a.fact && !a.event_id) {
        throw validationError([{ path: "fact", message: "Bitte angeben, welche Angabe belegt wird (fact)" }]);
      }
      const c = await createCitation(scope, {
        sourceId: a.source_id,
        personId: a.person_id,
        relationshipId: a.relationship_id,
        eventId: a.event_id,
        fact: a.fact ?? (a.event_id ? "EVENT" : undefined),
        detail: a.detail,
        confidence: a.confidence,
      });
      return {
        citation: {
          id: c.id,
          sourceId: c.sourceId,
          ...(c.personId ? { personId: c.personId } : {}),
          ...(c.relationshipId ? { relationshipId: c.relationshipId } : {}),
          ...(c.eventId ? { eventId: c.eventId } : {}),
          fact: c.fact,
          ...(c.detail ? { detail: c.detail } : {}),
          ...(c.confidence ? { confidence: c.confidence } : {}),
        },
      };
    }),
  );

  const eventFieldsInput = {
    label: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Required for type CUSTOM (own event name, e.g. 'Goldene Hochzeit'); otherwise an optional precision."),
    date: dateInput.nullable().optional(),
    date_phrase: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe(
        "Verbatim date wording from the source when it cannot be expressed as a date (e.g. 'Palmsonntag 1864'); may " +
          "accompany a date. Never put a parseable date here instead of `date`.",
      ),
    place: z.string().max(2000).nullable().optional(),
    address: z.string().max(2000).nullable().optional(),
    value: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .describe("The fact itself for value events: occupation (OCCUPATION), religion, title, education, residence description …"),
    cause: z.string().max(2000).nullable().optional().describe("Cause as stated, e.g. cause of death in a burial record, reason for emigration."),
    age: z.string().max(60).nullable().optional().describe("Age as stated in the source, e.g. '23' or '23 J. 4 M.'."),
    agency: z.string().max(2000).nullable().optional().describe("Responsible parish, office, regiment, school …"),
    notes: z.string().max(20000).nullable().optional(),
  };
  const eventFields = (a: {
    label?: string | null;
    date?: string | null;
    date_phrase?: string | null;
    place?: string | null;
    address?: string | null;
    value?: string | null;
    cause?: string | null;
    age?: string | null;
    agency?: string | null;
    notes?: string | null;
  }) =>
    Object.fromEntries(
      Object.entries({
        label: a.label,
        date: a.date,
        datePhrase: a.date_phrase,
        place: a.place,
        address: a.address,
        value: a.value,
        cause: a.cause,
        age: a.age,
        agency: a.agency,
        notes: a.notes,
      }).filter(([, v]) => v !== undefined),
    );
  const ALT_ONLY = ALTERNATIVE_ONLY_TYPES.join(", ");

  server.registerTool(
    "add_event",
    {
      title: "Ereignis hinzufügen",
      description:
        "Record a life event as structured data instead of writing it into notes: baptism (BAPTISM), confirmation, " +
        "occupation (OCCUPATION, value = job), residence (RESIDENCE), education, military service, emigration/immigration, " +
        "census, burial (BURIAL), probate … on a person (person_id), or engagement (ENGAGEMENT), banns (MARRIAGE_BANNS), " +
        "marriage contract … on a partnership (relationship_id). CUSTOM needs a `label`. " +
        `Birth, death, marriage and divorce are NOT events — set them on the person (update_person) or relationship ` +
        `(update_relationship). Types ${ALT_ONLY} are allowed ONLY with is_alternative=true, for a second record that ` +
        "contradicts the main fact (e.g. another birth year in a different source); never use them for the main fact. " +
        "Store dates exactly as precise as the evidence (see date). Then cite the source with cite_source(event_id). " +
        WRITE_NOTE,
      inputSchema: {
        person_id: z.string().min(1).optional(),
        relationship_id: z.string().min(1).optional(),
        type: z.enum(EVENT_TYPES),
        is_alternative: z
          .boolean()
          .optional()
          .describe("true = second, contradicting record of a fact (default false)."),
        ...eventFieldsInput,
      },
      outputSchema: { event: z.object({ id: z.string(), type: z.string(), title: z.string() }).passthrough() },
      annotations: {
        title: "Ereignis hinzufügen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const e = await createEvent(scope, {
        personId: a.person_id ?? null,
        relationshipId: a.relationship_id ?? null,
        type: a.type,
        isAlternative: a.is_alternative ?? false,
        ...eventFields(a),
      });
      return { event: { ...storedEventOut(e), personId: e.personId, relationshipId: e.relationshipId } };
    }),
  );

  server.registerTool(
    "update_event",
    {
      title: "Ereignis ändern",
      description:
        "Correct a stored life event (event_id from get_person or list_events). Omitted fields stay unchanged; null " +
        "clears a field. Changing the date without date_phrase drops an old wording that described the previous date. " +
        `The owner (person/relationship) cannot be changed. ${WRITE_NOTE}`,
      inputSchema: {
        event_id: z.string().min(1),
        type: z.enum(EVENT_TYPES).optional(),
        is_alternative: z.boolean().optional(),
        ...eventFieldsInput,
      },
      outputSchema: { event: z.object({ id: z.string(), type: z.string(), title: z.string() }).passthrough() },
      annotations: {
        title: "Ereignis ändern",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const patch: Record<string, unknown> = {
        ...eventFields(a),
        ...(a.type !== undefined ? { type: a.type } : {}),
        ...(a.is_alternative !== undefined ? { isAlternative: a.is_alternative } : {}),
      };
      if (Object.keys(patch).length === 0) {
        throw validationError([{ path: "event_id", message: "Keine Änderung angegeben" }]);
      }
      const e = await updateEvent(scope, a.event_id, patch);
      return { event: { ...storedEventOut(e), personId: e.personId, relationshipId: e.relationshipId } };
    }),
  );

  server.registerTool(
    "delete_event",
    {
      title: "Ereignis löschen",
      description:
        "Remove ONE wrongly recorded life event together with its citations (the sources themselves stay). Only for " +
        `correcting clear mistakes; the deleted event is kept in the audit log. ${WRITE_NOTE}`,
      inputSchema: { event_id: z.string().min(1) },
      outputSchema: { deleted: z.boolean(), eventId: z.string() },
      annotations: {
        title: "Ereignis löschen",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      await deleteEvent(scope, a.event_id);
      return { deleted: true, eventId: a.event_id };
    }),
  );

  server.registerTool(
    "add_name_variant",
    {
      title: "Weiteren Namen hinzufügen",
      description:
        "Add another name of a person: BIRTH (birth name record), MARRIED (married name), ALIAS (also known as), " +
        "RELIGIOUS (religious/baptismal name), IMMIGRANT (name after immigration), VARIANT (spelling variant found in a " +
        "source), OTHER (with label). At least one of given_name, family_name, nickname. The main name stays on the " +
        `person (update_person). ${WRITE_NOTE}`,
      inputSchema: {
        person_id: personId,
        type: z.enum(PERSON_NAME_TYPES),
        given_name: z.string().max(200).optional(),
        family_name: z.string().max(200).optional(),
        prefix: z.string().max(200).optional(),
        suffix: z.string().max(200).optional(),
        nickname: z.string().max(200).optional(),
        label: z.string().max(200).optional().describe("Own label for type OTHER."),
        notes: z.string().max(2000).optional().describe("E.g. where this spelling occurs."),
      },
      outputSchema: { name: z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough() },
      annotations: {
        title: "Weiteren Namen hinzufügen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const n = await createPersonName(scope, {
        personId: a.person_id,
        type: a.type,
        givenName: a.given_name,
        familyName: a.family_name,
        prefix: a.prefix,
        suffix: a.suffix,
        nickname: a.nickname,
        label: a.label,
        notes: a.notes,
      });
      return { name: nameOut(n) };
    }),
  );
}

/** Für die Ressource familytree://person/{id}. */
export async function personResource(scope: Scope, id: string): Promise<Data | null> {
  const d = await getPersonDetail(scope, id);
  return d ? personDetailOut(d) : null;
}
