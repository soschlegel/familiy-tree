import { z } from "zod";

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

const year = (d: Date) => d.getUTCFullYear();

/**
 * Prüft Lebensdaten einer Person. Wird sowohl beim Anlegen als auch nach dem
 * Zusammenführen eines Teil-Updates mit dem gespeicherten Stand aufgerufen —
 * sonst ließe sich ein Sterbedatum vor dem Geburtsdatum in zwei Schritten
 * eintragen.
 */
export function personDateIssues(
  p: { birthDate?: Date | null; deathDate?: Date | null },
  now: Date = new Date(),
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { birthDate, deathDate } = p;

  if (birthDate) {
    if (year(birthDate) < MIN_YEAR) {
      issues.push({
        path: "birthDate",
        message: `Geburtsjahr vor ${MIN_YEAR} ist nicht plausibel`,
      });
    }
    if (birthDate.getTime() > now.getTime()) {
      issues.push({
        path: "birthDate",
        message: "Geburtsdatum liegt in der Zukunft",
      });
    }
  }

  if (deathDate) {
    if (year(deathDate) < MIN_YEAR) {
      issues.push({
        path: "deathDate",
        message: `Sterbejahr vor ${MIN_YEAR} ist nicht plausibel`,
      });
    }
    if (deathDate.getTime() > now.getTime()) {
      issues.push({
        path: "deathDate",
        message: "Sterbedatum liegt in der Zukunft",
      });
    }
  }

  if (birthDate && deathDate && deathDate.getTime() < birthDate.getTime()) {
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
    startDate?: Date | null;
    endDate?: Date | null;
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

  for (const key of ["startDate", "endDate"] as const) {
    const d = r[key];
    if (!d) continue;
    if (year(d) < MIN_YEAR) {
      issues.push({ path: key, message: `Jahr vor ${MIN_YEAR} ist nicht plausibel` });
    }
    if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      issues.push({ path: key, message: "Datum liegt zu weit in der Zukunft" });
    }
  }

  if (
    r.startDate &&
    r.endDate &&
    r.endDate.getTime() < r.startDate.getTime()
  ) {
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

const optionalDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), {
    message: "Ungültiges Datum",
  });

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
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: optionalDate,
  birthPlace: optionalText,
  deathDate: optionalDate,
  deathPlace: optionalText,
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
    endDate: optionalDate,
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
    endDate: optionalDate,
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
