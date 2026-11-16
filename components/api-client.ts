/**
 * Kleine Hilfe für Aufrufe der eigenen API aus Client-Komponenten.
 *
 * Die API antwortet bei Fehlern mit `{ error, issues? }`. Hier wird daraus
 * eine deutsche Meldung für die Anzeige neben der Aktion und — bei
 * Validierungsfehlern — eine Zuordnung Feld → Meldung, damit Formulare den
 * Hinweis direkt am betroffenen Feld zeigen können. Netzwerkfehler (Server
 * nicht erreichbar) werden ebenfalls abgefangen, statt als unbehandelte
 * Promise-Ablehnung zu verschwinden.
 */

export type ApiFailure = {
  ok: false;
  status: number;
  message: string;
  /** Feldname (erstes Pfadelement) → Meldung. */
  fields: Record<string, string>;
  body: Record<string, unknown>;
};

export type ApiSuccess<T> = { ok: true; status: number; data: T };

const STATUS_MESSAGE: Record<number, string> = {
  401: "Du bist nicht mehr angemeldet. Bitte die Seite neu laden und erneut anmelden.",
  403: "Dafür fehlt dir die Berechtigung.",
  404: "Der Eintrag wurde nicht gefunden — vielleicht wurde er inzwischen gelöscht.",
  409: "Die Änderung steht im Konflikt mit vorhandenen Daten.",
  413: "Die Datei ist zu groß.",
};

export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<ApiSuccess<T> | ApiFailure> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return {
      ok: false,
      status: 0,
      message: "Keine Verbindung zum Server. Bitte später erneut versuchen.",
      fields: {},
      body: {},
    };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => null)) as T;
    return { ok: true, status: res.status, data };
  }

  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues as { path?: unknown; message?: unknown }[]) {
      const path = Array.isArray(issue.path) ? issue.path : [issue.path];
      const key = String(path[0] ?? "");
      if (key && !fields[key] && typeof issue.message === "string") {
        fields[key] = issue.message;
      }
    }
  }

  const message =
    typeof body.error === "string" && body.error
      ? body.error
      : (STATUS_MESSAGE[res.status] ?? `Unerwarteter Fehler (${res.status}).`);

  return { ok: false, status: res.status, message, fields, body };
}

/** JSON-Body samt Header — spart die Wiederholung an jeder Aufrufstelle. */
export function jsonBody(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}
