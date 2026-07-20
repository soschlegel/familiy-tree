import { PrismaClient, Gender } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();

  if (!adminEmail) {
    console.warn(
      "[seed] INITIAL_ADMIN_EMAIL nicht gesetzt — kein Admin angelegt.",
    );
  } else {
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: "ADMIN" },
      create: { email: adminEmail, role: "ADMIN", status: "INVITED" },
    });
    console.log(`[seed] Admin bereit: ${admin.email}`);
  }

  if (process.env.SEED_DEMO !== "true") {
    console.log("[seed] SEED_DEMO != true — keine Demodaten.");
    return;
  }

  const existing = await prisma.person.count();
  if (existing > 0) {
    console.log(`[seed] ${existing} Personen vorhanden — Demodaten übersprungen.`);
    return;
  }

  // Kleine Beispielfamilie über drei Generationen, damit die Baumansicht
  // direkt nach dem ersten Start etwas anzeigt.
  const mk = (
    givenName: string,
    familyName: string,
    gender: Gender,
    birthYear: number,
    deathYear?: number,
  ) =>
    prisma.person.create({
      data: {
        givenName,
        familyName,
        gender,
        birthDate: new Date(Date.UTC(birthYear, 5, 15)),
        deathDate: deathYear ? new Date(Date.UTC(deathYear, 2, 3)) : null,
        birthPlace: "Hannover",
      },
    });

  const opa = await mk("Gustav", "Lindner", "MALE", 1928, 2005);
  const oma = await mk("Hilde", "Lindner", "FEMALE", 1931, 2012);
  const vater = await mk("Ernst", "Lindner", "MALE", 1957);
  const mutter = await mk("Renate", "Lindner", "FEMALE", 1959);
  const onkel = await mk("Klaus", "Lindner", "MALE", 1961);
  const kind1 = await mk("Jonas", "Lindner", "MALE", 1987);
  const kind2 = await mk("Lena", "Lindner", "FEMALE", 1990);

  const partner = (a: string, b: string, year: number) =>
    prisma.relationship.create({
      data: {
        type: "PARTNER_OF",
        subtype: "MARRIED",
        // Kanonische Reihenfolge, damit die Beziehung nur einmal existiert.
        fromPersonId: a < b ? a : b,
        toPersonId: a < b ? b : a,
        startDate: new Date(Date.UTC(year, 7, 1)),
      },
    });

  const child = (parentId: string, childId: string) =>
    prisma.relationship.create({
      data: {
        type: "PARENT_OF",
        subtype: "BIOLOGICAL",
        fromPersonId: parentId,
        toPersonId: childId,
      },
    });

  await partner(opa.id, oma.id, 1954);
  await partner(vater.id, mutter.id, 1984);

  for (const kid of [vater, onkel]) {
    await child(opa.id, kid.id);
    await child(oma.id, kid.id);
  }

  for (const kid of [kind1, kind2]) {
    await child(vater.id, kid.id);
    await child(mutter.id, kid.id);
  }

  console.log("[seed] Demofamilie angelegt (7 Personen).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
