// Läuft beim Containerstart. Bewusst plain JS ohne tsx, damit im Runner-Image
// keine Build-Toolchain nötig ist.
import { PrismaClient } from "@prisma/client";

const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
if (!email) process.exit(0);

const prisma = new PrismaClient();

try {
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: { email, role: "ADMIN", status: "INVITED" },
  });
  console.log(`[seed-admin] ${user.email} ist Administrator.`);
} finally {
  await prisma.$disconnect();
}
