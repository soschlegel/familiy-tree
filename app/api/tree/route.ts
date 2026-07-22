import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { canViewPerson, maskPerson } from "@/lib/scope";

/**
 * Liefert den kompletten Graphen — allerdings nur die Personen, die der
 * Benutzer sehen darf. Alle übrigen erscheinen als anonymer Platzhalter:
 * dadurch bleibt der Baum zusammenhängend und Kinder stehen nicht ohne
 * sichtbare Eltern da, während Name, Daten und Bilder verborgen bleiben.
 *
 * Die Beziehungsstruktur selbst wird nicht verschleiert — dass an einer Stelle
 * jemand steht, ist am Platzhalter ohnehin ablesbar.
 */
export const GET = route(null, async (ctx) => {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
        families: { select: { familyId: true } },
      },
    }),
    prisma.relationship.findMany({
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
  ]);

  const visible = new Set<string>();

  const mapped = persons.map((p) => {
    const familyIds = p.families.map((f) => f.familyId);
    if (!canViewPerson(ctx.scope, familyIds)) return maskPerson(p.id);

    visible.add(p.id);
    return {
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: p.birthDate,
      deathDate: p.deathDate,
      primaryMediaId: p.media[0]?.mediaId ?? null,
      restricted: false as const,
      familyIds,
    };
  });

  return NextResponse.json({
    persons: mapped,
    relationships: relationships.map((r) => {
      // Datum und Hochzeitsbild nur zeigen, wenn wenigstens eine der beiden
      // beteiligten Personen sichtbar ist — sonst wäre das eine Aussage über
      // zwei Menschen, die der Benutzer nicht kennen soll.
      const anyVisible =
        visible.has(r.fromPersonId) || visible.has(r.toPersonId);

      return {
        id: r.id,
        type: r.type,
        subtype: anyVisible ? r.subtype : "BIOLOGICAL",
        fromPersonId: r.fromPersonId,
        toPersonId: r.toPersonId,
        startDate: anyVisible ? r.startDate : null,
        endDate: anyVisible ? r.endDate : null,
        primaryMediaId: anyVisible ? (r.media[0]?.mediaId ?? null) : null,
      };
    }),
  });
});
