import { z } from "zod";

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

export const personInput = z.object({
  givenName: z.string().trim().min(1, "Vorname fehlt").max(120),
  familyName: optionalText,
  birthName: optionalText,
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  birthDate: optionalDate,
  birthPlace: optionalText,
  deathDate: optionalDate,
  deathPlace: optionalText,
  notes: optionalText,
});

export const relationshipInput = z
  .object({
    type: z.enum(["PARENT_OF", "PARTNER_OF"]),
    subtype: z
      .enum([
        "BIOLOGICAL",
        "ADOPTIVE",
        "STEP",
        "FOSTER",
        "MARRIED",
        "UNMARRIED",
        "DIVORCED",
      ])
      .default("BIOLOGICAL"),
    fromPersonId: z.string().min(1),
    toPersonId: z.string().min(1),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .refine((r) => r.fromPersonId !== r.toPersonId, {
    message: "Eine Person kann keine Beziehung zu sich selbst haben",
  });

// Nur Art und Zeitraum sind änderbar — die verknüpften Personen bewusst nicht.
export const relationshipPatch = z.object({
  subtype: z
    .enum([
      "BIOLOGICAL",
      "ADOPTIVE",
      "STEP",
      "FOSTER",
      "MARRIED",
      "UNMARRIED",
      "DIVORCED",
    ])
    .optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

export const userInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional().nullable(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

export const userPatch = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
  status: z.enum(["INVITED", "ACTIVE", "BLOCKED"]).optional(),
});
