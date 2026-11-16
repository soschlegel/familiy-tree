// Gibt den Zustand der Datenbank aus, damit migrate.sh den passenden Weg
// wählen kann:
//   migrations  — _prisma_migrations existiert (Migrationen werden verwaltet)
//   pushed      — Tabellen vorhanden, aber ohne Migrationshistorie
//                 (bestehende Installation, angelegt per `prisma db push`)
//   empty       — leere Datenbank (Neuinstallation)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS migrations,
            to_regclass('public."Person"') IS NOT NULL AS person`,
  );
  console.log(row.migrations ? "migrations" : row.person ? "pushed" : "empty");
} finally {
  await prisma.$disconnect();
}
