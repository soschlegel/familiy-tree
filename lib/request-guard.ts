/**
 * Prüfungen an einer Anfrage, bevor ein Route-Handler arbeitet: Herkunft
 * schreibender Anfragen (CSRF) und Größe des Anfragekörpers. Rein (kein
 * next/*, keine Datenbank), damit die Regeln direkt testbar sind; angewendet
 * in `route()` (lib/api.ts).
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Stammt eine schreibende Anfrage von einer fremden Webseite?
 *
 * Die Sitzung hängt an einem Cookie (SameSite=Lax). Das hält fremde Seiten
 * schon weitgehend ab; als zweite Sicherung wird die Herkunft geprüft, die
 * der Browser selbst mitschickt und die eine Webseite nicht fälschen kann:
 *
 * - `Sec-Fetch-Site: cross-site` → fremd.
 * - `Origin` vorhanden → muss die eigene Adresse sein: die Adresse, unter
 *   der die Anfrage ankam (`Host` bzw. `X-Forwarded-Host` des Reverse-Proxys)
 *   oder `AUTH_URL`. Verglichen wird nur der Rechnername samt Port — hinter
 *   einem Proxy, der TLS beendet, sieht die App http statt https.
 * - Weder noch (kein Browser: curl, Skripte, Tests) → erlaubt. Ohne Browser
 *   gibt es kein CSRF; die Anmeldung wird ohnehin geprüft.
 *
 * Lesende Methoden ändern nichts und werden nicht geprüft.
 */
export function isCrossSiteWrite(req: { method: string; headers: Headers }, authUrl = process.env.AUTH_URL): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const h = req.headers;
  if ((h.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") return true;
  const origin = h.get("origin");
  if (origin === null) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // „null“ (sandboxed iframe, data:-Seite) oder Unsinn
  }
  const own = new Set<string>();
  for (const name of ["x-forwarded-host", "host"]) {
    // Bei mehreren Proxys ist der Wert eine Liste; jeder Eintrag zählt.
    for (const part of (h.get(name) ?? "").split(",")) {
      const v = part.trim().toLowerCase();
      if (v) own.add(v);
    }
  }
  const auth = originOf(authUrl);
  if (auth) own.add(new URL(auth).host.toLowerCase());
  return !own.has(originHost);
}

const MIB = 1024 * 1024;

/** Größter JSON-Körper gewöhnlicher Routen. */
export const MAX_JSON_BODY_BYTES = 2 * MIB;
/** Importe: Datei bis 200 MB (MAX_IMPORT_FILE_BYTES) plus Formularrahmen; Entscheidungslisten. */
export const MAX_IMPORT_BODY_BYTES = 201 * MIB;

function uploadLimit(): number {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * MIB);
  return Number.isFinite(max) && max > 0 ? max : 15 * MIB;
}

/** Erlaubte Größe des Anfragekörpers je Pfad. */
export function bodyLimitFor(pathname: string): number {
  if (pathname === "/api/media") return uploadLimit() + MIB;
  if (pathname === "/api/import" || pathname.startsWith("/api/import/")) return MAX_IMPORT_BODY_BYTES;
  return MAX_JSON_BODY_BYTES;
}

/**
 * Ist der Anfragekörper laut `Content-Length` zu groß — oder kommt er ohne
 * Längenangabe (chunked)? Geprüft wird VOR dem Lesen: `req.json()` und
 * `req.formData()` laden sonst alles in den Speicher, und die fachliche
 * Größenprüfung (15 MB je Bild) käme erst danach. Browser und der
 * Reverse-Proxy schicken die Länge immer mit.
 */
export function bodyTooLarge(req: { method: string; headers: Headers }, pathname: string): "too-large" | "length-required" | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  const raw = req.headers.get("content-length");
  if (raw === null) {
    return req.headers.has("transfer-encoding") ? "length-required" : null;
  }
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) return "length-required";
  return length > bodyLimitFor(pathname) ? "too-large" : null;
}
