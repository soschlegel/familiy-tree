/**
 * Fehler der Dienstschicht. Bewusst ohne Bezug zu HTTP-Objekten: die
 * Route-Handler übersetzen sie in lib/api.ts in Statuscodes, ein anderer
 * Aufrufer (z.B. ein MCP-Server) in seine eigene Fehlerdarstellung.
 *
 * NOT_FOUND gilt auch für Personen, die der Benutzer nicht sehen darf — ein
 * eigener Code würde ihre Existenz bestätigen.
 */
export type ServiceErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "VALIDATION";

export type ServiceIssue = { path: (string | number)[]; message: string };

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly issues?: ServiceIssue[];
  readonly details?: Record<string, unknown>;

  constructor(
    code: ServiceErrorCode,
    message: string,
    extra: { issues?: ServiceIssue[]; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.issues = extra.issues;
    this.details = extra.details;
  }
}

export const notFoundError = (what = "Eintrag") =>
  new ServiceError("NOT_FOUND", `${what} nicht gefunden`);

export const forbiddenError = (what: string) =>
  new ServiceError("FORBIDDEN", `Keine Berechtigung für: ${what}`);

export const conflictError = (
  message: string,
  details?: Record<string, unknown>,
) => new ServiceError("CONFLICT", message, { details });

export function validationError(
  issues: { path: (string | number)[] | string; message: string }[],
): ServiceError {
  const normalized = issues.map((i) => ({
    path: typeof i.path === "string" ? [i.path] : i.path,
    message: i.message,
  }));
  const first = normalized[0];
  return new ServiceError(
    "VALIDATION",
    first ? `Validierung fehlgeschlagen: ${first.message}` : "Validierung fehlgeschlagen",
    { issues: normalized },
  );
}

/** Zod-Ergebnis auspacken oder einen VALIDATION-Fehler werfen. */
export function parseOrThrow<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } },
): T {
  if (result.success) return result.data;
  throw validationError(result.error.issues);
}
