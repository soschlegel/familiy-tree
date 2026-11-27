import { prisma } from "../prisma";
import { buildBiography, type Biography } from "../biography";
import { biographyInputOf, type ParentEdge } from "../biography-input";
import { calendarDayIn } from "../today";
import type { PersonDetail } from "./persons";

/**
 * Lebenslauf der Personenseite (lib/biography.ts). Grundlage sind die Daten,
 * die die Personenseite ohnehin lädt (getPersonDetail — dort stecken die
 * Rechte: nicht sichtbare Verwandte sind Platzhalter ohne Angaben). Dazu
 * kommt höchstens EINE Abfrage der Eltern-Kind-Kanten: Kinder der beiden
 * leiblichen Eltern (Stellung unter den Geschwistern) und Eltern der Kinder
 * (Zuordnung zur Partnerschaft). Die Kanten liefern nur Kennungen; genannt
 * wird ausschließlich, wer sichtbar ist (lib/biography-input.ts).
 */
export async function getPersonBiography(detail: PersonDetail, now: Date = new Date()): Promise<Biography | null> {
  const parentIds = detail.parents.filter((r) => r.subtype === "BIOLOGICAL" && !r.other.restricted).map((r) => r.other.id);
  const childIds = detail.children.filter((r) => !r.other.restricted).map((r) => r.other.id);
  const or = [
    ...(parentIds.length === 2 ? [{ fromPersonId: { in: parentIds } }] : []),
    ...(childIds.length > 0 && detail.partners.some((r) => !r.other.restricted) ? [{ toPersonId: { in: childIds } }] : []),
  ];
  const edges: ParentEdge[] =
    or.length === 0
      ? []
      : (
          await prisma.relationship.findMany({
            where: { type: "PARENT_OF", OR: or },
            select: { fromPersonId: true, toPersonId: true, subtype: true },
          })
        ).map((e) => ({ from: e.fromPersonId, to: e.toPersonId, subtype: e.subtype }));
  return buildBiography(biographyInputOf(detail, edges, calendarDayIn(now)));
}
