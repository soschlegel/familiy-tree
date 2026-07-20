import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";

/**
 * Liefert den kompletten Graphen. Bei der Zielgröße (<200 Personen) sind das
 * wenige hundert KB — der Client hält ihn im Speicher und rendert alle
 * Ansichten daraus, ohne weitere Roundtrips. Sollte der Bestand deutlich
 * wachsen, wird hier auf eine fokusbasierte Teilgraph-Abfrage umgestellt.
 */
export const GET = route("person:read", async () => {
  const [persons, relationships] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      include: {
        media: {
          where: { isPrimary: true },
          take: 1,
          select: { mediaId: true },
        },
      },
    }),
    prisma.relationship.findMany({
      include: {
        media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      },
    }),
  ]);

  return NextResponse.json({
    persons: persons.map(({ media, ...p }) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      gender: p.gender,
      birthDate: p.birthDate,
      deathDate: p.deathDate,
      primaryMediaId: media[0]?.mediaId ?? null,
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
      startDate: r.startDate,
      endDate: r.endDate,
      primaryMediaId: r.media[0]?.mediaId ?? null,
    })),
  });
});
