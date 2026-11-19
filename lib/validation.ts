import { z } from "zod";

import {
  asFuzzyDate,
  certainlyBefore,
  dateBounds,
  fuzzyDateProblem,
  MAX_DATE_PHRASE_LENGTH,
  parseFuzzyDate,
  type FuzzyDate,
} from "./dates";
import { EVENT_TYPES, PERSON_NAME_TYPES } from "./events";

// ---------------------------------------------------------------------------
// Fachregeln — bewusst als reine Funktionen, damit API, Dienste (lib/services)
// und Tests dieselben Regeln verwenden und nichts davon an Zod hängt.
// ---------------------------------------------------------------------------

/** Frühestes plausibles Jahr. Ältere Angaben sind fast immer Tippfehler. */
export const MIN_YEAR = 1000;

/** Beziehungsdaten dürfen leicht in der Zukunft liegen (geplante Hochzeit). */
const FUTURE_TOLERANCE_MS = 366 * 24 * 60 * 60 * 1000;

export const PARENT_SUBTYPES = [
  "BIOLOGICAL",
  "ADOPTIVE",
  "STEP",
  "FOSTER",
] as const;
export const PARTNER_SUBTYPES = ["MARRIED", "UNMARRIED", "DIVORCED"] as const;
export const ALL_SUBTYPES = [...PARENT_SUBTYPES, ...PARTNER_SUBTYPES] as const;

export type RelationTypeName = "PARENT_OF" | "PARTNER_OF";
export type RelationSubtypeName = (typeof ALL_SUBTYPES)[number];

/** Höchstzahl leiblicher Eltern. Adoptiv-, Stief- und Pflegeeltern zählen nicht. */
export const MAX_BIOLOGICAL_PARENTS = 2;

export function subtypesFor(type: RelationTypeName): readonly string[] {
  return type === "PARENT_OF" ? PARENT_SUBTYPES : PARTNER_SUBTYPES;
}

export function subtypeMatchesType(
  type: RelationTypeName,
  subtype: string,
): boolean {
  return subtypesFor(type).includes(subtype);
}

export function defaultSubtype(type: RelationTypeName): RelationSubtypeName {
  return type === "PARENT_OF" ? "BIOLOGICAL" : "MARRIED";
}

export type RuleIssue = { path: string; message: string };

/** Datumsangabe für die Regeln: ungenaues Datum oder (Altbestand) ein Date = tagesgenau. */
export type DateValue = FuzzyDate | Date | null | undefined;

/**
 * Jahr vor MIN_YEAR bzw. sicher in der Zukunft. „Zukunft“ bemisst sich am
 * frühestmöglichen Zeitpunkt der Angabe: „2026“ ist im laufenden Jahr
 * zulässig, „nach 2026“ nicht.
 */
function singleDateIssues(
  path: string,
  f: FuzzyDate,
  labels: { tooEarly: string; future: string },
  latestAllowed: number,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (f.date.getUTCFullYear() < MIN_YEAR) issues.push({ path, message: labels.tooEarly });
  const problem = fuzzyDateProblem(f);
  if (problem) issues.push({ path, message: problem });
  if (dateBounds(f, { tolerant: false }).start > latestAllowed) {
    issues.push({ path, message: labels.future });
  }
  return issues;
}

/**
 * Prüft Lebensdaten einer Person. Wird sowohl beim Anlegen als auch nach dem
 * Zusammenführen eines Teil-Updates mit dem gespeicherten Stand aufgerufen —
 * sonst ließe sich ein Sterbedatum vor dem Geburtsdatum in zwei Schritten
 * eintragen.
 *
 * Ungenaue Daten werden über ihren Zeitraum verglichen: abgelehnt wird nur,
 * was für jede Lesart widersprüchlich ist („um 1850“ geboren und 1849
 * gestorben ist zulässig, 1840 gestorben nicht).
 */
export function personDateIssues(
  p: { birthDate?: DateValue; deathDate?: DateValue },
  now: Date = new Date(),
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const birth = asFuzzyDate(p.birthDate);
  const death = asFuzzyDate(p.deathDate);

  if (birth) {
    issues.push(
      ...singleDateIssues(
        "birthDate",
        birth,
        { tooEarly: `Geburtsjahr vor ${MIN_YEAR} ist nicht plausibel`, future: "Geburtsdatum liegt in der Zukunft" },
        now.getTime(),
      ),
    );
  }
  if (death) {
    issues.push(
      ...singleDateIssues(
        "deathDate",
        death,
        { tooEarly: `Sterbejahr vor ${MIN_YEAR} ist nicht plausibel`, future: "Sterbedatum liegt in der Zukunft" },
        now.getTime(),
      ),
    );
  }

  if (birth && death && certainlyBefore(death, birth)) {
    issues.push({
      path: "deathDate",
      message: "Sterbedatum liegt vor dem Geburtsdatum",
    });
  }

  return issues;
}

/** Prüft Zeitraum und Art einer Beziehung. */
export function relationshipIssues(
  r: {
    type: RelationTypeName;
    subtype: string;
    startDate?: DateValue;
    endDate?: DateValue;
  },
  now: Date = new Date(),
): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!subtypeMatchesType(r.type, r.subtype)) {
    issues.push({
      path: "subtype",
      message: `Art ${r.subtype} passt nicht zu ${r.type} (erlaubt: ${subtypesFor(r.type).join(", ")})`,
    });
  }

  const start = asFuzzyDate(r.startDate);
  const end = asFuzzyDate(r.endDate);
  for (const [key, f] of [
    ["startDate", start],
    ["endDate", end],
  ] as const) {
    if (!f) continue;
    issues.push(
      ...singleDateIssues(
        key,
        f,
        { tooEarly: `Jahr vor ${MIN_YEAR} ist nicht plausibel`, future: "Datum liegt zu weit in der Zukunft" },
        now.getTime() + FUTURE_TOLERANCE_MS,
      ),
    );
  }

  if (start && end && certainlyBefore(end, start)) {
    issues.push({ path: "endDate", message: "Ende liegt vor dem Beginn" });
  }

  return issues;
}

function addIssues(ctx: z.RefinementCtx, issues: RuleIssue[]) {
  for (const issue of issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.path],
      message: issue.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Eingabeschemata
// ---------------------------------------------------------------------------

/**
 * Datumsfeld: akzeptiert alle Schreibweisen von parseFuzzyDate (1850,
 * 03.1850, 12.03.1850, März 1850, um 1850, vor 1900, nach 1723, ISO …) und
 * liefert ein FuzzyDate. Leer/null = kein Datum. Die deutsche Fehlermeldung
 * nennt Beispiele.
 */
export const fuzzyDateInput = z
  .string()
  .trim()
  .max(100)
  .optional()
  .nullable()
  .transform((v, ctx): FuzzyDate | null => {
    const r = parseFuzzyDate(v);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
      return z.NEVER;
    }
    return r.value;
  });

const optionalDate = fuzzyDateInput;

/**
 * Wortlaut eines Datums (…Phrase): wie es in der Quelle steht, wenn es sich
 * nicht strukturiert darstellen lässt. Leer = keiner.
 */
export const datePhraseInput = z
  .string()
  .trim()
  .max(MAX_DATE_PHRASE_LENGTH)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optionalPhrase = datePhraseInput;

const shortText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const personFields = z.object({
  givenName: z.string().trim().min(1, "Vorname fehlt").max(120),
  familyName: optionalText,
  birthName: optionalText,
  nickname: shortText,
  namePrefix: shortText,
  nameSuffix: shortText,
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: optionalDate,
  birthDatePhrase: optionalPhrase,
  birthPlace: optionalText,
  deathDate: optionalDate,
  deathDatePhrase: optionalPhrase,
  deathPlace: optionalText,
  deathCause: optionalText,
  notes: z
    .string()
    .trim()
    .max(20000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export const personInput = personFields.superRefine((p, ctx) =>
  addIssues(ctx, personDateIssues(p)),
);

/**
 * Teil-Update. Fehlende Felder bleiben `undefined` (= unverändert) — die
 * Datumsprüfung über beide Felder läuft im Dienst nach dem Zusammenführen mit
 * dem gespeicherten Stand.
 */
export const personPatch = personFields.partial().superRefine((p, ctx) =>
  addIssues(ctx, personDateIssues(p)),
);

/** Neue Person samt Familienzuordnung. */
export const personCreateInput = personFields
  .extend({
    familyIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .superRefine((p, ctx) => addIssues(ctx, personDateIssues(p)));

export const relationshipInput = z
  .object({
    type: z.enum(["PARENT_OF", "PARTNER_OF"]),
    // Ohne Angabe die übliche Art des Typs: leiblich bzw. verheiratet.
    subtype: z.enum(ALL_SUBTYPES).optional().nullable(),
    fromPersonId: z.string().min(1),
    toPersonId: z.string().min(1),
    startDate: optionalDate,
    startDatePhrase: optionalPhrase,
    startPlace: optionalText,
    endDate: optionalDate,
    endDatePhrase: optionalPhrase,
    endPlace: optionalText,
    notes: optionalText,
  })
  .transform((r) => ({ ...r, subtype: r.subtype ?? defaultSubtype(r.type) }))
  .superRefine((r, ctx) => {
    if (r.fromPersonId === r.toPersonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toPersonId"],
        message: "Eine Person kann keine Beziehung zu sich selbst haben",
      });
    }
    addIssues(ctx, relationshipIssues(r));
  });

/**
 * Nur Art, Zeitraum und Notiz sind änderbar — die verknüpften Personen
 * bewusst nicht. Fehlende Felder bleiben unverändert; ob die Art zum Typ
 * passt, prüft der Dienst gegen die gespeicherte Beziehung.
 */
export const relationshipPatch = z
  .object({
    subtype: z.enum(ALL_SUBTYPES),
    startDate: optionalDate,
    startDatePhrase: optionalPhrase,
    startPlace: optionalText,
    endDate: optionalDate,
    endDatePhrase: optionalPhrase,
    endPlace: optionalText,
    notes: optionalText,
  })
  .partial();

export const userInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional().nullable(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

export const userPatch = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
  status: z.enum(["INVITED", "ACTIVE", "BLOCKED"]).optional(),
});

// ---------------------------------------------------------------------------
// Quellen und Belege
// ---------------------------------------------------------------------------

export const SOURCE_KINDS = [
  "CHURCH_BOOK",
  "CIVIL_REGISTRY",
  "CENSUS",
  "GRAVESTONE",
  "FAMILY_DOCUMENT",
  "ORAL",
  "WEBSITE",
  "OTHER",
] as const;
export type SourceKindName = (typeof SOURCE_KINDS)[number];

export const CITATION_FACTS = ["NAME", "BIRTH", "DEATH", "PARTNERSHIP", "PARENTAGE", "OTHER", "EVENT"] as const;
export type CitationFactName = (typeof CITATION_FACTS)[number];

export const CITATION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type CitationConfidenceName = (typeof CITATION_CONFIDENCES)[number];

/** Welche Angaben sich an einer Person bzw. an einer Beziehung belegen lassen. */
export const PERSON_FACTS: readonly CitationFactName[] = ["NAME", "BIRTH", "DEATH", "OTHER"];
export function relationshipFacts(type: RelationTypeName): readonly CitationFactName[] {
  return type === "PARTNER_OF" ? ["PARTNERSHIP", "OTHER"] : ["PARENTAGE", "OTHER"];
}

const sourceUrl = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), {
    message: "Bitte eine vollständige Adresse mit http:// oder https:// angeben",
  });

const sourceFields = z.object({
  title: z.string().trim().min(1, "Bitte einen Titel angeben").max(300),
  kind: z.enum(SOURCE_KINDS).default("OTHER"),
  kindLabel: shortText,
  author: optionalText,
  repository: optionalText,
  callNumber: optionalText,
  url: sourceUrl,
  date: optionalDate,
  datePhrase: optionalPhrase,
  notes: z
    .string()
    .trim()
    .max(50000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  mediaId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

function sourceDateIssues(s: { date?: DateValue }): RuleIssue[] {
  const f = asFuzzyDate(s.date);
  if (!f) return [];
  return singleDateIssues(
    "date",
    f,
    { tooEarly: `Jahr vor ${MIN_YEAR} ist nicht plausibel`, future: "Datum liegt in der Zukunft" },
    Date.now(),
  );
}

export const sourceInput = sourceFields.superRefine((s, ctx) => addIssues(ctx, sourceDateIssues(s)));
export const sourcePatch = sourceFields.partial().superRefine((s, ctx) => addIssues(ctx, sourceDateIssues(s)));

const citationFields = {
  fact: z.enum(CITATION_FACTS).default("OTHER"),
  detail: optionalText,
  text: z
    .string()
    .trim()
    .max(20000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  confidence: z
    .enum(CITATION_CONFIDENCES)
    .optional()
    .nullable()
    .transform((v) => v ?? null),
};

/**
 * Beleg: genau eines von personId, relationshipId und eventId. Bei eventId
 * setzt der Dienst den Träger des Ereignisses selbst ein (fact = EVENT).
 */
export const citationInput = z
  .object({
    sourceId: z.string().trim().min(1, "Bitte eine Quelle wählen"),
    personId: z.string().trim().min(1).optional().nullable(),
    relationshipId: z.string().trim().min(1).optional().nullable(),
    eventId: z.string().trim().min(1).optional().nullable(),
    ...citationFields,
  })
  .superRefine((c, ctx) => {
    if ([c.personId, c.relationshipId, c.eventId].filter(Boolean).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["personId"],
        message: "Ein Beleg gehört zu genau einer Person, einer Beziehung oder einem Ereignis",
      });
    }
  });

export const citationPatch = z.object(citationFields).partial();

// ---------------------------------------------------------------------------
// KI-Zugang (MCP)
// ---------------------------------------------------------------------------

export const AI_ACCESS_LEVELS = ["NONE", "READ", "WRITE"] as const;
export type AiAccessName = (typeof AI_ACCESS_LEVELS)[number];

export const API_TOKEN_LEVELS = ["READ", "WRITE"] as const;
export type ApiTokenLevelName = (typeof API_TOKEN_LEVELS)[number];

/** Höchstzahl gleichzeitig aktiver Schlüssel je Benutzer. */
export const MAX_ACTIVE_API_TOKENS = 10;
/** Gültigkeit neuer Schlüssel in Tagen: Standard und Höchstwert. */
export const API_TOKEN_DEFAULT_DAYS = 90;
export const API_TOKEN_MAX_DAYS = 365;

/** Admin: KI-Recht eines Benutzers setzen. */
export const aiAccessInput = z.object({
  aiAccess: z.enum(AI_ACCESS_LEVELS),
});

/** Benutzer: neuen Schlüssel anlegen. */
export const apiTokenCreateInput = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben").max(80, "Höchstens 80 Zeichen"),
  level: z.enum(API_TOKEN_LEVELS),
  expiresInDays: z
    .number()
    .int("Ganze Tage angeben")
    .min(1, "Mindestens 1 Tag")
    .max(API_TOKEN_MAX_DAYS, `Höchstens ${API_TOKEN_MAX_DAYS} Tage`)
    .optional(),
});

// ---------------------------------------------------------------------------
// Lebensereignisse und Namen
// ---------------------------------------------------------------------------

const eventFields = {
  type: z.enum(EVENT_TYPES),
  label: shortText,
  isAlternative: z.boolean().default(false),
  date: optionalDate,
  datePhrase: optionalPhrase,
  place: optionalText,
  address: optionalText,
  value: optionalText,
  cause: optionalText,
  age: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  agency: optionalText,
  notes: z
    .string()
    .trim()
    .max(20000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
};

/** Datum eines Ereignisses: plausibel, nicht sicher in der Zukunft. */
export function eventDateIssues(e: { date?: DateValue }, now: Date = new Date()): RuleIssue[] {
  const f = asFuzzyDate(e.date);
  if (!f) return [];
  return singleDateIssues(
    "date",
    f,
    { tooEarly: `Jahr vor ${MIN_YEAR} ist nicht plausibel`, future: "Datum liegt zu weit in der Zukunft" },
    now.getTime() + FUTURE_TOLERANCE_MS,
  );
}

/** Neues Ereignis: an genau einer Person oder Beziehung. Art-Regeln: lib/events.ts (im Dienst). */
export const eventInput = z
  .object({
    personId: z.string().trim().min(1).optional().nullable(),
    relationshipId: z.string().trim().min(1).optional().nullable(),
    ...eventFields,
  })
  .superRefine((e, ctx) => {
    if (Boolean(e.personId) === Boolean(e.relationshipId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["personId"],
        message: "Ein Ereignis gehört zu genau einer Person oder genau einer Beziehung",
      });
    }
    addIssues(ctx, eventDateIssues(e));
  });

/** Teil-Update; der Träger ist fest. Ohne Standardwerte, damit Fehlendes unverändert bleibt. */
export const eventPatch = z
  .object({
    ...eventFields,
    isAlternative: z.boolean(),
    sortOrder: z.number().int().min(-100000).max(100000),
  })
  .partial()
  .superRefine((e, ctx) => addIssues(ctx, eventDateIssues(e)));

const personNameFields = {
  type: z.enum(PERSON_NAME_TYPES).default("OTHER"),
  givenName: shortText,
  familyName: shortText,
  prefix: shortText,
  suffix: shortText,
  nickname: shortText,
  label: shortText,
  notes: optionalText,
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
};

const nameNotEmpty = (n: { givenName?: string | null; familyName?: string | null; nickname?: string | null }) =>
  Boolean(n.givenName || n.familyName || n.nickname);

export const personNameInput = z
  .object({ personId: z.string().trim().min(1), ...personNameFields })
  .refine(nameNotEmpty, { message: "Bitte mindestens Vorname, Nachname oder Rufname angeben", path: ["givenName"] });

export const personNamePatch = z
  .object({
    ...personNameFields,
    type: z.enum(PERSON_NAME_TYPES),
    sortOrder: z.number().int().min(-100000).max(100000),
  })
  .partial();
