import { prisma } from "../prisma";
import { type Release } from "../release-notes";
import type { Scope } from "../scope";
import { ServiceError } from "./errors";

/**
 * Neuigkeiten (Versions-Changelog, docs/entwicklung/neuigkeiten.md): merkt sich je
 * Benutzer das zuletzt gesehene Release. Immer nur für den angemeldeten
 * Benutzer selbst (`scope.userId`) — eine fremde Kennung gibt es hier nicht.
 *
 * Die bekannten Releases übergibt der Aufrufer (`releaseNotes()` aus
 * lib/release-notes-data.ts), damit die Dienstschicht ohne den
 * Build-Zeit-Import der Datei auskommt.
 *
 * Kein Eintrag im Änderungsprotokoll: das ist kein Datenstand, sondern eine
 * Lesemarke wie „zuletzt angemeldet“.
 */
export async function markReleaseSeen(
  scope: Pick<Scope, "userId">,
  releaseId: string,
  known: Release[],
): Promise<{ lastSeenReleaseId: string }> {
  if (!known.some((r) => r.id === releaseId)) {
    throw new ServiceError("VALIDATION", "Unbekannte Release-Kennung", {
      issues: [{ path: ["releaseId"], message: "Unbekannte Release-Kennung" }],
    });
  }
  await prisma.user.update({ where: { id: scope.userId }, data: { lastSeenReleaseId: releaseId } });
  return { lastSeenReleaseId: releaseId };
}
