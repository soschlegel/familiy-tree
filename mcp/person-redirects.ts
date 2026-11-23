/**
 * Alte Personen-Kennungen im KI-Zugang: Ist eine Person in einer anderen
 * aufgegangen (Zusammenführen in der Web-App), löst jedes Werkzeug die alte
 * Kennung still auf die bleibende Person auf und meldet das im Ergebnis als
 * `resolvedFrom` (alte → heutige Kennung). So bleibt eine Kennung brauchbar,
 * die sich die KI aus einem früheren Gespräch gemerkt hat.
 *
 * Aufgelöst wird nur, wenn der Benutzer die bleibende Person sehen darf
 * (lib/services/redirects.ts) — sonst bleibt es bei „nicht gefunden“. Nur
 * Personen: Kennungen aufgegangener Beziehungen und Ereignisse nicht.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Scope } from "../lib/scope";
import { resolvePersonRedirects } from "../lib/services/redirects";

/** Eingaben, die eine Personen-Kennung tragen. */
const SINGLE_KEYS = ["person_id", "other_person_id", "from_person_id", "to_person_id"] as const;
/** Eingaben mit einer Liste von Personen-Kennungen. */
const LIST_KEYS = ["person_ids"] as const;

export const resolvedFromOutput = z
  .record(z.string())
  .optional()
  .describe(
    "Present only if a given person ID was outdated: the person was merged into another one. Maps the old ID to the current ID. The result refers to the current person — use the current ID from now on.",
  );

/**
 * Personen-Kennungen in den Eingaben eines Werkzeugs auflösen. Liefert die
 * (ggf. kopierten) Eingaben und, falls etwas aufgelöst wurde, die Zuordnung.
 */
export async function resolvePersonArgs<A>(scope: Scope, args: A): Promise<{ args: A; resolvedFrom: Record<string, string> | null }> {
  if (!args || typeof args !== "object") return { args, resolvedFrom: null };
  const input = args as Record<string, unknown>;
  const ids: unknown[] = [];
  for (const k of SINGLE_KEYS) if (typeof input[k] === "string") ids.push(input[k]);
  for (const k of LIST_KEYS) if (Array.isArray(input[k])) ids.push(...(input[k] as unknown[]));
  if (ids.length === 0) return { args, resolvedFrom: null };
  const map = await resolvePersonRedirects(scope, ids);
  if (map.size === 0) return { args, resolvedFrom: null };
  const next: Record<string, unknown> = { ...input };
  const swap = (v: unknown) => (typeof v === "string" ? (map.get(v) ?? v) : v);
  for (const k of SINGLE_KEYS) if (k in next) next[k] = swap(next[k]);
  for (const k of LIST_KEYS) if (Array.isArray(next[k])) next[k] = [...new Set((next[k] as unknown[]).map(swap))];
  return { args: next as A, resolvedFrom: Object.fromEntries(map) };
}

/**
 * Hülle um den Server: Jedes Werkzeug mit einer Personen-Kennung in der
 * Eingabe bekommt `resolvedFrom` in sein Ausgabeschema — Clients prüfen das
 * Ergebnis gegen das Schema und wiesen das Feld sonst zurück.
 */
export function withResolvedFrom(server: McpServer): McpServer {
  const wrapped = Object.create(server) as McpServer;
  const hasPersonInput = (shape: unknown) =>
    Boolean(shape) && typeof shape === "object" && [...SINGLE_KEYS, ...LIST_KEYS].some((k) => k in (shape as Record<string, unknown>));
  wrapped.registerTool = ((name: string, config: { inputSchema?: unknown; outputSchema?: Record<string, unknown> }, cb: unknown) =>
    (server.registerTool as (...a: unknown[]) => unknown)(
      name,
      config.outputSchema && hasPersonInput(config.inputSchema) ? { ...config, outputSchema: { ...config.outputSchema, resolvedFrom: resolvedFromOutput } } : config,
      cb,
    )) as McpServer["registerTool"];
  return wrapped;
}
