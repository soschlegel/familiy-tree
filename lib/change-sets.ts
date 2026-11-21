import { prisma } from "./prisma";
import type { Scope } from "./scope";

/**
 * Changelog-Pakete (ChangeSet): zusammengehörige Änderungen unter einem Titel.
 *
 * - Web-App: jede API-Anfrage bekommt in lib/api.ts ein eigenes Paket
 *   (`appChangeSet`). Dienste, die eine größere Aktion ausführen (Import,
 *   Zusammenführen, Sammel-Zusammenführen, Importe verbinden), geben ihm mit
 *   `nameChangeSet` einen sprechenden Titel; sonst ergibt sich der Titel aus
 *   dem ersten Eintrag („Person geändert“).
 * - KI-Zugang (MCP): `begin_change_set` legt ein Paket mit Titel an;
 *   schreibende Werkzeuge nehmen optional `change_set_id`. Ohne Kennung hängt
 *   der Server an das zuletzt benutzte Paket desselben Benutzers und
 *   Schlüssels an, wenn dessen letzte Änderung höchstens MCP_BUNDLE_WINDOW_MS
 *   zurückliegt, sonst beginnt ein neues („KI-Änderungen über …“).
 *
 * Angelegt wird ein Paket erst mit dem ersten Audit-Eintrag (lib/audit.ts) —
 * lesende Anfragen hinterlassen nichts.
 */

export type ChangeSetKind = "APP" | "IMPORT" | "MERGE" | "CONNECT" | "MCP" | "MCP_AUTO";

export type ChangeSetHandle = {
  kind: ChangeSetKind;
  /** Titel; ohne Angabe aus dem ersten Eintrag. */
  title?: string;
  /** Titel steht fest (vom KI-Assistenten gewählt) — nameChangeSet ändert ihn nicht. */
  fixed?: boolean;
  /** Schon bekannte Kennung (MCP mit change_set_id). */
  id?: string;
  /** Ergebnis der (einmaligen) Auflösung. */
  pending?: Promise<string | null>;
};

/** Zeitfenster, in dem MCP-Änderungen ohne Kennung zusammengefasst werden. */
export const MCP_BUNDLE_WINDOW_MS = 30 * 60_000;
/** Ein mit begin_change_set geöffnetes Paket nimmt so lange Änderungen an. */
export const MCP_CHANGE_SET_MAX_AGE_MS = 24 * 60 * 60_000;
export const CHANGE_SET_TITLE_MAX = 200;

export function appChangeSet(): ChangeSetHandle {
  return { kind: "APP" };
}

/**
 * Gibt dem Paket des Aufrufs einen Titel (und eine Art), solange es noch
 * nicht angelegt ist und der Titel nicht feststeht. Der erste Aufruf gewinnt:
 * Das Sammel-Zusammenführen benennt sein Paket, bevor die einzelnen
 * Zusammenführungen es versuchen.
 */
export function nameChangeSet(scope: Pick<Scope, "changeSet">, title: string, kind?: ChangeSetKind): void {
  const h = scope.changeSet;
  if (!h || h.fixed || h.title || h.pending || h.id) return;
  h.title = title.slice(0, CHANGE_SET_TITLE_MAX);
  if (kind && h.kind === "APP") h.kind = kind;
}

type Actor = { userId?: string | null; channel?: "MCP" | null; apiTokenId?: string | null };

async function tokenName(apiTokenId: string | null | undefined): Promise<string | null> {
  if (!apiTokenId) return null;
  const t = await prisma.apiToken.findUnique({ where: { id: apiTokenId }, select: { name: true } });
  return t?.name ?? null;
}

/**
 * Kennung des Pakets — legt es beim ersten Aufruf an (bzw. findet bei MCP
 * ohne Kennung das laufende). Fehler führen zu null: Ein kaputtes Paket darf
 * die eigentliche Änderung nicht verhindern (wie das Audit selbst).
 */
export function resolveChangeSetId(handle: ChangeSetHandle, actor: Actor, fallbackTitle: string): Promise<string | null> {
  handle.pending ??= (async () => {
    try {
      const now = new Date();
      if (handle.id) {
        await prisma.changeSet.update({ where: { id: handle.id }, data: { lastActivityAt: now } });
        return handle.id;
      }
      if (handle.kind === "MCP_AUTO" && actor.userId) {
        const recent = await prisma.changeSet.findFirst({
          where: {
            userId: actor.userId,
            kind: { in: ["MCP", "MCP_AUTO"] },
            channel: "MCP",
            apiTokenId: actor.apiTokenId ?? null,
            lastActivityAt: { gte: new Date(now.getTime() - MCP_BUNDLE_WINDOW_MS) },
            // begin_change_set-Pakete nur innerhalb ihrer Gültigkeit
            createdAt: { gte: new Date(now.getTime() - MCP_CHANGE_SET_MAX_AGE_MS) },
          },
          orderBy: { lastActivityAt: "desc" },
          select: { id: true },
        });
        if (recent) {
          await prisma.changeSet.update({ where: { id: recent.id }, data: { lastActivityAt: now } });
          handle.id = recent.id;
          return recent.id;
        }
      }
      let title = handle.title;
      if (!title && handle.kind === "MCP_AUTO") {
        const name = await tokenName(actor.apiTokenId);
        title = name ? `KI-Änderungen über „${name}“` : "KI-Änderungen";
      }
      const row = await prisma.changeSet.create({
        data: {
          title: (title ?? fallbackTitle).slice(0, CHANGE_SET_TITLE_MAX),
          kind: handle.kind,
          userId: actor.userId ?? null,
          channel: actor.channel ?? null,
          apiTokenId: actor.apiTokenId ?? null,
          createdAt: now,
          lastActivityAt: now,
        },
        select: { id: true },
      });
      handle.id = row.id;
      return row.id;
    } catch (err) {
      console.error("[changelog] Paket konnte nicht angelegt werden:", err);
      return null;
    }
  })();
  return handle.pending;
}

/** Paket eines Scopes auflösen (für Dienste, die selbst in eine Transaktion schreiben). */
export function changeSetIdOf(scope: Pick<Scope, "changeSet" | "userId" | "via">, fallbackTitle: string): Promise<string | null> {
  if (!scope.changeSet) return Promise.resolve(null);
  return resolveChangeSetId(
    scope.changeSet,
    { userId: scope.userId, channel: scope.via?.channel ?? null, apiTokenId: scope.via?.tokenId ?? null },
    fallbackTitle,
  );
}

// ---------------------------------------------------------------------------
// KI-Zugang
// ---------------------------------------------------------------------------

export type McpChangeSetResult =
  | { ok: true; handle: ChangeSetHandle }
  | { ok: false; message: string };

/**
 * Paket für einen schreibenden MCP-Aufruf. Mit Kennung: Sie muss zu einem
 * Paket dieses Benutzers aus dem KI-Zugang gehören und darf nicht älter als
 * MCP_CHANGE_SET_MAX_AGE_MS sein — sonst wird der Aufruf abgelehnt, bevor
 * etwas geändert ist. Ohne Kennung: automatisches Bündeln (siehe oben).
 */
export async function mcpChangeSet(
  scope: Pick<Scope, "userId" | "via">,
  requestedId: string | null | undefined,
  now = new Date(),
): Promise<McpChangeSetResult> {
  if (!requestedId) return { ok: true, handle: { kind: "MCP_AUTO" } };
  const row = await prisma.changeSet.findUnique({
    where: { id: requestedId },
    select: { id: true, title: true, userId: true, channel: true, createdAt: true },
  });
  if (!row || row.userId !== scope.userId || row.channel !== "MCP") {
    return { ok: false, message: "Unbekanntes Änderungspaket (change_set_id). Mit begin_change_set ein neues öffnen." };
  }
  if (now.getTime() - row.createdAt.getTime() > MCP_CHANGE_SET_MAX_AGE_MS) {
    return { ok: false, message: "Dieses Änderungspaket ist älter als 24 Stunden. Mit begin_change_set ein neues öffnen." };
  }
  return { ok: true, handle: { kind: "MCP", id: row.id, title: row.title, fixed: true } };
}

/** Neues Paket über den KI-Zugang (Werkzeug begin_change_set). */
export async function beginMcpChangeSet(
  scope: Pick<Scope, "userId" | "via">,
  title: string,
): Promise<{ id: string; title: string; createdAt: Date }> {
  const clean = title.trim().replace(/\s+/g, " ").slice(0, CHANGE_SET_TITLE_MAX);
  return prisma.changeSet.create({
    data: {
      title: clean,
      kind: "MCP",
      userId: scope.userId,
      channel: scope.via?.channel ?? "MCP",
      apiTokenId: scope.via?.tokenId ?? null,
    },
    select: { id: true, title: true, createdAt: true },
  });
}
