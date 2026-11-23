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
  addMedia,
  decodeBase64Image,
  fetchImageFromUrl,
  linkMedia,
  maxUploadBytes,
  unlinkMedia,
  MAX_MEDIA_TARGETS,
  type AttachedImage,
  type MediaTargets,
} from "../lib/services";
import type { SafeFetchOptions } from "../lib/safe-fetch";
import { CONSISTENCY_KINDS, type ConsistencyKind } from "../lib/consistency";
import { isPreciseDate, toFuzzyDate, toIsoPartial } from "../lib/dates";
import { CITATION_FACT_LABEL, SOURCE_KIND_LABEL, DERIVED_SOURCE_KINDS } from "../lib/source-labels";
import { CITATION_CONFIDENCES, CITATION_FACTS, SOURCE_KINDS } from "../lib/validation";
import { ALTERNATIVE_ONLY_TYPES, EVENT_TYPES, PERSON_NAME_TYPES } from "../lib/events";
import { appendResearchNote, dateFields, isoDay, ref, type PersonLike } from "./format";
import { beginMcpChangeSet, CHANGE_SET_TITLE_MAX, mcpChangeSet } from "../lib/change-sets";
import {
  AI_ASSIGN_MAX,
  assignPlacesByAi,
  listPlaces,
  PLACE_STATUS_LABEL,
  placeTextContext,
  suggestPlaces,
  type PlaceStatus,
} from "../lib/services/places";
import { getPlacePage, placeLinksFor, placeRefForText } from "../lib/services/place-pages";
import { placeKey } from "../lib/places/normalize";
import { resolvePersonRedirect } from "../lib/services/redirects";
import { resolvePersonArgs, withResolvedFrom } from "./person-redirects";
// KI-Vorprüfung möglicher Dubletten (eigener Block am Dateiende).
import { CONFIDENCE_LABEL } from "../lib/duplicates";
import { DUPLICATE_VERDICTS, REVIEW_REASON_MAX, REVIEW_REASON_MIN } from "../lib/duplicate-verdicts";
import { listDuplicateCandidates, reviewDuplicate } from "../lib/services/duplicates";
import type { DuplicateReviewDto } from "../lib/services/duplicate-reviews";
import { previewPersonMerge } from "../lib/services/merge";

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
  /** Nur für Tests: Abruf-Optionen für add_media(url) (Resolver/Transport ersetzen). */
  mediaFetch?: SafeFetchOptions;
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
      // Alte Kennungen aufgegangener Personen still auflösen (mcp/person-redirects.ts).
      const resolved = await resolvePersonArgs(auth.scope, args);
      const data = await fn(auth.scope, resolved.args);
      return textResult(resolved.resolvedFrom ? { ...data, resolvedFrom: resolved.resolvedFrom } : data);
    } catch (err) {
      if (err instanceof ServiceError) return errorResult(serviceErrorText(err));
      console.error("[mcp] Werkzeugfehler:", err);
      return errorResult(`Interner Fehler: ${(err as Error).message ?? String(err)}`);
    }
  };
}

/**
 * Wie run, verlangt aber die Stufe WRITE und ordnet die Änderungen einem
 * Changelog-Paket zu (lib/change-sets.ts): dem mit `change_set_id`
 * angegebenen (geprüft, bevor etwas geändert wird) oder automatisch dem
 * laufenden Paket dieses Schlüssels.
 */
function runWrite<A>(ctx: ToolContext, fn: (scope: Scope, args: A) => Promise<Data>) {
  return run<A>(
    ctx,
    async (scope, args) => {
      const requested = (args as { change_set_id?: string } | undefined)?.change_set_id;
      const cs = await mcpChangeSet(scope, requested);
      if (!cs.ok) throw validationError([{ path: "change_set_id", message: cs.message }]);
      return fn({ ...scope, changeSet: cs.handle }, args);
    },
    "WRITE",
  );
}

/** Optionale Paket-Kennung für jedes schreibende Werkzeug. */
const changeSetIdInput = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe(
    "Change set from begin_change_set. Optional: without it, writes of this key within 30 minutes are bundled into the most recent change set.",
  );

/**
 * Zugeordnete Orte zu den Ortstexten eines Ergebnisses: Freitext → Ort
 * (Kennung für get_place, Anzeigename, Koordinaten). Der Freitext selbst
 * bleibt in den Feldern unverändert; nicht zugeordnete Texte fehlen hier.
 */
const placesOutput = z
  .record(z.object({ placeId: z.string(), label: z.string(), latitude: z.number(), longitude: z.number() }))
  .optional()
  .describe("Assigned place per place text: placeId (for get_place), label, coordinates.");

async function placesOut(texts: (string | null | undefined)[]): Promise<Record<string, { placeId: string; label: string; latitude: number; longitude: number }> | null> {
  const links = await placeLinksFor(texts);
  const out: Record<string, { placeId: string; label: string; latitude: number; longitude: number }> = {};
  for (const t of texts) {
    const l = t ? links[placeKey(t)] : undefined;
    if (t && l) out[t] = { placeId: l.ref, label: l.label, latitude: l.latitude, longitude: l.longitude };
  }
  return Object.keys(out).length ? out : null;
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

/** Bild kompakt (Kennung für link_media, Beschriftung, Maße). */
function imageOut(m: AttachedImage & { isMain?: boolean }) {
  return {
    mediaId: m.mediaId,
    ...(m.caption ? { caption: m.caption } : {}),
    ...(m.width && m.height ? { width: m.width, height: m.height } : {}),
    ...(m.isMain ? { isMainScan: true } : {}),
  };
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
    ...(e.media?.length ? { media: e.media.map(imageOut) } : {}),
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
    ...(c.url ? { url: c.url } : {}),
    ...(c.confidence ? { confidence: c.confidence } : {}),
    ...(DERIVED_SOURCE_KINDS.includes(c.source.kind) ? { independent: false } : {}),
    ...(c.relationshipId ? { relationshipId: c.relationshipId } : {}),
    ...(c.eventId ? { eventId: c.eventId, ...(c.eventTitle ? { event: c.eventTitle } : {}) } : {}),
    ...(c.relationship ? { relation: { role: c.relationship.role, subtype: c.relationship.subtype, with: ref(c.relationship.other) } } : {}),
    ...(c.media?.length ? { media: c.media.map(imageOut) } : {}),
    ...(c.sourceMedia?.length ? { sourceMedia: c.sourceMedia.map(imageOut) } : {}),
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
    ...(s.provider ? { provider: s.provider } : {}),
    ...(DERIVED_SOURCE_KINDS.includes(s.kind) ? { independent: false } : {}),
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

export function registerReadTools(baseServer: McpServer, ctx: ToolContext): void {
  const server = withResolvedFrom(baseServer);
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
        "Images: `media` = the person's own pictures (portrait first); `events[].media` = images attached to a life " +
        "event; `citations[].media` = images attached to that citation (the record entry); `citations[].sourceMedia` = " +
        "images of the cited source shown here as document image (not assigned to another citation of that source). " +
        "Each image has a `mediaId` usable with link_media. " +
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
        places: placesOutput,
      },
      annotations: { title: "Person abrufen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const d = await getPersonDetail(scope, a.person_id);
      if (!d) throw notFound();
      const places = await placesOut([
        d.person.birthPlace,
        d.person.deathPlace,
        ...d.relations.flatMap((r) => (r.other.restricted ? [] : [r.startPlace, r.endPlace, ...r.events.map((e) => e.place)])),
        ...d.events.map((e) => e.place),
      ]);
      return { ...personDetailOut(d), ...(places ? { places } : {}) };
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
        "Pairs of persons that are probably recorded twice (normalized names incl. spelling variants such as ph/f, th/t, " +
        "umlauts; married vs. birth surname and other recorded names; birth/death dates incl. imprecise ones; places; " +
        "same or same-named parents/partners; persons imported from different source trees). Directly linked persons and " +
        "pairs a user marked as 'kein Duplikat' are never reported. Score 0..1, higher = more likely; confidence " +
        "high ('sicher': same full name, same exact birth and death date or same parents, no contradiction) / medium / low; " +
        "`reasons` and `conflicts` explain it (German). Verify with get_person before treating as duplicate. " +
        "Merging is only possible in the web app, not via this server.",
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
          confidence: d.confidence,
          reasons: d.reasons,
          ...(d.conflicts.length ? { conflicts: d.conflicts } : {}),
          ...(d.crossTree ? { crossTree: true } : {}),
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
        places: placesOutput,
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
      const places = await placesOut(list.map((e) => e.place));
      return {
        ...(places ? { places } : {}),
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
        "may not see are not listed — only counted in `hiddenCitationCount`. `images`: pictures of the source " +
        "(isMainScan = main scan); `citations[].media`: pictures attached to one citation.",
      inputSchema: { source_id: z.string().min(1).describe("Source ID (from search_sources or get_person citations).") },
      outputSchema: {
        source: z.object({ id: z.string(), title: z.string() }).passthrough(),
        canEdit: z.boolean(),
        citations: z.array(z.object({ id: z.string(), fact: z.string() }).passthrough()),
        hiddenCitationCount: z.number(),
        images: z.array(z.object({ mediaId: z.string() }).passthrough()),
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
          ...(c.url ? { url: c.url } : {}),
          ...(c.confidence ? { confidence: c.confidence } : {}),
          ...(c.eventId ? { eventId: c.eventId, ...(c.eventTitle ? { event: c.eventTitle } : {}) } : {}),
          ...citationTargetOut(c.target),
          ...(c.media.length ? { media: c.media.map(imageOut) } : {}),
        })),
        hiddenCitationCount: d.hiddenCitationCount,
        images: d.images.map(imageOut),
      };
    }),
  );

  registerPlaceReadTools(server, ctx);
  registerDuplicateReviewReadTools(server, ctx);
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
  "Acts with the configured user's permissions; every change is written to the audit log (optionally into a change set, see begin_change_set).";

export function registerWriteTools(baseServer: McpServer, ctx: ToolContext): void {
  const server = withResolvedFrom(baseServer);
  server.registerTool(
    "begin_change_set",
    {
      title: "Änderungspaket öffnen",
      description:
        "Open a change set: a titled bundle that groups the following writes in the app's change history (e.g. " +
        "'Taufbuch St. Marien 1850–1870 ausgewertet'). Pass the returned change_set_id to every write tool of this task. " +
        "Without change_set_id, writes of the same key within 30 minutes join the most recent change set (this one, once " +
        "opened), otherwise an automatic one. A change set accepts writes for 24 hours. Title in German, describing the task " +
        "and the record — never names of persons (the title is shown to users who may not see every person involved).",
      inputSchema: {
        title: z
          .string()
          .trim()
          .min(3)
          .max(CHANGE_SET_TITLE_MAX)
          .describe("Short German description of the task and record, without names of persons."),
      },
      outputSchema: { change_set_id: z.string(), title: z.string(), created_at: z.string() },
      annotations: {
        title: "Änderungspaket öffnen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    run(
      ctx,
      async (scope, a: { title: string }) => {
        const cs = await beginMcpChangeSet(scope, a.title);
        return { change_set_id: cs.id, title: cs.title, created_at: cs.createdAt.toISOString() };
      },
      "WRITE",
    ),
  );

  server.registerTool(
    "create_person",
    {
      title: "Person anlegen",
      description:
        "Create a new person. Search first (search_persons, find_possible_duplicates) to avoid duplicates. " +
        "`note` becomes a dated research note (with optional `source`). Without family_ids a non-admin's person goes " +
        `into the first family they can edit. Link relatives afterwards with create_relationship. ${WRITE_NOTE}`,
      inputSchema: {
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
      inputSchema: { relationship_id: z.string().min(1), change_set_id: changeSetIdInput },
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
        change_set_id: changeSetIdInput,
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
      inputSchema: { event_id: z.string().min(1), change_set_id: changeSetIdInput },
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
        change_set_id: changeSetIdInput,
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

  // --- Bilder ------------------------------------------------------------------
  const idList = (what: string) =>
    z.array(z.string().min(1).max(64)).max(MAX_MEDIA_TARGETS).optional().describe(what);
  const mediaTargetsInput = {
    person_ids: idList("Persons (picture of the person; the first picture becomes the portrait)."),
    relationship_ids: idList("Relationships (relationshipId from get_person), e.g. a wedding photo."),
    event_ids: idList("Life events (events[].id from get_person / list_events), e.g. the baptism record."),
    citation_ids: idList(
      "Citations (citations[].id from get_person / get_source): the scan of exactly the record entry that backs the fact. Preferred for record scans.",
    ),
    source_ids: idList(
      "Sources: a picture of the source as a whole (title page, gravestone …); shown on every fact citing the source unless it is also attached to one citation of that source.",
    ),
  };
  type TargetArgs = {
    person_ids?: string[];
    relationship_ids?: string[];
    event_ids?: string[];
    citation_ids?: string[];
    source_ids?: string[];
  };
  const targetsOf = (a: TargetArgs): MediaTargets => ({
    personIds: a.person_ids,
    relationshipIds: a.relationship_ids,
    eventIds: a.event_ids,
    citationIds: a.citation_ids,
    sourceIds: a.source_ids,
  });
  const maxBytes = maxUploadBytes();
  const maxMb = Math.round(maxBytes / 1024 / 1024);
  const mediaOut = z.object({ id: z.string() }).passthrough();

  server.registerTool(
    "add_media",
    {
      title: "Bild hinzufügen",
      description:
        "Store a new image and attach it to entries: persons, relationships, life events, citations and/or sources (at " +
        "least one; every target must be editable for the user). Give EXACTLY ONE of: `url` — an https address the " +
        "server downloads itself (public internet only, no internal addresses, max. " + maxMb + " MB, JPEG/PNG/WebP/GIF/AVIF/TIFF); " +
        "or `data_base64` — the file bytes as base64 (only for clients that can read the original file, e.g. Claude Code " +
        "reading a local file; a data: URL works too). An image you merely SEE in the chat cannot be passed on — ask the " +
        "user for a link (url) or to upload it in the app, or attach an existing image with link_media. The type is checked " +
        "from the bytes; `mime_type` is only a cross-check. `caption` becomes the alt text: describe what the picture shows " +
        "in German (e.g. 'Taufeintrag Anna Becker, Kirchenbuch St. Marien 1850, S. 12'). " +
        WRITE_NOTE,
      inputSchema: {
        change_set_id: changeSetIdInput,
        url: z.string().max(2000).optional().describe("https address of the image file (not of a web page showing it)."),
        data_base64: z
          .string()
          .max(Math.ceil(maxBytes / 3) * 4 + 200)
          .optional()
          .describe(`Image file as base64 (max. ${maxMb} MB decoded).`),
        mime_type: z.string().max(100).optional().describe("Declared type, e.g. image/jpeg — must match the content."),
        file_name: z.string().max(200).optional().describe("Original file name, e.g. 'taufe_1850.jpg'."),
        caption: z.string().max(500).optional().describe("German description; used as alt text."),
        ...mediaTargetsInput,
      },
      outputSchema: { media: mediaOut, linked: z.record(z.array(z.string())) },
      annotations: {
        title: "Bild hinzufügen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    runWrite(ctx, async (scope, a) => {
      if (Boolean(a.url) === Boolean(a.data_base64)) {
        throw validationError([{ path: "url", message: "Genau eines von url oder data_base64 angeben" }]);
      }
      const targets = targetsOf(a);
      let bytes: Buffer;
      let fileName = a.file_name ?? null;
      let declaredMime = a.mime_type ?? null;
      if (a.url) {
        const res = await fetchImageFromUrl(a.url, ctx.mediaFetch);
        bytes = res.bytes;
        fileName ??= res.fileName;
        // Die Inhaltsart der Antwort ist nur eine Angabe — sharp entscheidet.
        if (!declaredMime && res.contentType.startsWith("image/")) declaredMime = res.contentType;
      } else {
        const decoded = decodeBase64Image(a.data_base64!, maxBytes);
        bytes = decoded.bytes;
        declaredMime ??= decoded.declaredMime;
      }
      const r = await addMedia(scope, {
        bytes,
        fileName,
        caption: a.caption ?? null,
        declaredMime,
        targets,
        requireTarget: true,
        via: a.url ? "url" : "data",
        url: a.url ?? null,
      });
      return { media: r.media, linked: r.linked };
    }),
  );

  server.registerTool(
    "link_media",
    {
      title: "Bild verknüpfen",
      description:
        "Attach an EXISTING image (media_id from get_person `media`, `events[].media`, `citations[].media`, or get_source " +
        "`images`) to further entries, or detach it with action 'unlink'. The image must be visible to the user and every " +
        "target editable. Unlinking never deletes an image: removing its last attachment is refused. " +
        WRITE_NOTE,
      inputSchema: {
        change_set_id: changeSetIdInput,
        media_id: z.string().min(1).max(64),
        action: z.enum(["link", "unlink"]).optional().describe("Default link."),
        ...mediaTargetsInput,
      },
      outputSchema: {
        mediaId: z.string(),
        action: z.string(),
        targets: z.record(z.array(z.string())),
        changed: z.number(),
      },
      annotations: {
        title: "Bild verknüpfen",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const targets = targetsOf(a);
      if (a.action === "unlink") {
        const r = await unlinkMedia(scope, a.media_id, targets, { deleteOrphan: false });
        return { mediaId: a.media_id, action: "unlink", targets: r.unlinked, changed: Object.values(r.unlinked).flat().length };
      }
      const r = await linkMedia(scope, a.media_id, targets);
      return { mediaId: a.media_id, action: "link", targets: r.linked, changed: r.created };
    }),
  );

  registerPlaceWriteTools(server, ctx);
  registerDuplicateReviewWriteTools(server, ctx);
}

/** Für die Ressource familytree://person/{id}. */
export async function personResource(scope: Scope, id: string): Promise<Data | null> {
  const d = await getPersonDetail(scope, id);
  if (d) return personDetailOut(d);
  // Alte Kennung einer aufgegangenen Person: die bleibende liefern und es sagen.
  const to = await resolvePersonRedirect(scope, id);
  const merged = to ? await getPersonDetail(scope, to) : null;
  return merged ? { ...personDetailOut(merged), resolvedFrom: { [id]: to } } : null;
}

// ---------------------------------------------------------------------------
// Orte (Karte): Kandidaten, offene Ortstexte, Zuordnung durch die KI
// ---------------------------------------------------------------------------

/** Status-Angaben für list_places: englische Kennungen und die deutschen Wörter der Oberfläche. */
const PLACE_STATUS_INPUT: Record<string, PlaceStatus | "all"> = {
  all: "all",
  alle: "all",
  open: "open",
  offen: "open",
  auto: "auto",
  automatisch: "auto",
  ai: "ai",
  ki: "ai",
  manual: "manual",
  von_hand: "manual",
  bestaetigt: "manual",
  unresolvable: "unresolvable",
  nicht_zuordenbar: "unresolvable",
};

const placeCandidateSchema = z
  .object({ source: z.string(), label: z.string(), latitude: z.number(), longitude: z.number(), recommended: z.boolean() })
  .passthrough();

function registerPlaceReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_place",
    {
      title: "Ort abrufen",
      description:
        "One assigned place as on its page in the app: today's name with former/German name, region, country, coordinates, " +
        "how it was assigned (auto/AI/manual), other names from the gazetteer, the free texts in the data that point to it " +
        "(several texts can mean the same place) and the persons with facts there (birth, death, marriage, divorce, events — " +
        "kind and year), 50 per page. Only persons the user may see; texts occurring only at hidden persons are left out. " +
        "Pass `place_id` (placeId from get_person/list_events `places`) or a place `text` as written in the data.",
      inputSchema: {
        place_id: z.string().min(3).max(80).optional(),
        text: z.string().min(1).max(500).optional(),
        page: z.number().int().min(1).optional().describe("Page of persons, 50 each. Default 1."),
      },
      outputSchema: {
        placeId: z.string(),
        label: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        texts: z.array(z.object({ text: z.string(), count: z.number() })),
        total: z.number(),
        entries: z.array(z.object({ person: refSchema, kind: z.string() }).passthrough()),
      },
      annotations: { title: "Ort abrufen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      if (Boolean(a.place_id) === Boolean(a.text)) {
        throw validationError([{ path: "place_id", message: "Genau eines von place_id und text angeben" }]);
      }
      let ref = a.place_id ?? null;
      if (a.text) {
        ref = await placeRefForText(a.text);
        if (!ref) throw notFound("Ort (dieser Text ist keinem Ort zugeordnet)");
      }
      const p = await getPlacePage(scope, ref!, { page: a.page });
      if (!p) throw notFound("Ort");
      const { ref: placeId, entries, ...rest } = p;
      return {
        placeId,
        ...rest,
        entries: entries.map((e) => ({
          person: { id: e.person.id, name: e.person.name, ...(e.person.birthYear || e.person.deathYear ? { lifespan: `${e.person.birthYear ?? "?"} – ${e.person.deathYear ?? "?"}` } : {}) },
          kind: e.kind,
          label: e.label,
          ...(e.year ? { year: e.year } : {}),
          text: e.text,
          ...(e.alternative ? { alternative: true } : {}),
        })),
      };
    }),
  );

  server.registerTool(
    "suggest_place",
    {
      title: "Ort vorschlagen",
      description:
        "Candidates for a free-text place as written in the data (e.g. 'Breslau, Schlesien, Preußen', GEDCOM forms like " +
        "'Berkum, Peine, Lk Peine, Niedersachsen, Germany'): the same rule the app uses for automatic assignment " +
        "(`recommended`), the other places of the same name in rank order, and own places (source 'own': created earlier by " +
        "an admin or by you with coordinates — hamlets, farms, deserted villages). Each candidate has label (today's official " +
        "name, former/German name in brackets), kind, precision, coordinates, country, population, `matchedName` and `nameKind` " +
        "('historic' = the former or German name like Breslau for Wrocław, 'alternate' = another language, 'official'), " +
        "`distanceKm` from the recommended one. `ambiguous` > 0: further places of that name exist — decide with the other parts " +
        "of the text and the context from list_places. Without a match: prefix hits from the directory. Administrators also get " +
        "`current` (the existing assignment). Reads only the bundled gazetteer (GeoNames) and own places.",
      inputSchema: { text: z.string().min(1).max(500).describe("Place text exactly as in the data (from list_places).") },
      outputSchema: {
        text: z.string(),
        recommended: placeCandidateSchema.nullable(),
        ambiguous: z.number(),
        candidates: z.array(placeCandidateSchema),
        current: z.object({ source: z.string(), status: z.string() }).passthrough().optional(),
      },
      annotations: { title: "Ort vorschlagen", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => (await suggestPlaces(scope, a.text)) as unknown as Data),
  );

  server.registerTool(
    "list_places",
    {
      title: "Ortstexte auflisten",
      description:
        "Administrators only. All distinct place texts of the tree (birth, death, marriage/divorce places, life events) with " +
        "number of occurrences and assignment status: open (no coordinates yet), auto (automatic from the gazetteer), ai " +
        "(set by an AI assistant, shown as 'von KI' until an admin confirms), manual (confirmed by hand — never change), " +
        "unresolvable. `context` tells where a text occurs (fields: birth, death, marriage, divorce, event:<TYPE>) and the " +
        "year range — no persons. 50 per page, most frequent first; `suggestion` is the automatic candidate. Work through " +
        "status 'open' with suggest_place and assign_place.",
      inputSchema: {
        status: z
          .enum(Object.keys(PLACE_STATUS_INPUT) as [string, ...string[]])
          .optional()
          .describe("open/offen, auto/automatisch, ai/ki, manual/von_hand, unresolvable/nicht_zuordenbar, all/alle (default)."),
        query: z.string().max(200).optional().describe("Only texts (or assigned labels) containing this."),
        page: z.number().int().min(1).optional().describe("Page, 50 texts each. Default 1."),
      },
      outputSchema: {
        total: z.number(),
        page: z.number(),
        pages: z.number(),
        counts: z.record(z.number()),
        places: z.array(z.object({ text: z.string(), count: z.number(), status: z.string() }).passthrough()),
      },
      annotations: { title: "Ortstexte auflisten", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const status = a.status ? PLACE_STATUS_INPUT[a.status] : "all";
      const list = await listPlaces(scope, { status, q: a.query, page: a.page });
      const context = await placeTextContext(
        scope,
        list.rows.map((r) => r.key),
      );
      return {
        total: list.total,
        page: list.page,
        pages: Math.max(1, Math.ceil(list.total / list.pageSize)),
        counts: list.counts,
        places: list.rows.map((r) => ({
          text: r.text,
          count: r.count,
          ...(r.variants > 1 ? { spellings: r.variants } : {}),
          status: r.status,
          statusLabel: PLACE_STATUS_LABEL[r.status],
          ...(context.get(r.key) ? { context: context.get(r.key) } : {}),
          ...(r.assignment
            ? {
                assignment: {
                  source: r.assignment.source,
                  label: r.assignment.label,
                  latitude: r.assignment.latitude,
                  longitude: r.assignment.longitude,
                  precision: r.assignment.precision,
                  unresolvable: r.assignment.unresolvable,
                  ...(r.assignment.gazetteerId ? { gazetteerId: r.assignment.gazetteerId } : {}),
                  ...(r.assignment.uncertain ? { uncertain: true } : {}),
                  ...(r.assignment.note ? { note: r.assignment.note } : {}),
                },
              }
            : {}),
          ...(r.suggestion
            ? {
                suggestion: {
                  gazetteerId: r.suggestion.gazetteerId,
                  label: r.suggestion.label,
                  precision: r.suggestion.precision,
                  ambiguous: r.suggestion.ambiguous,
                },
              }
            : {}),
        })),
      };
    }),
  );
}

const placeTextInput = z.string().min(1).max(500).describe("Place text exactly as in the data (from list_places).");
const assignItemInput = {
  gazetteer_id: z.string().min(1).max(32).optional().describe("Choose a directory entry (gazetteerId from suggest_place)."),
  latitude: z.number().min(-90).max(90).optional().describe("Own place: latitude (WGS84) — with longitude and label."),
  longitude: z.number().min(-180).max(180).optional(),
  label: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Own place: display name, today's name first, e.g. 'Hof Lindenau (Wüstung), Niedersachsen, Deutschland'."),
  precision: z.enum(["PLACE", "REGION", "COUNTRY"]).optional().describe("Own place: default PLACE."),
  unresolvable: z.literal(true).optional().describe("Mark as not assignable (no coordinates)."),
  uncertain: z.boolean().optional().describe("true = probable but not certain; an administrator should check."),
  note: z.string().max(1000).optional().describe("Short German reason, shown to administrators (e.g. 'Kreis Peine passt, einziger Ort dieses Namens dort')."),
};

function registerPlaceWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "assign_place",
    {
      title: "Ort zuordnen",
      description:
        "Administrators only. Assign coordinates to place texts for the map — the free text in the data is never changed. " +
        "Either one assignment (text + one of: gazetteer_id | latitude+longitude+label | unresolvable) or `assignments` " +
        "with up to 50 of them. A place missing from the directory (deserted village, hamlet, farm, incorporated district) " +
        "may be created as own place with coordinates, label and precision; it then appears as candidate for later texts. " +
        "Stored with source 'AI' ('von KI'), effective on the map at once; an administrator confirms or changes it. Mark " +
        "probable choices with uncertain=true and give a short German `note` with the reason. Overwrites automatic and earlier " +
        "AI assignments, never ones confirmed by hand (reported per item). Per item result with ok/error. " +
        WRITE_NOTE,
      inputSchema: {
        change_set_id: changeSetIdInput,
        text: placeTextInput.optional(),
        ...assignItemInput,
        assignments: z
          .array(z.object({ text: placeTextInput, ...assignItemInput }))
          .min(1)
          .max(AI_ASSIGN_MAX)
          .optional()
          .describe(`Several assignments in one call (at most ${AI_ASSIGN_MAX}); then omit the single fields.`),
      },
      outputSchema: {
        assigned: z.number(),
        failed: z.number(),
        results: z.array(z.object({ text: z.string(), ok: z.boolean() }).passthrough()),
      },
      annotations: {
        title: "Ort zuordnen",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const list = a.assignments;
      if (list && a.text !== undefined) {
        throw validationError([{ path: "assignments", message: "Entweder text (eine Zuordnung) oder assignments (Liste), nicht beides." }]);
      }
      if (!list && a.text === undefined) throw validationError([{ path: "text", message: "text oder assignments angeben." }]);
      const items = (list ?? [a]).map((i: Partial<z.infer<z.ZodObject<typeof assignItemInput>>> & { text?: string }) => ({
        text: i.text,
        gazetteerId: i.gazetteer_id,
        latitude: i.latitude,
        longitude: i.longitude,
        label: i.label,
        precision: i.precision,
        unresolvable: i.unresolvable,
        uncertain: i.uncertain,
        note: i.note,
      }));
      const results = await assignPlacesByAi(scope, items);
      return {
        assigned: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results: results as unknown as Data[],
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// KI-Vorprüfung möglicher Dubletten: Kandidaten, Trockenlauf, Einschätzung.
// Bewusst KEIN Werkzeug zum Zusammenführen — das tut nur ein Mensch in der App.
// ---------------------------------------------------------------------------

const VERDICT_INPUT = z.enum(DUPLICATE_VERDICTS);
const NO_MERGE_NOTE =
  "There is no tool that merges persons: merging is done only by a human in the web app, after looking at the same preview.";

const reviewOut = (r: DuplicateReviewDto) => ({
  verdict: r.verdict,
  reason: r.reason,
  ...(r.suggestedKeepId ? { suggestedKeepId: r.suggestedKeepId } : {}),
  reviewedAt: r.reviewedAt,
  stale: r.stale,
});

function registerDuplicateReviewReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_duplicate_candidates",
    {
      title: "Dublettenkandidaten",
      description:
        "The app's list of possible duplicates (page 'Mögliche Dubletten'), page by page, for pre-checking: pairs of persons " +
        "that are probably recorded twice, each with class (`confidence` high = 'sicher', medium = 'wahrscheinlich', " +
        "low = 'unklar'), score, German `reasons` and `conflicts` (contradictions). Only pairs of which the user may see " +
        "BOTH persons; pairs a human marked as 'kein Duplikat' are never listed. `canReview` = the user may edit both " +
        "(needed for preview_person_merge and review_duplicate). `review` = the stored AI assessment, if any; `stale: true` " +
        "means a person changed since — assess again. Filter with `confidence` and `review` ('unreviewed' = no assessment " +
        "or a stale one, 'reviewed' = any, or one verdict). Same ranking as the app: class first, then score. " +
        NO_MERGE_NOTE,
      inputSchema: {
        confidence: z.enum(["high", "medium", "low"]).optional().describe("Only this class: high = sicher, medium = wahrscheinlich, low = unklar."),
        review: z
          .enum(["unreviewed", "reviewed", ...DUPLICATE_VERDICTS])
          .optional()
          .describe("unreviewed = no AI assessment yet or a stale one; reviewed = any assessment; or exactly one verdict."),
        limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
        offset: z.number().int().min(0).optional().describe("Default 0."),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
        counts: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
        candidates: z.array(z.object({ a: refSchema, b: refSchema, score: z.number(), confidence: z.string(), canReview: z.boolean() }).passthrough()),
      },
      annotations: { title: "Dublettenkandidaten", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const limit = a.limit ?? 20;
      const offset = a.offset ?? 0;
      const review = a.review === "unreviewed" ? "open" : a.review === "reviewed" ? "any" : a.review;
      const list = await listDuplicateCandidates(scope, { confidence: a.confidence, review, limit, offset });
      const side = (p: (typeof list.items)[number]["a"]) => ({ ...ref(p), ...(p.birthPlace ? { birthPlace: p.birthPlace } : {}) });
      return {
        total: list.total,
        offset,
        hasMore: offset + list.items.length < list.total,
        counts: list.counts,
        candidates: list.items.map((d) => ({
          a: side(d.a),
          b: side(d.b),
          score: d.score,
          confidence: d.confidence,
          confidenceLabel: CONFIDENCE_LABEL[d.confidence],
          reasons: d.reasons,
          conflicts: d.conflicts,
          ...(d.crossTree ? { crossTree: true } : {}),
          canReview: d.canMerge,
          ...(d.review ? { review: reviewOut(d.review) } : {}),
        })),
      };
    }),
  );

  server.registerTool(
    "preview_person_merge",
    {
      title: "Zusammenführen: Vorschau (Trockenlauf)",
      description:
        "DRY RUN — changes nothing. Exactly the preview the app shows a human before merging two persons: `keep_id` would " +
        "stay, `merge_id` would be absorbed and deleted. Returns both sides (dates, parents, partners, number of children, " +
        "families, imports, counts), `fields` (per field both values, whether they differ, the default choice and why), " +
        "`sentences` (German: what would move, what becomes one, which differing facts stay as second records), " +
        "`alternates`, `newNames`, `dropped` and `blockers` (reasons that make the merge impossible, e.g. the two are " +
        "parent and child, different biological parents, incompatible dates; `suggestions` = pairs to compare first). " +
        "`canMerge: false` means blocked. Requires edit rights for both persons, like the app. Use it to found a verdict " +
        "for review_duplicate. " +
        NO_MERGE_NOTE,
      inputSchema: {
        keep_id: personId.describe("Person that would stay."),
        merge_id: personId.describe("Person that would be absorbed into keep_id."),
      },
      outputSchema: {
        dryRun: z.literal(true),
        keep: z.object({ id: z.string(), name: z.string() }).passthrough(),
        other: z.object({ id: z.string(), name: z.string() }).passthrough(),
        fields: z.array(z.object({ field: z.string(), label: z.string(), keep: z.string(), other: z.string(), differs: z.boolean() }).passthrough()),
        sentences: z.array(z.string()),
        blockers: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()),
        canMerge: z.boolean(),
      },
      annotations: { title: "Zusammenführen: Vorschau (Trockenlauf)", ...READ_ONLY },
    },
    run(ctx, async (scope, a) => {
      const p = await previewPersonMerge(scope, a.keep_id, a.merge_id);
      const sideOut = (s: typeof p.keep) => ({
        id: s.id,
        name: s.name,
        born: s.born,
        died: s.died,
        parents: s.parents,
        partners: s.partners,
        children: s.children,
        families: s.familyNames,
        imports: s.imports,
        counts: s.counts,
      });
      return {
        dryRun: true as const,
        keep: sideOut(p.keep),
        other: sideOut(p.other),
        fields: p.fields
          .filter((f) => f.keep || f.other)
          .map((f) => ({ field: f.field, label: f.label, keep: f.keep, other: f.other, differs: f.differs, choice: f.choice, ...(f.why ? { why: f.why } : {}) })),
        sentences: p.summary.sentences,
        alternates: p.summary.alternates.map((x) => x.text),
        newNames: p.summary.newNames.map((x) => x.text),
        dropped: p.summary.dropped,
        blockers: p.blockers.map((b) => ({ code: b.code, message: b.message, ...(b.suggestions?.length ? { suggestions: b.suggestions } : {}) })),
        canMerge: p.canMerge,
        note: "Trockenlauf: nichts wurde geändert. Zusammenführen kann nur ein Mensch in der App.",
      };
    }),
  );
}

function registerDuplicateReviewWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "review_duplicate",
    {
      title: "Dublette einschätzen",
      description:
        "Store your assessment of ONE candidate pair — nothing else: no person is changed, nothing is merged, the pair stays " +
        "on the list with its class. A human sees the assessment at the pair in the app and decides. Verdicts: MERGE = " +
        "certainly the same person and the preview shows no blocker; NOT_DUPLICATE = certainly different persons; " +
        "DISPUTED = evidence points both ways or is too thin — when in doubt always DISPUTED, never guess. Before calling: " +
        "get_person for BOTH persons and preview_person_merge. `reason` in German, naming the concrete evidence (dates, " +
        "places, parents, partners, sources) and every contradiction. `suggested_keep_id` (only with MERGE): the better " +
        "documented record — a hint, the human chooses. One assessment per pair; a new one replaces the old. Pairs a human " +
        "marked as 'kein Duplikat' cannot be assessed. Requires edit rights for both persons. " +
        NO_MERGE_NOTE +
        " " +
        WRITE_NOTE,
      inputSchema: {
        change_set_id: changeSetIdInput,
        person_a_id: personId,
        person_b_id: personId,
        verdict: VERDICT_INPUT.describe("MERGE | DISPUTED | NOT_DUPLICATE — when in doubt DISPUTED."),
        reason: z
          .string()
          .trim()
          .min(REVIEW_REASON_MIN)
          .max(REVIEW_REASON_MAX)
          .describe("German reasoning with the concrete evidence and contradictions; shown to the user at the pair."),
        suggested_keep_id: z.string().min(1).optional().describe("Only with MERGE: which of the two should stay (a hint only)."),
      },
      outputSchema: {
        personAId: z.string(),
        personBId: z.string(),
        verdict: z.string(),
        reviewedAt: z.string(),
        merged: z.literal(false),
      },
      annotations: {
        title: "Dublette einschätzen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runWrite(ctx, async (scope, a) => {
      const r = await reviewDuplicate(scope, {
        personAId: a.person_a_id,
        personBId: a.person_b_id,
        verdict: a.verdict,
        reason: a.reason,
        suggestedKeepId: a.suggested_keep_id,
      });
      return {
        ...r,
        merged: false as const,
        note: "Nur die Einschätzung wurde gespeichert. Zusammenführen kann nur ein Mensch in der App (Mögliche Dubletten).",
      };
    }),
  );
}
